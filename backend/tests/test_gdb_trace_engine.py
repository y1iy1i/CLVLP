from dataclasses import dataclass, field
from typing import List, Optional, Type

import pytest

from app.models.trace import RunRequest
from app.services.docker_gdb import DockerGdbCompileError
from app.services.gdb_mi import (
    GdbMiProtocolError,
    GdbMiTimeout,
    MiCommandResponse,
    MiRecord,
    parse_mi_record,
)
from app.services.trace_engine import (
    GdbTraceEngine,
    MockTraceEngine,
    create_trace_engine,
)


ENTRY_FILE = "main.c"


@dataclass
class ScriptedVariable:
    name: str
    value: str
    type: str = "int"
    address: str = "0x1000"
    size: int = 4
    is_argument: bool = False

    def mi_payload(self) -> str:
        arg = "1" if self.is_argument else "0"
        return f'{{name="{self.name}",value="{self.value}",arg="{arg}"}}'


@dataclass
class ScriptedFrame:
    level: int
    function: str
    line: int
    file: Optional[str] = ENTRY_FILE
    variables: List[ScriptedVariable] = field(default_factory=list)

    @property
    def mi_frame(self) -> str:
        parts = [f'level="{self.level}"', f'func="{self.function}"']
        if self.file:
            parts.append(f'file="{self.file}"')
            parts.append(f'fullname="/workspace/{self.file}"')
        parts.append(f'line="{self.line}"')
        return f"frame={{{','.join(parts)}}}"


@dataclass
class ScriptedStop:
    reason: str
    frames: List[ScriptedFrame] = field(default_factory=list)
    stdout: str = ""
    stderr: str = ""
    signal_name: Optional[str] = None
    exit_code: Optional[str] = None
    error: Optional[Type[Exception]] = None
    memory_events: List[str] = field(default_factory=list)
    return_events: List[str] = field(default_factory=list)
    globals: List[ScriptedVariable] = field(default_factory=list)

    def stopped_line(self) -> str:
        parts = [f'reason="{self.reason}"']
        if self.signal_name is not None:
            parts.append(f'signal-name="{self.signal_name}"')
        if self.exit_code is not None:
            parts.append(f'exit-code="{self.exit_code}"')
        if self.frames:
            parts.append(self.frames[0].mi_frame)
        return f"*stopped,{','.join(parts)}"


class FakeGdbSession:
    """Scripted GDB/MI session that replays canned stop events."""

    def __init__(
        self,
        stops: List[ScriptedStop],
        *,
        fail_start: Optional[Type[Exception]] = None,
    ) -> None:
        self.stops = stops
        self.fail_start = fail_start
        self.stop_index = -1
        self.selected_level = 0
        self.var_sequence = 0
        self.breakpoint_sequence = 0
        self.commands: List[str] = []
        self.closed = False
        self.output_consumed = True

    def start(self) -> List[MiRecord]:
        if self.fail_start is not None:
            raise self.fail_start
        return []

    def close(self) -> None:
        self.closed = True

    def execute(
        self,
        command: str,
        *,
        wait_for_stop: bool = False,
        timeout: float = 5.0,
    ) -> MiCommandResponse:
        self.commands.append(command)

        if command in {"-exec-run", "-exec-step", "-exec-finish"}:
            self.stop_index += 1
            assert self.stop_index < len(self.stops), "Scripted stops exhausted"
            stop = self.stops[self.stop_index]
            if stop.error is not None:
                raise stop.error
            self.output_consumed = False
            return MiCommandResponse(
                result=parse_mi_record("^running"),
                records=[],
                stopped=parse_mi_record(stop.stopped_line()),
            )

        if command.startswith("-break-insert"):
            self.breakpoint_sequence += 1
            return self._done(f'bkpt={{number="{self.breakpoint_sequence}"}}')
        if command.startswith("-interpreter-exec console"):
            return self._done()
        if command == "-stack-list-frames":
            stack = ",".join(frame.mi_frame for frame in self._current().frames)
            return self._done(f"stack=[{stack}]")
        if command.startswith("-stack-select-frame"):
            self.selected_level = int(command.rsplit(" ", 1)[-1])
            return self._done()
        if command == "-stack-list-variables --all-values":
            frame = self._current_frame()
            variables = ",".join(v.mi_payload() for v in frame.variables)
            return self._done(f"variables=[{variables}]")
        if command.startswith("-symbol-info-variables"):
            symbols = ",".join(
                f'{{name="{variable.name}",type="{variable.type}"}}'
                for variable in self._current().globals
            )
            return self._done(
                f'symbols={{debug=[{{filename="{ENTRY_FILE}",'
                f'fullname="/workspace/{ENTRY_FILE}",symbols=[{symbols}]}}],'
                'nondebug=[]}'
            )
        if command.startswith("-var-create"):
            name = command.rsplit(" ", 1)[-1].strip('"')
            variable = next(
                v
                for v in self._current_frame().variables + self._current().globals
                if v.name == name
            )
            self.var_sequence += 1
            return self._done(
                f'name="var{self.var_sequence}",numchild="0",'
                f'value="{variable.value}",type="{variable.type}",thread-id="1"'
            )
        if command.startswith("-var-delete"):
            return self._done()
        if command.startswith("-var-list-children"):
            return self._done('numchild="0",children=[]')
        if command.startswith("-data-evaluate-expression"):
            expression = command.split(" ", 1)[1]
            variable = next(
                v
                for v in self._current_frame().variables + self._current().globals
                if v.name in expression
            )
            if "sizeof" in expression:
                return self._done(f'value="{variable.size}"')
            return self._done(f'value="{variable.address}"')
        if command.startswith("-data-read-memory-bytes"):
            count = int(command.rsplit(" ", 1)[-1])
            return self._done(
                'memory=[{begin="0x1000",offset="0x0",'
                f'end="0x{0x1000 + count:x}",contents="{"00" * count}"}}]'
            )
        raise AssertionError(f"Unexpected GDB command: {command}")

    def read_output(self) -> tuple[str, str]:
        if self.output_consumed or self.stop_index < 0:
            return "", ""
        self.output_consumed = True
        stop = self._current()
        return stop.stdout, stop.stderr

    def read_memory_events(self) -> List[str]:
        if self.stop_index < 0:
            return []
        return list(self._current().memory_events)

    def read_return_events(self) -> List[str]:
        if self.stop_index < 0:
            return []
        return list(self._current().return_events)

    def _current(self) -> ScriptedStop:
        assert self.stop_index >= 0, "No stop has been reached yet"
        return self.stops[self.stop_index]

    def _current_frame(self) -> ScriptedFrame:
        return next(
            f for f in self._current().frames if f.level == self.selected_level
        )

    @staticmethod
    def _done(payload: str = "") -> MiCommandResponse:
        result = parse_mi_record(f"^done,{payload}" if payload else "^done")
        return MiCommandResponse(result=result, records=[], stopped=None)


def make_engine(
    stops: List[ScriptedStop],
    **kwargs: object,
) -> tuple[GdbTraceEngine, FakeGdbSession]:
    session = FakeGdbSession(stops)
    engine = GdbTraceEngine(
        session_factory=lambda code: session,  # type: ignore[arg-type]
        **kwargs,  # type: ignore[arg-type]
    )
    return engine, session


def run_request() -> RunRequest:
    return RunRequest(code="int main(void) { return 0; }", entryFile=ENTRY_FILE)


def test_engine_records_steps_and_normal_exit() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(
            reason="end-stepping-range",
            frames=[
                ScriptedFrame(
                    0, "main", 4, variables=[ScriptedVariable("counter", "2")]
                )
            ],
        ),
        ScriptedStop(reason="exited-normally"),
    ]
    engine, session = make_engine(stops)
    trace = engine.run(run_request())

    assert trace.status == "completed"
    assert trace.summary.exitCode == 0
    assert trace.summary.truncated is False
    assert trace.error is None
    assert trace.summary.totalSteps == 2
    assert trace.trace[0].event.type == "function_enter"
    assert trace.trace[1].event.type == "line_executed"
    assert trace.trace[1].location.line == 4
    assert trace.trace[1].executedLocation is not None
    assert trace.trace[1].executedLocation.line == 3
    counter = trace.trace[1].state.variables[0]
    assert (counter.name, counter.value) == ("counter", 2)
    assert counter.storage.address == "0x1000"
    assert counter.storage.size == 4
    assert counter.storage.bytes == "00000000"
    assert session.closed is True


def test_engine_collects_global_variables_in_the_same_trace_state() -> None:
    global_count = ScriptedVariable(
        "global_count",
        "3",
        address="0x3000",
        size=4,
    )
    stops = [
        ScriptedStop(
            reason="breakpoint-hit",
            frames=[ScriptedFrame(0, "main", 3)],
            globals=[global_count],
        ),
        ScriptedStop(reason="exited-normally"),
    ]
    engine, _ = make_engine(stops)

    trace = engine.run(run_request())

    captured = next(
        variable
        for variable in trace.trace[0].state.variables
        if variable.name == "global_count"
    )
    assert captured.id == "global:global_count"
    assert captured.role == "global"
    assert captured.scope == "global"
    assert captured.frameId is None
    assert captured.storage.region == "global"
    assert captured.storage.address == "0x3000"
    memory = next(
        item for item in trace.trace[0].state.memory if item.id == captured.id
    )
    assert memory.region == "global"


def test_engine_flushes_stdout_from_exit_stop() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 2)]),
        ScriptedStop(reason="exited-normally", stdout="hello"),
    ]
    engine, _ = make_engine(stops)

    trace = engine.run(run_request())

    assert trace.status == "completed"
    assert trace.trace[-1].output.stdout == "hello"
    assert trace.trace[-1].output.stderr == ""
    assert trace.trace[-1].event.data["stdoutDelta"] == "hello"


def test_engine_keeps_stderr_separate() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 2)]),
        ScriptedStop(reason="exited-normally", stderr="oops\n"),
    ]
    engine, _ = make_engine(stops)

    trace = engine.run(run_request())

    assert trace.trace[-1].output.stdout == ""
    assert trace.trace[-1].output.stderr == "oops\n"
    assert trace.trace[-1].event.data["stderrDelta"] == "oops\n"


def test_engine_skips_system_functions_and_keeps_output() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(
            # Stepped into printf, which has no user source file.
            reason="end-stepping-range",
            frames=[
                ScriptedFrame(0, "printf", 0, file=None),
                ScriptedFrame(1, "main", 4),
            ],
        ),
        ScriptedStop(
            reason="function-finished",
            frames=[
                ScriptedFrame(
                    0, "main", 5, variables=[ScriptedVariable("total", "6")]
                )
            ],
            stdout="total=6\n",
        ),
        ScriptedStop(reason="exited-normally"),
    ]
    engine, session = make_engine(stops)
    trace = engine.run(run_request())

    assert trace.status == "completed"
    assert trace.summary.exitCode == 0
    assert trace.summary.totalSteps == 2
    assert "-exec-finish" in session.commands
    functions = {
        frame.function
        for step in trace.trace
        for frame in step.state.callStack
    }
    assert "printf" not in functions
    last_step = trace.trace[-1]
    assert last_step.event.type == "output"
    assert last_step.event.data["stdoutDelta"] == "total=6\n"
    assert last_step.output.stdout == "total=6\n"


def test_engine_reports_runtime_signal() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(
            reason="signal-received",
            signal_name="SIGSEGV",
            frames=[
                ScriptedFrame(
                    0,
                    "main",
                    4,
                    variables=[ScriptedVariable("pointer", "0x0", "int *")],
                )
            ],
        ),
    ]
    engine, _ = make_engine(stops)
    trace = engine.run(run_request())

    assert trace.status == "runtime_error"
    assert trace.error is not None
    assert trace.error.type == "runtime_signal"
    assert trace.error.details == {"signal": "SIGSEGV"}
    assert trace.summary.totalSteps == 2
    assert trace.trace[-1].event.type == "runtime_signal"


def test_engine_reports_terminated_signal() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(reason="exited-signalled", signal_name="SIGKILL"),
    ]
    engine, _ = make_engine(stops)
    trace = engine.run(run_request())

    assert trace.status == "runtime_error"
    assert trace.error is not None
    assert trace.error.details == {"signal": "SIGKILL"}
    assert trace.summary.totalSteps == 1


def test_engine_parses_nonzero_exit_code() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(reason="exited", exit_code="05"),
    ]
    engine, _ = make_engine(stops)
    trace = engine.run(run_request())

    assert trace.status == "completed"
    assert trace.summary.exitCode == 5


def test_engine_truncates_at_max_steps() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)])
    ]
    for line in range(4, 10):
        stops.append(
            ScriptedStop(
                reason="end-stepping-range",
                frames=[
                    ScriptedFrame(
                        0,
                        "main",
                        line,
                        variables=[ScriptedVariable("counter", str(line))],
                    )
                ],
            )
        )
    engine, _ = make_engine(stops, max_steps=2)
    trace = engine.run(run_request())

    assert trace.status == "completed"
    assert trace.summary.totalSteps == 2
    assert trace.summary.truncated is True
    assert trace.summary.exitCode is None


def test_engine_times_out_when_program_hangs() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(
            reason="end-stepping-range",
            frames=[ScriptedFrame(0, "main", 4)],
            error=GdbMiTimeout("GDB/MI command timed out: -exec-step"),
        ),
    ]
    engine, _ = make_engine(stops)
    trace = engine.run(run_request())

    assert trace.status == "timeout"
    assert trace.error is not None
    assert trace.error.type == "timeout"
    assert trace.summary.totalSteps == 1


def test_engine_stops_when_time_budget_expires() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(reason="end-stepping-range", frames=[ScriptedFrame(0, "main", 4)]),
        ScriptedStop(reason="exited-normally"),
    ]
    engine, _ = make_engine(stops, timeout_seconds=0.0)
    trace = engine.run(run_request())

    assert trace.status == "timeout"
    assert trace.error is not None
    assert trace.error.type == "timeout"
    assert trace.summary.totalSteps == 0


def test_engine_maps_gdb_protocol_error_to_runtime_error() -> None:
    stops = [
        ScriptedStop(reason="breakpoint-hit", frames=[ScriptedFrame(0, "main", 3)]),
        ScriptedStop(
            reason="end-stepping-range",
            frames=[ScriptedFrame(0, "main", 4)],
            error=GdbMiProtocolError("Cannot access memory at address 0x0"),
        ),
    ]
    engine, _ = make_engine(stops)
    trace = engine.run(run_request())

    assert trace.status == "runtime_error"
    assert trace.error is not None
    assert trace.error.type == "gdb_error"
    assert trace.summary.totalSteps == 1


def test_engine_maps_compile_error_to_trace() -> None:
    session = FakeGdbSession(
        [],
        fail_start=DockerGdbCompileError("main.c:3:12: error: 'x' undeclared"),
    )
    engine = GdbTraceEngine(session_factory=lambda code: session)
    trace = engine.run(run_request())

    assert trace.status == "compile_error"
    assert trace.trace == []
    assert trace.summary.totalSteps == 0
    assert trace.error is not None
    assert trace.error.type == "compile_error"
    assert "undeclared" in trace.error.details["stderr"]


def test_mock_engine_returns_mock_trace() -> None:
    trace = MockTraceEngine().run(run_request())

    assert trace.schemaVersion == "1.2"
    assert trace.status == "completed"
    assert len(trace.trace) > 0


def test_create_trace_engine_defaults_to_mock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CLVLP_TRACE_ENGINE", raising=False)
    assert isinstance(create_trace_engine(), MockTraceEngine)


def test_create_trace_engine_selects_gdb(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLVLP_TRACE_ENGINE", " GDB ")
    assert isinstance(create_trace_engine(), GdbTraceEngine)


def test_create_trace_engine_rejects_unknown_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLVLP_TRACE_ENGINE", "bogus")
    with pytest.raises(ValueError):
        create_trace_engine()
