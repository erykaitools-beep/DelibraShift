"""Transport-only model adapters; prompting and parsing belong to the harness."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request


def _post_chat(
    url: str,
    payload: dict[str, object],
    *,
    api_key: str | None,
    timeout_s: float,
) -> str:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        body = json.load(response)
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("NIM response is missing assistant content") from error
    if not isinstance(content, str):
        raise RuntimeError("NIM assistant content must be a string")
    return content


class NIMAdapter:
    """Minimal OpenAI-compatible NVIDIA NIM chat transport."""

    def __init__(
        self,
        model: str | None = None,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout_s: float = 120.0,
    ) -> None:
        self.model = model or os.getenv("NIM_MODEL", "")
        if not self.model:
            raise ValueError("NIM model is required via model= or NIM_MODEL")
        configured_url = base_url or os.getenv("NIM_BASE_URL", "http://localhost:8000/v1")
        self.base_url = configured_url.rstrip("/")
        self.api_key = api_key if api_key is not None else os.getenv("NVIDIA_API_KEY")
        self.timeout_s = timeout_s
        self.name = f"nim:{self.model}"

    def complete(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        payload: dict[str, object] = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        if seed is not None:
            payload["seed"] = seed
        return _post_chat(
            f"{self.base_url}/chat/completions",
            payload,
            api_key=self.api_key,
            timeout_s=self.timeout_s,
        )


class OllamaAdapter:
    """Minimal local Ollama ``/api/chat`` transport."""

    def __init__(
        self,
        model: str | None = None,
        *,
        base_url: str | None = None,
        think: bool = False,
        timeout_s: float = 120.0,
    ) -> None:
        self.model = model or os.getenv("OLLAMA_MODEL", "llama3.1:8b")
        configured_url = base_url or os.getenv(
            "OLLAMA_BASE_URL",
            "http://localhost:11434",
        )
        self.base_url = configured_url.rstrip("/")
        # Qwen-family reasoning models enable a separate thinking stream by
        # default.  The benchmark scores only the strict JSON reply, so hidden
        # reasoning must not consume the complete 512-token response budget.
        self.think = think
        self.timeout_s = timeout_s
        think_label = str(self.think).lower()
        self.name = f"ollama:{self.model}:think={think_label}"
        self.last_response_metadata: dict[str, object] = {}

    def complete(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        options: dict[str, object] = {
            "temperature": temperature,
            "num_predict": max_tokens,
        }
        if seed is not None:
            options["seed"] = seed
        request = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=json.dumps(
                {
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "think": self.think,
                    "options": options,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
            body = json.load(response)
        self.last_response_metadata = {
            key: body[key]
            for key in (
                "done",
                "done_reason",
                "total_duration",
                "load_duration",
                "prompt_eval_count",
                "prompt_eval_duration",
                "eval_count",
                "eval_duration",
            )
            if key in body
        }
        try:
            content = body["message"]["content"]
        except (KeyError, TypeError) as error:
            raise RuntimeError("Ollama response is missing assistant content") from error
        if not isinstance(content, str):
            raise RuntimeError("Ollama assistant content must be a string")
        return content


class CodexExecAdapter:
    """Fresh, ephemeral Codex product session via saved ChatGPT login."""

    def __init__(
        self,
        model: str = "gpt-5.6-sol",
        *,
        reasoning_effort: str = "medium",
        timeout_s: float = 300.0,
        executable: str = "codex",
    ) -> None:
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.timeout_s = timeout_s
        self.executable = executable
        self.name = f"codex-exec:{model}:effort={reasoning_effort}"
        self.last_response_metadata: dict[str, object] = {}

    @staticmethod
    def _chatgpt_environment() -> dict[str, str]:
        environment = os.environ.copy()
        # Never let this no-API-cost condition silently fall back to a billable
        # Platform key or an injected automation token.
        for key in ("OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"):
            environment.pop(key, None)
        return environment

    def _require_chatgpt_login(self, environment: dict[str, str]) -> str:
        status = subprocess.run(
            [self.executable, "login", "status"],
            capture_output=True,
            text=True,
            timeout=30.0,
            env=environment,
            check=False,
        )
        status_text = f"{status.stdout}\n{status.stderr}"
        if status.returncode != 0 or "Logged in using ChatGPT" not in status_text:
            raise RuntimeError(
                "CodexExecAdapter requires a saved ChatGPT login; refusing API-key "
                "or unknown authentication"
            )
        version = subprocess.run(
            [self.executable, "--version"],
            capture_output=True,
            text=True,
            timeout=30.0,
            env=environment,
            check=False,
        )
        return version.stdout.strip() if version.returncode == 0 else "unknown"

    def complete(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        environment = self._chatgpt_environment()
        codex_version = self._require_chatgpt_login(environment)
        with tempfile.TemporaryDirectory(prefix="delibrashift-codex-") as directory:
            output_path = Path(directory) / "last-message.txt"
            command = [
                self.executable,
                "exec",
                "--ephemeral",
                "--json",
                "--ignore-user-config",
                "--ignore-rules",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "-c",
                "project_doc_max_bytes=0",
                "-c",
                f'model_reasoning_effort="{self.reasoning_effort}"',
                "--model",
                self.model,
                "--output-last-message",
                str(output_path),
                "-",
            ]
            try:
                result = subprocess.run(
                    command,
                    input=prompt,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_s,
                    cwd=directory,
                    env=environment,
                    check=False,
                )
            except subprocess.TimeoutExpired as error:
                raise TimeoutError("Codex ephemeral session timed out") from error
            if result.returncode != 0:
                detail = (result.stderr.strip() or result.stdout.strip())[-2000:]
                raise RuntimeError(f"Codex ephemeral session failed: {detail}")
            if not output_path.is_file():
                raise RuntimeError("Codex session did not write a final message")

            events = []
            for line in result.stdout.splitlines():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(event, dict):
                    events.append(event)
            thread_ids = [
                event.get("thread_id")
                for event in events
                if event.get("type") == "thread.started"
            ]
            completions = [
                event for event in events if event.get("type") == "turn.completed"
            ]
            item_types = [
                item.get("type")
                for event in events
                if event.get("type") == "item.completed"
                and isinstance((item := event.get("item")), dict)
            ]
            tool_item_types = sorted(
                {
                    item_type
                    for item_type in item_types
                    if item_type not in {"agent_message", "reasoning"}
                }
            )
            self.last_response_metadata = {
                "codex_version": codex_version,
                "thread_id": thread_ids[-1] if thread_ids else None,
                "usage": completions[-1].get("usage") if completions else None,
                "tool_item_types": tool_item_types,
                "tool_item_count": sum(
                    item_type not in {"agent_message", "reasoning"}
                    for item_type in item_types
                ),
                "ephemeral": True,
                "saved_chatgpt_login_required": True,
                "api_credentials_removed_from_environment": True,
                "requested_max_tokens": max_tokens,
                "max_tokens_honored": False,
                "requested_temperature": temperature,
                "temperature_honored": False,
                "requested_seed": seed,
                "seed_honored": False,
            }
            return output_path.read_text(encoding="utf-8")
