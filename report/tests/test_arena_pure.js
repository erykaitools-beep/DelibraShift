/**
 * Unit tests for the pure half of assets/arena.js.
 *
 * Plain node, no dependencies, no DOM. arena.js is evaluated inside a vm
 * sandbox whose only global is a fake `window`, which proves the module does
 * not touch the document at load time.
 *
 *   node tests/test_arena_pure.js
 *
 * The suite mixes synthetic edge cases with assertions against the real
 * data/bundle.json, so a change in the extractor that breaks the arena's
 * assumptions (truth marker == trajectory at the engage tick, one truncated
 * cycle per episode, null predictions) fails here rather than on screen.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var ARENA_PATH = path.join(ROOT, 'assets', 'arena.js');
var BUNDLE_PATH = path.join(ROOT, 'data', 'bundle.json');

/* ---- tiny harness ---------------------------------------------------- */

var passed = 0;
var failed = 0;
var failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(label);
  }
}

function near(actual, expected, tol, label) {
  var t = tol === undefined ? 1e-9 : tol;
  var good = typeof actual === 'number' && isFinite(actual) &&
    Math.abs(actual - expected) <= t;
  ok(good, label + ' (got ' + actual + ', want ' + expected + ' +/- ' + t + ')');
}

function equal(actual, expected, label) {
  ok(actual === expected, label + ' (got ' + JSON.stringify(actual) +
    ', want ' + JSON.stringify(expected) + ')');
}

function section(name) {
  process.stdout.write('\n== ' + name + '\n');
}

/* ---- load the module in a DOM-free sandbox --------------------------- */

var sandbox = { window: {}, console: console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ARENA_PATH, 'utf8'), sandbox, {
  filename: ARENA_PATH
});

var Arena = sandbox.window.Arena;
if (!Arena || !Arena._pure) {
  process.stderr.write('FATAL: arena.js did not expose window.Arena._pure\n');
  process.exit(2);
}
var P = Arena._pure;

var BUNDLE = JSON.parse(fs.readFileSync(BUNDLE_PATH, 'utf8'));
var IDX = P.indexBundle(BUNDLE);
var EP = IDX.episodes['g001.r0.end2end'];
var SC = IDX.scenarios.g001;

/* ===================================================================== */
section('module surface');

var expectedExports = [
  'clamp', 'lerp', 'hypot', 'isFiniteNumber', 'interpolate', 'cssLengthToPx',
  'parseDash', 'computeView', 'worldToScreen', 'screenToWorld',
  'heatAtDistance', 'heatRingRadii', 'indexBundle', 'cycleIndexForTick',
  'cycleAtTick', 'deliberationProgress', 'phaseForTick', 'interpState',
  'stateAtTick', 'predictionMark', 'predictionVisibility', 'errorSegment',
  'accelMagnitude', 'flameScale', 'vectorAngleDeg', 'vectorPixels',
  'windAtTick', 'maxAbs', 'advanceTick', 'beatTicksPerSecond',
  'timelineGeometry', 'tickToX', 'xToTick', 'timelineMarks', 'formatFixed',
  'formatPair', 'armColorToken', 'outcomeColorToken', 'outcomeStringKey'
];
for (var e = 0; e < expectedExports.length; e += 1) {
  ok(typeof P[expectedExports[e]] === 'function',
    'export ' + expectedExports[e] + ' is a function');
}
ok(typeof Arena.mount === 'function', 'Arena.mount is exported');
ok(EP && SC, 'bundle fixture g001.r0.end2end + scenario g001 present');

/* ===================================================================== */
section('world -> screen mapping');

var view = P.computeView(456, 456, 28, { minX: 0, maxX: 100, minY: 0, maxY: 100 });
near(view.scale, 4, 1e-9, 'scale = (456 - 2*28) / 100');
var bl = P.worldToScreen(0, 0, view);
near(bl.x, 28, 1e-9, 'world x=0 sits at pad');
near(bl.y, 428, 1e-9, 'world y=0 sits at the BOTTOM (y flipped)');
var tr = P.worldToScreen(100, 100, view);
near(tr.x, 428, 1e-9, 'world x=100 at pad + 100*scale');
near(tr.y, 28, 1e-9, 'world y=100 sits at the TOP');
ok(P.worldToScreen(50, 90, view).y < P.worldToScreen(50, 10, view).y,
  'higher world y draws higher on screen');

var rt = P.screenToWorld(bl.x, bl.y, view);
near(rt.x, 0, 1e-9, 'screenToWorld round-trips x');
near(rt.y, 0, 1e-9, 'screenToWorld round-trips y');
var rt2 = P.screenToWorld(200, 133, view);
var fw = P.worldToScreen(rt2.x, rt2.y, view);
near(fw.x, 200, 1e-9, 'round-trip screen->world->screen x');
near(fw.y, 133, 1e-9, 'round-trip screen->world->screen y');

/* non-square canvas: the square world stays square and centred */
var wide = P.computeView(800, 400, 20, { minX: 0, maxX: 100, minY: 0, maxY: 100 });
near(wide.scale, 3.6, 1e-9, 'scale limited by the short side');
near(wide.fieldW, wide.fieldH, 1e-9, 'square world stays square on a wide canvas');
near(P.worldToScreen(50, 50, wide).x, 400, 1e-9, 'world centre is canvas centre x');
near(P.worldToScreen(50, 50, wide).y, 200, 1e-9, 'world centre is canvas centre y');

/* the arena must map the real out-of-bounds excursion below the floor */
var oobPoint = P.worldToScreen(57.586, -0.637, view);
ok(oobPoint.y > P.worldToScreen(0, 0, view).y,
  'a below-floor position draws below the boundary (oob is visible)');

/* ===================================================================== */
section('cycle selection for a tick');

var cycles = EP.cycles;
equal(P.cycleIndexForTick(cycles, -5), -1, 'before the first cycle: no cycle');
equal(P.cycleIndexForTick(cycles, 0), 0, 'tick 0 selects cycle 0');
equal(P.cycleIndexForTick(cycles, 19.999), 0, 'still cycle 0 one tick before engage');
equal(P.cycleIndexForTick(cycles, 20), 1,
  'at the engage tick the NEXT cycle takes over (its held == previous engaged)');
equal(P.cycleIndexForTick(cycles, 118), cycles.length - 1,
  'final tick selects the last (truncated) cycle');
equal(P.cycleIndexForTick([], 5), -1, 'empty cycle list is handled');
equal(P.cycleAtTick(cycles, 45).cycle, 2, 'cycleAtTick returns the record');

equal(P.phaseForTick(cycles, 0, EP.final_tick), 'deliberating',
  'tick 0: the model is thinking, the old action drives');
equal(P.phaseForTick(cycles, 20, EP.final_tick), 'deliberating',
  'a new cycle opens exactly when the previous action latches');
equal(P.phaseForTick(cycles, 118, EP.final_tick), 'ended', 'final tick is ended');
equal(P.phaseForTick(cycles, -1, EP.final_tick), 'idle', 'before tick 0 is idle');

near(P.deliberationProgress(cycles[0], 0), 0, 1e-9, 'progress 0 at cycle start');
near(P.deliberationProgress(cycles[0], 10), 0.5, 1e-9, 'progress 0.5 mid-window');
near(P.deliberationProgress(cycles[0], 20), 1, 1e-9, 'progress 1 at engage');
near(P.deliberationProgress(cycles[0], 999), 1, 1e-9, 'progress clamps at 1');
near(P.deliberationProgress(null, 5), 0, 1e-9, 'no cycle -> no progress');

/* the held action at a tick is the current cycle's held; the one non-zero
   thrust in this episode drives ticks 40..59 */
equal(P.cycleAtTick(cycles, 45).held.ay, 5,
  'ticks 40-59 fly under the thrust latched at tick 40');
equal(P.cycleAtTick(cycles, 39).held.ay, 0, 'ticks 20-39 fly under no thrust');

/* ===================================================================== */
section('trajectory sampling and interpolation');

var traj = EP.trajectory;
var s0 = P.stateAtTick(traj, 0);
near(s0.x, traj.x[0], 1e-12, 'tick 0 returns the first sample exactly');
near(s0.y, traj.y[0], 1e-12, 'tick 0 y exact');
var s20 = P.stateAtTick(traj, 20);
near(s20.x, traj.x[20], 1e-12, 'integer tick returns that sample exactly');
var half = P.stateAtTick(traj, 20.5);
near(half.x, (traj.x[20] + traj.x[21]) / 2, 1e-9, 'fractional tick interpolates x');
near(half.y, (traj.y[20] + traj.y[21]) / 2, 1e-9, 'fractional tick interpolates y');
near(half.heat, (traj.heat[20] + traj.heat[21]) / 2, 1e-9,
  'heat interpolates too (no jump between ticks)');
var before = P.stateAtTick(traj, -50);
near(before.x, traj.x[0], 1e-12, 'seeking before the start clamps to the start');
var after = P.stateAtTick(traj, 5000);
near(after.x, traj.x[traj.x.length - 1], 1e-12,
  'seeking past the crash clamps to the final state, it does not extrapolate');
equal(P.stateAtTick(null, 3), null, 'no trajectory -> null, not a fake origin');
equal(P.stateAtTick({ t: [] }, 3), null, 'empty trajectory -> null');

/* The truth marker is drawn at truth_at_engage; it must coincide with the
   trajectory at the engage tick, otherwise the picture would lie. */
var truthMismatch = 0;
var errorMismatch = 0;
var checkedTruth = 0;
var checkedErr = 0;
for (var ei = 0; ei < BUNDLE.episodes.length; ei += 1) {
  var ep = BUNDLE.episodes[ei];
  for (var ci = 0; ci < ep.cycles.length; ci += 1) {
    var cy = ep.cycles[ci];
    if (!cy.truth_at_engage) { continue; }
    var st = P.stateAtTick(ep.trajectory, cy.engage_tick);
    checkedTruth += 1;
    if (Math.abs(st.x - cy.truth_at_engage.x) > 1e-3 ||
        Math.abs(st.y - cy.truth_at_engage.y) > 1e-3) {
      truthMismatch += 1;
    }
    if (cy.predicted && typeof cy.pred_pos_error_m === 'number') {
      checkedErr += 1;
      var dx = cy.predicted.x - cy.truth_at_engage.x;
      var dy = cy.predicted.y - cy.truth_at_engage.y;
      if (Math.abs(Math.sqrt(dx * dx + dy * dy) - cy.pred_pos_error_m) > 1e-3) {
        errorMismatch += 1;
      }
    }
  }
}
ok(checkedTruth > 50, 'checked many engage points (' + checkedTruth + ')');
equal(truthMismatch, 0,
  'truth_at_engage == trajectory at engage_tick for every cycle in the bundle');
equal(errorMismatch, 0,
  'pred_pos_error_m == |ghost - truth| for every scored cycle (the error line' +
  ' length IS the number)');

/* ===================================================================== */
section('null predictions are never drawn as zero');

var okCycle = cycles[0];
var nullCycle = cycles[2];
ok(okCycle.predicted && !nullCycle.predicted, 'fixture has one of each');

var m1 = P.predictionMark(okCycle);
equal(m1.state, 'ok', 'a parsed prediction with truth is drawable');
near(m1.errorM, okCycle.pred_pos_error_m, 1e-12, 'error carried through');

var m2 = P.predictionMark(nullCycle);
equal(m2.state, 'no_prediction', 'a missing prediction is its own state');
equal(m2.predicted, null, 'no ghost position is invented');
equal(m2.errorM, null, 'error stays null, NOT 0');
equal(P.errorSegment(nullCycle), null, 'no error segment without a prediction');
equal(P.predictionMark(null).state, 'none', 'no cycle at all is handled');

var truncated = cycles[cycles.length - 1];
ok(truncated.truncated && !truncated.truth_at_engage,
  'fixture last cycle is truncated with no truth');
equal(P.predictionMark(truncated).state, 'no_truth',
  'a truncated cycle has a ghost but no truth to compare against');
equal(P.errorSegment(truncated), null,
  'no error line for a cycle whose engage tick never arrived');

var seg = P.errorSegment(okCycle);
near(seg.from.x, okCycle.predicted.x, 1e-12, 'segment starts at the ghost');
near(seg.to.x, okCycle.truth_at_engage.x, 1e-12, 'segment ends at the truth');
near(seg.lengthM, okCycle.pred_pos_error_m, 1e-12, 'segment length is the error');

/* ===================================================================== */
section('ghost lifecycle (fade in, latch, fade out)');

var vis = P.predictionVisibility(okCycle, 0, { fadeInTicks: 4, holdTicks: 8 });
equal(vis.phase, 'thinking', 'the ghost appears while the model thinks');
near(vis.ghost, 0, 1e-9, 'ghost starts fully transparent');
near(vis.error, 0, 1e-9, 'no error line before the action latches');

near(P.predictionVisibility(okCycle, 2, { fadeInTicks: 4 }).ghost, 0.5, 1e-9,
  'ghost is half faded in two ticks into a four-tick ramp');
near(P.predictionVisibility(okCycle, 10, { fadeInTicks: 4 }).ghost, 1, 1e-9,
  'ghost is solid once the ramp is done');

var atEngage = P.predictionVisibility(okCycle, 20, { holdTicks: 8 });
equal(atEngage.phase, 'engaged', 'phase flips at the engage tick');
near(atEngage.error, 1, 1e-9, 'the error line appears exactly at engage');
near(atEngage.ghost, 1, 1e-9, 'the ghost is still there to be measured against');

near(P.predictionVisibility(okCycle, 24, { holdTicks: 8 }).ghost, 0.5, 1e-9,
  'ghost fades out after the latch');
equal(P.predictionVisibility(okCycle, 40, { holdTicks: 8 }).phase, 'gone',
  'ghost is gone well after the latch');
equal(P.predictionVisibility(okCycle, -1, {}).phase, 'before',
  'nothing is drawn before the cycle opens');

var visNull = P.predictionVisibility(nullCycle, nullCycle.tick + 5, {});
equal(visNull.hasPrediction, false, 'missing prediction is flagged');
near(visNull.ghost, 0, 1e-9, 'no ghost is faded in for a missing prediction');
equal(visNull.phase, 'thinking',
  'the cycle still has a thinking phase - the renderer draws a struck bubble');
near(P.predictionVisibility(nullCycle, nullCycle.engage_tick, {}).error, 0, 1e-9,
  'no error line for a missing prediction, even at the engage tick');

var instant = P.predictionVisibility(okCycle, 1, { instant: true });
near(instant.ghost, 1, 1e-9, 'reduced motion: no ramp, the ghost is just there');
near(P.predictionVisibility(okCycle, 25, { instant: true, holdTicks: 8 }).ghost,
  1, 1e-9, 'reduced motion: no fade-out ramp either');
equal(P.predictionVisibility(okCycle, 40, { instant: true, holdTicks: 8 }).phase,
  'gone', 'reduced motion still ends the hold window');
equal(P.predictionVisibility(null, 5, {}).phase, 'none', 'no cycle -> nothing');

/* ===================================================================== */
section('craft heading, thrust and action vectors');

near(P.vectorAngleDeg(1, 0), 0, 1e-9, 'moving +x points right');
near(P.vectorAngleDeg(0, 1), -90, 1e-9, 'moving UP in world points up on screen');
near(P.vectorAngleDeg(0, -1), 90, 1e-9, 'falling points down on screen');
near(P.vectorAngleDeg(-1, 0), 180, 1e-9, 'moving -x points left');
near(P.vectorAngleDeg(0, 0), 0, 1e-9, 'a still craft keeps a defined heading');

var maxAccel = SC.max_accel_mps2;
equal(P.flameScale({ ax: 0, ay: 0 }, maxAccel), 0,
  'no commanded thrust -> no flame at all (an idle engine is a finding)');
equal(P.flameScale(null, maxAccel), 0, 'a null action is not a thrust');
near(P.flameScale({ ax: 0, ay: 5 }, 15), 1 / 3, 1e-9,
  'the one real thrust in g001.r0.end2end is a third of maximum');
near(P.flameScale({ ax: 3, ay: 4 }, 5), 1, 1e-9, 'L2 magnitude, not per axis');
near(P.flameScale({ ax: 100, ay: 100 }, 15), 1, 1e-9, 'flame is clamped at 1');
near(P.accelMagnitude({ ax: -3, ay: -4 }), 5, 1e-9, 'magnitude ignores direction');

near(P.vectorPixels({ ax: 0, ay: 5 }, 15, 48), 16, 1e-9,
  'action arrow length is proportional to |a| / max_accel');
equal(P.vectorPixels({ ax: 0, ay: 0 }, 15, 48), 0,
  'a zero action draws no arrow');

/* ===================================================================== */
section('wind, heat and goal geometry');

near(P.windAtTick(SC.wind_curve, 0), SC.wind_curve[0], 1e-12, 'wind at tick 0');
near(P.windAtTick(SC.wind_curve, 1e9), SC.wind_curve[SC.wind_curve.length - 1],
  1e-12, 'wind clamps at the end of the curve');
equal(P.windAtTick([], 5), 0, 'no curve -> no wind, not NaN');
ok(P.maxAbs(SC.wind_curve) > 0, 'wind peak is positive for scaling arrows');
ok(P.maxAbs([-9, 2, 3]) === 9, 'maxAbs uses magnitude');

var heatScale = BUNDLE.constants.HEAT_SCALE_M;
equal(heatScale, 20, 'bundle carries HEAT_SCALE_M = 20');
near(P.heatAtDistance(0, heatScale), 1, 1e-12, 'heat is 1 at the goal');
near(P.heatAtDistance(20, heatScale), Math.exp(-1), 1e-12, 'heat decays with e');
equal(P.heatAtDistance(null, heatScale), null, 'no distance -> no heat value');

var rings = P.heatRingRadii(P.HEAT_RINGS, heatScale);
equal(rings.length, 3, 'three iso-heat rings');
near(rings[0].radiusM, 5.7536, 1e-3, 'heat 0.75 ring sits at 5.75 m');
near(rings[1].radiusM, 13.8629, 1e-3, 'heat 0.50 ring sits at 13.86 m');
near(rings[2].radiusM, 27.7259, 1e-3, 'heat 0.25 ring sits at 27.73 m');

/* the real closest approach of the fixture should land outside every ring */
ok(EP.closest_approach_m > rings[2].radiusM,
  'g001.r0.end2end never even reached the coldest ring');

/* ===================================================================== */
section('playback runs on simulated ticks, never on the wall clock');

var step1 = P.advanceTick(0, 1, 60, 1, 600);
near(step1.tick, 60, 1e-9, 'one real second at 60 ticks/s advances 60 ticks');
equal(step1.ended, false, 'not ended mid-episode');
near(P.advanceTick(0, 1, 60, 2, 600).tick, 120, 1e-9, 'speed 2 doubles the rate');
near(P.advanceTick(0, 0.5, 60, 1, 600).tick, 30, 1e-9, 'half a second, half the ticks');
near(P.advanceTick(10, 0, 60, 1, 600).tick, 10, 1e-9, 'a zero-length frame moves nothing');

var hit = P.advanceTick(117, 1, 60, 1, 118);
near(hit.tick, 118, 1e-9, 'the head stops at the final tick');
equal(hit.ended, true, 'reaching the final tick reports ended');
equal(P.advanceTick(0, -3, 60, 1, 600).tick, 0, 'negative frame time is ignored');

/* wall clock in the log must not change the picture: the same 118 ticks take
   the same replay time whether the model answered in 1 s or in 130 s */
var slow = 0;
var fast = 0;
var i;
for (i = 0; i < 118; i += 1) { slow = P.advanceTick(slow, 1 / 60, 60, 1, 118).tick; }
for (i = 0; i < 118; i += 1) { fast = P.advanceTick(fast, 1 / 60, 60, 1, 118).tick; }
near(slow, 118, 1e-9, '118 frames of 1/60 s cover the whole episode');
near(fast, slow, 1e-12, 'replay duration is a function of ticks only');
ok(EP.wall_clock_ms > 100000,
  'the fixture really did take over 100 s of host time (telemetry only)');

near(P.beatTicksPerSecond(20, 700), 20 / 0.7, 1e-9,
  'beat pacing: B ticks per --dur-beat');
near(P.beatTicksPerSecond(40, 700), 40 / 0.7, 1e-9,
  'a longer deliberation budget still takes exactly one beat');

/* ===================================================================== */
section('time bar geometry and marks');

var geo = P.timelineGeometry(600, 46, 12);
equal(geo.x0, 12, 'left edge honours the padding');
equal(geo.x1, 588, 'right edge honours the padding');
near(P.tickToX(0, 600, geo), 12, 1e-9, 'tick 0 at the left edge');
near(P.tickToX(600, 600, geo), 588, 1e-9, 'the deadline sits at the right edge');
near(P.tickToX(300, 600, geo), 300, 1e-9, 'the middle tick sits in the middle');
near(P.tickToX(-10, 600, geo), 12, 1e-9, 'negative ticks clamp to the start');
near(P.tickToX(9999, 600, geo), 588, 1e-9, 'overshooting ticks clamp to the end');
near(P.xToTick(300, 600, geo), 300, 1e-9, 'x -> tick round-trips at the middle');
near(P.xToTick(P.tickToX(118, 600, geo), 600, geo), 118, 1e-9,
  'x -> tick round-trips at the crash tick');
near(P.xToTick(-100, 600, geo), 0, 1e-9, 'clicking left of the bar seeks to 0');
near(P.xToTick(1e6, 600, geo), 600, 1e-9, 'clicking right of the bar seeks to the deadline');

var marks = P.timelineMarks(EP, SC);
equal(marks.marks.length, 6, 'six decision marks for the fixture');
equal(marks.finalTick, 118, 'flight stopped at tick 118');
equal(marks.deadlineTick, 600, 'deadline was 600');
equal(marks.maxTick, 600, 'the bar spans the whole deadline window');
equal(marks.endedEarly, true,
  'the bar must show that 482 ticks of the budget were never used');
equal(marks.outcome, 'oob', 'outcome carried onto the bar');
equal(marks.marks[0].tick, 0, 'first mark at tick 0');
equal(marks.marks[0].engageTick, 20, 'first action latches at tick 20');
equal(marks.marks[2].parseFailed, true, 'a broken-format cycle is flagged');
equal(marks.marks[2].predictionMissing, true, 'and its prediction is missing');
equal(marks.marks[5].truncated, true, 'the last cycle is the truncated one');

/* every episode in the bundle ends far before its deadline */
var late = 0;
var earlyCount = 0;
for (i = 0; i < BUNDLE.episodes.length; i += 1) {
  var epi = BUNDLE.episodes[i];
  var mk = P.timelineMarks(epi, IDX.scenarios[epi.scenario_id]);
  if (mk.endedEarly) { earlyCount += 1; } else { late += 1; }
  if (mk.marks.length !== epi.cycles.length) { late += 100; }
}
equal(late, 0, 'no episode reaches its deadline; marks match cycle counts');
equal(earlyCount, BUNDLE.episodes.length,
  'all ' + BUNDLE.episodes.length + ' episodes end early (the bar must say so)');

/* ===================================================================== */
section('formatting never fabricates a number');

equal(P.formatFixed(0, 2), '0.00', 'a real zero is printed');
equal(P.formatFixed(null, 2), null, 'null renders as null, never as 0');
equal(P.formatFixed(undefined, 2), null, 'undefined renders as null');
equal(P.formatFixed(NaN, 2), null, 'NaN renders as null');
equal(P.formatFixed(1.23456, 3), '1.235', 'rounding works');
equal(P.formatPair(0, 5, 1), '0.0 5.0', 'action pairs are formatted together');
equal(P.formatPair(null, 5, 1), null, 'half a pair is not a pair');
equal(EP.scores.prediction_fidelity, null,
  'the fixture really has an unmeasurable fidelity');
equal(P.formatFixed(EP.scores.prediction_fidelity, 3), null,
  'so the UI gets null and must print the reason, not 0.000');
equal(EP.scores.fidelity_invalid_reason, 'insufficient_coverage',
  'and the reason key is available for strings.js');

/* ===================================================================== */
section('token parsing and copy interpolation');

near(P.cssLengthToPx('28px', 16), 28, 1e-9, 'px lengths pass through');
near(P.cssLengthToPx('0.6875rem', 16), 11, 1e-9, 'rem lengths resolve to px');
near(P.cssLengthToPx('1.5', 16), 1.5, 1e-9, 'unitless stroke widths pass through');
near(P.cssLengthToPx('700ms', 16), 700, 1e-9, 'durations parse as numbers');
near(P.cssLengthToPx('  0.62 ', 16), 0.62, 1e-9, 'whitespace is trimmed');
equal(P.cssLengthToPx('', 16), 0, 'an empty token degrades to 0');
equal(P.cssLengthToPx(null, 16), 0, 'a missing token degrades to 0');

var dash = P.parseDash('4 3.5');
equal(dash.length, 2, 'dash token splits into two numbers');
near(dash[1], 3.5, 1e-9, 'dash values parse');
equal(P.parseDash('').length, 0, 'an empty dash token is an empty array');

equal(P.interpolate('Cykl {n} z {total}', { n: 2, total: 6 }), 'Cykl 2 z 6',
  'placeholders are filled');
equal(P.interpolate('tick {tick}', {}), 'tick {tick}',
  'a missing value stays visible instead of blanking out');
equal(P.interpolate('plain', null), 'plain', 'no vars is fine');

equal(P.armColorToken('end2end'), '--c-arm-e2e', 'end2end takes the blue token');
equal(P.armColorToken('wm-scaffold'), '--c-arm-wm', 'wm-scaffold takes amber');
equal(P.outcomeColorToken('goal'), '--c-goal', 'goal outcome token');
equal(P.outcomeColorToken('oob'), '--c-oob', 'oob outcome token');
equal(P.outcomeColorToken('timeout'), '--c-deadline', 'timeout outcome token');
equal(P.outcomeStringKey('oob'), 'outcome.oob', 'outcome string key');
equal(P.outcomeStringKey('nonsense'), 'outcome.unknown',
  'an unknown outcome still has a label key');

/* ===================================================================== */
section('bundle indexing');

equal(Object.keys(IDX.episodes).length, BUNDLE.episodes.length,
  'every episode is indexed by key');
ok(IDX.byScenario.g001.indexOf('g001.r0.wm-scaffold') >= 0,
  'scenario index finds the other arm for overlay mode');
equal(IDX.episodes['does.not.exist'], undefined,
  'an unknown key returns undefined, not a stub episode');
ok(IDX.scenarios.g007a.goal_visible === false,
  'masked scenarios are marked, so the goal is drawn as an unknown');

/* ===================================================================== */

process.stdout.write('\n---------------------------------------------\n');
process.stdout.write('passed: ' + passed + '   failed: ' + failed + '\n');
if (failed) {
  for (var f = 0; f < failures.length; f += 1) {
    process.stdout.write('  FAIL: ' + failures[f] + '\n');
  }
  process.exit(1);
}
process.stdout.write('ALL PURE-FUNCTION TESTS PASSED\n');
