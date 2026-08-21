from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


RunStatus = Literal[
    "completed",
    "compile_error",
    "runtime_error",
    "timeout",
    "cancelled",
]


class RunRequest(BaseModel):
    code: str = Field(min_length=1)
    entryFile: str = Field(default="main.c", min_length=1)

    @field_validator("code")
    @classmethod
    def code_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("code must not be blank")
        return value


class TraceSource(BaseModel):
    entryFile: str
    language: Literal["c"] = "c"


class SourceLocation(BaseModel):
    file: str
    line: int = Field(ge=1)
    column: Optional[int] = Field(default=None, ge=1)


class TraceEvent(BaseModel):
    type: str
    data: Dict[str, Any] = Field(default_factory=dict)


class TraceVariable(BaseModel):
    id: str
    name: str
    type: str
    value: Any
    scope: str


class StackFrame(BaseModel):
    id: str
    function: str
    variables: List[str] = Field(default_factory=list)


class MemoryObject(BaseModel):
    id: str
    address: Optional[str] = None
    type: str
    value: Any


class ExecutionState(BaseModel):
    variables: List[TraceVariable] = Field(default_factory=list)
    callStack: List[StackFrame] = Field(default_factory=list)
    memory: List[MemoryObject] = Field(default_factory=list)


class StepOutput(BaseModel):
    stdout: str = ""
    stderr: str = ""


class TraceStep(BaseModel):
    step: int = Field(ge=0)
    location: SourceLocation
    event: TraceEvent
    state: ExecutionState
    output: StepOutput


class TraceSummary(BaseModel):
    totalSteps: int = Field(ge=0)
    exitCode: Optional[int] = None
    truncated: bool = False


class TraceError(BaseModel):
    type: str
    message: str
    details: Optional[Dict[str, Any]] = None


class ExecutionTrace(BaseModel):
    schemaVersion: Literal["1.0"] = "1.0"
    runId: str
    status: RunStatus
    source: TraceSource
    trace: List[TraceStep]
    summary: TraceSummary
    error: Optional[TraceError] = None
