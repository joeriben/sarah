# H3-Orchestrator-Stuck-Guard — Debug-Handover

**Erstellt:** 2026-05-04 (Interface-Session, Sonnet/Opus mit überfülltem Kontext)
**Status:** Bug nicht gelöst. Wiederholt sich auf verschiedenen H3-Phasen.

Dieses Dokument ist für die Folge-Session, die den Bug isolieren und fixen soll. Vorgängige Session hat das Symptom mehrfach gesehen, einmal durch Server-Restart partiell entschärft, aber nicht reproduzierbar gefixt.

---

## 1. Symptom

Pipeline-Runs (HTTP-Pfad via UI / `/api/cases/[caseId]/pipeline/run`-SSE) scheitern mit Stuck-Guard:

```
Stuck on h3_<PHASE>/H3 · <Label>: pass returned successfully 3× but
listAtomsForPhase still marks it pending. Either the pass is skip-on-existing
without persisting, or it persists nothing (e.g. AG-Pass output where all
scaffolding anchors are unresolvable). Run halted to prevent token-burn;
inspect this paragraph manually.
```

Die Stuck-Guard-Bedingung ([`orchestrator.ts:798-811`](../src/lib/server/pipeline/orchestrator.ts:798)): derselbe `atom.id` (= `documentId` für H3-Phasen) kommt 3× in Folge als `pending` aus `listAtomsForPhase`, obwohl `executeStep` jeweils ohne Throw zurückkehrt.

**Beobachtungen über mehrere Runs am 2026-05-04:**

| Run | Status | Phase | Bemerkung |
|---|---|---|---|
| `d8856b2d-d55c-…` | failed | h3_synthese | stuck, aber DB hat 1 GESAMTERGEBNIS persistiert (von früherem Run, vermutlich) |
| `df28e546-8c21-…` | failed | h3_synthese (current_phase) | error_message ist SCHLUSSREFLEXION-PreconditionFailed — Inkonsistenz current_phase ↔ error_message? |
| `1ca8c906-4258-…` | failed | h3_exkurs (current_phase) | stuck auf h3_werk_deskription |
| nach Server-Restart | completed | — | Werk-Phasen liefen, weil Konstrukte aus CLI-Test (s.u.) persistiert waren |
| `60b7807b-c496-…` (latest) | failed | h3_grundlagentheorie | stuck auf h3_forschungsdesign — DB hat 3 frische FORSCHUNGSDESIGN-Konstrukte aus 13:14, aber Run von 17:18 hat nicht überschrieben |

Phase-Labels werden seit Commit `1e5c802` korrekt angezeigt — das ist nicht Teil des Bugs.

---

## 2. Reproduktions-Setup

- **Case:** `c058ac80-5d1a-4194-90c5-0c207783233a` (Mein.docx, kein Benchmark — daher gefahrlos zu modifizieren)
- **Document:** `a543290d-016b-46b9-8e65-a9ec3566358c`
- **Project:** `ef5f61ca-0e63-4697-8dba-22d5b11568b7`
- **Brief:** `h3_enabled=true` (Pipeline läuft H3-Pfad)
- **Outline-Status:** confirmed, Funktionstypen alle vergeben
- **DB-Stand vor Bug-Re-Test** (2026-05-04 17:34 nach UI-Run):

```
DURCHFUEHRUNG    | BEFUND                 | 2  | 13:15
EXPOSITION       | FRAGESTELLUNG          | 1  | 12:46
EXPOSITION       | MOTIVATION             | 1  | 12:46
FORSCHUNGSDESIGN | BASIS                  | 1  | 13:14
FORSCHUNGSDESIGN | METHODEN               | 1  | 13:14
FORSCHUNGSDESIGN | METHODOLOGIE           | 1  | 13:14
GRUNDLAGENTHEORIE| BLOCK_ROUTING          | 3  | 12:46
GRUNDLAGENTHEORIE| DISKURSIV_BEZUG_BEFUND | 3  | 12:46
GRUNDLAGENTHEORIE| FORSCHUNGSGEGENSTAND   | 1  | 17:18  ← User-UI-Run
GRUNDLAGENTHEORIE| VERWEIS_PROFIL         | 3  | 12:46
SCHLUSSREFLEXION | GELTUNGSANSPRUCH       | 1  | 17:18  ← User-UI-Run
SYNTHESE         | GESAMTERGEBNIS         | 1  | 13:55
WERK_DESKRIPTION | WERK_BESCHREIBUNG      | 1  | 17:32  ← CLI-Test (s.u.)
WERK_GUTACHT     | WERK_GUTACHT           | 1  | 17:34  ← CLI-Test (s.u.)
```

---

## 3. Was funktioniert (CLI-Tests bestanden)

```bash
npx tsx scripts/test-h3-werk-deskription.ts c058ac80-5d1a-4194-90c5-0c207783233a --persist
# → constructId 7e76d82c-…, 19s, 4182/958 Tokens, persistiert
```

```bash
npx tsx scripts/test-h3-werk-gutacht.ts c058ac80-5d1a-4194-90c5-0c207783233a --persist
# → constructId 9b7bb60c-…, 60s (a/b/c), 14593/3223 Tokens, persistiert
```

Beide Skripte rufen `runWerkXxxPass(caseId)` direkt auf (analog zu `test-h3-schlussreflexion.ts`-Muster). **Persist funktioniert dort.** Das schließt aus:

- DB-Constraint-Probleme (CHECK-Liste in Mig 050 für outline_function_type ist OK; Direkt-INSERT funktioniert via psql)
- Fehler in `persistWerkBeschreibung` / `persistWerkGutacht`
- Fehler in der Connection-Pool / Transaction-Logik
- Fehler im `extractAndValidateJSON`-Schema-Parser

---

## 4. Was nicht funktioniert (Pipeline-Run-Loop)

Der HTTP-Pfad (`/api/cases/[caseId]/pipeline/run` → `runPipeline` in `orchestrator.ts`):

- ruft `executeStep(phase, atom, …)` ([`orchestrator.ts:559`](../src/lib/server/pipeline/orchestrator.ts:559))
- `executeStep` für H3-Phasen ruft `runH3Phase(phase, caseId, atom.id)` ([`orchestrator.ts:647`](../src/lib/server/pipeline/orchestrator.ts:647))
- `runH3Phase` ([`h3-phases.ts:259`](../src/lib/server/pipeline/h3-phases.ts:259)) macht switch + ruft die Heuristik

Der Loop sieht den Pass als "successful" zurückkommen (kein throw, `skipped: false`, irgendwelche Tokens), aber `listAtomsForPhase` findet danach kein primäres Konstrukt. Wiederholt sich 3× → Stuck-Guard.

**Beim aktuellen Run `60b7807b`** (failed, stuck auf h3_forschungsdesign):
- Vorher Phasen liefen mit echten Tokens (EXPOSITION 3644/564, GRUNDLAGENTHEORIE 20434/1142 — letzteres ist eine 5-stufige Pyramide, also persistiert wirklich was).
- FORSCHUNGSDESIGN wird stuck. Aber die DB-FORSCHUNGSDESIGN-Konstrukte sind aus 13:14 (alter Run). Ein neuer Pass hätte clear-vor-insert gefahren und einen neuen Timestamp produziert. Tut er nicht.

→ Der Pass läuft offenbar **nicht echt**. Er returnt aber `skipped: false` mit Tokens — was widersprüchlich erscheint, aber durch ein gecachtes Stub-Modul erklärbar wäre, das ein Fake-Result returnt.

---

## 5. Bisherige Hypothesen

### 5.1 Vite-SSR-Modul-Cache (teilweise bestätigt, dann wieder rückfällig)

Erste Diagnose: nach `h3-phases.ts`-Edit (mein WERK-Heuristik-Wiring) hatten der `runWerkDeskriptionPass`/`runWerkGutachtPass`-Branch im Cache des laufenden Vite-Servers nicht den neuen Code, sondern den alten Stub (`return { skipped: true, tokens: ZERO }`). Das deckt sich mit:

- Pass returned "successfully" (Stub gibt `skipped: false` mit `ZERO_TOKENS`-artigem return — fragwürdig)
- Keine `[WERK_DESKRIPTION:DEBUG]`-Zeilen im Server-Log
- DB unverändert

**Server-Restart half für werk_deskription/werk_gutacht.** Aber: nach dem Restart kommt jetzt der gleiche Bug für `h3_forschungsdesign`. Forschungsdesign.ts wurde in dieser Session nicht angefasst — der Vite-Cache sollte den Mother-Code (Commit `96d4405`) korrekt geladen haben.

→ Vite-Cache-These erklärt nicht das gesamte Phänomen. Entweder ist der Mechanismus subtiler, oder es gibt einen zweiten unabhängigen Bug.

### 5.2 Skip-on-existing-Check fälschlich positiv

`isH3PhaseValidated` ([`h3-phases.ts:196`](../src/lib/server/pipeline/h3-phases.ts:196)) skippt eine Phase, wenn ein `construct_validations`-Marker existiert. Wenn das fälschlich für FORSCHUNGSDESIGN greift, würde `runH3Phase` `emptySkipped()` (`{ skipped: true, ZERO_TOKENS }`) zurückgeben, das listAtoms findet nichts (weil `isH3PhaseDoneForDocument` separat schaut auf primäres Konstrukt), Stuck.

**Aber:** `construct_validations` ist leer für dieses Doc (geprüft, 0 Zeilen). Plus: Pass-Result wäre `skipped: true` — die User-Logs zeigen aber für werk_deskription kein step-done, was zu skipped:true passen würde, aber für FORSCHUNGSDESIGN auch keine Tokens.

→ Möglich für werk_*-Phasen vor Restart; nicht für FORSCHUNGSDESIGN nach Restart, weil der `executeStep`-Pfad für FORSCHUNGSDESIGN keine Validation-Skip-Logik in werk-shared hat.

### 5.3 Echter Persist-Bug in forschungsdesign.ts (clear ohne re-insert)

`runForschungsdesignPass` ([`forschungsdesign.ts:823+`](../src/lib/server/ai/h3/forschungsdesign.ts:823)) macht clear-vor-insert. Wenn der LLM-Call wirft und der catch-Block den Insert überspringt, wäre die Folge: clear gelöscht, kein insert. Aber: `runForschungsdesignPass` hat keinen catch-Block; ein throw würde nach oben propagieren → executeStep catch → step-error → kein Stuck-Guard.

→ Außer der Pass schluckt einen internen Error.

### 5.4 Race / Pool-Connection-Isolation

Theoretisch: insert auf Connection A, listAtomsForPhase auf Connection B liest stale snapshot. Aber PostgreSQL default ist read-committed, autocommit pro `pool.query()` — sollte sofort sichtbar sein. Plus: das CLI-Skript nutzt denselben Pool und sieht den Insert sofort.

→ Unwahrscheinlich, aber nicht 100% ausgeschlossen.

---

## 6. Was die nächste Session konkret tun sollte

### 6.1 Zuerst: Beweis ob der Pass echt läuft

Logs in `forschungsdesign.ts` einbauen — analog zu den (jetzt entfernten) Debug-Logs in `werk-deskription.ts`:

```ts
// in runForschungsdesignPass, nach den Vorbedingungs-Checks
console.error('[FORSCHUNGSDESIGN:DEBUG] before LLM, caseId=', caseId, 'documentId=', documentId);
// nach LLM
console.error('[FORSCHUNGSDESIGN:DEBUG] LLM done, persistConstructs=', persistConstructs);
// vor und nach jedem persist-Aufruf
console.error('[FORSCHUNGSDESIGN:DEBUG] cleared prior, count=', deletedCount);
console.error('[FORSCHUNGSDESIGN:DEBUG] persisted, ids=', { methodologieId, methodenId, basisId });
```

Server-Restart, dann UI-Run triggern. Im Server-Output:

- **Wenn keine `[FORSCHUNGSDESIGN:DEBUG]`-Zeile erscheint** → Pass läuft tatsächlich nicht. Vite-Modul-Cache-Issue, oder `isH3PhaseValidated` greift fälschlich. → `runH3Phase` selbst loggen lassen am Anfang und vor jedem case-Branch.
- **Wenn die Zeilen erscheinen** → Pass läuft, aber persistiert nicht. Nach jedem Log-Punkt prüfen, wo es hängt.

### 6.2 Dann: `executeStep` und `runH3Phase` selbst loggen

```ts
// in executeStep, am Anfang jeder H3-case-Branch
console.error('[ORCH:DEBUG] runH3Phase phase=', phase, 'atomId=', atom.id);
// in runH3Phase, am Anfang
console.error('[H3-DISP:DEBUG] runH3Phase entry phase=', phase, 'caseId=', caseId, 'documentId=', documentId);
// nach isH3PhaseValidated-Check
console.error('[H3-DISP:DEBUG] not validated → continue dispatch');
// im case-Branch (z.B. h3_forschungsdesign)
console.error('[H3-DISP:DEBUG] dispatching to runForschungsdesignPass');
// nach return
console.error('[H3-DISP:DEBUG] returned, tokens=', r.tokens, 'skipped?=', /* hartkodiert false */);
```

Das eliminiert die Vite-Cache-Hypothese definitiv: wenn die `[H3-DISP:DEBUG]`-Zeilen erscheinen aber `[FORSCHUNGSDESIGN:DEBUG]` nicht, dann hängt zwischen Dispatch und Heuristik etwas (weniger plausibel: Modul-Resolution-Bug); wenn alle Zeilen erscheinen aber dann persistiert wird nicht — Pass-interner Bug.

### 6.3 Verifikation: CLI-Vergleich

Die User-Test-Skript-Suite hat KEIN `test-h3-forschungsdesign.ts` mit `--persist`-Idempotenz-Check. Schau nach:

```bash
ls scripts/test-h3-forschungsdesign.ts
```

Wenn vorhanden: laufen lassen mit `--persist` gegen `c058ac80-…`. Wenn das funktioniert (DB-Timestamp wird neu) → Pass-Code ist OK, Bug ist im HTTP/Loop-Pfad. Wenn das auch fehlschlägt → Pass-Code hat einen Bug, der nur bei zweitem Run greift (clear-vor-insert mit existing Konstrukten).

### 6.4 Direkt nach Pipeline-Run Pool-Sanity-Check

Nach jedem persist im Pass: ein zweites SELECT auf das gerade eingefügte Konstrukt, um zu verifizieren, dass es auf derselben Connection sichtbar ist. Wenn nicht → Pool-Isolation-Issue. Wenn doch → Pool-Issue zwischen Pass-Connection und listAtoms-Connection.

### 6.5 Falls Vite-Cache es bleibt: Workaround

Wenn alles auf Vite-Modul-Cache hindeutet, ist die operative Empfehlung an den User: **Server-Restart vor jedem H3-Run, nach Code-Änderung**. Plus: kann man Vite anweisen, ein Modul nicht zu cachen (`?import-meta-fresh` oder `?t=${Date.now()}` in dynamic imports)?

Sauberer: `runForschungsdesignPass` etc. sollten **dynamic imports** statt static imports werden — dann lädt Vite jedesmal frisch:

```ts
// statt: import { runForschungsdesignPass } from '../ai/h3/forschungsdesign.js';
// dann: const { runForschungsdesignPass } = await import('../ai/h3/forschungsdesign.js');
```

Aber: das ist Workaround, kein Fix. Der eigentliche Fehler-Mechanismus muss isoliert werden.

---

## 7. Kontext-Zusammenfassung der vorherigen Session

Was die vorherige Session in den 2 Stunden vor diesem Handover gemacht hat:

| Commit | Was |
|---|---|
| `df28599` | fix(outline): Counter als Master der Heading-Numerierung |
| `8dd5543` | feat(h3): SCHLUSSREFLEXION-Recovery (letztes-Drittel statt STOP) |
| `8146b41` | feat(h3): WERK_DESKRIPTION + WERK_GUTACHT (a/b/c, c-Gating für Test deaktiviert) |
| `560f3d8` | feat(ui): Heuristik-Pfad-Radio H1/H2/H3 + Pre-Run-Validation |
| `1e5c802` | fix(ui): Phase-Label für H3-Phasen im Run-Event-Stream |
| `873603a` | chore(h3): WERK-Smoke-Test-Skripte + CSS-Cleanup |
| `69e3732` | feat(ui): Hard-Fail-Diagnose-Display mit strukturiertem Render + Action-Link |

Item 7 (Live-Funktionstyp-Edit-UX-Markierung) wurde angefangen aber nicht abgeschlossen (uncommittet in `outline/+page.svelte`):
- `functionTypeChangedCount` und `functionTypeChangedHeadings`-State eingeführt
- Banner-Render und setFunctionType-Hook fehlen noch

Wenn Item 7 wieder aufgenommen wird, vorher `git diff src/routes/projects/[projectId]/documents/[docId]/outline/+page.svelte` checken.

---

## 8. Pflicht-Lektüre für die Folge-Session

- `docs/h3_orchestrator_spec.md` (#2 Bedingungsgefüge)
- `src/lib/server/pipeline/orchestrator.ts:740-871` (Run-Loop + Stuck-Guard + executeStep)
- `src/lib/server/pipeline/h3-phases.ts:240-400` (runH3Phase-Dispatch)
- `src/lib/server/ai/h3/forschungsdesign.ts:800+` (runForschungsdesignPass — Pass mit der jetzt aktuellen Stuck-Symptomatik)
- Memory `feedback_pattern_iteration_vs_simpler_heuristic.md` — bei wiederholten Symptomen lieber ein-Schritt-Diagnostik (logging) als drittes Patch-Iteration

---

## 9. Nicht-zu-vergessen für die Folge-Session

- **Benchmark-Cases** (`c42e2d8f-…` BA H3 dev, `2635e73c-…` Habil) **NICHT modifizieren** — Memory `feedback_benchmark_cases_protected.md`. Tests gegen `c058ac80-…` (Mein.docx).
- **Debug-Logs** sind nicht slop, wenn sie ein konkretes Problem isolieren — aber **vor Commit entfernen**.
- **Server-Restart** ist heute die einzige Möglichkeit für Vite-Cache-Reset; bevor man den Bug für gefixt hält, mehrmals Restart + Re-Run testen.
- **AUTO-Mode** legitimiert keine high-level Setzungen (Memory). Wenn der Folge-Session-Fix den Persist-Mechanismus oder den Run-Loop strukturell ändern muss, vorher User-Konsens.
