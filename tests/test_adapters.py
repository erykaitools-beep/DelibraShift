from __future__ import annotations

import io
import json
import urllib.request

import pytest

from delibrashift.adapters import NIMAdapter, OllamaAdapter


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def test_nim_adapter_is_transport_only_and_uses_openai_chat_shape(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response(
            json.dumps(
                {"choices": [{"message": {"content": '{"action":{}}'}}]}
            ).encode("utf-8")
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    adapter = NIMAdapter(
        "org/dracarys",
        base_url="http://nim.example/v1/",
        api_key="secret-token",
        timeout_s=7.0,
    )
    output = adapter.complete("already rendered", max_tokens=12, seed=99)

    request = captured["request"]
    payload = json.loads(request.data)
    assert request.full_url == "http://nim.example/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer secret-token"
    assert captured["timeout"] == 7.0
    assert payload == {
        "model": "org/dracarys",
        "messages": [{"role": "user", "content": "already rendered"}],
        "max_tokens": 12,
        "temperature": 0.0,
        "stream": False,
        "seed": 99,
    }
    assert output == '{"action":{}}'


def test_nim_adapter_requires_external_model_configuration(monkeypatch) -> None:
    monkeypatch.delenv("NIM_MODEL", raising=False)
    with pytest.raises(ValueError, match="NIM model"):
        NIMAdapter()


def test_nim_adapter_rejects_malformed_transport_response(monkeypatch) -> None:
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *args, **kwargs: Response(b'{"choices":[]}'),
    )
    with pytest.raises(RuntimeError, match="assistant content"):
        NIMAdapter("model").complete("prompt")


def test_ollama_adapter_uses_native_chat_shape(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response(
            b'{"message":{"role":"assistant","content":"ok"},'
            b'"done":true,"done_reason":"stop","eval_count":7}'
        )

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    adapter = OllamaAdapter(
        "llama3.1:8b",
        base_url="http://ollama.example/",
        timeout_s=9.0,
    )
    assert adapter.complete("rendered", max_tokens=17, temperature=0.2, seed=4) == "ok"
    request = captured["request"]
    assert request.full_url == "http://ollama.example/api/chat"
    assert captured["timeout"] == 9.0
    assert json.loads(request.data) == {
        "model": "llama3.1:8b",
        "messages": [{"role": "user", "content": "rendered"}],
        "stream": False,
        "think": False,
        "options": {"temperature": 0.2, "num_predict": 17, "seed": 4},
    }
    assert adapter.last_response_metadata == {
        "done": True,
        "done_reason": "stop",
        "eval_count": 7,
    }


def test_ollama_adapter_can_enable_model_thinking_explicitly(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["payload"] = json.loads(request.data)
        return Response(b'{"message":{"role":"assistant","content":"ok"}}')

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    adapter = OllamaAdapter("qwen3:1.7b", think=True)
    assert adapter.complete("prompt") == "ok"
    assert captured["payload"]["think"] is True
    assert adapter.name == "ollama:qwen3:1.7b:think=true"


def test_ollama_adapter_names_thinking_disabled_as_distinct_condition() -> None:
    assert (
        OllamaAdapter("qwen3:1.7b", think=False).name
        == "ollama:qwen3:1.7b:think=false"
    )


def test_ollama_adapter_rejects_malformed_response(monkeypatch) -> None:
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *args, **kwargs: Response(b'{"done":true}'),
    )
    with pytest.raises(RuntimeError, match="assistant content"):
        OllamaAdapter().complete("prompt")
