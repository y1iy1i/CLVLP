from app.services.gdb_trace_converter import (
    ExecutionTraceBuilder,
    GdbFrameSnapshot,
    GdbStopSnapshot,
    GdbValueFieldSnapshot,
    GdbVariableSnapshot,
    GdbAllocationSnapshot,
    GdbReturnSnapshot,
    _capture_variable,
    convert_gdb_value,
)
from app.services.gdb_mi import MiCommandResponse, MiRecord


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


def test_convert_integer_array_to_list() -> None:
    assert convert_gdb_value("{5, 3, 8, 1}", "int [4]") == [5, 3, 8, 1]


def test_convert_nested_array_to_nested_list() -> None:
    assert convert_gdb_value("{{1, 2}, {3, 4}}", "int [2][2]") == [
        [1, 2],
        [3, 4],
    ]


def test_keep_malformed_array_as_text() -> None:
    assert convert_gdb_value("{1, {2, 3}", "int [3]") == "{1, {2, 3}"


class ArrayVariableSession:
    def execute(
        self,
        command: str,
        *,
        wait_for_stop: bool = False,
        timeout: float = 5.0,
    ) -> MiCommandResponse:
        if command.startswith("-var-create"):
            payload = {
                "name": "var1",
                "numchild": "5",
                "value": "[5]",
                "type": "int [5]",
            }
        else:
            payload = {}
        return MiCommandResponse(
            result=MiRecord(kind="result", raw="", message="done", payload=payload),
            records=[],
        )


def test_capture_array_keeps_element_values_instead_of_length_summary() -> None:
    captured = _capture_variable(
        ArrayVariableSession(),
        {"name": "arr", "value": "{5, 1, 4, 2, 8}"},
    )

    assert captured.type == "int [5]"
    assert captured.value == "{5, 1, 4, 2, 8}"


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
    assert executed_declaration.location.line == 10
    assert executed_declaration.executedLocation is not None
    assert executed_declaration.executedLocation.line == 9
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
    assert returned.location.line == 11
    assert returned.executedLocation is not None
    assert returned.executedLocation.line == 5
    assert returned.event.type == "function_exit"
    assert returned.event.data["frames"][0]["function"] == "add_one"
    assert returned.output.stdout == "total=3\n"


def test_builder_exposes_parameter_roles_addresses_and_pointer_targets() -> None:
    builder = ExecutionTraceBuilder()
    step = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(
                    0,
                    "helper",
                    4,
                    [
                        GdbVariableSnapshot(
                            name="value",
                            value="10",
                            type="int",
                            is_argument=True,
                            address="0x1000",
                            size=4,
                            memory_bytes="0a000000",
                        ),
                        GdbVariableSnapshot(
                            name="pointer",
                            value="0x1000",
                            type="int *",
                            address="0x2000",
                            size=8,
                            memory_bytes="0010000000000000",
                        ),
                    ],
                ),
                frame(1, "main", 10, []),
            ]
        )
    )

    assert step is not None
    current = step.state.callStack[0]
    assert current.parentFrameId == step.state.callStack[1].id
    assert len(current.arguments) == 1
    assert len(current.locals) == 1
    value = next(item for item in step.state.variables if item.name == "value")
    pointer = next(item for item in step.state.variables if item.name == "pointer")
    assert value.role == "parameter"
    assert value.storage.address == "0x1000"
    assert value.storage.size == 4
    assert value.storage.bytes == "0a000000"
    assert pointer.pointer is not None
    assert pointer.pointer.status == "resolved"
    assert pointer.pointer.targetObjectId == value.id


def test_builder_preserves_structure_field_size_and_padding_offsets() -> None:
    builder = ExecutionTraceBuilder()
    step = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(
                    0,
                    "main",
                    8,
                    [
                        GdbVariableSnapshot(
                            name="student",
                            value="{id = 17, score = 96.5}",
                            type="struct Student",
                            address="0x2200",
                            size=16,
                            fields=(
                                GdbValueFieldSnapshot(
                                    name="id",
                                    value="17",
                                    type="int",
                                    address="0x2200",
                                    size=4,
                                ),
                                GdbValueFieldSnapshot(
                                    name="score",
                                    value="96.5",
                                    type="double",
                                    address="0x2208",
                                    size=8,
                                ),
                            ),
                        )
                    ],
                )
            ]
        )
    )

    assert step is not None
    student = step.state.variables[0]
    assert [(item.name, item.offset, item.size) for item in student.fields] == [
        ("id", 0, 4),
        ("score", 8, 8),
    ]




def test_builder_preserves_free_event_when_program_exits_immediately() -> None:
    builder = ExecutionTraceBuilder()
    step = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(
                    0,
                    "main",
                    4,
                    [
                        GdbVariableSnapshot(
                            name="pointer",
                            value="0x5000",
                            type="int *",
                            address="0x2000",
                            size=8,
                            pointee_size=4,
                        )
                    ],
                )
            ],
            allocation_events=[
                GdbAllocationSnapshot("malloc", "0x5000", size=8)
            ],
        )
    )
    assert step is not None
    assert step.state.memory[0].lifetime.status == "alive"

    builder.append_terminal_events(
        [GdbAllocationSnapshot("free", "0x5000")]
    )

    heap = next(item for item in step.state.memory if item.region == "heap")
    assert heap.lifetime.status == "freed"
    assert step.state.variables[0].pointer is not None
    assert step.state.variables[0].pointer.status == "dangling"
    assert step.event.data["allocations"][-1]["operation"] == "free"
def test_builder_records_heap_lifetime_and_function_return_value() -> None:
    builder = ExecutionTraceBuilder()
    builder.add_snapshot(GdbStopSnapshot(frames=[frame(0, "main", 10, [])]))
    entered = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[
                frame(
                    0,
                    "allocate",
                    3,
                    [GdbVariableSnapshot(
                        name="pointer",
                        value="0x3000",
                        type="int *",
                        is_argument=False,
                        address="0x2000",
                        size=8,
                    )],
                ),
                frame(1, "main", 10, []),
            ],
            allocation_events=[
                GdbAllocationSnapshot("malloc", "0x3000", 16)
            ],
        )
    )
    assert entered is not None
    allocate_frame_id = entered.state.callStack[0].id
    heap = next(item for item in entered.state.memory if item.region == "heap")
    pointer = next(item for item in entered.state.pointers if item.sourceVariableId.endswith(":pointer"))
    assert heap.size == 16
    assert heap.lifetime.status == "alive"
    assert pointer.targetObjectId == heap.id

    returned = builder.add_snapshot(
        GdbStopSnapshot(
            frames=[frame(0, "main", 11, [])],
            return_events=[GdbReturnSnapshot(
                frame_id=allocate_frame_id,
                function="allocate",
                value="7",
                type="int",
                available=True,
            )],
            allocation_events=[GdbAllocationSnapshot("free", "0x3000")],
        )
    )
    assert returned is not None
    assert returned.event.type == "function_exit"
    assert returned.event.data["frames"][0]["returnValue"] == 7
    freed = next(item for item in returned.state.memory if item.id == heap.id)
    assert freed.lifetime.status == "freed"
    assert freed.lifetime.freedAtStep == returned.step


def test_builder_enforces_trace_step_limit() -> None:
    builder = ExecutionTraceBuilder(max_steps=2)
    for line in (1, 2, 3):
        builder.add_snapshot(
            GdbStopSnapshot(frames=[frame(0, "main", line, [])])
        )

    trace = builder.build(status="completed", exit_code=0)

    assert trace.summary.totalSteps == 2
    assert trace.summary.truncated is True
