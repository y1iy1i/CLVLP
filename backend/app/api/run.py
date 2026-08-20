from fastapi import APIRouter

from app.models.trace import ExecutionTrace, RunRequest
from app.services.mock_runner import create_mock_trace


router = APIRouter(prefix="/api", tags=["execution"])


@router.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@router.post("/run", response_model=ExecutionTrace)
def run_code(request: RunRequest) -> ExecutionTrace:
    return create_mock_trace(request)
