import sys

import pytest

from app.services.gdb_mi import (
    GdbMiProtocolError,
    GdbMiSession,
    parse_mi_record,
)


def test_parse_breakpoint_result() -> None:
    record = parse_mi_record(
        '3^done,bkpt={number="1",func="main",file="/workspace/main.c",line="9"}'
    )

    assert record is not None
    assert record.kind == "result"
    assert record.token == 3
    assert record.message == "done"
    assert record.payload["bkpt"]["func"] == "main"
    assert record.payload["bkpt"]["line"] == "9"


def test_parse_stack_and_variables() -> None:
    stack = parse_mi_record(
        '^done,stack=[frame={level="0",func="add_one",line="4"},'
        'frame={level="1",func="main",line="10"}]'
    )
    variables = parse_mi_record(
        '^done,variables=[{name="value",arg="1",value="2"},'
        '{name="result",value="0"}]'
    )

    assert stack is not None
    assert stack.payload["stack"][0]["frame"]["func"] == "add_one"
    assert stack.payload["stack"][1]["frame"]["func"] == "main"
    assert variables is not None
    assert variables.payload["variables"][0]["name"] == "value"
    assert variables.payload["variables"][0]["value"] == "2"


def test_parse_stop_and_target_output() -> None:
    stopped = parse_mi_record(
        '*stopped,reason="end-stepping-range",'
        'frame={func="main",file="/workspace/main.c",line="10"}'
    )
    output = parse_mi_record('@"total=3\\n"')

    assert stopped is not None
    assert stopped.kind == "exec"
    assert stopped.message == "stopped"
    assert stopped.payload["frame"]["line"] == "10"
    assert output is not None
    assert output.kind == "target"
    assert output.payload == "total=3\n"


def test_ignore_gdb_prompt_with_trailing_space() -> None:
    assert parse_mi_record("(gdb) \n") is None


def test_session_matches_tokens_and_waits_for_stop() -> None:
    fake_gdb = (
        "import sys\n"
        "print('(gdb)', flush=True)\n"
        "for line in sys.stdin:\n"
        " token = line.split('-', 1)[0]\n"
        " if 'exec-next' in line:\n"
        "  print(f'{token}^running', flush=True)\n"
        "  print('*running,thread-id=\"all\"', flush=True)\n"
        "  print('*stopped,reason=\"end-stepping-range\",frame={line=\"10\"}', flush=True)\n"
        " elif 'gdb-exit' in line:\n"
        "  break\n"
        " else:\n"
        "  print(f'{token}^done,value=\"ok\"', flush=True)\n"
    )

    with GdbMiSession([sys.executable, "-u", "-c", fake_gdb]) as session:
        response = session.execute("-exec-next", wait_for_stop=True)

    assert response.result.message == "running"
    assert response.stopped is not None
    assert response.stopped.payload["frame"]["line"] == "10"


def test_session_raises_for_gdb_error() -> None:
    fake_gdb = (
        "import sys\n"
        "print('(gdb)', flush=True)\n"
        "for line in sys.stdin:\n"
        " token = line.split('-', 1)[0]\n"
        " if 'pagination' in line:\n"
        "  print(f'{token}^done', flush=True)\n"
        " else:\n"
        "  print(f'{token}^error,msg=\"bad command\"', flush=True)\n"
    )

    with GdbMiSession([sys.executable, "-u", "-c", fake_gdb]) as session:
        with pytest.raises(GdbMiProtocolError, match="bad command"):
            session.execute("-invalid")
