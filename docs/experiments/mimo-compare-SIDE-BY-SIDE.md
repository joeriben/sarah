# xiaomi/mimo-v2.5-pro — qualitative content comparison

Test date: 2026-05-04
Test scope: 4 load-bearing pipeline calls. Same prompts, same input data,
only the model swapped. JSON adherence is incidental — the reading is
whether mimo's content holds up against Sonnet/Opus/DeepSeek on academic
German prose.

Test driver: `scripts/test-mimo-quality.ts`.

## Bottom line — content quality

**Chapter-collapse: opus-grade.** Same werk-architektonische Diagnose as
Opus 4.7: trichterförmige Bewegung 1.1→1.2→1.3, Übergang 1.2→1.3 als
strukturell tragender Umschlag, `1.3.3 §4:A7` (Ungewissheits-Erweiterung)
als einzige theoretische Eigenleistung, `1.2.1 §5:A1`/`§6:A3`
(fünfgliedrige Kulturbestimmung, Priorisierung impliziter Normierungen)
als listenförmig-assertive Setzungen. mimo findet eine Auffälligkeit
*mehr* als Opus — die sechsstufige Deduktionskette in `1.3.3 §7` ohne
Stützstruktur, die Opus übersieht. §:A-Präzision sauber durchgehend.

**Per-¶ synthese: Sonnet-Niveau.** §1 reads the same Reckwitz/Bhabha
framing of cultural routines and the doppelter Effekt; §2 sharpens
"Kulturelle Bildung als reflexive Aufgabe" als zentrale Diagnose; §3
identifiziert "Bildung als Selbstverortung und Teilhabe" + "Globalität
als Radikalisierung der Bildungsdynamik"; §4 verdichtet zu "Bildung als
kulturelle Formation sozialer Ordnungsbezüge"; §5 (Schlussabsatz)
verknüpft die theoretische Dialektik mit Zeitdiagnose (Superdiversität,
Populismus) und bildungspolitischer Resonanz (BMBF, PISA), pointiert
in der Doppelaufgabe Kohärenzdefizite/Pluralität-ermöglichen — siehe
§5 unten (Sektion 5/6, re-run mit adäquatem Budget). Code-Labels
durchgängig gut formuliert und mit dem Quelltext eng verbunden.

**Argumentation graph: textsensitiv variable Granularität.** Bei §1
packt mimo 4-5 atomare Sonnet-Argumente in 1 Mega-Argument mit mehreren
Prämissen (mimo: 3 Args / Sonnet: 5 Args / Opus: 6 Args). Bei §5
invertiert sich das Bild: **mimo liegt mit 5 Args parallel zu Opus**,
während Sonnet auf 3 dichtere Mega-Argumente bündelt (siehe Sektion 6).
Beide Modi sind analytisch tragfähig; mimo's Granularitätssensitivität
korreliert offenbar mit Textdichte des Absatzes. Distinct bei mimo §5:
explizite cross-paragraph-edges (A1→§1:A4/A5 refines, A5→§4:A1
presupposes), die Sonnet/Opus an dieser Stelle nicht ziehen. **Eine
echte inhaltliche Lapsus** bei §1: A1's Prämisse hat den Text "none"
statt Quote — Lazy-Extraktion.

**EXPOSITION (BA H3 dev): Test diskriminiert nicht.** Mimo und Sonnet
produzieren beide eine Paraphrase der selbstdeklarierten BA-Forschungs-
frage, ohne Methode/Frage zu trennen, ohne kritische Rekonstruktion. Auf
diesem BA-Niveau (selbstdeklariert ≈ tatsächlich) ist das vermutlich
auch in Ordnung; Habil-Level würde den Unterschied schärfen.

**Operativ — was bei mimo zu beachten ist:** mimo gehört zur
Reasoning-Klasse und verbrennt unsichtbare Reasoning-Tokens. Die
hardcoded `maxTokens` der Pipeline (synth=2000, AG=8000, collapse=6000)
sind für Sonnet/Opus dimensioniert (Output ≈ 500-700 Tokens) und für
mimo zu eng — bei §5 (1626 Zeichen, 6+ Quellen) reichten sie nicht. Die
opts-Parameter nehmen jetzt `maxTokens?: number` entgegen
(per-paragraph.ts:551, argumentation-graph.ts:882); Default unverändert.

**Cost-Größenordnung pro Pipeline-Bestandteil (mimo vs Standard):**

| Use-case | mimo | Sonnet | Opus | Δ vs Standard |
|---|---:|---:|---:|---:|
| 5 ¶ synth | $0.030 | $0.111 | $0.725 | **3.7× günstiger als Sonnet** |
| 5 ¶ AG | $0.047 | $0.255 | $1.436 | **5.4× günstiger als Sonnet** |
| Chapter collapse | $0.024 | n/a | $0.563 | **23× günstiger als Opus** |
| EXPOSITION | $0.002 | $0.009 | n/a | **4× günstiger als Sonnet** |

**Wo mimo passt** in der existierenden Two-Track-Architektur (Sonnet-/
Opus-Premium + Mistral-basal/Sonnet-collapse-Budget):
- **Chapter-Collapse-Stufe in der Budget-Route**: bisher Sonnet-Domäne;
  mimo erreicht hier Opus-Qualität (mehr Auffälligkeiten als Opus,
  gleiche §:A-Präzision) bei einem Bruchteil der Kosten. Klarster
  Kandidat.
- **Per-¶ synthese als Mistral-Alternative**: gleiche inhaltliche
  Schärfe wie Sonnet bei ähnlichen Kosten zu Mistral, aber nicht in der
  EU. Eher Wahlfrage (DSGVO vs Inhalt).
- **AG**: Lesart gemischter — bei §1-artigen, theoretisch dicht geführten
  Absätzen tendiert mimo zur Bündelung; bei diagnostisch-aufzählenden
  Absätzen wie §5 liefert mimo dieselbe Granularität wie Opus mit
  zusätzlich expliziten cross-¶-edges. Sonnet bleibt für gleichmäßige
  §:A-Granularität die berechenbarere Wahl, mimo gewinnt durch
  cross-¶-Verweise.
- **EXPOSITION-Klasse Konstrukte**: Test war hier nicht diskriminierend.

## Headline cost / latency

### Per-paragraph synthese (5 ¶ on subchapter 1.1.1)

| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | Successful ¶ |
|---|---:|---:|---:|---:|---:|
| **mimo-v2.5-pro** | 155.6 | 9154 | 6833 | $0.0297 | 4/5 |
| sonnet-4-6 | 55.5 | 23107 | 2759 | $0.1107 | 5/5 |
| opus-4.7 | 33.9 | 31993 | 3266 | $0.7248 | 5/5 |
| deepseek-v4-pro | 267.0 | 16501 | 9505 | $0.0218 | 5/5 |

### Argumentation graph (5 ¶ on subchapter 1.1.1)

| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | Successful ¶ |
|---|---:|---:|---:|---:|---:|
| **mimo-v2.5-pro** | 306.6 | 11384 | 11916 | $0.0471 | 4/5 |
| sonnet-4-6 | 176.0 | 20837 | 12805 | $0.2546 | 4/5 |
| opus-4.7 | 99.2 | 28740 | 13397 | $1.4359 | 4/5 |
| deepseek-v4-pro | (failed AG schema, see baseline file) | | | | 0/5 |

### Chapter 1 collapse (single call, 7 L3 inputs)

| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | Auffälligkeiten |
|---|---:|---:|---:|---:|---:|
| **mimo-v2.5-pro** | 67.4 | 11562 | 4127 | $0.0239 | 7 |
| opus-4.7 | 42.5 | 18587 | 3792 | $0.5632 | 6 |
| deepseek-v4-pro | 151.3 | 11023 | 5248 | $0.0128 | 4 |

### H3 EXPOSITION fallback (BA H3 dev, single call)

| Modell | Wall (s) | In tokens | Out tokens | Cost (rough) | JSON ok |
|---|---:|---:|---:|---:|---:|
| **mimo-v2.5-pro** | 4.6 | 1179 | 215 | $0.0018 | YES |
| sonnet-4-6 | 5.6 | 1424 | 306 | $0.0089 | YES |

---

## 1. Per-paragraph synthese — §1 of 1.1.1

Subchapter 1.1.1: "Bedeutung kultureller Orientierungsangebote in Schule"
(Habil Timm). §1 introduces the praxeological cultural framing (Reckwitz)
and the doppelter Effekt of cultural routines.

**mimo-v2.5-pro**

> Der Absatz etabliert die kulturwissenschaftliche Grundierung der Arbeit, verankert bei Reckwitz und Bhabha, und definiert Kultur als implizites Reservoir von Werthorizonten, das Gemeinschaften durch Routinen konstituiert. Die argumentative Kernaufgabe des Absatzes besteht in der Herausarbeitung einer Doppelstruktur: Kulturelle Routinen ermöglichen Handlungsgewissheit, begrenzen zugleich das individuelle Repertoire und perpetuieren Ausschlüsse — wobei Kultur gleichzeitig als Wandelprozess und Arena der Bedeutungsaushandlung unter Einschluss impliziter Machtmechanismen konzipiert wird. Als erster Absatz des Unterkapitels liefert er damit das theoretische Fundament, auf dem die nachfolgende Argumentation aufbauen kann, warum kulturelle Orientierungsangebote in der Schule bedeutsam werden.

*Codes:*
- **Kulturelle Routinen: Ermöglichung und Begrenzung** — Die zentrale argumentative Pointe des Absatzes ist die Doppelwirkung kultureller Routinen — sie ermöglichen Handlungssicherheit und begrenzen zugleich das Repertoire, was die gesamte nachfolgende Argumentation für Professionalitätsanforderungen fundiert.
- **Arena der Aushandlung von Bedeutungen** — Kultur wird nicht als statisches Traditionsreservoir, sondern als prozessualer Aushandlungsraum mit impliziten Machtmechanismen konzipiert, was den gesellschaftlichen Problemzusammenhang markiert, den die Arbeit adressiert.

**sonnet-4-6**

> Der Absatz etabliert die kulturwissenschaftliche Rahmung der gesamten Studie und benennt Reckwitz als zentrale Referenz. Kultur wird dabei als praxeologisches Konzept entfaltet: als implizit wirksames Reservoir von Werthorizonten, das Gemeinschaft stiftet, Handlungsgewissheit erzeugt, zugleich aber Repertoires begrenzt, Ausschlüsse produziert und als Feld impliziter Machtaushandlung fungiert. Dieser doppelte Charakter von Kultur — gemeinschaftsstiftend und exklusiv zugleich, Routinegarant und Möglichkeitsraum für Neuformulierungen — wird als Einstiegsthese in das Subkapitel gesetzt und legt die analytische Folie für die nachfolgende Diskussion schulischer Kulturprozesse.

*Codes:*
- **Kultur als Reservoir impliziter Werthorizonte** — Dieser Begriff fasst den praxeologischen Kulturbegriff, auf dem die gesamte Argumentation aufbaut: Kultur wirkt nicht explizit-normativ, sondern als implizite, gemeinschaftsstiftende Orientierungsstruktur.
- **Kultur: Gemeinschaftsstiftung und Ausschluss** — Der Absatz markiert den doppelten Effekt kultureller Routinen — Handlungsgewissheit einerseits, Begrenzung und soziale Exklusion andererseits — als zentralen Problemzusammenhang, der die normative Stoßrichtung der Studie grundiert.

**opus-4.7**

> Der Absatz verortet den Argumentationsgang kulturwissenschaftlich mit Referenz auf Reckwitz und entfaltet ein Kulturverständnis, das Kultur als implizites, gemeinschaftsstiftendes Reservoir von Werthorizonten fasst, das Handlungsgewissheit ermöglicht, zugleich aber Handlungsrepertoires begrenzt und Ausschlüsse perpetuiert. Als erster Absatz des Unterkapitels etabliert er damit die theoretische Lesefolie — Kultur als ambivalenter Prozess von Routine und Wandlung, Aushandlungsarena mit impliziten Machtmechanismen —, auf der die Bedeutung kultureller Orientierungsangebote in Schule in den folgenden Absätzen entwickelt werden soll.

*Codes:*
- **Kultur als Aushandlungsarena von Bedeutungen** — Verdichtet die praxeologisch-kulturwissenschaftliche Kernbestimmung von Kultur, die der gesamten Argumentation als theoretische Referenz dient.
- **Doppeleffekt kultureller Routinen** — Zentrale These des Absatzes: Kultur ermöglicht Handlungsgewissheit und begrenzt zugleich das Handlungsrepertoire — diese Ambivalenz trägt die weitere Argumentation.

**deepseek-v4-pro**

> Der Absatz etabliert eine kulturwissenschaftliche Perspektive auf schulische Kultur, die Kultur als Reservoir impliziter Werthorizonte und Gemeinschaftskonstitution fasst. Er betont den doppelten Effekt von Routinen – Handlungsgewissheit und Begrenzung – und profiliert Kultur im Anschluss an Reckwitz und Bhabha als prozessuale Arena der Bedeutungsaushandlung, die implizite Machtmechanismen einschließt. Als Eingangspassage des Unterkapitels legt er die theoretische Grundlage und die zentralen Spannungslinien, die die anschließende Argumentation tragen.

*Codes:*
- **Kultur als Reservoir von Werthorizonten** — Verdichtet die kulturwissenschaftliche Auffassung, dass Kultur implizite Wertbestände bereitstellt, die Gemeinschaften konstituieren.
- **Kultur als Arena der Aushandlung von Bedeutungen** — Markiert den prozessualen, machtbesetzten Charakter kultureller Praxis als kontinuierliche Neuverhandlung von Sinn.

---

## 2. Argumentation graph — §1 of 1.1.1

**mimo-v2.5-pro** (3 args, 2 edges, 3 scaffolding)

- **A1** [stated] Eine kulturwissenschaftliche Perspektive mit besonderem Bezug auf die Theorie von Reckwitz bildet die Grundlage des vorliegenden Arguments.
  - _stated:_ none
- **A2** [stated+stated+stated+stated] Kulturwissenschaftliche, praxeologische Ansätze in der Schulforschung bieten einen Mehrwert, weil sie kulturelle Dimensionen sichtbar machen und so Gemeinschaften sowie ihre Grenzen und Ausschlüsse, aber auch Wandel und Bedeutungsaushandlungen erkennbar werden lassen.
  - _stated:_ Kulturwissenschaftlich geformte Ansätze praxeologischer Forschung in Schule und Unterricht verweisen auf den Mehrwert, der mit einer Perspektivierung entlang kultureller Dimensionen verbunden ist.
  - _stated:_ Mit ihnen werden Ausprägungen kultureller Prozesse sichtbar: Kultur kommt dabei als Reservoir von Werthorizonten in den Blick, die Gemeinsamkeiten und Gemeinschaften konstituieren.
  - _stated:_ Dies hat einen doppelten Effekt: ... ermöglicht ... Handlungsgewissheit ... begrenzt ... das Handlungsrepertoire. Auf diese Weise perpetuiert Kultur ... auch Abgrenzungen und Ausschlüsse.
  - _stated:_ Kultur ist ... auch ein Prozess der Wandlung, sie bietet einen Möglichkeitsraum für Neuformulierungen ... die Arena der Aushandlung von Bedeutungen.
- **A3** [stated+stated] Kultur, verstanden als gemeinschaftsstiftendes und sich wandelndes Element, verweist auf einen gesellschaftlichen Problemzusammenhang.
  - _stated:_ Kultur perpetuiert ... Abgrenzungen und Ausschlüsse.
  - _stated:_ Kultur ... ist ... ein Prozess der Wandlung, sie bietet einen Möglichkeitsraum für Neuformulierungen ... als solche implizite Machtmechanismen einschließt.

*Scaffolding:*
- **S1** [kontextualisierend] Konkretisierung des theoretischen Fundaments (A1) durch Nennung von Reckwitz und Querverweisen auf andere Buchabschnitte.
  - excerpt: "Dem vorliegenden Argumentationsgang liegt eine kulturwissenschaftliche Perspektivierung mit einer besonderen Referenz auf die Theorievorschläge von Reckwitz (Reckwitz, 2004; Reckwitz, 2017; vgl. auch 1.2.1) zugrunde."
  - assessment: Wirksam für A1, da sie die abstrakte "kulturwissenschaftliche Perspektive" durch einen konkreten Theoretiker und interne Verweise füllt.
- **S2** [didaktisch] Illustration der abstrakten Behauptung über sichtbare kulturelle Prozesse (A2) mit konkreten schulischen Beispielen.
  - excerpt: "Dies gilt beispielsweise für das Zeitregime von Schule, Routinen unterrichtlicher Interaktion oder organisationale und schulkulturelle Arrangements."
  - assessment: Klär wirksam, macht den sonst theoretischen Anspruch (A2) im Alltagsbezug der Schule nachvollziehbar.
- **S3** [textorganisatorisch] Übergangssatz, der die vorherige Analyse kultureller Wirkungen (A2) zur Schlussfolgerung (A3) bündelt und eine Brücke zum nächsten Argument schlägt.
  - excerpt: "Damit verweist sie auf einen gesellschaftlichen Problemzusammenhang."
  - assessment: Wirksam als Strukturmarker, führt die Argumentation von der deskriptiven Analyse zur normativ-problemorientierten Konsequenz über.

**sonnet-4-6** (5 args, 5 edges, 5 scaffolding)

- **A1** [stated+stated+background] Eine kulturwissenschaftliche Perspektivierung — insbesondere nach Reckwitz — ermöglicht es, kulturelle Prozesse in Schule und Unterricht als implizit wirksame Werthorizonte sichtbar zu machen, die Gemeinsamkeiten und Gemeinschaften konstituieren.
  - _stated:_ Kulturwissenschaftlich geformte Ansätze praxeologischer Forschung verweisen auf den Mehrwert einer Perspektivierung entlang kultureller Dimensionen.
  - _stated:_ Kultur kommt als Reservoir von Werthorizonten in den Blick, die Gemeinsamkeiten und Gemeinschaften konstituieren, zumeist implizit.
  - _background:_ Reckwitz' kulturwissenschaftlich-praxeologischer Ansatz ist in der erziehungswissenschaftlichen Schulforschung als legitimes theoretisches Bezugssystem etabliert.
- **A2** [stated+stated] Kulturelle Routinen in Schule erzeugen einen doppelten Effekt: Sie stiften Handlungsgewissheit durch routinierte Gemeinschaft, begrenzen aber zugleich das individuelle Handlungsrepertoire.
  - _stated:_ Routinierte Gemeinschaft ermöglicht Handlungsgewissheit; gleichzeitig wird durch sie das Handlungsrepertoire für den Einzelnen begrenzt.
  - _stated:_ Dies gilt beispielsweise für das Zeitregime von Schule, Routinen unterrichtlicher Interaktion oder organisationale und schulkulturelle Arrangements.
- **A3** [stated+background] Kultur perpetuiert als gemeinschaftsstiftendes Element soziale Abgrenzungen und Ausschlüsse, da sie Handlungsrepertoires einschränkt.
  - _stated:_ Das Handlungsrepertoire wird für den Einzelnen durch routinierte Gemeinschaft begrenzt.
  - _background:_ Soziale Ausschlüsse sind eine strukturelle Folge von Mechanismen, die Zugehörigkeit durch Abgrenzung definieren — eine in der Kultursoziologie (u.a. Bourdieu, Reckwitz) verbreitete Annahme.
- **A4** [stated+stated+background] Kultur ist nicht nur Tradierung, sondern auch Prozess der Wandlung: Sie bietet einen Möglichkeitsraum für Neuformulierungen (Bhabha) und ist zugleich Arena der Aushandlung von Bedeutungen (Reckwitz), die implizite Machtmechanismen einschließt.
  - _stated:_ Kultur ist in der Wiederholung tradierter Routinen auch ein Prozess der Wandlung und bietet einen Möglichkeitsraum für Neuformulierungen (Bhabha, 2010).
  - _stated:_ In ihrer Prozesshaftigkeit ist Kultur die Arena der Aushandlung von Bedeutungen (Reckwitz 2003), die implizite Machtmechanismen einschließt.
  - _background:_ Bhabhas Konzept des 'dritten Raums' und Reckwitz' praxeologische Kulturtheorie gelten in kulturwissenschaftlichen Bildungsdiskursen als kompatible, wenn auch nicht deckungsgleiche Bezugsrahmen.
- **A5** [stated] Kultur verweist durch ihre Verbindung von Gemeinschaftsstiftung, Ausschluss, Wandlungspotenzial und Machtmechanismen auf einen gesellschaftlichen Problemzusammenhang.
  - _stated:_ Kultur schließt als Arena der Bedeutungsaushandlung implizite Machtmechanismen ein.

*Scaffolding:*
- **S1** [textorganisatorisch] Eröffnungsmarkierung des gesamten Unterkapitels: benennt den theoretischen Referenzrahmen (Reckwitz) und verankert ihn durch Querverweise auf Unterkapitel 1.2.1, ohne selbst argumentativ zu werden. Rahmt A1–A5.
  - excerpt: "Dem vorliegenden Argumentationsgang liegt eine kulturwissenschaftliche Perspektivierung mit einer besonderen Referenz auf die Theorievorschläge von Reckwitz (Reckwitz, 2004; Reckwitz, 2017; vgl. auch 1.2.1) zugrunde."
  - assessment: Klar wirksam als Orientierungsmarker: Lesende wissen von Beginn an, welcher Theorierahmen das Argument trägt. Der bloße Verweis auf Unterkapitel 1.2.1 ist jedoch für sich genommen schwach — er setzt voraus, dass die dortige Reckwitz-Rezeption tragfähig war; ohne diesen Kontext bleibt A1 teilweise ungestützt.
- **S2** [textorganisatorisch] Querverweis auf Unterkapitel 1.2.3, der die Behauptung des 'Mehrwerts' kulturwissenschaftlich-praxeologischer Perspektivierung (A1) durch vorangehende Ausführungen absichern soll.
  - excerpt: "vgl. 1.2.3"
  - assessment: Bedingt plausibel: Der Verweis delegiert die Begründungslast an ein anderes Kapitel, ohne sie im aktuellen Absatz einzulösen. Für A1 ist er dadurch nur indirekt stützend — der claim bleibt im aktuellen Absatz ohne eigenständige Begründung des 'Mehrwerts'.
- **S3** [didaktisch] Exemplarische Konkretisierung des abstrakten Begriffs 'kulturelle Prozesse in Schule' (A1) und der Claim-Grundlage von A2: benennt drei schulpraktische Instanzen impliziter Werthorizonte.
  - excerpt: "Dies gilt beispielsweise für das Zeitregime von Schule, Routinen unterrichtlicher Interaktion oder organisationale und schulkulturelle Arrangements."
  - assessment: Wirksam für die Verständlichkeit von A1 und A2: Die Beispiele machen das Abstraktum 'Werthorizonte' anschaulich und schulspezifisch greifbar. Wissenschaftlich bleibt die Auswahl der drei Instanzen jedoch unbegründet — es handelt sich um illustrative, nicht argumentativ gesättigte Setzungen.
- **S4** [kontextualisierend] Einbettung von A4 (Wandlungspotenzial der Kultur) in Bhabhas Theoriekonzept; der Quellenbeleg soll den claim über Kulturwandel durch Wiederholung theoretisch legitimieren.
  - excerpt: "Möglichkeitsraum für Neuformulierungen (Bhabha, 2010)"
  - assessment: Bedingt plausibel: Bhabha (2010) — vermutlich 'Die Verortung der Kultur' — wird ohne Begriffspräzisierung (kein Bezug auf 'Third Space', 'Hybridität' o.ä.) eingeführt. Der Beleg stützt A4 nur oberflächlich; die Verbindung zu Reckwitz' Bedeutungsaushandlung (A4) wird nicht explizit hergestellt, obwohl beide Referenzen in einem Atemzug nebeneinandergestellt werden.
- **S5** [kontextualisierend] Quellenbeleg für A4: Reckwitz 2003 wird als Autorität für das Konzept der Bedeutungsaushandlung angeführt und um die Machtdimension ergänzt.
  - excerpt: "die Arena der Aushandlung von Bedeutungen (Reckwitz 2003), die als solche implizite Machtmechanismen einschließt"
  - assessment: Wirksam für A4, jedoch textuell komprimiert: Die Machtdimension ('implizite Machtmechanismen') wird als Zusatz eingeführt, ohne dass Reckwitz 2003 selbst explizit für diese Erweiterung zitiert wird. Es bleibt unklar, ob die Machtthese aus Reckwitz stammt oder eine autorenseitige Ergänzung ist — das schwächt die argumentationslogische Sauberkeit.

**opus-4.7** (6 args, 6 edges, 6 scaffolding)

- **A1** [stated] Die Argumentation der Arbeit stützt sich auf eine kulturwissenschaftliche Perspektive, insbesondere auf Reckwitz' Theorievorschläge.
  - _stated:_ Dem Argumentationsgang liegt eine kulturwissenschaftliche Perspektivierung mit besonderer Referenz auf Reckwitz (2004, 2017) zugrunde.
- **A2** [stated+stated+background] Eine praxeologisch-kulturwissenschaftliche Perspektivierung auf Schule und Unterricht erzeugt einen analytischen Mehrwert, weil sie kulturelle Prozesse als ansonsten zumeist implizit bleibende Werthorizonte sichtbar macht.
  - _stated:_ Praxeologisch-kulturwissenschaftliche Ansätze verweisen auf den Mehrwert einer Perspektivierung entlang kultureller Dimensionen.
  - _stated:_ Mit ihnen werden Ausprägungen kultureller Prozesse sichtbar; Kultur erscheint als Reservoir von Werthorizonten, die Gemeinsamkeit und Gemeinschaft zumeist implizit konstituieren.
  - _background:_ Praxeologische Forschung operiert mit der Annahme, dass soziale Praxis wesentlich durch implizite, körper- und routinegebundene Wissensbestände strukturiert ist.
- **A3** [stated+stated] Kulturell geformte Routinen in Schule (Zeitregime, unterrichtliche Interaktion, schulkulturelle Arrangements) haben einen ambivalenten Doppeleffekt: Sie ermöglichen Handlungsgewissheit, begrenzen aber zugleich das individuelle Handlungsrepertoire.
  - _stated:_ Zeitregime von Schule, Routinen unterrichtlicher Interaktion und organisationale/schulkulturelle Arrangements sind Beispiele impliziter kultureller Werthorizonte.
  - _stated:_ Einerseits ermöglicht routinierte Gemeinschaft Handlungsgewissheit, andererseits begrenzt sie das Handlungsrepertoire des Einzelnen.
- **A4** [carried+stated+stated] Kultur als gemeinschaftsstiftendes Element produziert zugleich Abgrenzungen und Ausschlüsse und impliziert damit Machtmechanismen.
  - _carried:_ Kultur konstituiert implizit Gemeinsamkeiten und Gemeinschaft über geteilte Werthorizonte.
  - _stated:_ Kultur perpetuiert als gemeinschaftsstiftendes Element auch Abgrenzungen und Ausschlüsse.
  - _stated:_ Als Arena der Aushandlung von Bedeutungen schließt Kultur implizite Machtmechanismen ein.
- **A5** [stated+background] Kultur ist nicht nur Reproduktion, sondern in der Wiederholung tradierter Routinen zugleich ein Prozess der Wandlung, der einen Möglichkeitsraum für Neuformulierungen eröffnet.
  - _stated:_ Kultur ist in der Wiederholung tradierter Routinen auch ein Prozess der Wandlung und bietet einen Möglichkeitsraum für Neuformulierungen (Bhabha 2010).
  - _background:_ Bhabhas Konzept des Dritten Raums/der Hybridität fasst kulturelle Wiederholung als Ort produktiver Verschiebung.
- **A6** [stated] Weil Kultur Gemeinschaft stiftet, Ausschlüsse produziert, Machtmechanismen einschließt und zugleich Wandlung ermöglicht, verweist sie auf einen gesellschaftlichen Problemzusammenhang, der analytisch zu bearbeiten ist.
  - _stated:_ Damit verweist [Kultur] auf einen gesellschaftlichen Problemzusammenhang.

*Scaffolding:*
- **S1** [kontextualisierend] Quellenverweis und interner Rückverweis, der A1 (die theoretische Grundlegung bei Reckwitz) mit dem späteren Theoriekapitel 1.2.1 verklammert.
  - excerpt: "(Reckwitz, 2004; Reckwitz, 2017; vgl. auch 1.2.1)"
  - assessment: klar wirksam — verortet A1 im Werkaufbau und macht die Theorieentscheidung nachvollziehbar, ohne sie hier ausführen zu müssen.
- **S2** [textorganisatorisch] Interner Vorverweis, der die in A2 behauptete Leistungsfähigkeit praxeologisch-kulturwissenschaftlicher Ansätze an die spätere ausführliche Darstellung in 1.2.3 delegiert.
  - excerpt: "(vgl. 1.2.3)"
  - assessment: bedingt plausibel — der behauptete 'Mehrwert' wird hier nicht belegt, sondern auf später verschoben; die Stützfunktion ist organisatorisch tragfähig, argumentativ aber entlastend.
- **S3** [didaktisch] Beispielssetzung für A2 und A3 — konkretisiert die abstrakte Rede von impliziten Werthorizonten an schulbezogenen Feldern.
  - excerpt: "Dies gilt beispielsweise für das Zeitregime von Schule, Routinen unterrichtlicher Interaktion oder organisationale und schulkulturelle Arrangements."
  - assessment: klar wirksam — macht die Abstraktion von A2/A3 an feldspezifischen Instanzen fassbar und bereitet den Doppeleffekt-Gedanken vor.
- **S4** [kontextualisierend] Autoritätsverweis, der die Behauptung des kulturellen Möglichkeitsraums in A5 an Bhabhas Theorie anbindet.
  - excerpt: "(Bhabha, 2010)"
  - assessment: rhetorisch wirksam, sachlich dünn — die Bhabha-Referenz bleibt punktuell und wird nicht entfaltet; sie markiert die Denktradition, trägt A5 aber nur durch Autorität, nicht durch Rekonstruktion.
- **S5** [kontextualisierend] Quellenverweis, der die Rede von Kultur als 'Arena der Aushandlung von Bedeutungen' — Bestandteil der Begründung von A4 — an Reckwitz anbindet.
  - excerpt: "(Reckwitz 2003)"
  - assessment: klar wirksam im Sinne theoretischer Rückbindung; stützt die Machtdimension von A4 diskurstheoretisch, ohne die These selbst zu leisten.
- **S6** [textorganisatorisch] Abschließender Übergangssatz, der die vorangegangenen Argumente A3–A5 in A6 bündelt und den Anschluss an die folgende Problemexposition vorbereitet.
  - excerpt: "Damit verweist sie auf einen gesellschaftlichen Problemzusammenhang."
  - assessment: rhetorisch wirksam, sachlich schwach — der 'gesellschaftliche Problemzusammenhang' wird hier nicht ausgeführt, sondern als Scharnier gesetzt; trägt Übergangsfunktion, lässt A6 aber inhaltlich unterbestimmt.

---

## 3. Chapter 1 collapse — full output

### mimo-v2.5-pro

**Synthese (2752 chars):**

> Das erste Hauptkapitel entfaltet eine dreistufige Trichterbewegung von der phänomenologisch-kulturtheoretischen Diagnose kultureller Komplexität in der Schule (L2 1.1) über die begriffliche Fundierung von Kultur und Globalität (L2 1.2) hin zur institutionellen Applikation und professionstheoretischen Verdichtung (L2 1.3). Die argumentative Kernbewegung des Gesamtkapitels liegt im Übergang von L2 1.2 zu L2 1.3, also von der theoretischen Konzeptarbeit zur normativ-handlungsorientierten Diagnose: Was in 1.1 als Problemdiagnose formuliert und in 1.2 begrifflich geschärft wird, wird in 1.3 auf Schule und Lehrkräfteprofessionalität appliziert und im Übergang von 1.3.2 zu 1.3.3 — insbesondere in der Umformulierung des Ungewissheitsbegriffs zur globalitätskonstitutiven, habituell-biographischen Größe (1.3.3 §4:A7) — zu einer eigenen theoretischen Akzentuierung verdichtet; dies ist der strukturell tragendste Übergang des gesamten Kapitels und die einzige Stelle, an der das Kapitel über Rekonstruktion und Bündelung hinaus in eigenständige Positionierung übergeht. Werk-architektonisch ist dieses Kapitel als theoretisch-analytischer Rahmen konzipiert, der die gesamte nachfolgende Arbeit tragen soll: Es gibt keinen Vorgänger, bereitet aber sowohl die empirische Studie der Orientierungen von Lehramtsstudierenden (Kapitel 2) als auch die theoriebildende Synthese (Kapitel 4) vor, indem es die Leitbegriffe (Kultur, Globalität, Ungewissheit, professioneller Habitus) und die Problemfigur (Schule als selbstreflexiver Ort kulturellen Lernens unter Globalitätsbedingungen) installiert. Die argumentative Tragweite ist insofern weitreichend, als das Kapitel den gesamten begrifflichen und diagnostischen Rahmen des Werkes setzt — keine feldweite Neusetzung etablierter Theorien, aber eine werkssystematisch zentrale Bündelung kulturwissenschaftlicher (Reckwitz), systemtheoretischer (Scheunpflug), professionstheoretischer (Helsper, Budde) und globalitätstheoretischer Referenzen zu einer eigenen Konfiguration. Die Stützung durch die sieben Subkapitel ist jedoch ungleichmäßig: Die begrifflichen Fundierungen in L2 1.2 operieren teils listenförmig-assertiv statt herleitend (fünfgliedrige Kulturbestimmung in 1.2.1 §5:A1, unreflektierte Priorisierung in 1.2.1 §6:A3), die normativ-pointierten Applikationen in L2 1.3 setzen zentrale Weichenstellungen statt sie zu begründen (Ethik auf Distanz in 1.3.2 §7:A7, Ungleichheitsdiagnose in 1.3.3 §6), und über alle drei L2-Gruppen hinweg zeigt sich ein konsistentes Muster der Verschiebung von Beleglast in spätere Kapitel — das Kapitel trägt seinen Anspruch als Rahmung und Programmweichenstellung, aber es delegiert die substantielle Einlösung seiner Kernbehauptungen systematisch an die Folgekapitel.

**Argumentationswiedergabe (3227 chars):**

> Das erste Hauptkapitel entfaltet in drei aufeinander aufbauenden Abschnitten den theoretischen, diagnostischen und professionsbezogenen Rahmen der Arbeit. Der erste Abschnitt (L2 1.1) leitet aus einer praxeologisch-kulturwissenschaftlichen Bestimmung von Kultur als ambivalentem Routinenreservoir und Wandlungsraum die These ab, dass Schule unter Bedingungen pluralisierter kultureller Ordnungen ein analytisch-reflexiv zu bewältigendes Handlungsfeld darstellt. Aus der Einsicht, dass kulturelle Vielfalt nur distinkt-partikular vermittelt werden kann, folgert das Kapitel, dass Professionalität im reflexiven Verhältnis zur eigenen Partikularität und Kontingenz bestehen muss, und formuliert programmatisch: Lehrkräftebildung ist als kulturelle Bildung zu konzipieren.
>
> Der zweite Abschnitt (L2 1.2) liefert die begrifflichen Grundlagen in zwei Schritten. Zunächst wird ein kulturwissenschaftlich-praxeologischer Kulturbegriff in fünf Merkmalen bestimmt und normativ-analytisch dahingehend akzentuiert, dass implizite kulturelle Normierungen gegenüber werkhaft-ästhetischen Aspekten Priorität besitzen; Transkulturalität und relationale Kulturbestimmung werden als Gegenpositionen zu kulturalisierenden Essentialisierungen eingeführt. Anschließend wird Globalität als zweiter systematischer Bezugspunkt anhand von Scheunpflugs Vier-Dimensionen-Systematik (sachlich, räumlich, zeitlich, sozial) entfaltet, historisch-kolonial kontextuiert, identitätstheoretisch vertieft und in der Spannung von Weltgesellschaft und Weltgemeinschaft als Bearbeitungshorizont bestimmt; bildungspolitisch wird die Weltbildungsagenda (SDGs, UNESCO, Dublin-Erklärung) als institutionelle Antwort eingeholt. Der Übergang zwischen beiden Begriffsarbeiten wird über Reckwitz' These eines sich verhärtenden Antagonismus zwischen kultureller Singularität und Globalität hergestellt.
>
> Der dritte Abschnitt (L2 1.3) überführt die gewonnenen Begriffe in die institutionelle Ebene. Unter Rückgriff auf die transnationale Konstitutionsgeschichte nationaler Schulsysteme und das aufklärungstheoretische Erbe der Zukunftsoffenheit wird das Verhältnis von Schule und Kultur als unter verschärften Globalitätsbedingungen revisionsbedürftig markiert. Eine systematische Befragung der vier Sinndimensionen der Globalität auf ihr bildungsbezogenes Herausforderungspotential führt zur Generalthese einer durchgängig kontingenzdurchwobenen kulturellen Bildung und zur Forderung einer 'Ethik auf Distanz'. Abschließend werden die Anforderungen an die Professionalität von Lehrkräften in einer trichterförmigen Bewegung entfaltet: von der diskursiven Sondierung etablierter Professionalitätsbestimmungen über die Einführung dreier Professionalitätsfamilien und die eigentliche theoretische Akzentuierung — die Erweiterung des Ungewissheitsbegriffs von bloßer Wirksamkeitsungewissheit zu einer habituell-biographisch verankerten, globalitätskonstitutiven Größe — bis hin zu einer integrierten Anforderungsformel, die Schule als selbstreflexiven Ort kulturellen Lernens in vier Sinndimensionen bestimmt. Die internationalen Anschlusskonzeptionen (Global Teacher Education) werden eingeholt, bevor die Übergänge zur empirischen und theoriebildenden Arbeit eröffnet werden.

**Auffälligkeiten (7):**

- **`1.2.1 §5:A1`** — Die fünfgliedrige Merkmalsbestimmung des Kulturbegriffs — das begrifflich-theoretische Herzstück des gesamten Kapitels, auf das zahlreiche cross-paragraph-Edges über das gesamte Kapitel zurückbinden — wird nur listenförmig behauptet, ohne dass Auswahl oder Ableitung argumentativ ausgewiesen würden. Für einen Definitionskern, der den gesamten nachfolgenden Arbeits- und Argumentationsrahmen tragen soll, ist dies eine strukturell gewichtige Begründungslücke.
- **`Kapitel-übergreifend (1.1.1–1.3.3)`** — Über alle drei L2-Gruppen hinweg zeigt sich ein konsistentes Muster: Programmatische Scharnier-Absätze am Ende jedes Subkapitels (1.1.2 §3, 1.2.1 §13, 1.2.2 §13, 1.3.2 §9, 1.3.3 §10/§12) sind jeweils auf ein bis zwei Argumente beschränkt und verlagern die Einlösung der Anschlussbehauptung explizit in Folgekapitel. Dies ist als werkarchitektonisches Muster funktional, bedeutet aber, dass das Kapitel auf seinen Übergängen durchgehend dünn besetzt ist und keine Brücke argumentativ vollständig gebaut wird.
- **`Kapitel-übergreifend (1.2.1 §6:A3, 1.3.2 §7:A7, 1.3.3 §6)`** — An den drei normativ schwerstgewichtigen Stellen des Kapitels — die Priorisierung impliziter Normierungen über ästhetische Kulturaspekte (1.2.1), die Setzung einer 'Ethik auf Distanz' als unhintergehbar (1.3.2), und die Gerechtigkeits-/Ungleichheitsdiagnose kultureller Professionalität (1.3.3) — operiert die Argumentation durchgehend setzend statt herleitend. Das Verhältnis von normativem Anspruch und argumentativer Stützung ist an diesen Stellen durchgängig unterdimensioniert.
- **`1.2.1 §11`** — Die werkstrategisch zentrale Einführung des Reckwitz'schen Antagonismus als pädagogisch anschlussfähige Zeitdiagnose wird durch undifferenzierte Flankierung von Huntington und Reckwitz gestützt, obwohl beide kulturtheoretisch erheblich divergieren. Da diese Passage das Scharnier zu 1.2.2 Globalität bildet und die Zeitdiagnose das gesamte Folgekapitel rahmt, wiegt die fehlende Differenzierung besonders.
- **`1.3.3 §4:A7`** — Die einzige erkennbare Eigenleistung des Kapitels über Rekonstruktion und Bündelung hinaus — die Umformulierung des Ungewissheitsbegriffs zur globalitätskonstitutiven, habituell-biographischen Größe — wird in einem einzigen Satz mit einer einzigen nur bedingt wirksamen Stütze vollzogen. Der strukturell gewichtigste Übergang des gesamten Kapitels ist argumentativ auffällig schmal abgesichert.
- **`1.3.3 §7`** — Der Absatz baut eine sechsstufige Deduktionskette auf, die zentrale zeitdiagnostische Setzungen (darunter die 'große Transformation') als Prämissen einführt, ohne eine einzige kontextualisierende Stützstruktur — eine bemerkenswerte Eigenart in einem Abschnitt, der die gesamte nachfolgende Anforderungsarchitektur mitträgt.
- **`1.3.2 §8:S4`** — An einer argumentativ tragenden Stelle — der Anschlussfähigkeit zwischen kultureller Bildung und Globalem Lernen/GCE/BNE — wird eine Selbstbeleg-Konkretisierung der anti-kulturalistischen Bildungsperspektive eingesetzt, deren Tragfähigkeit an der im Kapitel nicht eigens entfalteten eigenen Vorarbeit hängt.

### opus-4.7 (baseline)

**Synthese (2275 chars):**

> Das Hauptkapitel entfaltet in drei L2-Gruppen eine kumulative theoretische Grundlegung, die von der schulbezogenen Problemdiagnose (1.1) über die begriffliche Fundierung der beiden Leitbegriffe Kultur und Globalität (1.2) zur professionstheoretischen Engführung (1.3) fortschreitet; die argumentative Architektur ist trichterförmig, wobei jede Gruppe die Begründungsanforderungen der vorangehenden aufnimmt und in die nachfolgende überführt. Die Kernbewegung des Hauptkapitels liegt am Übergang von 1.2.2 zu 1.3: Nachdem Kultur (zentral §5:A1 und §6:A3 in 1.2.1) und Globalität (zentral die Scheunpflug'sche Vier-Dimensionen-Systematik in 1.2.2) als analytische Raster etabliert sind, wird in 1.3.2/1.3.3 aus ihrer seriellen Applikation auf Schule und Professionalität eine integrierte normative Anforderungsstruktur erzeugt — kulminierend in §4:A7 von 1.3.3 (Ungewissheit als globalitätskonstitutive habituell-biographische Größe), wo die referierende Diskursarbeit erstmals in eine eigene theoretische Akzentuierung umschlägt. Das Kapitel trägt damit die systematische Brückenlast: es nimmt keine vorausgegangenen Hauptkapitel auf (Position 1/4), bereitet jedoch für das empirische Kapitel 2 den theoretischen Bezugsrahmen (kulturelle Orientierungen, Ungewissheit, Sinndimensionen) vor, auf den die Rekonstruktion studentischer Orientierungen dann zugreifen kann. Die Tragweite ist werksystematisch fundamental und von programmatischem Anspruch — das Kapitel soll den theoretischen Grundriss für eine Theorie kultureller Lehrkräftebildung legen —, die Stützung ist für diesen Anspruch jedoch durchgängig unterdimensioniert: tragende Setzungen (fünfgliedrige Kulturmerkmale in 1.2.1, Vier-Dimensionen-Systematik in 1.2.2, Ungewissheitserweiterung in 1.3.3:§4:A7, Sinndimensionen-Matrix in 1.3.3:§8:A4) werden gelistet, benannt oder referenziert, aber nicht hergeleitet, und die Begründungslast wird wiederholt auf Referenzautoren (Reckwitz, Scheunpflug, Helsper) und auf Folgekapitel verlagert. Die Stützung ist damit als kumulative Rahmung tragfähig, als Begründung der Eigenleistung aber schmal — das Kapitel leistet eine kohärente Bündelung etablierter Diskurse zu einer arbeitsfähigen Problemfigur, aber keine eigenständige theoretische Neusetzung auf Hauptkapitelebene.

**Argumentationswiedergabe (3040 chars):**

> Das Kapitel entfaltet in drei Schritten den theoretischen Grundriss der Arbeit. In einem ersten Schritt (1.1) wird Schule als kulturell durchwobenes Handlungsfeld unter Globalitätsbedingungen bestimmt: Kultur erscheint zugleich als Routinenreservoir und Wandlungsraum, das geschlossene Enkulturationsmodell der Schule gilt unter Bedingungen kultureller Pluralisierung als aufgebrochen, und das Anstoßen kultureller Bildungsprozesse wird als analytisch-reflexiv zu bewältigendes Handlungsfeld bestimmt. Daraus wird die professionstheoretische Folgerung abgeleitet, dass Lehrkräfte als kulturelle Bildungsakteure verstanden werden müssen, deren Professionalität in einem reflexiven Verhältnis zur eigenen Partikularität und Kontingenz besteht, und es wird programmatisch formuliert, Lehrkräftebildung insgesamt als kulturelle Bildung zu konzipieren.
>
> In einem zweiten Schritt (1.2) werden die beiden Leitbegriffe Kultur und Globalität begrifflich fundiert. Unter Rekurs auf kulturwissenschaftliche Positionen (insbesondere Reckwitz) wird ein praxeologisch-kulturwissenschaftlicher Kulturbegriff in fünf Merkmalen bestimmt, gegen essentialisierende Interkulturalitätsbegriffe abgegrenzt, um Transkulturalität und Relationalität erweitert und durch die Priorisierung impliziter Normierungen gegenüber dem werkhaft-ästhetischen Kulturaspekt normativ-analytisch zugespitzt; abschließend wird der Reckwitz'sche Antagonismus als pädagogisch bearbeitungsbedürftige Zeitdiagnose installiert. Globalität wird im Anschluss an Scheunpflug entlang vier erziehungswissenschaftlicher Zugänge und vier Sinndimensionen (sachlich, räumlich, zeitlich, sozial) systematisiert, historisch-kolonial kontextualisiert, identitätstheoretisch (Nancy/Cioflec) vertieft, im Spannungsverhältnis Weltgesellschaft/Weltgemeinschaft strukturell zugespitzt und bildungspolitisch (SDGs, UNESCO, Dublin-Erklärung) konkretisiert.
>
> In einem dritten Schritt (1.3) werden diese Bestimmungen auf Schule und Lehrkräfteprofessionalität bezogen. Die Figur 'Schule und Kultur' wird als unter verschärften Kontingenz- und Komplexitätsbedingungen revisionsbedürftiges Dilemma eingeführt. Anschließend wird Bildung als kulturelle Bildung unter Globalität durch serielle Applikation der vier Sinndimensionen befragt, wobei die Diagnose in der These einer durchgängig kontingenzdurchwobenen Bildung und einer unhintergehbaren 'Ethik auf Distanz' kulminiert; die Anschlussfähigkeit an Globales Lernen, Global Citizenship Education, BNE und Menschenrechtsbildung wird hergestellt. Darauf aufbauend werden Professionalitätsanforderungen strukturtheoretisch entfaltet: die drei Professionalitätsfamilien werden geordnet, der Ungewissheitsbegriff wird zu einer habituell-biographisch verankerten, globalitätskonstitutiven Größe erweitert, und Schule wird als selbstreflexiver Ort kulturellen Lernens in vier Sinndimensionen bestimmt. Internationale Anschlusskonzeptionen (u.a. Global Teacher) werden einbezogen, und der Kapitelschluss leitet zur empirischen und theoriebildenden Hauptarbeit über.

**Auffälligkeiten (6):**

- **`1.2`** — Beide Subkapitel der L2-Gruppe 1.2 (Kultur, Globalität) ruhen je auf einer tragenden Kernsystematik (fünfgliedrige Merkmalsliste in 1.2.1, Vier-Dimensionen-Systematik in 1.2.2), die listenförmig gesetzt, aber nicht hergeleitet oder in ihrer Selektion gegenüber Alternativen begründet wird — ein strukturell paralleles Muster, das die begriffliche Grundlegung des gesamten Hauptkapitels auf einer auffällig schmalen Begründungsbasis beruhen lässt.
- **`1.2.1 §13 / 1.2.2 §13 / 1.3.2 §9 / 1.3.3 §10+§12`** — Das Hauptkapitel zeigt ein wiederkehrendes Muster minimalistischer Scharnierabsätze zwischen Subkapiteln: die Anschlussversprechen werden programmatisch gesetzt, die Einlösung wird durchgängig auf Folgekapitel verschoben. Das Muster ist architektonisch funktional, verlagert jedoch kumulativ erhebliche Begründungslast.
- **`1.3.3 §4:A7`** — Die strukturell einzige klar identifizierbare theoretische Eigenleistung des Hauptkapitels (Erweiterung des Ungewissheitsbegriffs) wird in einem einzigen Satz mit nur einer kontextualisierenden Stütze vollzogen — der werksystematisch gewichtigste Übergang vom Referieren zur eigenen Akzentuierung ist argumentativ auffällig knapp gebaut.
- **`1.1 → 1.2`** — Der Übergang von der professionstheoretischen Programmformulierung (1.1.2 §3: Lehrkräftebildung als kulturelle Bildung) zur begrifflichen Fundierung in 1.2 ist systematisch stringent angelegt, wird aber nicht als expliziter argumentativer Anschluss geleistet; die Scharniergeste bleibt implizit, und die Kulturbestimmung in 1.2.1 setzt nicht sichtbar beim in 1.1.2 formulierten Desiderat an.
- **`1.3.2 §4 / 1.3.2 §6:S4 / 1.3.3 §7:A4`** — Wiederkehrendes Muster gegenwartsdiagnostischer Zuschreibungen (Fake News als 'Vermeidungsstrategie', Populismus, 'große Transformation') ohne evidenzbasierte Stützung — eine diagnostisch-rhetorische Operation, die sich durch mehrere Subkapitel zieht und die Argumentation punktuell auf appellative Register verschiebt.
- **`1.2.1 §6:A3 → 1.3.3 §6/§7`** — Die normativ-analytische Priorisierung impliziter Normierungen (1.2.1 §6:A3) ist innerhalb des Hauptkapitels der eigentliche normative Weichenstellungspunkt und wird in 1.3.3 (§6:A5, §6:A7, §7:A5) wiederaufgenommen — in beiden Fällen jedoch rhetorisch gesetzt statt argumentativ entfaltet; ein durchgängiger normativer Argumentationsstrang ist erkennbar, aber auf seiner gesamten Länge unterdimensioniert gestützt.

### deepseek-v4-pro (baseline)

**Synthese (2181 chars):**

> Das Hauptkapitel etabliert die theoretische und normative Grundlage der gesamten Arbeit, indem es die Problemdiagnose einer kulturell pluralisierten und globalisierten Schule systematisch in ein professionstheoretisches Anforderungsprofil überführt. Die argumentative Architektur folgt einer trichterförmigen Bewegung: Von der bildungstheoretischen Vergewisserung kultureller Orientierungsangebote (1.1.1) und der Programmatik einer Lehrkraft als kulturellem Bildungsakteur (1.1.2) über die kultur- und globalitätstheoretische Grundlegung (1.2) bis zur schulbezogenen Konkretion und professionstheoretischen Bündelung (1.3). Die Kernbewegung des Kapitels liegt dabei im Umschlag von der deskriptiven Diagnose kultureller und globaler Kontingenz in eine normative Bearbeitungsanforderung, die in der Forderung gipfelt, Lehrerbildung als kulturelle Bildung zu konzipieren – diese Bewegung wird vor allem in 1.1.2 und 1.3.3 programmatisch gebündelt und durch die theoretischen Subkapitel 1.2.1 und 1.2.2 begrifflich unterfangen. Werk-architektonisch fungiert das Kapitel als erster von vier Hauptteilen und legt das konzeptuelle Fundament, auf das die nachfolgenden empirischen (Kap. 2), reflexiven (Kap. 3) und theoriebildenden (Kap. 4) Teile als gemeinsamen Bezugspunkt zurückgreifen; es erfüllt somit eine tragende Brückenfunktion ins Gesamtwerk. Die argumentative Tragweite ist hoch angesichts des Anspruchs, kulturwissenschaftliche, systemtheoretische und strukturtheoretische Diskurse zu einem integrativen Modell kultureller Lehrkräftebildung zusammenzuführen. Die Tragfähigkeit der Stützung fällt jedoch hinter diesen Anspruch zurück: Zentrale Definitionskerne (die fünfgliedrige Kulturbestimmung, die Priorisierung impliziter Normierungen) und normative Setzungen (die ‚Ethik auf Distanz‘, der erweiterte Ungewissheitsbegriff) werden überwiegend gesetzt statt hergeleitet, und die Begründungslast wird systematisch auf Referenzautoren oder spätere Kapitel verschoben. Das Kapitel zeichnet sich so durch eine kohärente, aber argumentativ streckenweise unterdimensionierte Architektur aus, die stark auf programmatische Rhetorik und textorganisatorische Absicherungen vertraut.

**Argumentationswiedergabe (2422 chars):**

> Das Kapitel 1 entfaltet in drei Hauptteilen das theoretische Fundament für eine kulturelle Lehrkräftebildung. Der erste Teil (1.1) begründet die kulturelle Dimension schulischen Handelns: Ausgehend von der Einsicht, dass kulturelle Orientierungsangebote in der pluralisierten und globalisierten Gesellschaft nicht mehr als selbstverständliches Enkulturationsgut vorausgesetzt werden können (1.1.1), wird die Rolle der Lehrkraft als kulturelle Bildungsakteurin profiliert, die unvermeidlich partikular vermittelt und daher ein reflexives Verhältnis zur eigenen kulturellen Gebundenheit und zur Kontingenz pädagogischer Entscheidungen entwickeln muss (1.1.2). Der zweite Teil (1.2) legt die begrifflichen Grundlagen: Kultur wird praxeologisch-kulturwissenschaftlich als Ensemble von fünf Merkmalen bestimmt – darunter Alltäglichkeit, implizite Normierungen und materielle Dimensionen –, wobei den impliziten Normierungen und den in sie eingelassenen Macht- und Ungleichheitsverhältnissen eine besondere analytische Bedeutung zugewiesen wird (1.2.1). Globalität wird systemtheoretisch in Anlehnung an Scheunpflug in den vier Sinndimensionen des Sachlichen, Räumlichen, Zeitlichen und Sozialen entfaltet und mit postkolonialen, identitäts- und bildungspolitischen Perspektiven verknüpft (1.2.2). Der dritte Teil (1.3) führt diese beiden theoretischen Linien in der institutionellen Betrachtung von Schule zusammen: Zunächst wird das Spannungsverhältnis von Schule und Kultur in seiner historischen Gewordenheit und seiner Verschärfung unter Globalitätsbedingungen skizziert (1.3.1). Anschließend werden die vier Sinndimensionen der Globalität systematisch auf ihre bildungstheoretischen Herausforderungen für schulische kulturelle Bildung befragt; daraus wird die These abgeleitet, dass kulturelle Bildung unter Globalisierung durch eine durchgängige Kontingenz geprägt ist und einer ‚Ethik auf Distanz‘ bedarf (1.3.2). Abschließend werden diese Herausforderungen in professionstheoretische Anforderungen an Lehrkräfte übersetzt: Unter Rückgriff auf strukturtheoretische Professionalitätsmodelle wird ein erweiterter Begriff beruflicher Ungewissheit eingeführt, der habituell-biographisch verankert und globalitätstheoretisch informiert ist; kulturelle und globalitätsbezogene Anforderungen werden zu einem integrierten Profil zusammengeführt, das Lehrerbildung als selbstreflexiven kulturellen Lernprozess konzipiert (1.3.3).

**Auffälligkeiten (4):**

- **`L2 1.2`** — Die zentrale fünfgliedrige Merkmalsbestimmung des Kulturbegriffs (1.2.1) wird listenförmig behauptet und nicht hergeleitet, ebenso bleibt die theoretisch tragende Priorisierung der impliziten Normierungen (1.2.1, §6) argumentativ unausgewiesen – ein Begründungsdefizit, das den gesamten begrifflichen Unterbau betrifft und in den Folgekapiteln nicht nachgeholt wird.
- **`L2 1.2`** — Die Wahl des systemtheoretischen Vier-Dimensionen-Modells nach Scheunpflug als Ordnungsraster für Globalität (1.2.2) wird als Selektion markiert, aber nicht begründet; zudem führt die doppelte Dimensionsmarkierung in 1.3.2 (§4) zu konzeptueller Unschärfe und unterläuft die eigentlich angestrebte systematische Parallele.
- **`L3 1.3.2`** — Zentrale normative Weichenstellungen wie die ‚Ethik auf Distanz‘ (1.3.2, §7) und der erweiterte Ungewissheitsbegriff (1.3.3, §4) werden mit minimaler argumentativer Eigenleistung und weitgehend ohne unabhängige Stützstrukturen eingeführt – die Beweislast ruht damit disproportional auf präsupponierten Vorannahmen und externen Autoritäten.
- **`Gesamtkapitel`** — Im gesamten Kapitel dominiert ein Argumentationsmodus, der tragende Behauptungen durch textorganisatorische Verweise, Fußnotenappelle oder programmatische Ankündigungen absichert, während die substantielle argumentative Einlösung wiederholt in spätere Kapitel verlagert wird – dies verleiht dem Grundlegungsteil einen auffällig promissorischen Charakter.

---

## 4. H3 EXPOSITION fallback

Container: "Einleitung" (BA H3 dev, 2 ¶).
The fallback prompt asks the model to identify the actual fragestellung,
separating it from method, and to summarise the motivation in 1–3 sentences.

**mimo-v2.5-pro**

*Fragestellung* (¶ 0):
> Inwiefern fördern Bildungsprogramme im Rahmen der UNESCO-GCED das Bewusstsein für globale Probleme der Gegenwart? Ein Vergleich im Kontext der epochaltypischen Schlüsselprobleme nach Klafki

*Motivation* (¶ 0):
> In einer globalisierten Welt mit Herausforderungen wie Klimawandel, sozialer Ungleichheit und Pandemien gewinnt Bildung als gestaltende Kraft an Bedeutung. Die UNESCO hat mit der Global Citizenship Education (GCED) einen Ansatz entwickelt, der Menschen befähigen soll, globale Probleme zu verstehen und sich für eine gerechtere Welt einzusetzen. Die vorliegende Arbeit prüft, ob diese Programme tatsächlich zur Förderung eines Bewusstseins für globale Gegenwartsprobleme beitragen.

**sonnet-4-6**

*Fragestellung* (¶ 0):
> Inwiefern fördern Bildungsprogramme im Rahmen der UNESCO-GCED das Bewusstsein für globale Probleme der Gegenwart – analysiert im Vergleich mit den epochaltypischen Schlüsselproblemen nach Wolfgang Klafki?

*Motivation* (¶ 0):
> In einer globalisierten Welt stellen Krisen wie Klimawandel, soziale Ungleichheit und Kriege kollektive Herausforderungen dar, auf die Bildung als gestaltende Kraft reagieren muss. Die UNESCO hat mit dem Konzept der Global Citizenship Education (GCED) einen Ansatz entwickelt, der Menschen befähigen soll, globale Probleme zu verstehen und interkulturelle Kompetenzen zu entwickeln. Klafkis Theorie der epochaltypischen Schlüsselprobleme bietet dabei einen etablierten theoretischen Rahmen, um die Wirksamkeit solcher Bildungsprogramme hinsichtlich globaler Verantwortung zu analysieren.

---

## 5. Per-paragraph synthese — §5 of 1.1.1 (closing paragraph, mit erweitertem Budget)

§5 ist der Schlussabsatz von 1.1.1 und entwickelt aus den vorangegangenen
theoretischen Schritten eine gegenwartsdiagnostische Pointe (kulturelle
Superdiversität, Enttraditionalisierung, Populismus) plus bildungspolitische
Resonanz (BMBF-Förderprogramme, OECD/PISA 2018), gebündelt in einer
Doppelaufgabe: Defizite gesellschaftlich-kultureller Kohärenz bearbeiten
und kulturelle Ordnungen in ihrer Pluralität/Wandelbarkeit ermöglichen.

mimo's §5 wurde im Hauptlauf bei production-default `maxTokens=2000`
durch invisible reasoning aufgebraucht (text leer). Re-run mit
`maxTokens=6000` lieferte vollständigen Output (out=2250). Die anderen
drei Modelle laufen unter ihren ursprünglichen Production-Budgets;
inhaltlich vergleichbar.

**mimo-v2.5-pro** (re-run, budget=6000)

> Der Absatz schließt das Unterkapitel ab, indem er die zuvor theoretisch erarbeitete Dialektik kultureller Prozesse mit empirischen Zeitdiagnosen und bildungspolitischen Signalen verknüpft und so deren Gegenwartsrelevanz absichert. Superdiversität, Enttraditionalisierung und deren sichtbare soziale Folgen (Populismus, verhärtete Diskurspositionen) werden als Dringlichkeitsbelege für kulturelle Bildungsprozesse ins Feld geführt, wobei bildungspolitische Initiativen (BMBF, OECD/PISA) als institutionelle Resonanz gedeutet werden. Die abschließende Formulierung verdichtet die programmatische Doppelaufgabe des gesamten Unterkapitels: Defizite kultureller Kohärenz zu bearbeiten und zugleich plurale, wandelbare kulturelle Ordnungen zu ermöglichen — eine Formulierung, die als Leitgedanke für die folgenden Abschnitte über Lehrkräfte als kulturelle Bildungsakteure fungieren dürfte.

*Codes:*
- **Kulturelle Superdiversität als Gegenwartskennzeichen** — Benennt die zentrale Zeitdiagnose des Absatzes, die den empirischen Beleg für die Dringlichkeit kultureller Orientierungsangebote in Schule liefert.
- **Kohärenzdefizite bearbeiten und pluraler Ordnungen ermöglichen** — Formuliert die programmatische Schlusspointe des gesamten Unterkapitels als Doppelaufgabe — Kohärenzdefizite bearbeiten und zugleich Pluralität/Wandelbarkeit kultureller Ordnungen ermöglichen.

**sonnet-4-6**

> Der Absatz verknüpft die bildungstheoretische Argumentation der vorangegangenen Absätze mit einer gesellschaftsdiagnostischen Gegenwartsbeschreibung: 'kulturelle Superdiversität', Enttraditionalisierung und die politischen Reaktionsformen (national-populistische Bewegungen) werden als Druckfelder benannt, die Bildungsprozesse zur Orientierungsstiftung dringlich machen. Argumentativ fungiert der Absatz als Schlussstein des Unterkapitels: Er überführt die theoretisch-bildungsphilosophische Rahmung (Absätze 3–4) in eine gesellschaftspolitische Dringlichkeitsbehauptung und legitimiert so die Fokussierung kultureller Professionalität als Forschungsgegenstand — wobei die abschließende Referenz auf bildungspolitische Impulse (BMBF, PISA 2018) das Argument vom wissenschaftlichen in den institutionellen Relevanzhorizont hinein verlängert.

*Codes:*
- **Kulturelle Superdiversität als Gegenwartsdiagnose** — Der Begriff markiert den soziologischen Kern der Zeitdiagnose, auf die das gesamte bildungspolitische und professionsbezogene Argument des Absatzes aufbaut.
- **Bildung als temporäre Orientierungsstiftung** — Die Formulierung benennt den funktionalen Anspruch an Bildungsprozesse unter Bedingungen von Unübersichtlichkeit und verbindet die gesellschaftsdiagnostische mit der bildungstheoretischen Argumentationslinie des Subkapitels.

**opus-4.7**

> Der Absatz diagnostiziert die Gegenwart als Zustand kultureller Superdiversität, in der Enttraditionalisierung und Individualisierung Sozialisationsprozesse erschweren und zu Verunsicherungen führen, die sich politisch in agonalen Verhärtungen und Populismus niederschlagen. Daraus wird die gesteigerte Bedeutung orientierungsstiftender Bildungsprozesse abgeleitet und durch bildungspolitische Evidenz (BMBF-Programme, PISA 2018 globale Kompetenzen) belegt. Funktional schließt der Absatz das Unterkapitel, indem die zuvor bildungstheoretisch entwickelte Ambivalenz von Kultur in eine gesellschaftsdiagnostische Dringlichkeitsformel überführt wird — kulturelle Orientierungsangebote in Schule erscheinen nun als Bearbeitung von Kohärenzdefiziten unter Bedingungen pluralisierter Ordnungen.

*Codes:*
- **Kulturelle Superdiversität als Zeitdiagnose** — Dieser Begriff bündelt die gesellschaftsdiagnostische Rahmung des Absatzes und liefert die Legitimationsbasis für die Notwendigkeit kultureller Orientierungsangebote in Schule.
- **Defizite gesellschaftlich-kultureller Kohärenz** — Formuliert die zentrale Problemdiagnose, auf die kulturelle Bildungsprozesse als temporäre Orientierungsstiftung antworten sollen.

**deepseek-v4-pro**

> Der Absatz greift die Diskursverfasstheit von Kultur auf und führt die Zeitdiagnose kultureller Superdiversität sowie Enttraditionalisierung ein, die zu gesellschaftlichen Verunsicherungen und politischer Verhärtung führen. Er positioniert Bildung als notwendiges Mittel, um in dieser Unübersichtlichkeit temporäre Orientierung zu stiften, und untermauert dies mit Verweis auf bildungspolitische Initiativen wie das BMBF-Förderprogramm oder PISA 2018. Der Absatz schließt das Unterkapitel ab, indem er die zuvor theoretisch entfaltete kulturelle Komplexität in eine gesellschaftspolitische Diagnose überführt und die Dringlichkeit einer kulturell informierten Bildungspraxis betont, was die spätere Fokussierung auf Lehrkräfteprofessionalität vorbereitet.

*Codes:*
- **Temporäre Orientierung durch Bildung** — Der Begriff verdichtet die zentrale Antwort auf die diagnostizierte Superdiversität und Verunsicherung: Bildungsprozesse sollen keine letztgültige Sicherheit, sondern eine vorübergehende Verortung in unübersichtlichen kulturellen Ordnungen ermöglichen.

**Lesart §5:** Alle vier Modelle treffen denselben argumentativen Kern
(Schlussstein-Funktion, Zeitdiagnose Superdiversität, bildungspolitische
Resonanz). mimo formuliert die Doppelaufgabe der Schlusspointe am
schärfsten ("Defizite kultureller Kohärenz bearbeiten und zugleich
plurale, wandelbare kulturelle Ordnungen ermöglichen"), Sonnet hebt die
"temporäre Orientierungsstiftung" als bildungstheoretischen Begriff am
explizitesten heraus, Opus zeigt die kompakteste Diagnose-Bewegung,
DS4 bleibt knapp aber inhaltlich vollständig. Beim Code-Set extrahieren
mimo, Sonnet und Opus jeweils zwei tragende Begriffe; DS4 nur einen
("Temporäre Orientierung").

---

## 6. Argumentation graph — §5 of 1.1.1 (closing paragraph, mit erweitertem Budget)

mimo's §5 AG wurde im Hauptlauf bei production-default `maxTokens=8000`
abgeschnitten. Re-run mit `maxTokens=16000` lieferte vollständigen Output
(out=13222 Tokens — Reasoning-Burn massiv, aber Content vollständig).
DS4 lieferte für AG generell kein verwertbares Ergebnis; daher hier nur
Vergleich gegen Sonnet/Opus.

**mimo-v2.5-pro** (re-run, budget=16000) — 5 args, 8 edges, 3 scaffolding

- **A1** [stated+stated] Kulturelle Superdiversität sowie Enttraditionalisierungs- und Individualisierungsprozesse sind Kennzeichen der Gegenwart, die die kulturell dimensionierte Sozialisierung erschweren, indem sie die Weltsichten und Sinndimensionen von Phänomenen, Ereignissen und Praxen vervielfältigen.
- **A2** [stated] Diese kulturellen Dynamiken können Verunsicherungen hervorrufen, die sich in agonal verhärteten Diskurspositionen und im Erstarken national-populistischer Bewegungen zeigen.
- **A3** [stated] Angesichts der persistierenden kulturellen Unübersichtlichkeit ist es besonders bedeutsam, Bildungsprozesse zu ermöglichen, die temporäre Orientierung ermöglichen.
- **A4** [stated+stated] Ein gestiegenes Problembewusstsein für die Relevanz kultureller Bildungsprozesse zeigt sich in bildungspolitischen Impulsen wie BMBF-Förderprogrammen zur kulturellen Bildung und der OECD-PISA-2018-Erhebung globaler Kompetenzen.
- **A5** [stated+carried(§4)] Diese bildungspolitischen Akzente verweisen auf die Dringlichkeit, Defizite gesellschaftlich-kultureller Kohärenz zu bearbeiten und kulturelle Ordnungszusammenhänge in ihrer Pluralität und Wandelbarkeit zu ermöglichen.

*Edges (8):* A1→A2 supports, A2→A3 supports, A4→A3 supports, A5→A3 refines, A4→A5 supports; cross-paragraph: A1→§1:A4 refines, A1→§1:A5 refines, A5→§4:A1 presupposes.

*Scaffolding (3):*
- **S1** [textorganisatorisch] Eröffnungsmarkierung "Auch in der Hinsicht, wie Kultur zur Sprache kommt..." — markiert Übergang vom bildungstheoretischen Diskurs zur gesellschaftsdiagnostischen Perspektive.
- **S2** [kontextualisierend] "der nun schon alten Unübersichtlichkeit" — impliziter intertextueller Verweis auf Habermas' "Die neue Unübersichtlichkeit" (1985); rhetorisch wirksam, ironische Umkehrung.
- **S3** [kontextualisierend] "tituliert als globale Kompetenzen (kritisch dazu siehe Ress et al., 2022; Simpson & Dervin, 2019)" — kritische Qualifikation des OECD-Konzepts; markiert epistemische Sorgfalt, dass Autor nicht affirmativ übernimmt.

**sonnet-4-6** — 3 args, 6 edges, 6 scaffolding

- **A1** Kulturelle Superdiversität als Kennzeichen der Gegenwart sowie Enttraditionalisierungs- und Individualisierungsprozesse steigern die Komplexität kulturell dimensionierter Sozialisierung in der Schule, da sie gegensätzliche Rahmungen (Kontingenz und Historizität) vervielfältigen und damit auch Weltsichten und Sinndimensionen pluralisieren.
- **A2** Die durch Superdiversität und Enttraditionalisierung erzeugten Verunsicherungen zeigen sich gesellschaftlich in Diskursverhärtungen und im Erstarken national-populistischer Bewegungen, was die bildungspolitische und pädagogische Dringlichkeit von Orientierung ermöglichenden Bildungsprozessen erhöht.
- **A3** Bildungspolitische Impulse — wie BMBF-Förderprogramme zur kulturellen Bildung und die Erhebung globaler Kompetenzen in PISA 2018 — belegen ein gestiegenes institutionelles Bewusstsein für die Relevanz kultureller Bildungsprozesse, wenngleich entsprechende Konzepte (etwa 'globale Kompetenzen') kritisch zu hinterfragen sind.

**opus-4.7** — 5 args, 7 edges, 6 scaffolding

- **A1** Die Gegenwart ist durch kulturelle Superdiversität gekennzeichnet, sodass Enttraditionalisierungs- und Individualisierungsprozesse die kulturell dimensionierte Sozialisierung erschweren, weil Kontingenz und Historizität die eingeschriebenen Weltsichten und Sinndimensionen von Phänomenen und Praxen vervielfältigen.
- **A2** Die kulturelle Komplexität und Unübersichtlichkeit der Gegenwart erzeugt Verunsicherungen, die sich gesellschaftlich in agonal verhärteten Diskurspositionen und im Erstarken national-populistischer Bewegungen manifestieren.
- **A3** Gerade angesichts kultureller Unübersichtlichkeit und der daraus resultierenden gesellschaftlichen Verunsicherungen ist es bedeutsam, Bildungsprozesse zu ermöglichen, die temporäre Orientierung erlauben.
- **A4** Ein gestiegenes gesellschaftliches Bewusstsein für die Relevanz kulturell orientierender Bildungsprozesse lässt sich an bildungspolitischen Impulsen belegen, namentlich an BMBF-Förderprogrammen zur Erforschung kultureller Bildung und an der Erhebung globaler/interkultureller Kompetenzen in PISA 2018.
- **A5** Solche bildungspolitischen Akzentsetzungen zielen auf die Bearbeitung von Defiziten gesellschaftlich-kultureller Kohärenz und auf die Ermöglichung kultureller Ordnungszusammenhänge in ihrer Pluralität und Wandelbarkeit.

**Lesart AG §5:** mimo's Granularität liegt diesmal **identisch zu Opus**
(beide 5 Args), während Sonnet die Argumentation in 3 dichtere
Mega-Argumente bündelt — invertiert zur Lesart aus §1, wo mimo
aggregierte und Sonnet zerlegte. Inhaltlich treffen alle drei dieselbe
fünfteilige Argumentationsbewegung (Diagnose Superdiversität →
Verunsicherung/Populismus → Bildung als Orientierung → bildungspolitische
Impulse → Dringlichkeit Doppelaufgabe). Distinct bei mimo: explizite
prior_paragraph-edges A1→§1:A4/A5 und A5→§4:A1 (cross-¶-Verweise auf
§1's Wandlungsthese und §4's Selbstrelationierungsbegriff). Distinct bei
Sonnet: deutlich reichere scaffolding-Schicht (6 Knoten gegen mimo 3) —
mimo's scaffolding ist hier knapper, aber substanziell (Habermas-
Subtext, OECD-Kritik). Ein Lapsus bei mimo: A1's anchor_phrase
"kulturelle Superdiversität als Kennzeichen der Gegenwart" trifft, aber
keine Mega-Aggregation des Schlussatzes — die Doppelaufgabe wird sauber
in A5 belegt statt in A3 versteckt. Insgesamt für AG §5: **mimo
qualitativ vollständig auf Opus-Niveau, mit eigenständig kritischem
OECD-Scaffolding.**
