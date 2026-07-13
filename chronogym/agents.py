"""Deterministic local M0 baseline agents (not model transports)."""

from __future__ import annotations

import math
import random
from typing import Protocol

from .types import Action, AgentReply, Observation, Prediction, TWO_PI


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

    def __init__(self, seed: int) -> None:
        self.seed = seed

    def act(self, observation: Observation) -> AgentReply:
        rng = random.Random(self.seed * 7_919 + observation.cycle)
        angle = rng.random() * TWO_PI
        radius = observation.max_accel_mps2 * math.sqrt(rng.random())
        return AgentReply(
            action=Action(radius * math.cos(angle), radius * math.sin(angle)),
            prediction=persistence_prediction(observation),
        )
