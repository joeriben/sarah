# Ticket — Kostenmonitoring aus transact-qda übernehmen

**Status**: open
**Erstellt**: 2026-05-06
**Priorität**: hoch (struktureller Lückenschluss, nicht nur Polish)

## Problem

Pipeline-Runs laufen ohne Sicht auf Kosten und ohne Provider-Quota-Stand
ins Verderben. Konkrete Folgen, die dieses Ticket adressiert:

- Wochen-Quota auf OpenRouter (z.B. „Key limit exceeded (weekly limit)")
  überrascht **mitten im Run**. User sieht erst nach 60+ verbrannten
  Atomen, dass der Account leer ist.
- Keine Pre-Run-Cost-Estimate: User triggert einen Habil-Lauf ohne zu
  wissen, ob es 5 € oder 50 € werden.
- `RunOptions.cost_cap_usd` existiert im Schema, wird aber im Loop
  nicht ausgewertet — toter Vertrag.
- Cumulative Token-Counts (`accumulated_input_tokens` etc.) liegen in
  `pipeline_runs`, werden aber nicht in $ konvertiert oder gegen ein
  Limit geprüft.

Der heutige (2026-05-06) Fail-Fast-Commit (6c7dd9d) schließt nur die
Cascade nach dem Quota-Hit. Er verhindert nicht den Hit selbst und
nicht die Überraschung beim User.

## Was transact-qda hat

Quelle: `/Users/joerissen/ai/transact-qda/` (lokales Remote `transact`
unter `origin`). Vor Implementation dort lesen:

- Cost-Estimator-Modul (Pre-Run-Schätzung pro Modell)
- Provider-Quota-Stand-Pull (mindestens OpenRouter
  `/api/v1/auth/key` liefert `limit`/`limit_remaining`/`is_free_tier`)
- Live-Spend-Watermark während des Runs
- Soft-Cap-Logik (Run pausiert bei Schwelle, User bestätigt Fortsetzung)
- $/Mtok-Preistabelle pro Provider+Modell

Konkrete Datei-Pfade beim Implementation-Start aus dem transact-Repo
auflisten (`grep -rn "cost\|spend\|quota" src/`).

## Scope (in SARAH)

1. **Preistabelle** als typisierte Konstante (Provider × Modell →
   `{ inputPerMtok, outputPerMtok, cacheReadPerMtok, cacheCreatePerMtok }`).
   Mindestens für die produktiv genutzten Modelle (Sonnet via Mammouth,
   Mistral-Large via Mistral, Mimo, ggf. OpenRouter-Routes).
2. **Cost-Estimator-Funktion** `estimateRunCost(plan, options)` → 
   `{ low, high }` USD-Spanne pro Heuristik (H1/H2/H3 + Modifikatoren wie
   retrograde, validity, h3_walk-Sub-Tools).
3. **Pre-Run-Anzeige im Run-Setup-UI**: erwartete Spanne + aktuelle
   Tier-Wahl, bevor User „Run starten" drückt.
4. **Live-$-Watermark im SSE-Event** (`step-done.cumulative` um `usd`
   erweitern) + UI-Anzeige im Run-Status-Panel.
5. **Soft-Cap-Auswertung**: `cost_cap_usd` im Loop prüfen, beim
   Überschreiten → `markPaused` mit Reason `cost_cap_exceeded` + Event;
   Resume erst nach explizitem User-OK.
6. **Provider-Quota-Pull (best-effort)**: vor Run-Start für den
   konfigurierten Provider den Limit-Stand abfragen (OpenRouter,
   Anthropic, Mistral, falls Endpoint vorhanden) und im Pre-Flight-Block
   zeigen. Wenn Endpoint nicht existiert: ohne Murren weglassen, nicht
   blocken.

## Acceptance

- [ ] Pre-Run-UI zeigt USD-Spanne ($X – $Y) bevor Run startet, ggf. mit
  Provider-Quota-Stand „X von Y € verbleibend (wöchentlich)".
- [ ] Live-Watermark im Run-Status, $-Genauigkeit ≥ 1 ¢ pro Atom.
- [ ] `cost_cap_usd` ist als echte Soft-Bremse implementiert; ein Run
  mit cap=$1 kommt nicht über $1+ε.
- [ ] Quota-403/429 wird durch das Cap idealerweise gar nicht erst
  erreicht — der heutige Fail-Fast bleibt als Fallback drin.
- [ ] Pre-Run-Estimate ist im Mittel binnen ±20 % der tatsächlichen
  Run-Kosten (Validierung an 3-5 historischen Runs in `pipeline_runs`).

## Out of Scope

- Hartes pro-User-Budget-System mit DB-Persistenz / Multi-User-Quoten.
- Anonymisierte Telemetrie nach außen.
- Rückblickende Kosten-Analytik über Projekte (kann Folge-Ticket).
- Cost-aware Tier-Routing (Cheaper-Modell wählen wenn Cap droht) — nur
  wenn der naive Soft-Cap-Stop in der Praxis zu grob ist.

## Bezüge

- Memory `feedback_understand_before_implementing.md`: vor Code-Start
  transact-qda-Modul lesen, nicht aus dem Stand frei reimplementieren.
- Memory `project_two_track_model_strategy.md`: Preistabelle muss beide
  Stacks (Sonnet+Mistral) gleichberechtigt erfassen.
- Heutiger Fix-Commit `6c7dd9d` (Pre-Flight + Fail-Fast): Cascade-Schutz
  bleibt drin, ist nicht Ersatz für dieses Ticket.
