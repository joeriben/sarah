-- SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Migration 052: Memo-Begriff INTERPRETIEREND → REFLEKTIEREND.
--
-- Hintergrund: Der per-Absatz-Memo-Typ war als "interpretierend" benannt,
-- was begrifflich ungenau ist. In der Bohnsack-Diktion (dokumentarische
-- Methode) gibt es das Paar:
--   - formulierende Interpretation = der immanente / thematische Sinn
--     ("was wird gesagt") — entspricht unserer FORMULIEREND-Sektion
--   - reflektierende Interpretation = der dokumentarische Sinn / Modus
--     operandi, im Sequenz-Kontrast entwickelt — das ist, was unser
--     bisheriges INTERPRETIEREND-Memo de facto erzeugt
--
-- "Interpretierend" verschleierte (i) dass auch FORMULIEREND eine
-- Interpretation ist und (ii) den Bohnsack-Anker. Diese Migration zieht
-- die Begriffs-Korrektur durch — auf bestehenden Daten und in allen
-- Inscription-Tags.
--
-- Betroffene Spalten/Werte:
--   1. memo_content.memo_type:  'interpretierend' → 'reflektierend'
--   2. namings.inscription:
--      [interpretierend]            → [reflektierend]
--      [interpretierend-retrograde] → [reflektierend-retrograde]
--
-- Idempotent: ein zweiter Lauf findet nichts mehr zu ändern.

BEGIN;

-- 1. Constraint temporär entfernen, damit der UPDATE nicht zwischen alten
--    und neuen Werten kollidiert.
ALTER TABLE memo_content DROP CONSTRAINT memo_content_memo_type_check;

-- 2. Bestehende Daten umtaggen.
UPDATE memo_content
   SET memo_type = 'reflektierend'
 WHERE memo_type = 'interpretierend';

UPDATE namings
   SET inscription = '[reflektierend-retrograde]' || substring(inscription FROM length('[interpretierend-retrograde]') + 1)
 WHERE inscription LIKE '[interpretierend-retrograde]%';

UPDATE namings
   SET inscription = '[reflektierend]' || substring(inscription FROM length('[interpretierend]') + 1)
 WHERE inscription LIKE '[interpretierend]%';

-- 3. Neuen Constraint mit reflektierend statt interpretierend setzen.
ALTER TABLE memo_content ADD CONSTRAINT memo_content_memo_type_check
  CHECK (memo_type = ANY (ARRAY[
    'formulierend'::text,
    'reflektierend'::text,
    'kontextualisierend'::text,
    'kapitelverlauf'::text
  ]));

COMMIT;
