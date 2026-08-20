from __future__ import annotations

import ast
import queue
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, TextIO


MiValue = Any


class GdbMiError(RuntimeError):
    """Base error raised while communicating with GDB/MI."""


class GdbMiTimeout(GdbMiError):
    """Raised when GDB does not produce the expected response in time."""


class GdbMiProtocolError(GdbMiError):
    """Raised when GDB returns an error or malformed response."""


@dataclass(frozen=True)
class MiRecord:
    kind: str
    raw: str
    token: Optional[int] = None
    message: Optional[str] = None
    payload: MiValue = field(default_factory=dict)


@dataclass(frozen=True)
class MiCommandResponse:
    result: MiRecord
    records: List[MiRecord]
    stopped: Optional[MiRecord] = None


class _ValueParser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.index = 0

    def parse_results(self, terminator: Optional[str] = None) -> Dict[str, MiValue]:
        results: Dict[str, MiValue] = {}
        while self.index < len(self.text):
            if terminator and self._peek() == terminator:
                break
            name = self._parse_name()
            self._expect("=")
            self._insert(results, name, self.parse_value())
            if self._peek() != ",":
                break
            self.index += 1
        return results

    def parse_value(self) -> MiValue:
        current = self._peek()
        if current == '"':
            return self._parse_string()
        if current == "{":
            return self._parse_tuple()
        if current == "[":
            return self._parse_list()
        return self._parse_bare_value()

    def _parse_tuple(self) -> Dict[str, MiValue]:
        self._expect("{")
        if self._peek() == "}":
            self.index += 1
            return {}
        result = self.parse_results(terminator="}")
        self._expect("}")
        return result

    def _parse_list(self) -> List[MiValue]:
        self._expect("[")
        values: List[MiValue] = []
        if self._peek() == "]":
            self.index += 1
            return values

        result_list = self._looks_like_result()
        while self.index < len(self.text) and self._peek() != "]":
            if result_list:
                name = self._parse_name()
                self._expect("=")
                values.append({name: self.parse_value()})
            else:
                values.append(self.parse_value())
            if self._peek() != ",":
                break
            self.index += 1
        self._expect("]")
        return values

    def _parse_string(self) -> str:
        start = self.index
        self.index += 1
        escaped = False
        while self.index < len(self.text):
            character = self.text[self.index]
            self.index += 1
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                literal = self.text[start : self.index]
                try:
                    return ast.literal_eval(literal)
                except (SyntaxError, ValueError) as exc:
                    raise GdbMiProtocolError(
                        f"Invalid GDB/MI string: {literal}"
                    ) from exc
        raise GdbMiProtocolError("Unterminated GDB/MI string.")

    def _parse_bare_value(self) -> str:
        start = self.index
        while self.index < len(self.text) and self._peek() not in ",]}":
            self.index += 1
        return self.text[start : self.index]

    def _parse_name(self) -> str:
        start = self.index
        while self.index < len(self.text):
            character = self._peek()
            if character.isalnum() or character in "-_":
                self.index += 1
                continue
            break
        if start == self.index:
            raise GdbMiProtocolError(
                f"Expected a result name at offset {self.index}: {self.text}"
            )
        return self.text[start : self.index]

    def _looks_like_result(self) -> bool:
        cursor = self.index
        while cursor < len(self.text):
            character = self.text[cursor]
            if character.isalnum() or character in "-_":
                cursor += 1
                continue
            return character == "="
        return False

    def _expect(self, expected: str) -> None:
        if self._peek() != expected:
            raise GdbMiProtocolError(
                f"Expected '{expected}' at offset {self.index}: {self.text}"
            )
        self.index += 1

    def _peek(self) -> str:
        if self.index >= len(self.text):
            return ""
        return self.text[self.index]

    @staticmethod
    def _insert(results: Dict[str, MiValue], name: str, value: MiValue) -> None:
        if name not in results:
            results[name] = value
            return
        existing = results[name]
        if isinstance(existing, list):
            existing.append(value)
        else:
            results[name] = [existing, value]


def parse_mi_record(line: str) -> Optional[MiRecord]:
    raw = line.rstrip("\r\n")
    if not raw or raw.strip() == "(gdb)":
        return None

    index = 0
    while index < len(raw) and raw[index].isdigit():
        index += 1
    token = int(raw[:index]) if index else None
    if index >= len(raw):
        return MiRecord(kind="unparsed", raw=raw, token=token)

    prefix = raw[index]
    content = raw[index + 1 :]
    kind_by_prefix = {
        "^": "result",
        "*": "exec",
        "+": "status",
        "=": "notify",
        "~": "console",
        "@": "target",
        "&": "log",
    }
    kind = kind_by_prefix.get(prefix)
    if kind is None:
        return MiRecord(kind="unparsed", raw=raw, token=token, message=raw[index:])

    if kind in {"console", "target", "log"}:
        parser = _ValueParser(content)
        return MiRecord(
            kind=kind,
            raw=raw,
            token=token,
            payload=parser.parse_value(),
        )

    message, separator, result_text = content.partition(",")
    payload: MiValue = {}
    if separator:
        payload = _ValueParser(result_text).parse_results()
    return MiRecord(
        kind=kind,
        raw=raw,
        token=token,
        message=message,
        payload=payload,
    )


class GdbMiSession:
    """Small synchronous controller for one GDB machine-interface process."""

    def __init__(
        self,
        command: Sequence[str],
        *,
        startup_timeout: float = 5.0,
        max_records_per_command: int = 10_000,
    ) -> None:
        self.command = list(command)
        self.startup_timeout = startup_timeout
        self.max_records_per_command = max_records_per_command
        self._process: Optional[subprocess.Popen[str]] = None
        self._lines: queue.Queue[Optional[str]] = queue.Queue()
        self._reader_thread: Optional[threading.Thread] = None
        self._next_token = 1

    def start(self) -> List[MiRecord]:
        if self._process is not None:
            raise GdbMiProtocolError("GDB/MI session is already running.")
        self._process = subprocess.Popen(
            self.command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if self._process.stdout is None:
            raise GdbMiProtocolError("GDB/MI stdout pipe is unavailable.")
        self._reader_thread = threading.Thread(
            target=self._read_output,
            args=(self._process.stdout,),
            name="gdb-mi-reader",
            daemon=True,
        )
        self._reader_thread.start()
        try:
            handshake = self.execute(
                "-gdb-set pagination off",
                timeout=self.startup_timeout,
            )
            return handshake.records
        except Exception:
            self.close()
            raise

    def execute(
        self,
        command: str,
        *,
        wait_for_stop: bool = False,
        timeout: float = 5.0,
    ) -> MiCommandResponse:
        process = self._require_process()
        if process.stdin is None:
            raise GdbMiProtocolError("GDB/MI stdin pipe is unavailable.")

        token = self._next_token
        self._next_token += 1
        process.stdin.write(f"{token}{command}\n")
        process.stdin.flush()

        deadline = time.monotonic() + timeout
        records: List[MiRecord] = []
        result: Optional[MiRecord] = None
        stopped: Optional[MiRecord] = None
        while result is None or (wait_for_stop and stopped is None):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GdbMiTimeout(f"GDB/MI command timed out: {command}")
            record = self._read_record(remaining)
            if record is None:
                continue
            records.append(record)
            if len(records) > self.max_records_per_command:
                raise GdbMiProtocolError(
                    "GDB/MI response exceeded the record limit."
                )
            if record.kind == "result" and record.token == token:
                result = record
                if record.message == "error":
                    message = record.payload.get("msg", "GDB command failed.")
                    raise GdbMiProtocolError(str(message))
            if record.kind == "exec" and record.message == "stopped":
                stopped = record

        assert result is not None
        return MiCommandResponse(result=result, records=records, stopped=stopped)

    def close(self) -> None:
        process = self._process
        if process is None:
            return
        try:
            if process.poll() is None and process.stdin is not None:
                process.stdin.write("-gdb-exit\n")
                process.stdin.flush()
                process.wait(timeout=2)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        finally:
            if process.stdin is not None:
                process.stdin.close()
            if process.stdout is not None:
                process.stdout.close()
            if self._reader_thread is not None:
                self._reader_thread.join(timeout=1)
            self._reader_thread = None
            self._lines = queue.Queue()
            self._process = None

    def __enter__(self) -> GdbMiSession:
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _read_record(self, timeout: float) -> Optional[MiRecord]:
        return parse_mi_record(self._read_line(timeout))

    def _read_line(self, timeout: float) -> str:
        process = self._require_process()
        try:
            line = self._lines.get(timeout=timeout)
        except queue.Empty as exc:
            raise GdbMiTimeout("Timed out waiting for GDB/MI output.") from exc
        if line is not None:
            return line
        raise GdbMiProtocolError(
            f"GDB/MI process exited unexpectedly with status {process.poll()}."
        )

    def _read_output(self, stdout: TextIO) -> None:
        try:
            for line in stdout:
                self._lines.put(line)
        finally:
            self._lines.put(None)

    def _require_process(self) -> subprocess.Popen[str]:
        if self._process is None:
            raise GdbMiProtocolError("GDB/MI session has not been started.")
        return self._process
