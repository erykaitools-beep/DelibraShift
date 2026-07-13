from __future__ import annotations

import io
import json
import urllib.request

import pytest

from chronogym.adapters import NIMAdapter


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
