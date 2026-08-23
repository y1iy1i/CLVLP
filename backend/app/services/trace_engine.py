from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable, List, Optional, Protocol, Set, Tuple
from uuid import uuid4

from app.models.trace import (
    ExecutionTrace,
    RunRequest,
    RunStatus,
    TraceError,
    TraceSource,
    TraceSummary,
)
from app.services.docker_gdb import DockerGdbCompileError, DockerGdbSession
from app.services.gdb_mi import GdbMiError, GdbMiTimeout, MiCommandResponse, MiRecord
from app.services.gdb_trace_converter import (
    MAX_TRACE_STEPS,
    ExecutionTraceBuilder,
    capture_gdb_snapshot,
)
from app.services.mock_runner import create_mock_trace


GDB_TRACE_TIMEOUT_SECONDS = 60.0


class TraceEngine(Protocol):
    def run(self, request: RunRequest) -> ExecutionTrace:
        """Generate one execution trace for a submitted C program."""


class GdbSession(Protocol):
    """Structural interface shared by DockerGdbSession and test doubles."""

    def start(self) -> List[MiRecord]: ...

    def execute(
        self,
        command: str,
        *,
        wait_for_stop: bool = False,
        timeout: float = 5.0,
    ) -> MiCommandResponse: ...

    def read_output(self) -> Tuple[str, str]: ...

    def close(self) -> None: ...


GdbSessionFactory = Callable[[str], GdbSession]


class MockTraceEngine:
    """Deterministic teaching trace without executing the C source."""

    def run(self, request: RunRequest) -> ExecutionTrace:
        return create_mock_trace(request)


class GdbTraceEngine:
    """Drive a real GDB/MI session step by step and record the trace."""

    def __init__(
        self,
        *,
        image: Optional[str] = None,
        max_steps: int = MAX_TRACE_STEPS,
        timeout_seconds: float = GDB_TRACE_TIMEOUT_SECONDS,
        session_factory: Optional[GdbSessionFactory] = None,
    ) -> None:
        self.image = image
        self.max_steps = max_steps
        self.timeout_seconds = timeout_seconds
        self._session_factory = session_factory or (
            lambda code: DockerGdbSession(code, image)
        )

    def run(self, request: RunRequest) -> ExecutionTrace:
        session = self._session_factory(request.code)
        try:
            try:
                session.start()
            except DockerGdbCompileError as exc:
                return _compile_error_trace(request, exc.stderr)
            return self._collect_trace(session, request)
        finally:
            session.close()

    def _collect_trace(
        self,
        session: GdbSession,
        request: RunRequest,
    ) -> ExecutionTrace:
        builder = ExecutionTraceBuilder(
            entry_file=request.entryFile,
            max_steps=self.max_steps,
        )
        deadline = time.monotonic() + self.timeout_seconds
        try:
            status, exit_code, error = self._drive(
                session,
                builder,
                request.entryFile,
                deadline,
            )
        except GdbMiTimeout as exc:
            status = "timeout"
            exit_code = None
            error = TraceError(
                type="timeout",
                message=(
                    "Trace generation timed out; the program may be blocked "
                    "waiting for input or stuck in a computation that never "
                    "finishes."
                ),
                details={"reason": str(exc)},
            )
        except GdbMiError as exc:
            status = "runtime_error"
            exit_code = None
            error = TraceError(
                type="gdb_error",
                message=f"The GDB session failed: {exc}",
                details={"reason": str(exc)},
            )
        return builder.build(status=status, exit_code=exit_code, error=error)

    def _drive(
        self,
        session: GdbSession,
        builder: ExecutionTraceBuilder,
        entry_file: str,
        deadline: float,
    ) -> Tuple[RunStatus, Optional[int], Optional[TraceError]]:
        session.execute("-break-insert main")
        response = session.execute("-exec-run", wait_for_stop=True)
        guarded_lines: Set[Tuple[str, int]] = set()
        pending_stdout = ""
        pending_stderr = ""

        while True:
            stdout, stderr = session.read_output()
            pending_stdout += stdout
            pending_stderr += stderr

            if time.monotonic() >= deadline:
                builder.append_output(pending_stdout, pending_stderr)
                return (
                    "timeout",
                    None,
                    TraceError(
                        type="timeout",
                        message=(
                            "Trace generation exceeded the time budget; the "
                            "program may perform a very slow computation."
                        ),
                    ),
                )

            stop = response.stopped
            if stop is None:
                raise GdbMiError("GDB command finished without a stop event.")

            reason = str(stop.payload.get("reason", ""))

            if reason in {"exited-normally", "exited"}:
                builder.append_output(pending_stdout, pending_stderr)
                return (
                    "completed",
                    _parse_exit_code(
                        stop.payload.get("exit-code"),
                        default=0 if reason == "exited-normally" else None,
                    ),
                    None,
                )

            if reason == "exited-signalled":
                builder.append_output(pending_stdout, pending_stderr)
                signal_name = str(stop.payload.get("signal-name", "unknown"))
                return (
                    "runtime_error",
                    None,
                    _signal_error(signal_name, terminated=True),
                )

            if reason == "signal-received":
                snapshot = capture_gdb_snapshot(
                    session,
                    stop,
                    entry_file=entry_file,
                    stdout=pending_stdout,
                    stderr=pending_stderr,
                )
                builder.add_snapshot(snapshot)
                signal_name = str(stop.payload.get("signal-name", "unknown"))
                return (
                    "runtime_error",
                    None,
                    _signal_error(signal_name, terminated=False),
                )

            if not _stop_in_user_source(stop, entry_file):
                # Stepped into a function without user source (typically a
                # libc call); resume until that frame returns.
                response = session.execute("-exec-finish", wait_for_stop=True)
                continue

            snapshot = capture_gdb_snapshot(
                session,
                stop,
                entry_file=entry_file,
                stdout=pending_stdout,
                stderr=pending_stderr,
            )
            pending_stdout = ""
            pending_stderr = ""
            if builder.add_snapshot(snapshot) is None:
                # Reached the step limit; keep the collected trace.
                return ("completed", None, None)

            _guard_current_line(session, stop, guarded_lines)
            response = session.execute("-exec-step", wait_for_stop=True)


def create_trace_engine() -> TraceEngine:
    """Select the trace engine configured through CLVLP_TRACE_ENGINE."""
    name = os.getenv("CLVLP_TRACE_ENGINE", "mock").strip().lower()
    if name == "mock":
        return MockTraceEngine()
    if name == "gdb":
        return GdbTraceEngine()
    raise ValueError(
        f"Unsupported CLVLP_TRACE_ENGINE value: {name!r}; "
        "expected 'mock' or 'gdb'."
    )


def _guard_current_line(
    session: GdbSession,
    stop: MiRecord,
    guarded_lines: Set[Tuple[str, int]],
) -> None:
    """Arm a breakpoint on the current line before stepping.

    ``-exec-step`` never stops when a tight loop jumps back into its own
    line, because the program counter stays inside the step range; the
    breakpoint is what stops every loop iteration.
    """
    frame = stop.payload.get("frame")
    if not isinstance(frame, dict):
        return
    file_name = frame.get("fullname") or frame.get("file")
    line = frame.get("line")
    if not file_name or line is None:
        return
    location = (str(file_name), int(line))
    if location in guarded_lines:
        return
    session.execute(f"-break-insert {file_name}:{line}")
    guarded_lines.add(location)


def _stop_in_user_source(stop: MiRecord, entry_file: str) -> bool:
    frame = stop.payload.get("frame")
    if not isinstance(frame, dict):
        return False
    file_name = frame.get("fullname") or frame.get("file")
    if not file_name:
        return False
    return Path(str(file_name)).name == entry_file


def _parse_exit_code(
    raw_value: object,
    *,
    default: Optional[int],
) -> Optional[int]:
    if raw_value is None:
        return default
    try:
        return int(str(raw_value), 8)  # GDB reports exit codes in octal.
    except ValueError:
        return default


def _signal_error(signal_name: str, *, terminated: bool) -> TraceError:
    action = "was terminated by" if terminated else "stopped on"
    return TraceError(
        type="runtime_signal",
        message=f"Program {action} signal {signal_name}.",
        details={"signal": signal_name},
    )


def _compile_error_trace(request: RunRequest, stderr: str) -> ExecutionTrace:
    return ExecutionTrace(
        runId=f"run_{uuid4().hex[:12]}",
        status="compile_error",
        source=TraceSource(entryFile=request.entryFile),
        trace=[],
        summary=TraceSummary(totalSteps=0, exitCode=None, truncated=False),
        error=TraceError(
            type="compile_error",
            message="GCC could not compile the submitted source.",
            details={"stderr": stderr},
        ),
    )
