// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Node-Bridge zum lokalen NER-Service (scripts/ner_titlepage.py).
//
// Hintergrund: Statt des fehleranfälligen Regex-Ports aus sacanev nutzen
// wir spaCy mit de_core_news_lg (~545 MB lokal, kein externes LLM, kein
// API-Call). Das fängt deutsche Personen-Namen, Organisationen, Locations
// und MISC (häufig Werktitel) zuverlässig ab — auch ohne strukturelles
// Layout (DOCX-Single-Paragraph-Frontpages, fehlende "Vorgelegt-von"-
// Labels, Umlaut-Run-Boundaries usw.).
//
// Architektur-Setzung 2026-05-02 (User): "Es gibt Technologien um Namen
// zu erkennen ohne ext. LLM, so ein algorithmisches Ding oder mini-LLM"
// → spaCy.

import { spawn } from 'node:child_process';
import { join } from 'node:path';

export type NerLabel = 'PER' | 'ORG' | 'LOC' | 'MISC' | string;

export interface NerEntity {
	text: string;
	label: NerLabel;
	start: number;
	end: number;
}

export interface NerResult {
	entities: NerEntity[];
	error?: string;
}

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'ner_titlepage.py');

/**
 * Führt NER über den Python-Service aus. Spawnt python3 + Script,
 * schreibt JSON auf stdin, liest JSON von stdout. Modell-Load ist ~3 s
 * pro Aufruf — für eine Anonymisierung (= 1 Aufruf pro Dokument-Upload)
 * akzeptabel.
 *
 * Bei Fehler (Python missing, Modell missing, Service-Crash): leeres
 * Entities-Array + error-Feld. Der Caller fällt dann auf Regex-only-
 * Mode zurück (Email/Matrikel weiter via Regex; Personen-Namen fehlen).
 */
export async function runNer(text: string, lang: 'de' | 'en' | 'auto' = 'auto'): Promise<NerResult> {
	if (!text || !text.trim()) {
		return { entities: [] };
	}
	return new Promise((resolve) => {
		const proc = spawn('python3', [SCRIPT_PATH], {
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (chunk) => (stdout += chunk.toString('utf-8')));
		proc.stderr.on('data', (chunk) => (stderr += chunk.toString('utf-8')));
		proc.on('error', (err) => {
			resolve({ entities: [], error: `spawn failed: ${err.message}` });
		});
		proc.on('close', (code) => {
			if (code !== 0 && !stdout) {
				resolve({ entities: [], error: `ner exited ${code}: ${stderr.slice(0, 400)}` });
				return;
			}
			try {
				const parsed = JSON.parse(stdout);
				resolve({
					entities: parsed.entities ?? [],
					error: parsed.error
				});
			} catch (e) {
				resolve({
					entities: [],
					error: `ner output parse failed: ${(e as Error).message}; stdout=${stdout.slice(0, 200)}`
				});
			}
		});
		proc.stdin.write(JSON.stringify({ text, lang }));
		proc.stdin.end();
	});
}
