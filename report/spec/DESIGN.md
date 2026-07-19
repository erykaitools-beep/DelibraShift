# DelibraShift / Windrift viewer - design system

Assets: `assets/tokens.css` (values), `assets/app.css` (layout + components),
`assets/sprites.svg` (inline symbol sheet). This file is the contract between
them and whoever writes the HTML.

Everything is offline: system font stacks, inline SVG, no network requests of
any kind. No user-facing string appears in CSS, SVG or JS; all copy comes from
`assets/strings.js` (PL default, EN alternate).

---

## 1. The idea the design has to carry

The world does not wait for the model to think. An action returned at tick `T`
latches at `T + B`, and during those `B` simulated ticks the craft keeps flying
under the *previous* action. Everything visual here exists to make one question
answerable at a glance: **did the model steer at where the craft will be, or at
where it was?**

That is why the interface is built around a pair of silhouettes - a solid craft
(what happened) and a dashed ghost (what the model said would happen) - joined
by a short error line. If those two ever separate, the model was steering into
the past.

Second thing the design has to carry honestly: in this run the craft almost
always falls out of the bottom of the map. **The layout is designed for
failure, not for a victory lap.** The out-of-bounds edge is a first-class
element, `oob` is the default outcome chip, and one lone `goal` (scenario
`g007b`, end2end) is the exception the eye should find, not the norm the layout
assumes.

Third: format failures are not cognition failures. `end2end` breaks JSON on
50-80% of cycles; `wm-scaffold` mostly does not. That difference belongs in a
clearly labelled control block, never mixed into a metric card.

---

## 2. Palette

Full values live in `assets/tokens.css`. Roles, not hexes, are what you write
against.

### 2.1 The two arms

| role | light | dark | meaning |
|---|---|---|---|
| `--c-arm-e2e` | `#2a78d6` | `#3987e5` | end2end - one prompt, prediction and action together |
| `--c-arm-wm` | `#b87400` | `#c98500` | wm-scaffold - predict first, then act on own prediction |

Blue against amber, deliberately: it is the pair that survives red-green colour
blindness with the most room to spare. Measured (OKLab dE x100, Machado 2009
severity 1.0):

| mode | normal | protan | deutan | gate |
|---|---:|---:|---:|---|
| light | 29.9 | 27.5 | 30.2 | >= 15 normal, >= 8 CVD |
| dark | 30.7 | 28.4 | 31.1 | >= 15 normal, >= 8 CVD |

Arm colour is never written by script. Put `data-arm="end2end"` or
`data-arm="wm-scaffold"` on any subtree and `--c-path`, `--c-path-fill`,
`--c-path-soft` and `--hatch-arm` follow.

### 2.2 Semantic roles

| token | job | form that also carries it |
|---|---|---|
| `--c-path` | flown trajectory (aliases the arm colour) | solid 2.5px line, beads at decisions |
| `--c-ghost` | model's prediction of its own state | same hue, hollow, dashed, dimmed |
| `--c-error` | prediction -> truth connector | 1.5px dashed with a dot cap |
| `--c-goal` | goal disc, goal outcome, heat ramp anchor | concentric rings + crosshair |
| `--c-oob` | map boundary and out-of-bounds outcome | dashed frame on all four edges |
| `--c-deadline` | deadline rule and timeout outcome | vertical dashed rule with a flag |
| `--c-wind` | wind field | small arrows, lowest contrast on the page |
| `--c-ref` | random / greedy / oracle baselines | thin rule on the scale, never a series |
| `--c-accent` | interface chrome only | focus ring, active tab, scrubber handle |
| `--c-unmeasurable` | fidelity is null | dashed border + italic + reason text |

Two rules that hold everywhere:

- **The ghost shares the path's hue on purpose.** It is that arm's belief about
  itself, so it belongs to that arm. Hollow + dashed + `--c-ghost-alpha` does
  the separating. Do not give the ghost its own hue.
- **The accent never encodes data.** It is allowed to sit near the blue arm
  under protanopia (dE 3.7 dark) precisely because it never means anything a
  reader has to decode.

### 2.3 Known-close pairs and their mitigation

Measured with `node spec/contrast_check.mjs`. These pairs sit below the dE 8
CVD bar and are shipped only because form and label carry them:

| pair | deutan dE (dark / light) | why it is safe |
|---|---|---|
| `--c-error` vs `--c-goal` | 3.8 / 1.4 | a 1.5px dashed 10px connector vs a filled ring with crosshair and a label; never adjacent |
| `--c-arm-wm` vs `--c-oob` | 5.7 / 7.3 | amber curve inside the field vs a red dashed frame on the perimeter |
| `--c-oob` vs `--c-deadline` | 9.1 / 10.9 | same family on purpose - both mean "the run ends here" - separated by icon + label on chips and by placement (frame vs vertical rule) |
| `--c-goal` vs `--c-oob` | 7.2 / 7.7 | outcome chips always ship icon + label + colour |

Outcome is **never** colour alone. `cg-out-goal`, `cg-out-oob`,
`cg-out-timeout` plus the string from `strings.js` are mandatory on every
outcome chip.

### 2.4 Measured contrast

All text tokens clear WCAG 4.5:1 against every surface they render on, in both
themes. Worst case per token:

| token | dark | light |
|---|---:|---:|
| `--c-text-1` | 12.16:1 | 15.35:1 |
| `--c-text-2` | 7.31:1 | 6.52:1 |
| `--c-text-3` | 5.15:1 | 4.91:1 |

Marks against the panel surface and the arena surface, worst of the two:

| token | dark | light |
|---|---:|---:|
| `--c-accent` | 6.35 | 7.95 |
| `--c-arm-e2e` | 4.91 | 4.42 |
| `--c-arm-wm` | 5.82 | 3.79 |
| `--c-error` | 6.37 | 5.37 |
| `--c-goal` | 6.80 | 4.62 |
| `--c-oob` | 4.83 | 5.36 |
| `--c-deadline` | 3.54 | 8.06 |
| `--c-wind` | 3.08 | 3.03 |

Re-run `node spec/contrast_check.mjs` after touching any colour token.

### 2.5 Themes

`:root` is the dark cockpit and is the default. `:root[data-theme="light"]` is
the print theme; `@media print` forces it regardless of the toggle. The light
theme is re-stepped against white, not an inversion.

Deliberate deviation from the usual pattern: the OS `prefers-color-scheme`
setting is **not** consulted, because the client asked for the cockpit to be
the default look for everybody. If OS-following is ever wanted, one block does
it, and it must sit after the light block so an explicit toggle still wins:

```css
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) { /* copy of the light token block */ }
}
```

---

## 3. Type

Two system stacks, two jobs.

- `--font-sans` carries prose: headings, explanations, table labels.
- `--font-mono` carries every number, tick, coordinate, axis tick, table column,
  chip and raw model response. If it came out of the simulator, it is mono.
  This is the whole typographic idea: telemetry always looks like telemetry, so
  a reader can tell a measurement from a sentence without reading either.

Scale `--fs-1` (11px micro label) through `--fs-9` (52px hero readout). Micro
labels are uppercase mono at `--ls-label` tracking - the instrument-panel
convention, and the only place letter-spacing is used. Body text stays under
68ch. Every column of digits gets `font-variant-numeric: tabular-nums`; the
`.cg-num` / `.cg-mono` helpers already do it.

---

## 4. Layout

Shell: sticky top rail (identity, scenario picker, arm switch, theme and
language toggles), sticky tab bar under it, then one panel set per tab.

Three tabs, matching the `tab.*` keys in `assets/strings.js`:

| tab | string key | icon | contains |
|---|---|---|---|
| what it is | `tab.what` | `cg-info` | the lag explanation, the ghost, one worked cycle |
| results | `tab.results` | `cg-tab-table` | metric cards, arm comparison, scenario table, error-over-time, decoy pairs |
| lab | `tab.lab` | `cg-tab-replay` | the arena, cycle by cycle, plus the raw response panel |

The remaining tab icons (`cg-tab-overview`, `cg-tab-error`, `cg-tab-decoy`,
`cg-tab-raw`) are for the panel headers inside those tabs, so a reader scanning
the results tab can still tell the four blocks apart at a glance.

Grid: 12 columns, `--sp-4` gap, `.cg-col-*` helpers. The lab tab uses
`.cg-stage`, a two-column grid of arena plus a `--w-rail` instrument rail.

Breakpoints:

| width | change |
|---|---|
| > 1400px | arena + 340px rail |
| 1180-1400px | rail narrows to 288px |
| < 1180px | rail drops under the arena and becomes a wrapping row; arena caps at 760px |
| < 860px | single column, denser padding, scrubber takes its own row |

Wide things (tables, the raw panel) scroll inside their own container. The page
body never scrolls sideways.

---

## 5. The four chart types

### 5.1 Two arms with a min-max range

Grouped horizontal bars, one metric per row, one bar per arm, 2px surface gap
between the pair. The bar is the mean across repetitions; a thin whisker spans
min to max. When repetitions are identical - which is the usual case here - the
whisker collapses to nothing, and that is the finding, so mark it with the
`cg-equals` glyph instead of leaving an empty gap.

Baselines (`random` 0.0885, `greedy` 0.3358 / temporal 0.4707, `oracle` 0.9807
/ temporal 0.6393) are `.cg-bar__ref` rules on the same 0-1 scale, in
`--c-ref`, labelled once in the legend. They are references, not a third and
fourth series - never give them arm colours.

Every axis is 0-1 because every cognition metric is 0-1. Never a second y-axis.

### 5.2 Per-scenario table with micro bars

One row per scenario x arm x repetition, grouped by scenario with a stronger
rule at each group start. Numeric columns are mono, right-aligned, tabular.
The `outcome` column is a chip. A `--c-arm-*` micro bar sits in the score
column so the table scans like a chart.

Null fidelity renders as the reason string from `strings.js`
(`insufficient_coverage`, `too_few_cycles`, `not_requested`) in
`--c-unmeasurable`, italic, on a dashed hatched bar. **Never 0, never an empty
cell, never a dash.** Zero is a measurement; null is the absence of one.

Control columns - `action_parse_rate`, `prediction_parse_rate`,
`prediction_coverage`, `retried_cycle_rate` - live in a visually separated
block with its own `.cg-note[data-tone="control"]` header, because they measure
formatting, not cognition.

### 5.3 Prediction error over time

x = tick, y = euclidean error in metres between the model's predicted state at
`T + B` and the true state at `T + B`. One line per arm, points at each cycle,
hover crosshair with a tooltip.

Two reference layers make the chart readable:

- the **persistence floor** (`persistence_floor_fidelity`): the error you get
  by predicting "nothing changes". A model at or above that line has not
  modelled the world at all. Drawn in `--c-ref`, dashed.
- the **deadline** rule in `--c-deadline`. With real data it sits far to the
  right of every curve, since episodes end at tick 65-169 against deadlines of
  380-600. That gap is itself informative: nothing here dies of old age.

Cycles where the model echoed its current position back as its prediction get a
hollow marker, because that is a distinct failure from being wrong.

### 5.4 Normal vs decoy pairs

Two `.cg-pair__cell` columns per scenario, normal on the left, decoy on the
right, with the delta between them stated as a number. The finding is that the
delta is exactly zero: with a false heat signal the model flies the identical
path, so it never used the signal at all.

Design for that. Equality gets the `cg-equals` glyph and an explicit sentence
from `strings.js`; it must not look like a rendering bug or a missing series.

---

## 6. Motion

| token | value | used for |
|---|---|---|
| `--dur-1` | 90ms | hover, swatch, chip |
| `--dur-2` | 180ms | tab, row, chevron |
| `--dur-3` | 320ms | panel reveal |
| `--dur-4` | 520ms | chart series draw-in |
| `--dur-beat` | 700ms | one deliberation window during replay |

Easing: `--ease-out` for entrances and anything the user triggered,
`--ease-in-out` for position changes, `--ease-snap` only for the scrubber
handle.

Replay is paced by simulated ticks, never by wall clock: one cycle takes
`--dur-beat`, so the craft advances `B` ticks per beat regardless of how long
the model actually took. Host latency is telemetry, never timing.

`prefers-reduced-motion: reduce` collapses all five durations to 1ms in
`tokens.css`. Nothing is removed - state changes still land, they just land
instantly. Do not add motion that is not expressed through these tokens, or the
opt-out will miss it.

---

## 7. The arena

### 7.1 Coordinate system

The SVG keeps its `viewBox` equal to its own CSS pixel box - `viewBox="0 0 W H"`
where `W`/`H` come from a `ResizeObserver` on `.cg-arena`. One user unit is
therefore one CSS pixel: every stroke token in `tokens.css` is literal, text is
crisp, and `vector-effect` is never needed.

The container is `aspect-ratio: 1 / 1` because the world is square (0-100 m on
both axes).

```
pad   = --arena-pad (28px)
scale = (min(W, H) - 2 * pad) / 100          px per metre
sx(x_m) = pad + x_m * scale
sy(y_m) = pad + (100 - y_m) * scale          y is flipped: 0 m is at the bottom
```

Screen y is flipped, so a velocity vector `(vx, vy)` in world units points at
`atan2(-vy, vx)` on screen. Feed that, in degrees, straight into the craft's
rotation.

Sprite placement, identical for craft, flame and ghost because the three share
one frame:

```html
<g transform="translate(sx, sy) rotate(deg)">
  <use href="#cg-flame" x="-16" y="-10" width="32" height="20" class="cg-icon cg-flame"/>
  <use href="#cg-craft" x="-16" y="-10" width="32" height="20" class="cg-icon cg-icon--craft cg-craft"/>
</g>
```

Width 32 / height 20 gives a 32px craft; scale both by
`--craft-len / 32` to resize. Thrust scales the flame only: wrap the flame
`<use>` in `<g transform="scale(k,1)">` with `k = |accel| / max_accel_mps2`,
and omit the flame entirely when the latched action is `(0, 0)` - which, in this
data, is most of the time. An idle engine is a finding.

### 7.1a Tokens the script reads

These exist in `tokens.css` but are consumed by JS rather than by a CSS rule.
Read them with `getComputedStyle(document.documentElement).getPropertyValue(...)`
so a theme change is picked up, and never hardcode their values:

`--arena-pad`, `--arena-grid-step`, `--arena-grid-major`, `--craft-len`,
`--ghost-len`, `--goal-r-min`, `--bead-r`, `--bead-r-active`, `--dur-beat`,
`--z-arena-field`, `--z-arena-marks`.

One token goes the other way: the chart draw-in animation needs the path length,
so the script sets `--draw-len` inline on each `.cg-chart__series[data-animate]`
element from `path.getTotalLength()`. The CSS carries a 1000 fallback so a
missing value degrades to a slightly-off animation, never to an invisible line.

### 7.2 Draw order, back to front

1. **arena surface** - `--c-arena`, the darkest plane on the page.
2. **heat field** - radial ramp `--c-heat-0` to `--c-heat-4` centred on the
   goal, plus iso-heat rings in `--c-heat-ring` at heat 0.25 / 0.5 / 0.75.
   `heat = exp(-distance / 20)`, so the rings sit at 27.7 m, 13.9 m and 5.8 m.
   With `goal_visible: false` this field is the only trace of where the goal is
   - draw it, and draw the goal marker in `--c-goal-hidden`, dashed.
3. **grid** - every 10 m in `--c-grid`, every 50 m in `--c-grid-major`, with
   metre labels outside the field in the pad.
4. **boundary** - dashed frame in `--c-oob` on all four edges. This is where
   almost every episode ends, so it is a drawn object, not a container edge.
5. **wind field** - `cg-wind` arrows on a coarse lattice, length and direction
   from `wind_forecast_x_mps2`. Wind is horizontal only. Lowest contrast on the
   page; it is weather, not data.
6. **goal** - `cg-goal` scaled to `goal_radius_m` but never below
   `--goal-r-min`, so a 2 m disc stays clickable at any window size. On a decoy
   run the false target is `cg-goal-decoy` in `.cg-decoy` (neutral
   `--c-goal-hidden`, struck through) - a lie is not a data series and must
   never wear a data hue.
7. **future path** - the not-yet-flown remainder, `--c-path-trail`, dashed
   `--dash-future`. It says "this is a recording", which is honest, and it lets
   the reader see the crash coming.
8. **flown path** - solid `--c-path`, `--sw-path`, with a `.cg-bead` diamond at
   every decision point. Beads with a failed parse get a dashed outline.
9. **truth marker** - `.cg-truth`, a ring with a filled core at the state the
   simulator actually reached at `T + B`. Arm colour, because it is that run's
   own ground truth.
10. **error connector** - `.cg-errline` from the ghost to the truth marker,
    with a dot cap at the truth end. Its length *is* the error, so the reader
    measures it without reading a number.
11. **ghost** - the predicted silhouette at `T + B`, hollow and dashed.
12. **action vectors** - two `cg-wind` arrows from the craft's centre, scaled
    by `|accel| / max_accel_mps2` and rotated to the acceleration direction.
    `.cg-vector[data-kind="held"]` is solid: the latched action doing work
    right now. `.cg-vector[data-kind="commanded"]` is dashed and dimmed: the
    decision just returned, which does nothing for `B` more ticks. Same hue,
    because both belong to this arm; solid versus dashed carries "already real"
    versus "not yet".
13. **craft** - flame first, then hull, then the `cg-think` bubble while the
    deliberation window is open.
14. **HUD** - `.cg-hud` corner readouts (tick, heat, latched action, outcome),
    over everything, `pointer-events: none`.

### 7.3 What each element asserts

| element | reads as | string key |
|---|---|---|
| solid craft | where the craft actually is at this tick - the state the model was shown | `arena.legend.craft` |
| dashed ghost | where the model claimed it would be when its action starts | `arena.legend.ghost` |
| truth ring | where the craft really is at that same moment | `arena.legend.truth` |
| error connector | the gap between those two - the whole benchmark in one segment | `arena.legend.error_line` |
| solid vector | the latched action, doing work right now | `arena.legend.held` |
| dashed vector | the action just returned, inert for `B` more ticks | `arena.legend.commanded` |
| bead on the path | a decision point; a dashed bead is a cycle the model failed to format | `arena.legend.trail` |
| dashed frame | the map edge; touching it ends the run as `oob` | `arena.legend.bounds` |
| teal field | proximity to the goal; the only clue when the goal is hidden | `arena.legend.goal_hidden` |
| struck target | the decoy: heat pointed at a false position | `arena.legend.decoy` |
| wind arrows | the lateral force the forecast promised for those ticks | `arena.legend.wind` |
| flame | thrust actually latched - absent means the model commanded nothing | - |

Every legend row is `.cg-legend__item` with a `.cg-swatch` whose `data-shape`
mirrors the mark it stands for (`line`, `dash`, `disc`, `ring`, `hatch`), so
the legend survives greyscale printing.

### 7.4 Deliberation, made visible

While a cycle is being decided, the craft shows `cg-think`, the scrubber paints
a `.cg-scrub__delib` band across the `B` ticks in question, and the path drawn
during that band keeps the *previous* action's colour weight. When the new
action latches, the band closes and the bead fills. That single beat - think,
drift, latch - is the benchmark, and it should be the first thing a newcomer
notices without reading a word.

---

## 8. Interaction

Charts are interactive by default: crosshair plus tooltip on the line charts,
per-mark tooltip on bars, cells and beads. Hit targets are at least 24px even
when the mark is 9px. Filters (scenario, arm, repetition, decoy on/off) sit in
one row above the panels, never inside them.

Keyboard: tabs are a proper tablist; the scrubber is a slider with arrow-key
stepping by one cycle; `.cg-raw` is a native `<details>`. Focus is always
visible through `--glow-focus`.

A table view exists for every chart - the scenarios tab *is* the table view -
so no finding is locked inside a picture.

---

## 9. Texture channel

`[data-texture="on"]` on `<html>` turns on the secondary encoding: end2end
takes a 45-degree hatch, wm-scaffold its 135-degree mirror. HTML fills use
`--hatch-a` / `--hatch-b` drawn in the surface colour, so the hatch cuts
grooves rather than adding a hue. SVG fills need two `<pattern>` definitions in
the page's own `<defs>`, with ids `cg-hatch-a` and `cg-hatch-b`; `app.css`
already points `.cg-chart__band` at them.

Texture is never on by default and never decorative. It exists for print, for
`forced-colors`, and for readers who ask for it.

---

## 10. Checklist before shipping a screen

- [ ] Null fidelity says why it is null; it never shows 0.
- [ ] Every outcome carries icon + label + colour.
- [ ] Format controls (parse rates, retries) are visually separated from
      cognition metrics.
- [ ] Deterministic baselines are rules, not series.
- [ ] Two series means a legend is present, and both are directly labelled.
- [ ] Wide content scrolls in its own box; the body does not.
- [ ] `node spec/contrast_check.mjs` passes after any colour change.
- [ ] No string is hardcoded outside `assets/strings.js`.
- [ ] The page opens from `file://` with the network switched off.
