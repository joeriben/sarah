// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:EXKURS — Re-Spezifikations-Akt am Forschungsgegenstand.
//
// Voraussetzungen für funktionalen Test:
//   - FRAGESTELLUNG-Konstrukt aus EXPOSITION persistiert
//     (vorher: scripts/test-h3-exposition.ts <caseId>).
//   - FORSCHUNGSGEGENSTAND-Konstrukt aus GTH-Schritt-4 persistiert
//     (vorher: scripts/test-h3-forschungsgegenstand.ts <caseId> --persist).
//   - Mindestens ein Heading mit outline_function_type='EXKURS'.
//
// EXKURS-Container sind im Bestand selten. Für formalen Test können wir
// ein bestehendes GRUNDLAGENTHEORIE-Heading temporär als EXKURS markieren
// und nach dem Lauf zurücksetzen — siehe --mark-as-exkurs Flag.
//
// Aufruf:
//   npx tsx scripts/test-h3-exkurs.ts <caseId>                                  # read-only Lauf
//   npx tsx scripts/test-h3-exkurs.ts <caseId> --persist                        # mit Persistenz
//   npx tsx scripts/test-h3-exkurs.ts <caseId> --mark-as-exkurs="<heading-substring>" --persist
//                                                                                # temp. EXKURS-Markierung +
//                                                                                # auto-reset nach Lauf
//   npx tsx scripts/test-h3-exkurs.ts <caseId> --provider=openrouter --model=anthropic/claude-haiku-4.5

import { runExkursPass } from '../src/lib/server/ai/h3/exkurs.js';
import type { Provider } from '../src/lib/server/ai/client.js';
import { pool, query, queryOne } from '../src/lib/server/db/index.js';

function parseFlag(name: string): string | null {
	const prefix = `--${name}=`;
	const hit = process.argv.find((a) => a.startsWith(prefix));
	return hit ? hit.slice(prefix.length) : null;
}

interface TempMarkBackup {
	headingClassificationId: string;
	headingText: string;
	previousFunctionType: string | null;
	previousUserSet: boolean;
}

async function tempMarkAsExkurs(
	caseId: string,
	headingSubstring: string
): Promise<TempMarkBackup> {
	const caseRow = await queryOne<{ central_document_id: string }>(
		`SELECT central_document_id FROM cases WHERE id = $1`,
		[caseId]
	);
	if (!caseRow?.central_document_id) {
		throw new Error(`Case ${caseId} hat kein central_document_id`);
	}
	const documentId = caseRow.central_document_id;

	const candidates = (await query<{
		id: string;
		element_id: string;
		heading_text: string;
		outline_function_type: string | null;
		outline_function_type_user_set: boolean;
	}>(
		`SELECT hc.id,
		        hc.element_id,
		        SUBSTRING(dc.full_text FROM de.char_start + 1
		                              FOR de.char_end - de.char_start) AS heading_text,
		        hc.outline_function_type,
		        hc.outline_function_type_user_set
		 FROM heading_classifications hc
		 JOIN document_elements de ON de.id = hc.element_id
		 JOIN document_content dc ON dc.naming_id = de.document_id
		 WHERE hc.document_id = $1
		   AND hc.outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND COALESCE(hc.excluded, false) = false
		 ORDER BY de.char_start`,
		[documentId]
	)).rows;

	const lower = headingSubstring.toLowerCase();
	const match = candidates.find((c) =>
		c.heading_text.toLowerCase().includes(lower)
	);
	if (!match) {
		const list = candidates
			.map((c) => `  - "${c.heading_text.trim()}"`)
			.join('\n');
		throw new Error(
			`Kein GTH-Heading enthält "${headingSubstring}".\nVorhandene GTH-Headings:\n${list}`
		);
	}

	console.log(
		`[temp-mark] Setze "${match.heading_text.trim()}" temporär auf EXKURS ` +
			`(vorher: ${match.outline_function_type}, user_set=${match.outline_function_type_user_set})`
	);

	await query(
		`UPDATE heading_classifications
		 SET outline_function_type = 'EXKURS',
		     outline_function_type_user_set = true,
		     updated_at = now()
		 WHERE id = $1`,
		[match.id]
	);

	return {
		headingClassificationId: match.id,
		headingText: match.heading_text.trim(),
		previousFunctionType: match.outline_function_type,
		previousUserSet: match.outline_function_type_user_set,
	};
}

async function restoreMark(
	backup: TempMarkBackup,
	persistedConstructIds: string[]
): Promise<void> {
	console.log(
		`[temp-mark] Setze "${backup.headingText}" zurück auf ` +
			`${backup.previousFunctionType} (user_set=${backup.previousUserSet})`
	);
	await query(
		`UPDATE heading_classifications
		 SET outline_function_type = $2,
		     outline_function_type_user_set = $3,
		     updated_at = now()
		 WHERE id = $1`,
		[backup.headingClassificationId, backup.previousFunctionType, backup.previousUserSet]
	);
	// Cleanup: RE_SPEC_AKT-Konstrukte, die der Test-Lauf erzeugt hat,
	// per ID gezielt löschen. Range-Rekonstruktion über char_start ist
	// fragil, weil unklassifizierte Sub-Headings direkt nach dem
	// markierten Heading liegen können.
	if (persistedConstructIds.length === 0) return;
	const deleted = await query(
		`DELETE FROM function_constructs
		 WHERE id = ANY($1::uuid[])
		   AND outline_function_type = 'EXKURS'
		   AND construct_kind = 'RE_SPEC_AKT'`,
		[persistedConstructIds]
	);
	if ((deleted.rowCount ?? 0) > 0) {
		console.log(
			`[temp-mark] ${deleted.rowCount} RE_SPEC_AKT-Konstrukt(e) aus dem Test-Lauf entfernt.`
		);
	}
}

async function main() {
	const caseId = process.argv[2];
	if (!caseId) {
		console.error(
			'Usage: npx tsx scripts/test-h3-exkurs.ts <caseId> [--persist] ' +
				'[--mark-as-exkurs="<heading-substring>"] [--provider=X --model=Y]'
		);
		process.exit(1);
	}
	const persist = process.argv.includes('--persist');
	const markSubstring = parseFlag('mark-as-exkurs');
	const providerArg = parseFlag('provider');
	const modelArg = parseFlag('model');

	const modelOverride =
		providerArg && modelArg
			? { provider: providerArg as Provider, model: modelArg }
			: undefined;

	let backup: TempMarkBackup | null = null;
	let persistedConstructIds: string[] = [];
	let exitCode = 0;

	try {
		if (markSubstring) {
			backup = await tempMarkAsExkurs(caseId, markSubstring);
		}

		console.log(
			`> H3:EXKURS für Case ${caseId}${persist ? '' : ' (read-only)'}…`
		);
		const start = Date.now();
		const result = await runExkursPass(caseId, {
			persistConstructs: persist,
			modelOverride,
		});
		const elapsedMs = Date.now() - start;
		persistedConstructIds = result.respecActs
			.map((r) => r.constructId)
			.filter((id): id is string => id !== null);

		console.log(`\n--- Lauf-Setup ---`);
		console.log(`  Modell:                 ${result.provider || '(no LLM call)'}/${result.model || '(no LLM call)'}`);
		console.log(`  LLM-Calls gesamt:       ${result.llmCalls}`);
		console.log(`  LLM-Zeit:               ${result.llmTimingMs}ms`);
		console.log(`  Tokens:                 in=${result.tokens.input}  out=${result.tokens.output}`);

		console.log(`\n--- Diagnose ---`);
		console.log(`  FRAGESTELLUNG-Konstrukte:       ${result.diagnostics.fragestellungCount}`);
		console.log(`  FORSCHUNGSGEGENSTAND-Konstrukte: ${result.diagnostics.forschungsgegenstandCount}`);
		if (result.diagnostics.warnings.length > 0) {
			for (const w of result.diagnostics.warnings) {
				console.log(`  WARN: ${w}`);
			}
		}

		if (result.fragestellungSnippet) {
			const fsShort = result.fragestellungSnippet.replace(/\s+/g, ' ');
			console.log(`\n--- FRAGESTELLUNG (Snippet) ---`);
			console.log(`  »${fsShort}…«`);
		}
		if (result.forschungsgegenstandSnippet) {
			const fgShort = result.forschungsgegenstandSnippet.replace(/\s+/g, ' ');
			console.log(`\n--- FORSCHUNGSGEGENSTAND (Snippet) ---`);
			console.log(`  »${fgShort}…«`);
			console.log(`  Subject-Keywords: ${result.subjectKeywords.join(', ') || '(keine)'}`);
		}

		console.log(`\n--- EXKURS-Container (${result.exkursContainers.length}) ---`);
		if (result.exkursContainers.length === 0) {
			console.log(`  (keine — Pass war no-op)`);
		} else {
			for (const c of result.exkursContainers) {
				console.log(`  [${c.headingText}]  (${c.paragraphCount} ¶)`);
			}
		}

		console.log(`\n--- RE_SPEC_AKT-Befunde (${result.respecActs.length}) ---`);
		for (const r of result.respecActs) {
			console.log(`\n  EXKURS: "${r.headingText}"`);
			if (persist) {
				console.log(`    construct: ${r.constructId ?? '(nicht persistiert)'}`);
				if (r.deletedPriorCount > 0) {
					console.log(`    (${r.deletedPriorCount} prior RE_SPEC_AKT für diesen Container entfernt)`);
				}
			}
			if (r.noRespec) {
				console.log(`    [noRespec=true — kein Re-Spezifikations-Akt erkannt]`);
			} else {
				console.log(`    importedConcepts:`);
				if (r.importedConcepts.length === 0) {
					console.log(`      (keine)`);
				} else {
					for (const ic of r.importedConcepts) {
						const author = ic.sourceAuthor ? ` (${ic.sourceAuthor})` : '';
						console.log(`      - ${ic.name}${author}`);
					}
				}
				console.log(`    affectedConcepts:`);
				if (r.affectedConcepts.length === 0) {
					console.log(`      (keine)`);
				} else {
					for (const ac of r.affectedConcepts) {
						console.log(`      - ${ac}`);
					}
				}
			}
			console.log(`    reSpecText:`);
			const lines = r.reSpecText.split(/\n+/);
			for (const l of lines) console.log(`      ${l}`);
			if (r.exkursAnchorText) {
				console.log(`    exkursAnchorText: »${r.exkursAnchorText}«`);
			}
		}

		console.log(`\nLaufzeit gesamt:          ${elapsedMs}ms`);
	} catch (e) {
		console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
		exitCode = 1;
	} finally {
		if (backup) {
			// Bei mark-only-Lauf ohne --persist sind persistedConstructIds
			// leer; restoreMark setzt nur die Klassifikation zurück und
			// löscht nichts. Bei Test-Lauf mit --persist werden die
			// gerade erzeugten RE_SPEC_AKT-Konstrukte gezielt entfernt.
			try {
				await restoreMark(backup, persistedConstructIds);
			} catch (e) {
				console.error(
					'\n>>> RESET FAILED — bitte manuell prüfen:',
					e instanceof Error ? e.message : e
				);
				console.error(
					`    UPDATE heading_classifications SET outline_function_type='${backup.previousFunctionType}', outline_function_type_user_set=${backup.previousUserSet} WHERE id='${backup.headingClassificationId}';`
				);
				exitCode = 1;
			}
		}
		await pool.end();
		process.exit(exitCode);
	}
}

main();
