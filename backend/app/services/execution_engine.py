from typing import Protocol

from app.models.execution import ExecuteRequest, ExecutionResult


class ExecutionEngine(Protocol):
    def execute(self, request: ExecuteRequest) -> ExecutionResult:
        """Compile and execute one source submission."""
