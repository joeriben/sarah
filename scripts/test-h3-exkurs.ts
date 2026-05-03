// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Smoke-Test für H3:EXKURS — Re-Spezifikation des FORSCHUNGSGEGENSTANDs.
//
// Architektur (siehe docs/h3_exkurs_status.md):
//   EXKURS modifiziert das vorhandene FORSCHUNGSGEGENSTAND-Konstrukt
//   destruktiv: content wird durch eine neue, vom LLM rekomponierte
//   Version ersetzt; version_stack bekommt einen 're_spec'-Eintrag.
//   Konsumenten lesen FG ganz normal per SELECT und bekommen den re-
//   spezifizierten Stand.
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
// Wichtig: --mark-as-exkurs erstellt vor dem Lauf einen Snapshot des
// FORSCHUNGSGEGENSTAND-Konstrukts (content + version_stack) und stellt
// ihn im finally-Block wieder her — der destruktive Overwrite würde sonst
// den getesteten FG-Stand verändern.
//
// Aufruf:
//   npx tsx scripts/test-h3-exkurs.ts <caseId>                                  # read-only Lauf
//   npx tsx scripts/test-h3-exkurs.ts <caseId> --persist                        # mit Persistenz
//   npx tsx scripts/test-h3-exkurs.ts <caseId> --mark-as-exkurs="<heading-substring>" --persist
//                                                                                # temp. EXKURS-Markierung
//                                                                                # + FG-Snapshot
//                                                                                # + auto-restore nach Lauf
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

interface FgSnapshot {
	id: string;
	content: unknown;
	versionStack: unknown;
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

async function snapshotForschungsgegenstand(
	caseId: string,
	documentId: string
): Promise<FgSnapshot | null> {
	const row = await queryOne<{ id: string; content: unknown; version_stack: unknown }>(
		`SELECT id, content, version_stack
		 FROM function_constructs
		 WHERE case_id = $1
		   AND document_id = $2
		   AND outline_function_type = 'GRUNDLAGENTHEORIE'
		   AND construct_kind = 'FORSCHUNGSGEGENSTAND'
		 ORDER BY created_at DESC
		 LIMIT 1`,
		[caseId, documentId]
	);
	if (!row) return null;
	console.log(
		`[temp-mark] FG-Snapshot vor Lauf gesichert (id=${row.id.slice(0, 8)}…)`
	);
	return {
		id: row.id,
		content: row.content,
		versionStack: row.version_stack,
	};
}

async function restoreForschungsgegenstand(snapshot: FgSnapshot): Promise<void> {
	await query(
		`UPDATE function_constructs
		 SET content = $2,
		     version_stack = $3,
		     updated_at = now()
		 WHERE id = $1`,
		[snapshot.id, JSON.stringify(snapshot.content), JSON.stringify(snapshot.versionStack)]
	);
	console.log(
		`[temp-mark] FG zurück auf Vor-Lauf-Stand (id=${snapshot.id.slice(0, 8)}…)`
	);
}

async function restoreMark(backup: TempMarkBackup): Promise<void> {
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
	let fgSnapshot: FgSnapshot | null = null;
	let exitCode = 0;

	try {
		// Snapshot der FG VOR jeder Modifikation: nur wenn temp-Markierung
		// und persist beide aktiv sind, weil dann der destruktive Overwrite
		// auf einen "künstlichen" EXKURS angewendet würde, dessen Re-Spec
		// nicht im Bestand bleiben soll.
		if (markSubstring && persist) {
			const caseRow = await queryOne<{ central_document_id: string }>(
				`SELECT central_document_id FROM cases WHERE id = $1`,
				[caseId]
			);
			if (caseRow?.central_document_id) {
				fgSnapshot = await snapshotForschungsgegenstand(
					caseId,
					caseRow.central_document_id
				);
			}
		}

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

		console.log(`\n--- Lauf-Setup ---`);
		console.log(
			`  Modell:                 ${result.provider || '(no LLM call)'}/${result.model || '(no LLM call)'}`
		);
		console.log(`  LLM-Calls gesamt:       ${result.llmCalls}`);
		console.log(`  LLM-Zeit:               ${result.llmTimingMs}ms`);
		console.log(`  Tokens:                 in=${result.tokens.input}  out=${result.tokens.output}`);

		console.log(`\n--- Diagnose ---`);
		console.log(`  FRAGESTELLUNG-Konstrukte:        ${result.diagnostics.fragestellungCount}`);
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

		console.log(`\n--- EXKURS-Container (${result.exkursContainers.length}) ---`);
		if (result.exkursContainers.length === 0) {
			console.log(`  (keine — Pass war no-op)`);
		} else {
			for (const c of result.exkursContainers) {
				console.log(`  [${c.headingText}]  (${c.paragraphCount} ¶)`);
			}
		}

		console.log(`\n--- Re-Spezifikationen (${result.respecs.length}) ---`);
		for (const r of result.respecs) {
			console.log(`\n  EXKURS: "${r.headingText}"`);
			console.log(`    Stack-Tiefe vor → nach: ${r.stackEntriesBefore} → ${r.stackEntriesAfter}`);
			if (r.replacedPriorRespecForThisExkurs) {
				console.log(`    (vorheriger re_spec für diesen EXKURS aus Stack ersetzt — idempotent)`);
			}
			if (r.noRespec) {
				console.log(`    [noRespec=true — kein Re-Spezifikations-Akt; FG bleibt unverändert]`);
				console.log(`    Hinweis: ${r.reSpecText}`);
			} else {
				console.log(`    importedConcepts:`);
				if (r.importedConcepts.length === 0) {
					console.log(`      (keine — affiziert ohne externen Begriff?)`);
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
				console.log(`    reSpecText:`);
				const lines = r.reSpecText.split(/\n+/);
				for (const l of lines) console.log(`      ${l}`);
			}
			if (r.exkursAnchorText) {
				console.log(`    exkursAnchorText: »${r.exkursAnchorText}«`);
			}
			if (!r.noRespec) {
				console.log(`    --- FORSCHUNGSGEGENSTAND vor Re-Spec (Snippet) ---`);
				console.log(`      »${r.priorForschungsgegenstandText.slice(0, 250).replace(/\s+/g, ' ')}…«`);
				console.log(`    --- FORSCHUNGSGEGENSTAND nach Re-Spec (Snippet) ---`);
				console.log(`      »${r.newForschungsgegenstandText.slice(0, 250).replace(/\s+/g, ' ')}…«`);
				console.log(`    Subject-Keywords vor: ${r.priorSubjectKeywords.join(', ') || '(keine)'}`);
				console.log(`    Subject-Keywords nach: ${r.newSubjectKeywords.join(', ') || '(keine)'}`);
			}
		}

		if (result.respecs.length > 0) {
			console.log(`\n--- Endstand FORSCHUNGSGEGENSTAND ---`);
			console.log(`  »${result.forschungsgegenstandSnippet?.replace(/\s+/g, ' ') ?? ''}…«`);
			console.log(`  Final Subject-Keywords: ${result.finalSubjectKeywords.join(', ') || '(keine)'}`);
		}

		console.log(`\nLaufzeit gesamt:          ${elapsedMs}ms`);
	} catch (e) {
		console.error('\n>>> FAILED:', e instanceof Error ? e.stack : e);
		exitCode = 1;
	} finally {
		// Restore-Reihenfolge: erst FG-content/version_stack, dann
		// heading_classifications. Beide unabhängig — wenn eines fehlschlägt,
		// das andere trotzdem versuchen.
		if (fgSnapshot) {
			try {
				await restoreForschungsgegenstand(fgSnapshot);
			} catch (e) {
				console.error(
					'\n>>> FG-RESTORE FAILED — bitte manuell prüfen:',
					e instanceof Error ? e.message : e
				);
				console.error(`    FG-Konstrukt-id: ${fgSnapshot.id}`);
				exitCode = 1;
			}
		}
		if (backup) {
			try {
				await restoreMark(backup);
			} catch (e) {
				console.error(
					'\n>>> HEADING-RESTORE FAILED — bitte manuell prüfen:',
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
