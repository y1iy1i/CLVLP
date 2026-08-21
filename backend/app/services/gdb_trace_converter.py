from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Protocol, Sequence
from uuid import uuid4

from app.models.trace import (
    ExecutionState,
    ExecutionTrace,
    RunStatus,
    SourceLocation,
    StackFrame,
    StepOutput,
    TraceError,
    TraceEvent,
    TraceSource,
    TraceStep,
    TraceSummary,
    TraceVariable,
)
from app.services.gdb_mi import GdbMiError, MiCommandResponse, MiRecord


MAX_TRACE_STEPS = 500


@dataclass(frozen=True)
class GdbVariableSnapshot:
    name: str
    value: str
    type: str = "unknown"
    is_argument: bool = False


@dataclass(frozen=True)
class GdbFrameSnapshot:
    level: int
    function: str
    file: Optional[str]
    line: Optional[int]
    variables: Sequence[GdbVariableSnapshot] = field(default_factory=tuple)


@dataclass(frozen=True)
class GdbStopSnapshot:
    frames: Sequence[GdbFrameSnapshot]
    reason: str = "end-stepping-range"
    stdout: str = ""
    stderr: str = ""
    signal_name: Optional[str] = None

    @property
    def current_frame(self) -> GdbFrameSnapshot:
        if not self.frames:
            raise ValueError("A GDB stop snapshot must contain at least one frame.")
        return self.frames[0]


@dataclass(frozen=True)
class _AssignedFrame:
    id: str
    snapshot: GdbFrameSnapshot


@dataclass(frozen=True)
class _AssignedSnapshot:
    raw: GdbStopSnapshot
    frames: Sequence[_AssignedFrame]


class GdbCommandSession(Protocol):
    def execute(
        self,
        command: str,
        *,
        wait_for_stop: bool = False,
        timeout: float = 5.0,
    ) -> MiCommandResponse: ...


def convert_gdb_value(raw_value: str, type_name: str) -> Any:
    """Convert common scalar GDB values; retain complex values as text."""

    value = raw_value.strip()
    normalized_type = " ".join(
        word
        for word in type_name.split()
        if word not in {"const", "volatile", "restrict"}
    )
    if value in {"<optimized out>", "<unavailable>"}:
        return value

    if normalized_type in {"_Bool", "bool"}:
        if value.lower() in {"true", "1"}:
            return True
        if value.lower() in {"false", "0"}:
            return False

    if normalized_type in {"char", "signed char", "unsigned char"}:
        character_match = re.match(r"^-?\d+\s+('(?:[^'\\]|\\.)*')$", value)
        if character_match:
            try:
                return ast.literal_eval(character_match.group(1))
            except (SyntaxError, ValueError):
                pass

    integer_words = {"short", "int", "long", "signed", "unsigned"}
    type_words = set(normalized_type.replace("*", " * ").split())
    if "*" not in type_words and type_words and type_words <= integer_words:
        integer_match = re.match(r"^[+-]?(?:0[xX][0-9a-fA-F]+|\d+)", value)
        if integer_match:
            try:
                integer_text = integer_match.group(0)
                base = 16 if "0x" in integer_text.lower() else 10
                return int(integer_text, base)
            except ValueError:
                pass

    if normalized_type in {"float", "double", "long double"}:
        try:
            return float(value)
        except ValueError:
            pass

    return value


def capture_gdb_snapshot(
    session: GdbCommandSession,
    stop: MiRecord,
    execution_records: Sequence[MiRecord] = (),
) -> GdbStopSnapshot:
    """Read every stack frame and its variables at one stopped GDB state."""

    if stop.kind != "exec" or stop.message != "stopped":
        raise ValueError("The supplied GDB record is not a stopped event.")

    stack_response = session.execute("-stack-list-frames")
    raw_frames = stack_response.result.payload.get("stack", [])
    frames: List[GdbFrameSnapshot] = []
    try:
        for stack_item in raw_frames:
            frame_payload = stack_item.get("frame", stack_item)
            level = int(frame_payload.get("level", len(frames)))
            session.execute(f"-stack-select-frame {level}")
            variables_response = session.execute(
                "-stack-list-variables --all-values"
            )
            variables = [
                _capture_variable(session, variable_payload)
                for variable_payload in variables_response.result.payload.get(
                    "variables", []
                )
            ]
            frames.append(
                GdbFrameSnapshot(
                    level=level,
                    function=str(frame_payload.get("func", "unknown")),
                    file=_optional_string(
                        frame_payload.get("fullname") or frame_payload.get("file")
                    ),
                    line=_optional_int(frame_payload.get("line")),
                    variables=variables,
                )
            )
    finally:
        if raw_frames:
            session.execute("-stack-select-frame 0")

    return GdbStopSnapshot(
        frames=frames,
        reason=str(stop.payload.get("reason", "unknown")),
        stdout="".join(
            str(record.payload)
            for record in execution_records
            if record.kind == "target"
        ),
        signal_name=_optional_string(stop.payload.get("signal-name")),
    )


def _capture_variable(
    session: GdbCommandSession,
    variable_payload: Dict[str, Any],
) -> GdbVariableSnapshot:
    name = str(variable_payload.get("name", "unknown"))
    value = str(variable_payload.get("value", "<unavailable>"))
    type_name = "unknown"
    variable_object_name: Optional[str] = None
    try:
        response = session.execute(f"-var-create - * {json.dumps(name)}")
        variable_object_name = _optional_string(response.result.payload.get("name"))
        type_name = str(response.result.payload.get("type", "unknown"))
        value = str(response.result.payload.get("value", value))
    except GdbMiError:
        pass
    finally:
        if variable_object_name:
            try:
                session.execute(f"-var-delete {variable_object_name}")
            except GdbMiError:
                pass

    return GdbVariableSnapshot(
        name=name,
        value=value,
        type=type_name,
        is_argument=str(variable_payload.get("arg", "0")) == "1",
    )


class ExecutionTraceBuilder:
    """Convert successive stopped GDB snapshots into versioned Trace steps."""

    def __init__(
        self,
        entry_file: str = "main.c",
        *,
        run_id: Optional[str] = None,
        max_steps: int = MAX_TRACE_STEPS,
    ) -> None:
        self.entry_file = entry_file
        self.run_id = run_id or f"run_{uuid4().hex[:12]}"
        self.max_steps = max_steps
        self._steps: List[TraceStep] = []
        self._previous: Optional[_AssignedSnapshot] = None
        self._frame_sequence = 0
        self._stdout = ""
        self._stderr = ""
        self._truncated = False

    def add_snapshot(self, snapshot: GdbStopSnapshot) -> Optional[TraceStep]:
        assigned = self._assign_frames(snapshot)
        self._stdout += snapshot.stdout
        self._stderr += snapshot.stderr

        if self._previous is None:
            current = assigned.frames[0]
            step = self._create_step(
                location=self._location(current.snapshot),
                event=TraceEvent(
                    type="function_enter",
                    data={
                        "function": current.snapshot.function,
                        "frameId": current.id,
                        "initial": True,
                    },
                ),
                snapshot=assigned,
            )
        else:
            previous_frame = self._previous.frames[0]
            changes = self._variable_changes(self._previous, assigned)
            entered, exited = self._frame_changes(self._previous, assigned)
            event = self._event_for_transition(
                snapshot=snapshot,
                changes=changes,
                entered=entered,
                exited=exited,
            )
            step = self._create_step(
                location=self._location(previous_frame.snapshot),
                event=event,
                snapshot=assigned,
            )

        self._previous = assigned
        if len(self._steps) >= self.max_steps:
            self._truncated = True
            return None
        self._steps.append(step)
        return step

    def build(
        self,
        *,
        status: RunStatus,
        exit_code: Optional[int],
        error: Optional[TraceError] = None,
    ) -> ExecutionTrace:
        return ExecutionTrace(
            runId=self.run_id,
            status=status,
            source=TraceSource(entryFile=self.entry_file),
            trace=self._steps,
            summary=TraceSummary(
                totalSteps=len(self._steps),
                exitCode=exit_code,
                truncated=self._truncated,
            ),
            error=error,
        )

    def _assign_frames(self, snapshot: GdbStopSnapshot) -> _AssignedSnapshot:
        current_bottom_up = list(reversed(snapshot.frames))
        previous_bottom_up = (
            list(reversed(self._previous.frames)) if self._previous else []
        )
        common_count = 0
        while (
            common_count < len(current_bottom_up)
            and common_count < len(previous_bottom_up)
            and self._same_invocation(
                current_bottom_up[common_count],
                previous_bottom_up[common_count].snapshot,
            )
        ):
            common_count += 1

        assigned_bottom_up: List[_AssignedFrame] = []
        for index, frame in enumerate(current_bottom_up):
            if index < common_count:
                frame_id = previous_bottom_up[index].id
            else:
                self._frame_sequence += 1
                frame_id = f"frame:{frame.function}:{self._frame_sequence}"
            assigned_bottom_up.append(_AssignedFrame(id=frame_id, snapshot=frame))
        return _AssignedSnapshot(
            raw=snapshot,
            frames=list(reversed(assigned_bottom_up)),
        )

    def _create_step(
        self,
        *,
        location: SourceLocation,
        event: TraceEvent,
        snapshot: _AssignedSnapshot,
    ) -> TraceStep:
        variables: List[TraceVariable] = []
        call_stack: List[StackFrame] = []
        for frame in snapshot.frames:
            variable_ids: List[str] = []
            for variable in frame.snapshot.variables:
                variable_id = f"{frame.id}:{variable.name}"
                variable_ids.append(variable_id)
                variables.append(
                    TraceVariable(
                        id=variable_id,
                        name=variable.name,
                        type=variable.type,
                        value=convert_gdb_value(variable.value, variable.type),
                        scope=frame.snapshot.function,
                    )
                )
            call_stack.append(
                StackFrame(
                    id=frame.id,
                    function=frame.snapshot.function,
                    variables=variable_ids,
                )
            )

        return TraceStep(
            step=len(self._steps),
            location=location,
            event=event,
            state=ExecutionState(
                variables=variables,
                callStack=call_stack,
                memory=[],
            ),
            output=StepOutput(stdout=self._stdout, stderr=self._stderr),
        )

    def _variable_changes(
        self,
        previous: _AssignedSnapshot,
        current: _AssignedSnapshot,
    ) -> List[Dict[str, Any]]:
        before = self._variables_by_id(previous)
        after = self._variables_by_id(current)
        changes: List[Dict[str, Any]] = []
        for variable_id, variable in after.items():
            new_value = convert_gdb_value(variable.value, variable.type)
            if variable_id not in before:
                changes.append(
                    {
                        "kind": "declare",
                        "variableId": variable_id,
                        "newValue": new_value,
                    }
                )
                continue
            old_variable = before[variable_id]
            old_value = convert_gdb_value(old_variable.value, old_variable.type)
            if old_value != new_value or old_variable.type != variable.type:
                changes.append(
                    {
                        "kind": "update",
                        "variableId": variable_id,
                        "oldValue": old_value,
                        "newValue": new_value,
                    }
                )
        for variable_id, variable in before.items():
            if variable_id not in after:
                changes.append(
                    {
                        "kind": "out_of_scope",
                        "variableId": variable_id,
                        "oldValue": convert_gdb_value(variable.value, variable.type),
                    }
                )
        return changes

    def _event_for_transition(
        self,
        *,
        snapshot: GdbStopSnapshot,
        changes: List[Dict[str, Any]],
        entered: List[_AssignedFrame],
        exited: List[_AssignedFrame],
    ) -> TraceEvent:
        data: Dict[str, Any] = {"changes": changes}
        if snapshot.signal_name or snapshot.reason == "signal-received":
            data["signal"] = snapshot.signal_name
            return TraceEvent(type="runtime_signal", data=data)
        if entered:
            data["frames"] = [
                {"id": frame.id, "function": frame.snapshot.function}
                for frame in entered
            ]
            return TraceEvent(type="function_enter", data=data)
        if exited:
            data["frames"] = [
                {"id": frame.id, "function": frame.snapshot.function}
                for frame in exited
            ]
            return TraceEvent(type="function_exit", data=data)
        if snapshot.stdout or snapshot.stderr:
            data["stdoutDelta"] = snapshot.stdout
            data["stderrDelta"] = snapshot.stderr
            return TraceEvent(type="output", data=data)
        return TraceEvent(type="line_executed", data=data)

    @staticmethod
    def _variables_by_id(
        snapshot: _AssignedSnapshot,
    ) -> Dict[str, GdbVariableSnapshot]:
        return {
            f"{frame.id}:{variable.name}": variable
            for frame in snapshot.frames
            for variable in frame.snapshot.variables
        }

    @staticmethod
    def _frame_changes(
        previous: _AssignedSnapshot,
        current: _AssignedSnapshot,
    ) -> tuple[List[_AssignedFrame], List[_AssignedFrame]]:
        previous_ids = {frame.id for frame in previous.frames}
        current_ids = {frame.id for frame in current.frames}
        entered = [frame for frame in current.frames if frame.id not in previous_ids]
        exited = [frame for frame in previous.frames if frame.id not in current_ids]
        return entered, exited

    def _location(self, frame: GdbFrameSnapshot) -> SourceLocation:
        file_name = Path(frame.file).name if frame.file else self.entry_file
        return SourceLocation(
            file=file_name,
            line=frame.line or 1,
        )

    @staticmethod
    def _same_invocation(
        current: GdbFrameSnapshot,
        previous: GdbFrameSnapshot,
    ) -> bool:
        current_file = Path(current.file).name if current.file else None
        previous_file = Path(previous.file).name if previous.file else None
        return (
            current.function == previous.function
            and current_file == previous_file
        )


def _optional_string(value: Any) -> Optional[str]:
    return str(value) if value is not None else None


def _optional_int(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
