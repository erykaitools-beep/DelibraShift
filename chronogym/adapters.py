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
