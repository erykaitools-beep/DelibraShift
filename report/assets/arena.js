/**
 * DelibraShift / Windrift - arena replay player (canvas 2D).
 *
 * The arena answers one question at a glance: did the model steer at where the
 * craft WILL be, or at where it WAS? An action returned at tick T only latches
 * at T + B; during those B simulated ticks the craft keeps flying under the
 * previously latched action. So the player draws a pair: the solid craft (what
 * the simulator did) and a dashed ghost (what the model claimed would happen),
 * joined by an error connector once the engage tick arrives.
 *
 * Public API (window.Arena):
 *   Arena.mount(canvasEl, opts)          -> instance
 *   instance.load(episodeKey)
 *   instance.play() / pause() / toggle()
 *   instance.seek(tick) / seekCycle(i) / step(deltaTicks)
 *   instance.setSpeed(multiplier)        -> playback rate in simulated ticks
 *   instance.setOverlay(episodeKey|null) -> second episode, translucent
 *   instance.setRevealHiddenGoal(bool)   -> expert switch for masked scenarios
 *   instance.setWind/ setGhost/ setTrail/ setHud (bool)
 *   instance.on(evt, cb) / off(evt, cb)  -> 'tick' | 'load' | 'state' | 'end'
 *   instance.refresh()                   -> re-read tokens + strings, repaint
 *   instance.getState() / destroy()
 *
 * Contracts honoured here:
 *   - No user-visible string is written in this file. Copy comes from
 *     assets/strings.js via T() (window.App.t when the shell provides it).
 *   - No literal colour, dash, size or duration. Everything is read from the
 *     CSS custom properties in assets/tokens.css, so a theme switch is picked
 *     up without touching script.
 *   - null is never drawn as 0. A missing prediction draws a struck-through
 *     thinking bubble with its own label, not a ghost at the origin.
 *   - Replay advances in SIMULATED ticks via requestAnimationFrame. The host
 *     wall clock in the log never drives the picture (a faster server must not
 *     buy a nicer replay).
 *   - No emoji. Sprite geometry mirrors assets/sprites.svg path data exactly.
 *
 * Pure helpers are exported as Arena._pure so they can be unit tested in node
 * with no DOM (see tests/test_arena_pure.js).
 */
(function (global) {
  'use strict';

  /* =====================================================================
   * 0. Sprite geometry - copied verbatim from assets/sprites.svg
   *    Craft, flame and ghost share the frame "-16 -10 32 20": origin at the
   *    craft's centre of mass, nose pointing +X. Interface marks use a
   *    24 x 24 frame centred on (12, 12).
   * ===================================================================== */

  var SPRITE = {
    craftFrame: 32,
    craft: [
      'M 12.5 0 C 9 -4 3.5 -5.6 -2.5 -5.4 C -6.5 -5.2 -9 -3.8 -9.8 -2.6 ' +
        'L -9.8 2.6 C -9 3.8 -6.5 5.2 -2.5 5.4 C 3.5 5.6 9 4 12.5 0 Z',
      'M 7.2 -3.2 C 5.4 -4.6 2.6 -5.1 0.4 -4.9 L 1.2 -1.6 ' +
        'C 3.6 -1.8 5.8 -2.4 7.2 -3.2 Z',
      'M 0.16 5.37 L -6.4 8.4 L 2.6 8.4 L 3.55 4.92',
      'M -5.69 -4.93 L -9.6 -8.6 L -12.2 -8.6 L -8.89 -3.52',
      'M -9.8 -2.6 L -12.6 -1.9 L -12.6 1.9 L -9.8 2.6'
    ],
    craftPorthole: { cx: -2.2, cy: 0.2, r: 1.7 },
    ghost: [
      'M 12.5 0 C 9 -4 3.5 -5.6 -2.5 -5.4 C -6.5 -5.2 -9 -3.8 -9.8 -2.6 ' +
        'L -9.8 2.6 C -9 3.8 -6.5 5.2 -2.5 5.4 C 3.5 5.6 9 4 12.5 0 Z',
      'M 0.16 5.37 L -6.4 8.4 L 2.6 8.4 L 3.55 4.92',
      'M -5.69 -4.93 L -9.6 -8.6 L -12.2 -8.6 L -8.89 -3.52'
    ],
    flame: [
      'M -12.5 -1.9 C -14.2 -1.5 -15.2 -0.8 -15.6 0 ' +
        'C -15.2 0.8 -14.2 1.5 -12.5 1.9 Z',
      'M -12.7 -0.9 C -13.5 -0.65 -14 -0.35 -14.3 0 ' +
        'C -14 0.35 -13.5 0.65 -12.7 0.9 Z'
    ],
    thinkFrame: 24,
    think: [
      'M 6.8 14.2 A 3.1 3.1 0 0 1 7.5 8.2 A 3.7 3.7 0 0 1 14.4 6.6 ' +
        'A 3.3 3.3 0 0 1 18.2 11.1 A 3.1 3.1 0 0 1 16.4 14.2 Z'
    ],
    thinkDots: [
      { cx: 7.4, cy: 17.9, r: 1.3 },
      { cx: 4.3, cy: 20.8, r: 0.9 }
    ]
  };

  /* Goal marker proportions, taken from the #cg-goal symbol (24 frame):
   * outer ring r 8.5, inner ring r 4, crosshair ticks between 7 and 10.5 from
   * the centre, centre dot r 1.2. Expressed as fractions of the outer ring so
   * the marker can be scaled to goal_radius_m or to --goal-r-min. */
  var GOAL_MARK = {
    inner: 4 / 8.5,
    tickInner: 7 / 8.5,
    tickOuter: 10.5 / 8.5,
    dot: 1.2 / 8.5
  };

  /* Iso-heat levels drawn as rings around the goal (spec/DESIGN.md 7.2). */
  var HEAT_RINGS = [0.75, 0.5, 0.25];

  /* Names of the CSS custom properties the renderer consumes. Values live in
   * assets/tokens.css and are never duplicated here. */
  var COLOR_TOKENS = [
    '--c-arena', '--c-arena-vignette', '--c-grid', '--c-grid-major',
    '--c-bounds', '--c-oob', '--c-deadline', '--c-goal', '--c-goal-hidden',
    '--c-heat-0', '--c-heat-1', '--c-heat-2', '--c-heat-3', '--c-heat-4',
    '--c-heat-ring', '--c-wind', '--c-wind-strong', '--c-path',
    '--c-path-trail', '--c-error', '--c-retry', '--c-retry-bg',
    '--c-accent', '--c-accent-quiet', '--c-accent-line',
    '--c-arm-e2e', '--c-arm-wm', '--c-text-1', '--c-text-2', '--c-text-3',
    '--c-surface-1', '--c-surface-3', '--c-border', '--c-unmeasurable',
    '--c-crosshair', '--c-commanded', '--c-velocity'
  ];

  var NUMBER_TOKENS = [
    '--arena-pad', '--arena-grid-step', '--arena-grid-major',
    '--craft-len', '--ghost-len', '--goal-r-min', '--bead-r',
    '--bead-r-active', '--sw-craft', '--sw-path', '--sw-path-future',
    '--sw-ghost', '--sw-error', '--sw-wind', '--sw-bound', '--sw-grid',
    '--c-ghost-alpha', '--dur-beat', '--dur-3', '--fs-1', '--fs-2', '--fs-3'
  ];

  var DASH_TOKENS = [
    '--dash-ghost', '--dash-error', '--dash-future', '--dash-deadline',
    '--dash-bound'
  ];

  /* =====================================================================
   * 1. Pure helpers - no DOM, no globals, no side effects.
   *    Exported as Arena._pure and unit tested in node.
   * ===================================================================== */

  function clamp(value, lo, hi) {
    if (!isFiniteNumber(value)) { return lo; }
    if (value < lo) { return lo; }
    if (value > hi) { return hi; }
    return value;
  }

  function lerp(a, b, k) {
    return a + (b - a) * k;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function hypot(x, y) {
    var a = isFiniteNumber(x) ? x : 0;
    var b = isFiniteNumber(y) ? y : 0;
    return Math.sqrt(a * a + b * b);
  }

  /**
   * Fill {placeholders} in a string. Unknown placeholders are left untouched
   * so a missing value is visible rather than silently blank.
   */
  function interpolate(template, vars) {
    if (typeof template !== 'string' || !vars) { return template; }
    return template.replace(/\{(\w+)\}/g, function (whole, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) &&
        vars[name] !== null && vars[name] !== undefined
        ? String(vars[name])
        : whole;
    });
  }

  /**
   * Convert a CSS length token ("28px", "0.6875rem", "1.5") to pixels.
   * Unitless values pass through, which is what the stroke-width tokens are.
   */
  function cssLengthToPx(value, rootFontSizePx) {
    if (typeof value === 'number') { return isFiniteNumber(value) ? value : 0; }
    if (typeof value !== 'string') { return 0; }
    var text = value.trim();
    if (!text) { return 0; }
    var num = parseFloat(text);
    if (!isFiniteNumber(num)) { return 0; }
    var root = isFiniteNumber(rootFontSizePx) && rootFontSizePx > 0
      ? rootFontSizePx : 16;
    if (/rem\s*$/.test(text) || /em\s*$/.test(text)) { return num * root; }
    return num;
  }

  /** Parse a dash token ("4 3.5" or "4,3.5") into a canvas dash array. */
  function parseDash(value) {
    if (typeof value !== 'string') { return []; }
    var parts = value.trim().split(/[\s,]+/);
    var out = [];
    for (var i = 0; i < parts.length; i += 1) {
      var n = parseFloat(parts[i]);
      if (isFiniteNumber(n)) { out.push(n); }
    }
    return out;
  }

  /**
   * Screen mapping. One canvas pixel is one CSS pixel; the world rectangle is
   * centred inside the canvas with `pad` reserved for axis labels. Screen y is
   * flipped so world y = 0 sits at the bottom.
   */
  function computeView(width, height, pad, world) {
    var w = world || { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    var spanX = Math.max(1e-9, w.maxX - w.minX);
    var spanY = Math.max(1e-9, w.maxY - w.minY);
    var availW = Math.max(1, width - 2 * pad);
    var availH = Math.max(1, height - 2 * pad);
    var scale = Math.min(availW / spanX, availH / spanY);
    var fieldW = spanX * scale;
    var fieldH = spanY * scale;
    return {
      scale: scale,
      originX: (width - fieldW) / 2,
      originY: (height - fieldH) / 2 + fieldH,
      fieldW: fieldW,
      fieldH: fieldH,
      width: width,
      height: height,
      pad: pad,
      world: w
    };
  }

  function worldToScreen(x, y, view) {
    return {
      x: view.originX + (x - view.world.minX) * view.scale,
      y: view.originY - (y - view.world.minY) * view.scale
    };
  }

  function screenToWorld(px, py, view) {
    return {
      x: view.world.minX + (px - view.originX) / view.scale,
      y: view.world.minY + (view.originY - py) / view.scale
    };
  }

  /** heat = exp(-distance / HEAT_SCALE_M) */
  function heatAtDistance(distanceM, heatScaleM) {
    var s = isFiniteNumber(heatScaleM) && heatScaleM > 0 ? heatScaleM : 20;
    if (!isFiniteNumber(distanceM) || distanceM < 0) { return null; }
    return Math.exp(-distanceM / s);
  }

  /** Inverse: the radii, in metres, of the iso-heat rings. */
  function heatRingRadii(levels, heatScaleM) {
    var s = isFiniteNumber(heatScaleM) && heatScaleM > 0 ? heatScaleM : 20;
    var out = [];
    for (var i = 0; i < levels.length; i += 1) {
      var h = levels[i];
      if (isFiniteNumber(h) && h > 0 && h < 1) {
        out.push({ heat: h, radiusM: -s * Math.log(h) });
      }
    }
    return out;
  }

  /** Index episodes and scenarios of a bundle by id. Pure lookup tables. */
  function indexBundle(bundle) {
    var episodes = {};
    var byScenario = {};
    var list = (bundle && bundle.episodes) || [];
    for (var i = 0; i < list.length; i += 1) {
      var ep = list[i];
      if (!ep || !ep.key) { continue; }
      episodes[ep.key] = ep;
      if (!byScenario[ep.scenario_id]) { byScenario[ep.scenario_id] = []; }
      byScenario[ep.scenario_id].push(ep.key);
    }
    return {
      episodes: episodes,
      byScenario: byScenario,
      scenarios: (bundle && bundle.scenarios) || {}
    };
  }

  /**
   * Which decision cycle governs this tick? The last cycle whose tick has
   * already happened. Returns -1 before the first cycle.
   */
  function cycleIndexForTick(cycles, tick) {
    if (!cycles || !cycles.length || !isFiniteNumber(tick)) { return -1; }
    var lo = 0;
    var hi = cycles.length - 1;
    var found = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (cycles[mid].tick <= tick) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found;
  }

  function cycleAtTick(cycles, tick) {
    var i = cycleIndexForTick(cycles, tick);
    return i < 0 ? null : cycles[i];
  }

  /** 0 at the moment the model starts thinking, 1 when its action latches. */
  function deliberationProgress(cycle, tick) {
    if (!cycle) { return 0; }
    var span = cycle.engage_tick - cycle.tick;
    if (!isFiniteNumber(span) || span <= 0) { return 1; }
    return clamp((tick - cycle.tick) / span, 0, 1);
  }

  /**
   * Phase of the replay at this tick.
   *   'idle'         - before the first cycle
   *   'deliberating' - the model is thinking, the OLD action still drives
   *   'latched'      - the action of this cycle is in force
   *   'ended'        - past the final tick of the episode
   */
  function phaseForTick(cycles, tick, finalTick) {
    if (isFiniteNumber(finalTick) && tick >= finalTick) { return 'ended'; }
    var cycle = cycleAtTick(cycles, tick);
    if (!cycle) { return 'idle'; }
    return tick < cycle.engage_tick ? 'deliberating' : 'latched';
  }

  /** Linear interpolation between two trajectory samples. */
  function interpState(a, b, k) {
    if (!a) { return b || null; }
    if (!b) { return a; }
    return {
      x: lerp(a.x, b.x, k),
      y: lerp(a.y, b.y, k),
      vx: lerp(a.vx, b.vx, k),
      vy: lerp(a.vy, b.vy, k),
      wind: lerp(a.wind, b.wind, k),
      heat: lerp(a.heat, b.heat, k),
      dist: lerp(a.dist, b.dist, k)
    };
  }

  function sampleAt(traj, index) {
    return {
      x: traj.x[index],
      y: traj.y[index],
      vx: traj.vx[index],
      vy: traj.vy[index],
      wind: traj.wind[index],
      heat: traj.heat[index],
      dist: traj.dist[index]
    };
  }

  /**
   * State at a fractional tick, interpolated from the columnar trajectory.
   * Clamped at both ends: seeking past the crash does not invent a state.
   */
  function stateAtTick(traj, tick) {
    if (!traj || !traj.t || !traj.t.length) { return null; }
    var t = traj.t;
    var last = t.length - 1;
    if (!isFiniteNumber(tick) || tick <= t[0]) { return sampleAt(traj, 0); }
    if (tick >= t[last]) { return sampleAt(traj, last); }
    var lo = 0;
    var hi = last;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (t[mid] <= tick) { lo = mid; } else { hi = mid; }
    }
    var span = t[hi] - t[lo];
    var k = span > 0 ? (tick - t[lo]) / span : 0;
    return interpState(sampleAt(traj, lo), sampleAt(traj, hi), k);
  }

  /**
   * What the prediction layer should draw for this cycle.
   * A cycle with predicted === null is NOT a ghost at the origin; it is an
   * explicit 'no_prediction' state that the renderer draws as a struck-through
   * thinking bubble with its own label.
   */
  function predictionMark(cycle) {
    if (!cycle) { return { state: 'none', predicted: null, truth: null }; }
    if (!cycle.predicted) {
      return {
        state: 'no_prediction',
        predicted: null,
        truth: cycle.truth_at_engage || null,
        errorM: null
      };
    }
    return {
      state: cycle.truth_at_engage ? 'ok' : 'no_truth',
      predicted: cycle.predicted,
      truth: cycle.truth_at_engage || null,
      errorM: isFiniteNumber(cycle.pred_pos_error_m) ? cycle.pred_pos_error_m : null
    };
  }

  /**
   * Opacity of the ghost and of the error connector at this tick.
   * The ghost fades in while the model thinks, the connector appears the
   * moment the action latches, and both fade out afterwards. With
   * opts.instant (prefers-reduced-motion) the same states are reached without
   * any ramp: they simply switch on and off.
   */
  function predictionVisibility(cycle, tick, opts) {
    var o = opts || {};
    var fadeIn = isFiniteNumber(o.fadeInTicks) ? o.fadeInTicks : 4;
    var hold = isFiniteNumber(o.holdTicks) ? o.holdTicks : 8;
    var instant = !!o.instant;
    var res = {
      ghost: 0,
      error: 0,
      phase: 'none',
      hasPrediction: !!(cycle && cycle.predicted),
      hasTruth: !!(cycle && cycle.truth_at_engage)
    };
    if (!cycle || !isFiniteNumber(tick)) { return res; }
    var t0 = cycle.tick;
    var te = cycle.engage_tick;
    if (tick < t0) { res.phase = 'before'; return res; }
    if (tick < te) {
      res.phase = 'thinking';
      if (res.hasPrediction) {
        res.ghost = instant ? 1 : clamp((tick - t0) / Math.max(1e-6, fadeIn), 0, 1);
      }
      return res;
    }
    var over = tick - te;
    if (over > hold) { res.phase = 'gone'; return res; }
    res.phase = 'engaged';
    var k = instant ? 1 : 1 - clamp(over / Math.max(1e-6, hold), 0, 1);
    if (res.hasPrediction) { res.ghost = k; }
    if (res.hasTruth && res.hasPrediction) { res.error = k; }
    return res;
  }

  /** The error connector in world coordinates, or null when unmeasurable. */
  function errorSegment(cycle) {
    var mark = predictionMark(cycle);
    if (mark.state !== 'ok') { return null; }
    return {
      from: { x: mark.predicted.x, y: mark.predicted.y },
      to: { x: mark.truth.x, y: mark.truth.y },
      lengthM: mark.errorM
    };
  }

  function accelMagnitude(action) {
    if (!action) { return 0; }
    return hypot(action.ax, action.ay);
  }

  /**
   * Flame length as a fraction of the sprite: |accel| / max_accel, clamped.
   * Exactly 0 means the model commanded nothing, and the renderer then omits
   * the flame entirely - an idle engine is a finding, not a rendering gap.
   */
  function flameScale(action, maxAccel) {
    var mag = accelMagnitude(action);
    if (mag <= 0) { return 0; }
    var max = isFiniteNumber(maxAccel) && maxAccel > 0 ? maxAccel : 1;
    return clamp(mag / max, 0, 1);
  }

  /**
   * Screen-space heading of a world vector; screen y is already flipped.
   * Negative zero is normalised away so a due-west vector reads 180, not -180.
   */
  function vectorAngleDeg(vx, vy) {
    var x = isFiniteNumber(vx) ? vx : 0;
    var y = isFiniteNumber(vy) ? vy : 0;
    if (x === 0 && y === 0) { return 0; }
    return Math.atan2(y === 0 ? 0 : -y, x) * 180 / Math.PI;
  }

  /** Pixel length of an action arrow: proportional to |a| / max_accel. */
  function vectorPixels(action, maxAccel, maxPixels) {
    var k = flameScale(action, maxAccel);
    return k * (isFiniteNumber(maxPixels) ? maxPixels : 0);
  }

  /** Wind acceleration at a tick, clamped to the ends of the curve. */
  function windAtTick(curve, tick) {
    if (!curve || !curve.length) { return 0; }
    var i = Math.round(clamp(tick, 0, curve.length - 1));
    var v = curve[i];
    return isFiniteNumber(v) ? v : 0;
  }

  function maxAbs(values) {
    var m = 0;
    for (var i = 0; i < (values ? values.length : 0); i += 1) {
      var v = Math.abs(values[i]);
      if (isFiniteNumber(v) && v > m) { m = v; }
    }
    return m;
  }

  /**
   * Advance the replay head in SIMULATED time.
   * dtSeconds is real elapsed time; ticksPerSecond * speed converts it into
   * simulated ticks. Never reads anything from the log's wall clock.
   */
  function advanceTick(currentTick, dtSeconds, ticksPerSecond, speed, maxTick) {
    var dt = isFiniteNumber(dtSeconds) ? Math.max(0, dtSeconds) : 0;
    var rate = (isFiniteNumber(ticksPerSecond) ? ticksPerSecond : 0) *
      (isFiniteNumber(speed) ? speed : 1);
    var next = (isFiniteNumber(currentTick) ? currentTick : 0) + dt * rate;
    var limit = isFiniteNumber(maxTick) ? maxTick : Infinity;
    if (next >= limit) { return { tick: limit, ended: true }; }
    return { tick: next, ended: false };
  }

  /**
   * Ticks per second for the "beat" pacing of spec/DESIGN.md section 6: one
   * deliberation window per --dur-beat, so B ticks take exactly one beat.
   */
  function beatTicksPerSecond(deliberationTicks, beatMs) {
    var b = isFiniteNumber(deliberationTicks) && deliberationTicks > 0
      ? deliberationTicks : 20;
    var ms = isFiniteNumber(beatMs) && beatMs > 0 ? beatMs : 700;
    return b / (ms / 1000);
  }

  /* ---- timeline geometry (pure) --------------------------------------- */

  function timelineGeometry(width, height, padX) {
    var p = isFiniteNumber(padX) ? padX : 10;
    var x0 = p;
    var x1 = Math.max(p + 1, width - p);
    return {
      x0: x0,
      x1: x1,
      width: width,
      height: height,
      midY: Math.round(height * 0.42) + 0.5,
      trackH: Math.max(4, Math.round(height * 0.16))
    };
  }

  function tickToX(tick, maxTick, geo) {
    var span = isFiniteNumber(maxTick) && maxTick > 0 ? maxTick : 1;
    return geo.x0 + clamp(tick / span, 0, 1) * (geo.x1 - geo.x0);
  }

  function xToTick(px, maxTick, geo) {
    var span = isFiniteNumber(maxTick) && maxTick > 0 ? maxTick : 1;
    var k = (px - geo.x0) / Math.max(1e-6, geo.x1 - geo.x0);
    return clamp(k, 0, 1) * span;
  }

  /**
   * Everything the time bar needs, derived once per episode: one mark per
   * decision, the deliberation bands, where the flight actually stopped and
   * where the deadline was. The gap between the two is the point: flights end
   * at tick 65-169 against deadlines of 380-600.
   */
  function timelineMarks(episode, scenario) {
    var cycles = (episode && episode.cycles) || [];
    var marks = [];
    for (var i = 0; i < cycles.length; i += 1) {
      var c = cycles[i];
      marks.push({
        index: i,
        cycle: c.cycle,
        tick: c.tick,
        engageTick: c.engage_tick,
        truncated: !!c.truncated,
        parseFailed: !!c.parse_failed,
        predictionMissing: !c.predicted
      });
    }
    var finalTick = episode && isFiniteNumber(episode.final_tick)
      ? episode.final_tick : 0;
    var deadline = scenario && isFiniteNumber(scenario.deadline_tick)
      ? scenario.deadline_tick : finalTick;
    return {
      marks: marks,
      finalTick: finalTick,
      deadlineTick: deadline,
      maxTick: Math.max(finalTick, deadline, 1),
      endedEarly: deadline > finalTick,
      outcome: (episode && episode.outcome) || 'unknown'
    };
  }

  /* ---- formatting (pure) ---------------------------------------------- */

  /** Fixed-point text, or null when there is nothing to show. Never "0". */
  function formatFixed(value, digits) {
    if (!isFiniteNumber(value)) { return null; }
    return value.toFixed(isFiniteNumber(digits) ? digits : 2);
  }

  function formatPair(a, b, digits) {
    var sa = formatFixed(a, digits);
    var sb = formatFixed(b, digits);
    if (sa === null || sb === null) { return null; }
    return sa + ' ' + sb;
  }

  function armColorToken(arm) {
    return arm === 'wm-scaffold' ? '--c-arm-wm' : '--c-arm-e2e';
  }

  function outcomeColorToken(outcome) {
    if (outcome === 'goal') { return '--c-goal'; }
    if (outcome === 'timeout') { return '--c-deadline'; }
    return '--c-oob';
  }

  function outcomeStringKey(outcome) {
    if (outcome === 'goal' || outcome === 'oob' || outcome === 'timeout') {
      return 'outcome.' + outcome;
    }
    return 'outcome.unknown';
  }

  var PURE = {
    clamp: clamp,
    lerp: lerp,
    hypot: hypot,
    isFiniteNumber: isFiniteNumber,
    interpolate: interpolate,
    cssLengthToPx: cssLengthToPx,
    parseDash: parseDash,
    computeView: computeView,
    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    heatAtDistance: heatAtDistance,
    heatRingRadii: heatRingRadii,
    indexBundle: indexBundle,
    cycleIndexForTick: cycleIndexForTick,
    cycleAtTick: cycleAtTick,
    deliberationProgress: deliberationProgress,
    phaseForTick: phaseForTick,
    interpState: interpState,
    stateAtTick: stateAtTick,
    predictionMark: predictionMark,
    predictionVisibility: predictionVisibility,
    errorSegment: errorSegment,
    accelMagnitude: accelMagnitude,
    flameScale: flameScale,
    vectorAngleDeg: vectorAngleDeg,
    vectorPixels: vectorPixels,
    windAtTick: windAtTick,
    maxAbs: maxAbs,
    advanceTick: advanceTick,
    beatTicksPerSecond: beatTicksPerSecond,
    timelineGeometry: timelineGeometry,
    tickToX: tickToX,
    xToTick: xToTick,
    timelineMarks: timelineMarks,
    formatFixed: formatFixed,
    formatPair: formatPair,
    armColorToken: armColorToken,
    outcomeColorToken: outcomeColorToken,
    outcomeStringKey: outcomeStringKey,
    HEAT_RINGS: HEAT_RINGS,
    GOAL_MARK: GOAL_MARK
  };

  /* =====================================================================
   * 2. Copy access. Every user-visible string comes from strings.js, through
   *    the shell when it is present, straight from the table otherwise.
   * ===================================================================== */

  function T(key, vars) {
    var app = global.App;
    if (app && typeof app.t === 'function') {
      return app.t(key, vars);
    }
    var doc = global.document;
    var lang = 'pl';
    if (doc && doc.documentElement) {
      var attr = doc.documentElement.getAttribute('lang');
      if (attr && global.STRINGS && global.STRINGS[attr]) { lang = attr; }
    }
    var table = global.STRINGS && (global.STRINGS[lang] || global.STRINGS.pl);
    var text = table && table[key];
    if (typeof text !== 'string') { return key; }
    return interpolate(text, vars);
  }

  /* =====================================================================
   * 3. Token reading. Colours, dashes and sizes come from tokens.css so a
   *    theme toggle or a texture switch changes the picture with no script.
   * ===================================================================== */

  function readTokens(rootEl, armEl) {
    var view = global.getComputedStyle ? global.getComputedStyle(rootEl) : null;
    var armView = (global.getComputedStyle && armEl)
      ? global.getComputedStyle(armEl) : view;
    var rootFont = view ? cssLengthToPx(view.fontSize, 16) : 16;
    var tokens = { color: {}, num: {}, dash: {}, rootFont: rootFont, font: {} };
    var i;
    for (i = 0; i < COLOR_TOKENS.length; i += 1) {
      var ck = COLOR_TOKENS[i];
      var src = (ck === '--c-path') ? armView : view;
      tokens.color[ck] = src ? String(src.getPropertyValue(ck)).trim() : '';
    }
    for (i = 0; i < NUMBER_TOKENS.length; i += 1) {
      var nk = NUMBER_TOKENS[i];
      tokens.num[nk] = view
        ? cssLengthToPx(view.getPropertyValue(nk), rootFont) : 0;
    }
    for (i = 0; i < DASH_TOKENS.length; i += 1) {
      var dk = DASH_TOKENS[i];
      tokens.dash[dk] = view ? parseDash(view.getPropertyValue(dk)) : [];
    }
    tokens.font.mono = view
      ? String(view.getPropertyValue('--font-mono')).trim() : 'monospace';
    tokens.font.sans = view
      ? String(view.getPropertyValue('--font-sans')).trim() : 'sans-serif';
    /* Stroke-width tokens are unitless; cssLengthToPx passes them through. */
    if (!tokens.num['--c-ghost-alpha']) { tokens.num['--c-ghost-alpha'] = 0.62; }
    return tokens;
  }

  function color(tokens, name, fallbackName) {
    var v = tokens.color[name];
    if (v) { return v; }
    if (fallbackName) { return tokens.color[fallbackName] || ''; }
    return '';
  }

  function num(tokens, name, fallback) {
    var v = tokens.num[name];
    return isFiniteNumber(v) && v !== 0 ? v : fallback;
  }

  function fontOf(tokens, sizeToken, weight) {
    var px = num(tokens, sizeToken, 11);
    return (weight || '500') + ' ' + px.toFixed(2) + 'px ' + tokens.font.mono;
  }

  /* =====================================================================
   * 4. Canvas drawing primitives
   * ===================================================================== */

  var pathCache = null;

  function sprites() {
    if (pathCache) { return pathCache; }
    if (typeof global.Path2D !== 'function') { return null; }
    var make = function (list) {
      var out = [];
      for (var i = 0; i < list.length; i += 1) {
        out.push(new global.Path2D(list[i]));
      }
      return out;
    };
    pathCache = {
      craft: make(SPRITE.craft),
      ghost: make(SPRITE.ghost),
      flame: make(SPRITE.flame),
      think: make(SPRITE.think)
    };
    return pathCache;
  }

  function strokePaths(ctx, list) {
    if (!list) { return; }
    for (var i = 0; i < list.length; i += 1) { ctx.stroke(list[i]); }
  }

  function circle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2);
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  /** Arrow with the tail at (x, y), pointing along angleRad, length px. */
  function arrow(ctx, x, y, angleRad, length, headLen) {
    if (length <= 0.5) { return; }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angleRad);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, 0);
    var h = Math.min(headLen, length * 0.6);
    ctx.moveTo(length, 0);
    ctx.lineTo(length - h, -h * 0.55);
    ctx.moveTo(length, 0);
    ctx.lineTo(length - h, h * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  /** Diamond bead used for decision points, on the path and on the time bar. */
  function diamond(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  }

  /** Question mark, drawn as vector paths - the goal the model cannot see. */
  function questionMark(ctx, x, y, size) {
    var k = size / 24;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.arc(0, -4, 3.6, Math.PI, Math.PI / 3, false);
    ctx.quadraticCurveTo(1.7, 1.4, 0, 2.6);
    ctx.lineTo(0, 4.4);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 7.4, 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function textLine(ctx, text, x, y, font, fill, align) {
    if (text === null || text === undefined) { return; }
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(text), x, y);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /* =====================================================================
   * 5. The instance
   * ===================================================================== */

  function mount(canvasEl, opts) {
    if (!canvasEl || typeof canvasEl.getContext !== 'function') {
      throw new Error('Arena.mount requires a <canvas> element');
    }
    var options = opts || {};
    var doc = canvasEl.ownerDocument || global.document;
    var rootEl = doc.documentElement;
    var ctx = canvasEl.getContext('2d');

    var state = {
      bundle: options.bundle || global.BUNDLE || null,
      index: null,
      episode: null,
      scenario: null,
      overlay: null,
      tick: 0,
      maxTick: 1,
      playing: false,
      speed: isFiniteNumber(options.speed) ? options.speed : 1,
      ticksPerSecond: isFiniteNumber(options.ticksPerSecond)
        ? options.ticksPerSecond : 60,
      pacing: options.pacing === 'beat' ? 'beat' : 'fixed',
      showWind: options.wind !== false,
      showGhost: options.ghost !== false,
      showTrail: options.trail !== false,
      showHud: options.hud !== false,
      revealHiddenGoal: !!options.revealHiddenGoal,
      loop: !!options.loop,
      endFlash: 0,
      tokens: null,
      view: null,
      cssW: 0,
      cssH: 0,
      dpr: 1,
      dirtyStatic: true,
      raf: 0,
      flashRaf: 0,
      lastFrameMs: 0,
      current: null,
      destroyed: false
    };

    var listeners = {};
    var layer = doc.createElement('canvas');
    var layerCtx = layer.getContext('2d');

    var reducedMotionQuery = global.matchMedia
      ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;

    function reducedMotion() {
      return !!(reducedMotionQuery && reducedMotionQuery.matches);
    }

    /* ---- events ------------------------------------------------------ */

    function on(evt, cb) {
      if (typeof cb !== 'function') { return instance; }
      if (!listeners[evt]) { listeners[evt] = []; }
      listeners[evt].push(cb);
      return instance;
    }

    function off(evt, cb) {
      var list = listeners[evt];
      if (!list) { return instance; }
      for (var i = list.length - 1; i >= 0; i -= 1) {
        if (list[i] === cb) { list.splice(i, 1); }
      }
      return instance;
    }

    function emit(evt, payload) {
      var list = listeners[evt];
      if (!list) { return; }
      for (var i = 0; i < list.length; i += 1) {
        try {
          list[i](payload);
        } catch (err) {
          if (global.console && global.console.error) {
            global.console.error('Arena listener failed', err);
          }
        }
      }
    }

    /* ---- data -------------------------------------------------------- */

    function ensureIndex() {
      if (!state.index) {
        state.bundle = state.bundle || global.BUNDLE || null;
        state.index = indexBundle(state.bundle);
      }
      return state.index;
    }

    function episodeByKey(key) {
      var idx = ensureIndex();
      return (key && idx.episodes[key]) || null;
    }

    function scenarioOf(episode) {
      var idx = ensureIndex();
      return (episode && idx.scenarios[episode.scenario_id]) || null;
    }

    function worldOf(scenario) {
      if (!scenario) { return { minX: 0, maxX: 100, minY: 0, maxY: 100 }; }
      return {
        minX: isFiniteNumber(scenario.bounds_min_x_m) ? scenario.bounds_min_x_m : 0,
        maxX: isFiniteNumber(scenario.bounds_max_x_m) ? scenario.bounds_max_x_m : 100,
        minY: isFiniteNumber(scenario.bounds_min_y_m) ? scenario.bounds_min_y_m : 0,
        maxY: isFiniteNumber(scenario.bounds_max_y_m) ? scenario.bounds_max_y_m : 100
      };
    }

    /**
     * The replay head spans the longer of the two flights on screen. With an
     * overlay, the arm that died first stays frozen at its own crash while the
     * other flies on - which is exactly the comparison worth watching.
     */
    function recomputeMaxTick() {
      var main = state.episode && isFiniteNumber(state.episode.final_tick)
        ? state.episode.final_tick : 0;
      var over = state.overlay && isFiniteNumber(state.overlay.final_tick)
        ? state.overlay.final_tick : 0;
      state.maxTick = Math.max(main, over);
      if (state.tick > state.maxTick) { state.tick = state.maxTick; }
    }

    function constants() {
      var c = (state.bundle && state.bundle.constants) || {};
      return {
        heatScale: isFiniteNumber(c.HEAT_SCALE_M) ? c.HEAT_SCALE_M : 20
      };
    }

    /* ---- sizing ------------------------------------------------------ */

    function measure() {
      var rect = canvasEl.getBoundingClientRect();
      var rawW = rect.width || canvasEl.clientWidth || 0;
      var rawH = rect.height || canvasEl.clientHeight || 0;
      /* Clamping a collapsed box to one pixel makes the arena "work" while
         drawing nothing, which is the hardest kind of bug to notice. Say it
         once instead. */
      if ((rawW < 2 || rawH < 2) && !state.warnedDegenerate) {
        state.warnedDegenerate = true;
        if (global.console && global.console.warn) {
          global.console.warn('arena: canvas box measured ' + rawW + 'x' + rawH +
            ' - nothing can be drawn into it');
        }
      }
      var w = Math.max(1, Math.round(rawW || 1));
      var h = Math.max(1, Math.round(rawH || 1));
      var dpr = Math.min(global.devicePixelRatio || 1, 3);
      if (w === state.cssW && h === state.cssH && dpr === state.dpr) { return false; }
      state.cssW = w;
      state.cssH = h;
      state.dpr = dpr;
      canvasEl.width = Math.round(w * dpr);
      canvasEl.height = Math.round(h * dpr);
      layer.width = canvasEl.width;
      layer.height = canvasEl.height;
      state.dirtyStatic = true;
      return true;
    }

    function updateView() {
      var pad = num(state.tokens, '--arena-pad', 28);
      state.view = computeView(state.cssW, state.cssH, pad, worldOf(state.scenario));
    }

    /* ---- static layer: surface, heat, grid, bounds, goal, whole route -- */

    function paintStatic() {
      var c = layerCtx;
      var tk = state.tokens;
      var view = state.view;
      c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      c.clearRect(0, 0, state.cssW, state.cssH);
      c.fillStyle = color(tk, '--c-arena');
      c.fillRect(0, 0, state.cssW, state.cssH);
      if (!state.episode || !view) { return; }

      var sc = state.scenario;
      var world = view.world;
      var tl = worldToScreen(world.minX, world.maxY, view);
      var br = worldToScreen(world.maxX, world.minY, view);
      var fieldX = tl.x;
      var fieldY = tl.y;
      var fieldW = br.x - tl.x;
      var fieldH = br.y - tl.y;

      /* --- heat field: the only trace of a hidden goal ---------------- */
      c.save();
      c.beginPath();
      c.rect(fieldX, fieldY, fieldW, fieldH);
      c.clip();
      if (sc && isFiniteNumber(sc.goal_x_m)) {
        var g = worldToScreen(sc.goal_x_m, sc.goal_y_m, view);
        var heatScale = constants().heatScale;
        var outerM = heatScale * 3;
        var outerPx = outerM * view.scale;
        var grad = c.createRadialGradient(g.x, g.y, 0, g.x, g.y, Math.max(1, outerPx));
        var stops = [
          [0, '--c-heat-4'],
          [heatScale * Math.log(1 / 0.75) / outerM, '--c-heat-3'],
          [heatScale * Math.log(1 / 0.5) / outerM, '--c-heat-2'],
          [heatScale * Math.log(1 / 0.25) / outerM, '--c-heat-1'],
          [1, '--c-heat-0']
        ];
        for (var si = 0; si < stops.length; si += 1) {
          grad.addColorStop(clamp(stops[si][0], 0, 1), color(tk, stops[si][1]));
        }
        c.fillStyle = grad;
        c.fillRect(fieldX, fieldY, fieldW, fieldH);

        /* iso-heat rings */
        var rings = heatRingRadii(HEAT_RINGS, heatScale);
        c.strokeStyle = color(tk, '--c-heat-ring');
        c.lineWidth = num(tk, '--sw-grid', 1);
        for (var ri = 0; ri < rings.length; ri += 1) {
          circle(c, g.x, g.y, rings[ri].radiusM * view.scale);
          c.stroke();
        }
      }
      c.restore();

      /* --- grid ------------------------------------------------------- */
      var step = num(tk, '--arena-grid-step', 10);
      var major = num(tk, '--arena-grid-major', 50);
      c.save();
      c.lineWidth = num(tk, '--sw-grid', 1);
      var v;
      for (v = world.minX; v <= world.maxX + 1e-6; v += step) {
        var isMajor = Math.abs(v % major) < 1e-6;
        c.strokeStyle = color(tk, isMajor ? '--c-grid-major' : '--c-grid');
        var px = worldToScreen(v, 0, view).x;
        line(c, Math.round(px) + 0.5, fieldY, Math.round(px) + 0.5, fieldY + fieldH);
      }
      for (v = world.minY; v <= world.maxY + 1e-6; v += step) {
        var isMajorY = Math.abs(v % major) < 1e-6;
        c.strokeStyle = color(tk, isMajorY ? '--c-grid-major' : '--c-grid');
        var py = worldToScreen(0, v, view).y;
        line(c, fieldX, Math.round(py) + 0.5, fieldX + fieldW, Math.round(py) + 0.5);
      }
      c.restore();

      /* --- metre labels in the pad ------------------------------------ */
      var labelFont = fontOf(tk, '--fs-1', '500');
      var labelFill = color(tk, '--c-text-3');
      for (v = world.minX; v <= world.maxX + 1e-6; v += major) {
        var lx = worldToScreen(v, 0, view).x;
        textLine(c, String(Math.round(v)), lx, fieldY + fieldH + 14, labelFont,
          labelFill, 'center');
      }
      for (v = world.minY; v <= world.maxY + 1e-6; v += major) {
        var ly = worldToScreen(0, v, view).y;
        textLine(c, String(Math.round(v)), fieldX - 6, ly + 3, labelFont,
          labelFill, 'right');
      }

      /* --- boundary: where almost every flight ends -------------------
         Neutral on purpose. The edge is geometry, present in every frame;
         red is reserved for the moment a craft actually crosses it, so the
         alarm colour means something when it finally appears. */
      c.save();
      c.strokeStyle = color(tk, '--c-bounds');
      c.lineWidth = num(tk, '--sw-bound', 2);
      c.setLineDash(tk.dash['--dash-bound'] || []);
      c.globalAlpha = 0.75;
      c.strokeRect(fieldX, fieldY, fieldW, fieldH);
      c.restore();

      /* --- goal ------------------------------------------------------- */
      paintGoal(c);

      /* --- the whole route, pale: past and future at once ------------- */
      if (state.showTrail) {
        paintRoute(c, state.episode, color(tk, '--c-path-trail'),
          num(tk, '--sw-path-future', 1.5), tk.dash['--dash-future'] || []);
        if (state.overlay) {
          paintRoute(c, state.overlay, color(tk, '--c-path-trail'),
            num(tk, '--sw-path-future', 1.5), tk.dash['--dash-future'] || []);
        }
      }
    }

    function paintGoal(c) {
      var tk = state.tokens;
      var sc = state.scenario;
      var view = state.view;
      if (!sc || !isFiniteNumber(sc.goal_x_m)) { return; }
      var g = worldToScreen(sc.goal_x_m, sc.goal_y_m, view);
      var trueR = (isFiniteNumber(sc.goal_radius_m) ? sc.goal_radius_m : 0) * view.scale;
      var minR = num(tk, '--goal-r-min', 10);
      var r = Math.max(trueR, minR);
      var hidden = sc.goal_visible === false;
      var reveal = !hidden || state.revealHiddenGoal;

      c.save();
      c.lineWidth = num(tk, '--sw-craft', 1.5);
      if (!reveal) {
        /* The agent never saw this target: no disc, only an unknown. */
        c.strokeStyle = color(tk, '--c-goal-hidden');
        c.fillStyle = color(tk, '--c-goal-hidden');
        c.setLineDash(tk.dash['--dash-ghost'] || []);
        c.globalAlpha = 0.75;
        circle(c, g.x, g.y, r);
        c.stroke();
        c.setLineDash([]);
        questionMark(c, g.x, g.y, r * 1.25);
        c.restore();
        return;
      }

      var stroke = hidden ? color(tk, '--c-goal-hidden') : color(tk, '--c-goal');
      c.strokeStyle = stroke;
      c.fillStyle = stroke;
      if (hidden) { c.setLineDash(tk.dash['--dash-ghost'] || []); }
      circle(c, g.x, g.y, r);
      c.stroke();
      circle(c, g.x, g.y, r * GOAL_MARK.inner);
      c.stroke();
      c.setLineDash([]);
      var ti = r * GOAL_MARK.tickInner;
      var to = r * GOAL_MARK.tickOuter;
      line(c, g.x, g.y - ti, g.x, g.y - to);
      line(c, g.x, g.y + ti, g.x, g.y + to);
      line(c, g.x - ti, g.y, g.x - to, g.y);
      line(c, g.x + ti, g.y, g.x + to, g.y);
      /* the real capture disc, whatever the marker size */
      c.globalAlpha = 0.9;
      c.fillStyle = color(tk, '--c-heat-3');
      circle(c, g.x, g.y, Math.max(1, trueR));
      c.fill();
      c.globalAlpha = 1;
      c.fillStyle = stroke;
      circle(c, g.x, g.y, r * GOAL_MARK.dot);
      c.fill();
      c.restore();
    }

    function paintRoute(c, episode, stroke, width, dash) {
      var traj = episode && episode.trajectory;
      if (!traj || !traj.t || traj.t.length < 2) { return; }
      var view = state.view;
      c.save();
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.setLineDash(dash || []);
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.beginPath();
      for (var i = 0; i < traj.t.length; i += 1) {
        var p = worldToScreen(traj.x[i], traj.y[i], view);
        if (i === 0) { c.moveTo(p.x, p.y); } else { c.lineTo(p.x, p.y); }
      }
      c.stroke();
      c.restore();
    }

    /* ---- dynamic layer ---------------------------------------------- */

    function paintFlown(c, episode, tick, stroke, width, alpha) {
      var traj = episode && episode.trajectory;
      if (!traj || !traj.t || !traj.t.length) { return; }
      var view = state.view;
      c.save();
      c.globalAlpha = alpha;
      c.strokeStyle = stroke;
      c.lineWidth = width;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      c.beginPath();
      var started = false;
      var i;
      for (i = 0; i < traj.t.length && traj.t[i] <= tick; i += 1) {
        var p = worldToScreen(traj.x[i], traj.y[i], view);
        if (!started) { c.moveTo(p.x, p.y); started = true; } else { c.lineTo(p.x, p.y); }
      }
      if (started) {
        var head = stateAtTick(traj, tick);
        if (head) {
          var hp = worldToScreen(head.x, head.y, view);
          c.lineTo(hp.x, hp.y);
        }
        c.stroke();
      }
      c.restore();
    }

    function paintBeads(c, episode, tick, stroke) {
      var tk = state.tokens;
      var view = state.view;
      var cycles = (episode && episode.cycles) || [];
      var traj = episode && episode.trajectory;
      if (!traj) { return; }
      var r = num(tk, '--bead-r', 4.5);
      var rActive = num(tk, '--bead-r-active', 7);
      var active = cycleIndexForTick(cycles, tick);
      c.save();
      c.lineWidth = num(tk, '--sw-craft', 1.5);
      for (var i = 0; i < cycles.length; i += 1) {
        var cy = cycles[i];
        if (cy.tick > tick) { continue; }
        var st = stateAtTick(traj, cy.tick);
        if (!st) { continue; }
        var p = worldToScreen(st.x, st.y, view);
        var isActive = (i === active);
        c.setLineDash(cy.parse_failed ? (tk.dash['--dash-error'] || []) : []);
        c.strokeStyle = cy.parse_failed ? color(tk, '--c-retry') : stroke;
        c.fillStyle = isActive ? stroke : color(tk, '--c-arena');
        diamond(c, p.x, p.y, isActive ? rActive : r);
        c.fill();
        c.stroke();
      }
      c.restore();
    }

    function paintWind(c, tick) {
      var tk = state.tokens;
      var sc = state.scenario;
      var view = state.view;
      if (!sc || !sc.wind_curve || !sc.wind_curve.length) { return; }
      var wind = windAtTick(sc.wind_curve, tick);
      var peak = maxAbs(sc.wind_curve) || 1;
      var world = view.world;
      var cols = 6;
      var rows = 6;
      var maxLen = view.fieldW * 0.085;
      var len = Math.abs(wind) / peak * maxLen;
      if (len < 1) { return; }
      var dir = wind >= 0 ? 1 : -1;
      var craft = state.current && state.current.state;
      var craftRow = -1;
      var i;
      var j;
      var stepX = (world.maxX - world.minX) / (cols + 1);
      var stepY = (world.maxY - world.minY) / (rows + 1);
      if (craft) {
        craftRow = Math.round((craft.y - world.minY) / stepY) - 1;
      }
      c.save();
      c.lineWidth = num(tk, '--sw-wind', 1.25);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (j = 0; j < rows; j += 1) {
        var wy = world.minY + stepY * (j + 1);
        var strong = (j === craftRow);
        c.strokeStyle = color(tk, strong ? '--c-wind-strong' : '--c-wind');
        c.globalAlpha = strong ? 0.95 : 0.55;
        for (i = 0; i < cols; i += 1) {
          var wx = world.minX + stepX * (i + 1);
          var p = worldToScreen(wx, wy, view);
          arrow(c, p.x - dir * len / 2, p.y, dir > 0 ? 0 : Math.PI, len, 5);
        }
      }
      c.restore();
    }

    function paintTruth(c, cycle, alpha, stroke) {
      var tk = state.tokens;
      var view = state.view;
      if (!cycle || !cycle.truth_at_engage || alpha <= 0) { return; }
      var p = worldToScreen(cycle.truth_at_engage.x, cycle.truth_at_engage.y, view);
      var r = num(tk, '--bead-r-active', 7);
      c.save();
      c.globalAlpha = alpha;
      c.lineWidth = num(tk, '--sw-craft', 1.5);
      c.strokeStyle = stroke;
      c.fillStyle = color(tk, '--c-arena');
      circle(c, p.x, p.y, r);
      c.fill();
      c.stroke();
      c.fillStyle = stroke;
      circle(c, p.x, p.y, r * 0.42);
      c.fill();
      c.restore();
    }

    function paintErrorLine(c, cycle, alpha) {
      var tk = state.tokens;
      var view = state.view;
      var seg = errorSegment(cycle);
      if (!seg || alpha <= 0) { return; }
      var a = worldToScreen(seg.from.x, seg.from.y, view);
      var b = worldToScreen(seg.to.x, seg.to.y, view);
      c.save();
      c.globalAlpha = alpha;
      c.strokeStyle = color(tk, '--c-error');
      c.lineWidth = num(tk, '--sw-error', 1.5);
      c.setLineDash(tk.dash['--dash-error'] || []);
      line(c, a.x, a.y, b.x, b.y);
      c.setLineDash([]);
      c.fillStyle = color(tk, '--c-error');
      circle(c, b.x, b.y, 2.6);
      c.fill();
      /* The number the segment stands for, stated once. */
      var label = formatFixed(seg.lengthM, 2);
      if (label !== null) {
        var mx = (a.x + b.x) / 2;
        var my = (a.y + b.y) / 2;
        textLine(c, T('arena.label.error_value', { value: label }), mx + 8, my - 6,
          fontOf(tk, '--fs-1', '600'), color(tk, '--c-error'), 'left');
      }
      c.restore();
    }

    function paintGhost(c, cycle, alpha, stroke) {
      var tk = state.tokens;
      var view = state.view;
      if (!cycle || !cycle.predicted || alpha <= 0) { return; }
      var s = sprites();
      var p = worldToScreen(cycle.predicted.x, cycle.predicted.y, view);
      var lenPx = num(tk, '--ghost-len', 30);
      var k = lenPx / SPRITE.craftFrame;
      var deg = vectorAngleDeg(cycle.predicted.vx, cycle.predicted.vy);
      var ghostAlpha = alpha * num(tk, '--c-ghost-alpha', 0.62);
      c.save();
      c.globalAlpha = ghostAlpha;
      c.translate(p.x, p.y);
      c.rotate(deg * Math.PI / 180);
      c.scale(k, k);
      c.strokeStyle = stroke;
      c.lineWidth = num(tk, '--sw-ghost', 1.5) / k;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      var dash = tk.dash['--dash-ghost'] || [];
      c.setLineDash([(dash[0] / k) || 4, (dash[1] || 3.5) / k]);
      if (s) { strokePaths(c, s.ghost); }
      c.restore();

      c.save();
      c.globalAlpha = ghostAlpha;
      textLine(c, T('arena.short.ghost'), p.x, p.y - lenPx * 0.7,
        fontOf(tk, '--fs-1', '500'), stroke, 'center');
      c.restore();
    }

    function paintCraft(c, st, held, alpha, stroke, maxAccel) {
      var tk = state.tokens;
      var view = state.view;
      if (!st) { return; }
      var s = sprites();
      var p = worldToScreen(st.x, st.y, view);
      var lenPx = num(tk, '--craft-len', 30);
      var k = lenPx / SPRITE.craftFrame;
      var deg = vectorAngleDeg(st.vx, st.vy);
      c.save();
      c.globalAlpha = alpha;
      c.translate(p.x, p.y);
      c.rotate(deg * Math.PI / 180);
      c.scale(k, k);
      c.lineWidth = num(tk, '--sw-craft', 1.5) / k;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      /* Flame first, scaled by the latched thrust. No thrust, no flame. */
      var thrust = flameScale(held, maxAccel);
      if (thrust > 0 && s) {
        c.save();
        c.strokeStyle = color(tk, '--c-deadline');
        c.globalAlpha = alpha * 0.9;
        c.scale(Math.max(0.25, thrust), 1);
        strokePaths(c, s.flame);
        c.restore();
      }
      c.strokeStyle = stroke;
      if (s) {
        strokePaths(c, s.craft);
        circle(c, SPRITE.craftPorthole.cx, SPRITE.craftPorthole.cy,
          SPRITE.craftPorthole.r);
        c.stroke();
      }
      c.restore();
    }

    function paintVectors(c, st, held, commanded, stroke, maxAccel) {
      var tk = state.tokens;
      var view = state.view;
      if (!st) { return; }
      var p = worldToScreen(st.x, st.y, view);
      var maxPx = num(tk, '--craft-len', 30) * 1.6;
      c.save();
      c.lineWidth = num(tk, '--sw-wind', 1.25) + 0.5;
      c.strokeStyle = stroke;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      var lh = vectorPixels(held, maxAccel, maxPx);
      if (lh > 0) {
        c.setLineDash([]);
        c.globalAlpha = 1;
        arrow(c, p.x, p.y, vectorAngleDeg(held.ax, held.ay) * Math.PI / 180, lh, 6);
      }
      var lc = vectorPixels(commanded, maxAccel, maxPx);
      if (lc > 0) {
        /* The freshly returned action carries its own hue, not just a dash and
           a lower alpha: telling it apart from the latched one is the whole
           lesson of the picture, and dash plus opacity dies in greyscale. */
        c.setLineDash(tk.dash['--dash-ghost'] || []);
        c.globalAlpha = num(tk, '--c-ghost-alpha', 0.62);
        c.strokeStyle = color(tk, '--c-commanded');
        arrow(c, p.x, p.y,
          vectorAngleDeg(commanded.ax, commanded.ay) * Math.PI / 180, lc, 6);
      }
      /* Velocity: a second arrow, kept neutral so it never competes with the
         two action vectors. */
      c.setLineDash([]);
      c.globalAlpha = 1;
      c.strokeStyle = color(tk, '--c-velocity');
      var speed = hypot(st.vx, st.vy);
      if (speed > 0.05) {
        var vlen = clamp(speed / 30, 0, 1) * maxPx;
        arrow(c, p.x, p.y, vectorAngleDeg(st.vx, st.vy) * Math.PI / 180, vlen, 6);
      }
      c.restore();
    }

    function paintThinking(c, st, cycle, progress, hasPrediction) {
      var tk = state.tokens;
      var view = state.view;
      if (!st || !cycle) { return; }
      var s = sprites();
      var p = worldToScreen(st.x, st.y, view);
      var craftLen = num(tk, '--craft-len', 30);
      var size = craftLen * 0.8;
      var k = size / SPRITE.thinkFrame;
      /* Keep the bubble on screen even when the craft hugs an edge. */
      var bx = clamp(p.x + craftLen * 0.45, size, state.cssW - size * 2.4);
      var by = clamp(p.y - craftLen * 1.15, size * 0.6, state.cssH - size);
      var stroke = hasPrediction ? color(tk, '--c-accent') : color(tk, '--c-retry');
      c.save();
      c.globalAlpha = 0.55 + 0.45 * (reducedMotion() ? 1 : progress);
      c.translate(bx, by);
      c.scale(k, k);
      c.strokeStyle = stroke;
      c.fillStyle = stroke;
      c.lineWidth = num(tk, '--sw-craft', 1.5) / k;
      c.lineJoin = 'round';
      c.lineCap = 'round';
      if (s) { strokePaths(c, s.think); }
      var d;
      for (d = 0; d < SPRITE.thinkDots.length; d += 1) {
        var dot = SPRITE.thinkDots[d];
        circle(c, dot.cx, dot.cy, dot.r);
        c.stroke();
      }
      if (!hasPrediction) {
        /* Struck through: the model returned nothing readable this cycle. */
        c.beginPath();
        c.moveTo(3.2, 20.2);
        c.lineTo(20.4, 4.2);
        c.lineWidth = 2.4 / k;
        c.stroke();
      }
      c.restore();
      if (!hasPrediction) {
        textLine(c, T('arena.label.no_prediction'), bx + size * 0.6, by,
          fontOf(tk, '--fs-1', '600'), color(tk, '--c-retry'), 'left');
      }
    }

    /**
     * The ending, stated. `endFlash` is a decaying amplitude (1 -> 0) that only
     * runs when playback reaches the end; scrubbing lands on the calm resting
     * mark instead. Outcome is never colour alone - the HUD carries icon-free
     * label plus colour, and the time bar repeats the mark.
     */
    function paintEndFlash(c) {
      var tk = state.tokens;
      var view = state.view;
      var ep = state.episode;
      if (!ep || state.tick < ep.final_tick) { return; }
      var k = clamp(state.endFlash, 0, 1);
      var world = view.world;
      var tl = worldToScreen(world.minX, world.maxY, view);
      var br = worldToScreen(world.maxX, world.minY, view);
      c.save();
      if (ep.outcome === 'oob') {
        c.globalAlpha = 0.45 + 0.55 * k;
        c.strokeStyle = color(tk, '--c-oob');
        c.lineWidth = num(tk, '--sw-bound', 2) * (1 + k);
        c.setLineDash([]);
        c.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      } else if (ep.outcome === 'goal' && state.scenario) {
        var g = worldToScreen(state.scenario.goal_x_m, state.scenario.goal_y_m, view);
        var baseR = Math.max(num(tk, '--goal-r-min', 10),
          (state.scenario.goal_radius_m || 2) * view.scale);
        c.globalAlpha = 0.35 + 0.65 * k;
        c.strokeStyle = color(tk, '--c-goal');
        c.lineWidth = num(tk, '--sw-bound', 2);
        circle(c, g.x, g.y, baseR * (1 + 1.6 * (1 - k)));
        c.stroke();
      } else {
        c.globalAlpha = 0.2 + 0.35 * k;
        c.fillStyle = color(tk, '--c-arena-vignette');
        c.fillRect(0, 0, state.cssW, state.cssH);
      }
      c.restore();
    }

    function hudBox(c, corner, rows) {
      var tk = state.tokens;
      if (!rows.length) { return; }
      var labelFont = fontOf(tk, '--fs-1', '500');
      var valueFont = fontOf(tk, '--fs-2', '600');
      var padX = 10;
      var padY = 8;
      var lineH = 15;
      var wMax = 0;
      c.save();
      for (var i = 0; i < rows.length; i += 1) {
        c.font = labelFont;
        var lw = c.measureText(rows[i].label).width;
        c.font = valueFont;
        var vw = c.measureText(rows[i].value).width;
        wMax = Math.max(wMax, lw + 12 + vw);
      }
      var boxW = wMax + padX * 2;
      var boxH = rows.length * lineH + padY * 2;
      var x = corner.indexOf('r') >= 0 ? state.cssW - boxW - 12 : 12;
      var y = corner.indexOf('b') >= 0 ? state.cssH - boxH - 12 : 12;
      c.globalAlpha = 0.92;
      c.fillStyle = color(tk, '--c-arena');
      roundRect(c, x, y, boxW, boxH, 5);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = color(tk, '--c-border');
      c.lineWidth = 1;
      c.stroke();
      for (var r = 0; r < rows.length; r += 1) {
        var ty = y + padY + lineH * r + 11;
        textLine(c, rows[r].label, x + padX, ty, labelFont,
          color(tk, '--c-text-3'), 'left');
        textLine(c, rows[r].value, x + boxW - padX, ty, valueFont,
          rows[r].tone || color(tk, '--c-text-1'), 'right');
      }
      c.restore();
    }

    function paintHud(c) {
      var tk = state.tokens;
      var cur = state.current;
      if (!cur || !state.showHud) { return; }
      var ep = state.episode;
      var na = T('ui.na');
      var rows = [];
      rows.push({
        label: T('arena.hud.tick'),
        value: String(Math.round(cur.tick))
      });
      rows.push({
        label: T('arena.hud.cycle'),
        value: cur.cycleIndex >= 0
          ? T('ui.of', { n: cur.cycleIndex + 1, total: (ep.cycles || []).length })
          : na
      });
      var heldTxt = cur.held
        ? formatPair(cur.held.ax, cur.held.ay, 1)
        : null;
      rows.push({
        label: T('arena.hud.held'),
        value: heldTxt === null ? na : heldTxt,
        tone: cur.held && accelMagnitude(cur.held) > 0
          ? color(tk, '--c-text-1') : color(tk, '--c-text-3')
      });
      hudBox(c, 'tl', rows);

      var lower = [];
      var heatVal = formatFixed(cur.obsHeat, 4);
      lower.push({
        label: cur.variant === 'decoy'
          ? T('arena.hud.heat') + ' / ' + T('results.heat.decoy')
          : T('arena.hud.heat'),
        value: heatVal === null ? na : heatVal,
        tone: cur.variant === 'decoy'
          ? color(tk, '--c-unmeasurable') : color(tk, '--c-text-1')
      });
      var hiddenGoal = state.scenario && state.scenario.goal_visible === false;
      var distVal = formatFixed(cur.state ? cur.state.dist : null, 1);
      lower.push({
        label: hiddenGoal && !state.revealHiddenGoal
          ? T('arena.hud.distance_hidden') : T('arena.hud.distance'),
        value: (hiddenGoal && !state.revealHiddenGoal) || distVal === null
          ? na : distVal,
        tone: hiddenGoal && !state.revealHiddenGoal
          ? color(tk, '--c-unmeasurable') : color(tk, '--c-text-1')
      });
      var windVal = formatFixed(cur.wind, 2);
      lower.push({
        label: T('arena.hud.wind'),
        value: windVal === null ? na : windVal
      });
      hudBox(c, 'bl', lower);

      var right = [];
      if (cur.phase === 'deliberating' && cur.cycle) {
        right.push({
          label: T('lab.col.engage_tick'),
          value: String(cur.cycle.engage_tick)
        });
      }
      if (cur.phase === 'ended') {
        right.push({
          label: T('results.col.outcome'),
          value: T(outcomeStringKey(ep.outcome)),
          tone: color(tk, outcomeColorToken(ep.outcome))
        });
        var closest = formatFixed(ep.closest_approach_m, 2);
        right.push({
          label: T('outcome.closest'),
          value: closest === null ? na : closest
        });
      }
      if (state.overlay) {
        right.push({
          label: T('arena.overlay.label', {
            arm: T(state.overlay.arm === 'wm-scaffold'
              ? 'arm.wm_scaffold.name' : 'arm.end2end.name')
          }),
          value: T(outcomeStringKey(state.overlay.outcome)),
          tone: color(tk, armColorToken(state.overlay.arm))
        });
      }
      if (right.length) { hudBox(c, 'tr', right); }
    }

    /* ---- the frame --------------------------------------------------- */

    function computeCurrent() {
      var ep = state.episode;
      if (!ep) { state.current = null; return null; }
      var cycles = ep.cycles || [];
      var tick = state.tick;
      var idx = cycleIndexForTick(cycles, tick);
      var cycle = idx >= 0 ? cycles[idx] : null;
      var st = stateAtTick(ep.trajectory, tick);
      var phase = phaseForTick(cycles, tick, ep.final_tick);
      var cur = {
        episodeKey: ep.key,
        scenarioId: ep.scenario_id,
        arm: ep.arm,
        variant: ep.variant,
        outcome: ep.outcome,
        tick: tick,
        tickInt: Math.round(tick),
        finalTick: ep.final_tick,
        deadlineTick: state.scenario ? state.scenario.deadline_tick : null,
        cycleIndex: idx,
        cycle: cycle,
        cycleCount: cycles.length,
        phase: phase,
        progress: deliberationProgress(cycle, tick),
        state: st,
        held: cycle ? cycle.held : null,
        commanded: cycle && tick < cycle.engage_tick ? cycle.engaged : null,
        predicted: cycle ? cycle.predicted : null,
        predErrorM: cycle && isFiniteNumber(cycle.pred_pos_error_m)
          ? cycle.pred_pos_error_m : null,
        fidelity: cycle && isFiniteNumber(cycle.fidelity) ? cycle.fidelity : null,
        parseFailed: cycle ? !!cycle.parse_failed : false,
        predictionParseFailed: cycle ? !!cycle.prediction_parse_failed : false,
        obsHeat: cycle && isFiniteNumber(cycle.obs_heat) ? cycle.obs_heat : null,
        wind: state.scenario ? windAtTick(state.scenario.wind_curve, tick) : null,
        playing: state.playing
      };
      state.current = cur;
      return cur;
    }

    function paint() {
      if (state.destroyed || !state.tokens) { return; }
      if (state.dirtyStatic) {
        updateView();
        paintStatic();
        state.dirtyStatic = false;
      }
      var c = ctx;
      c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      c.clearRect(0, 0, state.cssW, state.cssH);
      c.drawImage(layer, 0, 0, state.cssW, state.cssH);
      var ep = state.episode;
      if (!ep) { return; }

      var tk = state.tokens;
      var cur = computeCurrent();
      var armStroke = color(tk, '--c-path');
      var maxAccel = state.scenario ? state.scenario.max_accel_mps2 : 15;

      if (state.showWind) { paintWind(c, state.tick); }

      /* Overlay: the same scenario flown by the other arm. */
      if (state.overlay) {
        var oStroke = color(tk, armColorToken(state.overlay.arm));
        var oTick = Math.min(state.tick, state.overlay.final_tick);
        paintFlown(c, state.overlay, oTick, oStroke, num(tk, '--sw-path', 2.5), 0.42);
        var oState = stateAtTick(state.overlay.trajectory, oTick);
        var oCycle = cycleAtTick(state.overlay.cycles || [], oTick);
        paintCraft(c, oState, oCycle ? oCycle.held : null, 0.45, oStroke,
          state.scenario ? state.scenario.max_accel_mps2 : 15);
      }

      paintFlown(c, ep, state.tick, armStroke, num(tk, '--sw-path', 2.5), 1);
      paintBeads(c, ep, state.tick, armStroke);

      /* Prediction layer: the current cycle plus the one that just engaged,
         so the fade-out of one overlaps the fade-in of the next. */
      var cycles = ep.cycles || [];
      var visOpts = { instant: reducedMotion() };
      var idx = cur.cycleIndex;
      var order = [idx - 1, idx];
      for (var oi = 0; oi < order.length; oi += 1) {
        var ci = order[oi];
        if (ci < 0 || ci >= cycles.length) { continue; }
        var cy = cycles[ci];
        var vis = predictionVisibility(cy, state.tick, visOpts);
        if (vis.error > 0) {
          paintTruth(c, cy, vis.error, armStroke);
          paintErrorLine(c, cy, vis.error);
        }
        if (state.showGhost && vis.ghost > 0) {
          paintGhost(c, cy, vis.ghost, armStroke);
        }
      }

      paintVectors(c, cur.state, cur.held, cur.commanded, armStroke, maxAccel);
      paintCraft(c, cur.state, cur.held, 1, armStroke, maxAccel);

      if (cur.phase === 'deliberating' && cur.cycle) {
        paintThinking(c, cur.state, cur.cycle, cur.progress, !!cur.cycle.predicted);
      }

      paintEndFlash(c);
      paintHud(c);
      paintTimeline();
    }

    /* ---- time bar ---------------------------------------------------- */

    var timeline = null;

    function setupTimeline() {
      var el = options.timeline;
      if (el === false) { return; }
      if (!el) {
        el = doc.createElement('canvas');
        el.style.display = 'block';
        el.style.width = '100%';
        el.style.height = '46px';
        /* The arena container is a square with overflow hidden, so the bar
           goes AFTER that container, not inside it. */
        var host = canvasEl.parentNode;
        var isArenaBox = host && host.className &&
          String(host.className).indexOf('cg-arena') >= 0;
        var anchor = isArenaBox ? host : canvasEl;
        if (anchor.parentNode) {
          anchor.parentNode.insertBefore(el, anchor.nextSibling);
        } else { return; }
      }
      if (typeof el.getContext !== 'function') { return; }
      timeline = {
        el: el,
        ctx: el.getContext('2d'),
        w: 0,
        h: 0,
        /* The backing store is sized in device pixels, so the ratio it was
           built with is part of its identity - see timelineSize(). */
        dpr: 0,
        dragging: false,
        geo: null,
        marks: null
      };
      el.setAttribute('role', 'slider');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', T('arena.aria.timeline'));
      el.addEventListener('pointerdown', onTimelinePointer, false);
      el.addEventListener('pointermove', onTimelinePointer, false);
      el.addEventListener('pointerup', onTimelineUp, false);
      el.addEventListener('pointercancel', onTimelineUp, false);
      el.addEventListener('keydown', onTimelineKey, false);
    }

    function timelineSize() {
      if (!timeline) { return false; }
      var rect = timeline.el.getBoundingClientRect();
      var w = Math.max(1, Math.round(rect.width || 1));
      var h = Math.max(1, Math.round(rect.height || 46));
      /* dpr belongs in this comparison: paintTimeline() always applies
         setTransform(state.dpr, ...), so after the window moves to a display
         with a different devicePixelRatio - CSS size unchanged - a size-only
         check would leave the backing store at the old scale and clip the
         scrubber, while the pointer hit-test kept working in CSS pixels. */
      if (w === timeline.w && h === timeline.h && timeline.dpr === state.dpr) { return false; }
      timeline.w = w;
      timeline.h = h;
      timeline.dpr = state.dpr;
      timeline.el.width = Math.round(w * state.dpr);
      timeline.el.height = Math.round(h * state.dpr);
      return true;
    }

    function paintTimeline() {
      if (!timeline || !state.episode) { return; }
      timelineSize();
      var c = timeline.ctx;
      var tk = state.tokens;
      var marks = timeline.marks;
      if (!marks) { return; }
      var geo = timelineGeometry(timeline.w, timeline.h, 12);
      timeline.geo = geo;
      var maxTick = marks.maxTick;
      var trackTop = geo.midY - geo.trackH / 2;

      c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      c.clearRect(0, 0, timeline.w, timeline.h);

      /* Track: the whole deadline window. */
      c.fillStyle = color(tk, '--c-surface-3');
      roundRect(c, geo.x0, trackTop, geo.x1 - geo.x0, geo.trackH, 2);
      c.fill();

      /* The part of the window the flight never reached. Stated, not implied. */
      var endX = tickToX(marks.finalTick, maxTick, geo);
      if (marks.endedEarly) {
        c.save();
        c.globalAlpha = 0.5;
        c.strokeStyle = color(tk, '--c-border');
        c.lineWidth = 1;
        var hatchStep = 6;
        c.beginPath();
        for (var hx = endX; hx < geo.x1; hx += hatchStep) {
          c.moveTo(hx, trackTop + geo.trackH);
          c.lineTo(Math.min(geo.x1, hx + geo.trackH), trackTop);
        }
        c.stroke();
        c.restore();
      }

      /* Deliberation bands: B ticks of world moving under the old action. */
      var i;
      for (i = 0; i < marks.marks.length; i += 1) {
        var m = marks.marks[i];
        var bx0 = tickToX(m.tick, maxTick, geo);
        var bx1 = tickToX(Math.min(m.engageTick, marks.finalTick), maxTick, geo);
        c.fillStyle = color(tk, '--c-accent-quiet');
        c.fillRect(bx0, trackTop - 4, Math.max(1, bx1 - bx0), geo.trackH + 8);
        c.strokeStyle = color(tk, '--c-accent-line');
        c.lineWidth = 1;
        line(c, bx0 + 0.5, trackTop - 4, bx0 + 0.5, trackTop + geo.trackH + 4);
      }

      /* Played portion, in the arm colour. */
      var headX = tickToX(Math.min(state.tick, marks.finalTick), maxTick, geo);
      c.fillStyle = color(tk, '--c-path');
      c.fillRect(geo.x0, trackTop, Math.max(0, headX - geo.x0), geo.trackH);

      /* Decision beads, engage ticks. */
      var labelFont = fontOf(tk, '--fs-1', '500');
      var spacing = marks.marks.length > 1
        ? tickToX(marks.marks[1].tick, maxTick, geo) - tickToX(marks.marks[0].tick, maxTick, geo)
        : 999;
      var activeIdx = cycleIndexForTick(state.episode.cycles || [], state.tick);
      for (i = 0; i < marks.marks.length; i += 1) {
        var mk = marks.marks[i];
        var mx = tickToX(mk.tick, maxTick, geo);
        var ex = tickToX(mk.engageTick, maxTick, geo);
        c.save();
        c.strokeStyle = color(tk, '--c-path');
        c.lineWidth = 1;
        c.globalAlpha = 0.7;
        line(c, ex, trackTop + geo.trackH + 2, ex, trackTop + geo.trackH + 7);
        c.restore();
        var r = (i === activeIdx) ? num(tk, '--bead-r-active', 7) : num(tk, '--bead-r', 4.5);
        c.save();
        c.lineWidth = 1.5;
        c.setLineDash(mk.parseFailed ? (tk.dash['--dash-error'] || []) : []);
        c.strokeStyle = mk.parseFailed ? color(tk, '--c-retry') : color(tk, '--c-path');
        c.fillStyle = (i === activeIdx)
          ? color(tk, '--c-path')
          : (mk.parseFailed ? color(tk, '--c-retry-bg') : color(tk, '--c-surface-1'));
        diamond(c, mx, geo.midY, r);
        c.fill();
        c.stroke();
        c.restore();
        if (spacing > 26) {
          textLine(c, T('arena.timeline.cycle_short', { n: mk.cycle }), mx,
            trackTop - 6, labelFont, color(tk, '--c-text-3'), 'center');
        }
      }

      /* Where the flight really stopped, and where the deadline was. */
      c.save();
      c.strokeStyle = color(tk, outcomeColorToken(marks.outcome));
      c.lineWidth = 2;
      line(c, endX, trackTop - 6, endX, trackTop + geo.trackH + 6);
      c.restore();
      c.save();
      c.strokeStyle = color(tk, '--c-deadline');
      c.lineWidth = 2;
      c.setLineDash(tk.dash['--dash-deadline'] || []);
      line(c, geo.x1, trackTop - 6, geo.x1, trackTop + geo.trackH + 6);
      c.restore();

      /* Labels: the early ending is the finding, so it is written out. */
      var baseY = timeline.h - 5;
      textLine(c, T('arena.timeline.ended_at', {
        tick: marks.finalTick, total: marks.deadlineTick
      }), geo.x0, baseY, labelFont, color(tk, '--c-text-3'), 'left');
      textLine(c, T('arena.timeline.deadline_at', { tick: marks.deadlineTick }),
        geo.x1, baseY, labelFont, color(tk, '--c-text-3'), 'right');

      /* Handle. */
      var hx2 = tickToX(state.tick, maxTick, geo);
      c.save();
      c.fillStyle = color(tk, '--c-accent');
      c.strokeStyle = color(tk, '--c-surface-1');
      c.lineWidth = 2;
      circle(c, hx2, geo.midY, 7);
      c.fill();
      c.stroke();
      c.restore();

      timeline.el.setAttribute('aria-valuemin', '0');
      timeline.el.setAttribute('aria-valuemax', String(maxTick));
      timeline.el.setAttribute('aria-valuenow', String(Math.round(state.tick)));
      timeline.el.setAttribute('aria-valuetext',
        T('arena.hud.tick') + ' ' + Math.round(state.tick));
    }

    function onTimelinePointer(evt) {
      if (!timeline || !timeline.geo || !state.episode) { return; }
      if (evt.type === 'pointerdown') {
        timeline.dragging = true;
        if (timeline.el.setPointerCapture) {
          try { timeline.el.setPointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
        }
        pause();
      }
      if (!timeline.dragging) { return; }
      var rect = timeline.el.getBoundingClientRect();
      var px = evt.clientX - rect.left;
      var maxTick = timeline.marks ? timeline.marks.maxTick : 1;
      var tick = xToTick(px, maxTick, timeline.geo);
      /* Snap to a decision when the pointer is near its bead. */
      var cycles = state.episode.cycles || [];
      for (var i = 0; i < cycles.length; i += 1) {
        var bx = tickToX(cycles[i].tick, maxTick, timeline.geo);
        if (Math.abs(bx - px) <= 7) { tick = cycles[i].tick; break; }
      }
      seek(tick);
      evt.preventDefault();
    }

    function onTimelineUp(evt) {
      if (!timeline) { return; }
      timeline.dragging = false;
      if (timeline.el.releasePointerCapture && evt.pointerId !== undefined) {
        try { timeline.el.releasePointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
      }
    }

    function onTimelineKey(evt) {
      if (!state.episode) { return; }
      var cycles = state.episode.cycles || [];
      var handled = true;
      switch (evt.key) {
        case 'ArrowRight': step(evt.shiftKey ? 10 : 1); break;
        case 'ArrowLeft': step(evt.shiftKey ? -10 : -1); break;
        case 'ArrowUp': seekCycle(cycleIndexForTick(cycles, state.tick) + 1); break;
        case 'ArrowDown': seekCycle(cycleIndexForTick(cycles, state.tick) - 1); break;
        case 'Home': seek(0); break;
        case 'End': seek(state.maxTick); break;
        case ' ': toggle(); break;
        default: handled = false;
      }
      if (handled) { evt.preventDefault(); }
    }

    /* ---- transport --------------------------------------------------- */

    function emitTick() {
      var cur = computeCurrent();
      if (cur) { emit('tick', cur); }
    }

    function requestPaint() {
      if (state.destroyed) { return; }
      paint();
      emitTick();
    }

    function frame(nowMs) {
      state.raf = 0;
      if (state.destroyed || !state.playing) { return; }
      var last = state.lastFrameMs || nowMs;
      var dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
      state.lastFrameMs = nowMs;
      var res = advanceTick(state.tick, dt, effectiveTicksPerSecond(),
        state.speed, state.maxTick);
      state.tick = res.tick;
      if (res.ended) {
        if (state.loop) {
          state.tick = 0;
        } else {
          state.playing = false;
          state.endFlash = reducedMotion() ? 0 : 1;
          paint();
          emitTick();
          emit('end', state.current);
          emit('state', publicState());
          startFlash();
          return;
        }
      }
      paint();
      emitTick();
      state.raf = global.requestAnimationFrame(frame);
    }

    /**
     * Decay of the end-of-flight mark. Separate from the transport loop, so
     * the flash plays once after the craft stops and then leaves a steady
     * resting mark. Skipped entirely under prefers-reduced-motion.
     */
    function startFlash() {
      if (state.flashRaf) {
        global.cancelAnimationFrame(state.flashRaf);
        state.flashRaf = 0;
      }
      if (reducedMotion() || state.endFlash <= 0) { state.endFlash = 0; paint(); return; }
      var flashDur = Math.max(50, num(state.tokens, '--dur-3', 320));
      var startedAt = 0;
      var tickFn = function (nowMs) {
        state.flashRaf = 0;
        if (state.destroyed) { return; }
        if (!startedAt) { startedAt = nowMs; }
        state.endFlash = clamp(1 - (nowMs - startedAt) / flashDur, 0, 1);
        paint();
        if (state.endFlash > 0 && !state.playing) {
          state.flashRaf = global.requestAnimationFrame(tickFn);
        }
      };
      state.flashRaf = global.requestAnimationFrame(tickFn);
    }

    function effectiveTicksPerSecond() {
      if (state.pacing === 'beat' && state.scenario) {
        var beat = num(state.tokens, '--dur-beat', 700);
        return beatTicksPerSecond(state.scenario.deliberation_ticks, beat);
      }
      return state.ticksPerSecond;
    }

    function play() {
      if (!state.episode || state.playing) { return instance; }
      if (reducedMotion()) {
        /* No animation: the reader scrubs. State still lands, instantly. */
        emit('state', publicState());
        return instance;
      }
      if (state.tick >= state.maxTick) { state.tick = 0; state.endFlash = 0; }
      state.playing = true;
      state.lastFrameMs = 0;
      state.raf = global.requestAnimationFrame(function (t) {
        state.lastFrameMs = t;
        state.raf = global.requestAnimationFrame(frame);
      });
      emit('state', publicState());
      return instance;
    }

    function pause() {
      if (!state.playing) { return instance; }
      state.playing = false;
      if (state.raf) { global.cancelAnimationFrame(state.raf); state.raf = 0; }
      emit('state', publicState());
      return instance;
    }

    function toggle() {
      return state.playing ? pause() : play();
    }

    function seek(tick) {
      if (!state.episode) { return instance; }
      state.tick = clamp(tick, 0, state.maxTick);
      /* Scrubbing lands on the resting end mark; the flash belongs to
         playback reaching the end, not to dragging the handle there. */
      state.endFlash = 0;
      requestPaint();
      return instance;
    }

    function step(delta) {
      return seek(state.tick + delta);
    }

    function seekCycle(index) {
      var cycles = (state.episode && state.episode.cycles) || [];
      if (!cycles.length) { return instance; }
      var i = clamp(index, 0, cycles.length - 1);
      return seek(cycles[Math.round(i)].tick);
    }

    function setSpeed(multiplier) {
      state.speed = clamp(multiplier, 0.05, 16);
      emit('state', publicState());
      return instance;
    }

    /**
     * 'fixed' (default) plays at opts.ticksPerSecond simulated ticks per
     * second. 'beat' follows spec/DESIGN.md section 6 instead: one whole
     * deliberation window per --dur-beat, whatever B is - so a B=40 scenario
     * plays at twice the tick rate of a B=20 one and both take one beat per
     * decision. Either way the pacing is simulated time, never host latency.
     */
    function setPacing(mode) {
      state.pacing = mode === 'beat' ? 'beat' : 'fixed';
      emit('state', publicState());
      return instance;
    }

    /* ---- loading ----------------------------------------------------- */

    function load(episodeKey) {
      /* The shell already has the selected episode object, while lab controls
         normally pass a key. Supporting both keeps mount({episode}) and the
         public load(key) API on the same audited path. */
      var ep = episodeKey && typeof episodeKey === 'object'
        ? episodeKey
        : episodeByKey(episodeKey);
      if (!ep) {
        state.episode = null;
        state.scenario = null;
        state.current = null;
        state.dirtyStatic = true;
        requestPaint();
        emit('load', { episodeKey: episodeKey, found: false });
        return instance;
      }
      pause();
      state.episode = ep;
      state.scenario = scenarioOf(ep);
      state.tick = 0;
      state.endFlash = 0;
      canvasEl.setAttribute('data-arm', ep.arm || 'end2end');
      canvasEl.setAttribute('data-variant', ep.variant || 'normal');
      if (timeline) {
        timeline.el.setAttribute('data-arm', ep.arm || 'end2end');
        timeline.marks = timelineMarks(ep, state.scenario);
      }
      if (state.overlay && state.overlay.scenario_id !== ep.scenario_id) {
        state.overlay = null;
      }
      recomputeMaxTick();
      refreshTokens();
      state.dirtyStatic = true;
      requestPaint();
      emit('load', {
        episodeKey: ep.key,
        found: true,
        arm: ep.arm,
        variant: ep.variant,
        scenarioId: ep.scenario_id,
        outcome: ep.outcome,
        finalTick: ep.final_tick,
        deadlineTick: state.scenario ? state.scenario.deadline_tick : null,
        cycleCount: (ep.cycles || []).length,
        deliberationTicks: state.scenario ? state.scenario.deliberation_ticks : null,
        goalVisible: state.scenario ? state.scenario.goal_visible !== false : true
      });
      emit('state', publicState());
      return instance;
    }

    function setOverlay(episodeKey) {
      if (!episodeKey) {
        state.overlay = null;
      } else {
        var ep = episodeByKey(episodeKey);
        state.overlay = ep || null;
      }
      recomputeMaxTick();
      state.dirtyStatic = true;
      requestPaint();
      emit('state', publicState());
      return instance;
    }

    function setRevealHiddenGoal(flag) {
      state.revealHiddenGoal = !!flag;
      state.dirtyStatic = true;
      requestPaint();
      emit('state', publicState());
      return instance;
    }

    function boolSetter(field, invalidatesStatic) {
      return function (flag) {
        state[field] = !!flag;
        if (invalidatesStatic) { state.dirtyStatic = true; }
        requestPaint();
        emit('state', publicState());
        return instance;
      };
    }

    function publicState() {
      var ep = state.episode;
      return {
        episodeKey: ep ? ep.key : null,
        overlayKey: state.overlay ? state.overlay.key : null,
        playing: state.playing,
        reducedMotion: reducedMotion(),
        tick: state.tick,
        maxTick: state.maxTick,
        speed: state.speed,
        ticksPerSecond: effectiveTicksPerSecond(),
        showWind: state.showWind,
        showGhost: state.showGhost,
        showTrail: state.showTrail,
        showHud: state.showHud,
        revealHiddenGoal: state.revealHiddenGoal
      };
    }

    /* ---- tokens, resize, theme --------------------------------------- */

    function refreshTokens() {
      state.tokens = readTokens(rootEl, canvasEl);
    }

    function handleResize() {
      var changed = measure();
      if (timeline) { changed = timelineSize() || changed; }
      if (changed) {
        state.dirtyStatic = true;
        requestPaint();
      }
    }

    var resizeObserver = null;
    if (global.ResizeObserver) {
      resizeObserver = new global.ResizeObserver(handleResize);
      resizeObserver.observe(canvasEl);
    } else if (global.addEventListener) {
      global.addEventListener('resize', handleResize, false);
    }

    var themeObserver = null;
    if (global.MutationObserver) {
      themeObserver = new global.MutationObserver(function (records) {
        /* A theme swap only changes colours, but a language swap also changes
           the spoken labels. Repainting alone would leave a screen reader
           announcing the arena in whichever language it was mounted in. */
        var langChanged = false;
        for (var i = 0; i < records.length; i += 1) {
          if (records[i].attributeName === 'lang') { langChanged = true; }
        }
        if (langChanged) { refresh(); return; }
        refreshTokens();
        state.dirtyStatic = true;
        requestPaint();
      });
      themeObserver.observe(rootEl, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-texture', 'lang']
      });
    }

    function refresh() {
      refreshTokens();
      if (timeline) {
        timeline.el.setAttribute('aria-label', T('arena.aria.timeline'));
      }
      canvasEl.setAttribute('aria-label', T('arena.aria.canvas'));
      state.dirtyStatic = true;
      measure();
      /* measure() can change state.dpr; the time bar has its own backing store
         and has to be re-sized in the same pass. */
      if (timeline) { timelineSize(); }
      requestPaint();
      return instance;
    }

    function destroy() {
      state.destroyed = true;
      pause();
      if (state.flashRaf) {
        global.cancelAnimationFrame(state.flashRaf);
        state.flashRaf = 0;
      }
      if (resizeObserver) { resizeObserver.disconnect(); }
      else if (global.removeEventListener) {
        global.removeEventListener('resize', handleResize, false);
      }
      if (themeObserver) { themeObserver.disconnect(); }
      if (timeline) {
        timeline.el.removeEventListener('pointerdown', onTimelinePointer, false);
        timeline.el.removeEventListener('pointermove', onTimelinePointer, false);
        timeline.el.removeEventListener('pointerup', onTimelineUp, false);
        timeline.el.removeEventListener('pointercancel', onTimelineUp, false);
        timeline.el.removeEventListener('keydown', onTimelineKey, false);
      }
      listeners = {};
      return null;
    }

    /* ---- public instance --------------------------------------------- */

    var instance = {
      load: load,
      play: play,
      pause: pause,
      toggle: toggle,
      seek: seek,
      step: step,
      seekCycle: seekCycle,
      setSpeed: setSpeed,
      setPacing: setPacing,
      setOverlay: setOverlay,
      setRevealHiddenGoal: setRevealHiddenGoal,
      setWind: boolSetter('showWind', false),
      setGhost: boolSetter('showGhost', false),
      setTrail: boolSetter('showTrail', true),
      setHud: boolSetter('showHud', false),
      on: on,
      off: off,
      refresh: refresh,
      destroy: destroy,
      getState: publicState,
      getCurrent: function () { return computeCurrent(); },
      getEpisode: function () { return state.episode; },
      getScenario: function () { return state.scenario; },
      element: canvasEl,
      timelineElement: function () { return timeline ? timeline.el : null; }
    };

    /* ---- boot -------------------------------------------------------- */

    canvasEl.style.display = canvasEl.style.display || 'block';
    if (!canvasEl.style.width) { canvasEl.style.width = '100%'; }
    if (!canvasEl.style.height) { canvasEl.style.height = '100%'; }
    canvasEl.setAttribute('role', 'img');
    canvasEl.setAttribute('aria-label', T('arena.aria.canvas'));

    refreshTokens();
    measure();
    setupTimeline();
    if (typeof options.onTick === 'function') { on('tick', options.onTick); }
    if (options.episode) {
      load(options.episode);
      if (options.autoplay) { play(); }
    } else {
      requestPaint();
    }

    return instance;
  }

  /* Only two entry points on purpose: mount() for the page, _pure for tests.
     Copy always goes through the shell's own T(), never through this module. */
  var Arena = {
    mount: mount,
    _pure: PURE
  };

  global.Arena = Arena;
}(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this)));
