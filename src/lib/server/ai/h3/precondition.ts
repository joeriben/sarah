// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Vorbedingungs-Verletzung für H3-Heuristiken.
//
// Gemäß docs/h3_orchestrator_spec.md #2 ist das Bedingungsgefüge HART:
// Fehlt eine analytisch erforderliche Vorbedingung, läuft die Phase nicht,
// sondern wirft diesen Fehler. Der Orchestrator (kommt später) fängt ihn
// und überführt den Run-State in `failed` mit Diagnose. Heutige CLI-Skripte
// propagieren ihn als klare Fehlermeldung.

export class PreconditionFailedError extends Error {
	readonly heuristic: string;
	readonly missing: string;
	readonly diagnostic: string;

	constructor(args: { heuristic: string; missing: string; diagnostic: string }) {
		super(
			`H3:${args.heuristic} — Vorbedingung verletzt: ${args.missing}\n  ${args.diagnostic}`
		);
		this.name = 'PreconditionFailedError';
		this.heuristic = args.heuristic;
		this.missing = args.missing;
		this.diagnostic = args.diagnostic;
	}
}
