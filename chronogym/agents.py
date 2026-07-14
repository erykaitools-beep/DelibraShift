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
        self._masked_previous_position: tuple[float, float] | None = None
        self._masked_history: list[tuple[float, float, float]] = []

    def _masked_action(self, observation: Observation) -> Action:
        position = (observation.pos_x_m, observation.pos_y_m)
        if self._masked_previous_position is not None:
            previous_x, previous_y = self._masked_previous_position
            self._masked_history.append(
                (
                    position[0] - previous_x,
                    position[1] - previous_y,
                    observation.heat_delta,
                )
            )
            self._masked_history = self._masked_history[-3:]
        self._masked_previous_position = position

        heading: tuple[float, float] | None = None
        if len(self._masked_history) < 2:
            heading = (1.0, 0.0) if observation.cycle == 0 else (0.0, 1.0)
        else:
            n11 = sum(dx * dx for dx, _, _ in self._masked_history)
            n12 = sum(dx * dy for dx, dy, _ in self._masked_history)
            n22 = sum(dy * dy for _, dy, _ in self._masked_history)
            b1 = sum(dx * delta for dx, _, delta in self._masked_history)
            b2 = sum(dy * delta for _, dy, delta in self._masked_history)
            determinant = n11 * n22 - n12 * n12
            scale = (n11 + n22) / 2.0
            if determinant > 1e-6 * scale * scale:
                gradient_x = (n22 * b1 - n12 * b2) / determinant
                gradient_y = (n11 * b2 - n12 * b1) / determinant
                gradient_norm = math.hypot(gradient_x, gradient_y)
                if gradient_norm > 1e-12:
                    heading = (
                        gradient_x / gradient_norm,
                        gradient_y / gradient_norm,
                    )
            if heading is None:
                displacement_x, displacement_y, _ = self._masked_history[-1]
                displacement_norm = math.hypot(displacement_x, displacement_y)
                if displacement_norm > 1e-12:
                    heading = (
                        -displacement_y / displacement_norm,
                        displacement_x / displacement_norm,
                    )
                else:
                    heading = (1.0, 0.0)

        raw_x = 1.2 * (6.0 * heading[0] - observation.vel_x_mps)
        raw_y = (
            1.2 * (6.0 * heading[1] - observation.vel_y_mps)
            + observation.gravity_mps2
        )
        accel_x, accel_y = clamp_accel(
            raw_x,
            raw_y,
            observation.max_accel_mps2,
        )
        return Action(accel_x, accel_y)

    def act(self, observation: Observation) -> AgentReply:
        if observation.cycle == 0:
            self._masked_previous_position = None
            self._masked_history = []
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
            action = self._masked_action(observation)
        return AgentReply(
            action=action,
            prediction=persistence_prediction(observation),
        )
