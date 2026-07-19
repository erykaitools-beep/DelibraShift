/*
 * DelibraShift / Windrift viewer - application shell.
 *
 * Owns: the page chrome (top rail, tab bar, footer), routing through the URL
 * hash, language and theme, every table and readout, the empty and error
 * states, keyboard navigation and the print frame.
 *
 * Does NOT own: the animated arena (window.Arena) or the SVG charts
 * (window.Charts). Both are optional; when either is missing the shell keeps
 * working and falls back to a static frame plus the table view of the same
 * data, because no finding may be locked inside a picture.
 *
 * CONTRACT WITH window.Arena
 *   Arena.create(mountEl, options) -> instance          (mount, init or a
 *   constructor are accepted as aliases)
 *   options = {
 *     episode, scenario, bundle, t, mode: 'demo' | 'lab',
 *     loop: bool, autoplay: bool, speed: number,
 *     onFrame: function (frame) {}   // {tick, cycle, playing}
 *   }
 *   instance methods, all optional, first found name wins:
 *     setEpisode | load | setData        (episode, scenario, options)
 *     play | start                       ()
 *     pause | stop                       ()
 *     seekCycle | goToCycle | setCycle   (cycleIndex)
 *     seekTick | seek | setTick          (tick)
 *     setSpeed | speed                   (multiplier)
 *     setOverlay | setCompare            (episode | null)
 *     setRevealGoal | setShowHiddenGoal  (bool)
 *     destroy | dispose                  ()
 *   instance.providesTransport === true tells the shell not to draw its own
 *   transport row (play, pause, speed, scrubber).
 *
 * CONTRACT WITH window.Charts
 *   drawChart(kind, mountEl, spec) looks for Charts[kind], then for the
 *   camel-cased kind, then for one generic Charts.render(mountEl, spec) with
 *   spec.kind set. Every kind this file passes to drawChart MUST resolve to
 *   one of those; build_report.py greps the kinds out of this file and asserts
 *   it against the loaded module, because a silent miss would print "the
 *   drawing module did not load" on a page where it loaded perfectly.
 *   Any truthy return means "drawn"; false or a throw means the shell keeps
 *   its own table visible and says so.
 *   Charts.setLanguage(lang), when present, is called on every language switch.
 *
 * Conventions: plain script, one global, no dependencies, no network. Every
 * user-visible string comes from assets/strings.js through t(). Pure functions
 * are exported on App._pure so they can be tested in node without a DOM.
 */
(function () {
  'use strict';

  /* ======================================================================
     1. Pure helpers - no DOM, no globals, testable in node
     ====================================================================== */

  var TABS = ['what', 'results', 'lab'];
  var LANGS = ['pl', 'en'];
  var DEFAULT_LANG = 'pl';
  var ARMS = ['end2end', 'wm-scaffold'];

  var COGNITIVE_METRICS = [
    'prediction_fidelity',
    'temporal_anticipation',
    'feedback_use',
    'outcome'
  ];

  var CONTROL_METRICS = [
    'action_parse_rate',
    'prediction_parse_rate',
    'prediction_coverage',
    'retried_cycle_rate'
  ];

  /* Metrics whose better direction is downward. A bar cell always implies
     "longer is better", so these rows draw 1 - value and label the inversion.
     Kept next to CONTROL_METRICS so a new control metric cannot be added
     without a decision about its direction. */
  var LOWER_IS_BETTER = {
    retried_cycle_rate: true
  };

  var REASON_KEYS = {
    insufficient_coverage: 'reason.insufficient_coverage',
    too_few_cycles: 'reason.too_few_cycles',
    not_requested: 'reason.not_requested',
    masked_goal: 'reason.masked_goal',
    low_weight: 'reason.low_weight',
    no_scored_cycles: 'reason.no_scored_cycles',
    low_band: 'reason.low_band',
    probe_scenario: 'reason.probe_scenario',
    parse_failed: 'reason.parse_failed',
    truncated: 'reason.truncated',
    not_published: 'reason.not_published'
  };

  /**
   * Why one cycle carries no prediction number.
   *
   * "Not requested" is the scorer's reason for a prompt that never asked for a
   * prediction. Every cycle of this run asked, so stamping it on every gap
   * relabelled the arm's own broken JSON as "we did not ask" - the exact
   * inversion of the rule that formatting and cognition stay apart.
   */
  function cycleUnmeasurableReason(cycle) {
    if (!cycle) { return 'not_requested'; }
    if (cycle.truncated) { return 'truncated'; }
    if (cycle.prediction_parse_failed) { return 'parse_failed'; }
    if (cycle.prediction_requested === false) { return 'not_requested'; }
    return 'unknown';
  }

  /** Map a scorer reason onto its strings.js key; unknown reasons stay honest. */
  function reasonKey(raw) {
    if (!raw) { return 'reason.unknown'; }
    return REASON_KEYS[raw] || 'reason.unknown';
  }

  /** Coerce any tab name onto a known tab; anything unknown lands on "what". */
  function normalizeTab(name) {
    var n = String(name == null ? '' : name).toLowerCase();
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i] === n) { return TABS[i]; }
    }
    return TABS[0];
  }

  /** True for something shaped like "g001.r0.end2end" or "...end2end.decoy". */
  function looksLikeEpisodeKey(value) {
    return typeof value === 'string' && /^[a-z0-9_]+\.r\d+\.[a-z0-9-]+(\.[a-z]+)?$/i.test(value);
  }

  /**
   * Read the URL hash into view state.
   * "#lab/g001.r0.end2end" -> {tab: "lab", episode: "g001.r0.end2end"}
   * A bare episode key is accepted and routed to the lab.
   */
  function parseHash(hash) {
    var raw = String(hash == null ? '' : hash);
    if (raw.charAt(0) === '#') { raw = raw.slice(1); }
    while (raw.charAt(0) === '/') { raw = raw.slice(1); }
    if (!raw) { return { tab: TABS[0], episode: null }; }

    var parts = raw.split('/');
    var head = parts[0] || '';
    var tail = parts.length > 1 && parts[1] ? parts[1] : null;

    if (looksLikeEpisodeKey(head) && TABS.indexOf(head.toLowerCase()) === -1) {
      return { tab: 'lab', episode: decodeSafe(head) };
    }
    return { tab: normalizeTab(head), episode: tail ? decodeSafe(tail) : null };
  }

  function decodeSafe(value) {
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }

  /** Inverse of parseHash. The episode segment is dropped when absent. */
  function buildHash(tab, episodeKey) {
    var t = normalizeTab(tab);
    if (!episodeKey) { return '#' + t; }
    return '#' + t + '/' + encodeURIComponent(episodeKey);
  }

  /** Substitute {token} placeholders; unknown tokens are left untouched. */
  function formatTemplate(text, params) {
    if (typeof text !== 'string' || !params) { return text; }
    return text.replace(/\{([a-z0-9_]+)\}/gi, function (whole, token) {
      var value = params[token];
      return value === undefined || value === null ? whole : String(value);
    });
  }

  /**
   * Build a translator over one dictionary with a fallback dictionary.
   * Lookup order: active language -> fallback language -> the key itself.
   * Returning the key is deliberate: a missing string must be visible as a
   * bug, never as an empty box.
   */
  function makeT(dict, fallbackDict) {
    var primary = dict || {};
    var backup = fallbackDict || {};
    return function (key, params) {
      if (key == null) { return ''; }
      var k = String(key);
      var text = primary[k];
      if (typeof text !== 'string') { text = backup[k]; }
      if (typeof text !== 'string') { return k; }
      return formatTemplate(text, params);
    };
  }

  /** Stored choice wins, then the browser's preference, then Polish. */
  function pickLang(stored, navigatorLangs, available) {
    var langs = available && available.length ? available : LANGS;
    if (stored && langs.indexOf(stored) !== -1) { return stored; }
    var list = navigatorLangs || [];
    for (var i = 0; i < list.length; i++) {
      var tag = String(list[i] || '').toLowerCase().split('-')[0];
      if (langs.indexOf(tag) !== -1) { return tag; }
    }
    return langs.indexOf(DEFAULT_LANG) !== -1 ? DEFAULT_LANG : langs[0];
  }

  /** "g007a.r0.wm-scaffold.decoy" -> its four parts, or null when malformed. */
  function parseEpisodeKey(key) {
    if (typeof key !== 'string') { return null; }
    var parts = key.split('.');
    if (parts.length < 3) { return null; }
    var scenario = parts[0];
    var rep = parts[1];
    if (!/^r\d+$/.test(rep)) { return null; }
    var variant = 'normal';
    var armParts = parts.slice(2);
    var last = armParts[armParts.length - 1];
    if (last === 'decoy' || last === 'control') {
      variant = last;
      armParts = armParts.slice(0, -1);
    }
    if (!armParts.length) { return null; }
    return {
      scenario_id: scenario,
      repetition: parseInt(rep.slice(1), 10),
      arm: armParts.join('.'),
      variant: variant
    };
  }

  /** One episode against one filter set. Missing filters mean "all". */
  function episodeMatches(episode, filters, scenarios) {
    if (!episode) { return false; }
    var f = filters || {};
    var sc = (scenarios || {})[episode.scenario_id];

    if (f.arm && f.arm !== 'all' && episode.arm !== f.arm) { return false; }
    if (f.scenario && f.scenario !== 'all' && episode.scenario_id !== f.scenario) { return false; }
    if (f.rep !== undefined && f.rep !== null && f.rep !== 'all' &&
        String(episode.repetition) !== String(f.rep)) { return false; }
    if (f.variant && f.variant !== 'all' && episode.variant !== f.variant) { return false; }
    if (f.goal && f.goal !== 'all') {
      if (!sc) { return false; }
      if (f.goal === 'visible' && !sc.goal_visible) { return false; }
      if (f.goal === 'masked' && sc.goal_visible) { return false; }
    }
    return true;
  }

  function filterEpisodes(episodes, filters, scenarios) {
    var out = [];
    var list = episodes || [];
    for (var i = 0; i < list.length; i++) {
      if (episodeMatches(list[i], filters, scenarios)) { out.push(list[i]); }
    }
    return out;
  }

  /**
   * Sort rows by an accessor result. Nulls always sink to the bottom
   * regardless of direction: an absent measurement is not a small one.
   */
  function sortRows(rows, accessor, dir) {
    var d = dir < 0 ? -1 : 1;
    var indexed = (rows || []).map(function (row, i) { return { row: row, i: i }; });
    indexed.sort(function (a, b) {
      var av = accessor(a.row);
      var bv = accessor(b.row);
      var aNull = av === null || av === undefined || av !== av;
      var bNull = bv === null || bv === undefined || bv !== bv;
      if (aNull && bNull) { return a.i - b.i; }
      if (aNull) { return 1; }
      if (bNull) { return -1; }
      if (typeof av === 'string' || typeof bv === 'string') {
        var as = String(av);
        var bs = String(bv);
        if (as === bs) { return a.i - b.i; }
        return as < bs ? -d : d;
      }
      if (av === bv) { return a.i - b.i; }
      return av < bv ? -d : d;
    });
    return indexed.map(function (entry) { return entry.row; });
  }

  /** Fixed-decimal formatting that never turns a missing value into a zero. */
  function fmtNum(value, digits) {
    if (value === null || value === undefined || value !== value) { return null; }
    var d = digits === undefined ? 3 : digits;
    return Number(value).toFixed(d);
  }

  function clamp(value, lo, hi) {
    if (value < lo) { return lo; }
    if (value > hi) { return hi; }
    return value;
  }

  function mean(values) {
    var sum = 0;
    var n = 0;
    for (var i = 0; i < (values || []).length; i++) {
      var v = values[i];
      if (v === null || v === undefined || v !== v) { continue; }
      sum += v;
      n += 1;
    }
    return n ? { mean: sum / n, n: n } : { mean: null, n: 0 };
  }

  /**
   * The only episode subset comparable to the published deterministic
   * references: goal visible, not a probe, true heat. See METRICS.md W8.
   */
  /**
   * Prediction fidelity restricted to the scenario x repetition cells where
   * BOTH arms are measurable.
   *
   * Fidelity is only published when coverage is high enough, and the two arms
   * clear that bar on almost disjoint sets of scenarios. Fidelity varies far
   * more by scenario than by arm, so putting the two unrestricted means side by
   * side lets a scenario-mix artifact read as an arm difference. Paired cells
   * are the only comparison the data supports.
   *
   * Returns {n, means: {arm: number|null}} where n is the number of cells.
   */
  function pairedFidelity(episodeList) {
    var cells = {};
    (episodeList || []).forEach(function (ep) {
      if (!ep || ep.variant !== 'normal') { return; }
      var v = ep.scores ? ep.scores.prediction_fidelity : null;
      if (v === null || v === undefined || v !== v) { return; }
      var id = ep.scenario_id + '|r' + ep.repetition;
      if (!cells[id]) { cells[id] = {}; }
      cells[id][ep.arm] = v;
    });
    var sums = {};
    var counts = {};
    ARMS.forEach(function (arm) { sums[arm] = 0; counts[arm] = 0; });
    var n = 0;
    Object.keys(cells).forEach(function (id) {
      var row = cells[id];
      for (var i = 0; i < ARMS.length; i++) {
        if (typeof row[ARMS[i]] !== 'number') { return; }
      }
      n += 1;
      ARMS.forEach(function (arm) { sums[arm] += row[arm]; counts[arm] += 1; });
    });
    var means = {};
    ARMS.forEach(function (arm) { means[arm] = counts[arm] ? sums[arm] / counts[arm] : null; });
    return { n: n, means: means };
  }

  /**
   * The persistence floor over exactly the episodes that produced the fidelity
   * mean. Averaging the floor over every episode while fidelity averages over
   * the measurable ones compares two different denominators, and the distortion
   * runs in opposite directions per arm.
   */
  function matchedFloorMean(episodeList, arm) {
    return mean((episodeList || []).filter(function (ep) {
      return ep && ep.arm === arm && ep.variant === 'normal' &&
        ep.scores && ep.scores.prediction_fidelity !== null &&
        ep.scores.prediction_fidelity !== undefined;
    }).map(function (ep) { return ep.scores.persistence_floor_fidelity; }));
  }

  function comparableSubset(episodes, scenarios) {
    return (episodes || []).filter(function (ep) {
      var sc = (scenarios || {})[ep.scenario_id];
      return !!sc && sc.goal_visible === true && sc.is_probe !== true && ep.variant === 'normal';
    });
  }

  /**
   * Choose the episode the "what it is" demo replays. Wants every cycle to
   * carry a prediction (so the ghost is always on screen), a visible goal, a
   * handful of decisions and the middle deliberation budget. Deterministic.
   */
  function pickDemoEpisode(episodes, scenarios) {
    var list = episodes || [];
    if (!list.length) { return null; }
    var scored = list.map(function (ep) {
      var sc = (scenarios || {})[ep.scenario_id] || {};
      var coverage = ep.scores ? ep.scores.prediction_coverage : null;
      var score = 0;
      if (coverage === 1) { score += 100; }
      else if (coverage !== null && coverage !== undefined) { score += 40 * coverage; }
      if (sc.goal_visible === true) { score += 50; }
      if (sc.is_probe !== true) { score += 20; }
      if (ep.variant === 'normal') { score += 20; }
      if (ep.n_cycles >= 4 && ep.n_cycles <= 8) { score += 30; }
      if (sc.deliberation_ticks === 20) { score += 10; }
      if (ep.repetition === 0) { score += 5; }
      return { ep: ep, score: score };
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) { return b.score - a.score; }
      return a.ep.key < b.ep.key ? -1 : 1;
    });
    return scored[0].ep;
  }

  /** Index of the cycle that owns a tick: the last decision taken at or before it. */
  function cycleIndexAtTick(cycles, tick) {
    var list = cycles || [];
    var found = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].tick <= tick) { found = i; } else { break; }
    }
    return found;
  }

  /** Split a raw completion into the JSON body the parser could use and the noise. */
  /**
   * Label every raw completion of one cycle.
   *
   * The log stores no stage marker, so the stage is read off the reply itself:
   * a wm-scaffold stage-1 prompt asks for a prediction only, stage 2 for an
   * action only, and the single end2end prompt asks for both. Attempts are
   * numbered inside their own stage, so a stage-1 retry is never titled as the
   * decision stage - collapsing N completions onto min(N, 2) stage names put a
   * prediction under "Stage 2: decision" on every retried cycle.
   *
   * Returns one entry per completion: {stageKey, attempt, attempts, failed}.
   * failed is per completion: every attempt that was followed by another
   * attempt of the same stage is by construction the one that was retried.
   */
  function labelCompletions(arm, completions, cycle) {
    var list = completions || [];
    var single = arm !== 'wm-scaffold';
    var cyc = cycle || {};
    var stages = list.map(function (text) {
      if (single) { return 'lab.prompt.single'; }
      var s = String(text == null ? '' : text);
      var hasPred = s.indexOf('"prediction"') !== -1 || s.indexOf('pos_x_m') !== -1;
      var hasAct = s.indexOf('"action"') !== -1 || s.indexOf('accel_x_mps2') !== -1;
      if (hasPred && !hasAct) { return 'lab.prompt.stage1'; }
      if (hasAct && !hasPred) { return 'lab.prompt.stage2'; }
      return 'lab.prompt.unknown';
    });

    var totals = {};
    stages.forEach(function (key) { totals[key] = (totals[key] || 0) + 1; });

    var seen = {};
    return stages.map(function (key, i) {
      seen[key] = (seen[key] || 0) + 1;
      var attempt = seen[key];
      var isLast = attempt === totals[key];
      var failed;
      if (!isLast) {
        failed = true;
      } else if (key === 'lab.prompt.stage1') {
        failed = !!cyc.prediction_parse_failed;
      } else {
        failed = !!cyc.parse_failed;
      }
      return { stageKey: key, attempt: attempt, attempts: totals[key], failed: failed };
    });
  }

  function splitCompletion(text) {
    var raw = typeof text === 'string' ? text : '';
    var start = raw.indexOf('{');
    if (start === -1) { return { before: raw, json: '', after: '' }; }
    var depth = 0;
    var inString = false;
    var escaped = false;
    for (var i = start; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (inString) {
        if (escaped) { escaped = false; }
        else if (ch === '\\') { escaped = true; }
        else if (ch === '"') { inString = false; }
        continue;
      }
      if (ch === '"') { inString = true; }
      else if (ch === '{') { depth += 1; }
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return {
            before: raw.slice(0, start),
            json: raw.slice(start, i + 1),
            after: raw.slice(i + 1)
          };
        }
      }
    }
    return { before: raw.slice(0, start), json: raw.slice(start), after: '' };
  }

  /** Screen rotation for a world-space velocity; screen y is already flipped. */
  function headingDeg(vx, vy) {
    return Math.atan2(-(vy || 0), vx || 0) * 180 / Math.PI;
  }

  var PURE = {
    TABS: TABS,
    LANGS: LANGS,
    ARMS: ARMS,
    COGNITIVE_METRICS: COGNITIVE_METRICS,
    CONTROL_METRICS: CONTROL_METRICS,
    LOWER_IS_BETTER: LOWER_IS_BETTER,
    normalizeTab: normalizeTab,
    looksLikeEpisodeKey: looksLikeEpisodeKey,
    parseHash: parseHash,
    buildHash: buildHash,
    formatTemplate: formatTemplate,
    makeT: makeT,
    pickLang: pickLang,
    parseEpisodeKey: parseEpisodeKey,
    episodeMatches: episodeMatches,
    filterEpisodes: filterEpisodes,
    sortRows: sortRows,
    fmtNum: fmtNum,
    clamp: clamp,
    mean: mean,
    reasonKey: reasonKey,
    comparableSubset: comparableSubset,
    pickDemoEpisode: pickDemoEpisode,
    cycleIndexAtTick: cycleIndexAtTick,
    splitCompletion: splitCompletion,
    labelCompletions: labelCompletions,
    cycleUnmeasurableReason: cycleUnmeasurableReason,
    pairedFidelity: pairedFidelity,
    matchedFloorMean: matchedFloorMean,
    headingDeg: headingDeg
  };

  /* ======================================================================
     2. Runtime state
     ====================================================================== */

  var bundle = null;
  var lang = DEFAULT_LANG;
  var t = makeT(null, null);

  var state = {
    tab: TABS[0],
    episodeKey: null,
    filters: { arm: 'all', scenario: 'all', rep: 'all', variant: 'all', goal: 'all' },
    sort: { column: null, dir: 1 },
    speed: 1,
    playing: false,
    cycle: 0,
    tick: 0,
    overlay: false,
    reveal: false,
    keysOpen: false
  };

  var demo = { arena: null, episode: null, scenario: null, step: 0, timer: null, pending: false };
  var lab = { arena: null, episode: null, scenario: null, built: false };
  var clock = { timer: null };
  var routing = { silent: false };

  var DEMO_STEPS = [
    { legend: 'arena.legend.craft', caption: 'arena.caption.craft' },
    { legend: 'arena.legend.commanded', caption: 'arena.caption.commanded' },
    { legend: 'arena.legend.ghost', caption: 'arena.caption.ghost' },
    { legend: 'arena.legend.truth', caption: 'arena.caption.truth' },
    { legend: 'arena.legend.error_line', caption: 'arena.caption.error_line' },
    { legend: 'arena.legend.held', caption: 'arena.caption.held' },
    { legend: 'arena.legend.trail', caption: 'arena.caption.trail' },
    { legend: 'arena.legend.bounds', caption: 'arena.caption.bounds' }
  ];

  /* ======================================================================
     3. DOM helpers
     ====================================================================== */

  function $(id) { return document.getElementById(id); }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (name) {
        var value = attrs[name];
        if (value === null || value === undefined || value === false) { return; }
        /* There is no innerHTML path on purpose: bundle data reaches the DOM
           only as text, so a hostile string in a log can never become markup. */
        if (name === 'text') { node.textContent = String(value); return; }
        if (name === 'onclick') { node.addEventListener('click', value); return; }
        if (name === 'onchange') { node.addEventListener('change', value); return; }
        if (name === 'oninput') { node.addEventListener('input', value); return; }
        node.setAttribute(name, value === true ? '' : String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined) { return; }
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) {
    if (!node) { return; }
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function svgIcon(id, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', cls || 'cg-btn__icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function storage() {
    try {
      var s = window.localStorage;
      if (!s) { return null; }
      s.setItem('cg.probe', '1');
      s.removeItem('cg.probe');
      return s;
    } catch (e) {
      return null;
    }
  }

  function storeGet(key) {
    var s = storage();
    if (!s) { return null; }
    try { return s.getItem(key); } catch (e) { return null; }
  }

  function storeSet(key, value) {
    var s = storage();
    if (!s) { return; }
    try { s.setItem(key, value); } catch (e) { /* quota or file:// lockdown */ }
  }

  /* ======================================================================
     4. Error surface
     ====================================================================== */

  function reportError(err) {
    try {
      var bar = $('cg-errorbar');
      if (!bar) { return; }
      var detail = $('cg-errorbar-detail');
      var text = '';
      if (err && err.stack) { text = String(err.stack).split('\n').slice(0, 2).join(' '); }
      else if (err && err.message) { text = String(err.message); }
      else { text = String(err); }
      if (detail) { detail.textContent = text; }
      bar.setAttribute('data-state', 'open');
    } catch (e) { /* the error surface must never throw */ }
  }

  function guard(label, fn) {
    try { return fn(); } catch (e) {
      reportError(new Error(label + ': ' + (e && e.message ? e.message : e)));
      return null;
    }
  }

  /* ======================================================================
     5. Translation of the static skeleton
     ====================================================================== */

  function applyStaticStrings(root) {
    $$('[data-t]', root).forEach(function (node) {
      node.textContent = t(node.getAttribute('data-t'));
    });
    $$('[data-t-attr]', root).forEach(function (node) {
      node.getAttribute('data-t-attr').split(';').forEach(function (pair) {
        var bits = pair.split(':');
        if (bits.length !== 2) { return; }
        node.setAttribute(bits[0].trim(), t(bits[1].trim()));
      });
    });
  }

  /* ======================================================================
     6. Small shared renderers
     ====================================================================== */

  function outcomeChip(outcome) {
    var known = { goal: 'cg-out-goal', oob: 'cg-out-oob', timeout: 'cg-out-timeout' };
    var kind = known[outcome] ? outcome : 'unknown';
    var chip = el('span', { 'class': 'cg-chip', 'data-outcome': kind, title: t('outcome.' + kind + '.desc') });
    if (known[outcome]) { chip.appendChild(svgIcon(known[outcome], 'cg-chip__icon')); }
    chip.appendChild(document.createTextNode(t('outcome.' + kind)));
    return chip;
  }

  function armChip(arm) {
    return el('span', {
      'class': 'cg-chip',
      'data-kind': 'arm',
      'data-arm': arm,
      text: t(arm === 'end2end' ? 'arm.end2end.name' : 'arm.wm_scaffold.name'),
      title: t(arm === 'end2end' ? 'arm.end2end.short' : 'arm.wm_scaffold.short')
    });
  }

  /**
   * "Not measurable" always states its reason. The pseudo-reason "no_report"
   * is kept apart from the scorer's own reasons on purpose: a missing
   * aggregate report is not the same absence as a metric the scorer refused
   * to publish (METRICS.md W13).
   */
  function unmeasurableText(rawReason) {
    var reasonText = rawReason === 'no_report' ? t('empty.no_report') : t(reasonKey(rawReason));
    return t('empty.metric_unmeasurable', { reason: reasonText });
  }

  /** A measured cell, or an explicit "not measurable" cell that states why. */
  function valueCell(value, digits, invalidReason) {
    var text = fmtNum(value, digits);
    if (text !== null) {
      return { text: text, unmeasurable: false };
    }
    return { text: unmeasurableText(invalidReason), unmeasurable: true };
  }

  function numCell(value, digits, invalidReason) {
    var cell = valueCell(value, digits, invalidReason);
    if (!cell.unmeasurable) {
      return el('td', { 'data-type': 'num', 'class': 'cg-num', text: cell.text });
    }
    /* A 65-character sentence dropped into a right-aligned numeric column
       becomes the widest thing on the page and squeezes the columns that do
       carry numbers out of comparison. In a table the cell says only that
       nothing was measured; the reason stays one hover (and one screen reader
       stop) away, and the full sentences keep their place on the metric cards
       and in the reason legend. */
    var td = el('td', {
      'data-type': 'num', 'class': 'cg-num',
      'data-state': 'unmeasurable', title: cell.text
    });
    td.appendChild(el('span', { 'aria-hidden': 'true', text: t('empty.not_measured') }));
    td.appendChild(el('span', { 'class': 'cg-sr-only', text: cell.text }));
    return td;
  }

  function barCell(value, arm, invalidReason) {
    var td = el('td', { 'data-type': 'bar' });
    var bar = el('div', { 'class': 'cg-bar' });
    if (value === null || value === undefined) {
      bar.setAttribute('data-state', 'unmeasurable');
      bar.setAttribute('title', unmeasurableText(invalidReason));
    } else {
      var fill = el('div', { 'class': 'cg-bar__fill', 'data-arm': arm });
      fill.style.width = (clamp(value, 0, 1) * 100).toFixed(1) + '%';
      bar.appendChild(fill);
    }
    td.appendChild(bar);
    return td;
  }

  function note(textValue, tone) {
    var n = el('div', { 'class': 'cg-note' });
    if (tone) { n.setAttribute('data-tone', tone); }
    n.appendChild(svgIcon('cg-info', 'cg-note__icon'));
    n.appendChild(el('span', { text: textValue }));
    return n;
  }

  function readoutRow(label, value, extraClass) {
    var frag = document.createDocumentFragment();
    frag.appendChild(el('dt', { text: label }));
    frag.appendChild(el('dd', { text: value, 'class': extraClass || null }));
    return frag;
  }

  function table(headers, rows, caption) {
    var tbl = el('table', { 'class': 'cg-table' });
    if (caption) { tbl.appendChild(el('caption', { text: caption })); }
    var thead = el('thead');
    var htr = el('tr');
    headers.forEach(function (h) {
      var th = el('th', { scope: 'col', text: h.label });
      /* Traceability line: the scorer's own field name, under the translated
         header rather than in place of it. */
      if (h.sub) { th.appendChild(el('span', { 'class': 'cg-th__sub cg-mono', text: h.sub })); }
      if (h.numeric) { th.setAttribute('data-type', 'num'); }
      if (h.title) { th.setAttribute('title', h.title); }
      /* A column whose header is a bar still needs a name for a screen reader. */
      if (!h.label && h.srLabel) { th.setAttribute('aria-label', h.srLabel); }
      if (h.sortKey) {
        th.setAttribute('data-sort', h.sortKey);
        th.setAttribute('tabindex', '0');
        th.setAttribute('role', 'columnheader');
        th.setAttribute('aria-sort',
          state.sort.column === h.sortKey ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      }
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    tbl.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (tr) { tbody.appendChild(tr); });
    tbl.appendChild(tbody);
    return tbl;
  }

  function scenarioLabel(id) {
    var name = t('scenario.' + id + '.name');
    return name === 'scenario.' + id + '.name' ? id : id + ' ' + name;
  }

  /* ======================================================================
     7. Static frame - the fallback picture and the print picture
     ====================================================================== */

  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (name) {
      if (attrs[name] === null || attrs[name] === undefined) { return; }
      node.setAttribute(name, String(attrs[name]));
    });
    return node;
  }

  /**
   * Draw one still frame of a flight: bounds, grid, goal, the whole route, the
   * flown part, the decision beads, and - at the active cycle - the ghost, the
   * truth ring and the error connector between them. Used when window.Arena is
   * absent and always for print.
   */
  function renderFrame(mount, episode, scenario, cycleIdx) {
    if (!mount) { return; }
    clear(mount);
    if (!episode || !scenario) { return; }

    var size = 480;
    var pad = 26;
    var minX = scenario.bounds_min_x_m;
    var minY = scenario.bounds_min_y_m;
    var spanX = scenario.bounds_max_x_m - minX;
    var spanY = scenario.bounds_max_y_m - minY;
    var scale = (size - 2 * pad) / Math.max(spanX, spanY);
    function sx(x) { return pad + (x - minX) * scale; }
    function sy(y) { return pad + (spanY - (y - minY)) * scale; }

    var svg = svgEl('svg', {
      'class': 'cg-arena__svg',
      viewBox: '0 0 ' + size + ' ' + size,
      role: 'img',
      'data-arm': episode.arm,
      'aria-label': t('shell.static_frame') + ' - ' + episode.key
    });

    var grid = svgEl('g', { 'class': 'cg-layer-grid' });
    for (var g = 0; g <= spanX; g += 10) {
      grid.appendChild(svgEl('line', {
        x1: sx(minX + g), y1: sy(minY), x2: sx(minX + g), y2: sy(minY + spanY),
        'data-major': (g % 50 === 0) ? 'true' : null
      }));
      grid.appendChild(svgEl('line', {
        x1: sx(minX), y1: sy(minY + g), x2: sx(minX + spanX), y2: sy(minY + g),
        'data-major': (g % 50 === 0) ? 'true' : null
      }));
    }
    svg.appendChild(grid);

    var bound = svgEl('g', { 'class': 'cg-layer-bound' });
    bound.appendChild(svgEl('rect', {
      x: sx(minX), y: sy(minY + spanY),
      width: spanX * scale, height: spanY * scale
    }));
    svg.appendChild(bound);

    /* A masked-goal scenario hides the target from the agent, so the frame must
       hide it from the reader too unless the reveal toggle is on. Dimming the
       colour is not hiding: the disc still sits on the true coordinates, which
       gives away exactly what the run was testing. */
    var goalMasked = !scenario.goal_visible && !state.reveal;
    if (!goalMasked) {
      var goalGroup = svgEl('g', { 'class': 'cg-layer-goal' });
      if (!scenario.goal_visible) { goalGroup.setAttribute('data-hidden', 'true'); }
      var heatScale = (((bundle && bundle.constants) || {}).HEAT_SCALE_M) || 20;
      [0.75, 0.5, 0.25].forEach(function (heat) {
        var radius = -heatScale * Math.log(heat);
        goalGroup.appendChild(svgEl('circle', {
          'class': 'cg-goal__ring',
          cx: sx(scenario.goal_x_m), cy: sy(scenario.goal_y_m), r: radius * scale
        }));
      });
      goalGroup.appendChild(svgEl('circle', {
        'class': 'cg-goal__disc',
        cx: sx(scenario.goal_x_m), cy: sy(scenario.goal_y_m),
        r: Math.max(scenario.goal_radius_m * scale, 5)
      }));
      svg.appendChild(goalGroup);
    }

    var traj = episode.trajectory || { t: [], x: [], y: [], vx: [], vy: [] };
    var n = traj.t.length;
    var cycles = episode.cycles || [];
    var idx = clamp(cycleIdx === undefined ? cycles.length - 1 : cycleIdx, 0, Math.max(cycles.length - 1, 0));
    var cyc = cycles[idx] || null;
    var headTick = cyc ? cyc.engage_tick : (traj.t[n - 1] || 0);
    var head = 0;
    for (var i = 0; i < n; i++) { if (traj.t[i] <= headTick) { head = i; } }

    function points(from, to) {
      var parts = [];
      for (var j = from; j <= to && j < n; j++) {
        parts.push(sx(traj.x[j]).toFixed(1) + ',' + sy(traj.y[j]).toFixed(1));
      }
      return parts.join(' ');
    }

    svg.appendChild(svgEl('polyline', { 'class': 'cg-path cg-path--future', points: points(0, n - 1) }));
    svg.appendChild(svgEl('polyline', { 'class': 'cg-path', points: points(0, head) }));

    cycles.forEach(function (c, ci) {
      var ti = -1;
      for (var j = 0; j < n; j++) { if (traj.t[j] === c.tick) { ti = j; break; } }
      if (ti < 0) { return; }
      var bead = svgEl('rect', {
        'class': 'cg-bead',
        x: sx(traj.x[ti]) - 3.5, y: sy(traj.y[ti]) - 3.5, width: 7, height: 7,
        transform: 'rotate(45 ' + sx(traj.x[ti]).toFixed(1) + ' ' + sy(traj.y[ti]).toFixed(1) + ')'
      });
      if (c.parse_failed) { bead.setAttribute('data-parse', 'failed'); }
      if (ci === idx) { bead.setAttribute('data-state', 'active'); }
      svg.appendChild(bead);
    });

    if (cyc && cyc.predicted && cyc.truth_at_engage) {
      var px = sx(cyc.predicted.x);
      var py = sy(cyc.predicted.y);
      var tx = sx(cyc.truth_at_engage.x);
      var ty = sy(cyc.truth_at_engage.y);
      svg.appendChild(svgEl('line', { 'class': 'cg-errline', x1: px, y1: py, x2: tx, y2: ty }));
      svg.appendChild(svgEl('circle', { 'class': 'cg-errline__cap', cx: tx, cy: ty, r: 2.5 }));
      svg.appendChild(svgEl('circle', { 'class': 'cg-truth', cx: tx, cy: ty, r: 7 }));
      svg.appendChild(svgEl('circle', { 'class': 'cg-truth__core', cx: tx, cy: ty, r: 2 }));
      var ghost = svgEl('g', {
        transform: 'translate(' + px.toFixed(1) + ',' + py.toFixed(1) + ') rotate(' +
          headingDeg(cyc.predicted.vx, cyc.predicted.vy).toFixed(1) + ')'
      });
      ghost.appendChild(svgEl('use', {
        'class': 'cg-icon cg-icon--ghost cg-ghost',
        href: '#cg-ghost', x: -16, y: -10, width: 32, height: 20
      }));
      svg.appendChild(ghost);
    }

    if (n) {
      var craft = svgEl('g', {
        transform: 'translate(' + sx(traj.x[head]).toFixed(1) + ',' + sy(traj.y[head]).toFixed(1) +
          ') rotate(' + headingDeg(traj.vx[head], traj.vy[head]).toFixed(1) + ')'
      });
      craft.appendChild(svgEl('use', {
        'class': 'cg-icon cg-icon--craft cg-craft',
        href: '#cg-craft', x: -16, y: -10, width: 32, height: 20
      }));
      svg.appendChild(craft);
    }

    mount.appendChild(svg);
  }

  /* ======================================================================
     8. Bridges to the optional view modules
     ====================================================================== */

  function callFirst(target, names, args) {
    if (!target) { return undefined; }
    for (var i = 0; i < names.length; i++) {
      if (typeof target[names[i]] === 'function') {
        try { return target[names[i]].apply(target, args || []); }
        catch (e) { reportError(e); return undefined; }
      }
    }
    return undefined;
  }

  /**
   * Arena.mount() paints into a 2D context, so it needs a <canvas>; the shell
   * only owns a plain .cg-arena box. Build the canvas inside that box and hand
   * the canvas over. arena.js looks at canvas.parentNode.className for
   * "cg-arena", so this is the shape it already expects.
   */
  function arenaCanvas(mount) {
    if (!mount) { return null; }
    clear(mount);
    var cv = document.createElement('canvas');
    cv.className = 'cg-arena__canvas';
    mount.appendChild(cv);
    return cv;
  }

  /**
   * A fallback explanation cannot live inside the arena box: renderFrame()
   * clears that box on every repaint, and the box is a square with overflow
   * hidden. The note goes next to it, once.
   */
  function arenaNote(mount, textValue) {
    clearArenaNote(mount);
    if (!mount || !mount.parentNode) { return; }
    var n = note(textValue, 'control');
    n.setAttribute('data-role', 'arena-fallback');
    mount.parentNode.insertBefore(n, mount.nextSibling);
  }

  function clearArenaNote(mount) {
    if (!mount || !mount.parentNode || !mount.parentNode.querySelectorAll) { return; }
    $$('.cg-note[data-role="arena-fallback"]', mount.parentNode).forEach(function (old) {
      if (old.parentNode) { old.parentNode.removeChild(old); }
    });
  }

  function createArena(mount, options) {
    var A = window.Arena;
    if (!A || !mount) { return null; }
    var inst = null;
    try {
      if (typeof A.create === 'function') { inst = A.create(mount, options); }
      else if (typeof A.mount === 'function') { inst = A.mount(mount, options); }
      else if (typeof A.init === 'function') { inst = A.init(mount, options); }
      else if (typeof A === 'function') { inst = new A(mount, options); }
    } catch (e) {
      reportError(e);
      return null;
    }
    if (inst && typeof inst.on === 'function' && options && options.onFrame) {
      try { inst.on('frame', options.onFrame); } catch (e) { /* optional */ }
    }
    if (inst && options && options.onFrame && !inst.onFrame) { inst.onFrame = options.onFrame; }
    return inst || null;
  }

  function arenaSetEpisode(inst, episode, scenario, options) {
    return callFirst(inst, ['setEpisode', 'load', 'setData', 'update'], [episode, scenario, options]);
  }
  function arenaPlay(inst) { return callFirst(inst, ['play', 'start'], []); }
  function arenaPause(inst) { return callFirst(inst, ['pause', 'stop'], []); }
  function arenaSeekCycle(inst, i) { return callFirst(inst, ['seekCycle', 'goToCycle', 'setCycle'], [i]); }
  function arenaSeekTick(inst, tick) { return callFirst(inst, ['seekTick', 'seek', 'setTick'], [tick]); }
  function arenaSpeed(inst, mult) { return callFirst(inst, ['setSpeed', 'speed'], [mult]); }
  function arenaOverlay(inst, ep) { return callFirst(inst, ['setOverlay', 'setCompare'], [ep]); }
  function arenaReveal(inst, on) { return callFirst(inst, ['setRevealGoal', 'setShowHiddenGoal', 'revealGoal'], [on]); }
  function arenaDestroy(inst) { return callFirst(inst, ['destroy', 'dispose'], []); }

  function drawChart(kind, mount, spec) {
    var C = window.Charts;
    if (!C || !mount) { return false; }
    var camel = kind.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
    var names = [kind, camel];
    for (var i = 0; i < names.length; i++) {
      if (typeof C[names[i]] === 'function') {
        try { return C[names[i]](mount, spec) !== false; } catch (e) { reportError(e); return false; }
      }
    }
    if (typeof C.render === 'function') {
      spec.kind = kind;
      try { return C.render(mount, spec) !== false; } catch (e) { reportError(e); return false; }
    }
    return false;
  }

  /* ======================================================================
     9. Data access
     ====================================================================== */

  /**
   * True when a key really exists in a dictionary. t() returns the key itself
   * for a miss, which is fine on screen but useless as a test.
   */
  function hasString(key) {
    var dicts = (typeof window.STRINGS === 'object' && window.STRINGS) || null;
    if (!dicts) { return false; }
    return !!((dicts[lang] && typeof dicts[lang][key] === 'string') ||
      (dicts[DEFAULT_LANG] && typeof dicts[DEFAULT_LANG][key] === 'string'));
  }

  function episodes() { return (bundle && bundle.episodes) || []; }
  function scenarios() { return (bundle && bundle.scenarios) || {}; }
  function meta() { return (bundle && bundle.meta) || {}; }

  function episodeByKey(key) {
    var list = episodes();
    for (var i = 0; i < list.length; i++) { if (list[i].key === key) { return list[i]; } }
    return null;
  }

  function scenarioOf(episode) {
    return episode ? scenarios()[episode.scenario_id] || null : null;
  }

  function temporalReason(episode) {
    var sc = scenarioOf(episode);
    if (sc && sc.goal_visible === false) { return 'masked_goal'; }
    return 'no_scored_cycles';
  }

  /* ======================================================================
     10. Top rail, footer, keyboard sheet
     ====================================================================== */

  function renderChrome() {
    var m = meta();

    var modelChip = $('cg-model-chip');
    if (modelChip) {
      modelChip.textContent = m.model || t('empty.value_missing');
      modelChip.setAttribute('title', t('footer.model') + ': ' + (m.model || t('empty.value_missing')));
    }

    var runChip = $('cg-run-chip');
    if (runChip) {
      var complete = m.run_complete === true;
      runChip.textContent = t(complete ? 'shell.run.complete' : 'shell.run.in_progress');
      runChip.setAttribute('data-outcome', complete ? 'goal' : 'timeout');
      runChip.setAttribute('title', t('shell.run.aria'));
    }

    $$('#cg-lang [data-lang]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === lang ? 'true' : 'false');
    });

    var themeBtn = $('cg-theme-btn');
    if (themeBtn) {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      themeBtn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
      themeBtn.setAttribute('title', t('shell.theme.aria') + ': ' + t(isLight ? 'shell.theme.light' : 'shell.theme.dark'));
    }

    var runNote = $('cg-run-note-text');
    if (runNote) {
      var parts = [];
      if (m.run_complete !== true) { parts.push(t('empty.run_in_progress')); }
      if (m.report_present !== true) { parts.push(t('empty.no_report')); }
      /* "38 of 38" is not a warning about missing data - only say it when it is true. */
      var declared = m.n_episodes || 0;
      if (declared && episodes().length < declared) {
        parts.push(t('empty.partial_run', { n: episodes().length, total: declared }));
      } else {
        parts.push(t('results.count', { n: episodes().length, total: episodes().length }));
      }
      runNote.textContent = parts.join(' ');
    }
  }

  function renderFooter() {
    var host = $('cg-footer-items');
    if (!host) { return; }
    clear(host);
    var m = meta();
    var pv = m.prompt_versions || {};
    var items = [
      ['footer.model', m.model],
      ['footer.prompt.end2end', pv.end2end],
      ['footer.prompt.scaffold', pv.wm_scaffold],
      ['footer.prompt.format_probe', pv.format_probe],
      ['footer.prompt.choice_probe', pv.choice_probe],
      ['footer.pack', (m.pack_name || '') + ' ' + (m.pack_version || '')],
      ['footer.schema', m.schema_version],
      ['footer.host', m.host_class],
      ['footer.reps', repetitionsText(m)]
    ];
    items.forEach(function (pair) {
      host.appendChild(el('div', { 'class': 'cg-footer__item' }, [
        el('span', { 'class': 'cg-label', text: t(pair[0]) }),
        el('span', { 'class': 'cg-mono', text: pair[1] ? String(pair[1]).trim() : t('empty.value_missing') })
      ]));
    });
    renderSourceNotes(m);
    renderProvenance(m);
  }

  /**
   * Where this page came from: the date of the data, the project, the licence.
   * A reviewer asks for these first, and they are the one thing a screenshot
   * of the numbers cannot carry.
   */
  function renderProvenance(m) {
    var host = $('cg-footer-provenance');
    if (!host) { return; }
    clear(host);
    var parts = [
      m.data_date ? t('footer.generated', { date: m.data_date }) : null,
      t('footer.repo'),
      t('footer.license')
    ].filter(function (part) { return part; });
    host.appendChild(el('span', { text: parts.join(' · ') }));
  }

  /** "r0, r1, r2 of 3" - the answer to "how many repetitions", stated once. */
  function repetitionsText(m) {
    var present = m.repetitions_present || [];
    if (!present.length) { return null; }
    return t('footer.reps.value', {
      present: present.join(', '),
      total: m.repetitions_expected || present.length
    });
  }

  /**
   * The extractor emits caveats as {code, params}, never as prose, so they
   * switch language with everything else. An unknown code is named, not hidden.
   */
  function renderSourceNotes(m) {
    var host = $('cg-footer-notes');
    if (!host) { return; }
    clear(host);
    var notes = m.source_notes || [];
    if (!notes.length) { return; }
    host.appendChild(el('span', { 'class': 'cg-label', text: t('footer.notes.title') }));
    notes.forEach(function (entry) {
      var code = entry && entry.code ? String(entry.code) : '';
      var key = 'note.' + code;
      var text = code && hasString(key)
        ? t(key, (entry && entry.params) || {})
        : t('note.unknown', { code: code || t('empty.value_missing') });
      host.appendChild(el('p', { 'class': 'cg-panel__note', text: text }));
    });
  }

  function toggleKeys(force) {
    var panel = $('cg-keys');
    var btn = $('cg-keys-btn');
    if (!panel || !btn) { return; }
    state.keysOpen = force === undefined ? !state.keysOpen : !!force;
    if (state.keysOpen) { panel.removeAttribute('hidden'); } else { panel.setAttribute('hidden', ''); }
    btn.setAttribute('aria-expanded', state.keysOpen ? 'true' : 'false');
  }

  /* ======================================================================
     11. Tab 1 - what it is
     ====================================================================== */

  function renderWorldFacts() {
    var host = $('cg-world-facts');
    if (!host) { return; }
    clear(host);
    var noteHost = $('cg-world-facts-note');
    if (noteHost) { noteHost.textContent = ''; }
    var sc = demo.scenario;
    if (!sc) { host.appendChild(el('dt', { text: t('empty.no_data') })); return; }

    /* Invariant across the whole pack. */
    var rows = [
      ['world.gravity', t('world.gravity.value'), false],
      ['world.wind', t('world.wind.value'), false],
      ['world.bounds', t('world.bounds.value'), false],
      ['world.tick', t('world.tick.value', { value: fmtNum(sc.dt_s, 2) }), false],
      ['world.max_accel', t('world.max_accel.value', { value: fmtNum(sc.max_accel_mps2, 1) }), false],
      ['world.heat', t('world.heat.value'), false],
      ['world.determinism', t('world.determinism.value'), false],
      /* Scenario settings. B and the deadline differ across the pack, so they
         must not be read as rules of the world (spec/COPY.md). */
      ['world.goal', t('world.goal.value', { value: fmtNum(sc.goal_radius_m, 1) }), true],
      ['world.deadline', t('world.deadline.value', { value: sc.deadline_tick }), true],
      ['world.budget', t('world.budget.value', { b: sc.deliberation_ticks }), true]
    ];
    rows.forEach(function (row) {
      var value = row[2] ? row[1] + ' (' + t('world.varies.mark') + ')' : row[1];
      host.appendChild(readoutRow(t(row[0]), value, row[2] ? 'cg-readout__varies' : null));
    });

    if (noteHost) {
      noteHost.textContent = t('world.varies.note', {
        scenario: scenarioLabel(demo.episode ? demo.episode.scenario_id : sc.id),
        budgets: distinctScenarioValues('deliberation_ticks').join(', '),
        deadlines: distinctScenarioValues('deadline_tick').join(', ')
      });
    }
  }

  /** Every distinct value of one scenario field across the pack, ascending. */
  function distinctScenarioValues(field) {
    var all = scenarios();
    var seen = {};
    Object.keys(all).forEach(function (id) {
      var v = all[id] ? all[id][field] : null;
      if (v !== null && v !== undefined) { seen[v] = true; }
    });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  function renderArmCards() {
    var host = $('cg-arm-cards');
    if (!host) { return; }
    clear(host);
    [['end2end', 'arm.end2end'], ['wm-scaffold', 'arm.wm_scaffold']].forEach(function (pair) {
      host.appendChild(el('section', { 'class': 'cg-panel cg-col-6', 'data-arm': pair[0] }, [
        el('div', { 'class': 'cg-panel__head' }, [
          el('h4', { 'class': 'cg-panel__title', text: t(pair[1] + '.name') }),
          el('span', { 'class': 'cg-chip', 'data-kind': 'arm', 'data-arm': pair[0], text: t(pair[1] + '.label') })
        ]),
        el('div', { 'class': 'cg-panel__body' }, [
          el('p', { text: t(pair[1] + '.short') }),
          el('p', { 'class': 'cg-panel__note', text: t(pair[1] + '.long') })
        ])
      ]));
    });
  }

  function renderAxisCards() {
    var host = $('cg-axis-cards');
    if (!host) { return; }
    clear(host);
    COGNITIVE_METRICS.forEach(function (metric) {
      host.appendChild(el('section', { 'class': 'cg-panel cg-col-6' }, [
        el('div', { 'class': 'cg-panel__head' }, [
          el('h4', { 'class': 'cg-panel__title', text: t('metric.' + metric + '.name') }),
          el('span', { 'class': 'cg-panel__note', text: t('metric.scale.hint') })
        ]),
        el('div', { 'class': 'cg-panel__body' }, [
          el('p', { text: t('metric.' + metric + '.short') }),
          el('p', { 'class': 'cg-panel__note', text: t('metric.' + metric + '.long') }),
          /* Prose says what a metric means; only the formula lets a reader
             recompute the number from the logs and check us. Both go on the
             page, because a benchmark that cannot be re-derived is a claim. */
          hasString('metric.' + metric + '.formula')
            ? el('details', { 'class': 'cg-more' }, [
              el('summary', { text: t('metric.formula.label') }),
              el('div', { 'class': 'cg-more__body' }, [
                el('p', { 'class': 'cg-panel__note cg-mono', text: t('metric.' + metric + '.formula') })
              ])
            ])
            : null
        ])
      ]));
    });
  }

  function renderLegend(host, items) {
    if (!host) { return; }
    clear(host);
    items.forEach(function (item) {
      var swatch = el('span', { 'class': 'cg-swatch', 'data-shape': item.shape });
      if (item.arm) { swatch.setAttribute('data-arm', item.arm); }
      if (item.role) { swatch.setAttribute('data-role', item.role); }
      host.appendChild(el('span', {
        'class': 'cg-legend__item',
        'data-key': item.label,
        title: item.caption ? t(item.caption) : null
      }, [swatch, el('span', { text: t(item.label) })]));
    });
  }

  /**
   * The arena paints six marks that mean different things in one arm colour.
   * The craft, the latched action and the freshly returned action are the whole
   * point of the picture, so all three are named - plus velocity, which is
   * drawn but was explained nowhere.
   */
  function demoLegendItems(arm) {
    return [
      { shape: 'disc', arm: arm, label: 'arena.legend.craft', caption: 'arena.caption.craft' },
      { shape: 'line', arm: arm, label: 'arena.legend.held', caption: 'arena.caption.held' },
      { shape: 'dash', role: 'commanded', label: 'arena.legend.commanded', caption: 'arena.caption.commanded' },
      { shape: 'line', role: 'velocity', label: 'arena.legend.velocity', caption: 'arena.caption.velocity' },
      { shape: 'line', arm: arm, label: 'arena.legend.trail', caption: 'arena.caption.trail' },
      { shape: 'dash', arm: arm, label: 'arena.legend.ghost', caption: 'arena.caption.ghost' },
      { shape: 'ring', arm: arm, label: 'arena.legend.truth', caption: 'arena.caption.truth' },
      { shape: 'dash', role: 'error', label: 'arena.legend.error_line', caption: 'arena.caption.error_line' },
      { shape: 'disc', role: 'goal', label: 'arena.legend.goal', caption: 'arena.caption.goal' },
      { shape: 'dash', role: 'bounds', label: 'arena.legend.bounds', caption: 'arena.caption.bounds' }
    ];
  }

  function paintDemoTitle() {
    var titleNode = $('cg-demo-title');
    if (!titleNode || !demo.episode || !demo.scenario) { return; }
    titleNode.textContent = t('ui.arm_scenario', {
      arm: t(demo.episode.arm === 'end2end' ? 'arm.end2end.name' : 'arm.wm_scaffold.name'),
      scenario: scenarioLabel(demo.episode.scenario_id)
    }) + ' - ' + t('world.budget.value', { b: demo.scenario.deliberation_ticks });
  }

  function paintDemoCaption() {
    var step = DEMO_STEPS[demo.step % DEMO_STEPS.length];
    var label = $('cg-demo-caption-label');
    var text = $('cg-demo-caption-text');
    if (label) { label.textContent = t(step.legend); }
    if (text) {
      var params = {};
      if (step.caption === 'arena.caption.goal' && demo.scenario) {
        params.value = fmtNum(demo.scenario.goal_radius_m, 1);
      }
      text.textContent = t(step.caption, params);
    }
    /* Point at the mark being described: the legend swatch carries the shape
       and the colour, so marking it there names the glyph in the picture. */
    $$('#cg-demo-legend .cg-legend__item').forEach(function (item) {
      if (item.getAttribute('data-key') === step.legend) {
        item.setAttribute('data-active', 'true');
      } else {
        item.removeAttribute('data-active');
      }
    });
  }

  /** A panel that is display:none has no box, so no arena may be built in it. */
  function panelActive(name) {
    var panel = $('cg-panel-' + name);
    return !!panel && panel.getAttribute('data-state') === 'active';
  }

  function startDemo() {
    var mount = $('cg-demo-arena');
    if (!mount) { return; }
    demo.episode = pickDemoEpisode(episodes(), scenarios());
    demo.scenario = scenarioOf(demo.episode);
    if (!demo.episode || !demo.scenario) {
      clear(mount);
      mount.appendChild(note(t('empty.no_data')));
      return;
    }

    paintDemoTitle();
    mount.setAttribute('data-arm', demo.episode.arm);
    renderLegend($('cg-demo-legend'), demoLegendItems(demo.episode.arm));

    renderFrame($('cg-demo-frame'), demo.episode, demo.scenario, 0);

    if (!panelActive('what')) {
      /* Deferred: the tab is hidden, so the mount has no size yet. */
      demo.pending = true;
      renderFrame(mount, demo.episode, demo.scenario, 0);
      return;
    }
    demo.pending = false;

    if (demo.arena) { arenaDestroy(demo.arena); demo.arena = null; }
    demo.arena = createArena(arenaCanvas(mount), {
      episode: demo.episode,
      scenario: demo.scenario,
      bundle: bundle,
      t: t,
      mode: 'demo',
      loop: true,
      autoplay: true,
      speed: 1,
      /* The shell draws the transport row; a second scrubber under the intro
         arena would be one control too many. */
      timeline: false
    });

    if (!demo.arena) {
      renderFrame(mount, demo.episode, demo.scenario, 0);
      arenaNote(mount, t('shell.module_missing'));
    } else {
      clearArenaNote(mount);
    }

    /* One driver for the caption. The arena loops over the episode's cycles,
       which are fewer than the caption list, so letting a frame callback also
       write demo.step made three captions unreachable and put the remaining
       ones out of step with their own sentence. The timer owns the sequence;
       the legend marks the item being described. */
    if (demo.timer) { window.clearInterval(demo.timer); }
    demo.step = 0;
    paintDemoCaption();
    demo.timer = window.setInterval(function () {
      demo.step = (demo.step + 1) % DEMO_STEPS.length;
      paintDemoCaption();
      if (!demo.arena) {
        var cycles = (demo.episode.cycles || []).length;
        if (cycles) { renderFrame(mount, demo.episode, demo.scenario, demo.step % cycles); }
      }
    }, 4200);
  }

  /* ======================================================================
     12. Tab 2 - results
     ====================================================================== */

  /**
   * The evidence behind each headline finding, taken from the bundle.
   *
   * A finding is a factual claim, so it may not be printed flat on a page that
   * simultaneously says the run is unfinished. Each one states the number it
   * rests on; when that number is not in the snapshot the panel is marked
   * provisional instead of asserting a result nobody measured.
   */
  function findingEvidence(name) {
    var eps = episodes();
    var arms = (bundle && bundle.arms) || {};
    if (name === 'decoy') {
      var pairs = (bundle && bundle.feedback) || [];
      var summaries = (bundle && bundle.feedback_summary) || [];
      var nPairs = pairs.length;
      var identicalCommands = pairs.filter(function (pair) {
        return pair.actions_identical === true;
      }).length;
      var raw = null;
      summaries.forEach(function (row) {
        if (row.feedback_raw !== null && row.feedback_raw !== undefined) {
          raw = (raw === null ? 0 : raw) + Math.abs(row.feedback_raw);
        }
      });
      if (!nPairs || raw === null) { return { ok: false }; }
      return {
        ok: identicalCommands === nPairs,
        basis: t('finding.decoy.basis', {
          n: identicalCommands,
          total: nPairs,
          value: fmtNum(raw, 4)
        })
      };
    }
    if (name === 'format') {
      var a = (arms['end2end'] || {}).retried_cycle_rate;
      var b = (arms['wm-scaffold'] || {}).retried_cycle_rate;
      if (!a || !b || a.mean === null || b.mean === null) { return { ok: false }; }
      return {
        ok: a.mean > b.mean,
        basis: t('finding.format.basis', { a: fmtNum(a.mean, 3), b: fmtNum(b.mean, 3) })
      };
    }
    if (name === 'scaffold') {
      var sub = comparableSubset(eps, scenarios());
      var oa = mean(sub.filter(function (e) { return e.arm === 'end2end'; })
        .map(function (e) { return e.scores ? e.scores.outcome : null; }));
      var ob = mean(sub.filter(function (e) { return e.arm === 'wm-scaffold'; })
        .map(function (e) { return e.scores ? e.scores.outcome : null; }));
      if (oa.mean === null || ob.mean === null) { return { ok: false }; }
      // The claim is that scaffolding does not buy steering, so it only stands
      // while the two-stage arm fails to beat the single-prompt one.  A
      // hardcoded true would keep asserting it after the data turned against it.
      return {
        ok: ob.mean <= oa.mean,
        basis: t('finding.scaffold.basis', { a: fmtNum(oa.mean, 4), b: fmtNum(ob.mean, 4) })
      };
    }
    if (name === 'oob') {
      var total = eps.length;
      if (!total) { return { ok: false }; }
      var oob = eps.filter(function (e) { return e.outcome === 'oob'; }).length;
      return { ok: oob > total / 2, basis: t('finding.oob.basis', { n: oob, total: total }) };
    }
    if (name === 'floor') {
      var best = null;
      ARMS.forEach(function (arm) {
        var stats = (arms[arm] || {}).prediction_fidelity;
        var floor = matchedFloorMean(eps, arm);
        if (!stats || stats.mean === null || floor.mean === null || !floor.n) { return; }
        if (!best || stats.mean > best.fidelity) {
          best = { fidelity: stats.mean, floor: floor.mean, n: floor.n };
        }
      });
      if (!best) { return { ok: false }; }
      return {
        ok: best.fidelity > best.floor,
        basis: t('finding.floor.basis', {
          fidelity: fmtNum(best.fidelity, 4), floor: fmtNum(best.floor, 4), n: best.n
        })
      };
    }
    return { ok: false };
  }

  function renderFindings() {
    var host = $('cg-findings');
    if (!host) { return; }
    clear(host);
    ['decoy', 'format', 'scaffold', 'oob', 'floor'].forEach(function (name) {
      var evidence = findingEvidence(name) || { ok: false };
      var head = el('div', { 'class': 'cg-panel__head' }, [
        el('h4', { 'class': 'cg-panel__title', text: t('finding.' + name + '.title') })
      ]);
      if (!evidence.ok) {
        head.appendChild(el('span', {
          'class': 'cg-chip', 'data-kind': 'retry',
          title: t('finding.provisional.note'),
          text: t('finding.provisional')
        }));
      }
      var body = el('div', { 'class': 'cg-panel__body' }, [
        el('p', { text: t('finding.' + name + '.body') })
      ]);
      body.appendChild(el('p', {
        'class': 'cg-panel__note',
        text: t('finding.basis') + ': ' + (evidence.basis || t('finding.provisional.note'))
      }));
      var panel = el('div', { 'class': 'cg-panel cg-col-4' }, [head, body]);
      if (!evidence.ok) { panel.setAttribute('data-state', 'provisional'); }
      host.appendChild(panel);
    });
  }

  /** Feedback use carries two different nulls; they must not be blended. */
  function feedbackReason(row) {
    if (meta().report_present !== true) { return 'no_report'; }
    var constants = (bundle && bundle.constants) || {};
    if (row && row.feedback_band !== null && row.feedback_band !== undefined &&
        row.feedback_band < (constants.FEEDBACK_MIN_BAND || 0.1)) {
      return 'low_band';
    }
    return 'unknown';
  }

  function metricCard(arm, metric) {
    var armStats = ((bundle && bundle.arms) || {})[arm] || {};
    var card = el('div', { 'class': 'cg-metric', 'data-arm': arm });
    card.appendChild(el('div', { 'class': 'cg-metric__label', text: t('metric.' + metric + '.name') }));

    var value = null;
    var n = null;
    var footParts = [];
    var invalid = null;

    if (metric === 'feedback_use') {
      var row = null;
      ((bundle && bundle.feedback_summary) || []).forEach(function (r) { if (r.arm === arm) { row = r; } });
      value = row ? row.feedback_use : null;
      n = row ? row.n_pairs : 0;
      if (value === null || value === undefined) {
        card.setAttribute('data-state', 'unmeasurable');
        card.appendChild(el('div', {
          'class': 'cg-metric__value',
          text: unmeasurableText(feedbackReason(row))
        }));
      } else {
        card.appendChild(el('div', { 'class': 'cg-metric__value cg-num', text: fmtNum(value, 3) }));
      }
      footParts.push(t('metric.midpoint.hint'));
      if (row) {
        footParts.push(t('feedback.raw.label') + ' ' + fmtNum(row.feedback_raw, 4));
        footParts.push(t('ui.of', { n: n, total: n }));
      }
      card.appendChild(el('div', { 'class': 'cg-metric__foot', text: footParts.join(' - ') }));
      return card;
    }

    if (metric === 'outcome') {
      var subset = comparableSubset(episodes(), scenarios()).filter(function (ep) { return ep.arm === arm; });
      var agg = mean(subset.map(function (ep) { return ep.scores ? ep.scores.outcome : null; }));
      value = agg.mean;
      n = agg.n;
      footParts.push(t('metric.subset.note', { n: n }));
    } else {
      var stats = armStats[metric];
      value = stats ? stats.mean : null;
      n = stats ? stats.n : 0;
      if (metric === 'prediction_fidelity') {
        var cov = armStats.prediction_coverage;
        footParts.push(t('metric.prediction_coverage.name') + ' ' + (cov ? fmtNum(cov.mean, 3) : t('ui.na')));
        /* The floor has to run over the same episodes as the fidelity mean.
           The arm aggregate averages it over every episode, which overstates
           the margin for one arm and understates it for the other - in
           opposite directions, which corrupts the arm-vs-arm comparison this
           card exists to support. */
        var floor = matchedFloorMean(episodes(), arm);
        footParts.push(t('metric.persistence_floor.name') + ' ' +
          (floor.mean === null ? t('ui.na') : fmtNum(floor.mean, 4)) +
          ' (' + t('metric.persistence_floor.matched', { n: floor.n }) + ')');
      }
      if (metric === 'temporal_anticipation') { footParts.push(t('metric.midpoint.hint')); }
      if (stats && stats.min !== undefined && stats.max !== undefined && stats.min !== stats.max) {
        footParts.push(fmtNum(stats.min, 3) + ' - ' + fmtNum(stats.max, 3));
      } else if (stats) {
        footParts.push(t('arm.compare.same'));
      }
      /* The denominator is the arm aggregate's own episode set, not every
         episode flown by that arm: decoy runs sit outside the aggregate. */
      footParts.push(t('ui.of', { n: n, total: armStats.n_episodes || episodesForArm(arm).length }));
    }

    if (value === null || value === undefined) {
      card.setAttribute('data-state', 'unmeasurable');
      card.appendChild(el('div', { 'class': 'cg-metric__value', text: unmeasurableText(invalid) }));
    } else {
      card.appendChild(el('div', { 'class': 'cg-metric__value cg-num', text: fmtNum(value, 3) }));
    }
    card.appendChild(el('div', { 'class': 'cg-metric__foot', text: footParts.join(' - ') }));
    return card;
  }

  function episodesForArm(arm) {
    return episodes().filter(function (ep) { return ep.arm === arm; });
  }

  function renderMetricCards() {
    var host = $('cg-metric-cards');
    if (!host) { return; }
    clear(host);
    COGNITIVE_METRICS.forEach(function (metric) {
      ARMS.forEach(function (arm) { host.appendChild(metricCard(arm, metric)); });
    });
  }

  function renderArmComparison() {
    var chartMount = $('cg-chart-arms');
    var tableMount = $('cg-arms-table');
    if (!tableMount) { return; }

    var metrics = COGNITIVE_METRICS.concat(CONTROL_METRICS);
    var spec = {
      arms: (bundle && bundle.arms) || {},
      baselines: (bundle && bundle.baselines) || {},
      metrics: metrics,
      t: t,
      bundle: bundle
    };
    var drawn = drawChart('arm_bars', chartMount, spec);

    clear(tableMount);
    if (!drawn && chartMount) {
      clear(chartMount);
      tableMount.appendChild(note(t('shell.module_missing'), 'control'));
    }

    /* Fidelity is restricted to paired cells; the unrestricted means rest on
       almost disjoint episode sets and would rank the arms on scenario mix. */
    var paired = pairedFidelity(episodes());
    var footNotes = [];

    var rows = metrics.map(function (metric) {
      var tr = el('tr');
      var cognitive = COGNITIVE_METRICS.indexOf(metric) !== -1;
      var lower = LOWER_IS_BETTER[metric] === true;
      tr.appendChild(el('th', { scope: 'row' }, [
        el('span', { text: t('metric.' + metric + '.name') }),
        el('span', {
          'class': 'cg-th__sub',
          text: t(lower ? 'arm.compare.direction.lower' : 'arm.compare.direction.higher')
        })
      ]));
      tr.appendChild(el('td', { text: t(cognitive ? 'metric.group.cognitive' : 'metric.group.control') }));
      ARMS.forEach(function (arm) {
        var stats = (((bundle && bundle.arms) || {})[arm] || {})[metric];
        var value = stats ? stats.mean : null;
        var n = stats ? stats.n : null;
        if (metric === 'prediction_fidelity') {
          value = paired.means[arm];
          n = paired.n;
        }
        if (metric === 'feedback_use') {
          var row = null;
          ((bundle && bundle.feedback_summary) || []).forEach(function (r) { if (r.arm === arm) { row = r; } });
          value = row ? row.feedback_use : null;
          n = row ? row.n_pairs : null;
        }
        if (metric === 'outcome') {
          var subset = comparableSubset(episodes(), scenarios()).filter(function (ep) { return ep.arm === arm; });
          var agg = mean(subset.map(function (ep) { return ep.scores ? ep.scores.outcome : null; }));
          value = agg.mean;
          n = agg.n;
        }
        if (value === null || value === undefined) {
          tr.appendChild(el('td', {
            'data-type': 'num', 'data-state': 'unmeasurable', 'class': 'cg-num',
            title: unmeasurableText(metric === 'feedback_use' ? feedbackReason(null) : null)
          }, [
            el('span', { 'aria-hidden': 'true', text: t('empty.not_measured') }),
            el('span', {
              'class': 'cg-sr-only',
              text: unmeasurableText(metric === 'feedback_use' ? feedbackReason(null) : null)
            })
          ]));
        } else {
          tr.appendChild(numCell(value, 3, null));
        }
        /* A bar reads "longer = better". On a metric where lower is better the
           bar draws the complement, and the row says so, or the arm that
           breaks JSON most often would draw the longest bar. */
        tr.appendChild(barCell(
          value === null || value === undefined || !lower ? value : 1 - value, arm, null));
        tr.appendChild(el('td', {
          'data-type': 'num', 'class': 'cg-num',
          text: n === null || n === undefined ? t('empty.value_missing') : String(n)
        }));
      });
      if (lower) { footNotes.push(t('metric.' + metric + '.name') + ': ' + t('arm.compare.bar_inverted')); }
      if (metric === 'prediction_fidelity') {
        footNotes.push(t('metric.prediction_fidelity.name') + ': ' +
          t('arm.compare.paired_only', { n: paired.n }) + ' ' +
          t('arm.compare.coverage_warning', {
            a: fidelityCoverage('end2end'),
            b: fidelityCoverage('wm-scaffold')
          }));
      }
      return tr;
    });

    tableMount.appendChild(el('div', { 'class': 'cg-tablewrap' }, [
      table([
        { label: t('results.col.metric') },
        { label: t('results.col.group') },
        { label: t('arm.end2end.name'), numeric: true },
        { label: '', srLabel: t('arm.end2end.name') },
        { label: t('arm.compare.n'), numeric: true, title: t('arm.end2end.name') },
        { label: t('arm.wm_scaffold.name'), numeric: true },
        { label: '', srLabel: t('arm.wm_scaffold.name') },
        { label: t('arm.compare.n'), numeric: true, title: t('arm.wm_scaffold.name') }
      ], rows, t('arm.compare.title'))
    ]));
    footNotes.forEach(function (text) {
      tableMount.appendChild(el('p', { 'class': 'cg-panel__note', text: text }));
    });
  }

  /** How many episodes of one arm carry a publishable fidelity number. */
  function fidelityCoverage(arm) {
    var stats = (((bundle && bundle.arms) || {})[arm] || {}).prediction_fidelity;
    return stats && stats.n !== undefined && stats.n !== null ? String(stats.n) : t('ui.na');
  }

  function renderRefs() {
    var host = $('cg-refs-table');
    if (!host) { return; }
    clear(host);
    var base = (bundle && bundle.baselines) || {};
    /* The heat searcher is part of the reference set by design; it is listed
       whether or not its numbers are published, so a reader calibrating the
       heat axis can see that the row exists and is simply not filled in. */
    var rows = ['random', 'greedy', 'searcher', 'oracle'].map(function (name) {
      var row = base[name] || {};
      return el('tr', {}, [
        el('th', { scope: 'row', text: t('ref.' + name + '.name') }),
        el('td', { text: t('ref.' + name + '.short') }),
        /* These rows are deterministic programs, not prompted models: a gap
           here means README publishes no such number, never that "no
           prediction was requested". */
        numCell(row.outcome, 4, 'not_published'),
        numCell(row.temporal, 4, 'not_published')
      ]);
    });
    host.appendChild(table([
      { label: t('ref.group.title') },
      { label: '' },
      { label: t('metric.outcome.name'), numeric: true },
      { label: t('metric.temporal_anticipation.name'), numeric: true }
    ], rows));
  }

  function resultRow(ep) {
    var sc = scenarioOf(ep) || {};
    var tr = el('tr', {
      'data-key': ep.key,
      'data-clickable': 'true',
      tabindex: '0',
      'data-arm': ep.arm,
      title: t('results.open_in_lab')
    });
    if (state.episodeKey === ep.key) { tr.setAttribute('aria-selected', 'true'); }

    var scenarioCell = el('td', {}, [
      el('span', { text: scenarioLabel(ep.scenario_id) })
    ]);
    if (sc.goal_visible === false) {
      scenarioCell.appendChild(document.createTextNode(' '));
      scenarioCell.appendChild(el('span', { 'class': 'cg-chip', text: t('scenario.masked_badge') }));
    }
    if (sc.is_probe) {
      scenarioCell.appendChild(document.createTextNode(' '));
      scenarioCell.appendChild(el('span', { 'class': 'cg-chip', text: t('scenario.probe_badge') }));
    }
    tr.appendChild(scenarioCell);

    tr.appendChild(el('td', {}, [armChip(ep.arm)]));
    tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: 'r' + ep.repetition }));
    tr.appendChild(el('td', {}, [
      ep.variant === 'decoy'
        ? el('span', { 'class': 'cg-chip', 'data-kind': 'decoy', text: t('results.heat.decoy') })
        : el('span', { text: t('results.heat.true') })
    ]));
    tr.appendChild(el('td', {}, [outcomeChip(ep.outcome)]));
    tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: String(ep.n_cycles) }));
    tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: fmtNum(ep.closest_approach_m, 2) }));
    tr.appendChild(numCell(ep.scores.prediction_fidelity, 3, ep.scores.fidelity_invalid_reason));
    tr.appendChild(numCell(ep.scores.prediction_coverage, 2, null));
    tr.appendChild(numCell(ep.scores.temporal_anticipation, 3, temporalReason(ep)));
    tr.appendChild(numCell(ep.scores.outcome, 4, null));
    tr.appendChild(barCell(ep.scores.outcome, ep.arm, null));
    tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: String(sc.deliberation_ticks) }));
    return tr;
  }

  var RESULT_COLUMNS = [
    { key: 'scenario', label: 'results.col.scenario', accessor: function (ep) { return ep.scenario_id; } },
    { key: 'arm', label: 'results.col.arm', accessor: function (ep) { return ep.arm; } },
    { key: 'rep', label: 'results.col.rep', numeric: true, accessor: function (ep) { return ep.repetition; } },
    { key: 'heat', label: 'results.col.heat_source', accessor: function (ep) { return ep.variant; } },
    { key: 'outcome', label: 'results.col.outcome', accessor: function (ep) { return ep.outcome; } },
    { key: 'cycles', label: 'results.col.cycles', numeric: true, accessor: function (ep) { return ep.n_cycles; } },
    { key: 'closest', label: 'results.col.closest', numeric: true, accessor: function (ep) { return ep.closest_approach_m; } },
    { key: 'fidelity', label: 'results.col.fidelity', numeric: true, accessor: function (ep) { return ep.scores.prediction_fidelity; } },
    { key: 'coverage', label: 'results.col.coverage', numeric: true, accessor: function (ep) { return ep.scores.prediction_coverage; } },
    { key: 'temporal', label: 'results.col.temporal', numeric: true, accessor: function (ep) { return ep.scores.temporal_anticipation; } },
    { key: 'outcome_score', label: 'results.col.outcome_score', numeric: true, accessor: function (ep) { return ep.scores.outcome; } },
    { key: 'outcome_bar', label: '', srLabel: 'results.col.outcome_score', accessor: null },
    { key: 'budget', label: 'results.col.budget', numeric: true, accessor: function (ep) { var s = scenarioOf(ep); return s ? s.deliberation_ticks : null; } }
  ];

  function renderResultsTable() {
    var host = $('cg-results-table');
    if (!host) { return; }
    clear(host);

    var rows = filterEpisodes(episodes(), state.filters, scenarios());
    var column = null;
    RESULT_COLUMNS.forEach(function (c) { if (c.key === state.sort.column) { column = c; } });
    if (column && column.accessor) { rows = sortRows(rows, column.accessor, state.sort.dir); }

    var counter = $('cg-results-count');
    if (counter) { counter.textContent = t('results.count', { n: rows.length, total: episodes().length }); }

    if (!rows.length) {
      /* Two different emptinesses: nothing was loaded, or the filters exclude
         everything. Offering "clear filters" for the first one would lie. */
      if (!episodes().length) { host.appendChild(note(t('empty.no_data'))); return; }
      host.appendChild(note(t('empty.no_episodes')));
      host.appendChild(el('div', { 'class': 'cg-panel__actions' }, [
        el('button', {
          'class': 'cg-btn', type: 'button', text: t('results.filter.clear'),
          onclick: function () { clearFilters(); }
        })
      ]));
      return;
    }

    var headers = RESULT_COLUMNS.map(function (c) {
      return {
        label: c.label ? t(c.label) : '',
        srLabel: c.srLabel ? t(c.srLabel) : null,
        numeric: c.numeric,
        sortKey: c.accessor ? c.key : null
      };
    });

    var tbl = table(headers, rows.map(resultRow), t('results.table.title'));
    tbl.addEventListener('click', onResultsTableActivate);
    tbl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { onResultsTableActivate(ev); }
    });
    host.appendChild(tbl);
  }

  function onResultsTableActivate(ev) {
    var th = ev.target.closest ? ev.target.closest('th[data-sort]') : null;
    if (th) {
      if (ev.type === 'keydown') { ev.preventDefault(); }
      var key = th.getAttribute('data-sort');
      state.sort.dir = state.sort.column === key ? -state.sort.dir : 1;
      state.sort.column = key;
      renderResultsTable();
      return;
    }
    var tr = ev.target.closest ? ev.target.closest('tr[data-key]') : null;
    if (!tr) { return; }
    if (ev.type === 'keydown') { ev.preventDefault(); }
    openInLab(tr.getAttribute('data-key'));
  }

  function renderControlTable() {
    var host = $('cg-control-table');
    if (!host) { return; }
    clear(host);
    var rows = filterEpisodes(episodes(), state.filters, scenarios()).map(function (ep) {
      return el('tr', { 'data-arm': ep.arm }, [
        el('th', { scope: 'row', 'class': 'cg-mono', text: ep.key }),
        numCell(ep.scores.action_parse_rate, 2, null),
        numCell(ep.scores.prediction_parse_rate, 2, null),
        numCell(ep.scores.prediction_coverage, 2, null),
        numCell(ep.retried_cycle_rate, 2, null),
        el('td', { 'data-type': 'num', 'class': 'cg-num', text: String(ep.transport_retries) }),
        el('td', { 'data-type': 'num', 'class': 'cg-num', text: fmtNum(ep.wall_clock_ms / 1000, 1) })
      ]);
    });
    if (!rows.length) { host.appendChild(note(t('empty.no_episodes'))); return; }
    host.appendChild(table([
      { label: t('results.col.log') },
      { label: t('metric.action_parse_rate.name'), numeric: true, title: t('metric.action_parse_rate.long') },
      { label: t('metric.prediction_parse_rate.name'), numeric: true, title: t('metric.prediction_parse_rate.long') },
      { label: t('metric.prediction_coverage.name'), numeric: true, title: t('metric.prediction_coverage.long') },
      { label: t('metric.retried_cycle_rate.name'), numeric: true, title: t('metric.retried_cycle_rate.long') },
      { label: t('metric.transport_retries.name'), numeric: true, title: t('metric.transport_retries.long') },
      { label: t('metric.wall_clock.name') + ' [' + t('unit.s') + ']', numeric: true, title: t('metric.wall_clock.long') }
    ], rows));
    /* A definition that lives only in a title attribute is a definition only a
       mouse can read. Printing loses it, touch loses it, a screen reader may
       skip it. The ones that decide how a number should be taken go on screen. */
    host.appendChild(el('dl', { 'class': 'cg-readout cg-panel__note' }, [
      el('dt', { text: t('metric.action_parse_rate.name') }),
      el('dd', { text: t('metric.action_parse_rate.long') }),
      el('dt', { text: t('metric.prediction_coverage.name') }),
      el('dd', { text: t('metric.prediction_coverage.long') }),
      el('dt', { text: t('metric.retried_cycle_rate.name') }),
      el('dd', { text: t('metric.retried_cycle_rate.long') })
    ]));
    host.appendChild(el('p', { 'class': 'cg-panel__note', text: t('control.calls_note') }));
  }

  function renderFeedback() {
    var host = $('cg-feedback');
    if (!host) { return; }
    clear(host);

    var pairs = (bundle && bundle.feedback) || [];
    if (!pairs.length) { host.appendChild(note(t('empty.no_decoy_pair'))); return; }

    /* This panel holds the sharpest result in the data. Left as a bare table of
       paired numbers it reads as bookkeeping, so the reading goes on top - and
       only when the pairs actually support it. */
    var withCommands = pairs.filter(function (p) { return typeof p.actions_identical === 'boolean'; });
    var allSame = withCommands.length > 0 &&
      withCommands.every(function (p) { return p.actions_identical === true; });
    if (allSame) {
      host.appendChild(note(t('results.pairs.headline', { n: withCommands.length }), 'control'));
    }

    ARMS.forEach(function (arm) {
      var summary = null;
      ((bundle && bundle.feedback_summary) || []).forEach(function (r) { if (r.arm === arm) { summary = r; } });
      var armPairs = pairs.filter(function (p) { return p.arm === arm; });
      if (!armPairs.length) { return; }

      var block = el('section', { 'data-arm': arm });
      block.appendChild(el('h4', { 'class': 'cg-panel__title', text: t('ui.arm_scenario', {
        arm: t(arm === 'end2end' ? 'arm.end2end.name' : 'arm.wm_scaffold.name'),
        scenario: t('metric.feedback_use.name')
      }) }));

      armPairs.forEach(function (pair) {
        /* Equal scores are weak evidence - two different command sequences can
           coincide on one number. Equal commands are the real finding, so say
           which one this pair actually shows. */
        var sameScore = pair.outcome_delta === 0;
        var sameCommands = pair.actions_identical === true;
        var identical = sameScore || sameCommands;
        var wrap = el('div', { 'class': 'cg-pair' }, [
          el('div', { 'class': 'cg-pair__cell' }, [
            el('div', { 'class': 'cg-label', text: t('results.heat.true') }),
            el('div', { 'class': 'cg-hero__value cg-num', text: fmtNum(pair.normal_outcome, 4) }),
            el('button', {
              'class': 'cg-btn', type: 'button', text: scenarioLabel(pair.scenario_id),
              onclick: function () { openInLab(pair.normal_key); }
            })
          ]),
          el('div', { 'class': 'cg-pair__cell' }, [
            el('div', { 'class': 'cg-label', text: t('results.heat.decoy') }),
            el('div', { 'class': 'cg-hero__value cg-num', text: fmtNum(pair.decoy_outcome, 4) }),
            el('button', {
              'class': 'cg-btn', type: 'button', text: scenarioLabel(pair.scenario_id),
              onclick: function () { openInLab(pair.decoy_key); }
            })
          ])
        ]);
        block.appendChild(wrap);
        var deltaLine = el('div', { 'class': 'cg-identical' });
        if (identical) { deltaLine.appendChild(svgIcon('cg-equals', 'cg-identical__icon')); }
        deltaLine.appendChild(el('span', {
          text: sameCommands
            ? t('results.pairs.same_commands')
            : (sameScore
              ? t('results.pairs.same_score')
              : t('arm.compare.delta') + ': ' + fmtNum(pair.outcome_delta, 4))
        }));
        block.appendChild(deltaLine);
      });

      var footParts = [];
      if (summary) {
        if (summary.feedback_use === null || summary.feedback_use === undefined) {
          footParts.push(t('metric.feedback_use.name') + ': ' + unmeasurableText(feedbackReason(summary)));
        } else {
          footParts.push(t('metric.feedback_use.name') + ': ' + fmtNum(summary.feedback_use, 3));
        }
        /* fmtNum returns null for an unmeasured value; concatenating it would
           print the word "null" at the reader, which reads like a number. */
        var rawText = fmtNum(summary.feedback_raw, 4);
        footParts.push(t('feedback.raw.label') + ' ' +
          (rawText === null ? unmeasurableText(feedbackReason(summary)) : rawText));
        footParts.push(t('ui.of', { n: summary.n_pairs, total: summary.n_pairs }));
      }
      block.appendChild(el('p', { 'class': 'cg-panel__note', text: footParts.join(' - ') }));
      host.appendChild(block);
    });
  }

  function renderProbes() {
    var host = $('cg-probes');
    if (!host) { return; }
    clear(host);
    var probes = (bundle && bundle.probes) || [];
    if (!probes.length) {
      host.appendChild(note(t('results.probes.not_run'), 'control'));
      var probeScenarios = Object.keys(scenarios()).filter(function (id) { return scenarios()[id].is_probe; });
      probeScenarios.forEach(function (id) {
        host.appendChild(el('p', { 'class': 'cg-panel__note', text: scenarioLabel(id) + ' - ' + t('scenario.' + id + '.desc') }));
      });
      return;
    }
    /* Probe columns are control fields, never one of the four axes
       (METRICS.md W11), so they must not borrow a metric card's name - but a
       scorer identifier is not a translation either. The translated name is
       the header; the identifier rides underneath in mono for traceability. */
    var rows = probes.map(function (p) {
      return el('tr', {}, [
        el('th', { scope: 'row', 'class': 'cg-mono', text: p.key || p.probe_kind }),
        numCell(p.json_parse_rate, 2, null),
        numCell(p.identity_fidelity, 3, null),
        numCell(p.engage_fidelity, 3, null),
        numCell(p.choice_accuracy, 3, null),
        el('td', { 'data-type': 'num', 'class': 'cg-num', text: t('ui.of', { n: p.n_parsed, total: p.n_trials }) })
      ]);
    });
    host.appendChild(el('div', { 'class': 'cg-tablewrap' }, [
      table([
        { label: t('results.probes.title') },
        { label: t('probe.col.json_parse'), sub: 'json_parse_rate', numeric: true },
        { label: t('probe.col.identity'), sub: 'identity_fidelity', numeric: true },
        { label: t('probe.col.engage'), sub: 'engage_fidelity', numeric: true },
        { label: t('probe.col.choice_accuracy'), sub: 'choice_accuracy', numeric: true },
        { label: t('probe.col.parsed'), sub: 'n_parsed', numeric: true }
      ], rows)
    ]));
    /* Forced choice is a two-way pick, so 0.5 is the floor a coin reaches.
       Without that anchor on screen, 0.7 reads like a score out of one. */
    host.appendChild(el('p', { 'class': 'cg-panel__note', text: t('probe.chance') }));
    host.appendChild(el('p', { 'class': 'cg-panel__note', text: t('control.calls_note') }));
  }

  /* ---- filters ---------------------------------------------------------- */

  function selectField(labelKey, value, options, onChange) {
    var select = el('select', { onchange: function (ev) { onChange(ev.target.value); } });
    options.forEach(function (opt) {
      select.appendChild(el('option', { value: opt.value, text: opt.label, selected: opt.value === String(value) }));
    });
    select.value = String(value);
    var label = el('label', { 'class': 'cg-field' }, [
      el('span', { 'class': 'cg-label', text: t(labelKey) }),
      select
    ]);
    return label;
  }

  function scenarioOptions() {
    var seen = {};
    var opts = [{ value: 'all', label: t('results.filter.all') }];
    episodes().forEach(function (ep) {
      if (seen[ep.scenario_id]) { return; }
      seen[ep.scenario_id] = true;
      opts.push({ value: ep.scenario_id, label: scenarioLabel(ep.scenario_id) });
    });
    return opts;
  }

  function repOptions() {
    var seen = {};
    var opts = [{ value: 'all', label: t('results.filter.all') }];
    episodes().forEach(function (ep) {
      if (seen[ep.repetition]) { return; }
      seen[ep.repetition] = true;
      opts.push({ value: String(ep.repetition), label: 'r' + ep.repetition });
    });
    return opts;
  }

  function renderFilters() {
    var host = $('cg-filters');
    if (!host) { return; }
    clear(host);
    host.appendChild(selectField('results.filter.arm', state.filters.arm, [
      { value: 'all', label: t('results.filter.all') },
      { value: 'end2end', label: t('arm.end2end.name') },
      { value: 'wm-scaffold', label: t('arm.wm_scaffold.name') }
    ], function (v) { state.filters.arm = v; renderResultsTable(); renderControlTable(); }));

    host.appendChild(selectField('results.filter.scenario', state.filters.scenario, scenarioOptions(),
      function (v) { state.filters.scenario = v; renderResultsTable(); renderControlTable(); }));

    host.appendChild(selectField('results.filter.rep', state.filters.rep, repOptions(),
      function (v) { state.filters.rep = v; renderResultsTable(); renderControlTable(); }));

    host.appendChild(selectField('results.col.heat_source', state.filters.variant, [
      { value: 'all', label: t('results.filter.all') },
      { value: 'normal', label: t('results.filter.normal_only') },
      { value: 'decoy', label: t('results.filter.decoy_only') }
    ], function (v) { state.filters.variant = v; renderResultsTable(); renderControlTable(); }));

    host.appendChild(selectField('scenario.masked_badge', state.filters.goal, [
      { value: 'all', label: t('results.filter.all') },
      { value: 'visible', label: t('results.filter.visible_only') },
      { value: 'masked', label: t('results.filter.masked_only') }
    ], function (v) { state.filters.goal = v; renderResultsTable(); renderControlTable(); }));

    host.appendChild(el('button', {
      'class': 'cg-btn', type: 'button', text: t('results.filter.clear'),
      onclick: function () { clearFilters(); }
    }));
  }

  function clearFilters() {
    state.filters = { arm: 'all', scenario: 'all', rep: 'all', variant: 'all', goal: 'all' };
    renderFilters();
    renderResultsTable();
    renderControlTable();
  }

  /* ======================================================================
     13. Tab 3 - lab
     ====================================================================== */

  function currentEpisode() {
    return episodeByKey(state.episodeKey) || null;
  }

  function currentCycle() {
    var ep = currentEpisode();
    if (!ep || !ep.cycles || !ep.cycles.length) { return null; }
    return ep.cycles[clamp(state.cycle, 0, ep.cycles.length - 1)] || null;
  }

  function labSelectOptions() {
    var host = $('cg-lab-select');
    if (!host) { return; }
    clear(host);
    var ep = currentEpisode();
    var parsed = parseEpisodeKey(state.episodeKey) || {};

    host.appendChild(selectField('lab.select.scenario', parsed.scenario_id || '', scenarioOptions().slice(1),
      function (v) { selectEpisodeParts({ scenario_id: v }); }));

    host.appendChild(selectField('lab.select.arm', parsed.arm || '', [
      { value: 'end2end', label: t('arm.end2end.name') },
      { value: 'wm-scaffold', label: t('arm.wm_scaffold.name') }
    ], function (v) { selectEpisodeParts({ arm: v }); }));

    host.appendChild(selectField('lab.select.rep', String(parsed.repetition === undefined ? '' : parsed.repetition),
      repOptions().slice(1), function (v) { selectEpisodeParts({ repetition: parseInt(v, 10) }); }));

    host.appendChild(selectField('lab.select.heat', parsed.variant || 'normal', [
      { value: 'normal', label: t('results.heat.true') },
      { value: 'decoy', label: t('results.heat.decoy') }
    ], function (v) { selectEpisodeParts({ variant: v }); }));

    var sc = scenarioOf(ep);
    var revealBtn = el('button', {
      'class': 'cg-btn', type: 'button', text: t('lab.show_hidden_goal'),
      'aria-pressed': state.reveal ? 'true' : 'false',
      disabled: sc && sc.goal_visible !== false ? true : null,
      onclick: function () {
        state.reveal = !state.reveal;
        arenaReveal(lab.arena, state.reveal);
        labSelectOptions();
      }
    });
    host.appendChild(revealBtn);

    host.appendChild(el('button', {
      'class': 'cg-btn', type: 'button', text: t('lab.overlay.title'),
      'aria-pressed': state.overlay ? 'true' : 'false',
      onclick: function () {
        state.overlay = !state.overlay;
        arenaOverlay(lab.arena, state.overlay ? overlayEpisode() : null);
        labSelectOptions();
      }
    }));
  }

  function overlayEpisode() {
    var ep = currentEpisode();
    if (!ep) { return null; }
    var otherArm = ep.arm === 'end2end' ? 'wm-scaffold' : 'end2end';
    var suffix = ep.variant === 'decoy' ? '.decoy' : '';
    return episodeByKey(ep.scenario_id + '.r' + ep.repetition + '.' + otherArm + suffix);
  }

  /** Replace one part of the current key and land on the closest real episode. */
  function selectEpisodeParts(patch) {
    var parsed = parseEpisodeKey(state.episodeKey) || { scenario_id: null, repetition: 0, arm: 'end2end', variant: 'normal' };
    var wanted = {
      scenario_id: patch.scenario_id !== undefined ? patch.scenario_id : parsed.scenario_id,
      repetition: patch.repetition !== undefined ? patch.repetition : parsed.repetition,
      arm: patch.arm !== undefined ? patch.arm : parsed.arm,
      variant: patch.variant !== undefined ? patch.variant : parsed.variant
    };
    var exact = episodes().filter(function (ep) {
      return ep.scenario_id === wanted.scenario_id && ep.repetition === wanted.repetition &&
        ep.arm === wanted.arm && ep.variant === wanted.variant;
    })[0];
    if (exact) { setEpisode(exact.key); return; }

    var relaxed = episodes().filter(function (ep) {
      return ep.scenario_id === wanted.scenario_id && ep.arm === wanted.arm;
    })[0] || episodes().filter(function (ep) { return ep.scenario_id === wanted.scenario_id; })[0];
    if (relaxed) { setEpisode(relaxed.key); return; }
    setEpisode(state.episodeKey);
  }

  function renderTransport() {
    var host = $('cg-transport');
    if (!host) { return; }
    clear(host);
    var ep = currentEpisode();
    if (!ep) { return; }
    if (lab.arena && lab.arena.providesTransport === true) { return; }

    var cycles = ep.cycles || [];
    var total = Math.max(cycles.length, 1);

    function btn(iconId, labelKey, onClick, pressed) {
      var b = el('button', {
        'class': 'cg-btn cg-btn--icon', type: 'button',
        'aria-label': t(labelKey), title: t(labelKey),
        onclick: onClick
      });
      if (pressed !== undefined) { b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); }
      b.appendChild(svgIcon(iconId, 'cg-btn__icon'));
      return b;
    }

    host.appendChild(btn('cg-reset', 'arena.control.restart', function () { seekCycle(0); }));
    var stepBack = btn('cg-step', 'arena.control.step_back', function () { seekCycle(state.cycle - 1); });
    stepBack.style.transform = 'scaleX(-1)';
    host.appendChild(stepBack);
    host.appendChild(btn(state.playing ? 'cg-pause' : 'cg-play',
      state.playing ? 'arena.control.pause' : 'arena.control.play',
      function () { togglePlay(); }, state.playing));
    host.appendChild(btn('cg-step', 'arena.control.step_forward', function () { seekCycle(state.cycle + 1); }));

    var scrub = el('div', { 'class': 'cg-scrub' });
    var track = el('div', { 'class': 'cg-scrub__track' });
    var played = el('div', { 'class': 'cg-scrub__played' });
    played.style.width = (total > 1 ? (state.cycle / (total - 1)) * 100 : 100).toFixed(1) + '%';
    track.appendChild(played);
    scrub.appendChild(track);

    var span = Math.max(ep.final_tick, 1);
    var sc = scenarioOf(ep) || {};
    cycles.forEach(function (c, i) {
      var mark = el('div', { 'class': 'cg-scrub__cycle' });
      mark.style.left = (clamp(c.tick / span, 0, 1) * 100).toFixed(2) + '%';
      if (c.parse_failed) { mark.setAttribute('data-parse', 'failed'); }
      if (i === state.cycle) { mark.setAttribute('data-state', 'active'); }
      scrub.appendChild(mark);
      var band = el('div', { 'class': 'cg-scrub__delib' });
      band.style.left = (clamp(c.tick / span, 0, 1) * 100).toFixed(2) + '%';
      band.style.width = (clamp((c.engage_tick - c.tick) / span, 0, 1) * 100).toFixed(2) + '%';
      if (i === state.cycle) { scrub.appendChild(band); }
    });

    var end = el('div', { 'class': 'cg-scrub__end', 'data-outcome': ep.outcome });
    end.style.left = '100%';
    scrub.appendChild(end);

    if (sc.deadline_tick && sc.deadline_tick <= ep.final_tick) {
      var dl = el('div', { 'class': 'cg-scrub__deadline' });
      dl.style.left = (clamp(sc.deadline_tick / span, 0, 1) * 100).toFixed(2) + '%';
      scrub.appendChild(dl);
    }

    var handle = el('div', { 'class': 'cg-scrub__handle' });
    handle.style.left = (total > 1 ? (state.cycle / (total - 1)) * 100 : 100).toFixed(1) + '%';
    scrub.appendChild(handle);

    var range = el('input', {
      'class': 'cg-scrub__input', type: 'range', min: '0', max: String(total - 1), step: '1',
      value: String(state.cycle),
      'aria-label': t('arena.control.progress', { n: state.cycle + 1, total: total }),
      'aria-valuetext': t('arena.control.progress', { n: state.cycle + 1, total: total }),
      oninput: function (ev) { seekCycle(parseInt(ev.target.value, 10)); }
    });
    scrub.appendChild(range);
    host.appendChild(scrub);

    var speedSeg = el('div', { 'class': 'cg-seg', role: 'group', 'aria-label': t('arena.control.speed') });
    [[0.5, 'arena.control.speed_slow'], [1, 'arena.control.speed_normal'], [2, 'arena.control.speed_fast']]
      .forEach(function (pair) {
        speedSeg.appendChild(el('button', {
          'class': 'cg-seg__btn', type: 'button', text: t(pair[1]),
          'aria-pressed': state.speed === pair[0] ? 'true' : 'false',
          onclick: function () {
            state.speed = pair[0];
            arenaSpeed(lab.arena, state.speed);
            if (state.playing) { stopClock(); startClock(); }
            renderTransport();
          }
        }));
      });
    host.appendChild(speedSeg);

    var cyc = cycles[state.cycle];
    host.appendChild(el('span', {
      'class': 'cg-transport__clock',
      text: t('arena.control.progress', { n: state.cycle + 1, total: total }) +
        (cyc ? ' - ' + t('arena.hud.tick') + ' ' + cyc.tick : '')
    }));
  }

  function renderCycleReadout() {
    var host = $('cg-cycle-readout');
    if (!host) { return; }
    clear(host);
    var ep = currentEpisode();
    var cyc = currentCycle();
    var progress = $('cg-cycle-progress');
    if (!ep || !cyc) {
      if (progress) { progress.textContent = ''; }
      host.appendChild(el('dt', { text: t('empty.no_cycles') }));
      return;
    }
    if (progress) {
      progress.textContent = t('arena.control.progress', {
        n: state.cycle + 1, total: (ep.cycles || []).length
      });
    }

    var sc = scenarioOf(ep) || {};
    var rows = [];
    rows.push([t('lab.col.tick'), String(cyc.tick)]);
    rows.push([t('lab.col.engage_tick'), t('arena.hud.engage_tick', { tick: cyc.engage_tick })]);
    rows.push([t('arena.hud.heat'), fmtNum(cyc.obs_heat, 4)]);
    rows.push([t('arena.hud.heat_delta'), fmtNum(cyc.obs_heat_delta, 4)]);
    rows.push([t('arena.hud.ticks_left'), String(cyc.obs_ticks_remaining)]);
    rows.push([t('lab.col.engaged'), fmtNum(cyc.held.ax, 2) + ' / ' + fmtNum(cyc.held.ay, 2)]);
    rows.push([t('lab.col.action'), cyc.engaged
      ? fmtNum(cyc.engaged.ax, 2) + ' / ' + fmtNum(cyc.engaged.ay, 2)
      : t('empty.value_missing')]);
    rows.push([t('lab.col.predicted'), cyc.predicted
      ? fmtNum(cyc.predicted.x, 2) + ' / ' + fmtNum(cyc.predicted.y, 2)
      : t('lab.no_prediction')]);
    rows.push([t('lab.col.truth'), cyc.truth_at_engage
      ? fmtNum(cyc.truth_at_engage.x, 2) + ' / ' + fmtNum(cyc.truth_at_engage.y, 2)
      : t('empty.value_missing')]);
    var cycReason = cycleUnmeasurableReason(cyc);
    rows.push([t('lab.col.error'), cyc.pred_pos_error_m === null || cyc.pred_pos_error_m === undefined
      ? unmeasurableText(cycReason)
      : fmtNum(cyc.pred_pos_error_m, 3) + ' ' + t('arena.unit.m')]);
    rows.push([t('metric.prediction_fidelity.abbr'), cyc.fidelity === null || cyc.fidelity === undefined
      ? unmeasurableText(cycReason)
      : fmtNum(cyc.fidelity, 3)]);
    rows.push([t('metric.persistence_floor.name'), fmtNum(cyc.persistence_fidelity, 3) || t('ui.na')]);
    rows.push([t('lab.col.retries'), String(cyc.parse_retries)]);
    rows.push([t('world.budget'), t('world.budget.value', { b: sc.deliberation_ticks })]);

    rows.forEach(function (row) { host.appendChild(readoutRow(row[0], row[1])); });

    /* Flags live beside the list, not inside it. Clear the previous pass first
       or they pile up one render at a time. */
    var flagHost = host.parentNode;
    $$('.cg-note', flagHost).forEach(function (old) { flagHost.removeChild(old); });
    if (cyc.parse_failed) { flagHost.appendChild(note(t('lab.parse_failed'), 'control')); }
    if (cyc.truncated) { flagHost.appendChild(note(t('lab.truncated'), 'control')); }
  }

  function renderRaw() {
    var host = $('cg-raw');
    if (!host) { return; }
    clear(host);
    var ep = currentEpisode();
    var cyc = currentCycle();
    if (!ep || !cyc) { host.appendChild(note(t('empty.no_cycles'))); return; }

    var completions = cyc.raw_completions || [];
    if (!completions.length) { host.appendChild(note(t('lab.raw.empty'))); return; }

    var labels = labelCompletions(ep.arm, completions, cyc);

    completions.forEach(function (text, i) {
      var info = labels[i] || { stageKey: 'lab.prompt.unknown', attempt: 1, attempts: 1, failed: false };
      var title = info.attempts > 1
        ? t('lab.prompt.attempt', { stage: t(info.stageKey), n: info.attempt })
        : t(info.stageKey);
      var parts = splitCompletion(text);
      var pre = el('pre');
      if (parts.before) { pre.appendChild(el('span', { 'class': 'cg-raw__noise', text: parts.before })); }
      if (parts.json) { pre.appendChild(el('span', { 'class': 'cg-raw__json', text: parts.json })); }
      if (parts.after) { pre.appendChild(el('span', { 'class': 'cg-raw__noise', text: parts.after })); }

      var details = el('details', { 'class': 'cg-raw', open: i === 0 ? true : null }, [
        el('summary', {}, [
          el('span', { 'class': 'cg-raw__chevron' }, [svgIcon('cg-chevron', 'cg-btn__icon')]),
          el('span', { text: title }),
          info.failed
            ? el('span', { 'class': 'cg-chip', 'data-kind': 'retry', text: t('lab.parse_failed') })
            : null
        ]),
        el('div', { 'class': 'cg-raw__body' }, [pre])
      ]);
      host.appendChild(details);
    });
  }

  function renderCyclesTable() {
    var host = $('cg-cycles-table');
    if (!host) { return; }
    clear(host);
    var ep = currentEpisode();
    if (!ep || !(ep.cycles || []).length) { host.appendChild(note(t('empty.no_cycles'))); return; }

    var rows = ep.cycles.map(function (c, i) {
      var tr = el('tr', { 'data-cycle': String(i), 'data-clickable': 'true', tabindex: '0', 'data-arm': ep.arm });
      if (i === state.cycle) { tr.setAttribute('aria-selected', 'true'); }
      tr.appendChild(el('th', { scope: 'row', 'class': 'cg-num', text: String(c.cycle) }));
      tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: String(c.tick) }));
      tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: String(c.engage_tick) }));
      tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: fmtNum(c.obs_heat, 4) }));
      tr.appendChild(el('td', { 'class': 'cg-num', text: c.predicted
        ? fmtNum(c.predicted.x, 1) + ' / ' + fmtNum(c.predicted.y, 1)
        : t('lab.no_prediction') }));
      tr.appendChild(el('td', { 'class': 'cg-num', text: c.truth_at_engage
        ? fmtNum(c.truth_at_engage.x, 1) + ' / ' + fmtNum(c.truth_at_engage.y, 1)
        : t('empty.value_missing') }));
      var reason = cycleUnmeasurableReason(c);
      tr.appendChild(numCell(c.pred_pos_error_m, 2, reason));
      tr.appendChild(numCell(c.fidelity, 3, reason));
      /* held drives the world right now; engaged was just returned and starts
         B ticks from now. The table used to print engaged under the "latched"
         header and never showed held at all, inverting the one distinction the
         benchmark exists to teach. */
      tr.appendChild(el('td', { 'class': 'cg-num', text: c.held
        ? fmtNum(c.held.ax, 2) + ' / ' + fmtNum(c.held.ay, 2)
        : t('empty.value_missing') }));
      tr.appendChild(el('td', { 'class': 'cg-num', text: c.engaged
        ? fmtNum(c.engaged.ax, 2) + ' / ' + fmtNum(c.engaged.ay, 2)
        : t('empty.value_missing') }));
      tr.appendChild(el('td', { 'data-type': 'num', 'class': 'cg-num', text: String(c.parse_retries) }));
      var flags = el('td');
      if (c.parse_failed) { flags.appendChild(el('span', { 'class': 'cg-chip', 'data-kind': 'retry', text: t('lab.parse_failed') })); }
      if (c.truncated) { flags.appendChild(el('span', { 'class': 'cg-chip', text: t('lab.truncated') })); }
      tr.appendChild(flags);
      return tr;
    });

    var tbl = table([
      { label: t('lab.col.cycle'), numeric: true },
      { label: t('lab.col.tick'), numeric: true },
      { label: t('lab.col.engage_tick'), numeric: true },
      { label: t('lab.col.heat'), numeric: true },
      { label: t('lab.col.predicted'), numeric: true },
      { label: t('lab.col.truth'), numeric: true },
      { label: t('lab.col.error'), numeric: true },
      { label: t('metric.prediction_fidelity.abbr'), numeric: true },
      { label: t('lab.col.engaged'), numeric: true },
      { label: t('lab.col.action'), numeric: true },
      { label: t('lab.col.retries'), numeric: true },
      { label: t('ui.details') }
    ], rows, t('lab.cycles.title'));

    function activate(ev) {
      var tr = ev.target.closest ? ev.target.closest('tr[data-cycle]') : null;
      if (!tr) { return; }
      if (ev.type === 'keydown') {
        if (ev.key !== 'Enter' && ev.key !== ' ') { return; }
        ev.preventDefault();
      }
      seekCycle(parseInt(tr.getAttribute('data-cycle'), 10));
    }
    tbl.addEventListener('click', activate);
    tbl.addEventListener('keydown', activate);
    host.appendChild(tbl);
  }

  function renderErrorChart() {
    var chartMount = $('cg-chart-error');
    var tableMount = $('cg-error-table');
    var ep = currentEpisode();
    if (!tableMount) { return; }
    clear(tableMount);
    if (!ep) { return; }

    var series = [ep];
    var other = overlayEpisode();
    if (state.overlay && other) { series.push(other); }

    var drawn = drawChart('error_over_time', chartMount, {
      bundle: bundle,
      episodeKey: ep.key,
      episodes: series,
      scenario: scenarioOf(ep),
      activeCycle: state.cycle,
      constants: (bundle && bundle.constants) || {},
      t: t
    });
    if (!drawn) {
      if (chartMount) { clear(chartMount); }
      tableMount.appendChild(note(t('shell.module_missing'), 'control'));
      var rows = [];
      series.forEach(function (e) {
        (e.cycles || []).forEach(function (c) {
          var reason = cycleUnmeasurableReason(c);
          rows.push(el('tr', { 'data-arm': e.arm }, [
            el('th', { scope: 'row', 'class': 'cg-mono', text: e.key }),
            el('td', { 'data-type': 'num', 'class': 'cg-num', text: String(c.tick) }),
            numCell(c.pred_pos_error_m, 2, reason),
            numCell(c.fidelity, 3, reason),
            numCell(c.persistence_fidelity, 4, reason)
          ]));
        });
      });
      tableMount.appendChild(el('div', { 'class': 'cg-tablewrap' }, [
        table([
          { label: t('results.col.log') },
          { label: t('arena.axis.tick'), numeric: true },
          { label: t('arena.axis.error'), numeric: true },
          { label: t('metric.prediction_fidelity.abbr'), numeric: true },
          { label: t('metric.persistence_floor.name'), numeric: true }
        ], rows)
      ]));
    }
  }

  function renderLab() {
    var stage = $('cg-lab-stage');
    var empty = $('cg-lab-empty');
    var ep = currentEpisode();
    if (empty) { clear(empty); }

    if (!ep) {
      if (stage) { stage.style.display = 'none'; }
      if (empty) { empty.appendChild(note(t(episodes().length ? 'empty.no_episodes' : 'empty.no_data'))); }
      return;
    }
    if (stage) { stage.style.display = ''; }

    var sc = scenarioOf(ep);
    var titleNode = $('cg-lab-episode-title');
    if (titleNode) { titleNode.textContent = scenarioLabel(ep.scenario_id); }
    var noteNode = $('cg-lab-episode-note');
    if (noteNode) {
      clear(noteNode);
      noteNode.appendChild(el('span', { 'class': 'cg-mono', text: ep.key }));
      noteNode.appendChild(document.createTextNode(' '));
      noteNode.appendChild(outcomeChip(ep.outcome));
      noteNode.appendChild(document.createTextNode(' '));
      noteNode.appendChild(el('span', {
        text: t('outcome.closest') + ' ' + fmtNum(ep.closest_approach_m, 2) + ' ' + t('arena.unit.m') +
          ' - ' + t('outcome.at_tick', { tick: ep.final_tick })
      }));
      if (sc) {
        noteNode.appendChild(document.createTextNode(' - '));
        noteNode.appendChild(el('span', { text: t('scenario.' + ep.scenario_id + '.desc') }));
      }
    }

    var mount = $('cg-lab-arena');
    if (mount && !panelActive('lab')) {
      /* Hidden tab: keep the still frame, build the live arena on first show. */
      mount.setAttribute('data-arm', ep.arm);
      if (!lab.arena) { renderFrame(mount, ep, sc, state.cycle); }
      mount = null;
    }
    if (mount) {
      mount.setAttribute('data-arm', ep.arm);
      if (lab.arena) {
        arenaSetEpisode(lab.arena, ep, sc, { reveal: state.reveal, overlay: state.overlay ? overlayEpisode() : null });
      } else {
        lab.arena = createArena(arenaCanvas(mount), {
          episode: ep, scenario: sc, bundle: bundle, t: t, mode: 'lab',
          loop: false, autoplay: false, speed: state.speed,
          /* The shell owns the transport row below the arena. */
          timeline: false,
          onFrame: function (frame) {
            if (!frame) { return; }
            if (typeof frame.cycle === 'number' && frame.cycle !== state.cycle) {
              state.cycle = frame.cycle;
              renderCycleReadout();
              renderRaw();
              renderTransport();
            }
            if (typeof frame.playing === 'boolean') { state.playing = frame.playing; }
          }
        });
      }
      /* Still frame first, explanation second: renderFrame() clears the mount,
         so a note appended before it would be wiped in the same pass. */
      if (!lab.arena) {
        renderFrame(mount, ep, sc, state.cycle);
        arenaNote(mount, t('shell.module_missing'));
      } else {
        clearArenaNote(mount);
      }
      arenaReveal(lab.arena, state.reveal);
      arenaOverlay(lab.arena, state.overlay ? overlayEpisode() : null);
    }
    renderFrame($('cg-lab-frame'), ep, sc, state.cycle);

    renderLegend($('cg-lab-legend'), demoLegendItems(ep.arm).concat([
      { shape: 'line', role: 'wind', label: 'arena.legend.wind', caption: 'arena.caption.wind' },
      { shape: 'dash', role: 'deadline', label: 'arena.legend.deadline', caption: 'arena.caption.deadline' },
      sc && sc.goal_visible === false
        ? { shape: 'ring', role: 'goal', label: 'arena.legend.goal_hidden', caption: 'arena.caption.goal_hidden' }
        : null,
      ep.variant === 'decoy'
        ? { shape: 'ring', role: 'goal', label: 'arena.legend.decoy', caption: 'arena.caption.decoy' }
        : null
    ].filter(Boolean)));

    lab.built = panelActive('lab');
    labSelectOptions();
    renderTransport();
    renderCycleReadout();
    renderRaw();
    renderCyclesTable();
    renderErrorChart();
  }

  /* ---- playback --------------------------------------------------------- */

  function beatMs() {
    var raw = '';
    try {
      raw = window.getComputedStyle(document.documentElement).getPropertyValue('--dur-beat');
    } catch (e) { raw = ''; }
    var parsed = parseFloat(raw);
    if (!parsed || parsed !== parsed) { parsed = 700; }
    if (/ms\s*$/.test(raw) === false && /s\s*$/.test(raw)) { parsed = parsed * 1000; }
    return Math.max(parsed / (state.speed || 1), 60);
  }

  function startClock() {
    stopClock();
    var ep = currentEpisode();
    if (!ep || !(ep.cycles || []).length) { return; }
    clock.timer = window.setInterval(function () {
      var total = (currentEpisode().cycles || []).length;
      var next = state.cycle + 1;
      if (next >= total) { next = 0; }
      seekCycle(next, true);
    }, beatMs());
  }

  function stopClock() {
    if (clock.timer) { window.clearInterval(clock.timer); clock.timer = null; }
  }

  function togglePlay(force) {
    var ep = currentEpisode();
    if (!ep) { return; }
    state.playing = force === undefined ? !state.playing : !!force;
    if (state.playing) {
      arenaPlay(lab.arena);
      if (!lab.arena) { startClock(); }
    } else {
      arenaPause(lab.arena);
      stopClock();
    }
    renderTransport();
  }

  function seekCycle(index, fromClock) {
    var ep = currentEpisode();
    if (!ep) { return; }
    var total = (ep.cycles || []).length;
    if (!total) { return; }
    state.cycle = clamp(index, 0, total - 1);
    if (!fromClock) { arenaSeekCycle(lab.arena, state.cycle); }
    if (!lab.arena) { renderFrame($('cg-lab-arena'), ep, scenarioOf(ep), state.cycle); }
    renderFrame($('cg-lab-frame'), ep, scenarioOf(ep), state.cycle);
    renderTransport();
    renderCycleReadout();
    renderRaw();
    renderCyclesTable();
    renderErrorChart();
  }

  /* ======================================================================
     14. Routing, tabs, language, theme
     ====================================================================== */

  /** Build whichever arena has just become visible; both are deferred. */
  function ensureArenas() {
    if (panelActive('what') && demo.pending) { startDemo(); }
    if (panelActive('lab') && !lab.built) { renderLab(); }
  }

  function setTab(tab, options) {
    var next = normalizeTab(tab);
    state.tab = next;
    TABS.forEach(function (name) {
      var btn = $('cg-tab-' + name);
      var panel = $('cg-panel-' + name);
      var active = name === next;
      if (btn) {
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        btn.setAttribute('tabindex', active ? '0' : '-1');
      }
      if (panel) {
        if (active) { panel.setAttribute('data-state', 'active'); }
        else { panel.removeAttribute('data-state'); }
      }
    });
    if (next !== 'lab') { togglePlay(false); }
    guard('arenas', ensureArenas);
    if (!options || !options.silent) { syncHash(); }
    if (options && options.focus) {
      var btnToFocus = $('cg-tab-' + next);
      if (btnToFocus) { btnToFocus.focus(); }
    }
  }

  function setEpisode(key) {
    var ep = episodeByKey(key);
    if (!ep) {
      var first = episodes()[0];
      ep = first || null;
    }
    state.episodeKey = ep ? ep.key : null;
    state.cycle = 0;
    state.playing = false;
    stopClock();
    if (lab.arena) { arenaDestroy(lab.arena); lab.arena = null; }
    lab.built = false;
    var mount = $('cg-lab-arena');
    if (mount) { clear(mount); }
    renderLab();
    renderResultsTable();
    syncHash();
  }

  function openInLab(key) {
    setEpisode(key);
    setTab('lab');
    var panel = $('cg-panel-lab');
    if (panel && panel.scrollIntoView) { panel.scrollIntoView({ block: 'start' }); }
  }

  function syncHash() {
    var next = buildHash(state.tab, state.tab === 'lab' ? state.episodeKey : null);
    if (window.location.hash === next) { return; }
    routing.silent = true;
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', next);
      } else {
        window.location.hash = next;
      }
    } catch (e) {
      window.location.hash = next;
    }
    window.setTimeout(function () { routing.silent = false; }, 0);
  }

  function applyHash() {
    var parsed = parseHash(window.location.hash);
    if (parsed.episode && parsed.episode !== state.episodeKey) {
      setEpisode(parsed.episode);
    }
    setTab(parsed.tab, { silent: true });
  }

  function setLang(next) {
    lang = LANGS.indexOf(next) !== -1 ? next : DEFAULT_LANG;
    var dicts = (typeof window.STRINGS === 'object' && window.STRINGS) || null;
    t = makeT(dicts ? dicts[lang] : null, dicts ? dicts[DEFAULT_LANG] : null);
    App.t = t;
    document.documentElement.setAttribute('lang', lang);
    storeSet('cg.lang', lang);
    syncChartsLanguage();
    renderAll();
  }

  /** The chart module keeps its own dictionary handle; keep it in step. */
  function syncChartsLanguage() {
    var C = window.Charts;
    if (C && typeof C.setLanguage === 'function') {
      try { C.setLanguage(lang); } catch (e) { /* optional */ }
    }
  }

  /**
   * The colour-independent encoding: bars gain a directional hatch so the two
   * arms stay separable without colour. In the light theme the two arm colours
   * sit within 2% of each other in relative luminance, so in print or on a
   * monochrome display they are the same grey - the hatch is the only thing
   * that tells the arms apart there.
   *
   * CSS cannot set an attribute, so this has to be driven from script; without
   * it [data-texture="on"] was unreachable and the whole encoding was dead.
   */
  function applyTexture() {
    var on = false;
    try {
      if (window.matchMedia) {
        on = window.matchMedia('(forced-colors: active)').matches ||
          window.matchMedia('(prefers-contrast: more)').matches ||
          window.matchMedia('print').matches;
      }
    } catch (e) { on = false; }
    var root = document.documentElement;
    if (on) { root.setAttribute('data-texture', 'on'); }
    else { root.removeAttribute('data-texture'); }
  }

  function bindTexture() {
    applyTexture();
    var queries = ['(forced-colors: active)', '(prefers-contrast: more)'];
    queries.forEach(function (q) {
      try {
        var mq = window.matchMedia && window.matchMedia(q);
        if (!mq) { return; }
        if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', applyTexture); }
        else if (typeof mq.addListener === 'function') { mq.addListener(applyTexture); }
      } catch (e) { /* optional */ }
    });
    /* Print is a state, not a query the page can poll while it lasts. */
    if (window.addEventListener) {
      window.addEventListener('beforeprint', function () {
        document.documentElement.setAttribute('data-texture', 'on');
      }, false);
      window.addEventListener('afterprint', applyTexture, false);
    }
  }

  /**
   * A closed <details> cannot be revealed by a print stylesheet, so paper would
   * silently lose the long half of the explainer.  Open every disclosure before
   * printing and restore whatever the reader had chosen afterwards.  Safari has
   * historically skipped beforeprint, hence the media-query path as well.
   */
  function installPrintDisclosure() {
    var reopened = [];
    function expand() {
      reopened = [];
      var nodes = document.querySelectorAll('details');
      for (var i = 0; i < nodes.length; i += 1) {
        if (!nodes[i].open) { reopened.push(nodes[i]); nodes[i].open = true; }
      }
    }
    function restore() {
      reopened.forEach(function (node) { node.open = false; });
      reopened = [];
    }
    if (window.addEventListener) {
      window.addEventListener('beforeprint', expand, false);
      window.addEventListener('afterprint', restore, false);
    }
    try {
      var mq = window.matchMedia && window.matchMedia('print');
      if (!mq) { return; }
      var onChange = function (event) { if (event.matches) { expand(); } else { restore(); } };
      if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', onChange); }
      else if (typeof mq.addListener === 'function') { mq.addListener(onChange); }
    } catch (e) { /* optional */ }
  }

  function setTheme(next) {
    var theme = next === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    storeSet('cg.theme', theme);
    renderChrome();
  }

  /* ======================================================================
     15. Events
     ====================================================================== */

  function isTypingTarget(node) {
    if (!node) { return false; }
    var tag = (node.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'select' || tag === 'textarea' || node.isContentEditable === true;
  }

  function bindEvents() {
    $$('#cg-tabs [data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); });
    });

    var tabs = $('cg-tabs');
    if (tabs) {
      tabs.addEventListener('keydown', function (ev) {
        var order = TABS;
        var i = order.indexOf(state.tab);
        if (ev.key === 'ArrowRight') { ev.preventDefault(); setTab(order[(i + 1) % order.length], { focus: true }); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); setTab(order[(i - 1 + order.length) % order.length], { focus: true }); }
        else if (ev.key === 'Home') { ev.preventDefault(); setTab(order[0], { focus: true }); }
        else if (ev.key === 'End') { ev.preventDefault(); setTab(order[order.length - 1], { focus: true }); }
      });
    }

    $$('[data-goto-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.getAttribute('data-goto-tab')); });
    });

    $$('#cg-lang [data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () { setLang(btn.getAttribute('data-lang')); });
    });

    var themeBtn = $('cg-theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var isLight = document.documentElement.getAttribute('data-theme') === 'light';
        setTheme(isLight ? 'dark' : 'light');
      });
    }

    var keysBtn = $('cg-keys-btn');
    if (keysBtn) { keysBtn.addEventListener('click', function () { toggleKeys(); }); }

    var errClose = $('cg-errorbar-close');
    if (errClose) {
      errClose.addEventListener('click', function () {
        var bar = $('cg-errorbar');
        if (bar) { bar.removeAttribute('data-state'); }
      });
    }

    window.addEventListener('hashchange', function () {
      if (routing.silent) { return; }
      applyHash();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) { return; }
      if (ev.key === 'Escape' && state.keysOpen) { toggleKeys(false); return; }
      if (isTypingTarget(ev.target)) { return; }

      if (ev.key === '1' || ev.key === '2' || ev.key === '3') {
        ev.preventDefault();
        setTab(TABS[parseInt(ev.key, 10) - 1], { focus: true });
        return;
      }
      if (state.tab !== 'lab') { return; }
      if (ev.target && ev.target.closest && ev.target.closest('#cg-tabs')) { return; }

      if (ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); togglePlay(); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); seekCycle(state.cycle + 1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); seekCycle(state.cycle - 1); }
      else if (ev.key === 'Home') { ev.preventDefault(); seekCycle(0); }
      else if (ev.key === 'End') {
        ev.preventDefault();
        var ep = currentEpisode();
        seekCycle(ep ? (ep.cycles || []).length - 1 : 0);
      }
    });

    if (window.matchMedia) {
      try {
        var mql = window.matchMedia('print');
        if (mql.addListener) { mql.addListener(function (m) { if (m.matches) { togglePlay(false); } }); }
      } catch (e) { /* optional */ }
    }
    window.addEventListener('beforeprint', function () { togglePlay(false); });
    installPrintDisclosure();
  }

  /* ======================================================================
     16. Render entry points
     ====================================================================== */

  function renderAll() {
    guard('chrome', renderChrome);
    guard('static', function () { applyStaticStrings(document); });
    guard('footer', renderFooter);
    guard('world', renderWorldFacts);
    guard('armCards', renderArmCards);
    guard('axisCards', renderAxisCards);
    guard('demoTitle', paintDemoTitle);
    guard('demoLegend', function () {
      if (demo.episode) { renderLegend($('cg-demo-legend'), demoLegendItems(demo.episode.arm)); }
    });
    /* After the legend, never before: the caption marks the legend item it is
       describing, and a legend rebuilt afterwards would drop the mark. */
    guard('demoCaption', paintDemoCaption);
    guard('findings', renderFindings);
    guard('metricCards', renderMetricCards);
    guard('armComparison', renderArmComparison);
    guard('filters', renderFilters);
    guard('resultsTable', renderResultsTable);
    guard('feedback', renderFeedback);
    guard('controlTable', renderControlTable);
    guard('probes', renderProbes);
    guard('refs', renderRefs);
    guard('lab', renderLab);
  }

  function readBundle() {
    /* The build script may name the data island either way; accept both. */
    var node = document.getElementById('bundle') || document.getElementById('cg-bundle');
    if (!node) { throw new Error('bundle element missing'); }
    var parsed = JSON.parse(node.textContent);
    if (!parsed || typeof parsed !== 'object' || !parsed.episodes) {
      throw new Error('bundle shape invalid');
    }
    return parsed;
  }

  function init() {
    try {
      bundle = readBundle();
    } catch (e) {
      bundle = { meta: {}, scenarios: {}, episodes: [], arms: {}, feedback: [], feedback_summary: [], probes: [], constants: {}, baselines: {} };
      reportError(e);
    }
    window.BUNDLE = bundle;

    var stored = storeGet('cg.lang');
    var navLangs = [];
    try {
      navLangs = (window.navigator && (window.navigator.languages ||
        [window.navigator.language || window.navigator.userLanguage])) || [];
    } catch (e) { navLangs = []; }
    lang = pickLang(stored, navLangs, LANGS);

    var storedTheme = storeGet('cg.theme');
    document.documentElement.setAttribute('data-theme', storedTheme === 'light' ? 'light' : 'dark');

    var stringsTable = (typeof window.STRINGS === 'object' && window.STRINGS) || null;
    t = makeT(stringsTable ? stringsTable[lang] : null, stringsTable ? stringsTable[DEFAULT_LANG] : null);
    App.t = t;
    document.documentElement.setAttribute('lang', lang);
    syncChartsLanguage();
    if (!stringsTable) { reportError(new Error('STRINGS table missing')); }

    var initial = parseHash(window.location.hash);
    var wanted = initial.episode && episodeByKey(initial.episode) ? initial.episode : null;
    if (!wanted) {
      var demoPick = pickDemoEpisode(episodes(), scenarios());
      wanted = demoPick ? demoPick.key : null;
    }
    state.episodeKey = wanted;

    bindEvents();
    bindTexture();
    guard('demo', startDemo);
    renderAll();
    setTab(initial.tab, { silent: true });
    syncHash();
  }

  /* ======================================================================
     17. Public surface
     ====================================================================== */

  var App = {
    init: init,
    t: function (key, params) { return t(key, params); },
    reportError: reportError,
    getState: function () { return state; },
    getBundle: function () { return bundle; },
    setTab: setTab,
    openInLab: openInLab,
    setLang: setLang,
    setTheme: setTheme,
    _pure: PURE
  };

  if (typeof window !== 'undefined') {
    window.App = App;
    window.T = function (key, params) { return App.t(key, params); };
  }
})();
