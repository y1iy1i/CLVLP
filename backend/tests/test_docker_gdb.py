import os
import subprocess
from pathlib import Path

import pytest

from app.services.docker_gdb import DEFAULT_GDB_IMAGE, DockerGdbSession
from app.services.gdb_trace_converter import (
    ExecutionTraceBuilder,
    capture_gdb_snapshot,
)


image = os.getenv("CLVLP_GDB_IMAGE", DEFAULT_GDB_IMAGE)


def _gdb_image_available() -> bool:
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", image],
            capture_output=True,
            check=False,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


pytestmark = pytest.mark.skipif(
    not _gdb_image_available(),
    reason="Docker GDB image is not available",
)


def test_gdb_reads_lines_variables_and_stack() -> None:
    source_path = Path(__file__).parent / "fixtures" / "gdb_smoke" / "main.c"

    with DockerGdbSession(source_path.read_text(encoding="utf-8"), image) as session:
        session.execute("-break-insert main")
        first_stop = session.execute("-exec-run", wait_for_stop=True)
        assert first_stop.stopped is not None
        initial_snapshot = capture_gdb_snapshot(
            session,
            first_stop.stopped,
        )
        next_stop = session.execute("-exec-next", wait_for_stop=True)
        assert next_stop.stopped is not None
        next_snapshot = capture_gdb_snapshot(
            session,
            next_stop.stopped,
        )
        function_stop = session.execute("-exec-step", wait_for_stop=True)
        assert function_stop.stopped is not None
        function_snapshot = capture_gdb_snapshot(
            session,
            function_stop.stopped,
        )

    assert initial_snapshot.current_frame.line == 9
    assert next_snapshot.current_frame.variables[0].name == "counter"
    assert next_snapshot.current_frame.variables[0].type == "int"
    assert next_snapshot.current_frame.variables[0].value == "2"
    assert function_snapshot.current_frame.function == "add_one"
    assert function_snapshot.frames[1].function == "main"

    builder = ExecutionTraceBuilder()
    builder.add_snapshot(initial_snapshot)
    declaration_step = builder.add_snapshot(next_snapshot)
    function_step = builder.add_snapshot(function_snapshot)
    trace = builder.build(status="cancelled", exit_code=None)

    assert declaration_step is not None
    assert declaration_step.location.line == 10
    assert declaration_step.executedLocation is not None
    assert declaration_step.executedLocation.line == 9
    assert declaration_step.state.variables[0].value == 2
    assert function_step is not None
    assert function_step.event.type == "function_enter"
    assert trace.summary.totalSteps == 3
