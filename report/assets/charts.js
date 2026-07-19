/*
 * DelibraShift visualization - charts and tables.
 *
 * Exposes one global: window.Charts. Plain <script>, ES5-safe, no modules,
 * no imports, no dependencies. Every chart is inline SVG built as a string
 * and mounted with innerHTML, so it scales, prints sharply and needs no
 * layout observer.
 *
 * CONTRACT
 *   - No user-visible string lives here. Everything goes through t(key),
 *     which reads window.App.t first and falls back to window.STRINGS.
 *   - No colour value lives here. Arm colour comes from [data-arm] subtrees
 *     (see tokens.css); every other colour is a var(--token) in an inline
 *     style, because CSS custom properties do not work in SVG presentation
 *     attributes.
 *   - null is never drawn as 0. A missing measurement renders as an explicit
 *     "unmeasurable" state carrying the reason string (spec/METRICS.md W1).
 *   - No metric is recomputed from raw logs (spec/METRICS.md W19). The only
 *     derived quantities are: means/min/max over episode scores the extractor
 *     already computed, a euclidean position distance for the persistence
 *     reference line, and the unreachable outcome band, which follows from
 *     goal_radius and HEAT_SCALE_M.
 *   - No error bars, no confidence intervals, no significance (W6). Whiskers
 *     are min-max across measured scenario x repetition cells.
 *
 * Public API, all render into containerEl and return it:
 *   Charts.verdict(el, bundle, opts)
 *   Charts.scenarioTable(el, bundle, opts)         opts.onSelect(episodeKey)
 *   Charts.predictionError(el, bundle, episodeKey|opts, opts)
 *   Charts.feedbackPairs(el, bundle, opts)
 *   Charts.controls(el, bundle, opts)
 *   Charts.probes(el, bundle, opts)
 *   Charts._pure                                   pure helpers, DOM-free
 *
 * Shared opts: {chrome: false} drops the .cg-panel wrapper when the shell
 * supplies its own panel; {lang: "en"} forces a dictionary.
 */
(function (global) {
  'use strict';

  /* ==========================================================================
     0. Scale properties. These are properties of the metric definitions
        (spec/METRICS.md 2.4, 3c), not measured values, and no measured number
        appears anywhere in this file.
     ========================================================================== */

  var ARMS = ['end2end', 'wm-scaffold'];
  var AXES = ['prediction_fidelity', 'temporal_anticipation', 'feedback_use', 'outcome'];
  var CONTROL_METRICS = [
    'action_parse_rate', 'prediction_parse_rate', 'prediction_coverage', 'retried_cycle_rate'
  ];
  var LOWER_IS_BETTER = { retried_cycle_rate: true };
  /* 0.5 is the origin of a two-sided scale, not the middle of a quality range. */
  var NO_EFFECT_ORIGIN = { temporal_anticipation: 0.5, feedback_use: 0.5 };
  var UNIT_INTERVAL = [0, 1];
  /* A coverage gap this wide makes a fidelity comparison a formatting result. */
  var COVERAGE_GUARD = 0.05;
  var ARM_STRING = { 'end2end': 'arm.end2end', 'wm-scaffold': 'arm.wm_scaffold' };
  var OUTCOME_ICON = { goal: 'cg-out-goal', oob: 'cg-out-oob', timeout: 'cg-out-timeout' };

  /* ==========================================================================
     1. Pure helpers. No DOM, no globals, no strings table. Exposed as
        Charts._pure so tests/test_charts_pure.js can drive them in node.
     ========================================================================== */

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function clamp(v, lo, hi) {
    if (!isNum(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /** Format a number for display, or null when there is nothing to format. */
  function fmt(v, digits) {
    if (!isNum(v)) return null;
    return v.toFixed(digits === undefined || digits === null ? 4 : digits);
  }

  /** Format an integer count; null stays null. */
  function fmtInt(v) {
    if (!isNum(v)) return null;
    return String(Math.round(v));
  }

  /** Absolute difference of two values, null if either side is missing. */
  function diff(a, b) {
    if (!isNum(a) || !isNum(b)) return null;
    return Math.abs(a - b);
  }

  /** Map a value from a data domain onto a pixel range. */
  function scaleLinear(v, d0, d1, r0, r1, doClamp) {
    if (!isNum(v)) return null;
    var span = d1 - d0;
    var out = span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0);
    if (doClamp) {
      var lo = Math.min(r0, r1), hi = Math.max(r0, r1);
      out = clamp(out, lo, hi);
    }
    return out;
  }

  /** A round-ish step for an axis: 1, 2, 2.5 or 5 times a power of ten. */
  function niceStep(span, target) {
    if (!(span > 0)) return 1;
    var raw = span / (target || 5);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : (norm <= 2 ? 2 : (norm <= 2.5 ? 2.5 : (norm <= 5 ? 5 : 10)));
    return step * mag;
  }

  /** Axis ticks covering [lo, hi] inclusive, plus the rounded-up ceiling. */
  function niceTicks(lo, hi, target) {
    if (!isNum(lo)) lo = 0;
    if (!isNum(hi) || hi <= lo) hi = lo + 1;
    var step = niceStep(hi - lo, target);
    var top = Math.ceil(hi / step) * step;
    var out = [];
    for (var i = 0; ; i++) {
      var v = Math.round((Math.ceil(lo / step) * step + i * step) * 1e9) / 1e9;
      if (v > top + 1e-9) break;
      out.push(v);
      if (out.length > 200) break;
    }
    return { ticks: out, max: top, step: step };
  }

  /**
   * Path of one horizontal bar, rounded on the growing end only.
   * Returns "" for a non-positive width: a bar that is not there is not drawn.
   */
  function barPath(x, y, w, h, r) {
    if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h) || w <= 0 || h <= 0) return '';
    var rad = Math.min(isNum(r) ? r : 2, h / 2, w / 2);
    var q = function (v) { return round(v, 2); };
    if (rad <= 0) {
      return 'M' + q(x) + ',' + q(y) + 'H' + q(x + w) + 'V' + q(y + h) + 'H' + q(x) + 'Z';
    }
    return 'M' + q(x) + ',' + q(y) +
      'H' + q(x + w - rad) +
      'Q' + q(x + w) + ',' + q(y) + ' ' + q(x + w) + ',' + q(y + rad) +
      'V' + q(y + h - rad) +
      'Q' + q(x + w) + ',' + q(y + h) + ' ' + q(x + w - rad) + ',' + q(y + h) +
      'H' + q(x) + 'Z';
  }

  /**
   * Polyline path through [{x, y}], broken wherever a point is missing. A gap
   * is a gap: a missing measurement never gets interpolated across.
   */
  function linePath(points) {
    var d = '', pen = false, i, p;
    for (i = 0; i < (points || []).length; i++) {
      p = points[i];
      if (!p || !isNum(p.x) || !isNum(p.y)) { pen = false; continue; }
      d += (pen ? ' L' : (d ? ' M' : 'M')) + round(p.x, 2) + ',' + round(p.y, 2);
      pen = true;
    }
    return d;
  }

  function round(v, digits) {
    var f = Math.pow(10, digits || 0);
    return Math.round(v * f) / f;
  }

  /** mean/min/max/n over the finite values only; null when nothing is finite. */
  function aggregate(values) {
    var kept = [], i;
    for (i = 0; i < (values || []).length; i++) {
      if (isNum(values[i])) kept.push(values[i]);
    }
    if (!kept.length) return null;
    var sum = 0, min = kept[0], max = kept[0];
    for (i = 0; i < kept.length; i++) {
      sum += kept[i];
      if (kept[i] < min) min = kept[i];
      if (kept[i] > max) max = kept[i];
    }
    return { mean: sum / kept.length, min: min, max: max, n: kept.length };
  }

  /**
   * Stable sort by a key function. Missing keys always sort last, in both
   * directions: "no measurement" is not a small value.
   */
  function sortRows(rows, keyFn, dir) {
    var mul = dir === 'desc' ? -1 : 1;
    var wrapped = (rows || []).map(function (r, i) {
      return { row: r, i: i, k: keyFn(r) };
    });
    wrapped.sort(function (a, b) {
      var an = a.k === null || a.k === undefined || (typeof a.k === 'number' && !isFinite(a.k));
      var bn = b.k === null || b.k === undefined || (typeof b.k === 'number' && !isFinite(b.k));
      if (an && bn) return a.i - b.i;
      if (an) return 1;
      if (bn) return -1;
      if (a.k < b.k) return -1 * mul;
      if (a.k > b.k) return 1 * mul;
      return a.i - b.i;
    });
    return wrapped.map(function (w) { return w.row; });
  }

  /** Replace {tokens} from a params object; unknown tokens are left alone. */
  function interpolate(text, params) {
    if (typeof text !== 'string' || !params) return text;
    return text.replace(/\{([a-z_]+)\}/g, function (whole, key) {
      var v = params[key];
      return (v === undefined || v === null) ? whole : String(v);
    });
  }

  function esc(v) {
    return String(v).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  function attrStr(map) {
    var out = '', k, v;
    for (k in map) {
      if (!map.hasOwnProperty(k)) continue;
      v = map[k];
      if (v === null || v === undefined || v === false || v === '') continue;
      if (v === true) { out += ' ' + k; continue; }
      out += ' ' + k + '="' + esc(v) + '"';
    }
    return out;
  }

  /** Element as a string. inner === null produces a self-closing tag. */
  function el(name, map, inner) {
    var head = '<' + name + attrStr(map || {});
    if (inner === null || inner === undefined) return head + '/>';
    return head + '>' + inner + '</' + name + '>';
  }

  /* ---- episode selection and aggregation --------------------------------- */

  function scenarioOf(bundle, id) {
    return (bundle && bundle.scenarios && bundle.scenarios[id]) || {};
  }

  /**
   * Episodes in a comparison scope.
   *   "visible" - subset S: goal visible, not a probe, true heat. The only
   *               scope comparable to the published deterministic references
   *               (spec/METRICS.md W8).
   *   "all"     - every non-probe true-heat flight, masked scenarios included.
   *   "decoy"   - the decoy-heat twins.
   */
  function scopeEpisodes(bundle, scope) {
    var out = [], eps = (bundle && bundle.episodes) || [], i, e, s;
    for (i = 0; i < eps.length; i++) {
      e = eps[i];
      s = scenarioOf(bundle, e.scenario_id);
      if (s.is_probe) continue;
      if (scope === 'decoy') {
        if (e.variant !== 'decoy') continue;
      } else if (e.variant !== 'normal') {
        continue;
      }
      if (scope === 'visible' && s.goal_visible === false) continue;
      out.push(e);
    }
    return out;
  }

  /** Score of one episode: scores.* first, then episode-level fields. */
  function episodeValue(ep, metric) {
    if (!ep) return null;
    if (ep.scores && ep.scores[metric] !== undefined) return ep.scores[metric];
    if (ep[metric] !== undefined && typeof ep[metric] !== 'object') return ep[metric];
    return null;
  }

  function repetitions(episodes) {
    var seen = {}, out = [], i, r;
    for (i = 0; i < episodes.length; i++) {
      r = episodes[i].repetition;
      if (!seen[r]) { seen[r] = true; out.push(r); }
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /**
   * Range of one metric for one arm. Pack-level metrics come from the
   * extractor's own blocks; episode-level metrics are averaged over the scope.
   * With scope "all" the extractor already published the same aggregate, so it
   * is used verbatim.
   */
  function armMetric(bundle, arm, metric, scope) {
    if (metric === 'feedback_use' || metric === 'feedback_raw' || metric === 'feedback_band') {
      var row = feedbackSummaryFor(bundle, arm);
      if (!row) return null;
      var v = row[metric];
      return isNum(v) ? { mean: v, min: v, max: v, n: row.n_pairs } : null;
    }
    if (scope === 'all' && bundle && bundle.arms && bundle.arms[arm]) {
      var pre = bundle.arms[arm][metric];
      if (pre && isNum(pre.mean)) return pre;
    }
    var eps = scopeEpisodes(bundle, scope).filter(function (e) { return e.arm === arm; });
    return aggregate(eps.map(function (e) { return episodeValue(e, metric); }));
  }

  /**
   * Arm statistics restricted to scenario x repetition cells measurable in
   * both arms. The optional supportMetric lets a companion value use exactly
   * the cells selected by the primary metric.
   */
  function pairedMetric(bundle, metric, scope, supportMetric) {
    var cells = {}, required = supportMetric || metric;
    scopeEpisodes(bundle, scope).forEach(function (ep) {
      var value = episodeValue(ep, metric);
      var support = episodeValue(ep, required);
      if (!isNum(value) || !isNum(support)) return;
      var id = ep.scenario_id + '|r' + ep.repetition;
      if (!cells[id]) cells[id] = {};
      cells[id][ep.arm] = value;
    });
    var values = { 'end2end': [], 'wm-scaffold': [] };
    Object.keys(cells).forEach(function (id) {
      var row = cells[id];
      if (!isNum(row['end2end']) || !isNum(row['wm-scaffold'])) return;
      ARMS.forEach(function (arm) { values[arm].push(row[arm]); });
    });
    return {
      n: values['end2end'].length,
      arms: {
        'end2end': aggregate(values['end2end']),
        'wm-scaffold': aggregate(values['wm-scaffold'])
      }
    };
  }

  function pairedDelta(bundle, metric, scope) {
    var paired = pairedMetric(bundle, metric, scope);
    var a = paired.arms['end2end'], b = paired.arms['wm-scaffold'];
    if (!a || !b) return null;
    return { value: b.mean - a.mean, n: paired.n };
  }

  /** Mandatory context for a temporal aggregate (spec/METRICS.md W4). */
  function temporalSupport(bundle, arm, scope, noRetry) {
    var scoreKey = noRetry ? 'temporal_no_retry' : 'temporal_anticipation';
    var weightKey = noRetry ? 'temporal_no_retry_mean_divergence_weight' : 'mean_divergence_weight';
    var cyclesKey = noRetry ? 'temporal_no_retry_n_scored_cycles' : 'temporal_n_scored_cycles';
    var selected = scopeEpisodes(bundle, scope).filter(function (ep) {
      return ep.arm === arm && isNum(episodeValue(ep, scoreKey));
    });
    var weights = aggregate(selected.map(function (ep) { return episodeValue(ep, weightKey); }));
    var cycles = 0;
    selected.forEach(function (ep) {
      var value = episodeValue(ep, cyclesKey);
      if (isNum(value)) cycles += value;
    });
    return { n: selected.length, cycles: cycles, meanWeight: weights ? weights.mean : null };
  }

  function cycleSupport(bundle, arm, metric, cyclesMetric, scope) {
    var selected = scopeEpisodes(bundle, scope).filter(function (ep) {
      return ep.arm === arm && isNum(episodeValue(ep, metric));
    });
    var cycles = 0;
    selected.forEach(function (ep) {
      var value = episodeValue(ep, cyclesMetric);
      if (isNum(value)) cycles += value;
    });
    return { n: selected.length, cycles: cycles };
  }

  function feedbackSummaryFor(bundle, arm) {
    var rows = (bundle && bundle.feedback_summary) || [], i;
    for (i = 0; i < rows.length; i++) if (rows[i].arm === arm) return rows[i];
    return null;
  }

  /**
   * Why a metric has no value for this arm and scope. Two different nulls of
   * feedback_use are kept apart on purpose (spec/METRICS.md W13).
   */
  function nullReasonKey(bundle, arm, metric, scope) {
    var eps = scopeEpisodes(bundle, scope).filter(function (e) { return e.arm === arm; });
    var i, counts = {}, best = null, s;
    if (!eps.length) return 'empty.no_episodes';
    if (metric === 'feedback_use') {
      if (bundle && bundle.meta && bundle.meta.report_present === false) return 'reason.no_report';
      var band = armMetric(bundle, arm, 'feedback_band', scope);
      var minBand = bundle && bundle.constants ? bundle.constants.FEEDBACK_MIN_BAND : null;
      if (band && isNum(minBand) && band.mean < minBand) return 'reason.low_band';
      return 'reason.unknown';
    }
    if (metric === 'prediction_fidelity') {
      for (i = 0; i < eps.length; i++) {
        var r = eps[i].scores && eps[i].scores.fidelity_invalid_reason;
        if (!r) continue;
        counts[r] = (counts[r] || 0) + 1;
        if (best === null || counts[r] > counts[best]) best = r;
      }
      return best ? 'reason.' + best : 'reason.unknown';
    }
    if (metric === 'temporal_anticipation') {
      var allMasked = true;
      for (i = 0; i < eps.length; i++) {
        s = scenarioOf(bundle, eps[i].scenario_id);
        if (s.goal_visible !== false) allMasked = false;
      }
      return allMasked ? 'reason.masked_goal' : 'reason.no_scored_cycles';
    }
    return 'reason.unknown';
  }

  /**
   * The unreachable stretch of the outcome scale. With a goal radius of r a
   * failed flight caps at 0.4 * exp(-r / HEAT_SCALE) and a successful one
   * starts at 0.5 + that + nothing, so no episode can land in between
   * (spec/METRICS.md W9).
   */
  function outcomeGap(constants, goalRadiusM) {
    var scale = constants && isNum(constants.HEAT_SCALE_M) ? constants.HEAT_SCALE_M : null;
    if (!isNum(scale) || !isNum(goalRadiusM) || scale <= 0) return null;
    var lo = 0.4 * Math.exp(-goalRadiusM / scale);
    return { lo: lo, hi: 0.5 + lo };
  }

  /** Goal radius shared by the pack, or null when scenarios disagree. */
  function commonGoalRadius(bundle) {
    var scen = (bundle && bundle.scenarios) || {}, id, r = null;
    for (id in scen) {
      if (!scen.hasOwnProperty(id)) continue;
      if (!isNum(scen[id].goal_radius_m)) continue;
      if (r === null) r = scen[id].goal_radius_m;
      else if (Math.abs(r - scen[id].goal_radius_m) > 1e-9) return null;
    }
    return r;
  }

  /* ---- verdict model ------------------------------------------------------ */

  /** Reference rules for one metric, straight from bundle.baselines. */
  function refsFor(bundle, metric, scope) {
    var base = (bundle && bundle.baselines) || {};
    var refs = [], i, arm, floor;
    if (metric === 'outcome') {
      ['random', 'greedy', 'oracle'].forEach(function (name) {
        var v = base[name] ? base[name].outcome : null;
        if (isNum(v)) refs.push({ value: v, kind: 'baseline', name: name });
      });
    } else if (metric === 'temporal_anticipation') {
      ['random', 'greedy', 'oracle'].forEach(function (name) {
        var v = base[name] ? base[name].temporal : null;
        if (isNum(v)) refs.push({ value: v, kind: 'baseline', name: name });
      });
    } else if (metric === 'prediction_fidelity') {
      /* The reference is each arm's own persistence floor, never a fixed bar
         and never the oracle's definitional 1.0 (spec/METRICS.md 3a). */
      for (i = 0; i < ARMS.length; i++) {
        arm = ARMS[i];
        floor = pairedMetric(
          bundle, 'persistence_floor_fidelity', scope, 'prediction_fidelity'
        ).arms[arm];
        if (floor) refs.push({ value: floor.mean, kind: 'floor', arm: arm, armIndex: i });
      }
    }
    if (isNum(NO_EFFECT_ORIGIN[metric])) {
      refs.push({ value: NO_EFFECT_ORIGIN[metric], kind: 'origin' });
    }
    return refs;
  }

  /** One row per cognitive axis: two arm ranges, its references, its nulls. */
  function verdictModel(bundle, scope) {
    return AXES.map(function (metric) {
      var paired = metric === 'prediction_fidelity'
        ? pairedMetric(bundle, metric, scope)
        : null;
      var bars = ARMS.map(function (arm) {
        var stat = paired ? paired.arms[arm] : armMetric(bundle, arm, metric, scope);
        return {
          arm: arm,
          stat: stat,
          reasonKey: stat ? null : nullReasonKey(bundle, arm, metric, scope)
        };
      });
      var band = null;
      if (metric === 'outcome') band = outcomeGap(bundle.constants, commonGoalRadius(bundle));
      return { metric: metric, bars: bars, refs: refsFor(bundle, metric, scope), band: band };
    });
  }

  /**
   * The one-sentence verdict, generated from the data: who leads on how many
   * axes, the widest gap in numbers, the coverage guard when the widest gap is
   * a fidelity gap, and the repetition caveat. Returns [{key, params}] so the
   * wording stays in strings.js.
   */
  function buildSummary(bundle, scope) {
    var rows = verdictModel(bundle, scope);
    var measured = rows.filter(function (r) { return r.bars[0].stat && r.bars[1].stat; });
    if (!measured.length) return [{ key: 'verdict.summary.none', params: {} }];

    var wins = { 'end2end': 0, 'wm-scaffold': 0 }, gap = null;
    measured.forEach(function (r) {
      var a = r.bars[0].stat.mean, b = r.bars[1].stat.mean;
      if (a > b) wins['end2end']++;
      else if (b > a) wins['wm-scaffold']++;
      var d = diff(a, b);
      if (d !== null && (gap === null || d > gap.delta)) {
        gap = {
          metric: r.metric,
          delta: d,
          leader: a >= b ? ARMS[0] : ARMS[1],
          high: Math.max(a, b),
          low: Math.min(a, b)
        };
      }
    });

    var parts = [];
    var leader = wins['end2end'] === wins['wm-scaffold'] ? null :
      (wins['end2end'] > wins['wm-scaffold'] ? 'end2end' : 'wm-scaffold');
    if (leader) {
      parts.push({
        key: 'verdict.summary.lead',
        params: { arm: armName(leader), n: wins[leader], total: measured.length }
      });
    } else {
      parts.push({
        key: 'verdict.summary.split',
        params: { n: wins['end2end'], total: measured.length }
      });
    }
    if (gap && gap.delta > 0) {
      parts.push({
        key: 'verdict.summary.gap',
        params: {
          metric: t('metric.' + gap.metric + '.name'),
          arm: armName(gap.leader),
          value: fmt(gap.high, 4),
          other: fmt(gap.low, 4),
          delta: fmt(gap.delta, 4)
        }
      });
      if (gap.metric === 'prediction_fidelity') {
        var cA = armMetric(bundle, gap.leader, 'prediction_coverage', scope);
        var other = gap.leader === ARMS[0] ? ARMS[1] : ARMS[0];
        var cB = armMetric(bundle, other, 'prediction_coverage', scope);
        var cd = cA && cB ? diff(cA.mean, cB.mean) : null;
        if (cd !== null && cd > COVERAGE_GUARD) {
          parts.push({
            key: 'verdict.summary.coverage_guard',
            params: { value: fmt(cA.mean, 4), other: fmt(cB.mean, 4) }
          });
        }
      }
    }
    parts.push({
      key: 'verdict.summary.caveat',
      params: { n: repetitions(scopeEpisodes(bundle, scope)).length }
    });
    return parts;
  }

  /** Join the summary parts into one paragraph through a translate function. */
  function formatSummary(parts, translate) {
    var fn = translate || t;
    return (parts || []).map(function (p) {
      return interpolate(fn(p.key), p.params);
    }).join(' ');
  }

  /* ---- per-episode series ------------------------------------------------- */

  function episodeByKey(bundle, key) {
    var eps = (bundle && bundle.episodes) || [], i;
    for (i = 0; i < eps.length; i++) if (eps[i].key === key) return eps[i];
    return null;
  }

  function stateAtTick(trajectory, tick) {
    if (!trajectory || !trajectory.t) return null;
    var i = tick;
    if (trajectory.t[i] !== tick) {
      i = -1;
      for (var k = 0; k < trajectory.t.length; k++) {
        if (trajectory.t[k] === tick) { i = k; break; }
      }
    }
    if (i < 0 || i >= trajectory.t.length) return null;
    return {
      x: trajectory.x[i], y: trajectory.y[i],
      vx: trajectory.vx[i], vy: trajectory.vy[i]
    };
  }

  /**
   * Prediction error per cycle, in metres, next to the error the same cycle
   * would have produced by predicting "nothing changes". Both are euclidean
   * position distances to the same truth point; neither is a scorer metric.
   * Cycles with no measurable error carry a reason key instead of a value.
   */
  function errorSeries(episode) {
    if (!episode) return { points: [], max: 0, beats: 0, measured: 0, echoes: 0 };
    var pts = [], max = 0, beats = 0, measured = 0, echoes = 0;
    (episode.cycles || []).forEach(function (c) {
      var truth = c.truth_at_engage;
      var obs = stateAtTick(episode.trajectory, c.tick);
      var persist = (truth && obs) ? Math.sqrt(
        Math.pow(obs.x - truth.x, 2) + Math.pow(obs.y - truth.y, 2)
      ) : null;
      var err = isNum(c.pred_pos_error_m) ? c.pred_pos_error_m : null;
      var echo = !!(c.predicted && obs &&
        Math.abs(c.predicted.x - obs.x) < 1e-6 && Math.abs(c.predicted.y - obs.y) < 1e-6);
      var reason = null;
      if (err === null) {
        reason = c.truncated ? 'lab.truncated'
          : (c.prediction_parse_failed ? 'lab.parse_failed' : 'lab.no_prediction');
      }
      if (isNum(err)) {
        measured++;
        if (isNum(persist) && err < persist) beats++;
        if (echo) echoes++;
        if (err > max) max = err;
      }
      if (isNum(persist) && persist > max) max = persist;
      pts.push({
        cycle: c.cycle, tick: c.tick, engageTick: c.engage_tick,
        error: err, persistence: isNum(persist) ? persist : null,
        echo: echo, reasonKey: reason,
        truncated: !!c.truncated,
        parseFailed: !!c.parse_failed,
        predictionParseFailed: !!c.prediction_parse_failed,
        fidelity: isNum(c.fidelity) ? c.fidelity : null,
        persistenceFidelity: isNum(c.persistence_fidelity) ? c.persistence_fidelity : null,
        retries: c.parse_retries || 0
      });
    });
    return { points: pts, max: max, beats: beats, measured: measured, echoes: echoes };
  }

  /* ---- feedback pairs ----------------------------------------------------- */

  /**
   * Normal/decoy pairs with the delta the extractor computed, plus the largest
   * heat difference the two runs were actually shown. Without that second
   * number "the model ignores heat" is not supported: an agent that dies the
   * same way twice also scores a zero delta (spec/METRICS.md 3c).
   */
  function pairRows(bundle) {
    return ((bundle && bundle.feedback) || []).map(function (p) {
      var a = episodeByKey(bundle, p.normal_key);
      var b = episodeByKey(bundle, p.decoy_key);
      var heatDelta = null, i, ca, cb, d;
      if (a && b) {
        var n = Math.min((a.cycles || []).length, (b.cycles || []).length);
        for (i = 0; i < n; i++) {
          ca = a.cycles[i]; cb = b.cycles[i];
          d = diff(ca.obs_heat, cb.obs_heat);
          if (d !== null && (heatDelta === null || d > heatDelta)) heatDelta = d;
        }
      }
      return {
        arm: p.arm,
        repetition: p.repetition,
        scenarioId: p.scenario_id,
        normal: p.normal_outcome,
        decoy: p.decoy_outcome,
        delta: p.outcome_delta,
        sameScore: isNum(p.outcome_delta) && p.outcome_delta === 0,
        actionsIdentical: p.actions_identical === true,
        heatDelta: heatDelta,
        normalKey: p.normal_key,
        decoyKey: p.decoy_key,
        normalOutcome: a ? a.outcome : null,
        decoyOutcome: b ? b.outcome : null
      };
    });
  }

  function allPairsIdentical(rows) {
    if (!rows || !rows.length) return false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].actionsIdentical !== true) return false;
    }
    return true;
  }

  /* ---- scenario table model ----------------------------------------------- */

  var TABLE_BARS = ['prediction_fidelity', 'temporal_anticipation', 'outcome'];

  /** One row per scenario, one cell per arm, one entry per repetition. */
  function tableModel(bundle, opts) {
    var o = opts || {};
    var scen = (bundle && bundle.scenarios) || {};
    var variant = o.variant || 'normal';
    var rows = [], id;
    for (id in scen) {
      if (!scen.hasOwnProperty(id)) continue;
      var s = scen[id];
      var cells = ARMS.map(function (arm) {
        var eps = ((bundle && bundle.episodes) || []).filter(function (e) {
          return e.scenario_id === id && e.arm === arm && e.variant === variant;
        });
        eps.sort(function (a, b) { return a.repetition - b.repetition; });
        var entries = eps.map(function (e) {
          return {
            key: e.key,
            repetition: e.repetition,
            outcome: e.outcome,
            closest: e.closest_approach_m,
            cycles: e.n_cycles,
            values: TABLE_BARS.map(function (m) {
              return {
                metric: m,
                value: episodeValue(e, m),
                reasonKey: reasonForEpisodeMetric(bundle, e, m)
              };
            })
          };
        });
        return {
          arm: arm,
          entries: entries,
          sortValue: aggregate(entries.map(function (x) {
            var v = null;
            x.values.forEach(function (y) { if (y.metric === 'outcome') v = y.value; });
            return v;
          }))
        };
      });
      rows.push({
        scenarioId: id,
        scenario: s,
        masked: s.goal_visible === false,
        probe: !!s.is_probe,
        budget: s.deliberation_ticks,
        cells: cells,
        primaryKey: firstKey(cells)
      });
    }
    return rows;
  }

  function firstKey(cells) {
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].entries.length) return cells[i].entries[0].key;
    }
    return null;
  }

  /** Reason string key for a null metric on one episode. */
  function reasonForEpisodeMetric(bundle, ep, metric) {
    if (isNum(episodeValue(ep, metric))) return null;
    var s = scenarioOf(bundle, ep.scenario_id);
    if (s.is_probe) return 'reason.probe_scenario';
    if (metric === 'prediction_fidelity') {
      var r = ep.scores && ep.scores.fidelity_invalid_reason;
      return r ? 'reason.' + r : 'reason.unknown';
    }
    if (metric === 'temporal_anticipation') {
      return s.goal_visible === false ? 'reason.masked_goal' : 'reason.no_scored_cycles';
    }
    return 'reason.unknown';
  }

  /** Sort key for a table column: "scenario", "budget" or an arm id. */
  function tableSortKey(column) {
    if (column === 'scenario') return function (r) { return r.scenarioId; };
    if (column === 'budget') return function (r) { return r.budget; };
    return function (r) {
      for (var i = 0; i < r.cells.length; i++) {
        if (r.cells[i].arm === column) {
          return r.cells[i].sortValue ? r.cells[i].sortValue.mean : null;
        }
      }
      return null;
    };
  }

  var P = {
    isNum: isNum,
    clamp: clamp,
    fmt: fmt,
    fmtInt: fmtInt,
    diff: diff,
    round: round,
    scaleLinear: scaleLinear,
    niceStep: niceStep,
    niceTicks: niceTicks,
    barPath: barPath,
    linePath: linePath,
    aggregate: aggregate,
    sortRows: sortRows,
    interpolate: interpolate,
    esc: esc,
    attrStr: attrStr,
    el: el,
    scopeEpisodes: scopeEpisodes,
    episodeValue: episodeValue,
    repetitions: repetitions,
    armMetric: armMetric,
    pairedMetric: pairedMetric,
    pairedDelta: pairedDelta,
    temporalSupport: temporalSupport,
    cycleSupport: cycleSupport,
    nullReasonKey: nullReasonKey,
    outcomeGap: outcomeGap,
    commonGoalRadius: commonGoalRadius,
    refsFor: refsFor,
    verdictModel: verdictModel,
    buildSummary: buildSummary,
    formatSummary: formatSummary,
    episodeByKey: episodeByKey,
    stateAtTick: stateAtTick,
    errorSeries: errorSeries,
    pairRows: pairRows,
    allPairsIdentical: allPairsIdentical,
    tableModel: tableModel,
    tableSortKey: tableSortKey,
    reasonForEpisodeMetric: reasonForEpisodeMetric,
    constants: {
      ARMS: ARMS,
      AXES: AXES,
      CONTROL_METRICS: CONTROL_METRICS,
      TABLE_BARS: TABLE_BARS,
      NO_EFFECT_ORIGIN: NO_EFFECT_ORIGIN,
      COVERAGE_GUARD: COVERAGE_GUARD
    }
  };

  /* ==========================================================================
     2. Copy. Every visible string comes from here and nowhere else.
     ========================================================================== */

  var forcedLang = null;

  function dictionary() {
    var S = global.STRINGS;
    if (!S) return null;
    var lang = forcedLang ||
      (global.App && global.App.lang) ||
      (global.document && global.document.documentElement &&
        global.document.documentElement.getAttribute('lang')) || 'pl';
    return S[lang] || S.pl || null;
  }

  function t(key, params) {
    var text = null;
    if (global.App && typeof global.App.t === 'function') {
      try { text = global.App.t(key); } catch (err) { text = null; }
    }
    if (text === null || text === undefined || text === key) {
      var dict = dictionary();
      if (dict && dict[key] !== undefined) text = dict[key];
    }
    if (text === null || text === undefined) text = key;
    return interpolate(text, params);
  }

  function armName(arm) {
    return t(ARM_STRING[arm] + '.name');
  }

  function armLabel(arm) {
    return t(ARM_STRING[arm] + '.label');
  }

  function unmeasurableText(reasonKey) {
    return t('empty.metric_unmeasurable', { reason: t(reasonKey || 'reason.unknown') });
  }

  function scenarioName(bundle, id) {
    var key = 'scenario.' + id + '.name';
    var name = t(key);
    return name === key ? id : name;
  }

  /* ==========================================================================
     3. Shared drawing pieces.
     ========================================================================== */

  function textureOn() {
    return !!(global.document && global.document.documentElement &&
      global.document.documentElement.getAttribute('data-texture') === 'on');
  }

  /** Solid arm colour, or the page's hatch pattern when texture is on. */
  function armFill(arm) {
    if (!textureOn()) return 'var(--c-path)';
    return 'url(#' + (arm === 'end2end' ? 'cg-hatch-a' : 'cg-hatch-b') + ')';
  }

  function titleEl(text) {
    return el('title', {}, esc(text));
  }

  function svgText(x, y, cls, text, extra) {
    var map = { x: round(x, 2), y: round(y, 2), 'class': cls };
    var k;
    for (k in (extra || {})) if (extra.hasOwnProperty(k)) map[k] = extra[k];
    return el('text', map, esc(text));
  }

  function useIcon(id, x, y, size, style, title) {
    return el('use', {
      href: '#' + id, x: round(x, 2), y: round(y, 2),
      width: size, height: size, style: style
    }, title ? titleEl(title) : null);
  }

  function outcomeChip(outcome) {
    var kind = OUTCOME_ICON[outcome] ? outcome : 'unknown';
    var icon = OUTCOME_ICON[outcome];
    var label = t('outcome.' + kind);
    var inner = (icon ? el('svg', { 'class': 'cg-chip__icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      el('use', { href: '#' + icon }, null)) : '') + esc(label);
    return el('span', {
      'class': 'cg-chip', 'data-outcome': kind, title: t('outcome.' + kind + '.desc')
    }, inner);
  }

  function armChip(arm) {
    return el('span', {
      'class': 'cg-chip', 'data-kind': 'arm', 'data-arm': arm, title: t(ARM_STRING[arm] + '.short')
    }, esc(armName(arm)));
  }

  function note(text, tone, iconId) {
    var icon = el('svg', { 'class': 'cg-note__icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      el('use', { href: '#' + (iconId || 'cg-info') }, null));
    return el('p', { 'class': 'cg-note', 'data-tone': tone || null }, icon + el('span', {}, esc(text)));
  }

  function legendItem(label, shape, arm, role) {
    return el('span', { 'class': 'cg-legend__item' },
      el('span', { 'class': 'cg-swatch', 'data-shape': shape, 'data-arm': arm || null, 'data-role': role || null }, '') +
      el('span', {}, esc(label)));
  }

  function panel(opts, titleText, noteText, body, footer, actions) {
    var o = opts || {};
    if (o.chrome === false) return body + (footer || '');
    var head = el('h2', { 'class': 'cg-panel__title' }, esc(titleText)) +
      (noteText ? el('p', { 'class': 'cg-panel__note' }, esc(noteText)) : '') +
      (actions ? el('div', { 'class': 'cg-panel__actions' }, actions) : '');
    return el('section', { 'class': 'cg-panel', 'data-chart': o.chartId || null },
      el('header', { 'class': 'cg-panel__head' }, head) +
      body +
      (footer ? el('footer', { 'class': 'cg-panel__foot' }, footer) : ''));
  }

  function mount(container, html) {
    if (!container) return null;
    container.innerHTML = html;
    return container;
  }

  /* ---- the paired horizontal bar chart ------------------------------------ */

  /* padL holds the arm name and the support line under it; both are mono at
     --fs-1, so the column is sized for the longest of those two strings. */
  var BAR = {
    w: 700, padL: 160, padR: 14, valueW: 58, padT: 42,
    barH: 18, gapY: 8,
    refLabelY: [12, 23, 34]
  };

  /**
   * Two bars, one per arm, on a shared 0-1 axis, with a min-max range whisker
   * and reference rules. A null value draws no bar at all: it draws a hatched
   * track carrying the reason it is missing.
   */
  function barChart(spec) {
    var d0 = spec.domain ? spec.domain[0] : 0;
    var d1 = spec.domain ? spec.domain[1] : 1;
    var x0 = BAR.padL;
    var x1 = BAR.w - BAR.padR - BAR.valueW;
    var plotBottom = BAR.padT + spec.bars.length * BAR.barH + (spec.bars.length - 1) * BAR.gapY;
    var axisY = plotBottom + 8;
    var tickY = axisY + 13;
    var axisTitleY = tickY + 15;
    var h = axisTitleY + 5;
    var body = '';
    var sx = function (v) { return scaleLinear(v, d0, d1, x0, x1, true); };

    if (spec.band) {
      var bx0 = sx(spec.band.lo), bx1 = sx(spec.band.hi);
      body += el('rect', {
        x: round(bx0, 2), y: BAR.padT - 4, width: round(bx1 - bx0, 2), height: round(plotBottom - BAR.padT + 8, 2),
        style: 'fill:var(--c-ref-line);opacity:0.14'
      }, spec.band.title ? titleEl(spec.band.title) : null);
    }

    spec.bars.forEach(function (bar, i) {
      var y = BAR.padT + i * (BAR.barH + BAR.gapY);
      var mid = y + BAR.barH / 2;
      body += svgText(x0 - 8, mid + 4, 'cg-chart__tick', armName(bar.arm), { 'text-anchor': 'end' });

      if (!bar.stat) {
        body += el('rect', {
          x: x0, y: y, width: round(x1 - x0, 2), height: BAR.barH, rx: 2,
          style: 'fill:var(--c-unmeasurable-bg);stroke:var(--c-unmeasurable);stroke-width:1;stroke-dasharray:4 3'
        }, titleEl(unmeasurableText(bar.reasonKey)));
        body += svgText(x0 + 8, mid + 4, 'cg-chart__label', unmeasurableText(bar.reasonKey),
          { style: 'fill:var(--c-unmeasurable);font-style:italic' });
        body += svgText(BAR.w - BAR.padR, mid + 4, 'cg-chart__label', t('ui.na'),
          { 'text-anchor': 'end', style: 'fill:var(--c-unmeasurable);font-style:italic' });
        return;
      }

      var titleText = armName(bar.arm) + ' ' + fmt(bar.stat.mean, 4) + ' | ' +
        t('verdict.range', { value: fmt(bar.stat.min, 4) + ' - ' + fmt(bar.stat.max, 4) }) + ' | ' +
        t('verdict.samples', { n: bar.stat.n });

      body += el('rect', { x: x0, y: y, width: round(x1 - x0, 2), height: BAR.barH, rx: 2, style: 'fill:var(--c-surface-3)' }, null);
      body += el('g', { 'data-arm': bar.arm },
        el('path', {
          d: barPath(x0, y, sx(bar.stat.mean) - x0, BAR.barH, 2),
          style: 'fill:' + armFill(bar.arm) + ';stroke:var(--c-path);stroke-width:1'
        }, titleEl(titleText)));

      /* "Repetitions returned the same number" is a claim about repeated
         measurement. Without at least two real measurements there is nothing
         to have agreed, and a null min/max would collapse to the same pixel
         and assert agreement that never happened. */
      var measured = bar.stat.n >= 2 &&
        typeof bar.stat.min === 'number' && isFinite(bar.stat.min) &&
        typeof bar.stat.max === 'number' && isFinite(bar.stat.max);
      var xmin = sx(bar.stat.min), xmax = sx(bar.stat.max);
      if (!measured) {
        body += '';
      } else if (Math.abs(xmax - xmin) < 0.5) {
        body += useIcon('cg-equals', sx(bar.stat.mean) + 4, mid - 6, 12,
          'color:var(--c-text-3)', t('verdict.no_spread'));
      } else {
        body += el('g', { style: 'stroke:var(--c-text-2);stroke-width:1.25;fill:none' },
          el('path', {
            d: 'M' + round(xmin, 2) + ',' + mid + 'H' + round(xmax, 2) +
              'M' + round(xmin, 2) + ',' + (mid - 5) + 'V' + (mid + 5) +
              'M' + round(xmax, 2) + ',' + (mid - 5) + 'V' + (mid + 5)
          }, titleEl(t('verdict.range', { value: fmt(bar.stat.min, 4) + ' - ' + fmt(bar.stat.max, 4) }))));
      }

      body += svgText(BAR.w - BAR.padR, mid + 4, 'cg-chart__label', fmt(bar.stat.mean, 4),
        { 'text-anchor': 'end', style: 'fill:var(--c-text-1)' });
      body += svgText(x0 - 8, mid + 15, 'cg-chart__tick', t('verdict.samples', { n: bar.stat.n }),
        { 'text-anchor': 'end', style: 'font-size:var(--fs-1)' });
    });

    /* References are drawn low to high so the staggered labels never cross. */
    var refs = (spec.refs || []).slice().sort(function (a, b) { return a.value - b.value; });
    refs.forEach(function (ref, i) {
      var x = sx(ref.value);
      var label = ref.kind === 'baseline' ? t('ref.' + ref.name + '.name')
        : (ref.kind === 'origin' ? t('metric.midpoint.hint') : t('metric.persistence_floor.name'));
      var tip = label + ' ' + t('ref.value', { value: fmt(ref.value, 4) }) +
        (ref.kind === 'baseline' ? ' | ' + t('ref.not_llm') : '') +
        (ref.arm ? ' | ' + armName(ref.arm) : '');
      var yTop = BAR.padT - 4, yBot = plotBottom + 4;
      if (ref.kind === 'floor' && isNum(ref.armIndex)) {
        yTop = BAR.padT + ref.armIndex * (BAR.barH + BAR.gapY) - 3;
        yBot = yTop + BAR.barH + 6;
      }
      body += el('path', {
        d: 'M' + round(x, 2) + ',' + yTop + 'V' + yBot,
        'class': 'cg-chart__ref'
      }, titleEl(tip));
      if (ref.kind !== 'floor' || ref.armIndex === 0) {
        var anchor = x > (x0 + x1) / 2 ? 'end' : 'start';
        var lx = anchor === 'end' ? x - 4 : x + 4;
        body += svgText(lx, BAR.refLabelY[i % BAR.refLabelY.length], 'cg-chart__tick', label,
          { 'text-anchor': anchor });
      }
    });

    body += el('path', { d: 'M' + x0 + ',' + axisY + 'H' + x1, 'class': 'cg-chart__axis' }, null);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var v = d0 + f * (d1 - d0);
      var x = sx(v);
      body += el('path', { d: 'M' + round(x, 2) + ',' + axisY + 'V' + (axisY + 4), 'class': 'cg-chart__axis' }, null);
      body += svgText(x, tickY, 'cg-chart__tick', fmt(v, 2), { 'text-anchor': 'middle' });
    });
    body += svgText(x0, axisTitleY, 'cg-chart__tick', t('arena.axis.score'), { 'text-anchor': 'start' });
    body += svgText(x1, axisTitleY, 'cg-chart__tick',
      t(LOWER_IS_BETTER[spec.metric] ? 'metric.lower_better' : 'metric.higher_better'),
      { 'text-anchor': 'end' });

    return el('svg', {
      'class': 'cg-chart', viewBox: '0 0 ' + BAR.w + ' ' + round(h, 0),
      role: 'img', 'aria-label': spec.ariaLabel || ''
    }, body);
  }

  /** Left column of a metric row: name, one sentence, direction. */
  function metricHead(metric, stateUnmeasurable, extraHtml) {
    return el('div', {
      'class': 'cg-metric', 'data-state': stateUnmeasurable ? 'unmeasurable' : null
    },
      el('h3', { 'class': 'cg-panel__title' }, esc(t('metric.' + metric + '.name'))) +
      el('p', { 'class': 'cg-metric__foot' }, esc(t('metric.' + metric + '.short'))) +
      (extraHtml || ''));
  }

  function readout(rows) {
    var inner = rows.map(function (r) {
      return el('div', { 'class': 'cg-readout__row' },
        el('dt', { title: r.title || null }, esc(r.label)) +
        el('dd', { 'data-state': r.unmeasurable ? 'unmeasurable' : null, style: r.unmeasurable ? 'color:var(--c-unmeasurable);font-style:italic' : null }, esc(r.value)));
    }).join('');
    return el('dl', { 'class': 'cg-readout' }, inner);
  }

  /* ==========================================================================
     4. Charts.verdict
     ========================================================================== */

  function verdict(container, bundle, opts) {
    var o = opts || {};
    var scope = o.scope || 'visible';
    var rows = verdictModel(bundle, scope);
    var eps = scopeEpisodes(bundle, scope);
    var total = scopeEpisodes(bundle, 'all').length;

    var grid = rows.map(function (row) {
      var bothNull = !row.bars[0].stat && !row.bars[1].stat;
      var extra = '';

      if (row.metric === 'prediction_fidelity') {
        /* Fidelity is publishable only as the pair (fidelity, coverage). */
        extra += readout(ARMS.map(function (arm) {
          var cov = armMetric(bundle, arm, 'prediction_coverage', scope);
          return {
            label: armName(arm) + ' ' + t('metric.prediction_coverage.name'),
            value: cov ? fmt(cov.mean, 4) : t('ui.na'),
            unmeasurable: !cov,
            title: t('metric.prediction_coverage.short')
          };
        }));
        extra += el('p', { 'class': 'cg-metric__foot' }, esc(t('metric.prediction_fidelity.pair_note')));
        extra += readout(ARMS.map(function (arm) {
          var clean = armMetric(bundle, arm, 'fidelity_no_retry', scope);
          var support = cycleSupport(
            bundle, arm, 'fidelity_no_retry', 'fidelity_no_retry_n_valid_cycles', scope
          );
          return {
            label: armName(arm) + ' - ' + t('sensitivity.no_retry.label'),
            value: clean ? t('sensitivity.fidelity.value', {
              value: fmt(clean.mean, 4), n: clean.n, k: support.cycles
            }) : t('ui.na'),
            unmeasurable: !clean,
            title: t('sensitivity.no_retry.note')
          };
        }));
      } else if (row.metric === 'temporal_anticipation') {
        extra += readout(ARMS.map(function (arm) {
          var support = temporalSupport(bundle, arm, scope, false);
          return {
            label: armName(arm) + ' - ' + t('metric.temporal_anticipation.support_label'),
            value: isNum(support.meanWeight) ? t('metric.temporal_anticipation.support_value', {
              k: support.cycles,
              weight: fmt(support.meanWeight, 4)
            }) : unmeasurableText('reason.no_scored_cycles'),
            unmeasurable: !isNum(support.meanWeight),
            title: t('metric.temporal_anticipation.pair_note')
          };
        }));
        extra += readout(ARMS.map(function (arm) {
          var clean = armMetric(bundle, arm, 'temporal_no_retry', scope);
          var support = temporalSupport(bundle, arm, scope, true);
          return {
            label: armName(arm) + ' - ' + t('sensitivity.no_retry.label'),
            value: clean ? t('sensitivity.temporal.value', {
              value: fmt(clean.mean, 4), n: clean.n, k: support.cycles,
              weight: fmt(support.meanWeight, 4)
            }) : t('ui.na'),
            unmeasurable: !clean,
            title: t('sensitivity.no_retry.note')
          };
        }));
        extra += el('p', { 'class': 'cg-metric__foot' }, esc(t('metric.temporal_anticipation.pair_note')));
      } else if (row.metric === 'feedback_use') {
        extra += readout(ARMS.map(function (arm) {
          var raw = armMetric(bundle, arm, 'feedback_raw', scope);
          var band = armMetric(bundle, arm, 'feedback_band', scope);
          return {
            label: armName(arm) + ' ' + t('feedback.raw.label'),
            value: raw ? fmt(raw.mean, 4) : t('ui.na'),
            unmeasurable: !raw,
            title: band ? t('feedback.band.label') + ' ' + fmt(band.mean, 4) : t('feedback.band.label')
          };
        }));
        extra += el('p', { 'class': 'cg-metric__foot' }, esc(t('metric.feedback_use.pair_note')));
      } else if (row.metric === 'outcome') {
        extra += el('p', { 'class': 'cg-metric__foot' }, esc(t('metric.outcome.pair_note')));
      }

      if (row.metric !== 'feedback_use') {
        var delta = pairedDelta(bundle, row.metric, scope);
        if (delta) {
          extra += el('p', { 'class': 'cg-metric__foot' }, esc(t('arm.compare.paired_delta', {
            value: fmt(delta.value, 4), n: delta.n
          })));
        }
      }

      var band = row.band ? {
        lo: row.band.lo, hi: row.band.hi,
        title: t('chart.outcome.gap', { value: fmt(row.band.lo, 4), min: fmt(row.band.hi, 4) })
      } : null;

      var chart = barChart({
        bars: row.bars, refs: row.refs, band: band, metric: row.metric,
        domain: UNIT_INTERVAL,
        ariaLabel: t('metric.' + row.metric + '.name') + ': ' +
          row.bars.map(function (b) {
            return armName(b.arm) + ' ' + (b.stat ? fmt(b.stat.mean, 4) : unmeasurableText(b.reasonKey));
          }).join(', ')
      });

      var chartCol = chart + (band ? el('p', { 'class': 'cg-metric__foot' },
        esc(t('chart.outcome.gap', { value: fmt(row.band.lo, 4), min: fmt(row.band.hi, 4) }))) : '');

      return el('div', { 'class': 'cg-col-4' }, metricHead(row.metric, bothNull, extra)) +
        el('div', { 'class': 'cg-col-8' }, chartCol);
    }).join('');

    var legend = el('div', { 'class': 'cg-legend' },
      legendItem(armName('end2end') + ' - ' + armLabel('end2end'), 'disc', 'end2end') +
      legendItem(armName('wm-scaffold') + ' - ' + armLabel('wm-scaffold'), 'disc', 'wm-scaffold') +
      legendItem(t('ref.group.title'), 'dash', null, 'ref') +
      legendItem(t('metric.persistence_floor.name'), 'dash', null, 'ref'));

    var scopeSwitch = el('div', { 'class': 'cg-seg', role: 'group', 'aria-label': t('results.filter.scenario') },
      el('button', {
        type: 'button', 'class': 'cg-seg__btn', 'data-scope': 'visible',
        'aria-pressed': scope === 'visible' ? 'true' : 'false'
      }, esc(t('results.filter.visible_only'))) +
      el('button', {
        type: 'button', 'class': 'cg-seg__btn', 'data-scope': 'all',
        'aria-pressed': scope === 'all' ? 'true' : 'false'
      }, esc(t('results.filter.all'))));

    var body = el('div', { 'class': 'cg-panel__body' },
      el('p', { 'class': 'cg-panel__note cg-mono' }, esc(t('results.count', { n: eps.length, total: total }))) +
      el('div', { 'class': 'cg-grid' }, grid) +
      legend);

    var summary = formatSummary(buildSummary(bundle, scope));
    var footer = el('p', {}, esc(summary)) +
      note(t('reason.note'), 'unmeasurable') +
      el('p', {}, esc(t('finding.caveat'))) +
      el('p', { 'class': 'cg-metric__foot' }, esc(t('arm.compare.note')));

    mount(container, panel(
      { chrome: o.chrome, chartId: 'verdict' },
      t('metric.group.cognitive'), t('metric.group.cognitive.note'),
      body, footer, scopeSwitch));

    if (container) {
      var btns = container.querySelectorAll('.cg-seg__btn[data-scope]');
      Array.prototype.forEach.call(btns, function (b) {
        b.addEventListener('click', function () {
          var next = {}, k;
          for (k in o) if (o.hasOwnProperty(k)) next[k] = o[k];
          next.scope = b.getAttribute('data-scope');
          verdict(container, bundle, next);
          if (typeof o.onScopeChange === 'function') o.onScopeChange(next.scope);
        });
      });
    }
    return container;
  }

  /* ==========================================================================
     5. Charts.scenarioTable
     ========================================================================== */

  var CELL = { w: 300, labelW: 96, valueW: 52, barH: 8, rowH: 14, top: 4 };

  /** The three micro bars of one episode, as one small inline SVG. */
  function cellBars(entry, arm) {
    var x0 = CELL.labelW;
    var x1 = CELL.w - CELL.valueW;
    var h = CELL.top + entry.values.length * CELL.rowH + 2;
    var body = entry.values.map(function (v, i) {
      var y = CELL.top + i * CELL.rowH;
      var mid = y + CELL.barH / 2;
      var name = t('metric.' + v.metric + '.abbr');
      var out = svgText(0, y + CELL.barH, 'cg-chart__tick', name, {});
      if (!isNum(v.value)) {
        out += el('rect', {
          x: x0, y: y, width: round(x1 - x0, 2), height: CELL.barH, rx: 2,
          style: 'fill:var(--c-unmeasurable-bg);stroke:var(--c-unmeasurable);stroke-width:1;stroke-dasharray:3 2.5'
        }, titleEl(name + ': ' + unmeasurableText(v.reasonKey)));
        out += svgText(CELL.w, y + CELL.barH, 'cg-chart__tick', t('ui.na'),
          { 'text-anchor': 'end', style: 'fill:var(--c-unmeasurable);font-style:italic' });
        return out;
      }
      out += el('rect', { x: x0, y: y, width: round(x1 - x0, 2), height: CELL.barH, rx: 2, style: 'fill:var(--c-surface-3)' }, null);
      out += el('g', { 'data-arm': arm },
        el('path', {
          d: barPath(x0, y, scaleLinear(v.value, 0, 1, x0, x1, true) - x0, CELL.barH, 2),
          style: 'fill:' + armFill(arm) + ';stroke:var(--c-path);stroke-width:0.75'
        }, titleEl(name + ' ' + fmt(v.value, 4))));
      out += svgText(CELL.w, y + CELL.barH, 'cg-chart__tick', fmt(v.value, 3), { 'text-anchor': 'end' });
      return out;
    }).join('');
    return el('svg', {
      'class': 'cg-chart', viewBox: '0 0 ' + CELL.w + ' ' + h, role: 'img',
      'aria-label': entry.values.map(function (v) {
        return t('metric.' + v.metric + '.abbr') + ' ' +
          (isNum(v.value) ? fmt(v.value, 4) : unmeasurableText(v.reasonKey));
      }).join(', ')
    }, body);
  }

  function cellHtml(cell, row) {
    if (!cell.entries.length) {
      return el('p', { 'class': 'cg-metric__foot', style: 'color:var(--c-unmeasurable);font-style:italic' },
        esc(row.probe ? t('empty.run_in_progress') : t('empty.no_episodes')));
    }
    return cell.entries.map(function (entry) {
      var headLine = el('span', { 'class': 'cg-chip', 'data-kind': 'rep' }, esc('r' + entry.repetition)) +
        ' ' + outcomeChip(entry.outcome) +
        ' ' + el('span', { 'class': 'cg-mono', title: t('outcome.closest') },
          esc(fmt(entry.closest, 2) + ' ' + t('arena.unit.m')));
      var unmeasured = entry.values.filter(function (v) { return !isNum(v.value); }).map(function (v) {
        return el('p', {
          'class': 'cg-mono',
          style: 'margin:0;font-size:var(--fs-1);color:var(--c-unmeasurable);font-style:italic'
        }, esc(t('metric.' + v.metric + '.abbr') + ': ' + unmeasurableText(v.reasonKey)));
      }).join('');
      return el('div', {
        'data-episode-key': entry.key, role: 'button', tabindex: '0',
        title: t('results.open_in_lab'),
        style: 'display:flex;flex-direction:column;gap:var(--sp-1);padding:var(--sp-1) 0;cursor:pointer'
      }, el('div', { style: 'display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap' }, headLine) +
        cellBars(entry, cell.arm) + unmeasured);
    }).join('');
  }

  function scenarioTable(container, bundle, opts) {
    var o = opts || {};
    var sort = o.sort || { column: 'scenario', dir: 'asc' };
    var rows = sortRows(tableModel(bundle, o), tableSortKey(sort.column), sort.dir);
    var shown = 0, totalEpisodes = ((bundle && bundle.episodes) || []).length;

    var header = el('tr', {},
      th('scenario', t('results.col.scenario'), sort, null) +
      th('budget', t('results.col.budget'), sort, 'num') +
      ARMS.map(function (arm) { return th(arm, armName(arm) + ' - ' + armLabel(arm), sort, null, arm); }).join(''));

    var bodyRows = rows.map(function (row) {
      var badges = (row.masked ? el('span', { 'class': 'cg-chip', 'data-kind': 'decoy' }, esc(t('scenario.masked_badge'))) : '') +
        (row.probe ? el('span', { 'class': 'cg-chip', 'data-kind': 'retry' }, esc(t('scenario.probe_badge'))) : '');
      row.cells.forEach(function (c) { shown += c.entries.length; });
      return el('tr', {
        'data-group-start': 'true',
        'data-episode-key': row.primaryKey || null,
        tabindex: row.primaryKey ? '0' : null
      },
        el('td', {},
          el('div', { style: 'display:flex;flex-direction:column;gap:var(--sp-1)' },
            el('strong', {}, esc(scenarioName(bundle, row.scenarioId))) +
            el('span', { 'class': 'cg-mono', style: 'color:var(--c-text-3);font-size:var(--fs-2)' }, esc(row.scenarioId)) +
            (badges ? el('span', { style: 'display:flex;gap:var(--sp-1);flex-wrap:wrap' }, badges) : '') +
            el('span', { 'class': 'cg-metric__foot' }, esc(t('scenario.' + row.scenarioId + '.desc'))))) +
        el('td', { 'data-type': 'num', title: t('world.budget') }, esc(fmtInt(row.budget) || t('ui.na'))) +
        row.cells.map(function (cell) {
          return el('td', { 'data-arm': cell.arm, style: 'min-width:320px' }, cellHtml(cell, row));
        }).join(''));
    }).join('');

    var legend = el('div', { 'class': 'cg-legend' },
      TABLE_BARS.map(function (m) {
        return legendItem(t('metric.' + m + '.abbr') + ' - ' + t('metric.' + m + '.name'), 'line', null, 'ref');
      }).join('') +
      legendItem(t('metric.scale.hint'), 'hatch'));

    var table = el('div', { 'class': 'cg-tablewrap' },
      el('table', { 'class': 'cg-table' },
        el('caption', {}, esc(t('results.count', { n: shown, total: totalEpisodes }) + ' - ' + t('results.sort.hint'))) +
        el('thead', {}, header) +
        el('tbody', {}, bodyRows)));

    var body = el('div', { 'class': 'cg-panel__body', 'data-pad': 'none' }, legend + table);

    mount(container, panel(
      { chrome: o.chrome, chartId: 'scenario-table' },
      t('results.table.title'), t('scenario.group.note'),
      body, note(t('scenario.probe_note'), 'control')));

    if (!container) return container;

    var select = function (key) {
      if (key && typeof o.onSelect === 'function') o.onSelect(key);
    };
    var tbody = container.querySelector('tbody');
    if (tbody) {
      tbody.addEventListener('click', function (ev) {
        var node = ev.target;
        while (node && node !== tbody && !node.getAttribute) node = node.parentNode;
        while (node && node !== tbody && !node.getAttribute('data-episode-key')) node = node.parentNode;
        if (node && node !== tbody) select(node.getAttribute('data-episode-key'));
      });
      tbody.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
        var node = ev.target;
        while (node && node !== tbody && !(node.getAttribute && node.getAttribute('data-episode-key'))) node = node.parentNode;
        if (node && node !== tbody) { ev.preventDefault(); select(node.getAttribute('data-episode-key')); }
      });
    }
    Array.prototype.forEach.call(container.querySelectorAll('th[data-column]'), function (thEl) {
      thEl.addEventListener('click', function () {
        var col = thEl.getAttribute('data-column');
        var dir = (sort.column === col && sort.dir === 'asc') ? 'desc' : 'asc';
        var next = {}, k;
        for (k in o) if (o.hasOwnProperty(k)) next[k] = o[k];
        next.sort = { column: col, dir: dir };
        scenarioTable(container, bundle, next);
      });
    });
    return container;
  }

  function th(column, label, sort, type, arm) {
    var active = sort.column === column;
    return el('th', {
      scope: 'col', 'data-column': column, 'data-type': type || null, 'data-arm': arm || null,
      'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      title: t('results.sort.hint'),
      style: 'cursor:pointer'
    }, esc(label + (active ? (sort.dir === 'asc' ? ' +' : ' -') : '')));
  }

  /* ==========================================================================
     6. Charts.predictionError
     ========================================================================== */

  var ERR = { w: 700, h: 300, padL: 62, padR: 18, padT: 20, padB: 66 };

  function predictionError(container, bundle, episodeKeyOrOpts, maybeOpts) {
    var o = (typeof episodeKeyOrOpts === 'object' && episodeKeyOrOpts) ? episodeKeyOrOpts : (maybeOpts || {});
    var key = typeof episodeKeyOrOpts === 'string' ? episodeKeyOrOpts : o.episodeKey;
    var ep = episodeByKey(bundle, key);

    if (!ep) {
      mount(container, panel({ chrome: o.chrome, chartId: 'prediction-error' },
        t('chart.error.title'), null,
        el('div', { 'class': 'cg-panel__body' }, note(t('empty.no_data'), 'unmeasurable')), null));
      return container;
    }

    var series = errorSeries(ep);
    var pts = series.points;
    if (!pts.length) {
      mount(container, panel({ chrome: o.chrome, chartId: 'prediction-error' },
        t('chart.error.title'), ep.key,
        el('div', { 'class': 'cg-panel__body' }, note(t('empty.no_cycles'), 'unmeasurable')), null));
      return container;
    }

    var x0 = ERR.padL, x1 = ERR.w - ERR.padR;
    var y0 = ERR.h - ERR.padB, y1 = ERR.padT;
    var axis = niceTicks(0, series.max, 5);
    var step = pts.length > 1 ? (x1 - x0) / (pts.length - 1) : 0;
    var px = function (i) { return pts.length > 1 ? x0 + i * step : (x0 + x1) / 2; };
    var py = function (v) { return scaleLinear(v, 0, axis.max, y0, y1, true); };
    var body = '';

    axis.ticks.forEach(function (v) {
      var y = py(v);
      body += el('path', { d: 'M' + x0 + ',' + round(y, 2) + 'H' + x1, 'class': 'cg-chart__grid' }, null);
      body += svgText(x0 - 8, y + 4, 'cg-chart__tick', fmt(v, v >= 10 ? 0 : 1), { 'text-anchor': 'end' });
    });
    body += el('path', { d: 'M' + x0 + ',' + y1 + 'V' + y0 + 'H' + x1, 'class': 'cg-chart__axis' }, null);

    body += el('path', {
      d: linePath(pts.map(function (p, i) {
        return isNum(p.persistence) ? { x: px(i), y: py(p.persistence) } : null;
      })),
      'class': 'cg-chart__ref'
    }, titleEl(t('chart.error.persistence')));

    body += el('g', { 'data-arm': ep.arm },
      el('path', {
        d: linePath(pts.map(function (p, i) {
          return isNum(p.error) ? { x: px(i), y: py(p.error) } : null;
        })),
        'class': 'cg-chart__series'
      }, titleEl(armName(ep.arm))));

    pts.forEach(function (p, i) {
      var x = px(i);
      var tip = t('arena.axis.cycle') + ' ' + p.cycle + ' | ' + t('arena.axis.tick') + ' ' + p.tick +
        ' | ' + t('lab.col.engage_tick') + ' ' + p.engageTick;
      if (isNum(p.persistence)) {
        body += el('circle', {
          cx: round(x, 2), cy: round(py(p.persistence), 2), r: 3,
          style: 'fill:none;stroke:var(--c-ref-line);stroke-width:1.25'
        }, titleEl(t('chart.error.persistence') + ' ' + fmt(p.persistence, 2) + ' ' + t('arena.unit.m')));
      }
      if (isNum(p.error)) {
        var extra = p.echo ? ' | ' + t('chart.error.echo') : '';
        if (isNum(p.fidelity)) extra += ' | ' + t('metric.prediction_fidelity.abbr') + ' ' + fmt(p.fidelity, 4);
        body += el('g', { 'data-arm': ep.arm },
          el('circle', {
            cx: round(x, 2), cy: round(py(p.error), 2), r: p.echo ? 5 : 4,
            'class': p.echo ? null : 'cg-chart__point',
            style: p.echo ? 'fill:var(--c-surface-1);stroke:var(--c-path);stroke-width:1.5;stroke-dasharray:var(--dash-ghost)' : null
          }, titleEl(tip + ' | ' + t('arena.axis.error') + ' ' + fmt(p.error, 2) + ' ' + t('arena.unit.m') + extra)));
      } else {
        body += el('circle', {
          cx: round(x, 2), cy: y0, r: 4,
          style: 'fill:none;stroke:var(--c-unmeasurable);stroke-width:1.25;stroke-dasharray:2 2'
        }, titleEl(tip + ' | ' + t(p.reasonKey || 'lab.no_prediction')));
      }
      body += svgText(x, y0 + 16, 'cg-chart__tick', String(p.cycle), { 'text-anchor': 'middle' });
      body += svgText(x, y0 + 30, 'cg-chart__tick', String(p.tick),
        { 'text-anchor': 'middle', style: 'fill:var(--c-text-3)' });
    });

    /* Two rows of numbers, cycle above tick, named once under both. */
    body += svgText((x0 + x1) / 2, y0 + 48, 'cg-chart__tick',
      t('arena.axis.cycle') + ' / ' + t('arena.axis.tick'), { 'text-anchor': 'middle' });
    body += el('text', {
      'class': 'cg-chart__tick', transform: 'translate(14,' + round((y0 + y1) / 2, 1) + ') rotate(-90)',
      'text-anchor': 'middle'
    }, esc(t('arena.axis.error') + ' [' + t('arena.unit.m') + ']'));

    var svg = el('svg', {
      'class': 'cg-chart', viewBox: '0 0 ' + ERR.w + ' ' + ERR.h, role: 'img',
      'aria-label': t('chart.error.title') + ' - ' + ep.key
    }, body);

    var legend = el('div', { 'class': 'cg-legend' },
      legendItem(armName(ep.arm), 'line', ep.arm) +
      legendItem(t('chart.error.persistence'), 'dash', null, 'ref') +
      legendItem(t('lab.no_prediction'), 'ring') +
      legendItem(t('chart.error.echo'), 'ring', ep.arm));

    var head = el('div', { style: 'display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap' },
      armChip(ep.arm) + outcomeChip(ep.outcome) +
      el('span', { 'class': 'cg-mono' }, esc(ep.key)));

    var body2 = el('div', { 'class': 'cg-panel__body' }, head + svg + legend);
    var footer = el('p', {}, esc(t('chart.error.beats', { n: series.beats, total: series.measured }))) +
      el('p', { 'class': 'cg-metric__foot' }, esc(t('metric.persistence_floor.short')));

    mount(container, panel({ chrome: o.chrome, chartId: 'prediction-error' },
      t('chart.error.title'), t('metric.prediction_fidelity.short'), body2, footer));
    return container;
  }

  /* ==========================================================================
     7. Charts.feedbackPairs
     ========================================================================== */

  var PAIR = { w: 700, padL: 176, padR: 96, padT: 22, rowH: 26, padB: 46 };

  function feedbackPairs(container, bundle, opts) {
    var o = opts || {};
    var rows = pairRows(bundle);

    if (!rows.length) {
      mount(container, panel({ chrome: o.chrome, chartId: 'feedback-pairs' },
        t('metric.feedback_use.name'), t('metric.feedback_use.short'),
        el('div', { 'class': 'cg-panel__body' }, note(t('empty.no_decoy_pair'), 'unmeasurable')), null));
      return container;
    }

    var x0 = PAIR.padL, x1 = PAIR.w - PAIR.padR;
    var h = PAIR.padT + rows.length * PAIR.rowH + PAIR.padB;
    var y0 = PAIR.padT + rows.length * PAIR.rowH + 6;
    var sx = function (v) { return scaleLinear(v, 0, 1, x0, x1, true); };
    var gap = outcomeGap(bundle.constants, commonGoalRadius(bundle));
    var body = '';

    if (gap) {
      body += el('rect', {
        x: round(sx(gap.lo), 2), y: PAIR.padT - 6,
        width: round(sx(gap.hi) - sx(gap.lo), 2), height: round(rows.length * PAIR.rowH + 10, 2),
        style: 'fill:var(--c-ref-line);opacity:0.14'
      }, titleEl(t('chart.outcome.gap', { value: fmt(gap.lo, 4), min: fmt(gap.hi, 4) })));
    }

    rows.forEach(function (r, i) {
      var y = PAIR.padT + i * PAIR.rowH + PAIR.rowH / 2;
      var rowLabel = t('ui.arm_scenario', { arm: armName(r.arm), scenario: r.scenarioId }) +
        ' r' + r.repetition;
      body += el('text', { x: 4, y: round(y + 4, 2), 'class': 'cg-chart__tick' },
        esc(rowLabel) + titleEl(scenarioName(bundle, r.scenarioId) + ' - ' + t('scenario.' + r.scenarioId + '.desc')));
      body += el('path', { d: 'M' + x0 + ',' + y + 'H' + x1, style: 'stroke:var(--c-border);stroke-width:1' }, null);

      var xn = sx(r.normal), xd = sx(r.decoy);
      if (!r.sameScore && isNum(xn) && isNum(xd)) {
        body += el('path', { d: 'M' + round(xn, 2) + ',' + y + 'H' + round(xd, 2), 'class': 'cg-errline' }, null);
      }
      if (isNum(xd)) {
        body += el('g', { 'data-arm': r.arm },
          el('circle', {
            cx: round(xd, 2), cy: y, r: 6,
            style: 'fill:var(--c-surface-1);stroke:var(--c-path);stroke-width:1.5;stroke-dasharray:var(--dash-ghost)'
          }, titleEl(t('results.heat.decoy') + ' ' + fmt(r.decoy, 4))));
      }
      if (isNum(xn)) {
        body += el('g', { 'data-arm': r.arm },
          el('circle', {
            cx: round(xn, 2), cy: y, r: 4.5, style: 'fill:var(--c-path);stroke:var(--c-surface-1);stroke-width:1'
          }, titleEl(t('results.heat.true') + ' ' + fmt(r.normal, 4))));
      }
      if (r.sameScore) {
        body += useIcon('cg-equals', xn + 8, y - 6, 12, 'color:var(--c-text-3)', t('arm.compare.same'));
      }
      var deltaText = fmt(r.delta, 4);
      body += svgText(PAIR.w - 6, y + 4, 'cg-chart__label', deltaText === null ? t('ui.na') : deltaText,
        { 'text-anchor': 'end' });
      if (isNum(r.heatDelta)) {
        body += el('rect', { x: x0, y: y - PAIR.rowH / 2, width: round(x1 - x0, 2), height: PAIR.rowH, style: 'fill:transparent' },
          titleEl(t('arena.axis.heat') + ' ' + t('arm.compare.delta') + ' ' + fmt(r.heatDelta, 4)));
      }
    });

    body += el('path', { d: 'M' + x0 + ',' + y0 + 'H' + x1, 'class': 'cg-chart__axis' }, null);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var x = sx(v);
      body += el('path', { d: 'M' + round(x, 2) + ',' + y0 + 'V' + (y0 + 4), 'class': 'cg-chart__axis' }, null);
      body += svgText(x, y0 + 17, 'cg-chart__tick', fmt(v, 2), { 'text-anchor': 'middle' });
    });
    body += svgText(x0, y0 + 33, 'cg-chart__tick', t('arena.axis.score'), { 'text-anchor': 'start' });
    body += svgText(PAIR.w - 6, y0 + 33, 'cg-chart__tick', t('arm.compare.delta'), { 'text-anchor': 'end' });

    var svg = el('svg', {
      'class': 'cg-chart', viewBox: '0 0 ' + PAIR.w + ' ' + round(h, 0), role: 'img',
      'aria-label': t('metric.feedback_use.name')
    }, body);

    var legend = el('div', { 'class': 'cg-legend' },
      legendItem(t('results.heat.true'), 'disc', 'end2end') +
      legendItem(t('results.heat.decoy'), 'ring', 'end2end') +
      legendItem(t('arm.compare.delta'), 'dash', null, 'error'));

    var perArm = readout(ARMS.map(function (arm) {
      var row = feedbackSummaryFor(bundle, arm);
      var use = row && isNum(row.feedback_use) ? fmt(row.feedback_use, 4) : null;
      return {
        label: armName(arm) + ' ' + t('metric.feedback_use.abbr'),
        value: use === null ? unmeasurableText(nullReasonKey(bundle, arm, 'feedback_use', 'all')) : use,
        unmeasurable: use === null,
        title: t('metric.feedback_use.long')
      };
    }).concat(ARMS.map(function (arm) {
      var row = feedbackSummaryFor(bundle, arm);
      return {
        label: armName(arm) + ' ' + t('feedback.raw.label'),
        value: row && isNum(row.feedback_raw) ? fmt(row.feedback_raw, 4) : t('ui.na'),
        unmeasurable: !(row && isNum(row.feedback_raw)),
        title: t('feedback.pairs', { n: row ? row.n_pairs : 0 })
      };
    })).concat(ARMS.map(function (arm) {
      var row = feedbackSummaryFor(bundle, arm);
      var band = row && isNum(row.feedback_band) ? fmt(row.feedback_band, 5) : null;
      return {
        label: armName(arm) + ' ' + t('feedback.band.label'),
        value: band === null ? unmeasurableText(nullReasonKey(bundle, arm, 'feedback_use', 'all')) : band,
        unmeasurable: band === null,
        title: t('ref.searcher.short')
      };
    })));

    var body2 = el('div', { 'class': 'cg-panel__body' }, svg + legend + perArm);
    var findings = allPairsIdentical(rows)
      ? el('p', {}, el('strong', {}, esc(t('finding.decoy.title'))) + ' ' + esc(t('finding.decoy.body')))
      : '';
    var footer = findings +
      note(t('metric.feedback_use.pair_note'), 'unmeasurable') +
      el('p', { 'class': 'cg-metric__foot' }, esc(t('ref.searcher.short')));

    mount(container, panel({ chrome: o.chrome, chartId: 'feedback-pairs' },
      t('metric.feedback_use.name'), t('metric.feedback_use.short'), body2, footer));
    return container;
  }

  /* ==========================================================================
     8. Charts.controls
     ========================================================================== */

  function controls(container, bundle, opts) {
    var o = opts || {};
    var scope = o.scope || 'all';

    var grid = CONTROL_METRICS.map(function (metric) {
      var bars = ARMS.map(function (arm) {
        var stat = armMetric(bundle, arm, metric, scope);
        return { arm: arm, stat: stat, reasonKey: stat ? null : 'reason.unknown' };
      });
      var chart = barChart({
        bars: bars, refs: [], band: null, metric: metric, domain: UNIT_INTERVAL,
        ariaLabel: t('metric.' + metric + '.name') + ': ' + bars.map(function (b) {
          return armName(b.arm) + ' ' + (b.stat ? fmt(b.stat.mean, 4) : t('ui.na'));
        }).join(', ')
      });
      return el('div', { 'class': 'cg-col-4' },
        el('div', { 'class': 'cg-metric' },
          el('h3', { 'class': 'cg-panel__title' }, esc(t('metric.' + metric + '.name'))) +
          el('p', { 'class': 'cg-metric__foot' }, esc(t('metric.' + metric + '.short'))) +
          el('p', { 'class': 'cg-label' }, esc(t(LOWER_IS_BETTER[metric] ? 'metric.lower_better' : 'metric.higher_better'))))) +
        el('div', { 'class': 'cg-col-8' }, chart);
    }).join('');

    var telemetry = readout(ARMS.map(function (arm) {
      var a = (bundle.arms && bundle.arms[arm]) || {};
      return {
        label: armName(arm) + ' ' + t('metric.transport_retries.name'),
        value: isNum(a.transport_retries) ? String(a.transport_retries) : t('ui.na'),
        unmeasurable: !isNum(a.transport_retries),
        title: t('metric.transport_retries.long')
      };
    }).concat(ARMS.map(function (arm) {
      var a = (bundle.arms && bundle.arms[arm]) || {};
      var ms = a.wall_clock_ms && isNum(a.wall_clock_ms.mean) ? a.wall_clock_ms.mean : null;
      return {
        label: armName(arm) + ' ' + t('metric.wall_clock.name'),
        value: ms === null ? t('ui.na') : fmt(ms / 1000, 1) + ' ' + t('unit.s'),
        unmeasurable: ms === null,
        title: t('metric.wall_clock.long')
      };
    })));

    var body = el('div', { 'class': 'cg-panel__body' },
      note(t('metric.group.control.note'), 'control') +
      el('div', { 'class': 'cg-grid' }, grid) +
      telemetry);

    mount(container, panel({ chrome: o.chrome, chartId: 'controls' },
      t('metric.group.control'), t('finding.format.title'),
      body,
      note(t('control.calls_note'), 'control') + el('p', { 'class': 'cg-metric__foot' }, esc(t('finding.format.body')))));
    return container;
  }

  /* ==========================================================================
     9. Charts.probes
     ========================================================================== */

  var PROBE_COLS = [
    { key: 'n_trials', label: 'probe.col.trials', digits: 0 },
    { key: 'n_parsed', label: 'probe.col.parsed', digits: 0 },
    { key: 'json_parse_rate', label: 'probe.col.json_parse', digits: 4 },
    { key: 'identity_fidelity', label: 'probe.col.identity', digits: 4 },
    { key: 'engage_fidelity', label: 'probe.col.engage', digits: 4 },
    { key: 'choice_accuracy', label: 'probe.col.choice_accuracy', digits: 4 },
    { key: 'choice_parse_rate', label: 'probe.col.choice_parse', digits: 4 }
  ];

  function probes(container, bundle, opts) {
    var o = opts || {};
    var rows = (bundle && bundle.probes) || [];
    var scen = (bundle && bundle.scenarios) || {};
    var expected = [], id;
    for (id in scen) if (scen.hasOwnProperty(id) && scen[id].is_probe) expected.push(id);

    var body;
    if (!rows.length) {
      /* Not run yet is not zero: the control scenarios are listed by name so a
         reader can see what is still missing (spec/METRICS.md W11). */
      var list = expected.map(function (sid) {
        return el('li', {},
          el('span', { 'class': 'cg-chip', 'data-kind': 'retry' }, esc(t('scenario.probe_badge'))) + ' ' +
          el('strong', {}, esc(scenarioName(bundle, sid))) + ' ' +
          el('span', { 'class': 'cg-mono', style: 'color:var(--c-text-3)' }, esc(sid)) +
          el('p', { 'class': 'cg-metric__foot' }, esc(t('scenario.' + sid + '.desc'))));
      }).join('');
      body = el('div', { 'class': 'cg-panel__body' },
        note(t('empty.run_in_progress'), 'unmeasurable') +
        (list ? el('ul', { style: 'margin:var(--sp-3) 0 0;padding-left:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-2)' }, list) : ''));
    } else {
      var header = el('tr', {},
        el('th', { scope: 'col' }, esc(t('results.col.scenario'))) +
        el('th', { scope: 'col' }, esc(t('results.col.rep'))) +
        PROBE_COLS.map(function (c) {
          return el('th', { scope: 'col', 'data-type': 'num', title: t('scenario.probe_note') }, esc(t(c.label)));
        }).join(''));
      var trs = rows.map(function (r) {
        return el('tr', { 'data-group-start': 'true' },
          el('td', {}, el('strong', {}, esc(scenarioName(bundle, r.scenario_id))) + ' ' +
            el('span', { 'class': 'cg-mono', style: 'color:var(--c-text-3)' }, esc(r.scenario_id))) +
          el('td', { 'data-type': 'num' }, esc('r' + r.repetition)) +
          PROBE_COLS.map(function (c) {
            var v = r[c.key];
            if (!isNum(v)) {
              return el('td', { 'data-type': 'num', 'data-state': 'unmeasurable', title: unmeasurableText('reason.not_requested') },
                esc(t('ui.na')));
            }
            return el('td', { 'data-type': 'num' }, esc(fmt(v, c.digits)));
          }).join(''));
      }).join('');
      body = el('div', { 'class': 'cg-panel__body', 'data-pad': 'none' },
        el('div', { 'class': 'cg-tablewrap' },
          el('table', { 'class': 'cg-table' },
            el('caption', {}, esc(t('probe.chance'))) +
            el('thead', {}, header) + el('tbody', {}, trs))));
    }

    mount(container, panel({ chrome: o.chrome, chartId: 'probes' },
      t('probe.title'), t('scenario.probe_note'),
      body,
      note(t('metric.group.control.note'), 'control')));
    return container;
  }

  /* ==========================================================================
     10. Shell dispatch

     The shell (assets/app.js) asks for a chart by kind and hands over one spec
     object; the drawing functions above keep their own explicit signatures.
     These adapters are the whole bridge between the two. Every kind the shell
     can pass to drawChart() must resolve here, and build_report.py asserts
     exactly that against the built file.
     ========================================================================== */

  /** The bundle carried by the spec, or the one the page already published. */
  function specBundle(spec) {
    return (spec && spec.bundle) || global.BUNDLE || null;
  }

  function armBars(container, spec) {
    var b = specBundle(spec);
    if (!container || !b) { return false; }
    verdict(container, b, { chrome: false, scope: (spec && spec.scope) || 'visible' });
    return true;
  }

  function errorOverTime(container, spec) {
    var b = specBundle(spec);
    if (!container || !b) { return false; }
    var key = spec && spec.episodeKey;
    if (!key && spec && spec.episodes && spec.episodes.length) { key = spec.episodes[0].key; }
    if (!key) { return false; }
    predictionError(container, b, { chrome: false, episodeKey: key });
    return true;
  }

  function scenarioGrid(container, spec) {
    var b = specBundle(spec);
    if (!container || !b) { return false; }
    scenarioTable(container, b, { chrome: false, onSelect: spec && spec.onSelect });
    return true;
  }

  function feedbackPairsChart(container, spec) {
    var b = specBundle(spec);
    if (!container || !b) { return false; }
    feedbackPairs(container, b, { chrome: false });
    return true;
  }

  function controlsChart(container, spec) {
    var b = specBundle(spec);
    if (!container || !b) { return false; }
    controls(container, b, { chrome: false });
    return true;
  }

  function probesChart(container, spec) {
    var b = specBundle(spec);
    if (!container || !b) { return false; }
    probes(container, b, { chrome: false });
    return true;
  }

  /* Kind names are chosen so their camel-cased form never collides with the
     documented explicit-signature API above: drawChart() tries the kind, then
     its camel form, then render(), and a collision would hand a spec object to
     a function expecting a bundle. */
  var RENDERERS = {
    arm_bars: armBars,
    error_over_time: errorOverTime,
    scenario_grid: scenarioGrid,
    feedback_pairs_chart: feedbackPairsChart,
    control_metrics: controlsChart,
    probe_table: probesChart
  };

  /** Generic entry point: spec.kind names the chart. Unknown kind -> false. */
  function render(container, spec) {
    var kind = spec && spec.kind;
    var fn = kind ? RENDERERS[kind] : null;
    if (typeof fn !== 'function') { return false; }
    return fn(container, spec);
  }

  /* ==========================================================================
     11. Export
     ========================================================================== */

  var Charts = {
    /* Spec-shaped, dispatched by the shell (drawChart camel-cases the kind). */
    render: render,
    armBars: armBars,
    errorOverTime: errorOverTime,
    /* Explicit signatures (container, bundle, opts) - the documented API. */
    verdict: verdict,
    scenarioTable: scenarioTable,
    predictionError: predictionError,
    feedbackPairs: feedbackPairs,
    controls: controls,
    probes: probes,
    kinds: function () {
      var out = [], k;
      for (k in RENDERERS) { if (RENDERERS.hasOwnProperty(k)) { out.push(k); } }
      return out;
    },
    setLanguage: function (lang) { forcedLang = lang || null; },
    t: t,
    _pure: P
  };

  global.Charts = Charts;

})(typeof window !== 'undefined' ? window : this);
