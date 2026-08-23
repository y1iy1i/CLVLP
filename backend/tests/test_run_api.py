import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.docker_gdb import DEFAULT_GDB_IMAGE


client = TestClient(app)

_GDB_IMAGE = os.getenv("CLVLP_GDB_IMAGE", DEFAULT_GDB_IMAGE)


def _gdb_image_available() -> bool:
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", _GDB_IMAGE],
            capture_output=True,
            check=False,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def test_health_check() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_run_returns_execution_trace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLVLP_TRACE_ENGINE", "mock")
    response = client.post(
        "/api/run",
        json={"code": "int main(void) { return 0; }", "entryFile": "main.c"},
    )

    assert response.status_code == 200

    result = response.json()
    assert result["schemaVersion"] == "1.0"
    assert result["status"] == "completed"
    assert result["source"] == {"entryFile": "main.c", "language": "c"}
    assert result["summary"]["totalSteps"] == len(result["trace"])
    assert result["summary"]["exitCode"] == 0
    assert result["error"] is None


def test_run_rejects_unknown_trace_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLVLP_TRACE_ENGINE", "bogus")
    response = client.post(
        "/api/run",
        json={"code": "int main(void) { return 0; }", "entryFile": "main.c"},
    )

    assert response.status_code == 500


def test_run_returns_503_when_gdb_engine_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if _gdb_image_available():
        pytest.skip("Docker GDB image is available; covered by docker tests")
    monkeypatch.setenv("CLVLP_TRACE_ENGINE", "gdb")
    response = client.post(
        "/api/run",
        json={"code": "int main(void) { return 0; }", "entryFile": "main.c"},
    )

    assert response.status_code == 503


def test_run_rejects_blank_code() -> None:
    response = client.post(
        "/api/run",
        json={"code": "   ", "entryFile": "main.c"},
    )

    assert response.status_code == 422
