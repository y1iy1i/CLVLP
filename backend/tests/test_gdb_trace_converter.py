from app.services.gdb_trace_converter import (
    ExecutionTraceBuilder,
    GdbFrameSnapshot,
    GdbStopSnapshot,
    GdbVariableSnapshot,
    convert_gdb_value,
)


def variable(name: str, value: str, type_name: str = "int") -> GdbVariableSnapshot:
    return GdbVariableSnapshot(name=name, value=value, type=type_name)


def frame(
    level: int,
    function: str,
    line: int,
    variables: list[GdbVariableSnapshot],
) -> GdbFrameSnapshot:
    return GdbFrameSnapshot(
        level=level,
        function=function,
        file="/workspace/main.c",
        line=line,
        variables=variables,
    )


def test_convert_common_scalar_values() -> None:
    assert convert_gdb_value("42", "int") == 42
    assert convert_gdb_value("08", "volatile int") == 8
    assert convert_gdb_value("0xff", "unsigned int") == 255
    assert convert_gdb_value("3.5", "double") == 3.5
    assert convert_gdb_value("true", "_Bool") is True
    assert convert_gdb_value("65 'A'", "char") == "A"
    assert convert_gdb_value("0x4000", "int *") == "0x4000"


def test_builder_uses_post_execution_state_and_variable_diffs() -> None:
    builder = ExecutionTraceBuilder()
    builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(
                    0,
                    "main",
                    9,
                    [variable("counter", "0"), variable("total", "0")],
                )
            ]
        )
    )
    executed_declaration = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(
                    0,
                    "main",
                    10,
                    [variable("counter", "2"), variable("total", "0")],
                )
            ]
        )
    )

    assert executed_declaration is not None
    assert executed_declaration.location.line == 9
    assert executed_declaration.event.type == "line_executed"
    assert executed_declaration.event.data["changes"] == [
        {
            "kind": "update",
            "variableId": "frame:main:1:counter",
            "oldValue": 0,
            "newValue": 2,
        }
    ]
    counter = next(
        item
        for item in executed_declaration.state.variables
        if item.name == "counter"
    )
    assert counter.value == 2


def test_builder_assigns_distinct_stable_ids_to_recursive_frames() -> None:
    builder = ExecutionTraceBuilder()
    builder.add_snapshot(
        GdbStopSnapshot(frames=[frame(0, "main", 20, [])])
    )
    first_call = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(0, "factorial", 4, [variable("n", "3")]),
                frame(1, "main", 20, []),
            ]
        )
    )
    second_call = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(0, "factorial", 4, [variable("n", "2")]),
                frame(1, "factorial", 6, [variable("n", "3")]),
                frame(2, "main", 20, []),
            ]
        )
    )

    assert first_call is not None
    assert second_call is not None
    first_factorial_id = first_call.state.callStack[0].id
    assert second_call.state.callStack[1].id == first_factorial_id
    assert second_call.state.callStack[0].id != first_factorial_id
    assert second_call.event.type == "function_enter"


def test_builder_records_function_exit_and_cumulative_output() -> None:
    builder = ExecutionTraceBuilder()
    builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(0, "add_one", 5, [variable("result", "3")]),
                frame(1, "main", 10, [variable("total", "0")]),
            ]
        )
    )
    returned = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[frame(0, "main", 11, [variable("total", "3")])],
            stdout="total=3\n",
        )
    )

    assert returned is not None
    assert returned.location.line == 5
    assert returned.event.type == "function_exit"
    assert returned.event.data["frames"][0]["function"] == "add_one"
    assert returned.output.stdout == "total=3\n"


def test_builder_enforces_trace_step_limit() -> None:
    builder = ExecutionTraceBuilder(max_steps=2)
    for line in (1, 2, 3):
        builder.add_snapshot(
            GdbStopSnapshot(frames=[frame(0, "main", line, [])])
        )

    trace = builder.build(status="completed", exit_code=0)

    assert trace.summary.totalSteps == 2
    assert trace.summary.truncated is True
