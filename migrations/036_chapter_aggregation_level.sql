-- Migration 036: Per-chapter subchapter-aggregation level
--
-- Direction 4 erweitert die Synthese-Pipeline um Hauptkapitel- und Werk-
-- Collapses. Auf Hauptkapitel-Ebene stellt sich pro L1-Kapitel die Frage,
-- auf welcher Heading-Tiefe die Subkapitel-Synthese-Einheit liegt:
--
--   - L1 (= Kapitel selbst, kein Sub-Collapse) — flach gegliederte
--     Kapitel ohne nennenswerte Untergliederung (typisch Methodenkapitel,
--     Einleitung). Ein einziger Synthese-Lauf direkt über die Absätze.
--   - L2 — klassisch zweistufig gegliederte Kapitel.
--   - L3 — tief gegliederte Kapitel (typisch Theorieteile von Habilitationen).
--
-- Die Auswahl wird pro L1-Kapitel adaptiv getroffen, basierend auf dem
-- Median der Absatzanzahl je Heading-Einheit auf der jeweiligen Ebene; die
-- validierte Zielzone liegt bei ~5–15 ¶ pro Synthese-Einheit (S1–S3:
-- 5/5/9/13). Höhere Ebenen oberhalb der gewählten Subkapitel-Ebene werden
-- vollrekursiv kollabiert (z.B. bei Wahl L3: ¶→L3→L2→L1→Werk).
--
-- Die berechnete Wahl wird hier persistiert, damit Re-Runs deterministisch
-- dieselbe Hierarchie sehen und der User die Wahl manuell überschreiben
-- kann (zur Kostenkontrolle: gewähltes L2 statt L3 halbiert die Anzahl der
-- Subkapitel-Memos in einem tief gegliederten Kapitel).
--
-- Semantik: Die Spalte ist nur für L1-Headings sinnvoll befüllt. Für
-- Headings tieferer Ebenen bleibt sie NULL und wird ignoriert. Das ist
-- Soft-Konvention — application-code-enforced, kein DB-Constraint, weil
-- das tatsächliche resolved Level (parser-level OR user_level override)
-- aus einem CHECK heraus nicht sauber erreichbar ist.

ALTER TABLE heading_classifications
  ADD COLUMN aggregation_subchapter_level SMALLINT
    CHECK (aggregation_subchapter_level IS NULL
        OR (aggregation_subchapter_level >= 1
        AND aggregation_subchapter_level <= 3));
