/**
 * Contrast + colour-separation audit for the DelibraShift viz palette.
 *
 * Computes WCAG 2.1 contrast ratios for every text and mark token against the
 * surfaces it actually renders on, plus OKLab dE (x100) between token pairs
 * under normal, protan and deutan vision (Machado-Oliveira-Fernandes 2009,
 * severity 1.0). Only pairs that can appear in the same panel are reported.
 *
 * Values are READ FROM assets/tokens.css, never copied here. A hand-kept copy
 * drifts the moment someone edits the stylesheet, and a gate guarding colours
 * the page no longer uses is worse than no gate at all.
 *
 * Run: node spec/contrast_check.mjs   (exit 1 when any pair is below its floor)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function relLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklch(hex) {
  const [L, a, b] = linToOklab(hexToRgb(hex).map(srgbToLin));
  return { L, C: Math.hypot(a, b) };
}

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

function simulate(hex, kind) {
  const lin = hexToRgb(hex).map(srgbToLin);
  return MACHADO[kind].map((row) => row.reduce((acc, k, i) => acc + k * lin[i], 0));
}

export function deltaE(a, b, kind) {
  const A = linToOklab(kind ? simulate(a, kind) : hexToRgb(a).map(srgbToLin));
  const B = linToOklab(kind ? simulate(b, kind) : hexToRgb(b).map(srgbToLin));
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 100;
}

/** Audit name -> the custom property that actually carries the value. */
const TOKEN_NAMES = {
  bg: "--c-page",
  surface1: "--c-surface-1",
  surface2: "--c-surface-2",
  surface3: "--c-surface-3",
  arena: "--c-arena",
  text1: "--c-text-1",
  text2: "--c-text-2",
  text3: "--c-text-3",
  accent: "--c-accent",
  armE2e: "--c-arm-e2e",
  armWm: "--c-arm-wm",
  error: "--c-error",
  goal: "--c-goal",
  oob: "--c-oob",
  deadline: "--c-deadline",
  wind: "--c-wind",
  bounds: "--c-bounds",
};

const TOKENS_CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "tokens.css"),
  "utf8"
);

/**
 * Pull one theme block out of the stylesheet.  Blocks are matched by their
 * opening selector and closed at the first line that is exactly a brace at the
 * selector's own indentation, which is how this file is written throughout.
 */
function readTheme(selector) {
  const start = TOKENS_CSS.indexOf(selector);
  if (start < 0) { throw new Error(`tokens.css has no block for ${selector}`); }
  const body = TOKENS_CSS.slice(start, TOKENS_CSS.indexOf("\n}", start));
  const theme = {};
  for (const [name, prop] of Object.entries(TOKEN_NAMES)) {
    const hit = body.match(new RegExp(`${prop}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
    if (!hit) { throw new Error(`${selector} is missing a hex value for ${prop}`); }
    theme[name] = hit[1].toLowerCase();
  }
  return theme;
}

export const DARK = readTheme(":root {");
export const LIGHT = readTheme(':root[data-theme="light"] {');

const TEXT_TOKENS = ["text1", "text2", "text3"];
export const MARK_TOKENS = ["accent", "armE2e", "armWm", "error", "goal", "oob", "deadline", "wind"];

// Pairs that can appear inside one panel and must be told apart.  The fourth
// column is the colour-vision-deficiency floor this pair must clear; it is not
// uniform because the pairs do not carry the same load:
//   8  marks inside the arena, where colour is the only cue
//   6  outcome chips, which also carry an icon and a written label
//   0  chrome against data, which never appear as adjacent marks
const CVD_ARENA = 8;
const CVD_LABELLED = 6;
const CVD_EXEMPT = 0;
const NORMAL_MIN = 8;
const ARMS_NORMAL_MIN = 15;

const COPRESENT = [
  ["armE2e", "armWm", "arms: every comparison chart", CVD_ARENA, ARMS_NORMAL_MIN],
  ["armE2e", "goal", "arena: path vs goal disc", CVD_ARENA, NORMAL_MIN],
  ["armWm", "goal", "arena: path vs goal disc", CVD_ARENA, NORMAL_MIN],
  ["armE2e", "error", "arena: path vs error connector", CVD_ARENA, NORMAL_MIN],
  ["armWm", "error", "arena: path vs error connector", CVD_ARENA, NORMAL_MIN],
  // The map edge is drawn in the neutral --c-bounds, so red now appears only
  // as the crossing flash and the outcome chip - both of which arrive with an
  // icon and a written label rather than asking colour to carry the meaning.
  ["armE2e", "oob", "path vs out-of-bounds flash (icon + label)", CVD_LABELLED, NORMAL_MIN],
  ["armWm", "oob", "path vs out-of-bounds flash (icon + label)", CVD_LABELLED, NORMAL_MIN],
  ["error", "oob", "error connector vs out-of-bounds flash (icon + label)", CVD_LABELLED, NORMAL_MIN],
  ["error", "goal", "arena: error connector vs goal disc", CVD_ARENA, NORMAL_MIN],
  ["goal", "oob", "outcome chips: goal vs oob (icon + label)", CVD_LABELLED, NORMAL_MIN],
  ["goal", "deadline", "outcome chips: goal vs timeout (icon + label)", CVD_LABELLED, NORMAL_MIN],
  ["oob", "deadline", "outcome chips: oob vs timeout (icon + label)", CVD_LABELLED, NORMAL_MIN],
  ["armWm", "deadline", "error-vs-time: amber curve vs deadline rule", CVD_ARENA, NORMAL_MIN],
  ["accent", "armE2e", "chrome vs data, never adjacent marks", CVD_EXEMPT, CVD_EXEMPT],
  ["accent", "error", "chrome vs data, never adjacent marks", CVD_EXEMPT, CVD_EXEMPT],
  ["wind", "armE2e", "arena: wind field vs path", CVD_ARENA, NORMAL_MIN],
];

export { COPRESENT };

function report(name, T) {
  console.log(`\n================ ${name} ================`);
  console.log("-- text tokens, WCAG vs every surface they sit on (gate 4.5:1) --");
  for (const t of TEXT_TOKENS) {
    const row = [["page", T.bg], ["surf-1", T.surface1], ["surf-2", T.surface2], ["surf-3", T.surface3], ["arena", T.arena]]
      .map(([n, s]) => `${n} ${contrast(T[t], s).toFixed(2)}`)
      .join("  ");
    const worst = Math.min(
      ...[T.bg, T.surface1, T.surface2, T.surface3, T.arena].map((s) => contrast(T[t], s))
    );
    console.log(`  ${t.padEnd(6)} ${T[t]}  ${row}   worst ${worst.toFixed(2)}:1 ${worst >= 4.5 ? "PASS" : "FAIL"}`);
  }
  console.log("-- mark tokens, WCAG vs panel + arena (gate 3:1 for marks) --");
  for (const t of MARK_TOKENS) {
    const cs = contrast(T[t], T.surface1);
    const ca = contrast(T[t], T.arena);
    const { L, C } = oklch(T[t]);
    const worst = Math.min(cs, ca);
    console.log(
      `  ${t.padEnd(9)} ${T[t]}  panel ${cs.toFixed(2)}  arena ${ca.toFixed(2)}  OKLCH L ${L.toFixed(3)} C ${C.toFixed(3)}  ${worst >= 4.5 ? "PASS (text-safe)" : worst >= 3 ? "PASS (mark)" : "FAIL"}`
    );
  }
  console.log("-- co-present pair separation, OKLab dE x100 (floors per pair, see table) --");
  let failed = 0;
  for (const [a, b, why, cvdMin, normalMin] of COPRESENT) {
    const n = deltaE(T[a], T[b]);
    const p = deltaE(T[a], T[b], "protan");
    const d = deltaE(T[a], T[b], "deutan");
    const ok = n >= normalMin && p >= cvdMin && d >= cvdMin;
    if (!ok) { failed += 1; }
    console.log(
      `  ${(a + " / " + b).padEnd(22)} normal ${n.toFixed(1).padStart(5)}  protan ${p.toFixed(1).padStart(5)}  deutan ${d.toFixed(1).padStart(5)}  min ${String(cvdMin).padStart(2)}  ${ok ? "PASS" : "FAIL"}  ${why}`
    );
  }
  return failed;
}

// Only enforce when run directly, so the tuner can import the math quietly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures =
    report("DARK  (cockpit, default)", DARK) + report("LIGHT (print)", LIGHT);
  console.log(
    failures
      ? `\n${failures} pair(s) below their separation floor - the palette is not accessible yet.`
      : "\nEvery co-present pair clears its separation floor in both themes."
  );
  process.exit(failures ? 1 : 0);
}
