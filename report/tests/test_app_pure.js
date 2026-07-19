/*
 * Tests for the pure half of assets/app.js.
 *
 * assets/app.js is a plain browser script with no module system, so it is
 * loaded here by evaluating its source against a fake `window`. That keeps the
 * shipped file free of any node-only wrapper and proves the top level touches
 * no DOM: if any statement outside a function reached for `document`, this
 * file would throw on load.
 *
 * Run: node tests/test_app_pure.js
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

/* ---- harness ------------------------------------------------------------ */

var passed = 0;
var failed = 0;

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log('FAIL  ' + name + (detail === undefined ? '' : '  -> ' + detail));
  }
}

function eq(name, actual, expected) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  ok(name, a === b, 'got ' + a + ', want ' + b);
}

function loadApp() {
  var src = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
  var window = { addEventListener: function () {} };
  /* Direct eval so the local `window` above is the one app.js assigns to. */
  eval(src);
  if (!window.App || !window.App._pure) {
    throw new Error('app.js did not expose window.App._pure');
  }
  return window.App;
}

function loadStrings() {
  var src = fs.readFileSync(path.join(ROOT, 'assets', 'strings.js'), 'utf8');
  var STRINGS = null;
  eval(src);
  return STRINGS;
}

var App = loadApp();
var P = App._pure;
var STRINGS = loadStrings();

/* ---- fixtures ----------------------------------------------------------- */

var SCENARIOS = {
  g001: { scenario_id: 'g001', goal_visible: true, is_probe: false, deliberation_ticks: 20 },
  g007a: { scenario_id: 'g007a', goal_visible: false, is_probe: false, deliberation_ticks: 20 },
  g008: { scenario_id: 'g008', goal_visible: true, is_probe: true, deliberation_ticks: 10 }
};

function ep(key, over) {
  var parsed = P.parseEpisodeKey(key);
  var base = {
    key: key,
    scenario_id: parsed.scenario_id,
    repetition: parsed.repetition,
    arm: parsed.arm,
    variant: parsed.variant,
    n_cycles: 5,
    scores: { prediction_coverage: 1, outcome: 0.1, prediction_fidelity: 0.2 }
  };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

var EPISODES = [
  ep('g001.r0.end2end'),
  ep('g001.r0.wm-scaffold'),
  ep('g001.r1.end2end'),
  ep('g007a.r0.end2end'),
  ep('g007a.r0.end2end.decoy'),
  ep('g008.r0.end2end')
];

/* ======================================================================
   1. Hash routing
   ====================================================================== */

eq('hash: empty string -> what', P.parseHash(''), { tab: 'what', episode: null });
eq('hash: undefined -> what', P.parseHash(undefined), { tab: 'what', episode: null });
eq('hash: bare hash -> what', P.parseHash('#'), { tab: 'what', episode: null });
eq('hash: tab only', P.parseHash('#results'), { tab: 'results', episode: null });
eq('hash: tab plus episode', P.parseHash('#lab/g001.r0.end2end'),
  { tab: 'lab', episode: 'g001.r0.end2end' });
eq('hash: decoy episode survives', P.parseHash('#lab/g007a.r0.wm-scaffold.decoy'),
  { tab: 'lab', episode: 'g007a.r0.wm-scaffold.decoy' });
eq('hash: unknown tab falls back to what', P.parseHash('#nonsense'),
  { tab: 'what', episode: null });
eq('hash: unknown tab with episode keeps the episode', P.parseHash('#nonsense/g001.r0.end2end'),
  { tab: 'what', episode: 'g001.r0.end2end' });
eq('hash: bare episode key routes to the lab', P.parseHash('#g001.r0.end2end'),
  { tab: 'lab', episode: 'g001.r0.end2end' });
eq('hash: leading slashes tolerated', P.parseHash('#/lab/g001.r0.end2end'),
  { tab: 'lab', episode: 'g001.r0.end2end' });
eq('hash: percent-encoding decoded', P.parseHash('#lab/g001.r0.wm-scaffold'),
  { tab: 'lab', episode: 'g001.r0.wm-scaffold' });
eq('hash: uppercase tab normalised', P.parseHash('#LAB'), { tab: 'lab', episode: null });

eq('hash build: tab only', P.buildHash('results', null), '#results');
eq('hash build: tab plus episode', P.buildHash('lab', 'g001.r0.end2end'), '#lab/g001.r0.end2end');
eq('hash build: unknown tab normalised', P.buildHash('zzz', null), '#what');

var ROUND_TRIP = ['#what', '#results', '#lab', '#lab/g001.r0.end2end', '#lab/g007a.r0.end2end.decoy'];
ROUND_TRIP.forEach(function (h) {
  var parsed = P.parseHash(h);
  eq('hash round trip ' + h, P.buildHash(parsed.tab, parsed.episode), h);
});

eq('tab: normalize known', P.normalizeTab('lab'), 'lab');
eq('tab: normalize null', P.normalizeTab(null), 'what');
eq('tab: normalize number-like', P.normalizeTab(3), 'what');

/* ======================================================================
   2. Episode keys
   ====================================================================== */

eq('key: plain', P.parseEpisodeKey('g001.r0.end2end'),
  { scenario_id: 'g001', repetition: 0, arm: 'end2end', variant: 'normal' });
eq('key: hyphenated arm', P.parseEpisodeKey('g001_b40.r1.wm-scaffold'),
  { scenario_id: 'g001_b40', repetition: 1, arm: 'wm-scaffold', variant: 'normal' });
eq('key: decoy suffix', P.parseEpisodeKey('g007b.r0.wm-scaffold.decoy'),
  { scenario_id: 'g007b', repetition: 0, arm: 'wm-scaffold', variant: 'decoy' });
eq('key: control suffix', P.parseEpisodeKey('g008.r0.probe.control'),
  { scenario_id: 'g008', repetition: 0, arm: 'probe', variant: 'control' });
eq('key: malformed', P.parseEpisodeKey('nonsense'), null);
eq('key: missing repetition', P.parseEpisodeKey('g001.x0.end2end'), null);
eq('key: not a string', P.parseEpisodeKey(null), null);

ok('key shape: accepts a real key', P.looksLikeEpisodeKey('g001_b10.r1.wm-scaffold'));
ok('key shape: rejects a tab name', !P.looksLikeEpisodeKey('results'));

/* ======================================================================
   3. Language selection
   ====================================================================== */

eq('lang: stored wins', P.pickLang('en', ['pl-PL'], ['pl', 'en']), 'en');
eq('lang: invalid stored ignored', P.pickLang('de', ['en-GB'], ['pl', 'en']), 'en');
eq('lang: navigator prefix match', P.pickLang(null, ['en-US', 'pl'], ['pl', 'en']), 'en');
eq('lang: first supported navigator entry wins',
  P.pickLang(null, ['de-DE', 'pl-PL', 'en'], ['pl', 'en']), 'pl');
eq('lang: nothing matches -> default pl', P.pickLang(null, ['de-DE'], ['pl', 'en']), 'pl');
eq('lang: no navigator at all -> default pl', P.pickLang(null, null, ['pl', 'en']), 'pl');
eq('lang: empty stored string ignored', P.pickLang('', ['pl'], ['pl', 'en']), 'pl');

/* ======================================================================
   4. The T helper
   ====================================================================== */

var dictPl = { 'a.b': 'wartosc', 'p.tpl': 'jest {n} z {total}', 'only.pl': 'tylko po polsku' };
var dictEn = { 'a.b': 'value', 'p.tpl': '{n} of {total}', 'only.pl': 'polish only' };

var tEn = P.makeT(dictEn, dictPl);
eq('T: plain lookup', tEn('a.b'), 'value');
eq('T: placeholders substituted', tEn('p.tpl', { n: 3, total: 7 }), '3 of 7');
eq('T: unknown placeholder left alone', tEn('p.tpl', { n: 3 }), '3 of {total}');
eq('T: zero is substituted, not treated as missing', tEn('p.tpl', { n: 0, total: 0 }), '0 of 0');

var tPartial = P.makeT({ 'a.b': 'value' }, dictPl);
eq('T: falls back to the other language', tPartial('only.pl'), 'tylko po polsku');
eq('T: missing everywhere returns the key itself', tPartial('no.such.key'), 'no.such.key');
eq('T: missing key with params still returns the key', tPartial('no.such.key', { n: 1 }), 'no.such.key');
eq('T: null key returns empty string', tPartial(null), '');

var tNoDicts = P.makeT(null, null);
eq('T: no dictionaries at all still returns the key', tNoDicts('a.b'), 'a.b');

var tNonString = P.makeT({ 'a.b': 12 }, dictPl);
eq('T: a non-string entry falls through to the fallback', tNonString('a.b'), 'wartosc');

eq('template: no params is a no-op', P.formatTemplate('{n} z {total}', null), '{n} z {total}');
eq('template: non-string passes through', P.formatTemplate(null, { n: 1 }), null);

/* The shipped table must actually answer every key the shell asks for. */
var tShipPl = P.makeT(STRINGS.pl, STRINGS.pl);
var tShipEn = P.makeT(STRINGS.en, STRINGS.pl);
var SHELL_KEYS = [
  'app.title', 'tab.what', 'tab.results', 'tab.lab',
  'shell.keys.title', 'shell.keys.tabs', 'shell.keys.play', 'shell.keys.scrub',
  'shell.keys.jump', 'shell.keys.close', 'shell.error.title', 'shell.theme.aria',
  'shell.theme.dark', 'shell.theme.light', 'shell.run.in_progress', 'shell.run.complete',
  'shell.run.aria', 'shell.module_missing', 'shell.static_frame',
  'shell.demo.title', 'shell.demo.note', 'metric.subset.note',
  'results.probes.title', 'results.probes.not_run', 'results.pairs.title',
  'results.pairs.same_commands', 'results.pairs.same_score',
  'results.pairs.headline', 'metric.formula.label',
  'probe.chance', 'control.calls_note', 'unit.s',
  'story.rule_a.glossary', 'story.more.summary',
  'footer.generated', 'footer.repo', 'footer.license',
  'lab.overlay.title', 'lab.show_hidden_goal',
  'lab.current_cycle', 'lab.error_chart.title', 'lab.raw.empty',
  'empty.metric_unmeasurable', 'empty.no_episodes', 'empty.no_report',
  'reason.insufficient_coverage', 'reason.too_few_cycles', 'reason.not_requested',
  'reason.masked_goal', 'reason.unknown'
];
SHELL_KEYS.forEach(function (key) {
  ok('strings pl has ' + key, tShipPl(key) !== key, 'key echoed back');
  ok('strings en has ' + key, tShipEn(key) !== key, 'key echoed back');
});

/* Dynamic key families the shell builds by concatenation. */
P.COGNITIVE_METRICS.concat(P.CONTROL_METRICS).forEach(function (metric) {
  ok('metric name exists: ' + metric, tShipPl('metric.' + metric + '.name') !== 'metric.' + metric + '.name');
});
['goal', 'oob', 'timeout', 'unknown'].forEach(function (outcome) {
  ok('outcome label exists: ' + outcome, tShipPl('outcome.' + outcome) !== 'outcome.' + outcome);
  ok('outcome desc exists: ' + outcome, tShipPl('outcome.' + outcome + '.desc') !== 'outcome.' + outcome + '.desc');
});
['decoy', 'format', 'scaffold', 'oob', 'floor'].forEach(function (name) {
  ok('finding exists: ' + name, tShipPl('finding.' + name + '.title') !== 'finding.' + name + '.title');
});
['random', 'greedy', 'oracle'].forEach(function (name) {
  ok('reference exists: ' + name, tShipPl('ref.' + name + '.name') !== 'ref.' + name + '.name');
});

/* ======================================================================
   5. Episode filtering
   ====================================================================== */

function keys(list) { return list.map(function (e) { return e.key; }); }

var ALL = { arm: 'all', scenario: 'all', rep: 'all', variant: 'all', goal: 'all' };

eq('filter: all passes everything',
  P.filterEpisodes(EPISODES, ALL, SCENARIOS).length, EPISODES.length);
eq('filter: no filter object passes everything',
  P.filterEpisodes(EPISODES, null, SCENARIOS).length, EPISODES.length);
eq('filter: by arm',
  keys(P.filterEpisodes(EPISODES, { arm: 'wm-scaffold' }, SCENARIOS)), ['g001.r0.wm-scaffold']);
eq('filter: by scenario',
  keys(P.filterEpisodes(EPISODES, { scenario: 'g007a' }, SCENARIOS)),
  ['g007a.r0.end2end', 'g007a.r0.end2end.decoy']);
eq('filter: repetition given as a string',
  keys(P.filterEpisodes(EPISODES, { rep: '1' }, SCENARIOS)), ['g001.r1.end2end']);
eq('filter: repetition given as a number',
  keys(P.filterEpisodes(EPISODES, { rep: 1 }, SCENARIOS)), ['g001.r1.end2end']);
eq('filter: repetition 0 is a real filter, not "all"',
  keys(P.filterEpisodes(EPISODES, { rep: 0 }, SCENARIOS)).length, 5);
eq('filter: decoy only',
  keys(P.filterEpisodes(EPISODES, { variant: 'decoy' }, SCENARIOS)), ['g007a.r0.end2end.decoy']);
eq('filter: masked goal only',
  keys(P.filterEpisodes(EPISODES, { goal: 'masked' }, SCENARIOS)),
  ['g007a.r0.end2end', 'g007a.r0.end2end.decoy']);
eq('filter: visible goal only',
  keys(P.filterEpisodes(EPISODES, { goal: 'visible' }, SCENARIOS)),
  ['g001.r0.end2end', 'g001.r0.wm-scaffold', 'g001.r1.end2end', 'g008.r0.end2end']);
eq('filter: combined filters intersect',
  keys(P.filterEpisodes(EPISODES, { goal: 'masked', variant: 'normal' }, SCENARIOS)),
  ['g007a.r0.end2end']);
eq('filter: impossible combination is empty, not everything',
  P.filterEpisodes(EPISODES, { arm: 'wm-scaffold', scenario: 'g007a' }, SCENARIOS).length, 0);
eq('filter: unknown scenario id yields nothing',
  P.filterEpisodes(EPISODES, { scenario: 'zzz' }, SCENARIOS).length, 0);
eq('filter: goal filter with no scenario table excludes rather than guesses',
  P.filterEpisodes(EPISODES, { goal: 'visible' }, {}).length, 0);
ok('filter: a null episode never matches', !P.episodeMatches(null, ALL, SCENARIOS));

/* ======================================================================
   6. Sorting - nulls must never read as zero
   ====================================================================== */

var SORT_ROWS = [
  { id: 'a', v: 0.5 },
  { id: 'b', v: null },
  { id: 'c', v: 0.1 },
  { id: 'd', v: 0.9 },
  { id: 'e', v: null }
];
function byV(row) { return row.v; }

eq('sort: ascending puts nulls last',
  P.sortRows(SORT_ROWS, byV, 1).map(function (r) { return r.id; }), ['c', 'a', 'd', 'b', 'e']);
eq('sort: descending also puts nulls last',
  P.sortRows(SORT_ROWS, byV, -1).map(function (r) { return r.id; }), ['d', 'a', 'c', 'b', 'e']);
eq('sort: strings compare as strings',
  P.sortRows([{ s: 'wm-scaffold' }, { s: 'end2end' }], function (r) { return r.s; }, 1)
    .map(function (r) { return r.s; }), ['end2end', 'wm-scaffold']);
eq('sort: equal values keep input order',
  P.sortRows([{ id: 1, v: 1 }, { id: 2, v: 1 }, { id: 3, v: 1 }], byV, 1)
    .map(function (r) { return r.id; }), [1, 2, 3]);
eq('sort: does not mutate the input', SORT_ROWS.map(function (r) { return r.id; }),
  ['a', 'b', 'c', 'd', 'e']);

/* ======================================================================
   7. Numbers and aggregates
   ====================================================================== */

eq('num: null stays null, never "0.000"', P.fmtNum(null, 3), null);
eq('num: undefined stays null', P.fmtNum(undefined, 3), null);
eq('num: NaN stays null', P.fmtNum(NaN, 3), null);
eq('num: zero formats as zero', P.fmtNum(0, 3), '0.000');
eq('num: rounds to the asked precision', P.fmtNum(0.123456, 3), '0.123');

eq('mean: skips nulls and reports its own n', P.mean([1, null, 3]), { mean: 2, n: 2 });
eq('mean: all nulls is unmeasurable, not zero', P.mean([null, null]), { mean: null, n: 0 });
eq('mean: empty list is unmeasurable', P.mean([]), { mean: null, n: 0 });

eq('clamp: below', P.clamp(-1, 0, 5), 0);
eq('clamp: above', P.clamp(9, 0, 5), 5);
eq('clamp: inside', P.clamp(3, 0, 5), 3);

eq('reason: known code maps to its key', P.reasonKey('insufficient_coverage'), 'reason.insufficient_coverage');
eq('reason: unknown code is honest', P.reasonKey('who_knows'), 'reason.unknown');
eq('reason: null code is honest', P.reasonKey(null), 'reason.unknown');

/* ======================================================================
   8. Comparable subset and the demo pick
   ====================================================================== */

eq('subset: excludes masked, probe and decoy episodes',
  keys(P.comparableSubset(EPISODES, SCENARIOS)),
  ['g001.r0.end2end', 'g001.r0.wm-scaffold', 'g001.r1.end2end']);
eq('subset: empty scenario table yields nothing rather than everything',
  P.comparableSubset(EPISODES, {}).length, 0);

var DEMO_POOL = [
  ep('g007a.r0.end2end', { scores: { prediction_coverage: 1 }, n_cycles: 5 }),
  ep('g001.r0.end2end', { scores: { prediction_coverage: 0.25 }, n_cycles: 5 }),
  ep('g001.r0.wm-scaffold', { scores: { prediction_coverage: 1 }, n_cycles: 5 })
];
eq('demo: prefers full coverage, a visible goal and a normal heat signal',
  P.pickDemoEpisode(DEMO_POOL, SCENARIOS).key, 'g001.r0.wm-scaffold');
eq('demo: deterministic across calls',
  P.pickDemoEpisode(DEMO_POOL, SCENARIOS).key, P.pickDemoEpisode(DEMO_POOL, SCENARIOS).key);
eq('demo: no episodes at all', P.pickDemoEpisode([], SCENARIOS), null);

/* ======================================================================
   9. Cycle lookup and raw completion splitting
   ====================================================================== */

var CYCLES = [{ tick: 0 }, { tick: 20 }, { tick: 40 }];
eq('cycle at tick 0', P.cycleIndexAtTick(CYCLES, 0), 0);
eq('cycle at tick 19', P.cycleIndexAtTick(CYCLES, 19), 0);
eq('cycle at tick 20', P.cycleIndexAtTick(CYCLES, 20), 1);
eq('cycle past the end', P.cycleIndexAtTick(CYCLES, 999), 2);
eq('cycle before the first', P.cycleIndexAtTick(CYCLES, -1), -1);
eq('cycle with no cycles', P.cycleIndexAtTick([], 5), -1);

var SPLIT = P.splitCompletion('Sure! {"action": {"accel_x_mps2": 1.0}} hope that helps');
eq('raw: json body isolated', SPLIT.json, '{"action": {"accel_x_mps2": 1.0}}');
eq('raw: prose before kept', SPLIT.before, 'Sure! ');
eq('raw: prose after kept', SPLIT.after, ' hope that helps');
eq('raw: braces inside strings do not end the object',
  P.splitCompletion('{"note": "a } brace"}').json, '{"note": "a } brace"}');
eq('raw: escaped quote inside a string is handled',
  P.splitCompletion('{"note": "say \\" then }"}').json, '{"note": "say \\" then }"}');
eq('raw: no json at all', P.splitCompletion('total refusal').json, '');
eq('raw: unterminated object still shows what arrived',
  P.splitCompletion('{"action": ').json, '{"action": ');
eq('raw: empty input', P.splitCompletion('').json, '');
eq('raw: null input', P.splitCompletion(null).json, '');

/* ======================================================================
   10. Screen heading
   ====================================================================== */

eq('heading: moving right', P.headingDeg(1, 0), 0);
eq('heading: falling (world -y) points down the screen', P.headingDeg(0, -1), 90);
eq('heading: climbing points up the screen', P.headingDeg(0, 1), -90);

/* ======================================================================
   10b. Raw completions, per-cycle reasons and paired aggregates
   ====================================================================== */

/* A wm-scaffold cycle that had to be asked twice for its prediction: the
   retry is a second attempt at stage 1, never "stage 2: decision". */
var retried = P.labelCompletions('wm-scaffold', [
  '{"prediction":{"pos_x_m":9.04 + (-4.71 * 1)',
  '{"prediction":{"pos_x_m":8.411,"pos_y_m":58.411}}',
  '{"action":{"accel_x_mps2":0.75,"accel_y_mps2":-1.25}}'
], { parse_failed: false, prediction_parse_failed: false });
eq('completions: stages of a retried scaffold cycle',
  retried.map(function (c) { return c.stageKey; }),
  ['lab.prompt.stage1', 'lab.prompt.stage1', 'lab.prompt.stage2']);
eq('completions: attempts are numbered inside their own stage',
  retried.map(function (c) { return c.attempt; }), [1, 2, 1]);
eq('completions: the attempt that was retried is the one marked broken',
  retried.map(function (c) { return c.failed; }), [true, false, false]);

var single = P.labelCompletions('end2end', ['nonsense', '{"action":{}}'],
  { parse_failed: true, prediction_parse_failed: true });
eq('completions: one prompt keeps one stage name for every attempt',
  single.map(function (c) { return c.stageKey; }),
  ['lab.prompt.single', 'lab.prompt.single']);
eq('completions: the last attempt inherits the cycle parse flag',
  single.map(function (c) { return c.failed; }), [true, true]);
eq('completions: no completions, no labels', P.labelCompletions('end2end', [], {}), []);

eq('reason: a broken prediction is not "we did not ask"',
  P.cycleUnmeasurableReason({ prediction_parse_failed: true }), 'parse_failed');
eq('reason: a cut-short cycle says so',
  P.cycleUnmeasurableReason({ truncated: true, prediction_parse_failed: true }), 'truncated');
eq('reason: only an unasked prediction is "not requested"',
  P.cycleUnmeasurableReason({ prediction_requested: false }), 'not_requested');
eq('reason: anything else stays unknown rather than guessing',
  P.cycleUnmeasurableReason({}), 'unknown');

var pairEps = [
  { arm: 'end2end', scenario_id: 's1', repetition: 0, variant: 'normal', scores: { prediction_fidelity: 0.2, persistence_floor_fidelity: 0.1 } },
  { arm: 'wm-scaffold', scenario_id: 's1', repetition: 0, variant: 'normal', scores: { prediction_fidelity: 0.4, persistence_floor_fidelity: 0.3 } },
  /* Measurable in one arm only: must not enter either mean. */
  { arm: 'end2end', scenario_id: 's2', repetition: 0, variant: 'normal', scores: { prediction_fidelity: 0.9, persistence_floor_fidelity: 0.5 } },
  { arm: 'wm-scaffold', scenario_id: 's2', repetition: 0, variant: 'normal', scores: { prediction_fidelity: null, persistence_floor_fidelity: 0.7 } }
];
var pf = P.pairedFidelity(pairEps);
eq('paired fidelity: only cells measurable in both arms count', pf.n, 1);
eq('paired fidelity: end2end mean over the paired cell', pf.means['end2end'], 0.2);
eq('paired fidelity: wm-scaffold mean over the paired cell', pf.means['wm-scaffold'], 0.4);
eq('paired fidelity: nothing paired, nothing claimed',
  P.pairedFidelity([pairEps[2]]).n, 0);

var floor = P.matchedFloorMean(pairEps, 'end2end');
eq('matched floor: averaged over the same episodes as fidelity', floor.n, 2);
ok('matched floor: value is the mean of those two floors',
  Math.abs(floor.mean - 0.3) < 1e-12, String(floor.mean));
eq('matched floor: an arm with no measurable fidelity has no floor either',
  P.matchedFloorMean([pairEps[3]], 'wm-scaffold').mean, null);

ok('direction: retried_cycle_rate is the metric where lower wins',
  P.LOWER_IS_BETTER.retried_cycle_rate === true);
ok('direction: every metric named lower-is-better is a known metric',
  Object.keys(P.LOWER_IS_BETTER).every(function (m) {
    return P.CONTROL_METRICS.indexOf(m) !== -1 || P.COGNITIVE_METRICS.indexOf(m) !== -1;
  }));

/* ======================================================================
   11. The real bundle, when it is there
   ====================================================================== */

var bundlePath = path.join(ROOT, 'data', 'bundle.json');
if (fs.existsSync(bundlePath)) {
  var B = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));

  ok('bundle: every episode key parses', B.episodes.every(function (e) {
    var parsed = P.parseEpisodeKey(e.key);
    return parsed && parsed.scenario_id === e.scenario_id && parsed.arm === e.arm &&
      parsed.repetition === e.repetition && parsed.variant === e.variant;
  }));

  ok('bundle: every episode key round-trips through the hash',
    B.episodes.every(function (e) {
      return P.parseHash(P.buildHash('lab', e.key)).episode === e.key;
    }));

  ok('bundle: every scenario referenced by an episode exists',
    B.episodes.every(function (e) { return !!B.scenarios[e.scenario_id]; }));

  var demoPick = P.pickDemoEpisode(B.episodes, B.scenarios);
  ok('bundle: a demo episode is picked', !!demoPick);
  ok('bundle: the demo has a visible goal', B.scenarios[demoPick.scenario_id].goal_visible === true);
  ok('bundle: the demo has full prediction coverage', demoPick.scores.prediction_coverage === 1);
  ok('bundle: the demo has at least three cycles', demoPick.n_cycles >= 3);
  ok('bundle: the demo shows true heat', demoPick.variant === 'normal');

  var subset = P.comparableSubset(B.episodes, B.scenarios);
  ok('bundle: the comparable subset is not empty', subset.length > 0);
  ok('bundle: the comparable subset excludes masked goals',
    subset.every(function (e) { return B.scenarios[e.scenario_id].goal_visible === true; }));
  ok('bundle: the comparable subset excludes decoys',
    subset.every(function (e) { return e.variant === 'normal'; }));

  var nullFidelity = B.episodes.filter(function (e) { return e.scores.prediction_fidelity === null; });
  ok('bundle: every null fidelity carries a reason the UI can name',
    nullFidelity.every(function (e) {
      return P.reasonKey(e.scores.fidelity_invalid_reason) !== 'reason.unknown';
    }), nullFidelity.length + ' null fidelities');

  ok('bundle: every scenario the filters offer has a name string',
    Object.keys(B.scenarios).every(function (id) {
      return typeof STRINGS.pl['scenario.' + id + '.name'] === 'string';
    }));

  ok('bundle: every outcome value has a chip string',
    B.episodes.every(function (e) {
      return typeof STRINGS.pl['outcome.' + e.outcome] === 'string';
    }));

  ok('bundle: every arm has a label string',
    B.episodes.every(function (e) { return e.arm === 'end2end' || e.arm === 'wm-scaffold'; }));

  var withRaw = 0;
  B.episodes.forEach(function (e) {
    (e.cycles || []).forEach(function (c) {
      (c.raw_completions || []).forEach(function (raw) {
        var parts = P.splitCompletion(raw);
        if (parts.before + parts.json + parts.after !== String(raw)) {
          ok('bundle: completion split is lossless', false, e.key);
        }
        withRaw += 1;
      });
    });
  });
  ok('bundle: completion split is lossless over ' + withRaw + ' replies', true);

  /* Every gap in the per-cycle prediction has to name its own cause. On this
     run no prompt ever skipped the prediction, so "not requested" must not be
     the answer anywhere - that reason belongs to a prompt that never asked. */
  var reasons = {};
  var gaps = 0;
  B.episodes.forEach(function (e) {
    (e.cycles || []).forEach(function (c) {
      if (c.pred_pos_error_m !== null && c.pred_pos_error_m !== undefined) { return; }
      gaps += 1;
      var r = P.cycleUnmeasurableReason(c);
      reasons[r] = (reasons[r] || 0) + 1;
    });
  });
  ok('bundle: ' + gaps + ' unmeasurable cycles, reasons ' + JSON.stringify(reasons),
    gaps === 0 || !reasons.not_requested,
    'a cycle that was asked for a prediction must not be labelled "not requested"');
  ok('bundle: no unmeasurable cycle falls through to "unknown"', !reasons.unknown,
    JSON.stringify(reasons));

  /* The paired fidelity row is the only arm-vs-arm fidelity comparison the
     data supports; it must rest on cells, not on the whole pack. */
  var realPaired = P.pairedFidelity(B.episodes);
  ok('bundle: paired fidelity uses fewer cells than either arm has episodes',
    realPaired.n > 0 && realPaired.n <= B.arms['end2end'].prediction_fidelity.n,
    'paired ' + realPaired.n + ' vs end2end n ' + B.arms['end2end'].prediction_fidelity.n);
  ['end2end', 'wm-scaffold'].forEach(function (arm) {
    var matched = P.matchedFloorMean(B.episodes, arm);
    ok('bundle: matched floor for ' + arm + ' counts the fidelity episodes',
      matched.n === B.arms[arm].prediction_fidelity.n,
      matched.n + ' vs ' + B.arms[arm].prediction_fidelity.n);
  });
}

/* ---- report ------------------------------------------------------------- */

console.log('');
console.log('passed ' + passed + ', failed ' + failed);
process.exit(failed ? 1 : 0);
