from typing import List
from uuid import uuid4

from app.models.trace import (
    ExecutionState,
    ExecutionTrace,
    RunRequest,
    SourceLocation,
    StackFrame,
    StepOutput,
    TraceEvent,
    TraceSource,
    TraceStep,
    TraceSummary,
    TraceVariable,
)


def _variable(identifier: str, name: str, value: int) -> TraceVariable:
    return TraceVariable(
        id=identifier,
        name=name,
        type="int",
        value=value,
        scope="main",
    )


def _state(i: int = None, total: int = None) -> ExecutionState:
    variables: List[TraceVariable] = []
    variable_ids: List[str] = []

    if i is not None:
        variables.append(_variable("main:i", "i", i))
        variable_ids.append("main:i")
    if total is not None:
        variables.append(_variable("main:sum", "sum", total))
        variable_ids.append("main:sum")

    return ExecutionState(
        variables=variables,
        callStack=[
            StackFrame(
                id="frame:main:1",
                function="main",
                variables=variable_ids,
            )
        ],
        memory=[],
    )


def create_mock_trace(request: RunRequest) -> ExecutionTrace:
    """Return a deterministic teaching trace without executing the C source."""

    entry_file = request.entryFile
    steps = [
        TraceStep(
            step=0,
            location=SourceLocation(file=entry_file, line=3, column=1),
            event=TraceEvent(type="function_enter", data={"function": "main"}),
            state=_state(),
            output=StepOutput(),
        ),
        TraceStep(
            step=1,
            location=SourceLocation(file=entry_file, line=4, column=5),
            event=TraceEvent(type="declare", data={"variableId": "main:i"}),
            state=_state(i=0),
            output=StepOutput(),
        ),
        TraceStep(
            step=2,
            location=SourceLocation(file=entry_file, line=5, column=5),
            event=TraceEvent(type="declare", data={"variableId": "main:sum"}),
            state=_state(i=0, total=0),
            output=StepOutput(),
        ),
        TraceStep(
            step=3,
            location=SourceLocation(file=entry_file, line=7, column=10),
            event=TraceEvent(
                type="assign",
                data={"variableId": "main:i", "oldValue": 0, "newValue": 1},
            ),
            state=_state(i=1, total=0),
            output=StepOutput(),
        ),
        TraceStep(
            step=4,
            location=SourceLocation(file=entry_file, line=8, column=9),
            event=TraceEvent(
                type="assign",
                data={"variableId": "main:sum", "oldValue": 0, "newValue": 1},
            ),
            state=_state(i=1, total=1),
            output=StepOutput(),
        ),
        TraceStep(
            step=5,
            location=SourceLocation(file=entry_file, line=8, column=9),
            event=TraceEvent(
                type="assign",
                data={"variableId": "main:sum", "oldValue": 1, "newValue": 3},
            ),
            state=_state(i=2, total=3),
            output=StepOutput(),
        ),
        TraceStep(
            step=6,
            location=SourceLocation(file=entry_file, line=8, column=9),
            event=TraceEvent(
                type="assign",
                data={"variableId": "main:sum", "oldValue": 3, "newValue": 6},
            ),
            state=_state(i=3, total=6),
            output=StepOutput(),
        ),
        TraceStep(
            step=7,
            location=SourceLocation(file=entry_file, line=11, column=5),
            event=TraceEvent(type="output", data={"text": "sum = 6\n"}),
            state=_state(i=4, total=6),
            output=StepOutput(stdout="sum = 6\n"),
        ),
        TraceStep(
            step=8,
            location=SourceLocation(file=entry_file, line=12, column=5),
            event=TraceEvent(type="return", data={"value": 0}),
            state=_state(i=4, total=6),
            output=StepOutput(stdout="sum = 6\n"),
        ),
    ]

    return ExecutionTrace(
        runId=f"run_{uuid4().hex[:12]}",
        status="completed",
        source=TraceSource(entryFile=entry_file),
        trace=steps,
        summary=TraceSummary(
            totalSteps=len(steps),
            exitCode=0,
            truncated=False,
        ),
        error=None,
    )
