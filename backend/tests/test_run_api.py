from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_run_returns_execution_trace() -> None:
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


def test_run_rejects_blank_code() -> None:
    response = client.post(
        "/api/run",
        json={"code": "   ", "entryFile": "main.c"},
    )

    assert response.status_code == 422
