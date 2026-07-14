"""Deterministic local M0 baseline agents (not model transports)."""

from __future__ import annotations

import math
import random
from typing import Protocol

from .types import Action, AgentReply, Observation, Prediction, TWO_PI, clamp_accel


class Agent(Protocol):
    """Small internal interface for agents that already return typed replies."""

    name: str

    def act(self, observation: Observation) -> AgentReply:
        """Choose an action and optional prediction from one observation."""
        ...


def persistence_prediction(observation: Observation) -> Prediction:
    """Predict no state change; the registered fidelity floor."""
    return Prediction(
        pos_x_m=observation.pos_x_m,
        pos_y_m=observation.pos_y_m,
        vel_x_mps=observation.vel_x_mps,
        vel_y_mps=observation.vel_y_mps,
    )


def arrival_action(
    *,
    pos_x_m: float,
    pos_y_m: float,
    vel_x_mps: float,
    vel_y_mps: float,
    goal_x_m: float,
    goal_y_m: float,
    gravity_mps2: float,
    max_accel_mps2: float,
) -> Action:
    """SPEC 5.2 arrival steering, shared by greedy and oracle seed plans."""
    delta_x = goal_x_m - pos_x_m
    delta_y = goal_y_m - pos_y_m
    distance = math.hypot(delta_x, delta_y)
    if distance < 1e-9:
        desired_x = 0.0
        desired_y = 0.0
    else:
        desired_speed = min(8.0, 0.35 * distance)
        desired_x = desired_speed * delta_x / distance
        desired_y = desired_speed * delta_y / distance
    raw_x = 1.2 * (desired_x - vel_x_mps)
    raw_y = 1.2 * (desired_y - vel_y_mps) + gravity_mps2
    accel_x, accel_y = clamp_accel(raw_x, raw_y, max_accel_mps2)
    return Action(accel_x, accel_y)


class NoOpAgent:
    """Always command zero thrust and emit the persistence prediction."""

    name = "noop"

    def act(self, observation: Observation) -> AgentReply:
        return AgentReply(
            action=Action(0.0, 0.0),
            prediction=persistence_prediction(observation),
        )


class RandomAgent:
    """Registered random floor: deterministic uniform samples on a disc."""

    name = "random"

    def __init__(self, seed: int, *, repetition: int = 0) -> None:
        self.seed = seed
        self.repetition = repetition

    def act(self, observation: Observation) -> AgentReply:
        rng = random.Random(
            self.seed * 7_919 + self.repetition * 1_000_003 + observation.cycle
        )
        angle = rng.uniform(0.0, TWO_PI)
        radius = observation.max_accel_mps2 * math.sqrt(rng.random())
        return AgentReply(
            action=Action(radius * math.cos(angle), radius * math.sin(angle)),
            prediction=persistence_prediction(observation),
        )


class GreedyAgent:
    """Registered reactive gradient baseline with no forecast or lead."""

    name = "greedy"

    def __init__(self) -> None:
        self._masked_heading_rad = 0.0

    def act(self, observation: Observation) -> AgentReply:
        if observation.cycle == 0:
            self._masked_heading_rad = 0.0
        if observation.goal_x_m is not None and observation.goal_y_m is not None:
            action = arrival_action(
                pos_x_m=observation.pos_x_m,
                pos_y_m=observation.pos_y_m,
                vel_x_mps=observation.vel_x_mps,
                vel_y_mps=observation.vel_y_mps,
                goal_x_m=observation.goal_x_m,
                goal_y_m=observation.goal_y_m,
                gravity_mps2=observation.gravity_mps2,
                max_accel_mps2=observation.max_accel_mps2,
            )
        else:
            if observation.heat_delta < 0.0:
                self._masked_heading_rad += TWO_PI / 5.0
            thrust = 0.6 * observation.max_accel_mps2
            raw_x = thrust * math.cos(self._masked_heading_rad)
            raw_y = (
                thrust * math.sin(self._masked_heading_rad)
                + observation.gravity_mps2
            )
            accel_x, accel_y = clamp_accel(
                raw_x,
                raw_y,
                observation.max_accel_mps2,
            )
            action = Action(accel_x, accel_y)
        return AgentReply(
            action=action,
            prediction=persistence_prediction(observation),
        )
