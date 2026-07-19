"""Independent audit: recompute trajectories and scores from raw logs.

Physics is reimplemented here on purpose (SPEC 2.3), so the check does not
inherit any bug from extract.py or from the delibrashift package.
"""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = json.loads((ROOT / "data" / "bundle.json").read_text())
SRC = json.loads((ROOT / "data" / "bundle_sources.json").read_text())
LOGS = Path(SRC["read_dir"])
HEAT_SCALE = 20.0
TWO_PI = 2.0 * math.pi


def wind_x_at(components, tick):
    total = 0.0
    for c in components:
        total += c["amp_mps2"] * math.sin(
            TWO_PI * tick / c["period_ticks"] + c["phase_rad"]
        )
    return total


def replay(sc, records):
    g = sc["gravity_mps2"]
    dt = sc["dt_s"]
    gx, gy, gr = sc["goal_x_m"], sc["goal_y_m"], sc["goal_radius_m"]
    x, y = sc["start_pos_x_m"], sc["start_pos_y_m"]
    vx, vy = sc["start_vel_x_mps"], sc["start_vel_y_mps"]
    hx = hy = 0.0
    tick = 0
    done = False
    outcome = None
    dist = math.hypot(x - gx, y - gy)
    dists = [dist]
    n_pts = 1
    for rec in records:
        assert tick == rec["tick"], (tick, rec["tick"])
        for _ in range(rec["ticks_elapsed"]):
            if done:
                break
            wind = wind_x_at(sc["wind_components"], tick)
            ax = hx + wind
            ay = hy - g
            vx = vx + ax * dt
            vy = vy + ay * dt
            x = x + vx * dt
            y = y + vy * dt
            tick += 1
            dist = math.hypot(x - gx, y - gy)
            dists.append(dist)
            n_pts += 1
            if dist <= gr:
                done, outcome = True, "goal"
            elif (
                x < sc["bounds_min_x_m"]
                or x > sc["bounds_max_x_m"]
                or y < sc["bounds_min_y_m"]
                or y > sc["bounds_max_y_m"]
            ):
                done, outcome = True, "oob"
            elif tick >= sc["deadline_tick"]:
                done, outcome = True, "timeout"
        if rec["action_engaged"] and rec["engaged_action"]:
            hx = rec["engaged_action"]["accel_x_mps2"]
            hy = rec["engaged_action"]["accel_y_mps2"]
    return {
        "tick": tick, "x": x, "y": y, "vx": vx, "vy": vy,
        "outcome": outcome, "closest": min(dists), "n_pts": n_pts,
    }


def read_log(path):
    manifest = summary = None
    cycles = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r["type"] == "manifest":
            manifest = r
        elif r["type"] == "cycle":
            cycles.append(r)
        elif r["type"] == "summary":
            summary = r
    return manifest, cycles, summary


def main(keys):
    scen = BUNDLE["scenarios"]
    by_key = {e["key"]: e for e in BUNDLE["episodes"]}
    bad = 0
    for key in keys:
        ep = by_key[key]
        sc = scen[ep["scenario_id"]]
        _m, cycles, summary = read_log(LOGS / (key + ".jsonl"))
        got = replay(sc, cycles)
        fs = summary["final_state"]
        problems = []
        for f, k in (("tick", "tick"), ("x", "pos_x_m"), ("y", "pos_y_m"),
                     ("vx", "vel_x_mps"), ("vy", "vel_y_mps")):
            if abs(got[f] - fs[k]) > 1e-9:
                problems.append(f"final {k}: replay {got[f]!r} vs log {fs[k]!r}")
        if got["outcome"] != fs["outcome"]:
            problems.append(f"outcome {got['outcome']} vs {fs['outcome']}")
        if abs(got["closest"] - summary["closest_approach_m"]) > 1e-9:
            problems.append(
                f"closest {got['closest']!r} vs {summary['closest_approach_m']!r}")
        # bundle trajectory endpoint
        traj = ep["trajectory"]
        if len(traj["t"]) != got["n_pts"]:
            problems.append(f"traj points {len(traj['t'])} vs {got['n_pts']}")
        if abs(traj["x"][-1] - got["x"]) > 5e-4 or abs(traj["y"][-1] - got["y"]) > 5e-4:
            problems.append(
                f"traj end ({traj['x'][-1]},{traj['y'][-1]}) vs ({got['x']},{got['y']})")
        if abs(min(traj["dist"]) - got["closest"]) > 5e-4:
            problems.append(f"traj closest {min(traj['dist'])} vs {got['closest']}")
        if abs(ep["closest_approach_m"] - summary["closest_approach_m"]) > 5e-5:
            problems.append("bundle closest_approach_m mismatch")
        # outcome score
        success = fs["outcome"] == "goal"
        exp_out = 0.5 * float(success) + 0.4 * math.exp(-summary["closest_approach_m"] / HEAT_SCALE)
        if success:
            exp_out += 0.1 * (1.0 - fs["tick"] / sc["deadline_tick"])
        if abs(exp_out - ep["scores"]["outcome"]) > 1e-12:
            problems.append(f"outcome score {ep['scores']['outcome']} vs {exp_out}")
        # parse rates
        total = len(cycles)
        act_ok = sum(1 for c in cycles if not c["reply"].get("parse_failed"))
        req = [c for c in cycles if c["prediction_requested"]]
        pred_ok = sum(1 for c in req
                      if c["reply"].get("prediction") is not None
                      and not c["reply"].get("prediction_parse_failed"))
        if abs(act_ok / total - ep["scores"]["action_parse_rate"]) > 1e-12:
            problems.append("action_parse_rate mismatch")
        if req and abs(pred_ok / len(req) - ep["scores"]["prediction_parse_rate"]) > 1e-12:
            problems.append("prediction_parse_rate mismatch")
        req_nt = [c for c in req if not c["truncated"]]
        fid_cycles = [c for c in cycles
                      if not c["truncated"] and c.get("prediction_target")
                      and c["prediction_requested"]
                      and c["reply"].get("prediction") is not None
                      and not c["reply"].get("prediction_parse_failed")]
        cov = len(fid_cycles) / len(req_nt) if req_nt else 0.0
        if abs(cov - ep["scores"]["prediction_coverage"]) > 1e-12:
            problems.append(f"coverage {ep['scores']['prediction_coverage']} vs {cov}")
        # summary retried_cycle_rate
        if ep["retried_cycle_rate"] != summary.get("retried_cycle_rate"):
            problems.append("retried_cycle_rate differs from log summary")
        status = "OK " if not problems else "BAD"
        if problems:
            bad += 1
        print(f"{status} {key:38s} out={fs['outcome']:7s} cycles={total} "
              f"cov={cov:.3f} fid={ep['scores']['prediction_fidelity']} "
              f"reason={ep['scores']['fidelity_invalid_reason']}")
        for p in problems:
            print("      !", p)
    print(f"\n{len(keys) - bad}/{len(keys)} episodes verified independently")
    return 1 if bad else 0


if __name__ == "__main__":
    keys = sys.argv[1:]
    if not keys:
        keys = [e["key"] for e in BUNDLE["episodes"]]
    sys.exit(main(keys))
