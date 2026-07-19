/*
 * Tests for the pure half of assets/charts.js.
 *
 * Run from report/: node tests/test_charts_pure.js
 *
 * No DOM, no test framework, no dependencies. strings.js and charts.js are
 * evaluated in one vm context whose "window" is the context itself, which is
 * exactly how a browser loads them from two plain <script> tags.
 *
 * Beyond the unit checks, three contract tests run against the real
 * data/bundle.json:
 *   - aggregates computed here must equal the extractor's own arm block;
 *   - a null score must never turn into a number anywhere in the model;
 *   - every string key the chart layer asks for must exist in PL and in EN.
 */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var ASSETS = path.join(ROOT, 'assets');
var CHARTS_SRC = fs.readFileSync(path.join(ASSETS, 'charts.js'), 'utf8');

var sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ASSETS, 'strings.js'), 'utf8'), sandbox, { filename: 'strings.js' });
vm.runInContext(CHARTS_SRC, sandbox, { filename: 'charts.js' });

var Charts = sandbox.Charts;
var P = Charts._pure;
var STRINGS = sandbox.STRINGS;
var BUNDLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bundle.json'), 'utf8'));

/* ---- tiny harness -------------------------------------------------------- */

var passed = 0;
var failures = [];
var current = '';

function test(name, fn) {
  current = name;
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name + ': ' + (err && err.message ? err.message : String(err)));
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'expected truthy');
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'values differ') + ' | got ' + JSON.stringify(actual) +
      ' want ' + JSON.stringify(expected));
  }
}

function near(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= (tol === undefined ? 1e-9 : tol))) {
    throw new Error((msg || 'values differ') + ' | got ' + actual + ' want ' + expected);
  }
}

function deepEq(actual, expected, msg) {
  eq(JSON.stringify(actual), JSON.stringify(expected), msg);
}

/* ==========================================================================
   1. Numbers and null
   ========================================================================== */

test('fmt formats to a fixed number of digits', function () {
  eq(P.fmt(0.123456, 4), '0.1235');
  eq(P.fmt(0.5, 2), '0.50');
  eq(P.fmt(12, 0), '12');
  eq(P.fmt(0.10845915912324092, 4), '0.1085');
});

test('fmt keeps zero as a value but refuses non-numbers', function () {
  eq(P.fmt(0, 4), '0.0000', 'zero is a measurement and must format');
  eq(P.fmt(null, 4), null, 'null must not become a number');
  eq(P.fmt(undefined, 4), null);
  eq(P.fmt(NaN, 4), null);
  eq(P.fmt(Infinity, 4), null);
  eq(P.fmt('0.5', 4), null, 'strings are not measurements');
});

test('fmtInt rounds and passes null through', function () {
  eq(P.fmtInt(2.6), '3');
  eq(P.fmtInt(0), '0');
  eq(P.fmtInt(null), null);
  eq(P.fmtInt(NaN), null);
});

test('diff is absolute and null-safe', function () {
  near(P.diff(0.5, 0.2), 0.3, 1e-12);
  near(P.diff(0.2, 0.5), 0.3, 1e-12);
  eq(P.diff(null, 0.5), null);
  eq(P.diff(0.5, undefined), null);
});

/* ==========================================================================
   2. Scaling
   ========================================================================== */

test('scaleLinear maps a domain onto a pixel range', function () {
  eq(P.scaleLinear(0, 0, 1, 100, 600), 100);
  eq(P.scaleLinear(1, 0, 1, 100, 600), 600);
  eq(P.scaleLinear(0.5, 0, 1, 100, 600), 350);
  near(P.scaleLinear(0.0885, 0, 1, 104, 628), 104 + 0.0885 * 524, 1e-9);
});

test('scaleLinear clamps only when asked', function () {
  eq(P.scaleLinear(1.4, 0, 1, 0, 100, true), 100);
  eq(P.scaleLinear(-0.4, 0, 1, 0, 100, true), 0);
  eq(P.scaleLinear(1.4, 0, 1, 0, 100, false), 140);
});

test('scaleLinear survives a degenerate domain and refuses null', function () {
  eq(P.scaleLinear(5, 3, 3, 10, 90), 10);
  eq(P.scaleLinear(null, 0, 1, 0, 100), null);
});

test('niceTicks produces a round ceiling above the data', function () {
  var a = P.niceTicks(0, 20.8123, 5);
  eq(a.max, 25);
  eq(a.step, 5);
  deepEq(a.ticks, [0, 5, 10, 15, 20, 25]);

  var b = P.niceTicks(0, 0.37, 5);
  ok(b.max >= 0.37, 'ceiling must cover the data');
  ok(b.ticks.length >= 3 && b.ticks.length <= 12, 'tick count stays readable');

  var flat = P.niceTicks(0, 0, 5);
  ok(flat.max > 0, 'a flat series still gets an axis');
});

/* ==========================================================================
   3. Path building
   ========================================================================== */

test('barPath builds a bar rounded on the growing end', function () {
  var d = P.barPath(10, 4, 50, 12, 2);
  ok(d.indexOf('M10,4') === 0, 'starts at the origin corner: ' + d);
  ok(d.charAt(d.length - 1) === 'Z', 'closes the shape');
  ok(d.indexOf('Q') !== -1, 'has rounded corners');
  ok(d.indexOf('H58') !== -1, 'flat run stops one radius before the end: ' + d);
});

test('barPath draws nothing for an empty or invalid bar', function () {
  eq(P.barPath(10, 4, 0, 12, 2), '', 'a zero-length bar is not drawn');
  eq(P.barPath(10, 4, -3, 12, 2), '');
  eq(P.barPath(10, 4, 50, 0, 2), '');
  eq(P.barPath(null, 4, 50, 12, 2), '');
});

test('barPath keeps the radius inside the bar', function () {
  var tiny = P.barPath(0, 0, 3, 4, 8);
  ok(tiny.indexOf('NaN') === -1, 'no NaN in ' + tiny);
  ok(tiny.indexOf('Q') !== -1 || tiny.indexOf('H') !== -1);
  var square = P.barPath(0, 0, 10, 10, 0);
  eq(square, 'M0,0H10V10H0Z');
});

test('linePath breaks at missing points instead of interpolating', function () {
  var d = P.linePath([
    { x: 0, y: 10 }, { x: 10, y: 20 }, null,
    { x: 30, y: 5 }, { x: 40, y: 6 }
  ]);
  eq(d.match(/M/g).length, 2, 'a gap starts a new subpath: ' + d);
  eq(d.match(/L/g).length, 2);
  eq(P.linePath([null, null]), '', 'nothing measurable means nothing drawn');
  eq(P.linePath([]), '');
});

/* ==========================================================================
   4. Aggregation and sorting
   ========================================================================== */

test('aggregate ignores nulls and reports its own support', function () {
  var a = P.aggregate([0.2, null, 0.4, undefined, NaN, 0.6]);
  near(a.mean, 0.4, 1e-12);
  eq(a.min, 0.2);
  eq(a.max, 0.6);
  eq(a.n, 3, 'n counts measured values only');
  eq(P.aggregate([]), null);
  eq(P.aggregate([null, NaN]), null, 'no measurement means no aggregate');
  var one = P.aggregate([0.5]);
  eq(one.min, one.max, 'a single value has no spread');
});

test('sortRows keeps missing keys last in both directions', function () {
  var rows = [
    { id: 'a', v: 0.3 }, { id: 'b', v: null }, { id: 'c', v: 0.9 },
    { id: 'd', v: 0.1 }, { id: 'e', v: undefined }
  ];
  var key = function (r) { return r.v; };
  eq(P.sortRows(rows, key, 'asc').map(function (r) { return r.id; }).join(''), 'dacbe');
  eq(P.sortRows(rows, key, 'desc').map(function (r) { return r.id; }).join(''), 'cadbe');
});

test('sortRows is stable for equal keys', function () {
  var rows = [{ id: 1, v: 1 }, { id: 2, v: 1 }, { id: 3, v: 1 }];
  eq(P.sortRows(rows, function (r) { return r.v; }, 'desc').map(function (r) { return r.id; }).join(''), '123');
});

test('sortRows sorts strings as well as numbers', function () {
  var rows = [{ id: 'g010' }, { id: 'g001' }, { id: 'g007a' }];
  var out = P.sortRows(rows, function (r) { return r.id; }, 'asc').map(function (r) { return r.id; });
  deepEq(out, ['g001', 'g007a', 'g010']);
});

/* ==========================================================================
   5. Text interpolation and markup helpers
   ========================================================================== */

test('interpolate fills known tokens and leaves unknown ones alone', function () {
  eq(P.interpolate('{n} z {total}', { n: 2, total: 3 }), '2 z 3');
  eq(P.interpolate('{n} of {total}', { n: 0, total: 0 }), '0 of 0');
  eq(P.interpolate('{missing} stays', {}), '{missing} stays');
  eq(P.interpolate('no tokens', { n: 1 }), 'no tokens');
  eq(P.interpolate('{n}', null), '{n}');
});

test('esc neutralizes markup in data-derived text', function () {
  eq(P.esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
  eq(P.esc('g001.r0.end2end'), 'g001.r0.end2end');
});

test('el and attrStr skip empty attributes and self-close', function () {
  eq(P.el('rect', { x: 1, y: 2, 'data-arm': null, hidden: false }, null), '<rect x="1" y="2"/>');
  eq(P.el('text', { 'class': 'cg-chart__tick' }, 'abc'), '<text class="cg-chart__tick">abc</text>');
  eq(P.attrStr({ a: true }), ' a');
});

/* ==========================================================================
   6. Metric semantics on the real bundle
   ========================================================================== */

test('scopeEpisodes separates subset S, the full pack and the decoys', function () {
  var visible = P.scopeEpisodes(BUNDLE, 'visible');
  var all = P.scopeEpisodes(BUNDLE, 'all');
  var decoy = P.scopeEpisodes(BUNDLE, 'decoy');
  ok(visible.length < all.length, 'subset S is smaller than the whole pack');
  /* Counts are derived, never pinned: the bundle grows while the run is
     going, and a literal here fails on data rather than on behaviour. */
  var nonProbe = BUNDLE.episodes.filter(function (e) {
    return BUNDLE.scenarios[e.scenario_id] && BUNDLE.scenarios[e.scenario_id].is_probe === false;
  });
  eq(all.length, nonProbe.filter(function (e) { return e.variant === 'normal'; }).length,
    'both arms, true heat, no probes');
  eq(visible.length, nonProbe.filter(function (e) {
    return e.variant === 'normal' && BUNDLE.scenarios[e.scenario_id].goal_visible === true;
  }).length);
  eq(decoy.length, nonProbe.filter(function (e) { return e.variant === 'decoy'; }).length);
  ok(all.length > 0 && decoy.length > 0, 'the snapshot has to carry both kinds');
  visible.forEach(function (e) {
    eq(BUNDLE.scenarios[e.scenario_id].goal_visible, true, e.key + ' must have a visible goal');
    eq(e.variant, 'normal');
  });
  all.forEach(function (e) { eq(BUNDLE.scenarios[e.scenario_id].is_probe, false); });
});

test('aggregates computed here equal the extractor arm block', function () {
  var metrics = ['prediction_fidelity', 'prediction_coverage', 'persistence_floor_fidelity',
    'temporal_anticipation', 'outcome', 'action_parse_rate', 'prediction_parse_rate',
    'retried_cycle_rate'];
  ['end2end', 'wm-scaffold'].forEach(function (arm) {
    var eps = P.scopeEpisodes(BUNDLE, 'all').filter(function (e) { return e.arm === arm; });
    metrics.forEach(function (m) {
      var mine = P.aggregate(eps.map(function (e) { return P.episodeValue(e, m); }));
      var theirs = BUNDLE.arms[arm][m];
      ok(mine && theirs, arm + '/' + m + ' missing');
      eq(mine.n, theirs.n, arm + '/' + m + ' support');
      near(mine.mean, theirs.mean, 1e-12, arm + '/' + m + ' mean');
      near(mine.min, theirs.min, 1e-12, arm + '/' + m + ' min');
      near(mine.max, theirs.max, 1e-12, arm + '/' + m + ' max');
    });
  });
});

test('armMetric reuses the extractor aggregate for the whole pack', function () {
  var stat = P.armMetric(BUNDLE, 'end2end', 'outcome', 'all');
  near(stat.mean, BUNDLE.arms['end2end'].outcome.mean, 1e-15);
  eq(stat.n, BUNDLE.arms['end2end'].outcome.n);
});

test('subset S and the whole pack are different numbers, not the same one', function () {
  var sVisible = P.armMetric(BUNDLE, 'end2end', 'outcome', 'visible');
  var sAll = P.armMetric(BUNDLE, 'end2end', 'outcome', 'all');
  ok(Math.abs(sVisible.mean - sAll.mean) > 0.01,
    'one lucky masked flight moves the mean, so the scopes must not be merged');
  ok(sVisible.n < sAll.n);
});

test('a null metric never becomes a number and always carries a reason', function () {
  var rows = P.verdictModel(BUNDLE, 'visible');
  rows.forEach(function (r) {
    r.bars.forEach(function (b) {
      ok(b.stat === null || P.isNum(b.stat.mean), r.metric + ' must be a number or nothing');
      if (b.stat === null) { ok(b.reasonKey, r.metric + ': a missing value must say why'); }
    });
  });

  /* Whether feedback_use is measurable depends on the run, not on the code, so
     the no-report branch is driven from a bundle that states it. */
  var noReport = JSON.parse(JSON.stringify(BUNDLE));
  noReport.meta.report_present = false;
  noReport.feedback_summary.forEach(function (r) { r.feedback_use = null; r.feedback_band = null; });
  var feedback = P.verdictModel(noReport, 'visible')
    .filter(function (r) { return r.metric === 'feedback_use'; })[0];
  feedback.bars.forEach(function (b) {
    eq(b.stat, null, 'without a report feedback_use has no value');
    eq(b.reasonKey, 'reason.no_report',
      'a missing report is not the same null as a band below threshold');
  });
});

test('the two nulls of feedback_use stay apart', function () {
  var withReport = JSON.parse(JSON.stringify(BUNDLE));
  withReport.meta.report_present = true;
  withReport.feedback_summary.forEach(function (r) { r.feedback_band = 0.02; });
  eq(P.nullReasonKey(withReport, 'end2end', 'feedback_use', 'visible'), 'reason.low_band');

  var noReport = JSON.parse(JSON.stringify(BUNDLE));
  noReport.meta.report_present = false;
  noReport.feedback_summary.forEach(function (r) { r.feedback_use = null; r.feedback_band = null; });
  eq(P.nullReasonKey(noReport, 'end2end', 'feedback_use', 'visible'), 'reason.no_report');
});

test('fidelity nulls report the scorer reason', function () {
  var mini = {
    scenarios: { s1: { goal_visible: true, is_probe: false } },
    episodes: [
      { key: 'a', scenario_id: 's1', arm: 'end2end', variant: 'normal', repetition: 0,
        scores: { prediction_fidelity: null, fidelity_invalid_reason: 'insufficient_coverage' } },
      { key: 'b', scenario_id: 's1', arm: 'end2end', variant: 'normal', repetition: 1,
        scores: { prediction_fidelity: null, fidelity_invalid_reason: 'too_few_cycles' } },
      { key: 'c', scenario_id: 's1', arm: 'end2end', variant: 'normal', repetition: 2,
        scores: { prediction_fidelity: null, fidelity_invalid_reason: 'insufficient_coverage' } }
    ]
  };
  eq(P.nullReasonKey(mini, 'end2end', 'prediction_fidelity', 'all'), 'reason.insufficient_coverage');
  eq(P.armMetric(mini, 'end2end', 'prediction_fidelity', 'all'), null);
});

test('temporal nulls tell a masked goal apart from an unscored episode', function () {
  var masked = {
    scenarios: { m1: { goal_visible: false, is_probe: false } },
    episodes: [{ key: 'm', scenario_id: 'm1', arm: 'end2end', variant: 'normal', repetition: 0,
      scores: { temporal_anticipation: null } }]
  };
  eq(P.nullReasonKey(masked, 'end2end', 'temporal_anticipation', 'all'), 'reason.masked_goal');
});

test('references come from the bundle, never from a literal', function () {
  var outcomeRefs = P.refsFor(BUNDLE, 'outcome', 'visible');
  eq(outcomeRefs.length, 3);
  near(outcomeRefs[0].value, BUNDLE.baselines.random.outcome, 1e-12);
  near(outcomeRefs[2].value, BUNDLE.baselines.oracle.outcome, 1e-12);

  var temporalRefs = P.refsFor(BUNDLE, 'temporal_anticipation', 'visible');
  eq(temporalRefs.filter(function (r) { return r.kind === 'baseline'; }).length, 2,
    'random has no temporal baseline, so it must not be drawn');
  eq(temporalRefs.filter(function (r) { return r.kind === 'origin'; }).length, 1,
    '0.5 = no lead has to be on the scale');

  var fidelityRefs = P.refsFor(BUNDLE, 'prediction_fidelity', 'visible');
  eq(fidelityRefs.length, 2, 'each arm gets its own persistence floor');
  fidelityRefs.forEach(function (r) { eq(r.kind, 'floor'); });
  near(fidelityRefs[0].value,
    P.pairedMetric(BUNDLE, 'persistence_floor_fidelity', 'visible', 'prediction_fidelity')
      .arms['end2end'].mean, 1e-12);
});

test('fidelity comparison uses only cells measurable in both arms', function () {
  var paired = P.pairedMetric(BUNDLE, 'prediction_fidelity', 'visible');
  eq(paired.n, 4, 'official M2 fidelity has four common cells');
  var row = P.verdictModel(BUNDLE, 'visible').filter(function (r) {
    return r.metric === 'prediction_fidelity';
  })[0];
  near(row.bars[0].stat.mean, paired.arms['end2end'].mean, 1e-12);
  near(row.bars[1].stat.mean, paired.arms['wm-scaffold'].mean, 1e-12);
  var delta = P.pairedDelta(BUNDLE, 'prediction_fidelity', 'visible');
  near(delta.value, 0.0182517645910098, 1e-12);
  eq(delta.n, 4);
});

test('temporal scores carry cycle and divergence-weight support', function () {
  ['end2end', 'wm-scaffold'].forEach(function (arm) {
    var primary = P.temporalSupport(BUNDLE, arm, 'visible', false);
    var clean = P.temporalSupport(BUNDLE, arm, 'visible', true);
    ok(primary.cycles > 0 && primary.meanWeight > 0, arm + ' primary support');
    ok(clean.cycles > 0 && clean.meanWeight > 0, arm + ' no-retry support');
  });
});

test('the unreachable outcome band follows from the constants', function () {
  var gap = P.outcomeGap(BUNDLE.constants, P.commonGoalRadius(BUNDLE));
  near(gap.lo, 0.4 * Math.exp(-2 / 20), 1e-12);
  near(gap.hi, 0.5 + 0.4 * Math.exp(-2 / 20), 1e-12);
  ok(gap.lo > 0.36 && gap.lo < 0.37, 'failed flights cap just above 0.36');
  eq(P.outcomeGap({}, 2), null);
  eq(P.outcomeGap(BUNDLE.constants, null), null);
  eq(P.commonGoalRadius(BUNDLE), 2);
});

/* ==========================================================================
   7. Per-episode series
   ========================================================================== */

test('errorSeries keeps unparsed and truncated cycles out of the line', function () {
  var ep = P.episodeByKey(BUNDLE, 'g001.r0.end2end');
  var s = P.errorSeries(ep);
  eq(s.points.length, ep.n_cycles, 'one point per decision cycle');
  var missing = s.points.filter(function (p) { return p.error === null; });
  eq(missing.length, 3, 'two broken predictions and one truncated cycle');
  missing.forEach(function (p) {
    ok(p.reasonKey, 'a missing error must say why');
    ok(p.reasonKey === 'lab.parse_failed' || p.reasonKey === 'lab.truncated' ||
      p.reasonKey === 'lab.no_prediction', 'unexpected reason ' + p.reasonKey);
  });
  eq(s.points[s.points.length - 1].reasonKey, 'lab.truncated');
  s.points.forEach(function (p) {
    ok(p.error === null || P.isNum(p.error), 'error is a number or nothing, never zero-filled');
  });
});

test('errorSeries reproduces the extractor error and adds the persistence line', function () {
  var ep = P.episodeByKey(BUNDLE, 'g001.r0.end2end');
  var s = P.errorSeries(ep);
  near(s.points[0].error, ep.cycles[0].pred_pos_error_m, 1e-12);
  var obs = P.stateAtTick(ep.trajectory, 0);
  var truth = ep.cycles[0].truth_at_engage;
  near(s.points[0].persistence,
    Math.sqrt(Math.pow(obs.x - truth.x, 2) + Math.pow(obs.y - truth.y, 2)), 1e-12);
  ok(s.max >= s.points[0].persistence, 'the axis must cover both series');
});

test('errorSeries flags the cycles where the model copied the state it was shown', function () {
  var echoes = 0, cycles = 0;
  BUNDLE.episodes.forEach(function (ep) {
    var s = P.errorSeries(ep);
    echoes += s.echoes;
    cycles += s.measured;
    s.points.forEach(function (p) {
      if (p.echo && P.isNum(p.error) && P.isNum(p.persistence)) {
        /* The bundle rounds pred_pos_error_m to four decimals; the
           persistence distance is computed here at full precision. */
        near(p.error, p.persistence, 5e-4, 'an echoed state is exactly the persistence guess');
      }
    });
  });
  ok(echoes > 0, 'the snapshot does contain echoed predictions');
  ok(echoes < cycles, 'but not every cycle is an echo');
});

test('the beats-the-floor count is a count, not a rate', function () {
  var s = P.errorSeries(P.episodeByKey(BUNDLE, 'g001.r0.wm-scaffold'));
  ok(s.beats <= s.measured);
  ok(Number.isInteger(s.beats) && Number.isInteger(s.measured));
});

test('stateAtTick finds a tick without assuming a dense index', function () {
  var ep = P.episodeByKey(BUNDLE, 'g001.r0.end2end');
  var st = P.stateAtTick(ep.trajectory, 20);
  eq(st.x, ep.trajectory.x[20]);
  eq(P.stateAtTick(ep.trajectory, 99999), null);
  eq(P.stateAtTick(null, 0), null);
});

/* ==========================================================================
   8. Decoy pairs
   ========================================================================== */

test('pairRows carries the delta and the heat difference the runs were shown', function () {
  var rows = P.pairRows(BUNDLE);
  eq(rows.length, BUNDLE.feedback.length);
  eq(P.allPairsIdentical(rows), true, 'every pair flew the same flight in this snapshot');
  rows.forEach(function (r) {
    eq(r.delta, 0);
    eq(r.sameScore, true);
    eq(r.actionsIdentical, true);
  });
  var c = rows.filter(function (r) { return r.scenarioId === 'g007c'; })[0];
  ok(c.heatDelta > 0.1,
    'the heat channel really did differ, which is what makes "ignored" a claim and not an artefact');
});

test('allPairsIdentical needs evidence, not emptiness', function () {
  eq(P.allPairsIdentical([]), false);
  eq(P.allPairsIdentical([
    { sameScore: true, actionsIdentical: true },
    { sameScore: true, actionsIdentical: false }
  ]), false, 'equal outcomes do not prove equal commands');
  eq(P.allPairsIdentical([{ sameScore: false, actionsIdentical: true }]), true,
    'the command-channel claim follows commands, not the outcome score');
});

/* ==========================================================================
   9. Scenario table model
   ========================================================================== */

test('tableModel is one row per scenario with one cell per arm', function () {
  var rows = P.tableModel(BUNDLE, {});
  eq(rows.length, Object.keys(BUNDLE.scenarios).length);
  rows.forEach(function (r) {
    eq(r.cells.length, 2);
    eq(r.cells[0].arm, 'end2end');
    eq(r.cells[1].arm, 'wm-scaffold');
    r.cells.forEach(function (c) {
      c.entries.forEach(function (entry) {
        eq(entry.values.length, 3, 'three micro bars per flight');
        entry.values.forEach(function (v) {
          ok(v.value === null || P.isNum(v.value));
          if (v.value === null) ok(v.reasonKey, r.scenarioId + '/' + v.metric + ' needs a reason');
          else eq(v.reasonKey, null);
        });
      });
    });
  });
});

test('probe scenarios have no flights yet and say so instead of scoring zero', function () {
  var rows = P.tableModel(BUNDLE, {});
  var probes = rows.filter(function (r) { return r.probe; });
  eq(probes.length, 2);
  probes.forEach(function (r) {
    eq(r.cells[0].entries.length, 0);
    eq(r.cells[1].entries.length, 0);
    eq(r.primaryKey, null);
    eq(r.cells[0].sortValue, null);
  });
});

test('masked scenarios are flagged and keep their temporal reason', function () {
  var rows = P.tableModel(BUNDLE, {});
  var masked = rows.filter(function (r) { return r.masked; });
  eq(masked.length, 3);
  masked.forEach(function (r) {
    r.cells.forEach(function (c) {
      c.entries.forEach(function (e) {
        var temporal = e.values.filter(function (v) { return v.metric === 'temporal_anticipation'; })[0];
        eq(temporal.value, null);
        eq(temporal.reasonKey, 'reason.masked_goal');
      });
    });
  });
});

test('table sorting works per column and pushes empty cells to the end', function () {
  var rows = P.tableModel(BUNDLE, {});
  var byId = P.sortRows(rows, P.tableSortKey('scenario'), 'asc').map(function (r) { return r.scenarioId; });
  deepEq(byId.slice(0, 3), ['g001', 'g001_b10', 'g001_b40']);

  var byBudget = P.sortRows(rows, P.tableSortKey('budget'), 'asc').map(function (r) { return r.budget; });
  for (var i = 1; i < byBudget.length; i++) ok(byBudget[i] >= byBudget[i - 1], 'budget order');

  var byArm = P.sortRows(rows, P.tableSortKey('end2end'), 'desc');
  eq(byArm[0].scenarioId, 'g007b', 'the single goal flight has the best outcome score');
  eq(byArm[byArm.length - 1].probe, true, 'scenarios with no data sort last');
  eq(byArm[byArm.length - 2].probe, true);
});

/* ==========================================================================
   10. The generated verdict sentence
   ========================================================================== */

test('buildSummary names the leader, the widest gap and the caveat', function () {
  var parts = P.buildSummary(BUNDLE, 'visible');
  var keys = parts.map(function (p) { return p.key; });
  deepEq(keys, ['verdict.summary.lead', 'verdict.summary.gap', 'verdict.summary.caveat']);

  /* Everything below is derived from the same bundle: the counts move while
     the run is still going, the behaviour must not. */
  var measurable = P.constants.AXES.filter(function (metric) {
    return ['end2end', 'wm-scaffold'].every(function (arm) {
      return P.armMetric(BUNDLE, arm, metric, 'visible') !== null;
    });
  });
  var wins = { 'end2end': 0, 'wm-scaffold': 0 };
  P.verdictModel(BUNDLE, 'visible').forEach(function (r) {
    if (!r.bars[0].stat || !r.bars[1].stat) { return; }
    var a = r.bars[0].stat.mean, b = r.bars[1].stat.mean;
    if (a > b) { wins['end2end'] += 1; } else if (b > a) { wins['wm-scaffold'] += 1; }
  });
  var lead = parts[0].params;
  eq(lead.arm, 'end2end');
  eq(lead.total, measurable.length, 'only the axes measurable in both arms are compared');
  eq(lead.n, wins['end2end'], 'the named leader carries its own win count');
  ok(wins['end2end'] > wins['wm-scaffold'], 'a leader is only named when it wins more axes');

  var gap = parts[1].params;
  var widest = null;
  P.verdictModel(BUNDLE, 'visible').forEach(function (r) {
    if (!r.bars[0].stat || !r.bars[1].stat) return;
    var d = Math.abs(r.bars[0].stat.mean - r.bars[1].stat.mean);
    if (!widest || d > widest.delta) widest = { row: r, delta: d };
  });
  var a = widest.row.bars.filter(function (bar) { return bar.arm === gap.arm; })[0].stat;
  var other = gap.arm === 'end2end' ? 'wm-scaffold' : 'end2end';
  var b = widest.row.bars.filter(function (bar) { return bar.arm === other; })[0].stat;
  eq(gap.value, P.fmt(a.mean, 4));
  eq(gap.other, P.fmt(b.mean, 4));
  eq(gap.delta, P.fmt(Math.abs(a.mean - b.mean), 4));

  var reps = {};
  P.scopeEpisodes(BUNDLE, 'visible').forEach(function (e) { reps[e.repetition] = true; });
  eq(parts[parts.length - 1].params.n, Object.keys(reps).length,
    'the caveat counts the repetitions present');
});

test('the summary refuses to sell a fidelity gap that rides on a coverage gap', function () {
  var mini = {
    meta: { repetitions_expected: 1, report_present: true },
    constants: BUNDLE.constants,
    baselines: BUNDLE.baselines,
    scenarios: { s1: { goal_visible: true, is_probe: false } },
    episodes: [
      { scenario_id: 's1', repetition: 0, arm: 'end2end', variant: 'normal',
        scores: { prediction_fidelity: 0.1, prediction_coverage: 0.2,
          temporal_anticipation: 0.5, outcome: 0.5 } },
      { scenario_id: 's1', repetition: 0, arm: 'wm-scaffold', variant: 'normal',
        scores: { prediction_fidelity: 0.9, prediction_coverage: 1.0,
          temporal_anticipation: 0.5, outcome: 0.5 } }
    ],
    feedback_summary: [
      { arm: 'end2end', feedback_use: 0.5, feedback_raw: 0, feedback_band: 1, n_pairs: 1 },
      { arm: 'wm-scaffold', feedback_use: 0.5, feedback_raw: 0, feedback_band: 1, n_pairs: 1 }
    ]
  };
  var parts = P.buildSummary(mini, 'visible');
  var guard = parts.filter(function (p) { return p.key === 'verdict.summary.coverage_guard'; })[0];
  ok(guard, 'the coverage guard must fire when fidelity wins the gap');
  var cA = P.armMetric(mini, 'wm-scaffold', 'prediction_coverage', 'visible');
  var cB = P.armMetric(mini, 'end2end', 'prediction_coverage', 'visible');
  eq(guard.params.value, P.fmt(cA.mean, 4));
  eq(guard.params.other, P.fmt(cB.mean, 4));
  ok(Math.abs(cA.mean - cB.mean) > P.constants.COVERAGE_GUARD);
});

test('buildSummary degrades to an honest refusal when nothing is measured', function () {
  var empty = {
    meta: { report_present: false },
    constants: BUNDLE.constants,
    baselines: BUNDLE.baselines,
    scenarios: { s1: { goal_visible: true, is_probe: false } },
    episodes: [{ key: 'x', scenario_id: 's1', arm: 'end2end', variant: 'normal', repetition: 0,
      scores: { prediction_fidelity: null, temporal_anticipation: null, outcome: null } }],
    feedback_summary: []
  };
  var parts = P.buildSummary(empty, 'all');
  eq(parts.length, 1);
  eq(parts[0].key, 'verdict.summary.none');
});

test('buildSummary reports a split lead rather than inventing a winner', function () {
  var split = JSON.parse(JSON.stringify(BUNDLE));
  /* Leave exactly two axes measurable: outcome to end2end, fidelity to
     wm-scaffold. Every other axis is taken off the table. */
  split.meta.report_present = false;
  split.feedback_summary.forEach(function (r) { r.feedback_use = null; r.feedback_band = null; });
  split.episodes.forEach(function (e) {
    if (e.scores) e.scores.temporal_anticipation = null;
  });
  var parts = P.buildSummary(split, 'visible');
  eq(parts[0].key, 'verdict.summary.split');
  eq(parts[0].params.total, 2);
  eq(parts[0].params.n, 1);
});

test('formatSummary produces one paragraph in both languages', function () {
  var parts = P.buildSummary(BUNDLE, 'visible');
  Charts.setLanguage('pl');
  var pl = P.formatSummary(P.buildSummary(BUNDLE, 'visible'), Charts.t);
  Charts.setLanguage('en');
  var en = P.formatSummary(P.buildSummary(BUNDLE, 'visible'), Charts.t);
  Charts.setLanguage(null);

  var gapValue = parts.filter(function (p) { return p.key === 'verdict.summary.gap'; })[0].params.value;
  [pl, en].forEach(function (text) {
    ok(text.indexOf('{') === -1, 'every placeholder must be filled: ' + text);
    ok(text.indexOf('undefined') === -1, 'no undefined leaked into the copy');
    ok(text.indexOf(gapValue) !== -1, 'the numbers come from the data');
    ok(text.length > 120, 'the summary is a real sentence, not a stub');
  });
  ok(pl !== en, 'the two languages are actually different text');
  ok(parts.length >= 3, 'lead, gap and caveat at the very least');
});

test('formatSummary uses the strings table, not hardcoded wording', function () {
  var fake = function (key) { return '[' + key + ']'; };
  var text = P.formatSummary([{ key: 'verdict.summary.none', params: {} }], fake);
  eq(text, '[verdict.summary.none]');
});

/* ==========================================================================
   11. Copy and offline contract
   ========================================================================== */

test('every string key the charts ask for exists in PL and EN', function () {
  var keys = {};
  var re = /t\('([a-z0-9_.]+)'/g, m;
  while ((m = re.exec(CHARTS_SRC)) !== null) {
    /* Skip the prefixes of runtime-composed keys such as t('metric.' + m). */
    if (m[1].charAt(m[1].length - 1) === '.') continue;
    keys[m[1]] = true;
  }

  /* Keys the chart layer composes at runtime. */
  ['prediction_fidelity', 'temporal_anticipation', 'feedback_use', 'outcome',
    'action_parse_rate', 'prediction_parse_rate', 'prediction_coverage', 'retried_cycle_rate'
  ].forEach(function (metric) {
    ['name', 'short', 'abbr'].forEach(function (suffix) {
      if (suffix === 'abbr' && ['prediction_fidelity', 'temporal_anticipation',
        'feedback_use', 'outcome'].indexOf(metric) === -1) return;
      keys['metric.' + metric + '.' + suffix] = true;
    });
  });
  ['arm.end2end', 'arm.wm_scaffold'].forEach(function (base) {
    ['name', 'label', 'short', 'long'].forEach(function (s) { keys[base + '.' + s] = true; });
  });
  ['random', 'greedy', 'oracle'].forEach(function (r) { keys['ref.' + r + '.name'] = true; });
  ['goal', 'oob', 'timeout', 'unknown'].forEach(function (o) {
    keys['outcome.' + o] = true;
    keys['outcome.' + o + '.desc'] = true;
  });
  ['insufficient_coverage', 'too_few_cycles', 'not_requested', 'masked_goal',
    'low_weight', 'no_scored_cycles', 'low_band', 'probe_scenario', 'unknown'
  ].forEach(function (r) { keys['reason.' + r] = true; });
  Object.keys(BUNDLE.scenarios).forEach(function (id) {
    keys['scenario.' + id + '.name'] = true;
    keys['scenario.' + id + '.desc'] = true;
  });

  var missing = [];
  Object.keys(keys).forEach(function (k) {
    if (STRINGS.pl[k] === undefined) missing.push('pl:' + k);
    if (STRINGS.en[k] === undefined) missing.push('en:' + k);
  });
  eq(missing.join(', '), '', 'missing string keys');
  ok(Object.keys(keys).length > 60, 'the scan really did find the keys');
});

test('charts.js carries no copy, no emoji and no colour literals', function () {
  var nonAscii = CHARTS_SRC.match(/[^\x00-\x7F]/g);
  eq(nonAscii, null, 'all human-facing text belongs in strings.js: ' + (nonAscii || []).join(''));
  eq(/#[0-9a-fA-F]{3,8}\b/.test(CHARTS_SRC.replace(/'#[a-z-]+'/g, '')), false,
    'colours come from tokens, never from a hex literal');
});

test('charts.js never reaches the network', function () {
  ['fetch(', 'XMLHttpRequest', 'http://', 'https://', 'WebSocket', 'import(', '@import']
    .forEach(function (needle) {
      eq(CHARTS_SRC.indexOf(needle), -1, 'offline contract broken by ' + needle);
    });
});

test('the public surface is one global with six renderers', function () {
  ['verdict', 'scenarioTable', 'predictionError', 'feedbackPairs', 'controls', 'probes']
    .forEach(function (fn) { eq(typeof Charts[fn], 'function', fn + ' must be exported'); });
  eq(typeof Charts._pure, 'object');
  eq(typeof sandbox.Charts, 'object', 'charts.js must attach exactly one global');
});

/* ==========================================================================
   Report
   ========================================================================== */

console.log('');
console.log('charts.js pure tests');
console.log('  passed: ' + passed);
console.log('  failed: ' + failures.length);
if (failures.length) {
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  process.exit(1);
}

/* Print the artefacts the caller asked for. */
Charts.setLanguage('pl');
console.log('');
console.log('generated verdict sentence (PL, scope = visible goal only):');
console.log('  ' + P.formatSummary(P.buildSummary(BUNDLE, 'visible'), Charts.t));
Charts.setLanguage('en');
console.log('');
console.log('generated verdict sentence (EN, scope = visible goal only):');
console.log('  ' + P.formatSummary(P.buildSummary(BUNDLE, 'visible'), Charts.t));
Charts.setLanguage('pl');
console.log('');
console.log('generated verdict sentence (PL, scope = all non-probe flights):');
console.log('  ' + P.formatSummary(P.buildSummary(BUNDLE, 'all'), Charts.t));
Charts.setLanguage(null);
console.log('');
process.exit(0);
