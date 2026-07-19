/**
 * Render smoke test for assets/arena.js.
 *
 * There is no browser here, so the module is mounted against a fake DOM and a
 * canvas 2D context that records every drawing call. Real token values are
 * parsed out of assets/tokens.css and real copy out of assets/strings.js, so
 * this exercises the same code path a browser would: mount -> load -> paint ->
 * seek -> play -> end, with the ghost, the error line, the missing-prediction
 * bubble, the overlay and the time bar all drawn at least once.
 *
 *   node tests/test_arena_render_smoke.js
 *
 * It cannot judge how the picture looks. It can prove the picture is drawn,
 * that no frame throws, that replay advances in simulated ticks, and that the
 * strings on screen come from strings.js.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');

var passed = 0;
var failed = 0;
var failures = [];

function ok(condition, label) {
  if (condition) { passed += 1; } else { failed += 1; failures.push(label); }
}
function equal(a, b, label) {
  ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}
function near(a, b, tol, label) {
  ok(typeof a === 'number' && Math.abs(a - b) <= tol,
    label + ' (got ' + a + ', want ' + b + ' +/- ' + tol + ')');
}
function section(name) { process.stdout.write('\n== ' + name + '\n'); }

/* ---- token table straight out of tokens.css -------------------------- */

var tokensCss = fs.readFileSync(path.join(ROOT, 'assets', 'tokens.css'), 'utf8');
/* the selectors are also quoted in the file header, so start from the real
   :root rule and only then look for the light theme that follows it */
var rootStart = tokensCss.indexOf(':root {');
var rootBlock = tokensCss.slice(rootStart,
  tokensCss.indexOf(':root[data-theme="light"]', rootStart));
var TOKENS = {};
rootBlock.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, function (all, key, value) {
  TOKENS[key] = value.trim();
  return all;
});
/* resolve the one level of var() indirection tokens.css uses */
Object.keys(TOKENS).forEach(function (k) {
  TOKENS[k] = TOKENS[k].replace(/var\((--[\w-]+)\)/g, function (all, ref) {
    return TOKENS[ref] || all;
  });
});
ok(TOKENS['--arena-pad'] === '28px', 'tokens.css parsed (--arena-pad)');
ok(/^#/.test(TOKENS['--c-arm-e2e']), 'tokens.css parsed (--c-arm-e2e)');

/* ---- recording canvas context ---------------------------------------- */

function makeCtx(tag) {
  var ops = [];
  var texts = [];
  var ctx = {
    tag: tag,
    ops: ops,
    texts: texts,
    canvas: null,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    textAlign: 'left', textBaseline: 'alphabetic', lineJoin: 'miter',
    lineCap: 'butt'
  };
  var record = function (name) {
    return function () {
      ops.push(name);
      if (name === 'fillText') { texts.push(String(arguments[0])); }
      if (name === 'measureText') { return { width: String(arguments[0]).length * 6 }; }
      if (name === 'createRadialGradient') {
        return { addColorStop: function () { ops.push('addColorStop'); } };
      }
      return undefined;
    };
  };
  var names = ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'arc',
    'quadraticCurveTo', 'closePath', 'fill', 'stroke', 'fillRect', 'strokeRect',
    'clearRect', 'clip', 'rect', 'setTransform', 'translate', 'rotate', 'scale',
    'setLineDash', 'drawImage', 'measureText', 'fillText', 'createRadialGradient'];
  for (var i = 0; i < names.length; i += 1) { ctx[names[i]] = record(names[i]); }
  return ctx;
}

/* ---- fake DOM --------------------------------------------------------- */

var rafQueue = [];
var rafId = 0;

function makeElement(tagName, className) {
  var el = {
    tagName: tagName,
    className: className || '',
    style: {},
    attrs: {},
    childNodes: [],
    parentNode: null,
    nextSibling: null,
    _ctx: null,
    _w: 640,
    _h: 640,
    setAttribute: function (k, v) { el.attrs[k] = String(v); },
    getAttribute: function (k) {
      return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null;
    },
    addEventListener: function () {},
    removeEventListener: function () {},
    setPointerCapture: function () {},
    releasePointerCapture: function () {},
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: el._w, height: el._h };
    },
    insertBefore: function (node) {
      el.childNodes.push(node);
      node.parentNode = el;
      return node;
    }
  };
  if (tagName === 'canvas') {
    el.width = 0;
    el.height = 0;
    el.getContext = function () {
      if (!el._ctx) { el._ctx = makeCtx(className || 'canvas'); el._ctx.canvas = el; }
      return el._ctx;
    };
  }
  return el;
}

var documentElement = makeElement('html');
documentElement.setAttribute('lang', 'pl');

var fakeDocument = {
  documentElement: documentElement,
  createElement: function (tag) { return makeElement(tag); }
};

var reducedMotion = { matches: false };

var win = {
  document: fakeDocument,
  devicePixelRatio: 2,
  Path2D: function Path2D(d) { this.d = d; },
  requestAnimationFrame: function (cb) {
    rafId += 1;
    rafQueue.push({ id: rafId, cb: cb });
    return rafId;
  },
  cancelAnimationFrame: function (id) {
    for (var i = rafQueue.length - 1; i >= 0; i -= 1) {
      if (rafQueue[i].id === id) { rafQueue.splice(i, 1); }
    }
  },
  matchMedia: function (query) {
    if (query.indexOf('reduced-motion') >= 0) { return reducedMotion; }
    return { matches: false };
  },
  getComputedStyle: function (el) {
    return {
      fontSize: '16px',
      getPropertyValue: function (name) {
        if (name === '--c-path' && el && el.getAttribute &&
            el.getAttribute('data-arm')) {
          return el.getAttribute('data-arm') === 'wm-scaffold'
            ? TOKENS['--c-arm-wm'] : TOKENS['--c-arm-e2e'];
        }
        return TOKENS[name] || '';
      }
    };
  },
  console: console
};
win.window = win;

/* pump one animation frame at a chosen timestamp (simulated wall clock) */
function pumpFrame(nowMs) {
  var queued = rafQueue.splice(0, rafQueue.length);
  for (var i = 0; i < queued.length; i += 1) { queued[i].cb(nowMs); }
  return queued.length;
}

/* ---- load strings + bundle + arena into the sandbox ------------------- */

var sandbox = win;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'strings.js'), 'utf8'),
  sandbox, { filename: 'strings.js' });
sandbox.BUNDLE = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'bundle.json'), 'utf8'));
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'arena.js'), 'utf8'),
  sandbox, { filename: 'arena.js' });

var Arena = sandbox.Arena;
var STRINGS = sandbox.STRINGS;
ok(!!Arena && typeof Arena.mount === 'function', 'Arena.mount available');

/* ---- mount ------------------------------------------------------------ */

section('mount and first paint');

var stage = makeElement('div', 'cg-stage');
var arenaBox = makeElement('div', 'cg-arena');
arenaBox.parentNode = stage;
var canvas = makeElement('canvas', 'cg-arena__canvas');
canvas.parentNode = arenaBox;

var ticks = [];
var loads = [];
var ends = [];
var arena = Arena.mount(canvas, {
  onTick: function (payload) { ticks.push(payload); }
});
arena.on('load', function (p) { loads.push(p); });
arena.on('end', function (p) { ends.push(p); });

var ctx = canvas.getContext('2d');
equal(canvas.width, 1280, 'canvas backing store is DPR scaled (640 * 2)');
equal(canvas.getAttribute('role'), 'img', 'canvas gets an accessible role');
equal(canvas.getAttribute('aria-label'), STRINGS.pl['arena.aria.canvas'],
  'accessible name comes from strings.js, in the document language');
ok(stage.childNodes.length === 1 &&
   stage.childNodes[0].getAttribute('role') === 'slider',
  'the time bar is inserted AFTER the square arena box, as a slider');

var timelineEl = arena.timelineElement();
ok(!!timelineEl, 'timeline element is exposed');

var autoBox = makeElement('div', 'cg-arena');
autoBox.parentNode = stage;
var autoCanvas = makeElement('canvas', 'cg-arena__canvas');
autoCanvas.parentNode = autoBox;
var autoArena = Arena.mount(autoCanvas, {
  episode: sandbox.BUNDLE.episodes[0],
  bundle: sandbox.BUNDLE,
  autoplay: true,
  timeline: false
});
equal(autoArena.getEpisode().key, sandbox.BUNDLE.episodes[0].key,
  'mount accepts the episode object handed over by the shell');
equal(autoArena.getState().playing, true,
  'autoplay starts the simulated-tick transport after the first paint');
autoArena.destroy();

/* ---- load ------------------------------------------------------------- */

section('load g001.r0.end2end');

arena.load('g001.r0.end2end');
equal(loads.length, 1, 'load event fired');
equal(loads[0].found, true, 'episode found in the bundle');
equal(loads[0].arm, 'end2end', 'arm reported to the shell');
equal(loads[0].finalTick, 118, 'final tick reported');
equal(loads[0].deadlineTick, 600, 'deadline reported');
equal(loads[0].cycleCount, 6, 'cycle count reported');
equal(canvas.getAttribute('data-arm'), 'end2end',
  'data-arm is set so CSS maps the arm colour (no hex written by script)');
ok(ctx.ops.indexOf('drawImage') >= 0,
  'the cached static layer is blitted rather than redrawn every frame');
ok(ctx.ops.indexOf('createRadialGradient') === -1,
  'the heat gradient lives on the static layer, not in the frame path');

ok(ctx.texts.length > 0, 'the frame draws labels');

/* ---- a frame where the model is thinking ------------------------------ */

section('tick 10: model thinking, ghost faded in, old action driving');

ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(10);
var cur = arena.getCurrent();
equal(cur.phase, 'deliberating', 'phase is deliberating');
equal(cur.cycleIndex, 0, 'cycle 0 governs tick 10');
near(cur.progress, 0.5, 1e-9, 'halfway through the deliberation window');
equal(cur.held.ax, 0, 'the latched action is still the initial noop (ax)');
equal(cur.held.ay, 0, 'the latched action is still the initial noop (ay)');
ok(ctx.texts.indexOf(STRINGS.pl['arena.short.ghost']) >= 0,
  'the ghost is labelled from strings.js');
ok(ctx.texts.indexOf(STRINGS.pl['arena.hud.tick']) >= 0, 'HUD label drawn');
ok(ctx.texts.indexOf('10') >= 0, 'HUD shows the current tick');

/* ---- the engage moment: error line + truth ring ----------------------- */

section('tick 20: the action latches, the error line appears');

ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(20);
var errLabel = STRINGS.pl['arena.label.error_value']
  .replace('{value}', '2.88');
ok(ctx.texts.indexOf(errLabel) >= 0,
  'the error line states its own length: ' + errLabel);
ok(ctx.ops.indexOf('setLineDash') >= 0, 'dashed marks are drawn');
equal(arena.getCurrent().cycleIndex, 1, 'the next cycle already opened');

/* ---- a cycle the model failed to format ------------------------------- */

section('tick 45: no readable prediction, and the one real thrust');

ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(45);
var cur45 = arena.getCurrent();
equal(cur45.cycleIndex, 2, 'cycle 2 governs tick 45');
equal(cur45.predicted, null, 'cycle 2 has no prediction in the log');
equal(cur45.held.ay, 5, 'ticks 40-59 fly under the only non-zero thrust');
ok(ctx.texts.indexOf(STRINGS.pl['arena.label.no_prediction']) >= 0,
  'a struck bubble labelled from strings.js replaces the ghost');
ok(ctx.texts.indexOf(STRINGS.pl['arena.hud.held']) >= 0,
  'the HUD names the held action');
ok(ctx.texts.indexOf('0.0 5.0') >= 0, 'and prints it');

/* ---- the ending ------------------------------------------------------- */

section('tick 118: out of bounds');

ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(118);
equal(arena.getCurrent().phase, 'ended', 'phase is ended');
ok(ctx.texts.indexOf(STRINGS.pl['outcome.oob']) >= 0,
  'the outcome is written out, not left to colour alone');
ok(ctx.texts.indexOf(STRINGS.pl['results.col.outcome']) >= 0,
  'with its label');

/* ---- the time bar ------------------------------------------------------ */

section('time bar');

var tlCtx = timelineEl.getContext('2d');
var endedAt = STRINGS.pl['arena.timeline.ended_at']
  .replace('{tick}', '118').replace('{total}', '600');
ok(tlCtx.texts.indexOf(endedAt) >= 0,
  'the bar says the flight stopped at 118 of 600: ' + endedAt);
ok(tlCtx.texts.indexOf(STRINGS.pl['arena.timeline.deadline_at']
  .replace('{tick}', '600')) >= 0, 'and marks the deadline');

/* Cycle labels are dropped when the beads would collide - six decisions in
   the first 100 of 600 ticks are tight. Widen the bar and they come back. */
ok(tlCtx.texts.indexOf('C5') === -1,
  'on a narrow bar the cycle labels step aside rather than overlapping');
timelineEl._w = 1400;
tlCtx.texts.length = 0;
arena.seek(118);
ok(tlCtx.texts.indexOf('C0') >= 0 && tlCtx.texts.indexOf('C5') >= 0,
  'with room, every decision on the bar is labelled');
timelineEl._w = 640;
equal(timelineEl.getAttribute('aria-valuemax'), '600',
  'the slider spans the whole deadline window');
equal(timelineEl.getAttribute('aria-valuenow'), '118', 'and reports the head');

/* ---- playback runs on simulated ticks --------------------------------- */

section('playback');

arena.seek(0);
ticks.length = 0;
arena.play();
equal(arena.getState().playing, true, 'play starts the transport');

/* 30 frames of 1/60 s = half a second of real time */
var clock = 1000;
pumpFrame(clock);                       /* priming frame records the timestamp */
for (var fr = 0; fr < 30; fr += 1) {
  clock += 1000 / 60;
  pumpFrame(clock);
}
near(arena.getState().tick, 30, 1e-6,
  'half a second at 60 ticks/s advanced exactly 30 simulated ticks');

/* a stalled tab must not teleport the craft: one huge frame is capped */
var beforeStall = arena.getState().tick;
clock += 5000;
pumpFrame(clock);
near(arena.getState().tick - beforeStall, 6, 1e-6,
  'a five-second stall advances at most 0.1 s worth of ticks');

arena.setSpeed(2);
var before = arena.getState().tick;
for (fr = 0; fr < 30; fr += 1) {
  clock += 1000 / 60;
  pumpFrame(clock);
}
near(arena.getState().tick - before, 60, 1e-6, 'speed 2 doubles the rate');

/* run to the end */
var guard = 0;
while (arena.getState().playing && guard < 2000) {
  clock += 1000 / 60;
  pumpFrame(clock);
  guard += 1;
}
equal(arena.getState().playing, false, 'transport stops at the end');
near(arena.getState().tick, 118, 1e-9, 'and stops exactly on the final tick');
equal(ends.length, 1, 'the end event fired once');
equal(ends[0].outcome, 'oob', 'with the outcome');
ok(ticks.length > 5, 'tick events were emitted during playback (' + ticks.length + ')');

/* ---- overlay ----------------------------------------------------------- */

section('overlay with the other arm');

ctx.ops.length = 0; ctx.texts.length = 0;
arena.setOverlay('g001.r0.wm-scaffold');
arena.seek(60);
equal(arena.getState().overlayKey, 'g001.r0.wm-scaffold', 'overlay is loaded');
var overlayLabel = STRINGS.pl['arena.overlay.label']
  .replace('{arm}', STRINGS.pl['arm.wm_scaffold.name']);
ok(ctx.texts.indexOf(overlayLabel) >= 0,
  'the overlay names its arm: ' + overlayLabel);
arena.setOverlay(null);
equal(arena.getState().overlayKey, null, 'overlay clears');

/* the shorter flight must not cut the comparison short */
arena.load('g001.r0.wm-scaffold');
equal(arena.getState().maxTick, 98, 'alone, the scaffold flight ends at tick 98');
arena.setOverlay('g001.r0.end2end');
equal(arena.getState().maxTick, 118,
  'with an overlay the head spans the longer flight - the arm that died first' +
  ' stays frozen at its own crash');
arena.seek(118);
equal(arena.getCurrent().phase, 'ended', 'the main flight is already over there');
arena.setOverlay(null);
equal(arena.getState().maxTick, 98, 'clearing the overlay restores the span');
equal(arena.getState().tick, 98, 'and pulls the head back inside it');

/* ---- masked goal ------------------------------------------------------- */

section('hidden goal stays hidden until the expert asks');

arena.load('g007a.r0.end2end');
equal(arena.getScenario().goal_visible, false, 'g007a hides the goal');
equal(arena.getState().revealHiddenGoal, false, 'and the arena keeps it hidden');
ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(30);
var hiddenCur = arena.getCurrent();
ok(ctx.texts.indexOf(STRINGS.pl['arena.hud.distance_hidden']) >= 0,
  'the HUD says the distance is hidden rather than printing it');
ok(ctx.texts.indexOf(STRINGS.pl['ui.na']) >= 0,
  'and shows the not-available marker, never a number the agent never had');
arena.setRevealHiddenGoal(true);
ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(30);
ok(ctx.texts.indexOf(STRINGS.pl['arena.hud.distance']) >= 0,
  'with the expert switch on, the real distance label appears');
ok(hiddenCur.state !== null, 'state is still sampled while the goal is hidden');

/* ---- decoy run --------------------------------------------------------- */

section('decoy run is labelled as a false signal');

arena.load('g007a.r0.end2end.decoy');
ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(10);
var decoyCur = arena.getCurrent();
equal(decoyCur.variant, 'decoy', 'variant is carried to the shell');
ok(ctx.texts.join('|').indexOf(STRINGS.pl['results.heat.decoy']) >= 0,
  'the heat readout is marked as the false one');
ok(decoyCur.obsHeat !== null, 'the heat the model actually saw is reported');

/* ---- a flight that reaches the goal ------------------------------------ */

section('the one successful flight');

arena.load('g007b.r0.end2end');
equal(arena.getEpisode().outcome, 'goal', 'g007b end2end reaches the goal');
ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(75);
ok(ctx.texts.indexOf(STRINGS.pl['outcome.goal']) >= 0,
  'the goal ending is written out too');

/* ---- language switch --------------------------------------------------- */

section('language switch');

documentElement.setAttribute('lang', 'en');
arena.refresh();
ctx.ops.length = 0; ctx.texts.length = 0;
arena.seek(20);
ok(ctx.texts.indexOf(STRINGS.en['arena.short.ghost']) >= 0,
  'after a language switch the canvas repaints in English');
ok(ctx.texts.indexOf(STRINGS.pl['arena.short.ghost']) === -1,
  'and no Polish label is left behind');
equal(canvas.getAttribute('aria-label'), STRINGS.en['arena.aria.canvas'],
  'the accessible name follows the language too');
documentElement.setAttribute('lang', 'pl');
arena.refresh();

/* ---- reduced motion ---------------------------------------------------- */

section('prefers-reduced-motion');

reducedMotion.matches = true;
arena.load('g001.r0.end2end');
rafQueue.length = 0;
arena.play();
equal(arena.getState().playing, false,
  'with reduced motion, play does not animate - the reader scrubs');
equal(rafQueue.length, 0, 'and no animation frame is requested');
arena.seek(20);
ok(arena.getCurrent().tick === 20, 'manual seeking still works');
reducedMotion.matches = false;

/* ---- unknown episode ---------------------------------------------------- */

section('robustness');

loads.length = 0;
arena.load('no.such.episode');
equal(loads.length, 1, 'an unknown key still reports back');
equal(loads[0].found, false, 'as not found');
equal(arena.getCurrent(), null, 'and no fake episode is invented');

arena.load('g001.r0.end2end');
arena.seek(-999);
near(arena.getState().tick, 0, 1e-9, 'seeking before the start clamps to 0');
arena.seek(999999);
near(arena.getState().tick, 118, 1e-9, 'seeking past the crash clamps to the end');
arena.step(-3);
near(arena.getState().tick, 115, 1e-9, 'stepping backwards works');
arena.seekCycle(3);
near(arena.getState().tick, 60, 1e-9, 'seekCycle lands on the decision tick');
arena.setWind(false);
arena.setGhost(false);
arena.setTrail(false);
arena.setHud(false);
arena.seek(20);
ok(true, 'every layer can be switched off without throwing');
arena.setHud(true);
arena.setGhost(true);
arena.setWind(true);
arena.setTrail(true);

/* every episode in the bundle paints without throwing, at three points */
var painted = 0;
for (var k = 0; k < sandbox.BUNDLE.episodes.length; k += 1) {
  var key = sandbox.BUNDLE.episodes[k].key;
  arena.load(key);
  var ft = sandbox.BUNDLE.episodes[k].final_tick;
  arena.seek(0);
  arena.seek(Math.floor(ft / 2));
  arena.seek(ft);
  painted += 1;
}
equal(painted, sandbox.BUNDLE.episodes.length,
  'all ' + painted + ' episodes in the bundle paint without throwing');

arena.destroy();
ok(true, 'destroy() runs clean');

/* ------------------------------------------------------------------------ */

process.stdout.write('\n---------------------------------------------\n');
process.stdout.write('passed: ' + passed + '   failed: ' + failed + '\n');
if (failed) {
  for (var f = 0; f < failures.length; f += 1) {
    process.stdout.write('  FAIL: ' + failures[f] + '\n');
  }
  process.exit(1);
}
process.stdout.write('ALL RENDER SMOKE TESTS PASSED\n');
