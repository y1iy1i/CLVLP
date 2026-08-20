from fastapi import APIRouter, HTTPException, status

from app.models.execution import ExecuteRequest, ExecutionResult
from app.services.docker_executor import (
    DockerExecutionEngine,
    DockerExecutionUnavailable,
)


router = APIRouter(prefix="/api", tags=["execution"])
executor = DockerExecutionEngine()


@router.post("/execute", response_model=ExecutionResult)
def execute_code(request: ExecuteRequest) -> ExecutionResult:
    try:
        return executor.execute(request)
    except DockerExecutionUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
