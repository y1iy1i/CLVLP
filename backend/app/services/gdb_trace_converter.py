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
    MemoryObject,
    ObjectLifetime,
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
    VariableStorage,
    MemoryField,
    PointerReference,
)
from app.services.gdb_mi import GdbMiError, MiCommandResponse, MiRecord


MAX_TRACE_STEPS = 500
MAX_MEMORY_BYTES_PER_VALUE = 4096
MAX_VALUE_CHILDREN = 100
MAX_VALUE_DEPTH = 4
MAX_GLOBAL_VARIABLES = 100


@dataclass(frozen=True)
class GdbValueFieldSnapshot:
    name: str
    value: str
    type: str = "unknown"
    expression: Optional[str] = None
    address: Optional[str] = None
    size: Optional[int] = None
    pointee_size: Optional[int] = None
    children: Sequence["GdbValueFieldSnapshot"] = field(default_factory=tuple)


@dataclass(frozen=True)
class GdbVariableSnapshot:
    name: str
    value: str
    type: str = "unknown"
    is_argument: bool = False
    address: Optional[str] = None
    size: Optional[int] = None
    memory_bytes: Optional[str] = None
    available: bool = True
    unavailable_reason: Optional[str] = None
    fields: Sequence[GdbValueFieldSnapshot] = field(default_factory=tuple)
    storage_region: Literal["stack", "global"] = "stack"
    pointee_size: Optional[int] = None


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
    globals: Sequence[GdbVariableSnapshot] = field(default_factory=tuple)
    reason: str = "end-stepping-range"
    stdout: str = ""
    stderr: str = ""
    signal_name: Optional[str] = None
    return_value: Optional[str] = None
    return_type: Optional[str] = None
    allocation_events: Sequence["GdbAllocationSnapshot"] = field(default_factory=tuple)
    return_events: Sequence["GdbReturnSnapshot"] = field(default_factory=tuple)

    @property
    def current_frame(self) -> GdbFrameSnapshot:
        if not self.frames:
            raise ValueError("A GDB stop snapshot must contain at least one frame.")
        return self.frames[0]


@dataclass(frozen=True)
class GdbAllocationSnapshot:
    operation: Literal["malloc", "calloc", "realloc", "free"]
    address: str
    size: int = 0
    previous_address: Optional[str] = None


@dataclass(frozen=True)
class GdbReturnSnapshot:
    frame_id: str
    function: str
    value: Optional[str]
    type: str
    available: bool


def parse_return_event(line: str) -> Optional[GdbReturnSnapshot]:
    try:
        payload = json.loads(line)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(payload, dict) or not payload.get("frameId"):
        return None
    return GdbReturnSnapshot(
        frame_id=str(payload["frameId"]),
        function=str(payload.get("function", "unknown")),
        value=_optional_string(payload.get("value")),
        type=str(payload.get("type", "unknown")),
        available=bool(payload.get("available", False)),
    )


def parse_allocation_event(line: str) -> Optional[GdbAllocationSnapshot]:
    fields = line.split("\t")
    if len(fields) != 4 or fields[0] not in {"malloc", "calloc", "realloc", "free"}:
        return None
    address = _hex_address(fields[1])
    previous = _hex_address(fields[3])
    if address is None:
        return None
    try:
        size = int(fields[2])
    except ValueError:
        return None
    return GdbAllocationSnapshot(
        operation=fields[0],  # type: ignore[arg-type]
        address=address,
        size=max(0, size),
        previous_address=previous if _address_int(previous) not in {None, 0} else None,
    )


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

    array_type_match = _array_type_match(normalized_type)
    if array_type_match and value.startswith("{") and value.endswith("}"):
        return _convert_gdb_array(
            value,
            array_type_match.group("element_type").strip(),
        )

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


def _array_type_match(type_name: str) -> Optional[re.Match[str]]:
    return re.match(
        r"^(?P<element_type>.+?)\s*(?:\[\d*\])+\s*$",
        type_name,
    )


def _convert_gdb_array(raw_value: str, element_type: str) -> Any:
    """Turn a GDB array such as ``{5, 3, 8}`` into a JSON-ready list."""

    inner = raw_value[1:-1].strip()
    if not inner:
        return []

    items = _split_gdb_array_items(inner)
    if items is None:
        return raw_value

    converted: List[Any] = []
    for item in items:
        item = item.strip()
        if item.startswith("{") and item.endswith("}"):
            converted.append(_convert_gdb_array(item, element_type))
        else:
            converted.append(convert_gdb_value(item, element_type))
    return converted


def _split_gdb_array_items(value: str) -> Optional[List[str]]:
    """Split values without breaking commas inside nested arrays or strings."""

    items: List[str] = []
    start = 0
    depth = 0
    quote: Optional[str] = None
    escaped = False

    for index, character in enumerate(value):
        if quote is not None:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue

        if character in {'"', "'"}:
            quote = character
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth < 0:
                return None
        elif character == "," and depth == 0:
            items.append(value[start:index])
            start = index + 1

    if quote is not None or depth != 0:
        return None
    items.append(value[start:])
    return items


def capture_gdb_snapshot(
    session: GdbCommandSession,
    stop: MiRecord,
    *,
    entry_file: Optional[str] = None,
    stdout: str = "",
    stderr: str = "",
    allocation_events: Sequence[GdbAllocationSnapshot] = (),
    return_events: Sequence[GdbReturnSnapshot] = (),
) -> GdbStopSnapshot:
    """Read every stack frame and its variables at one stopped GDB state.

    When ``entry_file`` is given, frames outside that source file (for
    example libc startup frames) are skipped so the trace only describes
    user code.
    """

    if stop.kind != "exec" or stop.message != "stopped":
        raise ValueError("The supplied GDB record is not a stopped event.")

    stack_response = session.execute("-stack-list-frames")
    raw_frames = stack_response.result.payload.get("stack", [])
    if entry_file is not None:
        user_frames = [
            item
            for item in raw_frames
            if _stack_item_source_file(item) == entry_file
        ]
        raw_frames = user_frames or raw_frames
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

    globals_ = _capture_globals(session, entry_file)

    return GdbStopSnapshot(
        frames=frames,
        globals=globals_,
        reason=str(stop.payload.get("reason", "unknown")),
        stdout=stdout,
        stderr=stderr,
        signal_name=_optional_string(stop.payload.get("signal-name")),
        return_value=_optional_string(stop.payload.get("return-value")),
        return_type=_optional_string(stop.payload.get("return-type")),
        allocation_events=allocation_events,
        return_events=return_events,
    )


def _capture_variable(
    session: GdbCommandSession,
    variable_payload: Dict[str, Any],
    *,
    storage_region: Literal["stack", "global"] = "stack",
) -> GdbVariableSnapshot:
    name = str(variable_payload.get("name", "unknown"))
    value = str(variable_payload.get("value", "<unavailable>"))
    type_name = "unknown"
    variable_object_name: Optional[str] = None
    fields: Sequence[GdbValueFieldSnapshot] = ()
    try:
        response = session.execute(f"-var-create - * {json.dumps(name)}")
        variable_object_name = _optional_string(response.result.payload.get("name"))
        type_name = str(response.result.payload.get("type", "unknown"))
        variable_object_value = str(response.result.payload.get("value", value))
        is_array_summary = (
            _array_type_match(type_name) is not None
            and re.fullmatch(r"\[\d+\]", variable_object_value) is not None
        )
        if not is_array_summary:
            value = variable_object_value
        fields = _capture_value_fields(session, variable_object_name, depth=0)
    except GdbMiError:
        pass
    finally:
        if variable_object_name:
            try:
                session.execute(f"-var-delete {variable_object_name}")
            except GdbMiError:
                pass

    unavailable = value in {"<optimized out>", "<unavailable>"}
    address = _evaluate_string(session, f"&({name})")
    size = _evaluate_int(session, f"sizeof({name})")
    memory_bytes = read_gdb_memory_bytes(session, address, size)
    pointee_size = (
        _evaluate_int(session, f"sizeof(*({name}))")
        if "*" in type_name
        else None
    )
    unavailable_reason = value[1:-1] if unavailable else None
    if address is None and not unavailable:
        unavailable_reason = "address unavailable (value may live in a register)"
    return GdbVariableSnapshot(
        name=name,
        value=value,
        type=type_name,
        is_argument=str(variable_payload.get("arg", "0")) == "1",
        address=_hex_address(address),
        size=size,
        memory_bytes=memory_bytes,
        available=not unavailable,
        unavailable_reason=unavailable_reason,
        fields=fields,
        storage_region=storage_region,
        pointee_size=pointee_size,
    )


def _capture_globals(
    session: GdbCommandSession,
    entry_file: Optional[str],
) -> Sequence[GdbVariableSnapshot]:
    """Capture addressable file-scope variables from the current program.

    GDB's stack commands intentionally omit globals. The symbol query supplies
    the names, then the normal variable-object path captures type, value,
    fields, address, size, and bytes just like it does for locals.
    """

    # Without a source filename GDB may also report globals from the small
    # instrumentation object linked into the executable. Runtime collection
    # always supplies the submitted entry file, so avoid mixing those symbols.
    if entry_file is None:
        return ()

    try:
        response = session.execute(
            f"-symbol-info-variables --max-results {MAX_GLOBAL_VARIABLES}"
        )
    except GdbMiError:
        return ()

    symbols = response.result.payload.get("symbols", {})
    debug_groups = symbols.get("debug", []) if isinstance(symbols, dict) else []
    names: List[str] = []
    seen: set[str] = set()
    for group in debug_groups:
        if not isinstance(group, dict):
            continue
        source = group.get("fullname") or group.get("filename")
        if entry_file and source and Path(str(source)).name != entry_file:
            continue
        for symbol in group.get("symbols", []):
            if not isinstance(symbol, dict):
                continue
            payload = symbol.get("symbol", symbol)
            if not isinstance(payload, dict):
                continue
            name = _optional_string(payload.get("name"))
            if not name or name in seen:
                continue
            seen.add(name)
            names.append(name)
            if len(names) >= MAX_GLOBAL_VARIABLES:
                break
        if len(names) >= MAX_GLOBAL_VARIABLES:
            break

    captured: List[GdbVariableSnapshot] = []
    for name in names:
        try:
            variable = _capture_variable(
                session,
                {"name": name, "value": "<unavailable>"},
                storage_region="global",
            )
            if variable.available or variable.address:
                captured.append(variable)
        except GdbMiError:
            continue
    return captured


def _capture_value_fields(
    session: GdbCommandSession,
    variable_object_name: Optional[str],
    *,
    depth: int,
) -> Sequence[GdbValueFieldSnapshot]:
    if not variable_object_name or depth >= MAX_VALUE_DEPTH:
        return ()
    try:
        response = session.execute(
            f"-var-list-children --all-values {variable_object_name} 0 {MAX_VALUE_CHILDREN}"
        )
    except GdbMiError:
        return ()
    raw_children = response.result.payload.get("children", [])
    result: List[GdbValueFieldSnapshot] = []
    for item in raw_children[:MAX_VALUE_CHILDREN]:
        if not isinstance(item, dict):
            continue
        payload = item.get("child", item)
        if not isinstance(payload, dict):
            continue
        child_object = _optional_string(payload.get("name"))
        expression = _optional_string(payload.get("exp"))
        path_expression = None
        if child_object:
            try:
                path_response = session.execute(
                    f"-var-info-path-expression {child_object}"
                )
                path_expression = _optional_string(
                    path_response.result.payload.get("path_expr")
                )
            except GdbMiError:
                pass
        child_address = (
            _evaluate_string(session, f"&({path_expression})")
            if path_expression
            else None
        )
        child_type = str(payload.get("type", "unknown"))
        child_size = (
            _evaluate_int(session, f"sizeof({path_expression})")
            if path_expression
            else None
        )
        pointee_size = (
            _evaluate_int(session, f"sizeof(*({path_expression}))")
            if path_expression and "*" in child_type
            else None
        )
        result.append(
            GdbValueFieldSnapshot(
                name=expression or path_expression or "field",
                value=str(payload.get("value", "<unavailable>")),
                type=child_type,
                expression=path_expression,
                address=_hex_address(child_address),
                size=child_size,
                pointee_size=pointee_size,
                children=_capture_value_fields(
                    session,
                    child_object,
                    depth=depth + 1,
                ) if str(payload.get("numchild", "0")) != "0" else (),
            )
        )
    return result


def _evaluate_string(
    session: GdbCommandSession,
    expression: str,
) -> Optional[str]:
    try:
        response = session.execute(
            f"-data-evaluate-expression {json.dumps(expression)}"
        )
        return _optional_string(response.result.payload.get("value"))
    except GdbMiError:
        return None


def _evaluate_int(session: GdbCommandSession, expression: str) -> Optional[int]:
    raw = _evaluate_string(session, expression)
    if raw is None:
        return None
    match = re.search(r"(?:0[xX][0-9a-fA-F]+|\d+)", raw)
    if not match:
        return None
    try:
        return int(match.group(0), 0)
    except ValueError:
        return None


def _hex_address(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    match = re.search(r"0[xX][0-9a-fA-F]+", raw)
    if not match:
        return None
    return f"0x{int(match.group(0), 16):x}"


def read_gdb_memory_bytes(
    session: GdbCommandSession,
    address: Optional[str],
    size: Optional[int],
) -> Optional[str]:
    normalized = _hex_address(address)
    if normalized is None or size is None or size <= 0:
        return None
    count = min(size, MAX_MEMORY_BYTES_PER_VALUE)
    try:
        response = session.execute(
            f"-data-read-memory-bytes {normalized} {count}"
        )
    except GdbMiError:
        return None
    for item in response.result.payload.get("memory", []):
        if isinstance(item, dict):
            payload = item.get("memory", item)
            if isinstance(payload, dict) and payload.get("contents") is not None:
                return str(payload["contents"])
    return None


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
        self._heap_objects: Dict[str, MemoryObject] = {}
        self._heap_by_address: Dict[str, str] = {}
        self._allocation_sequence = 0

    def add_snapshot(self, snapshot: GdbStopSnapshot) -> Optional[TraceStep]:
        assigned = self._assign_frames(snapshot)
        allocation_changes = self._apply_allocations(
            snapshot.allocation_events,
            assigned.frames[0].id if assigned.frames else None,
        )
        self._stdout += snapshot.stdout
        self._stderr += snapshot.stderr

        if self._previous is None:
            current = assigned.frames[0]
            step = self._create_step(
                location=self._location(current.snapshot),
                executed_location=None,
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
            current_frame = assigned.frames[0]
            changes = self._variable_changes(self._previous, assigned)
            entered, exited = self._frame_changes(self._previous, assigned)
            event = self._event_for_transition(
                snapshot=snapshot,
                changes=changes,
                entered=entered,
                exited=exited,
                allocations=allocation_changes,
            )
            step = self._create_step(
                location=self._location(current_frame.snapshot),
                executed_location=self._location(previous_frame.snapshot),
                event=event,
                snapshot=assigned,
            )

        self._previous = assigned
        if len(self._steps) >= self.max_steps:
            self._truncated = True
            self._sync_last_output()
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

    def append_output(self, stdout: str = "", stderr: str = "") -> None:
        """Attach output produced after the final source-level snapshot."""

        if not stdout and not stderr:
            return
        self._stdout += stdout
        self._stderr += stderr
        self._sync_last_output()
        if not self._steps:
            return
        last_event = self._steps[-1].event
        data = dict(last_event.data)
        if stdout:
            data["stdoutDelta"] = str(data.get("stdoutDelta", "")) + stdout
        if stderr:
            data["stderrDelta"] = str(data.get("stderrDelta", "")) + stderr
        self._steps[-1].event = TraceEvent(type=last_event.type, data=data)

    def append_terminal_events(
        self,
        allocations: Sequence[GdbAllocationSnapshot] = (),
        returns: Sequence[GdbReturnSnapshot] = (),
    ) -> None:
        """Preserve events emitted after the final source-level stop."""

        if not self._steps or (not allocations and not returns):
            return
        last = self._steps[-1]
        frame_id = last.state.callStack[0].id if last.state.callStack else None
        allocation_changes = self._apply_allocations(allocations, frame_id)
        if allocation_changes:
            non_heap = [
                item for item in last.state.memory if item.region != "heap"
            ]
            last.state.memory = non_heap + [
                item.model_copy(deep=True)
                for item in self._heap_objects.values()
            ]
            last.state.pointers = self._resolve_pointers(
                last.state.variables,
                last.state.memory,
            )
            direct_pointers = {
                pointer.sourceVariableId: pointer
                for pointer in last.state.pointers
                if pointer.id == f"pointer:{pointer.sourceVariableId}"
            }
            for variable in last.state.variables:
                variable.pointer = direct_pointers.get(variable.id)

        data = dict(last.event.data)
        if allocation_changes:
            data["allocations"] = [
                *data.get("allocations", []),
                *allocation_changes,
            ]
        if returns:
            data["terminalReturns"] = [
                {
                    "frameId": item.frame_id,
                    "function": item.function,
                    "returnAvailable": item.available,
                    "returnType": item.type,
                    "returnValue": (
                        convert_gdb_value(item.value or "", item.type)
                        if item.available
                        else None
                    ),
                }
                for item in returns
            ]
        last.event = TraceEvent(type=last.event.type, data=data)

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
        executed_location: Optional[SourceLocation],
        event: TraceEvent,
        snapshot: _AssignedSnapshot,
    ) -> TraceStep:
        variables: List[TraceVariable] = []
        call_stack: List[StackFrame] = []
        memory: List[MemoryObject] = [
            item.model_copy(deep=True) for item in self._heap_objects.values()
        ]
        for variable in snapshot.raw.globals:
            variable_id = f"global:{variable.name}"
            converted_value = convert_gdb_value(variable.value, variable.type)
            converted_fields = [
                self._convert_field(field_snapshot, variable.address)
                for field_snapshot in variable.fields
            ]
            variables.append(
                TraceVariable(
                    id=variable_id,
                    name=variable.name,
                    type=variable.type,
                    value=converted_value,
                    scope="global",
                    role="global",
                    available=variable.available,
                    pointeeSize=variable.pointee_size,
                    storage=VariableStorage(
                        address=variable.address,
                        size=variable.size,
                        region="global",
                        available=variable.address is not None,
                        unavailableReason=variable.unavailable_reason,
                        bytes=variable.memory_bytes,
                    ),
                    fields=converted_fields,
                )
            )
            if variable.address:
                memory.append(
                    MemoryObject(
                        id=variable_id,
                        address=variable.address,
                        size=variable.size,
                        type=variable.type,
                        value=converted_value,
                        region="global",
                        bytes=variable.memory_bytes,
                        readable=variable.memory_bytes is not None,
                        fields=converted_fields,
                        lifetime=ObjectLifetime(status="alive"),
                    )
                )
        for frame_index, frame in enumerate(snapshot.frames):
            variable_ids: List[str] = []
            argument_ids: List[str] = []
            local_ids: List[str] = []
            for variable in frame.snapshot.variables:
                variable_id = f"{frame.id}:{variable.name}"
                variable_ids.append(variable_id)
                (argument_ids if variable.is_argument else local_ids).append(variable_id)
                converted_value = convert_gdb_value(variable.value, variable.type)
                converted_fields = [
                    self._convert_field(field_snapshot, variable.address)
                    for field_snapshot in variable.fields
                ]
                variables.append(
                    TraceVariable(
                        id=variable_id,
                        frameId=frame.id,
                        name=variable.name,
                        type=variable.type,
                        value=converted_value,
                        scope=frame.snapshot.function,
                        role="parameter" if variable.is_argument else "local",
                        available=variable.available,
                        pointeeSize=variable.pointee_size,
                        storage=VariableStorage(
                            address=variable.address,
                            size=variable.size,
                            region="stack" if variable.address else "register",
                            available=variable.address is not None,
                            unavailableReason=variable.unavailable_reason,
                            bytes=variable.memory_bytes,
                        ),
                        fields=converted_fields,
                    )
                )
                if variable.address:
                    memory.append(
                        MemoryObject(
                            id=variable_id,
                            address=variable.address,
                            size=variable.size,
                            type=variable.type,
                            value=converted_value,
                            region="stack",
                            bytes=variable.memory_bytes,
                            readable=variable.memory_bytes is not None,
                            fields=converted_fields,
                            lifetime=ObjectLifetime(status="alive"),
                        )
                    )
            call_stack.append(
                StackFrame(
                    id=frame.id,
                    parentFrameId=(
                        snapshot.frames[frame_index + 1].id
                        if frame_index + 1 < len(snapshot.frames)
                        else None
                    ),
                    function=frame.snapshot.function,
                    variables=variable_ids,
                    arguments=argument_ids,
                    locals=local_ids,
                )
            )

        pointers = self._resolve_pointers(variables, memory)
        pointers_by_variable = {
            pointer.sourceVariableId: pointer
            for pointer in pointers
            if pointer.id == f"pointer:{pointer.sourceVariableId}"
        }
        for variable in variables:
            variable.pointer = pointers_by_variable.get(variable.id)
            pointer = variable.pointer
            if pointer and pointer.targetObjectId:
                target = next(
                    (item for item in memory if item.id == pointer.targetObjectId),
                    None,
                )
                if target and target.region == "heap" and target.type == "unknown":
                    target.type = variable.type.rsplit("*", 1)[0].strip() or "unknown"
                    target.fields = list(variable.fields)

        return TraceStep(
            step=len(self._steps),
            location=location,
            executedLocation=executed_location,
            event=event,
            state=ExecutionState(
                variables=variables,
                callStack=call_stack,
                memory=memory,
                pointers=pointers,
            ),
            output=StepOutput(stdout=self._stdout, stderr=self._stderr),
        )

    @staticmethod
    def _convert_field(
        field_snapshot: GdbValueFieldSnapshot,
        parent_address: Optional[str],
    ) -> MemoryField:
        address = _hex_address(field_snapshot.address)
        parent = _address_int(parent_address)
        child = _address_int(address)
        return MemoryField(
            name=field_snapshot.name,
            type=field_snapshot.type,
            value=convert_gdb_value(field_snapshot.value, field_snapshot.type),
            expression=field_snapshot.expression,
            address=address,
            offset=(child - parent if child is not None and parent is not None else None),
            size=field_snapshot.size,
            pointeeSize=field_snapshot.pointee_size,
            fields=[
                ExecutionTraceBuilder._convert_field(item, address)
                for item in field_snapshot.children
            ],
        )

    @staticmethod
    def _resolve_pointers(
        variables: Sequence[TraceVariable],
        objects: Sequence[MemoryObject],
    ) -> List[PointerReference]:
        pointers: List[PointerReference] = []
        for variable in variables:
            if "*" not in variable.type:
                pointer = None
            else:
                pointer = ExecutionTraceBuilder._resolve_pointer_value(
                    pointer_id=f"pointer:{variable.id}",
                    source_variable_id=variable.id,
                    source_expression=variable.name,
                    source_address=variable.storage.address,
                    type_name=variable.type,
                    raw_value=variable.value,
                    pointee_size=variable.pointeeSize,
                    objects=objects,
                )
                pointers.append(pointer)
            ExecutionTraceBuilder._resolve_field_pointers(
                variable.id,
                variable.fields,
                objects,
                pointers,
            )
        return pointers

    @staticmethod
    def _resolve_field_pointers(
        variable_id: str,
        fields: Sequence[MemoryField],
        objects: Sequence[MemoryObject],
        pointers: List[PointerReference],
        path: str = "",
    ) -> None:
        for field in fields:
            field_path = f"{path}.{field.name}" if path else field.name
            if "*" in field.type:
                source_variable_id = ExecutionTraceBuilder._memory_owner_id(
                    field.address,
                    objects,
                ) or variable_id
                pointer = ExecutionTraceBuilder._resolve_pointer_value(
                    pointer_id=f"pointer:{source_variable_id}:{field_path}",
                    source_variable_id=source_variable_id,
                    source_expression=field.expression or field_path,
                    source_address=field.address,
                    type_name=field.type,
                    raw_value=field.value,
                    pointee_size=field.pointeeSize,
                    objects=objects,
                )
                field.pointer = pointer
                pointers.append(pointer)
            ExecutionTraceBuilder._resolve_field_pointers(
                variable_id,
                field.fields,
                objects,
                pointers,
                field_path,
            )

    @staticmethod
    def _memory_owner_id(
        address: Optional[str],
        objects: Sequence[MemoryObject],
    ) -> Optional[str]:
        """Return the object whose byte range contains a captured field.

        GDB recursively expands pointees below the root variable. Those nested
        fields still carry their real addresses, so the address—not the root
        variable used to start expansion—identifies the pointer edge source.
        """
        value = _address_int(address)
        if value is None:
            return None
        for candidate in objects:
            start = _address_int(candidate.address)
            if start is None or candidate.size is None:
                continue
            if start <= value < start + candidate.size:
                return candidate.id
        return None

    @staticmethod
    def _resolve_pointer_value(
        *,
        pointer_id: str,
        source_variable_id: str,
        source_expression: Optional[str],
        source_address: Optional[str],
        type_name: str,
        raw_value: Any,
        pointee_size: Optional[int],
        objects: Sequence[MemoryObject],
    ) -> PointerReference:
        address_value = _hex_address(str(raw_value))
        target_type = type_name.rsplit("*", 1)[0].strip() or None
        if address_value is None or _address_int(address_value) == 0:
            return PointerReference(
                id=pointer_id,
                sourceVariableId=source_variable_id,
                sourceExpression=source_expression,
                sourceAddress=source_address,
                addressValue=address_value,
                targetType=target_type,
                elementSize=pointee_size,
                status="null" if address_value else "unreadable",
            )

        target_value = _address_int(address_value)
        target: Optional[MemoryObject] = None
        offset: Optional[int] = None
        for candidate in objects:
            start = _address_int(candidate.address)
            if start is None or candidate.size is None:
                continue
            if start <= target_value < start + candidate.size:
                target = candidate
                offset = target_value - start
                break
        if target and target.region == "heap" and target.type == "unknown" and target_type:
            target.type = target_type
        element_count = (
            target.size // pointee_size
            if target
            and target.region == "heap"
            and target.size is not None
            and pointee_size
            and target.size % pointee_size == 0
            else None
        )
        return PointerReference(
            id=pointer_id,
            sourceVariableId=source_variable_id,
            sourceExpression=source_expression,
            sourceAddress=source_address,
            addressValue=address_value,
            targetObjectId=target.id if target else None,
            targetAddress=target.address if target else address_value,
            offset=offset,
            targetType=target_type,
            elementSize=pointee_size,
            elementCount=element_count,
            status=(
                "dangling"
                if target and target.lifetime.status == "freed"
                else "resolved" if target else "unknown"
            ),
        )

    def _sync_last_output(self) -> None:
        if self._steps:
            self._steps[-1].output = StepOutput(
                stdout=self._stdout,
                stderr=self._stderr,
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
            if (
                old_value != new_value
                or old_variable.type != variable.type
            ):
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
        allocations: List[Dict[str, Any]],
    ) -> TraceEvent:
        data: Dict[str, Any] = {
            "changes": changes,
            "allocations": allocations,
        }
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
            returns_by_id = {item.frame_id: item for item in snapshot.return_events}
            frames = []
            for frame in exited:
                returned = returns_by_id.get(frame.id)
                frame_data: Dict[str, Any] = {
                    "id": frame.id,
                    "function": frame.snapshot.function,
                    "returnAvailable": bool(returned and returned.available),
                }
                if returned:
                    frame_data["returnType"] = returned.type
                    frame_data["returnValue"] = (
                        convert_gdb_value(returned.value or "", returned.type)
                        if returned.available
                        else None
                    )
                frames.append(frame_data)
            data["frames"] = frames
            return TraceEvent(type="function_exit", data=data)
        if snapshot.stdout or snapshot.stderr:
            data["stdoutDelta"] = snapshot.stdout
            data["stderrDelta"] = snapshot.stderr
            return TraceEvent(type="output", data=data)
        if allocations:
            return TraceEvent(type="allocation", data=data)
        return TraceEvent(type="line_executed", data=data)

    def _apply_allocations(
        self,
        events: Sequence[GdbAllocationSnapshot],
        frame_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        changes: List[Dict[str, Any]] = []
        step = len(self._steps)
        for event in events:
            if event.operation == "free":
                object_id = self._heap_by_address.get(event.address)
                memory_object = self._heap_objects.get(object_id or "")
                if memory_object:
                    memory_object.lifetime.freedAtStep = step
                    memory_object.lifetime.status = "freed"
                changes.append({
                    "operation": "free",
                    "allocationId": object_id,
                    "address": event.address,
                    "frameId": frame_id,
                })
                continue

            if _address_int(event.address) == 0:
                changes.append({
                    "operation": event.operation,
                    "allocationId": None,
                    "address": event.address,
                    "previousAddress": event.previous_address,
                    "size": event.size,
                    "frameId": frame_id,
                    "success": False,
                })
                continue

            if event.operation == "realloc" and event.previous_address:
                previous_id = self._heap_by_address.get(event.previous_address)
                previous = self._heap_objects.get(previous_id or "")
                if previous and event.previous_address != event.address:
                    previous.lifetime.freedAtStep = step
                    previous.lifetime.status = "freed"

            existing_id = self._heap_by_address.get(event.address)
            existing = self._heap_objects.get(existing_id or "")
            if existing and existing.lifetime.status == "alive":
                existing.size = event.size
                object_id = existing.id
            else:
                self._allocation_sequence += 1
                object_id = f"heap:{self._allocation_sequence}"
                self._heap_objects[object_id] = MemoryObject(
                    id=object_id,
                    address=event.address,
                    size=event.size,
                    type="unknown",
                    value=None,
                    region="heap",
                    readable=False,
                    lifetime=ObjectLifetime(
                        allocatedAtStep=step,
                        status="alive",
                    ),
                )
                self._heap_by_address[event.address] = object_id
            changes.append({
                "operation": event.operation,
                "allocationId": object_id,
                "address": event.address,
                "previousAddress": event.previous_address,
                "size": event.size,
                "frameId": frame_id,
                "success": True,
            })
        return changes

    @staticmethod
    def _variables_by_id(
        snapshot: _AssignedSnapshot,
    ) -> Dict[str, GdbVariableSnapshot]:
        variables = {
            f"{frame.id}:{variable.name}": variable
            for frame in snapshot.frames
            for variable in frame.snapshot.variables
        }
        variables.update(
            {f"global:{variable.name}": variable for variable in snapshot.raw.globals}
        )
        return variables

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


def _stack_item_source_file(stack_item: Any) -> Optional[str]:
    if not isinstance(stack_item, dict):
        return None
    frame_payload = stack_item.get("frame", stack_item)
    if not isinstance(frame_payload, dict):
        return None
    file_name = frame_payload.get("fullname") or frame_payload.get("file")
    if not file_name:
        return None
    return Path(str(file_name)).name


def _optional_string(value: Any) -> Optional[str]:
    return str(value) if value is not None else None


def _optional_int(value: Any) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _address_int(value: Optional[str]) -> Optional[int]:
    normalized = _hex_address(value)
    return int(normalized, 16) if normalized is not None else None
