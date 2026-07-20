from __future__ import annotations

import io
import json
from pathlib import Path
import subprocess
import urllib.request

import pytest

from delibrashift.adapters import CodexExecAdapter, NIMAdapter, OllamaAdapter


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


def test_codex_exec_adapter_uses_fresh_isolated_chatgpt_session(monkeypatch) -> None:
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        if command[-2:] == ["login", "status"]:
            return subprocess.CompletedProcess(command, 0, "", "Logged in using ChatGPT\n")
        if command[-1] == "--version":
            return subprocess.CompletedProcess(command, 0, "codex-cli 9.9.9\n", "")
        output_path = Path(command[command.index("--output-last-message") + 1])
        output_path.write_text('{"action":{}}', encoding="utf-8")
        stdout = "\n".join(
            (
                '{"type":"thread.started","thread_id":"fresh-thread"}',
                '{"type":"item.completed","item":{"type":"agent_message"}}',
                '{"type":"turn.completed","usage":{"input_tokens":20,"output_tokens":4}}',
            )
        )
        return subprocess.CompletedProcess(command, 0, stdout, "")

    monkeypatch.setenv("OPENAI_API_KEY", "must-not-leak")
    monkeypatch.setenv("CODEX_API_KEY", "must-not-leak")
    monkeypatch.setenv("CODEX_ACCESS_TOKEN", "must-not-leak")
    monkeypatch.setattr(subprocess, "run", fake_run)

    adapter = CodexExecAdapter("gpt-5.6-sol", reasoning_effort="medium")
    assert adapter.complete("rendered prompt", max_tokens=12, seed=7) == '{"action":{}}'

    command, invocation = calls[-1]
    assert command[:2] == ["codex", "exec"]
    assert "--ephemeral" in command
    assert "--json" in command
    assert "--ignore-user-config" in command
    assert "--ignore-rules" in command
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert 'model_reasoning_effort="medium"' in command
    assert command[command.index("--model") + 1] == "gpt-5.6-sol"
    assert command[-1] == "-"
    assert invocation["input"] == "rendered prompt"
    assert invocation["env"].get("OPENAI_API_KEY") is None
    assert invocation["env"].get("CODEX_API_KEY") is None
    assert invocation["env"].get("CODEX_ACCESS_TOKEN") is None
    assert adapter.last_response_metadata == {
        "codex_version": "codex-cli 9.9.9",
        "thread_id": "fresh-thread",
        "usage": {"input_tokens": 20, "output_tokens": 4},
        "tool_item_types": [],
        "tool_item_count": 0,
        "ephemeral": True,
        "saved_chatgpt_login_required": True,
        "api_credentials_removed_from_environment": True,
        "requested_max_tokens": 12,
        "max_tokens_honored": False,
        "requested_temperature": 0.0,
        "temperature_honored": False,
        "requested_seed": 7,
        "seed_honored": False,
    }


def test_codex_exec_adapter_refuses_non_chatgpt_auth(monkeypatch) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, "Logged in using an API key\n", ""
        ),
    )
    with pytest.raises(RuntimeError, match="saved ChatGPT login"):
        CodexExecAdapter().complete("prompt")
