# COPY.md - narrative copy for the DelibraShift visualization

Source of truth for all user-visible text: `report/assets/strings.js`.
This document is the **long form**: the narrative for the "Co to jest" tab and
the one-line captions for every arena element, each mapped to its key.

Nothing here is rendered directly. If you need to change wording, change
`strings.js` and update this file to match.

---

## 0. Contract for whoever builds the view

- **Charset.** `strings.js` is UTF-8 and contains Polish diacritics. The host
  page MUST carry `<meta charset="utf-8">` or the copy renders as garbage from
  a `file://` URL. This is the single most likely way to break the deliverable.
- **Default language is `pl`.** The switch flips to `en`; both dictionaries
  hold the same 377 keys, in the same order.
- **Placeholders** use `{braces}`. Tokens in use: `{n}`, `{total}`, `{value}`,
  `{reason}`, `{arm}`, `{scenario}`, `{tick}`, `{b}`, `{min}`, `{date}`.
  Both languages carry identical token sets on every key - verified by script.
- **No text in JS/HTML.** Every label, tooltip, empty state and axis title goes
  through the table. A hardcoded string is a bug, not a shortcut.
- **No emoji.** Icons are inline SVG owned by the view layer.
- **Numbers are data, not copy.** The table never hardcodes a measured value.
  Reference constants (random 0.0885, greedy 0.3358 / 0.4707, oracle 0.9807 /
  0.6393) come from the data layer and are labelled with the `ref.*` keys.

---

## 1. Narrative: the "Co to jest" tab

Seven short paragraphs. Each is a `story.*` pair: `.title` + `.body`. They are
ordered to walk a stranger from a familiar feeling (lag) to the four measures,
without a single formula. Read end to end it is about 60 seconds.

### 1.1 `story.lag.title` / `story.lag.body`

> **Zacznij od laga**
>
> Grasz na słabym łączu. Wciskasz skręt. Postać skręca pół sekundy później, bo
> przez ten czas serwer liczył swoje. Nie sterujesz tym, co widzisz. Sterujesz
> tym, co już się wydarzyło.

Purpose: land the whole benchmark in a feeling the reader already owns. No
jargon at all in the opening paragraph.

### 1.2 `story.ghost.title` / `story.ghost.body`

> **Duch**
>
> Gracze nazywają to duchem. Na ekranie stoisz w jednym miejscu, a serwer
> trzyma cię gdzie indziej. Kto celuje w obraz, ten pudłuje. Kto trafia, ten
> strzela w miejsce, gdzie postać dopiero będzie.

Purpose: name the object the arena will draw. From here on "duch" is a defined
term and the visualization can use it without a glossary.

### 1.3 `story.rule_a.title` / `story.rule_a.body`

> **DelibraShift robi to celowo**
>
> To jest reguła A. Gdy model myśli, świat przesuwa się o B tyknięć do przodu.
> Akcja wymyślona w tyknięciu T zaczyna działać dopiero w T plus B. Przez ten
> czas pracuje poprzednia zatrzaśnięta akcja. Nikt nie mierzy, jak długo model
> liczył naprawdę - zwłoka jest ustawiona z góry i identyczna dla wszystkich.

Purpose: the hinge paragraph. Also kills the obvious objection ("so a faster
GPU wins?") in its last sentence.

### 1.4 `story.world.title` / `story.world.body`

> **Świat: Windrift**
>
> Mapa sto na sto metrów. Grawitacja ciągnie w dół, boczny wiatr popycha na
> boki. Wiatr jest z góry rozpisany i model dostaje jego uczciwą prognozę -
> nic tu nie jest ukryte przez przypadek. Statek zwraca przyspieszenie. Lot
> kończy się wejściem w cel, wypadnięciem poza mapę albo końcem czasu.

Purpose: the rules of the board, and the fairness point - the answer is
computable from what the model was handed. Failure is not bad luck.

### 1.5 `story.heat.title` / `story.heat.body`

> **Ciepło i zimno**
>
> W części scenariuszy cel jest niewidoczny. Zostaje jeden trop: ciepło.
> Rośnie blisko celu, spada daleko. To dokładnie zabawa w ciepło-zimno, tylko
> że w locie i z wiatrem w bok.

Purpose: sets up the decoy finding, which is the strongest result in the data.

### 1.6 `story.arms.title` / `story.arms.body`

> **Dwa ramiona, ten sam model**
>
> Pytanie badawcze jest jedno: czy zmuszenie modelu do jawnego opisu świata
> poprawia sterowanie. Ramię end2end to jeden prompt - model naraz oddaje
> przewidywanie i akcję. Ramię wm-scaffold to dwa kroki: najpierw sam opis,
> gdzie statek będzie, potem sama decyzja podjęta na tym własnym opisie. Drugi
> krok nigdy nie widzi prawdy z symulatora.

Purpose: the experiment in one paragraph. The last sentence is the guarantee a
researcher will look for first.

### 1.7 `story.why_four.title` / `story.why_four.body`

> **Dlatego mierzymy cztery rzeczy**
>
> Jedna liczba niczego nie tłumaczy. Rozdzielamy: czy model wie, gdzie statek
> będzie; czy steruje z wyprzedzeniem; czy czyta ciepło; jak skończył lot.
> Osobno trzymamy liczniki formatu, bo model łamiący JSON to problem składni,
> nie myślenia. Mieszanie tych dwóch rzeczy to najczęstszy sposób na zawyżony
> wynik.

Purpose: the handoff into the metric cards. Also pre-justifies why the UI shows
control counters in a visually separate group.

### 1.8 `story.honest.title` / `story.honest.body` (closing note)

> **Wynik negatywny to też wynik**
>
> Prawie każdy przelot kończy się poza mapą. Tak to wygląda i tak to
> pokazujemy. Benchmark, który rysuje tylko udane loty, mierzy dobór obrazków,
> nie zdolności.

Purpose: sets expectations before the reader hits a results table full of
`oob`. Place it at the bottom of the tab or directly above the results table.

---

## 2. Arena captions - one sentence per element

Each caption is one sentence, keyed `arena.caption.*`, and pairs with a short
legend label keyed `arena.legend.*`. Show the label always; show the caption on
hover, on focus, or in a legend drawer.

| Element | Legend key | Caption key | PL caption |
|---|---|---|---|
| Postać (statek) | `arena.legend.craft` | `arena.caption.craft` | Statek w miejscu, w którym symulator ma go teraz - to jest stan, który model dostał w promptcie. |
| Duch predykcji | `arena.legend.ghost` | `arena.caption.ghost` | Duch stoi tam, gdzie model twierdzi, że statek będzie, gdy jego akcja wejdzie w życie. |
| Znacznik prawdy | `arena.legend.truth` | `arena.caption.truth` | Znacznik prawdy pokazuje, gdzie statek naprawdę będzie w tej samej chwili. |
| Linia błędu | `arena.legend.error_line` | `arena.caption.error_line` | Linia błędu łączy ducha z prawdą: im dłuższa, tym bardziej model steruje w nieistniejący świat. |
| Ślad lotu | `arena.legend.trail` | `arena.caption.trail` | Ślad to cała dotychczasowa trasa, tyknięcie po tyknięciu, bez skrótów. |
| Cel | `arena.legend.goal` | `arena.caption.goal` | Cel to dysk o promieniu `{value}` m; wlot w dysk kończy lot sukcesem. |
| Cel ukryty | `arena.legend.goal_hidden` | `arena.caption.goal_hidden` | W tym scenariuszu cel jest ukryty przed modelem - rysujemy go tylko dla widza. |
| Fałszywy cel | `arena.legend.decoy` | `arena.caption.decoy` | Fałszywy cel służy do sprawdzenia, czy model w ogóle czyta ciepło; model nie wie, że sygnał jest podmieniony. |
| Granice mapy | `arena.legend.bounds` | `arena.caption.bounds` | Granice mapy są twarde - dotknięcie krawędzi kończy lot wypadnięciem. |
| Wiatr | `arena.legend.wind` | `arena.caption.wind` | Strzałka wiatru pokazuje boczny podmuch w tym tyknięciu; model zna go z prognozy z wyprzedzeniem. |
| Pasek deadline | `arena.legend.deadline` | `arena.caption.deadline` | Pasek czasu odmierza tyknięcia do limitu; po jego wyczerpaniu lot kończy się bez wyniku. |
| Akcja zatrzaśnięta | `arena.legend.held` | `arena.caption.held` | Wektor zatrzaśnięty to akcja, która pracuje w tej chwili - wymyślona B tyknięć temu. |
| Akcja zwrócona | `arena.legend.commanded` | `arena.caption.commanded` | Wektor zwrócony to świeża decyzja modelu; zacznie działać dopiero za B tyknięć. |

Drawing note for the arena author: the ghost, the truth marker and the error
line are the whole point of the picture. If only three glyphs survive a
cramped layout, keep those three. `arena.caption.goal` takes `{value}` =
`goal_radius_m` from the scenario.

---

## 3. Findings copy - what it is allowed to claim

`finding.*` keys carry the interpretation. They were written against the raw
logs in `results/m2/logs/`, not against expectations. Each is safe to show only
while its underlying fact holds; if a later run changes the fact, change the
string.

| Key | Claim | Evidence it rests on |
|---|---|---|
| `finding.decoy.*` | The model ignores the hot/cold signal | Every masked scenario pair (g007a, g007b, g007c, both arms) produced an identical action sequence and an identical closest approach under true heat and decoy heat. |
| `finding.format.*` | Retry differences are formatting, not cognition | The single-prompt arm retries a large share of cycles; the two-stage arm's action stage parses far more reliably, while its prediction stage still fails. |
| `finding.scaffold.*` | Scaffolding does not improve flying in this run | Structured-output reliability and coverage improve, while paired temporal anticipation and mean outcome decrease. |
| `finding.oob.*` | Almost everything ends out of bounds | Flights close after a handful of decision cycles; `goal` occurs only in the g007b end2end pair. |
| `finding.floor.*` | Prediction sits just above the persistence floor | Fidelity is well above the nothing-changes floor, but far below what the supplied numbers permit. |
| `finding.caveat` | Scope guard, always visible | One run, one model. Not a ranking. |

`finding.caveat` should render next to the findings block at all times, not
behind a disclosure.

---

## 4. Empty states - what the UI must never do

The run may still be in flight and `results/m2/report.json` may not exist. The
copy handles four distinct situations, and they must not be collapsed into one
generic message:

1. `empty.run_in_progress` - logs exist, the run is not finished.
2. `empty.no_report` - no aggregate report; everything is computed from logs.
3. `empty.metric_unmeasurable` + a `reason.*` value - the metric is `None`.
   Render as "Niemierzalne: za małe pokrycie przewidywań". **Never render a
   `None` metric as 0.** `reason.note` states this in the UI itself.
4. `empty.no_episodes` - filters exclude everything; offer
   `results.filter.clear`.

Reason keys map one-to-one onto the values the scorer emits:

| Scorer reason | Key |
|---|---|
| `insufficient_coverage` | `reason.insufficient_coverage` |
| `too_few_cycles` | `reason.too_few_cycles` |
| `not_requested` | `reason.not_requested` |
| masked-goal temporal exclusion | `reason.masked_goal` |
| mean weight below threshold / no scored cycles | `reason.low_weight`, `reason.no_scored_cycles` |
| feedback band below threshold | `reason.low_band` |
| probe scenario | `reason.probe_scenario` |
| anything else | `reason.unknown` |

---

## 5. Footer

`footer.*` carries the provenance block: model id, the four frozen prompt
versions (`1.0`, `wm-scaffold-1.0`, `probe-format-1.0`, `probe-choice-1.0`),
pack name and version, log schema version, host class, and the data date. Three
standing notes accompany it: `footer.frozen_note` (prompts are hash-pinned),
`footer.determinism_note` (byte-identical logs), and `footer.offline_note`
(this page never touches the network).

---

## 6. Tone rules used here, for anyone adding copy later

- Short sentences. One idea per sentence.
- Concrete nouns. "Statek", "krawędź", "podmuch" - not "instancja", "system".
- Analogies come from games and from a building site. They are load-bearing for
  the lay reader and must stay accurate for the researcher.
- No exclamation marks. No emoji. No corporate filler ("wykorzystujemy
  zaawansowane", "kompleksowe rozwiązanie").
- A measurement that did not happen is never reported as a zero.
- English is a real translation, not a gloss: it keeps the same rhythm and the
  same claims, and it is the version a reviewer will read.
