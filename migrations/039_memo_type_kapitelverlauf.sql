-- Migration 039: memo_type 'kapitelverlauf' — narrative Strukturwiedergabe auf Werk-Ebene
--
-- Das Werk-Verdikt (memo_type='kontextualisierend', scope_level='work') ist die
-- evaluativ-argumentative Gesamtdiagnose. Es beantwortet: "Was leistet das Werk?
-- Wie ist die Niveau-Beurteilung kalibriert am Werktyp?"
--
-- Daneben braucht das Gutachten einen *narrativen Kapitelverlauf*: einen
-- zusammenfassenden Absatz, der durch die Kapitelfolge geht ("In Kap. 2 wird X
-- erörtert, Kap. 3 stellt Y dar, …") und die Argumentationsbewegung des Werks
-- nachzeichnet. Format-Vorbild: der mittlere Absatz klassischer BA-Gutachten,
-- der zwischen Werk-Verdikt und Note-Vergabe steht.
--
-- Beide Memos sind kontextualisierend, aber unterschiedlicher Diktion: das
-- Werk-Verdikt formuliert in Diagnose-Sätzen, der Kapitelverlauf in narrativ-
-- referierender Stimme. Wir trennen sie über einen eigenen memo_type, damit
-- der Pipeline-Status-Endpoint sie sauber zählen kann (workPass.total = 1
-- bleibt, Kapitelverlauf wird als separater Pass geführt).
--
-- Storage-Konvention:
--   memo_type        = 'kapitelverlauf'
--   scope_level      = 'work'
--   scope_element_id = NULL
--   inscription      = '[kapitelverlauf/work] <document-title>'
--   appearances.properties.document_id verlinkt auf das Dokument.

ALTER TABLE memo_content DROP CONSTRAINT IF EXISTS memo_content_memo_type_check;
ALTER TABLE memo_content ADD CONSTRAINT memo_content_memo_type_check
  CHECK (memo_type IN ('formulierend', 'interpretierend', 'kontextualisierend', 'kapitelverlauf'));
