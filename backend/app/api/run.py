from fastapi import APIRouter, HTTPException, status

from app.models.trace import ExecutionTrace, RunRequest
from app.services.docker_gdb import DockerGdbUnavailable
from app.services.trace_engine import create_trace_engine


router = APIRouter(prefix="/api", tags=["execution"])


@router.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@router.post("/run", response_model=ExecutionTrace)
def run_code(request: RunRequest) -> ExecutionTrace:
    try:
        engine = create_trace_engine()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    try:
        return engine.run(request)
    except DockerGdbUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
