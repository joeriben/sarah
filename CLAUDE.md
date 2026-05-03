**Architektur-Doku**: `docs/ARCHITECTURE.md` ist der single-source-of-truth-Index für Datenmodell, Pipeline-Stand, API-Surface und Konventionen. Vor jeder neuen Code-Änderung dort einsteigen, nicht in `docs/design-*.md` (siehe `docs/architecture/09-legacy-docs-ledger.md`).

Die Kernprinzipien aus Sessions 00-02:

  1. Transaktionale Ontologie (D/B): Die Grundeinheit ist das Ereignis (Naming-Akt), nicht die Entität. 3-Tabellen-Modell:
   namings, participations, appearances.
  2. Designation-Gradient (CCS): Cue → Characterization → Specification — bidirektional. Ein Naming IST seine
  Designation-Geschichte (append-only chain, wie eine "Blockchain"). Messy vs. Ordered ist kein Modus, sondern der
  aggregierte Designation-Stand.
  3. Drei-Schichten-Hierarchie:
    - Datenstruktur = ground truth
    - Liste = privilegierte Repräsentation (vollständig, dimensionslos)
    - Canvas = derivative Projektion (bequem, aber epistemisch untergeordnet)
  4. Forscher-als-Naming: Kein ontologischer Bruch zwischen Subjekt/Objekt. User sind Namings im Datenraum.
  5. Silences / Nicht-Anwesendes: Konkret rekonstruierbar als "Muster der Nicht-Präsenz" (Barad). mode: 'silence' +
  Participations ohne Appearances. Kein reifiziertes trace-Objekt.
  6. Perspectival Collapse: Ein Naming IST sein Stack (nicht hat eine Geschichte). Verschiedene Perspektiven kollabieren
  denselben Stack unterschiedlich via collapseAt.
  7. Provenance: Zwei orthogonale Dimensionen — CCS-Gradient vs. Grounding (📄 = Dokumentanker). Codes als derived view
  von Maps.
