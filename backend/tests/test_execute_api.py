import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.docker_executor import DEFAULT_IMAGE


client = TestClient(app)
image = os.getenv("CLVLP_EXECUTOR_IMAGE", DEFAULT_IMAGE)


def _executor_image_available() -> bool:
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", image],
            capture_output=True,
            check=False,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


pytestmark = pytest.mark.skipif(
    not _executor_image_available(),
    reason="Docker executor image is not available",
)


def test_execute_runs_c_program() -> None:
    response = client.post(
        "/api/execute",
        json={
            "code": '#include <stdio.h>\nint main(void) { printf("hello\\n"); return 0; }',
            "entryFile": "main.c",
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "completed"
    assert result["stdout"] == "hello\n"
    assert result["stderr"] == ""
    assert result["exitCode"] == 0
    assert result["limits"]["networkEnabled"] is False


def test_execute_returns_compile_error() -> None:
    response = client.post(
        "/api/execute",
        json={"code": "int main(void) { this is not c; }", "entryFile": "main.c"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "compile_error"
    assert "error:" in result["stderr"]
    assert result["exitCode"] is None


def test_execute_stops_infinite_loop() -> None:
    response = client.post(
        "/api/execute",
        json={"code": "int main(void) { for (;;) {} }", "entryFile": "main.c"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "timeout"
    assert result["exitCode"] is None
