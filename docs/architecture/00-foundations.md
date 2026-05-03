# 00 — Foundations

**Stand: 2026-05-03** · Epistemologische und konzeptionelle Basis. Vollständige Herleitung in `docs/sessions/00_epistemological_foundations.md` (lange Form, 324 Zeilen).

---

## 1. Nicht verhandelbar

**Nicht-Chunking · strukturbewusst · sequenzielle Hermeneutik.** Texte werden nicht in atemberaubende Häppchen zerlegt — sie werden entlang ihrer eigenen Gliederung sequenziell gelesen. Das ist keine Performance-Optimierung, sondern die methodologische Bedingung dafür, dass die Werkzeug-Outputs überhaupt einer geisteswissenschaftlichen Lesart standhalten.

**SARAH ist Critical Friend, nicht Beurteilungsautomat.** Alle Outputs unterstützen ein eigenes Urteil des Forschers. Es gibt keine "Note vom System". `H3:WERK_GUTACHT-c` (Gutachten-Synthese) ist gegated durch ein eigenes Reviewer-`review_draft`. Diese Identität ist in jeder UI-Darstellung sichtbar.

---

## 2. Transaktionale Ontologie (Sessions 00–02)

**Grundeinheit ist das Ereignis (Naming-Akt), nicht die Entität.** Drei-Tabellen-Modell:

- `namings` — jedes Naming ist ein Ereignis mit Identität.
- `participations` — undirektionale Bindungen zwischen Namings.
- `appearances` — perspektivische Kollapse: hier emergiert mode ∈ {entity, relation, constellation, process, silence, perspective}.

**Designation-Gradient (CCS): Cue → Characterization → Specification — bidirektional.** Ein Naming **ist** seine Designation-Geschichte (append-only chain in `naming_acts`, vergleichbar einer Blockchain). Messy vs. Ordered ist kein Modus, sondern der aggregierte Designation-Stand.

**Forscher-als-Naming.** Kein ontologischer Bruch zwischen Subjekt und Objekt. User sind Namings im Datenraum (`researcher_namings`); KI auch (`ai_namings`). Konsequenz: Provenance ist ein Naming-Naming-Zusammenhang, kein Metafeld.

**Silences / Nicht-Anwesendes.** Konkret rekonstruierbar als "Muster der Nicht-Präsenz" (Barad): `appearances.mode='silence'` plus `participations` ohne `appearances`. Kein reifiziertes `trace`-Objekt.

**Perspectival Collapse.** Ein Naming ist sein Stack (nicht "hat" eine Geschichte). Verschiedene Perspektiven kollabieren denselben Stack unterschiedlich via `collapseAt`.

---

## 3. Drei-Schichten-Hierarchie

```
Datenstruktur     (ground truth — namings/participations/appearances + naming_acts)
   ↓
Liste             (privilegierte Repräsentation — vollständig, dimensionslos)
   ↓
Canvas / Outline  (derivative Projektion — bequem, aber epistemisch untergeordnet)
```

Eine Liste kann immer alles zeigen, was die Datenstruktur enthält. Eine Canvas-Darstellung kann das nie und ist deswegen niemals authoritative.

---

## 4. Provenance: Zwei orthogonale Dimensionen

| Dimension | Träger | Semantik |
|-----------|--------|----------|
| **CCS-Gradient** | `naming_acts` (designation-Spalten) | wie weit ist die Bedeutung kondensiert (Cue/Char/Spec)? |
| **Grounding** | `appearances` (mit role `grounding-workspace`) plus `code_anchors` | gibt es einen Dokumentanker? |

Codes sind **derived view** von Maps. `code_anchors` bindet Code-Namings an Positionen in `document_elements`.

---

## 5. Methode: Sequenzielle Analyse (Bohnsack-Vokabular als Heuristik)

Drei-Spalten-Schema (in der Werk-Lesart):

| Ebene | Spalte | Tabelle |
|-------|--------|---------|
| Unterkapitel | formulierend → interpretierend → kontextualisierend (subchapter) | `memo_content` (memo_type) |
| Kapitel | kontextualisierend (chapter) + optional kapitelverlauf | `memo_content` |
| Gesamtarbeit | kontextualisierend (work) | `memo_content` |

Bohnsack ist Vokabular-Heuristik für die Pipeline-Prompts, **nicht** dogmatische Methodologie. Vokabular-Hygiene ist Pflicht (siehe `08-conventions §Vokabular`).

---

## 6. Anti-Patterns (verbietet jede neue Code-Änderung)

- **Chunking** auf Token-Basis ohne Strukturbezug — verboten.
- **Beurteilungs-Automatisierung** ohne sichtbares User-Owned-Review — verboten (`H3:WERK_GUTACHT-c` gated).
- **Reifizierte "Entitäten"** ohne Naming-Akt-Provenienz — verboten.
- **Codes als first-class Objekte** statt als View über Map-Anchors — verboten (Migration 008 Retirement).
- **Pseudo-Setzungen via Default-Werten / Hint-Maps** ohne explizite User-Zustimmung — verboten (siehe Memory `feedback_no_hidden_setq`).

---

## 7. Quellen / Referenzplattformen

- **MoJo** + **transact-qda** — Referenzdesigns (siehe Memory `reference_source_platforms`).
- **SARAH** ist nicht experimentelle Epistemologie, sondern **pragmatische Plattform** (siehe Memory `feedback_pragmatic_platform`). Strukturelle Primitiven werden bei Geschwister-Plattformen abgeschaut; importiere keine Meta-Architektur (Situational Maps etc.) bloß aus Eleganzgründen.
