import json
import asyncio

import httpx
from app.config import AgentSettings
from app.models.agent import AgentAnalysisRequest
from app.services.algorithm_agent import AlgorithmAgent


def _request() -> AgentAnalysisRequest:
    return AgentAnalysisRequest(
        code="int main(void) { return 0; }",
        entryFile="main.c",
        sourceHash="abc123",
        evidence={"functions": [{"id": "function:main", "name": "main"}]},
    )


def test_unconfigured_agent_falls_back_to_local_analysis() -> None:
    agent = AlgorithmAgent(AgentSettings(base_url="", api_key="", model=""))

    result = asyncio.run(agent.analyze(_request()))

    assert result.configured is False
    assert result.status == "unavailable"
    assert result.modules == []


def test_agent_filters_unknown_visualizations_and_caches() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.headers["authorization"] == "Bearer secret"
        body = json.loads(request.content)
        assert body["model"] == "teaching-model"
        content = json.dumps({
            "modules": [{
                "title": "递归候选",
                "family": "recursion",
                "kind": "algorithm",
                "sourceNodeIds": ["function:main"],
                "visualizationHints": ["recursion-tree", "arbitrary-react-code"],
                "confidence": 0.82,
                "evidence": ["self call"],
            }]
        })
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    settings = AgentSettings(
        base_url="https://agent.example/v1",
        api_key="secret",
        model="teaching-model",
        timeout_seconds=2,
    )
    agent = AlgorithmAgent(settings, httpx.MockTransport(handler))

    first = asyncio.run(agent.analyze(_request()))
    second = asyncio.run(agent.analyze(_request()))

    assert first.status == "completed"
    assert first.modules[0].visualizationHints == ["recursion-tree"]
    assert second == first
    assert calls == 1


def test_invalid_agent_response_keeps_local_result_available() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={"choices": [{"message": {"content": "not json"}}]},
        )
    )
    settings = AgentSettings(
        base_url="https://agent.example/v1",
        api_key="secret",
        model="teaching-model",
    )

    result = asyncio.run(AlgorithmAgent(settings, transport).analyze(_request()))

    assert result.configured is True
    assert result.status == "failed"
    assert result.modules == []
