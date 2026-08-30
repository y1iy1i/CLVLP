import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.trace import RunRequest
from app.services.docker_gdb import DEFAULT_GDB_IMAGE
from app.services.trace_engine import GdbTraceEngine


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


FOR_LOOP_CODE = (
    "#include <stdio.h>\n"
    "\n"
    "int main(void) {\n"
    "    int total = 0;\n"
    "    for (int i = 1; i <= 3; i++) {\n"
    "        total += i;\n"
    "    }\n"
    '    printf("total=%d\\n", total);\n'
    "    return 0;\n"
    "}\n"
)

RECURSION_CODE = (
    "int factorial(int n) {\n"
    "    if (n <= 1) {\n"
    "        return 1;\n"
    "    }\n"
    "    return n * factorial(n - 1);\n"
    "}\n"
    "\n"
    "int main(void) {\n"
    "    int result = factorial(3);\n"
    "    return result == 6 ? 0 : 1;\n"
    "}\n"
)

WHILE_CODE = (
    "int main(void) {\n"
    "    int a = 10;\n"
    "    int b = 0;\n"
    "    while (a > 0) {\n"
    "        b = b + a;\n"
    "        a = a - 3;\n"
    "    }\n"
    "    return b == 22 ? 0 : 1;\n"
    "}\n"
)

MEMORY_CODE = (
    "#include <stdlib.h>\n"
    "int global_count = 3;\n"
    "typedef struct Node { int value; struct Node *next; } Node;\n"
    "int add_one(int value) { int result = value + 1; return result; }\n"
    "int main(void) {\n"
    "    int number = 10;\n"
    "    int *pointer = &number;\n"
    "    Node *node = malloc(sizeof(Node));\n"
    "    node->value = add_one(*pointer);\n"
    "    node->next = NULL;\n"
    "    int result = node->value;\n"
    "    free(node);\n"
    "    return result == 11 ? 0 : 1;\n"
    "}\n"
)


def test_engine_traces_for_loop_with_output() -> None:
    trace = GdbTraceEngine().run(RunRequest(code=FOR_LOOP_CODE, entryFile="main.c"))

    assert trace.status == "completed"
    assert trace.summary.exitCode == 0
    assert trace.summary.truncated is False
    assert trace.error is None
    assert trace.summary.totalSteps > 5
    assert all(step.location.file == "main.c" for step in trace.trace)
    assert trace.trace[-1].output.stdout == "total=6\n"

    totals = [
        variable.value
        for step in trace.trace
        for variable in step.state.variables
        if variable.name == "total"
    ]
    assert 6 in totals


def test_engine_captures_single_line_exit_output() -> None:
    code = (
        "#include <stdio.h>\n"
        'int main(void) { printf("hello\\n"); return 0; }\n'
    )

    trace = GdbTraceEngine().run(RunRequest(code=code, entryFile="main.c"))

    assert trace.status == "completed"
    assert trace.trace[-1].output.stdout == "hello\n"
    assert trace.trace[-1].output.stderr == ""


def test_engine_captures_output_without_trailing_newline() -> None:
    code = (
        "#include <stdio.h>\n"
        "int main(void) {\n"
        '    printf("hello");\n'
        "    return 0;\n"
        "}\n"
    )

    trace = GdbTraceEngine().run(RunRequest(code=code, entryFile="main.c"))

    assert trace.status == "completed"
    assert trace.trace[-1].output.stdout == "hello"
    assert trace.trace[-1].output.stderr == ""


def test_engine_keeps_stderr_separate_from_stdout() -> None:
    code = (
        "#include <stdio.h>\n"
        "int main(void) {\n"
        '    fprintf(stderr, "oops\\n");\n'
        "    return 0;\n"
        "}\n"
    )

    trace = GdbTraceEngine().run(RunRequest(code=code, entryFile="main.c"))

    assert trace.status == "completed"
    assert trace.trace[-1].output.stdout == ""
    assert trace.trace[-1].output.stderr == "oops\n"


def test_engine_traces_while_loop_with_multiple_locals() -> None:
    trace = GdbTraceEngine().run(RunRequest(code=WHILE_CODE, entryFile="main.c"))

    assert trace.status == "completed"
    assert trace.summary.exitCode == 0
    names = {
        variable.name
        for step in trace.trace
        for variable in step.state.variables
    }
    assert {"a", "b"} <= names
    b_values = [
        variable.value
        for step in trace.trace
        for variable in step.state.variables
        if variable.name == "b"
    ]
    assert 22 in b_values


def test_engine_traces_recursion_with_stable_frames() -> None:
    trace = GdbTraceEngine().run(RunRequest(code=RECURSION_CODE, entryFile="main.c"))

    assert trace.status == "completed"
    assert trace.summary.exitCode == 0
    assert any(len(step.state.callStack) >= 3 for step in trace.trace)

    def count_events(event_type: str) -> int:
        return sum(
            1
            for step in trace.trace
            if step.event.type == event_type
            and any(
                frame["function"] == "factorial"
                for frame in step.event.data.get("frames", [])
            )
        )

    assert count_events("function_enter") == 3
    assert count_events("function_exit") == 3

    main_ids = [
        frame.id
        for step in trace.trace
        for frame in step.state.callStack
        if frame.function == "main"
    ]
    assert len(set(main_ids)) == 1


def test_engine_collects_real_storage_pointers_returns_and_heap_lifetime() -> None:
    trace = GdbTraceEngine().run(
        RunRequest(code=MEMORY_CODE, entryFile="main.c")
    )

    assert trace.status == "completed"
    assert trace.schemaVersion == "1.2"

    global_count = next(
        variable
        for step in trace.trace
        for variable in step.state.variables
        if variable.name == "global_count"
    )
    assert global_count.id == "global:global_count"
    assert global_count.role == "global"
    assert global_count.storage.region == "global"
    assert global_count.storage.address is not None
    assert global_count.storage.bytes is not None

    number = next(
        variable
        for step in trace.trace
        for variable in step.state.variables
        if variable.name == "number" and variable.value == 10
    )
    assert number.storage.available is True
    assert number.storage.address is not None
    assert number.storage.size == 4
    assert number.storage.bytes is not None

    assert any(
        pointer.status == "resolved" and pointer.targetObjectId == number.id
        for step in trace.trace
        for pointer in step.state.pointers
        if pointer.sourceVariableId.endswith(":pointer")
    )
    node_pointer = next(
        pointer
        for step in trace.trace
        for pointer in step.state.pointers
        if pointer.sourceVariableId.endswith(":node")
        and pointer.status == "resolved"
    )
    assert node_pointer.targetType == "Node"
    assert node_pointer.elementSize == 16
    assert node_pointer.elementCount == 1
    add_frame = next(
        frame
        for step in trace.trace
        for frame in step.state.callStack
        if frame.function == "add_one"
    )
    assert add_frame.parentFrameId is not None
    assert add_frame.arguments
    argument = next(
        variable
        for step in trace.trace
        for variable in step.state.variables
        if variable.id in add_frame.arguments
    )
    assert argument.role == "parameter"
    assert argument.value == 10

    exits = [
        frame
        for step in trace.trace
        if step.event.type == "function_exit"
        for frame in step.event.data.get("frames", [])
        if frame["function"] == "add_one"
    ]
    assert exits
    assert exits[0]["returnAvailable"] is True
    assert exits[0]["returnValue"] == 11

    heap_states = [
        item
        for step in trace.trace
        for item in step.state.memory
        if item.region == "heap"
    ]
    assert any(item.size == 16 and item.lifetime.status == "alive" for item in heap_states)
    assert any(item.readable and item.bytes for item in heap_states if item.lifetime.status == "alive")
    assert any(item.lifetime.status == "freed" for item in heap_states)
    assert any(item.type == "Node" for item in heap_states)
    node_variables = [
        variable
        for step in trace.trace
        for variable in step.state.variables
        if variable.name == "node" and variable.fields
    ]
    assert node_variables
    assert any(
        field.fields or field.name in {"value", "next"}
        for variable in node_variables
        for field in variable.fields
    )
    assert any(
        pointer.sourceExpression and "next" in pointer.sourceExpression
        for step in trace.trace
        for pointer in step.state.pointers
    )


def test_engine_returns_compile_error_trace() -> None:
    code = "int main(void) {\n    return x;\n}\n"
    trace = GdbTraceEngine().run(RunRequest(code=code, entryFile="main.c"))

    assert trace.status == "compile_error"
    assert trace.trace == []
    assert trace.error is not None
    assert trace.error.type == "compile_error"
    assert "error" in trace.error.details["stderr"]


def test_engine_reports_segfault() -> None:
    code = (
        "int main(void) {\n"
        "    int *pointer = 0;\n"
        "    *pointer = 1;\n"
        "    return 0;\n"
        "}\n"
    )
    trace = GdbTraceEngine().run(RunRequest(code=code, entryFile="main.c"))

    assert trace.status == "runtime_error"
    assert trace.error is not None
    assert trace.error.type == "runtime_signal"
    assert trace.error.details["signal"] == "SIGSEGV"
    assert trace.summary.totalSteps >= 1
    assert trace.trace[-1].event.type == "runtime_signal"


def test_engine_truncates_infinite_loop() -> None:
    code = (
        "int main(void) {\n"
        "    int counter = 0;\n"
        "    while (1) {\n"
        "        counter = counter + 1;\n"
        "    }\n"
        "    return 0;\n"
        "}\n"
    )
    engine = GdbTraceEngine(max_steps=25)
    trace = engine.run(RunRequest(code=code, entryFile="main.c"))

    assert trace.status == "completed"
    assert trace.summary.truncated is True
    assert trace.summary.totalSteps == 25


def _docker_list(arguments: list) -> list:
    result = subprocess.run(
        ["docker", *arguments],
        capture_output=True,
        check=False,
        timeout=15,
    )
    return result.stdout.decode("utf-8", errors="replace").split()


def test_engine_cleans_up_docker_resources() -> None:
    containers_before = _docker_list(
        ["ps", "-aq", "--filter", "name=clvlp-gdb-"]
    )
    volumes_before = _docker_list(
        ["volume", "ls", "-q", "--filter", "name=clvlp-gdb-build-"]
    )

    trace = GdbTraceEngine().run(
        RunRequest(code="int main(void) {\n    return 0;\n}\n", entryFile="main.c")
    )
    assert trace.status == "completed"

    containers_after = _docker_list(["ps", "-aq", "--filter", "name=clvlp-gdb-"])
    volumes_after = _docker_list(
        ["volume", "ls", "-q", "--filter", "name=clvlp-gdb-build-"]
    )
    assert set(containers_after) <= set(containers_before)
    assert set(volumes_after) <= set(volumes_before)


def test_run_api_uses_gdb_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLVLP_TRACE_ENGINE", "gdb")
    client = TestClient(app)
    response = client.post(
        "/api/run",
        json={"code": WHILE_CODE, "entryFile": "main.c"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["schemaVersion"] == "1.2"
    assert result["status"] == "completed"
    assert result["summary"]["exitCode"] == 0
    assert result["summary"]["truncated"] is False
    assert len(result["trace"]) > 0
    assert all(
        step["location"]["file"] == "main.c" for step in result["trace"]
    )
