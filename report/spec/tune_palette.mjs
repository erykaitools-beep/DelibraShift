/**
 * Pick a palette that clears every separation floor in BOTH themes at once.
 *
 * The failure was structural, not a rounding error: error (pink), goal (green)
 * and oob (red) all sat near OKLCH lightness 0.55, so deuteranopia - which
 * removes the red-green axis - collapsed three opposite meanings into one mark.
 * The fix moves the error connector off that axis entirely and spreads the rest
 * in lightness, which is the channel every form of colour blindness keeps.
 *
 * Two rules govern the search:
 *   - the error token must come from ONE family in both themes, because a token
 *     that means "violet" on screen and "grey" on paper is two designs;
 *   - among palettes that clear the floor by TARGET, take the one that departs
 *     least from the palette that was designed on purpose.
 *
 * Measurement comes from contrast_check.mjs; this file only searches.
 */

import { contrast, oklch, deltaE, DARK, LIGHT, COPRESENT } from "./contrast_check.mjs";

// Ordered by design preference. Violet leads because the two paths already own
// blue and amber, so a violet connector reads as "not a path".
const FAMILIES = [
  { name: "violet", DARK: "#a78bfa", LIGHT: "#6d3fd4" },
  { name: "violet deep", DARK: "#b49cf7", LIGHT: "#5b3bb8" },
  { name: "cool neutral", DARK: "#cfd8e3", LIGHT: "#4a5b6d" },
  { name: "cool neutral deep", DARK: "#b9c6d4", LIGHT: "#3d4c5c" },
  { name: "blue-violet", DARK: "#8ab0ff", LIGHT: "#3f51b5" },
];

const STEPS = [-0.36, -0.3, -0.24, -0.18, -0.12, -0.06, 0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36];
const TARGET = 1.5;

const hexToRgb = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function shift(hex, amount) {
  const factor = Math.exp(amount * 2.2);
  return "#" + hexToRgb(hex)
    .map((c) => toLin(c / 255))
    .map((c) => Math.min(1, Math.max(0, c * factor)))
    .map((c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, "0"))
    .join("");
}

function score(T) {
  let worst = Infinity;
  let binding = null;
  for (const [a, b, , cvd, nor] of COPRESENT) {
    if (!cvd && !nor) { continue; }
    const m = Math.min(
      deltaE(T[a], T[b]) - nor,
      deltaE(T[a], T[b], "protan") - cvd,
      deltaE(T[a], T[b], "deutan") - cvd
    );
    if (m < worst) { worst = m; binding = `${a} / ${b}`; }
  }
  return { worst, binding };
}

const legible = (T, keys) =>
  keys.every((k) => Math.min(contrast(T[k], T.surface1), contrast(T[k], T.arena)) >= 3);

/** Cheapest palette for one theme given a fixed error colour, or null. */
function solveTheme(base, errorHex) {
  let best = null;
  for (const dg of STEPS) {
    for (const dov of STEPS) {
      for (const dd of STEPS) {
        const T = {
          ...base,
          error: errorHex,
          goal: shift(base.goal, dg),
          oob: shift(base.oob, dov),
          deadline: shift(base.deadline, dd),
        };
        if (!legible(T, ["error", "goal", "oob", "deadline"])) { continue; }
        const s = score(T);
        if (s.worst < TARGET) { continue; }
        const cost = Math.abs(dg) + Math.abs(dov) + Math.abs(dd);
        if (!best || cost < best.cost) { best = { s, T, cost }; }
      }
    }
  }
  return best;
}

let chosen = null;
for (const family of FAMILIES) {
  const dark = solveTheme(DARK, family.DARK);
  const light = solveTheme(LIGHT, family.LIGHT);
  if (!dark || !light) {
    console.log(`  ${family.name.padEnd(18)} odpada (brak rozwiazania: ${dark ? "jasny" : "ciemny"} motyw)`);
    continue;
  }
  const cost = dark.cost + light.cost;
  console.log(`  ${family.name.padEnd(18)} dziala, koszt ${cost.toFixed(2)}, margines ${Math.min(dark.s.worst, light.s.worst).toFixed(1)}`);
  if (!chosen || cost < chosen.cost) { chosen = { family, dark, light, cost }; }
}

if (!chosen) {
  console.log("\nZadna rodzina nie spelnia obu motywow - potrzebna zmiana glebsza niz jasnosc.");
  process.exit(1);
}

console.log(`\n================ WYBRANE: ${chosen.family.name} ================`);
for (const [name, base, sol] of [["DARK ", DARK, chosen.dark], ["LIGHT", LIGHT, chosen.light]]) {
  console.log(`\n  ${name}  margines ${score(base).worst.toFixed(1)} -> ${sol.s.worst.toFixed(1)}   wiaze: ${sol.s.binding}`);
  for (const k of ["error", "goal", "oob", "deadline"]) {
    const changed = base[k] !== sol.T[k];
    console.log(
      `    ${k.padEnd(9)} ${base[k]} ${changed ? "->" : "  "} ${changed ? sol.T[k] : "bez zmiany "}` +
      `  L ${oklch(base[k]).L.toFixed(3)} -> ${oklch(sol.T[k]).L.toFixed(3)}` +
      `  kontrast ${Math.min(contrast(sol.T[k], base.surface1), contrast(sol.T[k], base.arena)).toFixed(2)}`
    );
  }
}
