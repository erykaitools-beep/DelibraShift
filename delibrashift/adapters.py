"""Transport-only model adapters; prompting and parsing belong to the harness."""

from __future__ import annotations

import json
import os
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
