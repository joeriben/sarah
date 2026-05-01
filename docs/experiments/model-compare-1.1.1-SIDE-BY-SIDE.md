# Model-Comparison: per-paragraph passes auf 1.1.1 "Bedeutung kultureller Orientierungsangebote in Schule"

Subkapitel: 5 ¶ aus Doc `54073d08` (Timm 2025, frische Validierung).
Pässe pro Modell: synthetic per-paragraph + argumentation-graph (Layer 1 + 2).

## Headline-Zahlen

| Modell | Wall (s) | Total tokens | $/M-input (≈) | $/M-output (≈) |
|---|---:|---:|---|---|
| `deepseek-v4-pro` | 946.0 | 55,445 | ~$0.40 | ~$1.60 |
| `sonnet-4-6` | 231.5 | 66,228 | ~$3 | ~$15 |
| `opus-4.7` | 133.1 | 86,237 | ~$15 | ~$75 |

---

## §1

### Synthese (interpretierend)

**`deepseek-v4-pro`** (in=3160 out=2410, 71.7s)

> Der Absatz etabliert eine kulturwissenschaftliche Perspektive auf schulische Kultur, die Kultur als Reservoir impliziter Werthorizonte und Gemeinschaftskonstitution fasst. Er betont den doppelten Effekt von Routinen – Handlungsgewissheit und Begrenzung – und profiliert Kultur im Anschluss an Reckwitz und Bhabha als prozessuale Arena der Bedeutungsaushandlung, die implizite Machtmechanismen einschließt. Als Eingangspassage des Unterkapitels legt er die theoretische Grundlage und die zentralen Spannungslinien, die die anschließende Argumentation tragen.

**`sonnet-4-6`** (in=3986 out=498, 10.1s)

> Der Absatz etabliert die kulturwissenschaftliche Rahmung der gesamten Studie und benennt Reckwitz als zentrale Referenz. Kultur wird dabei als praxeologisches Konzept entfaltet: als implizit wirksames Reservoir von Werthorizonten, das Gemeinschaft stiftet, Handlungsgewissheit erzeugt, zugleich aber Repertoires begrenzt, Ausschlüsse produziert und als Feld impliziter Machtaushandlung fungiert. Dieser doppelte Charakter von Kultur — gemeinschaftsstiftend und exklusiv zugleich, Routinegarant und Möglichkeitsraum für Neuformulierungen — wird als Einstiegsthese in das Subkapitel gesetzt und legt die analytische Folie für die nachfolgende Diskussion schulischer Kulturprozesse.

**`opus-4.7`** (in=5602 out=590, 6.0s)

> Der Absatz verortet den Argumentationsgang kulturwissenschaftlich mit Referenz auf Reckwitz und entfaltet ein Kulturverständnis, das Kultur als implizites, gemeinschaftsstiftendes Reservoir von Werthorizonten fasst, das Handlungsgewissheit ermöglicht, zugleich aber Handlungsrepertoires begrenzt und Ausschlüsse perpetuiert. Als erster Absatz des Unterkapitels etabliert er damit die theoretische Lesefolie — Kultur als ambivalenter Prozess von Routine und Wandlung, Aushandlungsarena mit impliziten Machtmechanismen —, auf der die Bedeutung kultureller Orientierungsangebote in Schule in den folgenden Absätzen entwickelt werden soll.

### Codes (max 2)

| Modell | label | anchor_phrase | rationale |
|---|---|---|---|
| `deepseek-v4-pro` | Kultur als Reservoir von Werthorizonten | Reservoir von Werthorizonten | Verdichtet die kulturwissenschaftliche Auffassung, dass Kultur implizite Wertbestände bereitstellt, die Gemeinschaften konstituieren. |
| `deepseek-v4-pro` | Kultur als Arena der Aushandlung von Bedeutungen | Arena der Aushandlung von Bedeutungen | Markiert den prozessualen, machtbesetzten Charakter kultureller Praxis als kontinuierliche Neuverhandlung von Sinn. |
| `sonnet-4-6` | Kultur als Reservoir impliziter Werthorizonte | Reservoir von Werthorizonten | Dieser Begriff fasst den praxeologischen Kulturbegriff, auf dem die gesamte Argumentation aufbaut: Kultur wirkt nicht explizit-normativ, sondern als implizite, gemeinschaftsstiftende Orientierungsstruktur. |
| `sonnet-4-6` | Kultur: Gemeinschaftsstiftung und Ausschluss | Abgren-  zungen und Ausschlüsse | Der Absatz markiert den doppelten Effekt kultureller Routinen — Handlungsgewissheit einerseits, Begrenzung und soziale Exklusion andererseits — als zentralen Problemzusammenhang, der die normative Stoßrichtung der Studie grundiert. |
| `opus-4.7` | Kultur als Aushandlungsarena von Bedeutungen | Arena der Aushand-lung von Bedeutungen | Verdichtet die praxeologisch-kulturwissenschaftliche Kernbestimmung von Kultur, die der gesamten Argumentation als theoretische Referenz dient. |
| `opus-4.7` | Doppeleffekt kultureller Routinen | doppelten Effekt | Zentrale These des Absatzes: Kultur ermöglicht Handlungsgewissheit und begrenzt zugleich das Handlungsrepertoire — diese Ambivalenz trägt die weitere Argumentation. |

### Arguments

**`deepseek-v4-pro`** — FAILED: [
  {
    "received": "presupposes",
    "code": "invalid_enum_value",
    "options": [
      "supports",
      "refines",
      "contradicts"
    ],
    "path": [
      "edges",
      4,
      "kind"
    ],
    "message": "Invalid enum value. Expected 'supports' | 'refines' | 'contradicts', received 'presupposes'"
  },
  {
    "received": "presupposes",
    "code": "invalid_enum_value",
    "options": [
      "supports",
      "refines",
      "contradicts"
    ],
    "path": [
      "edges",
      5,
      "kind"
    ],
    "message": "Invalid enum value. Expected 'supports' | 'refines' | 'contradicts', received 'presupposes'"
  }
]

**`sonnet-4-6`** — 5 arg(s), edges: inter=5 prior=0, 5 scaffolding (in=5698 out=3095, 44.0s)

- **argA1** [stated+stated+background] Eine kulturwissenschaftliche Perspektivierung — insbesondere nach Reckwitz — ermöglicht es, kulturelle Prozesse in Schule und Unterricht als implizit wirksame Werthorizonte sichtbar zu machen, die Gemeinsamkeiten und Gemeinschaften konstituieren.
  - _stated:_ Kulturwissenschaftlich geformte Ansätze praxeologischer Forschung verweisen auf den Mehrwert einer Perspektivierung entlang kultureller Dimensionen.
  - _stated:_ Kultur kommt als Reservoir von Werthorizonten in den Blick, die Gemeinsamkeiten und Gemeinschaften konstituieren, zumeist implizit.
  - _background:_ Reckwitz' kulturwissenschaftlich-praxeologischer Ansatz ist in der erziehungswissenschaftlichen Schulforschung als legitimes theoretisches Bezugssystem etabliert.
- **argA2** [stated+stated] Kulturelle Routinen in Schule erzeugen einen doppelten Effekt: Sie stiften Handlungsgewissheit durch routinierte Gemeinschaft, begrenzen aber zugleich das individuelle Handlungsrepertoire.
  - _stated:_ Routinierte Gemeinschaft ermöglicht Handlungsgewissheit; gleichzeitig wird durch sie das Handlungsrepertoire für den Einzelnen begrenzt.
  - _stated:_ Dies gilt beispielsweise für das Zeitregime von Schule, Routinen unterrichtlicher Interaktion oder organisationale und schulkulturelle Arrangements.
- **argA3** [stated+background] Kultur perpetuiert als gemeinschaftsstiftendes Element soziale Abgrenzungen und Ausschlüsse, da sie Handlungsrepertoires einschränkt.
  - _stated:_ Das Handlungsrepertoire wird für den Einzelnen durch routinierte Gemeinschaft begrenzt.
  - _background:_ Soziale Ausschlüsse sind eine strukturelle Folge von Mechanismen, die Zugehörigkeit durch Abgrenzung definieren — eine in der Kultursoziologie (u.a. Bourdieu, Reckwitz) verbreitete Annahme.
- **argA4** [stated+stated+background] Kultur ist nicht nur Tradierung, sondern auch Prozess der Wandlung: Sie bietet einen Möglichkeitsraum für Neuformulierungen (Bhabha) und ist zugleich Arena der Aushandlung von Bedeutungen (Reckwitz), die implizite Machtmechanismen einschließt.
  - _stated:_ Kultur ist in der Wiederholung tradierter Routinen auch ein Prozess der Wandlung und bietet einen Möglichkeitsraum für Neuformulierungen (Bhabha, 2010).
  - _stated:_ In ihrer Prozesshaftigkeit ist Kultur die Arena der Aushandlung von Bedeutungen (Reckwitz 2003), die implizite Machtmechanismen einschließt.
  - _background:_ Bhabhas Konzept des 'dritten Raums' und Reckwitz' praxeologische Kulturtheorie gelten in kulturwissenschaftlichen Bildungsdiskursen als kompatible, wenn auch nicht deckungsgleiche Bezugsrahmen.
- **argA5** [stated] Kultur verweist durch ihre Verbindung von Gemeinschaftsstiftung, Ausschluss, Wandlungspotenzial und Machtmechanismen auf einen gesellschaftlichen Problemzusammenhang.
  - _stated:_ Kultur schließt als Arena der Bedeutungsaushandlung implizite Machtmechanismen ein.

**`opus-4.7`** — 6 arg(s), edges: inter=6 prior=0, 6 scaffolding (in=7889 out=3729, 27.4s)

- **argA1** [stated] Die Argumentation der Arbeit stützt sich auf eine kulturwissenschaftliche Perspektive, insbesondere auf Reckwitz' Theorievorschläge.
  - _stated:_ Dem Argumentationsgang liegt eine kulturwissenschaftliche Perspektivierung mit besonderer Referenz auf Reckwitz (2004, 2017) zugrunde.
- **argA2** [stated+stated+background] Eine praxeologisch-kulturwissenschaftliche Perspektivierung auf Schule und Unterricht erzeugt einen analytischen Mehrwert, weil sie kulturelle Prozesse als ansonsten zumeist implizit bleibende Werthorizonte sichtbar macht.
  - _stated:_ Praxeologisch-kulturwissenschaftliche Ansätze verweisen auf den Mehrwert einer Perspektivierung entlang kultureller Dimensionen.
  - _stated:_ Mit ihnen werden Ausprägungen kultureller Prozesse sichtbar; Kultur erscheint als Reservoir von Werthorizonten, die Gemeinsamkeit und Gemeinschaft zumeist implizit konstituieren.
  - _background:_ Praxeologische Forschung operiert mit der Annahme, dass soziale Praxis wesentlich durch implizite, körper- und routinegebundene Wissensbestände strukturiert ist.
- **argA3** [stated+stated] Kulturell geformte Routinen in Schule (Zeitregime, unterrichtliche Interaktion, schulkulturelle Arrangements) haben einen ambivalenten Doppeleffekt: Sie ermöglichen Handlungsgewissheit, begrenzen aber zugleich das individuelle Handlungsrepertoire.
  - _stated:_ Zeitregime von Schule, Routinen unterrichtlicher Interaktion und organisationale/schulkulturelle Arrangements sind Beispiele impliziter kultureller Werthorizonte.
  - _stated:_ Einerseits ermöglicht routinierte Gemeinschaft Handlungsgewissheit, andererseits begrenzt sie das Handlungsrepertoire des Einzelnen.
- **argA4** [carried+stated+stated] Kultur als gemeinschaftsstiftendes Element produziert zugleich Abgrenzungen und Ausschlüsse und impliziert damit Machtmechanismen.
  - _carried _(from §1)_:_ Kultur konstituiert implizit Gemeinsamkeiten und Gemeinschaft über geteilte Werthorizonte.
  - _stated:_ Kultur perpetuiert als gemeinschaftsstiftendes Element auch Abgrenzungen und Ausschlüsse.
  - _stated:_ Als Arena der Aushandlung von Bedeutungen schließt Kultur implizite Machtmechanismen ein.
- **argA5** [stated+background] Kultur ist nicht nur Reproduktion, sondern in der Wiederholung tradierter Routinen zugleich ein Prozess der Wandlung, der einen Möglichkeitsraum für Neuformulierungen eröffnet.
  - _stated:_ Kultur ist in der Wiederholung tradierter Routinen auch ein Prozess der Wandlung und bietet einen Möglichkeitsraum für Neuformulierungen (Bhabha 2010).
  - _background:_ Bhabhas Konzept des Dritten Raums/der Hybridität fasst kulturelle Wiederholung als Ort produktiver Verschiebung.
- **argA6** [stated] Weil Kultur Gemeinschaft stiftet, Ausschlüsse produziert, Machtmechanismen einschließt und zugleich Wandlung ermöglicht, verweist sie auf einen gesellschaftlichen Problemzusammenhang, der analytisch zu bearbeiten ist.
  - _stated:_ Damit verweist [Kultur] auf einen gesellschaftlichen Problemzusammenhang.

### Edges

| Modell | edges (from→to: type) |
|---|---|
| `deepseek-v4-pro` | _(skipped/failed)_ |
| `sonnet-4-6` | A2→A1: undefined; A3→A2: undefined; A4→A3: undefined; A5→A4: undefined; A5→A3: undefined |
| `opus-4.7` | A1→A2: undefined; A2→A3: undefined; A3→A4: undefined; A5→A4: undefined; A4→A6: undefined; A5→A6: undefined |

### Scaffolding

**`deepseek-v4-pro`**

_(none/failed)_

**`sonnet-4-6`**

- [textorganisatorisch] Eröffnungsmarkierung des gesamten Unterkapitels: benennt den theoretischen Referenzrahmen (Reckwitz) und verankert ihn durch Querverweise auf Unterkapitel 1.2.1, ohne selbst argumentativ zu werden. Rahmt A1–A5. → args A1
- [textorganisatorisch] Querverweis auf Unterkapitel 1.2.3, der die Behauptung des 'Mehrwerts' kulturwissenschaftlich-praxeologischer Perspektivierung (A1) durch vorangehende Ausführungen absichern soll. → args A1
- [didaktisch] Exemplarische Konkretisierung des abstrakten Begriffs 'kulturelle Prozesse in Schule' (A1) und der Claim-Grundlage von A2: benennt drei schulpraktische Instanzen impliziter Werthorizonte. → args A1,A2
- [kontextualisierend] Einbettung von A4 (Wandlungspotenzial der Kultur) in Bhabhas Theoriekonzept; der Quellenbeleg soll den claim über Kulturwandel durch Wiederholung theoretisch legitimieren. → args A4
- [kontextualisierend] Quellenbeleg für A4: Reckwitz 2003 wird als Autorität für das Konzept der Bedeutungsaushandlung angeführt und um die Machtdimension ergänzt. → args A4,A5

**`opus-4.7`**

- [kontextualisierend] Quellenverweis und interner Rückverweis, der A1 (die theoretische Grundlegung bei Reckwitz) mit dem späteren Theoriekapitel 1.2.1 verklammert. → args A1
- [textorganisatorisch] Interner Vorverweis, der die in A2 behauptete Leistungsfähigkeit praxeologisch-kulturwissenschaftlicher Ansätze an die spätere ausführliche Darstellung in 1.2.3 delegiert. → args A2
- [didaktisch] Beispielssetzung für A2 und A3 — konkretisiert die abstrakte Rede von impliziten Werthorizonten an schulbezogenen Feldern. → args A2,A3
- [kontextualisierend] Autoritätsverweis, der die Behauptung des kulturellen Möglichkeitsraums in A5 an Bhabhas Theorie anbindet. → args A5
- [kontextualisierend] Quellenverweis, der die Rede von Kultur als 'Arena der Aushandlung von Bedeutungen' — Bestandteil der Begründung von A4 — an Reckwitz anbindet. → args A4
- [textorganisatorisch] Abschließender Übergangssatz, der die vorangegangenen Argumente A3–A5 in A6 bündelt und den Anschluss an die folgende Problemexposition vorbereitet. → args A6

---

## §2

### Synthese (interpretierend)

**`deepseek-v4-pro`** (in=3573 out=1524, 38.7s)

> Der Absatz diagnostiziert einen grundlegenden Wandel schulischer kultureller Bildungsprozesse: von einer Einführung in ein geschlossenes Wertereservoir hin zur Ausbildung brüchiger, komplexer Selbst- und Weltverhältnisse angesichts radikaler Pluralität. Er leitet daraus eine veränderte Anforderung an Lehrkräfte ab, die nicht mehr routinisiert vermitteln können, sondern in einem unübersichtlichen Feld analytisch-reflexiv navigieren müssen. Damit konkretisiert er die im Vorabsatz entfaltete prozessuale und machtdurchzogene Kulturbestimmung für die Schule und bereitet die spätere Fokussierung auf Professionalität vor.

**`sonnet-4-6`** (in=4544 out=596, 11.6s)

> Der Absatz vollzieht den Schritt von der allgemeinen kulturwissenschaftlichen Rahmung (Absatz 1) zur schulpädagogischen Konsequenz: Schule wird als Ort kultureller Einführung bestimmt, wobei der historisch gewachsene Konsens eines geschlossenen Wertekanons als unwiederbringlich aufgebrochen diagnostiziert wird. Die argumentative Bewegung ist eine doppelte: Zunächst wird die klassische Sozialisationsfunktion von Schule anerkannt (Hineinführen in Kultur nach Fend), um sie dann unter den Bedingungen kultureller Pluralität grundsätzlich zu problematisieren — mit dem Ergebnis, dass Lehrkräfte nun analytisch-reflexiv navigieren müssen, wo früher Routine genügte. Damit wird die im Vorgängerabsatz entwickelte Spannung zwischen Routinegarant und Möglichkeitsraum auf das professionelle Handeln von Lehrkräften konkretisiert und als Ausgangsproblem der gesamten Studie schärfer gefasst.

**`opus-4.7`** (in=6386 out=744, 7.9s)

> Der Absatz diagnostiziert, dass schulisches Lernen konstitutiv mit Einführung in Kultur verbunden ist, diese aber nicht länger als Hineinführen in ein geschlossenes Werte-Reservoir begriffen werden kann, da tradierte Konsense durch kulturelle Pluralisierung aufgebrochen sind. Aus dieser Diagnose wird eine Zuspitzung gewonnen: Kulturelle Bildung als Ausbildung von Selbst- und Weltverhältnissen wird brüchiger und komplexer, weshalb Lehrkräfte nicht mehr routiniert, sondern nur noch analytisch-reflexiv agieren können. Funktional schließt der Absatz an die im Vorgänger etablierte Ambivalenz von Kultur (Routine/Wandlung) an und überführt sie in eine Problemformulierung für schulische Professionalität — damit wird die im Unterkapiteltitel angekündigte Bedeutung kultureller Orientierungsangebote als Reaktion auf einen Konsensverlust konturiert.

### Codes (max 2)

| Modell | label | anchor_phrase | rationale |
|---|---|---|---|
| `deepseek-v4-pro` | Kulturelle Bildung als Ausbildung von Selbst- und Weltverhältnissen | Ausbildung von Selbst- und Weltverhältnissen | Die Formel markiert die Kernthese eines gewandelten Charakters schulischer Kulturvermittlung unter Bedingungen von Pluralität und Brüchigkeit. |
| `deepseek-v4-pro` | Lehrkräftehandeln als analytisch-reflexives Handlungsfeld | analytisch-reflexiv zu bewältigenden Handlungsfeld | Bündelt die zentrale Folgerung: An die Stelle einer sich selbst genügenden Routine tritt eine reflexiv zu leistende Navigation im unübersichtlichen kulturellen Feld. |
| `sonnet-4-6` | Pluralität kultureller Ordnungszusammenhänge als Schulherausforderung | breit gefächerten Pluralität kultureller Ordnungszusammenhänge | Diese Wendung benennt den zentralen Befund des Absatzes: Der ehemals konsensuale Wertekanon ist aufgebrochen, was die strukturelle Ausgangsbedingung für die gesamte folgende Argumentation über kulturelle Professionalität darstellt. |
| `sonnet-4-6` | Kulturelle Bildung als analytisch-reflexives Handlungsfeld | analytisch-reflexiv zu bewältigenden Handlungsfeld | Diese Formulierung markiert den argumentativen Zielpunkt des Absatzes: die Transformation des kulturellen Vermittlungshandelns von routinegestützter Praxis zu einem Feld, das professionelle Reflexivität zwingend erfordert — und damit den Problemhorizont der Studie konstituiert. |
| `opus-4.7` | Pluralität kultureller Ordnungszusammenhänge | Pluralität kultureller Ordnungszusammenhänge | Dieser Begriff trägt die zentrale Diagnose des Absatzes — dass der traditionelle Konsens eines geschlossenen Werte-Reservoirs in Schule durch kulturelle Pluralisierung ersetzt ist. |
| `opus-4.7` | Lehrhandeln als analytisch-reflexives Handlungsfeld | analytisch-reflexiv zu bewältigenden | Hier wird die professionstheoretische Schlussfolgerung formuliert: das Anstoßen kultureller Bildungsprozesse ist von Routine zu reflexivem Handlungsfeld geworden — eine Kernthese mit Blick auf das Gesamtprojekt. |

### Arguments

**`deepseek-v4-pro`** — 6 arg(s), edges: inter=5 prior=0, 0 scaffolding (in=4901 out=10398, 305.8s)

- **argA1** [stated+background] Schulisches Lernen ist nicht nur Wissenserwerb, sondern mit kulturellen Bildungsprozessen verbunden.
  - _stated:_ Es ist Konsens, dass die nachwachsende Generation in der Schule nicht nur Fakten lernt, sondern in Kultur eingeführt wird (Fend, 2006).
  - _background:_ Einführung in Kultur ist eine Form kulturellen Bildungsprozesses.
- **argA2** [stated+background] Auf den Konsens, dass schulische kulturelle Einführung ein Hineinführen in ein geschlossenes Reservoir vorherrschender Werte und Normen bedeutet, kann nicht mehr zurückgegriffen werden.
  - _stated:_ Tradierte und kollektiv geteilte Wertvorstellungen sind aufgebrochen und Selbstverständnisse einer kulturellen Erinnerungsgemeinschaft differenzieren sich aus; es ist von einer breit gefächerten Pluralität kultureller Ordnungszusammenhänge auszugehen.
  - _background:_ Wenn Wertvorstellungen nicht mehr gemeinsam geteilt werden, kann ein Konsens über ein geschlossenes Reservoir nicht bestehen.
- **argA3** [stated+background] In schulischer Bildung können bei der Einführung in Kultur gegenwärtig kulturelle Wertvorstellungen nicht als selbstverständlich vorausgesetzt werden und tradierte Werte und Normen nicht unhinterfragt als legitimiert gelten.
  - _stated:_ Kulturelle Ordnungszusammenhänge sind breit gefächert plural, tradierte und kollektiv geteilte Wertvorstellungen sind aufgebrochen.
  - _background:_ Ohne einen gemeinsamen Wertekanon können Werte nicht als selbstverständlich gelten.
- **argA4** [background+background] Kulturelle Bildungsprozesse in Schule sind als Ausbildung von Selbst- und Weltverhältnissen zu fassen, die brüchiger und dadurch komplexer werden.
  - _background:_ Bildungsprozesse werden weithin als Ausbildung von Selbst- und Weltverhältnissen konzipiert.
  - _background:_ Wenn kulturelle Werte nicht mehr fraglos gegeben sind, werden solche Verhältnisse prekär und ihre Ausbildung fragiler.
- **argA5** [background] Das Individuum muss eine spezifische und tragfähige Selbstpositionierung im Facettenreichtum kultureller Sinndimensionen erreichen und einen Anschluss an geteilte Wertdimensionen aufbauen.
  - _background:_ Individuen haben ein grundlegendes Bedürfnis nach stabiler Selbstverortung und sozialer Zugehörigkeit.
- **argA6** [stated+stated+background] Lehrkräfte müssen in kulturellen Dimensionen schulischer Vermittlung in einem unübersichtlichen Feld navigieren, weil das Anstoßen kultureller Bildungsprozesse von einer sich selbst genügenden Routine zu einem nur analytisch-reflexiv zu bewältigenden Handlungsfeld geworden ist.
  - _stated:_ Kulturelle Bildungsprozesse sind brüchiger und komplexer geworden (Ausbildung von Selbst- und Weltverhältnissen).
  - _stated:_ Individuen müssen eine spezifische und tragfähige Selbstpositionierung erreichen und Anschluss an geteilte Werte aufbauen.
  - _background:_ Unterrichten umfasst das Anstoßen von Bildungsprozessen.

**`sonnet-4-6`** — 5 arg(s), edges: inter=5 prior=4, 4 scaffolding (in=6758 out=2964, 37.3s)

- **argA1** [stated+background] Schulisches Lernen ist nicht nur Wissenserwerb, sondern umfasst kulturelle Bildungsprozesse, verstanden als gesellschaftlich vermittelte Einführung in Kultur.
  - _stated:_ Es ist Konsens, dass die nachwachsende Generation in der Schule nicht nur Fakten lernt, sondern in Kultur eingeführt wird (Fend, 2006).
  - _background:_ Schule erfüllt eine gesellschaftliche Sozialisations- und Enkulturationsfunktion, die über bloße Wissensvermittlung hinausgeht.
- **argA2** [stated+stated+background] Das traditionelle Verständnis schulischer Kultureinführung als Hineinführen in ein geschlossenes Reservoir geteilter Werte und Normen ist angesichts kultureller Pluralisierung nicht mehr tragfähig.
  - _stated:_ Lange Zeit wurde dies – explizit oder implizit – als das Hineinführen in ein geschlossenes Reservoir vorherrschender Werte und Normen verstanden.
  - _stated:_ Tradierte und kollektiv geteilte Wertvorstellungen sind aufgebrochen und Selbstverständnisse einer kulturellen Erinnerungsgemeinschaft differenzieren sich aus.
  - _background:_ Kulturelle Pluralisierung ist ein empirisch belegbares gesellschaftliches Phänomen, das normative Konsensdiskurse unter Druck setzt.
- **argA3** [stated+stated+carried] Kulturelle Bildungsprozesse in der Schule sind gegenwärtig als Ausbildung von Selbst- und Weltverhältnissen zu fassen, die durch kulturelle Pluralität brüchiger und komplexer geworden sind.
  - _stated:_ Von einer breit gefächerten Pluralität kultureller Ordnungszusammenhänge ist auszugehen.
  - _stated:_ Weder können kulturelle Wertvorstellungen als selbstverständlich vorausgesetzt werden, noch können tradierte Werte und Normen unhinterfragt als legitimiert gelten.
  - _carried _(from §1)_:_ Kultur ist als Arena der Aushandlung von Bedeutungen zu verstehen, die implizite Machtmechanismen einschließt (Reckwitz 2003).
- **argA4** [stated+background] Trotz kultureller Pluralisierung bleibt für das Individuum die Notwendigkeit bestehen, eine tragfähige Selbstpositionierung im Spektrum kultureller Sinndimensionen und einen Anschluss an geteilte Wertdimensionen zu erreichen.
  - _stated:_ Für das Individuum bleibt die Notwendigkeit bestehen, eine spezifische und tragfähige Selbstpositionierung im Facettenreichtum kultureller Sinndimensionen zu erreichen und einen Anschluss an geteilte Wertdimensionen aufzubauen.
  - _background:_ Individuelles Handeln und soziale Integration setzen einen Mindestgrad an geteilten Orientierungen voraus, auch unter pluralen Bedingungen.
- **argA5** [stated+carried+carried] Für Lehrkräfte als schulische Akteure ist das Anstoßen kultureller Bildungsprozesse zu einem analytisch-reflexiv zu bewältigenden Handlungsfeld geworden, das nicht mehr durch selbstgenügende Routine bewältigt werden kann.
  - _stated:_ Lehrkräfte navigieren in einem unübersichtlichen Feld, denn das Anstoßen kultureller Bildungsprozesse ist von einer sich selbst genügenden Routine zu einem nur analytisch-reflexiv zu bewältigenden Handlungsfeld geworden.
  - _carried _(from §1)_:_ Kulturelle Routinen in Schule begrenzen das individuelle Handlungsrepertoire und perpetuieren soziale Abgrenzungen.
  - _carried _(from §1)_:_ Kultur ist ein gesellschaftlicher Problemzusammenhang, der Handlungsgewissheit ebenso stiftet wie einschränkt.

**`opus-4.7`** — 5 arg(s), edges: inter=5 prior=3, 3 scaffolding (in=9413 out=3162, 23.2s)

- **argA1** [stated+background] Schulisches Lernen ist nicht allein Wissenserwerb, sondern umfasst zugleich kulturelle Bildungsprozesse, in denen die nachwachsende Generation in Kultur eingeführt wird.
  - _stated:_ Es ist Konsens, dass in der Schule nicht nur Fakten gelernt, sondern die nachwachsende Generation in Kultur eingeführt wird (Fend, 2006).
  - _background:_ Schule wird in der erziehungswissenschaftlichen Diskussion als Sozialisations- und Enkulturationsinstanz verstanden.
- **argA2** [stated+stated+carried] Das Hineinführen in Kultur kann in der Gegenwart nicht mehr als Einführung in ein geschlossenes, konsensuell geteiltes Reservoir von Werten und Normen verstanden werden, weil tradierte kollektive Wertvorstellungen aufgebrochen und kulturelle Ordnungszusammenhänge pluralisiert sind.
  - _stated:_ Lange Zeit wurde das Hineinführen in Kultur als Einführung in ein geschlossenes Reservoir vorherrschender Werte und Normen verstanden; auf einen solchen Konsens kann nicht mehr zurückgegriffen werden.
  - _stated:_ Tradierte und kollektiv geteilte Wertvorstellungen sind aufgebrochen und Selbstverständnisse einer kulturellen Erinnerungsgemeinschaft differenzieren sich aus.
  - _carried _(from §1)_:_ Kultur ist nicht stabile Reproduktion, sondern zugleich ein Prozess der Wandlung und eine Arena der Aushandlung von Bedeutungen.
- **argA3** [stated+stated] Kulturelle Bildungsprozesse in Schule müssen daher als Ausbildung von Selbst- und Weltverhältnissen begriffen werden, die unter Bedingungen kultureller Pluralität brüchiger und komplexer geworden sind.
  - _stated:_ Kulturelle Wertvorstellungen können weder als selbstverständlich vorausgesetzt noch tradierte Werte und Normen unhinterfragt als legitimiert gelten.
  - _stated:_ Kulturelle Bildungsprozesse in Schule sind als Ausbildung von Selbst- und Weltverhältnissen zu fassen, die brüchiger und dadurch komplexer werden.
- **argA4** [stated+background] Trotz pluralisierter kultureller Ordnungszusammenhänge bleibt es für das Individuum notwendig, eine tragfähige Selbstpositionierung zu erreichen und Anschluss an geteilte Wertdimensionen aufzubauen.
  - _stated:_ Für das Individuum bleibt die Notwendigkeit bestehen, eine spezifische und tragfähige Selbstpositionierung im Facettenreichtum kultureller Sinndimensionen zu erreichen und einen Anschluss an geteilte Wertdimensionen aufzubauen.
  - _background:_ Subjektbildung setzt eine gewisse Integration in geteilte Sinn- und Wertbezüge voraus, um handlungsfähig zu sein.
- **argA5** [stated+carried] Das Anstoßen kultureller Bildungsprozesse ist für Lehrkräfte von einer selbstverständlich-routinierten zu einer analytisch-reflexiv zu bewältigenden Aufgabe geworden, weshalb sie in einem unübersichtlichen Feld navigieren.
  - _stated:_ Lehrkräfte navigieren als schulische Akteure in einem unübersichtlichen Feld; das Anstoßen kultureller Bildungsprozesse ist von einer sich selbst genügenden Routine zu einem nur analytisch-reflexiv zu bewältigenden Handlungsfeld geworden.
  - _carried _(from §1)_:_ Kulturelle Routinen in Schule sind ambivalent, ermöglichen Handlungsgewissheit und begrenzen zugleich Handlungsrepertoires.

### Edges

| Modell | edges (from→to: type) |
|---|---|
| `deepseek-v4-pro` | A1→A2: undefined; A2→A3: undefined; A3→A4: undefined; A4→A6: undefined; A5→A6: undefined |
| `sonnet-4-6` | A2→A1: undefined; A3→A2: undefined; A4→A3: undefined; A5→A3: undefined; A5→A4: undefined; A1→§1:A1: undefined; A2→§1:A3: undefined; A3→§1:A4: undefined; A5→§1:A2: undefined |
| `opus-4.7` | A2→A1: undefined; A3→A2: undefined; A4→A3: undefined; A5→A3: undefined; A5→A4: undefined; A2→§1:A5: undefined; A3→§1:A6: undefined; A5→§1:A3: undefined |

### Scaffolding

**`deepseek-v4-pro`**

_(none/failed)_

**`sonnet-4-6`**

- [kontextualisierend] Quellenbeleg für A1: Fend 2006 wird als Autorität für die Konsensbehauptung herangezogen, dass Schule Kultureinführung leistet. Der Verweis soll A1 empirisch-wissenschaftlich absichern. → args A1
- [didaktisch] Kontrastfolie für A2 und A3: Das historisch-traditionelle Verständnis von Kultureinführung wird als Gegenbild eingeführt, vor dem die These der Pluralisierung und Komplexitätssteigerung (A2, A3) profiliert werden kann. → args A2,A3
- [kontextualisierend] Kontextualisierung der These der kulturellen Pluralisierung als Voraussetzung von A2 und A3: Die Formulierung 'Erinnerungsgemeinschaft' verweist auf einen kollektivmemorialen Diskurszusammenhang (Assmann/Halbwachs-Tradition), ohne diesen zu explizieren. → args A2,A3
- [textorganisatorisch] Übergangswendung von A3/A4 zu A5: Die Formel 'bedeutet dies' schließt die Pluralisierungsdiagnose (A2, A3) und die Individualperspektive (A4) zu einer Konsequenz für die Lehrerprofessionalität (A5) zusammen und markiert die argumentative Scharnierposition des Absatzendes. → args A5,A3,A4

**`opus-4.7`**

- [kontextualisierend] Beleg von A1 durch Verweis auf Fend (2006) als etablierte Referenz der Schultheorie für die Enkulturationsfunktion von Schule. → args A1
- [textorganisatorisch] Kontrastsetzung zwischen einem historischen Verständnis und der gegenwärtigen Problemlage — bereitet A2 argumentativ vor, indem das nun zu Verwerfende explizit gemacht wird. → args A2
- [textorganisatorisch] Konklusive Überleitung von A3/A4 zu A5 — fokussiert die vorhergehende Diagnose auf das Handlungsfeld der Lehrkräfte und bereitet so das Thema des gesamten Buches (kulturelle Professionalität) vor. → args A5

---

## §3

### Synthese (interpretierend)

**`deepseek-v4-pro`** (in=3623 out=1755, 54.2s)

> Der Absatz verankert Bildungsprozesse anthropologisch im Selbst-Welt-Verhältnis und diagnostiziert deren Dynamik als durch Globalität radikalisiert, wodurch fortwährende Aushandlungsleistungen und die Suche nach kontingenten Sicherheitsmomenten nötig werden. Er betont zudem die gesellschaftliche Relevanz von Bildung, die ohne Teilhabeperspektive nicht denkbar sei. Vor dem Hintergrund der vorangegangenen Konstatierung eines Wandels schulischer Kulturvermittlung leistet der Absatz eine bildungstheoretische Fundierung, die die gesteigerte Komplexität und den notwendigen Gesellschaftsbezug professionellen Lehrerhandelns unter Globalisierungsbedingungen untermauert.

**`sonnet-4-6`** (in=4696 out=580, 12.1s)

> Der Absatz entfaltet einen bildungstheoretischen Unterbau für die vorangegangene schulpädagogische Problemdiagnose: Bildung wird als anthropologische Konstante gefasst — das Sich-in-Verhältnis-Setzen zu sich und zur Welt — die sich unter den Bedingungen von Globalität radikalisiert und zur fortwährenden Aushandlungsleistung wird. Die argumentative Funktion ist eine theoretische Fundierung der Komplexitätsdiagnose aus Absatz 2: Was dort als professionelles Navigationsdilemma von Lehrkräften erschien, wird hier bildungsphilosophisch tiefer verankert — und durch den abschließenden Verweis auf gesellschaftliche Teilhabe wird Bildung aus dem rein individuellen Selbstbezug herausgelöst und als sozial-politische Kategorie reformuliert, was den Anschluss an eine Theorie kultureller Professionalität vorbereitet.

**`opus-4.7`** (in=6544 out=585, 6.6s)

> Der Absatz rekurriert auf den klassischen Bildungsbegriff als Selbst-Welt-Verhältnis und radikalisiert dessen Dynamik unter Bedingungen von Globalität zu einer fortwährenden Aushandlungsleistung. Er schließt an die im Vorgänger diagnostizierte Brüchigkeit kultureller Selbstverständlichkeiten an und vertieft sie bildungstheoretisch, indem Bildung nicht nur als individuelle Selbstpositionierung, sondern konstitutiv als gesellschaftlich-teilhabebezogener Prozess konzeptualisiert wird. Damit bereitet er die Überleitung zu einem umfassenderen, sozial gefassten Bildungsbegriff (Tenorth) im Folgeabsatz vor.

### Codes (max 2)

| Modell | label | anchor_phrase | rationale |
|---|---|---|---|
| `deepseek-v4-pro` | Globalität als Dynamisierungsfaktor von Bildung | Globalität | Markiert die Ursache der radikalisierten Dynamik des Selbst-Welt-Verhältnisses, die die gegenwärtige kulturelle Bildungsherausforderung theoretisch fasst. |
| `deepseek-v4-pro` | Bildung und Teilhabe an Gesellschaft | Teilhabe an Gesellschaft | Fixiert die im Absatz hervorgehobene wechselseitige Bedingtheit von individueller Selbstverortung und gesellschaftlicher Partizipation als zentrales bildungstheoretisches Argument. |
| `sonnet-4-6` | Bildung als Selbst-Welt-Verhältnis unter Globalität | Momente der Sicherheit | Der Absatz bestimmt Bildung als strukturell auf Aushandlung angewiesenes Verhältnis von Selbst und Welt, das sich unter dem Druck von Globalität zur fortwährenden Leistung radikalisiert — dies ist der bildungstheoretische Kern, der die gesamte nachfolgende Argumentation zur kulturellen Professionalisierung trägt. |
| `sonnet-4-6` | Bildung als Voraussetzung gesellschaftlicher Teilhabe | Teilhabe an Gesellschaft | Die Wendung vom individuellen Selbstbezug zur gesellschaftlichen Relevanzdimension von Bildungsprozessen ist keine Nebenbemerkung, sondern öffnet die Argumentation für eine professions- und institutionentheoretische Anschlussfrage: Wer trägt Verantwortung für diese Teilhabedimension — und unter welchen Bedingungen? |
| `opus-4.7` | Bildung als Selbst-Welt-Verhältnis | zur Welt in ein Verhältnis | Der Absatz knüpft an die bildungstheoretische Grundfigur der Selbst-Welt-Relationierung an und macht sie zum Ankerpunkt der Argumentation. |
| `opus-4.7` | Bildung erfordert Teilhabe an Gesellschaft | Teilhabe an Gesellschaft | Die Pointe des Absatzes ist die Verkopplung individueller Selbstverortung mit gesellschaftlicher Teilhabe, die Bildung als sozial relevanten Prozess ausweist. |

### Arguments

**`deepseek-v4-pro`** — 3 arg(s), edges: inter=1 prior=3, 2 scaffolding (in=5063 out=7797, 373.1s)

- **argA1** [stated+stated] Die Dynamik der Selbst-Welt-Verhältnissetzung hat sich angesichts sozialer, sachlicher, zeit-räumlicher Komplexitätssteigerung (Globalität) radikalisiert und erfordert fortwährende Aushandlungsleistungen.
  - _stated:_ Dieser Prozess realisiert sich in einem Kontinuum des Wechselspiels zwischen der eigenen Weltsicht und veränderten Bedingungen, neuen Erkenntnissen wie Begegnungen.
  - _stated:_ Es gibt eine soziale, sachliche, zeit-räumliche Komplexitätssteigerung, kurz Globalität.
- **argA2** [carried+stated] Unter den Bedingungen radikalisierter Dynamik ist es erforderlich, innerhalb der kontingenten Fassung sachlicher und sozialer Weltbezüge Momente der Sicherheit aufzufinden, um selbstgewiss mit anhaltenden Veränderungen in Dialog zu treten.
  - _carried _(from §3)_:_ Die Dynamik hat sich radikalisiert und erfordert fortwährende Aushandlungsleistungen.
  - _stated:_ Sachliche und soziale Bezüge werden in kontingenten Fassungen erfahren.
- **argA3** [stated] Bildungsprozesse sind nicht nur individuell selbstbezüglich, sondern in ihrem Außenbezug gesellschaftlich relevant; Bildung als Selbstverortung ist ohne Perspektive auf gesellschaftliche Teilhabe nicht zu denken.
  - _stated:_ Bildungsprozesse vollziehen sich nicht nur in Selbstbezug, sondern auch im Bezug auf ein Außen, das gesellschaftlich relevant ist.

**`sonnet-4-6`** — 4 arg(s), edges: inter=3 prior=4, 4 scaffolding (in=7339 out=2563, 37.0s)

- **argA1** [stated+background] Es ist eine anthropologische Grundbedingung menschlicher Existenz, sich zu sich selbst und zur Welt in ein Verhältnis zu setzen; dieser Prozess vollzieht sich als fortlaufendes Wechselspiel zwischen eigener Weltsicht und veränderten Bedingungen, neuen Erkenntnissen und Begegnungen.
  - _stated:_ In den verschiedenen Ausdeutungen des Bildungsbegriffs wird seit Jahrhunderten reflektiert, dass es eine Bedingung menschlicher Existenz ist, sich zu sich selber und zur Welt in ein Verhältnis zu setzen.
  - _background:_ Bildungstheoretische Traditionen (Humboldt, transformatorische Bildungstheorie) konvergieren darin, Selbst-Welt-Verhältnis als konstitutives Moment von Bildung zu fassen.
- **argA2** [stated+carried] Unter Bedingungen von Globalität — verstanden als sozialer, sachlicher und zeiträumlicher Komplexitätssteigerung — hat sich die Dynamik des Selbst-Welt-Verhältnisses radikalisiert, sodass fortwährende Aushandlungsleistungen erforderlich werden.
  - _stated:_ Die Dynamik hat sich angesichts sozialer, sachlicher, zeiträumlicher Komplexitätssteigerung, kurz, angesichts von Globalität, radikalisiert und erfordert fortwährende Aushandlungsleistungen.
  - _carried _(from §2)_:_ Kulturelle Pluralisierung und der Aufbruch tradierter Wertvorstellungen machen Selbstpositionierung im Facettenreichtum kultureller Sinndimensionen erforderlich.
- **argA3** [stated+stated+background] Bildungsprozesse als Prozesse der Selbstverortung sind nicht nur individuell-subjektiv, sondern konstitutiv gesellschaftlich: Bildung ist ohne eine Perspektive auf gesellschaftliche Teilhabe nicht denkbar.
  - _stated:_ Bildungsprozesse sind dabei gerade nicht nur für das Individuum in seinem Selbstbezug, sondern in ihrem Bezug auf ein Außen auch gesellschaftlich relevant.
  - _stated:_ Bildung als Prozess der Selbstverortung ohne eine Perspektive auf Teilhabe an Gesellschaft nicht zu denken ist.
  - _background:_ Bildungstheoretisch gilt seit der Aufklärung, dass individuelle Bildung und gesellschaftliche Partizipation in einem konstitutiven, nicht nur akzidentellen Verhältnis stehen.
- **argA4** [stated+carried] Unter radikalisierten Bedingungen kultureller Dynamik und Globalität müssen Individuen Momente der Sicherheit innerhalb kontingenter Bezüge aufrechterhalten, um handlungs- und dialogfähig zu bleiben.
  - _stated:_ Es gilt, Momente der Sicherheit innerhalb der kontingenten Fassung sachlicher und sozialer Bezüge im Weltzusammenhang aufzufinden, und dadurch seiner selbst gewiss mit anhaltenden Veränderungen in den Dialog zu treten.
  - _carried _(from §2)_:_ Für das Individuum bleibt die Notwendigkeit bestehen, eine spezifische und tragfähige Selbstpositionierung im Facettenreichtum kultureller Sinndimensionen zu erreichen.

**`opus-4.7`** — 4 arg(s), edges: inter=3 prior=4, 4 scaffolding (in=9988 out=2909, 21.9s)

- **argA1** [stated+stated+background] Bildung im bildungstheoretischen Verständnis bezeichnet den konstitutiven menschlichen Prozess, sich zu sich selbst und zur Welt in ein Verhältnis zu setzen, wobei dieses Verhältnis sich im kontinuierlichen Wechselspiel zwischen bestehender Weltsicht und veränderten Bedingungen, neuen Erkenntnissen und Begegnungen realisiert.
  - _stated:_ In den verschiedenen Ausdeutungen des Bildungsbegriffs wird seit Jahrhunderten reflektiert, dass es eine Bedingung menschlicher Existenz ist, sich zu sich selber und zur Welt in ein Verhältnis zu setzen.
  - _stated:_ Dieser Prozess realisiert sich in einem Kontinuum des Wechselspiels zwischen der eigenen Weltsicht und veränderten Bedingungen, neuen Erkenntnissen wie Begegnungen.
  - _background:_ Das hier vorausgesetzte transformatorische Bildungsverständnis (Kokemohr, Koller) ist in der erziehungswissenschaftlichen Bildungstheorie etabliert und kann als tragfähige Referenz verwendet werden.
- **argA2** [stated+carried] Unter Bedingungen von Globalität – verstanden als Steigerung sozialer, sachlicher und zeit-räumlicher Komplexität – radikalisiert sich die Dynamik bildungstheoretischer Selbst-Welt-Relationierung und erfordert vom Subjekt fortwährende Aushandlungsleistungen.
  - _stated:_ Die Dynamik hat sich angesichts sozialer, sachlicher, zeit-räumlicher Komplexitätssteigerung, kurz, angesichts von Globalität, radikalisiert und erfordert fortwährende Aushandlungsleistungen.
  - _carried _(from §2)_:_ Kulturelle Ordnungszusammenhänge sind pluralisiert und tradierte Wertvorstellungen aufgebrochen, so dass Selbst-Welt-Verhältnisse brüchiger werden.
- **argA3** [stated] Die bildungstheoretische Aufgabe des Subjekts unter diesen Bedingungen besteht darin, innerhalb kontingenter sachlicher und sozialer Bezüge Momente der Sicherheit aufzufinden, um selbstgewiss in einen Dialog mit anhaltenden Veränderungen treten zu können.
  - _stated:_ Es gilt, Momente der Sicherheit innerhalb der kontingenten Fassung sachlicher und sozialer Bezüge im Weltzusammenhang aufzufinden, und dadurch seiner selbst gewiss mit anhaltenden Veränderungen in den Dialog zu treten.
- **argA4** [stated+stated] Bildung ist nicht nur individuell-selbstbezüglich, sondern konstitutiv gesellschaftlich relevant, weil sie als Prozess der Selbstverortung nur unter gleichzeitiger Perspektive auf gesellschaftliche Teilhabe gedacht werden kann.
  - _stated:_ Bildungsprozesse sind dabei gerade nicht nur für das Individuum in seinem Selbstbezug, sondern in ihrem Bezug auf ein Außen auch gesellschaftlich relevant.
  - _stated:_ Bildung als Prozess der Selbstverortung ist ohne eine Perspektive auf Teilhabe an Gesellschaft nicht zu denken.

### Edges

| Modell | edges (from→to: type) |
|---|---|
| `deepseek-v4-pro` | A2→A1: undefined; A1→§2:A4: undefined; A2→§2:A5: undefined; A3→§2:A4: undefined |
| `sonnet-4-6` | A2→A1: undefined; A4→A2: undefined; A3→A1: undefined; A1→§2:A3: undefined; A2→§2:A4: undefined; A3→§2:A5: undefined; A4→§2:A4: undefined |
| `opus-4.7` | A2→A1: undefined; A3→A2: undefined; A4→A1: undefined; A1→§2:A3: undefined; A2→§2:A3: undefined; A3→§2:A4: undefined; A4→§2:A4: undefined |

### Scaffolding

**`deepseek-v4-pro`**

- [kontextualisierend] Verankerung des Konzepts der Selbst-Welt-Verhältnissetzung in der bildungstheoretischen Tradition; legitimiert die anschließende Rede von diesem Prozess und bereitet die Argumente A1 und A3 sowie deren Bezug zu §2:A4 vor. → args A1,A3,§2:A4
- [rhetorisch] Verdichtende Gleichsetzung von Komplexitätssteigerung und Globalität; hebt den für A1 zentralen Begriff Globalität pointiert hervor und verleiht der Radikalisierungsdiagnose rhetorische Prägnanz. → args A1

**`sonnet-4-6`**

- [rhetorisch] Legitimierungsgestus für A1: Die Berufung auf 'Jahrhunderte' der Reflexion soll dem Claim eine traditionsgestützte Evidenz verleihen, ohne eine spezifische Tradition zu explizieren. Rahmt A1 als gesichertes bildungstheoretisches Gemeingut. → args A1
- [kontextualisierend] Dreifach-Quellenbeleg für A1: Die Literaturangaben sollen die Behauptung des Wechselspiels zwischen Weltsicht und veränderten Bedingungen als Kontinuum bildungstheoretisch absichern, insbesondere durch Verweis auf transformatorische Bildungstheorie (Koller, Kokemohr). → args A1
- [textorganisatorisch] Definitorische Kurzformel: 'Globalität' wird als verdichtender Sammelbegriff für soziale, sachliche und zeiträumliche Komplexitätssteigerung eingeführt. Fungiert als terminologische Scharniersetzung, die A2 mit dem im Werk-Outline angekündigten Theoriekapitel 'Globalität' verknüpft, ohne diesen Anschluss zu explizieren. → args A2
- [textorganisatorisch] Übergangswendung von A1/A2/A4 (individuell-subjektive Selbstverortung) zu A3 (gesellschaftliche Dimension): Die adversative Konstruktion 'nicht nur … sondern auch' verschiebt den Argumentationsfokus von der Innen- zur Außenperspektive und bereitet die Teilhabe-These von A3 vor. → args A3,A1

**`opus-4.7`**

- [kontextualisierend] Einbettung von A1 in die bildungstheoretische Tradition — markiert das Folgende als Rekurs auf einen etablierten Diskurs, nicht als eigene Setzung. → args A1
- [kontextualisierend] Quellenverweise als Beleg für A1 — verankern das transformatorisch-bildungstheoretische Verständnis an der einschlägigen Literatur (Koller, Kokemohr). → args A1
- [textorganisatorisch] Begriffliche Verdichtung/Einführung des Leitbegriffs 'Globalität' in A2 — bereitet zugleich das spätere Theoriekapitel zu Globalität vor. → args A2
- [textorganisatorisch] Konklusive Bündelung von A1–A4 und Übergang zum Folgeabsatz, der Tenorth und die soziale Dimension von Bildung aufgreift. → args A4

---

## §4

### Synthese (interpretierend)

**`deepseek-v4-pro`** (in=3791 out=1288, 37.2s)

> Der Absatz rekurriert auf Tenorths mehrdimensionale Bildungsdefinition, die Bildung als kommunikative Praxis, soziale Tatsache und distinktiven Habitus fasst, und schließt daraus, dass der implizite Werte- und Normengehalt von Bildung ihre kulturelle Formierung ausmache. Damit überführt er die zuvor entfaltete prozessuale Kulturperspektive in den Bildungsbegriff selbst und bereitet argumentativ den Übergang zur nachfolgenden Diagnose kultureller Superdiversität vor.

**`sonnet-4-6`** (in=4980 out=577, 10.5s)

> Der Absatz zitiert Tenorths mehrdimensionale Bildungsbestimmung, um Bildung als kommunikative Praxis, soziale Tatsache und Habitusgenese zugleich zu fassen — explizit jenseits eines rein subjektbezogenen Verständnisses. Die abschließende Syntheseformulierung ('Prozess der Selbstrelationierung zu sozialen Ordnungssystemen') vollzieht eine entscheidende argumentative Verknüpfung: Sie schließt den bildungstheoretischen Unterbau aus Absatz 3 (Bildung als Selbst-Welt-Verhältnis) an die kulturtheoretische Rahmung aus Absatz 1 (Kultur als implizit wirksames Wertereservoir) an und benennt erstmals explizit die kulturelle Formierung normativer Strukturen als Kern dieses Prozesses — womit die Brücke von der Bildungstheorie zur späteren Bestimmung kultureller Professionalität konzeptuell vorbereitet wird.

**`opus-4.7`** (in=6825 out=683, 6.7s)

> Der Absatz zitiert Tenorths Bildungsdefinition als mehrdimensionales Konstrukt — zugleich kommunikative Praxis, Individualmerkmal und soziale Tatsache, gespannt zwischen Prozess und Produkt, Wissen und Habitus. Daraus gewinnt der Autor eine eigene Zuspitzung: Bildung als Selbstrelationierung zu sozialen Ordnungssystemen, deren implizite Werte die kulturelle Formierung ausmachen. Funktional schließt der Absatz an die im Vorgänger angekündigte Verschränkung von Selbstverortung und Teilhabe an und liefert die soziologisch-bildungstheoretische Fundierung, um Bildung systematisch als kulturell imprägnierten Prozess lesbar zu machen — womit der Kulturbezug nicht additiv, sondern konstitutiv in den Bildungsbegriff eingeschrieben wird.

### Codes (max 2)

| Modell | label | anchor_phrase | rationale |
|---|---|---|---|
| `deepseek-v4-pro` | Bildung als mehrdimensionales Konstrukt | ein mehrdimensionales Konstrukt | Die Vokabel verdichtet Tenorths Befund, dass Bildung nicht nur individuell, sondern zugleich kommunikativ, sozialstrukturell und habitusprägend ist – und so den Kern des Absatzes trägt. |
| `deepseek-v4-pro` | kulturelle Formierung der Bildung | kulturelle Formierung | Der Ausdruck markiert die zentrale Ableitung des Absatzes: Dass die impliziten Werte und normativen Gestalten von Bildung selbst kulturell geformt sind, und verklammert so den Bildungsbegriff mit der vorhergehenden Kulturtheorie. |
| `sonnet-4-6` | Bildung als Selbstrelationierung zu sozialen Ordnungssystemen | Selbstrelationierung zu sozialen Ordnungssystemen | Diese Syntheseformel ist der argumentative Kernertrag des Absatzes: Sie integriert Tenorths mehrdimensionale Bildungsbestimmung und verbindet die bildungstheoretische Linie mit der kulturtheoretischen Rahmung, indem sie Bildung als strukturell-kulturell geformten Prozess fasst. |
| `sonnet-4-6` | Generalisierung universeller Kommunikationsprämissen als Bildungsziel | Generalisierung universeller Prämissen für Kommunikation | Tenorths Definition verankert die soziale Dimension von Bildung jenseits des Subjektbezugs und liefert den zitierten Ausgangspunkt, von dem aus die abschließende Synthese ihre Plausibilität gewinnt. |
| `opus-4.7` | Bildung als Selbstrelationierung zu sozialen Ordnungssystemen | Selbstrelationierung zu sozialen Ordnungssystemen | Hier formuliert der Autor die eigene bildungstheoretische Kernbestimmung, die Bildung konstitutiv an soziale Ordnungen und damit an kulturelle Formierung bindet. |
| `opus-4.7` | Bildung als mehrdimensionales Konstrukt (Tenorth) | mehrdimensionales Konstrukt | Die Tenorth-Referenz dient als theoretischer Anker, um Bildung gleichzeitig als individuelle, kommunikative und soziale Tatsache zu fassen und so den Weg zu ihrer kulturellen Lesart zu eröffnen. |

### Arguments

**`deepseek-v4-pro`** — FAILED: No JSON object found in LLM response

**`sonnet-4-6`** — FAILED: Expected ',' or '}' after property value in JSON at position 4723 (line 86 column 565)

**`opus-4.7`** — FAILED: Bad control character in string literal in JSON at position 2726 (line 34 column 258)

### Edges

| Modell | edges (from→to: type) |
|---|---|
| `deepseek-v4-pro` | _(skipped/failed)_ |
| `sonnet-4-6` | _(skipped/failed)_ |
| `opus-4.7` | _(skipped/failed)_ |

### Scaffolding

**`deepseek-v4-pro`**

_(none/failed)_

**`sonnet-4-6`**

_(none/failed)_

**`opus-4.7`**

_(none/failed)_

---

## §5

### Synthese (interpretierend)

**`deepseek-v4-pro`** (in=2354 out=2528, 65.2s)

> Der Absatz greift die Diskursverfasstheit von Kultur auf und führt die Zeitdiagnose kultureller Superdiversität sowie Enttraditionalisierung ein, die zu gesellschaftlichen Verunsicherungen und politischer Verhärtung führen. Er positioniert Bildung als notwendiges Mittel, um in dieser Unübersichtlichkeit temporäre Orientierung zu stiften, und untermauert dies mit Verweis auf bildungspolitische Initiativen wie das BMBF-Förderprogramm oder PISA 2018. Der Absatz schließt das Unterkapitel ab, indem er die zuvor theoretisch entfaltete kulturelle Komplexität in eine gesellschaftspolitische Diagnose überführt und die Dringlichkeit einer kulturell informierten Bildungspraxis betont, was die spätere Fokussierung auf Lehrkräfteprofessionalität vorbereitet.

**`sonnet-4-6`** (in=4901 out=508, 11.1s)

> Der Absatz verknüpft die bildungstheoretische Argumentation der vorangegangenen Absätze mit einer gesellschaftsdiagnostischen Gegenwartsbeschreibung: 'kulturelle Superdiversität', Enttraditionalisierung und die politischen Reaktionsformen (national-populistische Bewegungen) werden als Druckfelder benannt, die Bildungsprozesse zur Orientierungsstiftung dringlich machen. Argumentativ fungiert der Absatz als Schlussstein des Unterkapitels: Er überführt die theoretisch-bildungsphilosophische Rahmung (Absätze 3–4) in eine gesellschaftspolitische Dringlichkeitsbehauptung und legitimiert so die Fokussierung kultureller Professionalität als Forschungsgegenstand — wobei die abschließende Referenz auf bildungspolitische Impulse (BMBF, PISA 2018) das Argument vom wissenschaftlichen in den institutionellen Relevanzhorizont hinein verlängert.

**`opus-4.7`** (in=6636 out=664, 6.7s)

> Der Absatz diagnostiziert die Gegenwart als Zustand kultureller Superdiversität, in der Enttraditionalisierung und Individualisierung Sozialisationsprozesse erschweren und zu Verunsicherungen führen, die sich politisch in agonalen Verhärtungen und Populismus niederschlagen. Daraus wird die gesteigerte Bedeutung orientierungsstiftender Bildungsprozesse abgeleitet und durch bildungspolitische Evidenz (BMBF-Programme, PISA 2018 globale Kompetenzen) belegt. Funktional schließt der Absatz das Unterkapitel, indem die zuvor bildungstheoretisch entwickelte Ambivalenz von Kultur in eine gesellschaftsdiagnostische Dringlichkeitsformel überführt wird — kulturelle Orientierungsangebote in Schule erscheinen nun als Bearbeitung von Kohärenzdefiziten unter Bedingungen pluralisierter Ordnungen.

### Codes (max 2)

| Modell | label | anchor_phrase | rationale |
|---|---|---|---|
| `deepseek-v4-pro` | Temporäre Orientierung durch Bildung | temporäre Orientierung | Der Begriff verdichtet die zentrale Antwort auf die diagnostizierte Superdiversität und Verunsicherung: Bildungsprozesse sollen keine letztgültige Sicherheit, sondern eine vorübergehende Verortung in unübersichtlichen kulturellen Ordnungen ermöglichen. |
| `sonnet-4-6` | Kulturelle Superdiversität als Gegenwartsdiagnose | kultureller Superdiversität | Der Begriff markiert den soziologischen Kern der Zeitdiagnose, auf die das gesamte bildungspolitische und professionsbezogene Argument des Absatzes aufbaut. |
| `sonnet-4-6` | Bildung als temporäre Orientierungsstiftung | temporäre Orientierung finden lassen | Die Formulierung benennt den funktionalen Anspruch an Bildungsprozesse unter Bedingungen von Unübersichtlichkeit und verbindet die gesellschaftsdiagnostische mit der bildungstheoretischen Argumentationslinie des Subkapitels. |
| `opus-4.7` | Kulturelle Superdiversität als Zeitdiagnose | kultureller Superdiversität | Dieser Begriff bündelt die gesellschaftsdiagnostische Rahmung des Absatzes und liefert die Legitimationsbasis für die Notwendigkeit kultureller Orientierungsangebote in Schule. |
| `opus-4.7` | Defizite gesellschaftlich-kultureller Kohärenz | gesellschaftlich-kultureller Kohärenz | Formuliert die zentrale Problemdiagnose, auf die kulturelle Bildungsprozesse als temporäre Orientierungsstiftung antworten sollen. |

### Arguments

**`deepseek-v4-pro`** — FAILED: Bad control character in string literal in JSON at position 7680 (line 159 column 206)

**`sonnet-4-6`** — 3 arg(s), edges: inter=2 prior=4, 6 scaffolding (in=1042 out=4183, 57.7s)

- **argA1** [stated+stated+carried+background] Kulturelle Superdiversität als Kennzeichen der Gegenwart sowie Enttraditionalisierungs- und Individualisierungsprozesse steigern die Komplexität kulturell dimensionierter Sozialisierung in der Schule, da sie gegensätzliche Rahmungen (Kontingenz und Historizität) vervielfältigen und damit auch Weltsichten und Sinndimensionen pluralisieren.
  - _stated:_ In wissenschaftlichen Zeitdiagnosen wird von kultureller Superdiversität als Kennzeichen der Gegenwart gesprochen (Vertovec 2012).
  - _stated:_ Enttraditionalisierungs- und Individualisierungsprozesse erschweren die kulturell dimensionierte Sozialisierung; Kontingenz und Historizität rahmen Phänomene und vervielfältigen eingeschriebene Weltsichten und Sinndimensionen (Hörning 2004; Straub 2004).
  - _carried _(from §2)_:_ Kulturelle Pluralisierung macht das traditionelle Verständnis schulischer Kultureinführung als Hineinführen in ein geschlossenes Reservoir geteilter Werte und Normen nicht mehr tragfähig.
  - _background:_ Schulische Sozialisation ist konstitutiv auf kulturelle Orientierungsangebote angewiesen; deren Pluralisierung ist daher eine direkte Erschwernis schulischen Handelns.
- **argA2** [stated+stated+carried+background] Die durch Superdiversität und Enttraditionalisierung erzeugten Verunsicherungen zeigen sich gesellschaftlich in Diskursverhärtungen und im Erstarken national-populistischer Bewegungen, was die bildungspolitische und pädagogische Dringlichkeit von Orientierung ermöglichenden Bildungsprozessen erhöht.
  - _stated:_ Angesichts dieser Phänomene können Verunsicherungen auftreten, die sich in agonal verhärtete Positionen im öffentlichen Diskurs und im Erstarken national-populistischer Bewegungen zeigen.
  - _stated:_ Umso bedeutsamer ist es, Bildungsprozesse zu ermöglichen, die angesichts der nun schon alten Unübersichtlichkeit temporäre Orientierung finden lassen.
  - _carried _(from §3)_:_ Unter radikalisierten Bedingungen kultureller Dynamik und Globalität müssen Individuen Momente der Sicherheit innerhalb kontingenter Bezüge aufrechterhalten, um handlungs- und dialogfähig zu bleiben.
  - _background:_ Politische und gesellschaftliche Desintegrationsprozesse sind für Bildungstheorie und Schule relevante Kontextbedingungen, nicht nur Symptome ohne pädagogischen Adressierungsauftrag.
- **argA3** [stated+stated+background] Bildungspolitische Impulse — wie BMBF-Förderprogramme zur kulturellen Bildung und die Erhebung globaler Kompetenzen in PISA 2018 — belegen ein gestiegenes institutionelles Bewusstsein für die Relevanz kultureller Bildungsprozesse, wenngleich entsprechende Konzepte (etwa 'globale Kompetenzen') kritisch zu hinterfragen sind.
  - _stated:_ Bildungspolitische Impulse wie Förderprogramme des BMBF zur Erforschung kultureller Bildung und die Erhebung interkultureller/globaler Kompetenzen in PISA 2018 verweisen auf ein gestiegenes Bewusstsein für die Relevanz solcher Bildungsprozesse.
  - _stated:_ Kritisch dazu: Ress et al. 2022; Simpson & Dervin 2019.
  - _background:_ Bildungspolitik und internationale Leistungserhebungen fungieren als Indikatoren für gesellschaftliche Relevanzzuschreibungen, auch wenn ihre konzeptionellen Rahmungen wissenschaftlich umstritten sein können.

**`opus-4.7`** — 5 arg(s), edges: inter=4 prior=3, 6 scaffolding (in=1450 out=3597, 26.8s)

- **argA1** [stated+stated+carried] Die Gegenwart ist durch kulturelle Superdiversität gekennzeichnet, sodass Enttraditionalisierungs- und Individualisierungsprozesse die kulturell dimensionierte Sozialisierung erschweren, weil Kontingenz und Historizität die eingeschriebenen Weltsichten und Sinndimensionen von Phänomenen und Praxen vervielfältigen.
  - _stated:_ In wissenschaftlichen Zeitdiagnosen wird von kultureller Superdiversität als Kennzeichen der Gegenwart gesprochen (Vertovec, 2012).
  - _stated:_ Widersprüchliche Elemente wie Kontingenz und Historizität rahmen Phänomene, Ereignisse und Praxen und vervielfältigen die ihnen eingeschriebenen Weltsichten und Sinndimensionen.
  - _carried _(from §2)_:_ Tradierte kollektive Wertvorstellungen sind aufgebrochen und kulturelle Ordnungszusammenhänge pluralisiert.
- **argA2** [stated] Die kulturelle Komplexität und Unübersichtlichkeit der Gegenwart erzeugt Verunsicherungen, die sich gesellschaftlich in agonal verhärteten Diskurspositionen und im Erstarken national-populistischer Bewegungen manifestieren.
  - _stated:_ Angesichts dieser Phänomene können Verunsicherungen auftreten, die sich unter anderem in agonal verhärtete Positionen im öffentlichen Diskurs und im Erstarken national-populistischer Bewegungen zeigen.
- **argA3** [stated+carried] Gerade angesichts kultureller Unübersichtlichkeit und der daraus resultierenden gesellschaftlichen Verunsicherungen ist es bedeutsam, Bildungsprozesse zu ermöglichen, die temporäre Orientierung erlauben.
  - _stated:_ Umso bedeutsamer ist es, Bildungsprozesse zu ermöglichen, die angesichts der nun schon alten Unübersichtlichkeit temporäre Orientierung finden lassen.
  - _carried _(from §3)_:_ Bildung ist ein Prozess der Selbstrelationierung zu sich und zur Welt, der unter Bedingungen von Globalität Momente der Sicherheit inmitten von Kontingenz finden muss.
- **argA4** [stated+background] Ein gestiegenes gesellschaftliches Bewusstsein für die Relevanz kulturell orientierender Bildungsprozesse lässt sich an bildungspolitischen Impulsen belegen, namentlich an BMBF-Förderprogrammen zur Erforschung kultureller Bildung und an der Erhebung globaler/interkultureller Kompetenzen in PISA 2018.
  - _stated:_ Auf ein gestiegenes Bewusstsein für die Relevanz solcher Bildungsprozesse verweisen nicht zuletzt bildungspolitische Impulse wie Förderprogramme zur Erforschung kultureller Bildung des BMBF sowie die Erhebung globaler Kompetenzen in PISA 2018.
  - _background:_ Bildungspolitische Förderprogramme und OECD-Erhebungsentscheidungen können als Indikatoren eines gesellschaftlich-institutionellen Problembewusstseins gelesen werden.
- **argA5** [stated] Solche bildungspolitischen Akzentsetzungen zielen auf die Bearbeitung von Defiziten gesellschaftlich-kultureller Kohärenz und auf die Ermöglichung kultureller Ordnungszusammenhänge in ihrer Pluralität und Wandelbarkeit.
  - _stated:_ Solche Akzente beziehen sich nicht zuletzt auf die Dringlichkeit, Defizite gesellschaftlich-kultureller Kohärenz zu bearbeiten und kulturelle Ordnungszusammenhänge in ihrer Pluralität und Wandelbarkeit zu ermöglichen.

### Edges

| Modell | edges (from→to: type) |
|---|---|
| `deepseek-v4-pro` | _(skipped/failed)_ |
| `sonnet-4-6` | A1→A2: undefined; A2→A3: undefined; A1→§2:A2: undefined; A1→§2:A3: undefined; A2→§3:A4: undefined; A2→§2:A5: undefined |
| `opus-4.7` | A2→A1: undefined; A3→A2: undefined; A4→A3: undefined; A5→A4: undefined; A1→§2:A2: undefined; A3→§3:A3: undefined; A3→§2:A5: undefined |

### Scaffolding

**`deepseek-v4-pro`**

_(none/failed)_

**`sonnet-4-6`**

- [kontextualisierend] Dreifach-Quellenbeleg (Vertovec 2012, Hörning 2004, Straub 2004) für A1: Die Autorität soziologisch-kulturwissenschaftlicher Zeitdiagnosen soll die Behauptung der Komplexitätssteigerung und Pluralisierung von Sinndimensionen als wissenschaftlich gesichert ausweisen. → args A1
- [didaktisch] Exemplarische Konkretisierung der abstrakten These gesellschaftlicher Verunsicherung (A2): Diskursverhärtung und Populismus werden als anschauliche gesellschaftliche Symptome eingeführt, die den Brückenschlag von A1 (Komplexitätssteigerung) zu A2 (bildungspolitische Dringlichkeit) plausibilisieren sollen. → args A2
- [rhetorisch] Relevanzsetzung und Brücke zwischen A1/A2 und A3: Die adversativ-steigernde Formel 'umso bedeutsamer' transformiert die Diagnose (A1, A2) in einen normativen Handlungsauftrag und motiviert die nachfolgende bildungspolitische Evidenzführung (A3). Der Einschub 'nun schon alten Unübersichtlichkeit' verweist intertextuell auf Habermas (1985), ohne Quellenangabe. → args A2,A3
- [kontextualisierend] Beleg von A3 durch bildungspolitische Institutionenreferenz (BMBF) und internationales Erhebungsformat (PISA 2018): Dient als empirisch-institutionelle Stützung der These, dass kulturelle Bildungsprozesse bildungspolitisch anerkannt relevant sind. Der Querverweis auf 1.2.1 delegiert die ausführliche Kontextualisierung des BMBF-Programms in ein früheres Unterkapitel. → args A3
- [textorganisatorisch] Eröffnungsmarkierung des Absatzes: Die Formel 'auch in der Hinsicht' knüpft an die vorangegangenen Absätze des Unterkapitels an (schulische Kulturprozesse, Bildungsprozesse) und signalisiert, dass nun ein weiterer — diskursiv-zeitdiagnostischer — Betrachtungswinkel auf dieselbe Problemkonstellation eingenommen wird. Rahmt A1–A3 als letzten thematischen Zug im Unterkapitel. → args A1,A2,A3
- [textorganisatorisch] Schlusssatz des Unterkapitels: Fasst die bildungspolitische Evidenz (A3) und die gesellschaftsdiagnostische Dringlichkeit (A2) in einer normativ aufgeladenen Formel zusammen und projiziert die Konsequenz als programmatische Perspektive für die Arbeit (kulturelle Ordnungszusammenhänge in Pluralität und Wandelbarkeit). Fungiert als implizite Überleitung zum nächsten Unterkapitel ('Lehrkräfte als kulturelle Bildungsakteure'). → args A2,A3

**`opus-4.7`**

- [textorganisatorisch] Eröffnungssatz, der an die vorherigen Absätze anschließt und die Folgediagnose (A1) als weitere Facette des bereits etablierten Komplexitätsthemas rahmt. → args A1,§1:A3,§3:A2
- [kontextualisierend] Quellenverweis, der den Begriff der Superdiversität (Teil der Begründung von A1) an die einschlägige Referenz anbindet. → args A1
- [kontextualisierend] Belegverweis für die Rede von Kontingenz und Historizität als Rahmungen von Phänomenen und Praxen in A1. → args A1
- [kontextualisierend] Implizite Anspielung auf Habermas' Diagnose der 'Neuen Unübersichtlichkeit', die A3 in einen etablierten zeitdiagnostischen Diskurs einbettet. → args A3
- [textorganisatorisch] Interner Vorverweis, der die ausführliche Darstellung der bildungspolitischen Förderlandschaft (Beleg von A4) an ein späteres Kapitel delegiert. → args A4
- [kontextualisierend] Kritischer Gegenverweis zur PISA-Operationalisierung globaler Kompetenzen — relativiert den in A4 verwendeten Beleg, ohne ihn aufzugeben. → args A4

