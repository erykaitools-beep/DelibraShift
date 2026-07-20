(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    scenario: $("scenario"), agent: $("agent"), repetition: $("repetition"),
    run: $("run"), reset: $("reset"), step: $("step"), play: $("play"),
    speed: $("speed"), speedValue: $("speed-value"), timeline: $("timeline"),
    tickOutput: $("tick-output"), export: $("export"), status: $("status"),
    scenarioMeta: $("scenario-meta"), agentMeta: $("agent-meta"),
    canvas: $("arena"), empty: $("empty-state")
  };
  const speedSteps = [0.5, 1, 2, 4, 8, 16];
  const state = { catalog: null, run: null, frame: 0, playing: false, timer: null };

  const number = (value, digits = 2) =>
    value === null || value === undefined ? "—" : Number(value).toFixed(digits);
  const vector = (value, x, y) => value ? `${number(value[x])}, ${number(value[y])}` : "—";
  const setStatus = (message, error = false) => {
    ui.status.textContent = message;
    ui.status.classList.toggle("error", error);
  };

  function populateCatalog(catalog) {
    state.catalog = catalog;
    const populateSelect = (select, items, label) => {
      select.replaceChildren(...items.map((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item[label];
        return option;
      }));
    };
    populateSelect(ui.scenario, catalog.scenarios, "id");
    populateSelect(ui.agent, catalog.agents, "label");
    ui.scenario.disabled = false;
    ui.agent.disabled = false;
    ui.run.disabled = false;
    describeSelection();
    setStatus(`${catalog.pack.name} v${catalog.pack.version} · ${catalog.scenarios.length} scenarios`);
  }

  function describeSelection() {
    if (!state.catalog) return;
    const scenario = state.catalog.scenarios.find((item) => item.id === ui.scenario.value);
    const agent = state.catalog.agents.find((item) => item.id === ui.agent.value);
    ui.scenarioMeta.textContent = scenario
      ? `B=${scenario.deliberation_ticks} · deadline=${scenario.deadline_tick} · goal ${scenario.goal_visible ? "visible" : "hidden from agent"}` : "";
    ui.agentMeta.textContent = agent ? `${agent.kind} · ${agent.description}` : "";
  }

  async function runEpisode() {
    stop();
    ui.run.disabled = true;
    setStatus("Running canonical deterministic episode…");
    try {
      const payload = await window.pywebview.api.run_scenario(
        ui.scenario.value, ui.agent.value, Number(ui.repetition.value)
      );
      state.run = payload;
      state.frame = 0;
      ui.timeline.max = Math.max(0, payload.trajectory.length - 1);
      ui.timeline.value = 0;
      [ui.reset, ui.step, ui.play, ui.timeline, ui.export].forEach((element) => element.disabled = false);
      ui.empty.classList.add("hidden");
      $("episode-id").textContent = payload.episode_id;
      const visibility = payload.scenario.goal_visible ? "visible goal" : "goal hidden from agent";
      setStatus(`${payload.summary.cycles} decisions · ${payload.trajectory.length} states · ${visibility}`);
      render();
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      ui.run.disabled = false;
    }
  }

  function stop() {
    state.playing = false;
    ui.play.textContent = "▶";
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
  }

  function playLoop() {
    if (!state.playing || !state.run) return;
    if (state.frame >= state.run.trajectory.length - 1) {
      stop();
      return;
    }
    state.frame += 1;
    render();
    const speed = speedSteps[Number(ui.speed.value) - 1];
    state.timer = window.setTimeout(playLoop, Math.max(12, 150 / speed));
  }

  function togglePlay() {
    if (!state.run) return;
    if (state.playing) return stop();
    if (state.frame >= state.run.trajectory.length - 1) state.frame = 0;
    state.playing = true;
    ui.play.textContent = "Ⅱ";
    playLoop();
  }

  function activeDecision(tick) {
    if (!state.run) return null;
    let active = state.run.decisions[0] || null;
    for (const decision of state.run.decisions) {
      if (decision.tick <= tick) active = decision;
      else break;
    }
    return active;
  }

  function render() {
    if (!state.run) return;
    const run = state.run;
    const point = run.trajectory[state.frame];
    const decision = activeDecision(point.tick);
    ui.timeline.value = state.frame;
    ui.tickOutput.value = String(point.tick);
    $("metric-tick").textContent = `${point.tick} / ${run.scenario.deadline_tick}`;
    $("metric-distance").textContent = `${number(point.distance_to_goal_m)} m`;
    $("metric-heat").textContent = number(point.heat, 4);
    $("metric-wind").textContent = `${number(point.wind_x_mps2)} m/s²`;
    $("metric-thrust").textContent = `${number(Math.hypot(point.held_accel_x_mps2, point.held_accel_y_mps2))} m/s²`;
    const isFinal = state.frame === run.trajectory.length - 1;
    $("metric-outcome").textContent = isFinal ? String(run.summary.outcome).toUpperCase() : "RUNNING";

    if (decision) {
      $("cycle-number").textContent = `CYCLE ${String(decision.cycle).padStart(2, "0")}`;
      $("window-range").textContent = `observed T=${decision.tick} → engages T=${decision.engage_tick}`;
      $("observed-position").textContent = vector(decision.observation, "pos_x_m", "pos_y_m") + " m";
      $("returned-action").textContent = vector(decision.returned_action, "accel_x_mps2", "accel_y_mps2") + " m/s²";
      $("engaged-action").textContent = vector(decision.engaged_action, "accel_x_mps2", "accel_y_mps2") + " m/s²";
      $("prediction-target").textContent = decision.prediction_target
        ? `T=${decision.engage_tick} · ${vector(decision.prediction_target, "pos_x_m", "pos_y_m")} m` : "truncated / unavailable";
      const delta = decision.observation.heat_delta;
      $("heat-delta").textContent = `${delta >= 0 ? "+" : ""}${number(delta, 5)} · ${delta >= 0 ? "HOTTER" : "COLDER"}`;
      $("latency-callout").querySelector("p").innerHTML =
        `While the agent decides, the previous action remains latched and the world advances by <strong>${run.scenario.deliberation_ticks}</strong> ticks.`;
    }
    $("score").textContent = number(run.summary.outcome_score, 3);
    $("closest").textContent = `${number(run.summary.closest_approach_m)} m`;
    $("fidelity").textContent = number(run.summary.prediction_fidelity, 3);
    const degrees = Math.round(run.summary.outcome_score * 360);
    $("score-ring").style.background = `conic-gradient(var(--blue) ${degrees}deg, var(--line) ${degrees}deg)`;
    drawArena(point, decision);
  }

  function drawArena(point, decision) {
    const canvas = ui.canvas;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const w = rect.width, h = rect.height, pad = 34;
    ctx.clearRect(0, 0, w, h);
    const cfg = state.run.scenario;
    const sx = (w - pad * 2) / (cfg.bounds_max_x_m - cfg.bounds_min_x_m);
    const sy = (h - pad * 2) / (cfg.bounds_max_y_m - cfg.bounds_min_y_m);
    const scale = Math.min(sx, sy);
    const worldW = (cfg.bounds_max_x_m - cfg.bounds_min_x_m) * scale;
    const worldH = (cfg.bounds_max_y_m - cfg.bounds_min_y_m) * scale;
    const ox = (w - worldW) / 2, oy = (h - worldH) / 2;
    const xy = (x, y) => [ox + (x - cfg.bounds_min_x_m) * scale, oy + worldH - (y - cfg.bounds_min_y_m) * scale];

    ctx.strokeStyle = "rgba(79, 111, 132, .19)"; ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const gx = ox + worldW * i / 10, gy = oy + worldH * i / 10;
      ctx.beginPath(); ctx.moveTo(gx, oy); ctx.lineTo(gx, oy + worldH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, gy); ctx.lineTo(ox + worldW, gy); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(90, 143, 171, .55)"; ctx.strokeRect(ox, oy, worldW, worldH);

    const [goalX, goalY] = xy(cfg.goal_x_m, cfg.goal_y_m);
    const radius = Math.max(5, cfg.goal_radius_m * scale);
    ctx.strokeStyle = "#ffbd54"; ctx.lineWidth = 1.5; ctx.setLineDash(cfg.goal_visible ? [] : [4, 4]);
    ctx.beginPath(); ctx.arc(goalX, goalY, radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#ffbd54"; ctx.font = "9px monospace";
    ctx.fillText(cfg.goal_visible ? "GOAL" : "GOAL · HIDDEN FROM AGENT", goalX + radius + 6, goalY - 5);

    const trace = state.run.trajectory;
    const drawPath = (start, end, color, lineWidth) => {
      if (end <= start) return;
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.beginPath();
      for (let i = start; i <= end; i += 1) {
        const [x, y] = xy(trace[i].pos_x_m, trace[i].pos_y_m);
        if (i === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    drawPath(0, state.frame, "rgba(46, 200, 255, .85)", 2);

    if (decision && decision.prediction) {
      const [px, py] = xy(decision.prediction.pos_x_m, decision.prediction.pos_y_m);
      ctx.strokeStyle = "rgba(121, 232, 255, .75)"; ctx.setLineDash([4, 4]);
      ctx.strokeRect(px - 6, py - 6, 12, 12); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(121, 232, 255, .8)"; ctx.font = "8px monospace"; ctx.fillText("PRED", px + 9, py + 3);
    }

    const [x, y] = xy(point.pos_x_m, point.pos_y_m);
    const angle = Math.atan2(-point.vel_y_mps, point.vel_x_mps);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Number.isFinite(angle) ? angle : 0);
    ctx.fillStyle = "#79e8ff"; ctx.shadowColor = "#2ec8ff"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -6); ctx.lineTo(-3, 0); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.restore();

    const arrow = Math.max(-28, Math.min(28, point.wind_x_mps2 * 5));
    ctx.strokeStyle = "rgba(109, 240, 177, .8)"; ctx.fillStyle = "rgba(109, 240, 177, .8)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y + 19); ctx.lineTo(x + arrow, y + 19); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + arrow, y + 19); ctx.lineTo(x + arrow - Math.sign(arrow || 1) * 5, y + 15); ctx.lineTo(x + arrow - Math.sign(arrow || 1) * 5, y + 23); ctx.closePath(); ctx.fill();
  }

  async function exportLog() {
    try {
      const result = await window.pywebview.api.save_last_run();
      if (result.ok) setStatus(`Canonical log saved: ${result.path}`);
      else if (!result.cancelled) setStatus(result.error || "Export failed.", true);
    } catch (error) { setStatus(error.message || String(error), true); }
  }

  ui.scenario.addEventListener("change", describeSelection);
  ui.agent.addEventListener("change", describeSelection);
  ui.run.addEventListener("click", runEpisode);
  ui.play.addEventListener("click", togglePlay);
  ui.reset.addEventListener("click", () => { stop(); state.frame = 0; render(); });
  ui.step.addEventListener("click", () => { stop(); state.frame = Math.min(state.frame + 1, state.run.trajectory.length - 1); render(); });
  ui.timeline.addEventListener("input", () => { stop(); state.frame = Number(ui.timeline.value); render(); });
  ui.speed.addEventListener("input", () => { ui.speedValue.value = `${speedSteps[Number(ui.speed.value) - 1]}×`; });
  ui.export.addEventListener("click", exportLog);
  window.addEventListener("resize", () => { if (state.run) render(); });

  window.addEventListener("pywebviewready", async () => {
    try {
      populateCatalog(await window.pywebview.api.catalog());
      await runEpisode();
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });

  window.setTimeout(() => {
    if (!state.catalog) setStatus("Desktop bridge unavailable. Launch with delibrashift-lab.", true);
  }, 2500);
})();
