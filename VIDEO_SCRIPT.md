# DelibraShift — project-first video script (≤3 minutes)

This version keeps DelibraShift, its mechanism, and its evidence at the center.
The entrant does not appear in the narration. Codex attribution is included
briefly because it is relevant to Build Week, not as the subject of the film.

## Production format

- Six automated scenes rendered into one 1080p competition master.
- English report UI and English narration.
- Target duration: **2:50–2:55**, leaving a safety margin below three minutes.
- Speak calmly. Pause for half a second after each numerical result.
- Burn English captions into the MP4 and retain a separate SRT sidecar.
- Use no background music; the report, evidence, and narration carry the film.

## Source screens

Build the report first:

```bash
python report/build_report.py --lang en
```

The automated renderer uses these scenes in order:

1. `report/delibrashift_report.html`, on **What it is**.
2. The same report on **Lab**, replaying a visible-goal canonical episode.
3. The same report on **Results**, moving through findings and arm comparison.
4. `video/evidence.html?scene=evidence`, summarizing the published support.
5. `video/evidence.html?scene=codex`, summarizing disclosed Build Week roles.
6. The report on **Lab** again, with verification and closing overlays.

`video/build_video.py` reads the narration below directly, records Chromium,
generates the synthetic voice and subtitle timing, and assembles the final MP4.

## Narration and screen direction

The italic Polish text is a meaning guide only. Do not read it aloud.

### 0:00–0:18 — the question

**SCREEN:** Tab 1, **What it is**. Hold on the title and animated explanation.

> This is DelibraShift: a benchmark built around one question. What happens
> when the world keeps moving while an AI agent is still thinking? In a
> step-based evaluation, deliberation can be invisible. Here, it changes what
> the agent must be ready for.

*To DelibraShift: benchmark zbudowany wokół jednego pytania. Co dzieje się,
gdy świat porusza się dalej, kiedy agent AI nadal myśli? W ewaluacji krokowej
namysł może być niewidoczny. Tutaj zmienia stan, na który agent musi być gotowy.*

### 0:18–0:53 — show the mechanism

**SCREEN:** Switch to Tab 2, **Lab**. Start replay. Point once to the flight,
then to the prediction ghost, then leave the cursor still.

> During every fixed simulated deliberation budget, physics continues and the
> previous action remains latched. Only after that budget does the returned
> action engage. The orange trail is the actual flight. The ghost is the
> model's prediction of the engage-time state. Their separation makes the cost
> of stale reasoning visible. Wind, gravity, steering, deadlines, and a graded
> hot-or-cold signal are all part of the deterministic world.

*Podczas każdego stałego symulowanego budżetu namysłu fizyka działa dalej, a
poprzednia akcja pozostaje aktywna. Nowa akcja włącza się dopiero po tym
budżecie. Pomarańczowy ślad to rzeczywisty lot, a duch to przewidywany stan w
momencie włączenia akcji. Różnica pokazuje koszt rozumowania na nieaktualnym
stanie. Wiatr, grawitacja, sterowanie, deadline i stopniowany sygnał ciepło–zimno
tworzą deterministyczny świat.*

### 0:53–1:33 — the experiment and result

**SCREEN:** Switch to Tab 3, **Results**. Keep the main findings and arm
comparison visible; scroll only enough to reveal the four key metrics.

> We tested one seventy-billion-parameter model in a matched experiment: a
> direct end-to-end prompt versus a two-stage world-model scaffold. The
> scaffold raised action parsing from sixty-one point six percent to one
> hundred percent, and prediction coverage from fifty-eight point five to
> eighty-seven point five percent. But temporal anticipation fell in every one
> of twenty-one paired visible cells, and mean outcome fell from point one six
> nine to point zero nine zero. The outcome effect was mixed across individual
> cells, so this is a measured mean result, not a universal claim. The negative
> finding is published unchanged.

*Przetestowaliśmy jeden model 70B w dopasowanym eksperymencie: bezpośredni
prompt kontra dwuetapowy scaffold modelu świata. Scaffold poprawił parsowanie
akcji z 61,6% do 100%, a pokrycie predykcji z 58,5% do 87,5%. Antycypacja
czasowa spadła jednak we wszystkich 21 sparowanych widocznych komórkach, a
średni outcome z 0,169 do 0,090. Efekt outcome był różny w poszczególnych
komórkach, więc to wynik średni, a nie twierdzenie uniwersalne. Negatywny
rezultat opublikowano bez zmian.*

### 1:33–2:02 — evidence, not a screenshot claim

**SCREEN:** Show the local published-evidence card: 84 logs, the frozen-data
flow, support counts, and zero API keys needed for verification.

> The claim is backed by eighty-four canonical logs, three repetitions, frozen
> versioned prompts, and explicit support counts. The simulated clock—not host
> response time—defines the scored delay. Physics, scoring, baselines, and
> replay are deterministic. The complete published result can be verified
> offline without an API key, and the report itself makes no network requests.

*Twierdzenie opiera się na 84 kanonicznych logach, trzech powtórzeniach,
zamrożonych wersjonowanych promptach i jawnych liczebnościach. Punktowane
opóźnienie wyznacza zegar symulacji, nie czas odpowiedzi komputera. Fizyka,
scoring, baseline'y i replay są deterministyczne. Cały wynik można zweryfikować
offline bez klucza API, a raport nie wykonuje zapytań sieciowych.*

### 2:02–2:25 — how Codex was used

**SCREEN:** Show the local Build Week collaboration card. It presents roles
without names, model percentages, or promotional portraiture.

> DelibraShift was built during Build Week through human-directed collaboration
> with AI systems. Codex served as chief builder: implementing the simulator,
> harness, experiment runner, release hardening, and final audit. Architecture,
> visualization, and review contributions are disclosed separately. Technical
> decisions and model roles are preserved in the repository for inspection.

*DelibraShift powstał podczas Build Week w kierowanej przez człowieka współpracy
z systemami AI. Codex pełnił rolę głównego wykonawcy: zaimplementował symulator,
harness, runner eksperymentu, utwardzenie wydania i finalny audyt. Architektura,
wizualizacja i review są przypisane osobno. Decyzje techniczne i role modeli są
zachowane w repozytorium do kontroli.*

### 2:25–2:43 — verification and close

**SCREEN:** Return to the Lab replay. Show the compact verification overlay,
then replace it with the project tagline for the final sentence.

> The repository tests supported Python versions, packaged releases, scientific
> gates, and the offline report in a real browser. DelibraShift turns hidden
> deliberation lag into something visible, reproducible, and measurable. The
> world moves while agents think. Now an evaluation can move with it.

*Repozytorium testuje wspierane wersje Pythona, paczki wydania, bramki naukowe
i raport offline w prawdziwej przeglądarce. DelibraShift zamienia ukryte
opóźnienie namysłu w coś widocznego, powtarzalnego i mierzalnego. Świat porusza
się, gdy agenci myślą. Teraz ewaluacja może poruszać się razem z nim.*

## Accuracy guardrails

- Say **fixed simulated deliberation budget**, not measured model latency.
- Say **one evaluated 70B model**, not a general model ranking.
- Say **mean outcome fell**; do not imply the outcome fell in every cell.
- The all-pairs statement applies to temporal anticipation: **21 of 21 paired
  visible cells**.
- Same-seed byte identity is a documented same-host boundary for local runs;
  external model providers may still vary.
- The local Ollama checks are exploratory compatibility evidence and are not
  part of the official M2 claim, so they stay out of the main three-minute cut.

## Emergency short ending

If the recording reaches 2:40 before the final block, skip the GitHub Actions
tab and close directly on the Lab replay with:

> DelibraShift turns hidden deliberation lag into something visible,
> reproducible, and measurable. The world moves while agents think. Now an
> evaluation can move with it.
