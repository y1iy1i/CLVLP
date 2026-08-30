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


class VariableStorage(BaseModel):
    address: Optional[str] = None
    size: Optional[int] = Field(default=None, ge=0)
    region: Literal["stack", "global", "heap", "register", "unknown"] = "unknown"
    available: bool = False
    unavailableReason: Optional[str] = None
    bytes: Optional[str] = None


class PointerReference(BaseModel):
    id: str
    sourceVariableId: str
    sourceExpression: Optional[str] = None
    sourceAddress: Optional[str] = None
    addressValue: Optional[str] = None
    targetObjectId: Optional[str] = None
    targetAddress: Optional[str] = None
    offset: Optional[int] = None
    targetType: Optional[str] = None
    elementSize: Optional[int] = Field(default=None, ge=1)
    elementCount: Optional[int] = Field(default=None, ge=0)
    status: Literal["resolved", "null", "dangling", "unreadable", "unknown"]


class MemoryField(BaseModel):
    name: str
    type: str
    value: Any
    expression: Optional[str] = None
    address: Optional[str] = None
    offset: Optional[int] = None
    pointeeSize: Optional[int] = Field(default=None, ge=1)
    pointer: Optional[PointerReference] = None
    fields: List["MemoryField"] = Field(default_factory=list)


class TraceVariable(BaseModel):
    id: str
    frameId: Optional[str] = None
    name: str
    type: str
    value: Any
    scope: str
    role: Literal["parameter", "local", "global"] = "local"
    available: bool = True
    storage: VariableStorage = Field(default_factory=VariableStorage)
    pointer: Optional[PointerReference] = None
    pointeeSize: Optional[int] = Field(default=None, ge=1)
    fields: List[MemoryField] = Field(default_factory=list)


class StackFrame(BaseModel):
    id: str
    parentFrameId: Optional[str] = None
    function: str
    variables: List[str] = Field(default_factory=list)
    arguments: List[str] = Field(default_factory=list)
    locals: List[str] = Field(default_factory=list)


class ObjectLifetime(BaseModel):
    allocatedAtStep: Optional[int] = Field(default=None, ge=0)
    freedAtStep: Optional[int] = Field(default=None, ge=0)
    status: Literal["alive", "freed", "unknown"] = "unknown"


class MemoryObject(BaseModel):
    id: str
    address: Optional[str] = None
    size: Optional[int] = Field(default=None, ge=0)
    type: str
    value: Any
    region: Literal["stack", "global", "heap"] = "heap"
    bytes: Optional[str] = None
    readable: bool = False
    fields: List[MemoryField] = Field(default_factory=list)
    lifetime: ObjectLifetime = Field(default_factory=ObjectLifetime)


class ExecutionState(BaseModel):
    variables: List[TraceVariable] = Field(default_factory=list)
    callStack: List[StackFrame] = Field(default_factory=list)
    memory: List[MemoryObject] = Field(default_factory=list)
    pointers: List[PointerReference] = Field(default_factory=list)


class StepOutput(BaseModel):
    stdout: str = ""
    stderr: str = ""


class TraceStep(BaseModel):
    step: int = Field(ge=0)
    location: SourceLocation
    executedLocation: Optional[SourceLocation] = None
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
    schemaVersion: Literal["1.0", "1.1", "1.2"] = "1.2"
    runId: str
    status: RunStatus
    source: TraceSource
    trace: List[TraceStep]
    summary: TraceSummary
    error: Optional[TraceError] = None
