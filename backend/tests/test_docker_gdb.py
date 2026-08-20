import os
import subprocess
from pathlib import Path

import pytest

from app.services.docker_gdb import DEFAULT_GDB_IMAGE, DockerGdbSession


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
        session.execute("-exec-next", wait_for_stop=True)
        variables = session.execute("-stack-list-variables --all-values")
        function_stop = session.execute("-exec-step", wait_for_stop=True)
        stack = session.execute("-stack-list-frames")

    assert first_stop.stopped is not None
    assert first_stop.stopped.payload["frame"]["line"] == "9"
    assert variables.result.payload["variables"][0] == {
        "name": "counter",
        "value": "2",
    }
    assert function_stop.stopped is not None
    assert function_stop.stopped.payload["frame"]["func"] == "add_one"
    frames = stack.result.payload["stack"]
    assert frames[0]["frame"]["func"] == "add_one"
    assert frames[1]["frame"]["func"] == "main"
