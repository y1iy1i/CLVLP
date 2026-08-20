from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.trace import TraceSource


ExecutionStatus = Literal[
    "completed",
    "compile_error",
    "runtime_error",
    "timeout",
]


class ExecuteRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100_000)
    entryFile: Literal["main.c"] = "main.c"

    @field_validator("code")
    @classmethod
    def code_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("code must not be blank")
        return value


class CompilerDescriptor(BaseModel):
    name: Literal["gcc"] = "gcc"
    languageStandard: Literal["c11"] = "c11"
    image: str


class ExecutionLimits(BaseModel):
    compileTimeoutSeconds: int
    runTimeoutSeconds: int
    memoryMegabytes: int
    cpuCount: float
    processLimit: int
    maxOutputBytes: int
    networkEnabled: Literal[False] = False


class OutputTruncation(BaseModel):
    stdout: bool = False
    stderr: bool = False


class ExecutionError(BaseModel):
    type: str
    message: str


class ExecutionResult(BaseModel):
    schemaVersion: Literal["1.0"] = "1.0"
    runId: str
    status: ExecutionStatus
    source: TraceSource
    compiler: CompilerDescriptor
    stdout: str = ""
    stderr: str = ""
    exitCode: Optional[int] = None
    durationMs: int = Field(ge=0)
    outputTruncated: OutputTruncation
    limits: ExecutionLimits
    error: Optional[ExecutionError] = None
