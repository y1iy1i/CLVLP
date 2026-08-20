from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from app.services.docker_executor import (
    COMPILE_MEMORY_MEGABYTES,
    COMPILE_TIMEOUT_SECONDS,
    DEFAULT_IMAGE,
    MEMORY_MEGABYTES,
    docker_security_arguments,
)
from app.services.gdb_mi import GdbMiSession, MiCommandResponse, MiRecord


DEFAULT_GDB_IMAGE = DEFAULT_IMAGE
GDB_COMMAND_TIMEOUT_SECONDS = 5
GDB_STARTUP_TIMEOUT_SECONDS = 30


class DockerGdbUnavailable(RuntimeError):
    pass


class DockerGdbCompileError(RuntimeError):
    def __init__(self, stderr: str) -> None:
        super().__init__("GCC could not compile the submitted source.")
        self.stderr = stderr


class DockerGdbSession:
    """Compile one C source file and control its GDB/MI process in Docker."""

    def __init__(self, code: str, image: Optional[str] = None) -> None:
        self.code = code
        self.image = image or os.getenv("CLVLP_GDB_IMAGE", DEFAULT_GDB_IMAGE)
        token = uuid4().hex[:12]
        self.volume_name = f"clvlp-gdb-build-{token}"
        self.compile_container = f"clvlp-gdb-compile-{token}"
        self.gdb_container = f"clvlp-gdb-session-{token}"
        self._source_directory: Optional[tempfile.TemporaryDirectory[str]] = None
        self._mi_session: Optional[GdbMiSession] = None

    def start(self) -> List[MiRecord]:
        if self._mi_session is not None:
            raise DockerGdbUnavailable("Docker GDB session is already running.")

        try:
            self._ensure_image()
            self._source_directory = tempfile.TemporaryDirectory(
                prefix="clvlp-gdb-source-",
                dir="/private/tmp",
            )
            Path(self._source_directory.name, "main.c").write_text(
                self.code,
                encoding="utf-8",
            )
            self._docker(["volume", "create", self.volume_name], timeout=10)
            compile_result = self._compile()
            if compile_result.returncode != 0:
                raise DockerGdbCompileError(
                    compile_result.stderr.decode("utf-8", errors="replace")
                )

            self._mi_session = GdbMiSession(
                self._gdb_command(),
                startup_timeout=GDB_STARTUP_TIMEOUT_SECONDS,
            )
            return self._mi_session.start()
        except Exception:
            self.close()
            raise

    def execute(
        self,
        command: str,
        *,
        wait_for_stop: bool = False,
        timeout: float = GDB_COMMAND_TIMEOUT_SECONDS,
    ) -> MiCommandResponse:
        if self._mi_session is None:
            raise DockerGdbUnavailable("Docker GDB session has not been started.")
        return self._mi_session.execute(
            command,
            wait_for_stop=wait_for_stop,
            timeout=timeout,
        )

    def close(self) -> None:
        if self._mi_session is not None:
            self._mi_session.close()
            self._mi_session = None
        self._cleanup_docker(
            ["rm", "--force", self.gdb_container],
        )
        self._cleanup_docker(
            ["rm", "--force", self.compile_container],
        )
        self._cleanup_docker(
            ["volume", "rm", "--force", self.volume_name],
        )
        if self._source_directory is not None:
            self._source_directory.cleanup()
            self._source_directory = None

    def __enter__(self) -> DockerGdbSession:
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _ensure_image(self) -> None:
        result = self._docker(
            ["image", "inspect", self.image],
            timeout=10,
            check=False,
        )
        if result.returncode != 0:
            raise DockerGdbUnavailable(
                f"Docker GDB image '{self.image}' is not available."
            )

    def _compile(self) -> subprocess.CompletedProcess[bytes]:
        if self._source_directory is None:
            raise DockerGdbUnavailable("Source directory has not been created.")
        return self._docker(
            [
                "run",
                "--rm",
                "--name",
                self.compile_container,
                *docker_security_arguments(COMPILE_MEMORY_MEGABYTES),
                "--mount",
                (
                    "type=bind,"
                    f"source={self._source_directory.name},"
                    "target=/workspace,readonly"
                ),
                "--mount",
                f"type=volume,source={self.volume_name},target=/build",
                self.image,
                "/usr/local/bin/clvlp-compile",
            ],
            timeout=COMPILE_TIMEOUT_SECONDS,
            check=False,
        )

    def _gdb_command(self) -> List[str]:
        return [
            "docker",
            "run",
            "--rm",
            "--interactive",
            "--name",
            self.gdb_container,
            *docker_security_arguments(MEMORY_MEGABYTES),
            "--cap-add",
            "SYS_PTRACE",
            "--mount",
            f"type=volume,source={self.volume_name},target=/build,readonly",
            self.image,
            "gdb",
            "--quiet",
            "--interpreter=mi2",
            "/build/program",
        ]

    @staticmethod
    def _docker(
        arguments: List[str],
        *,
        timeout: int,
        check: bool = True,
    ) -> subprocess.CompletedProcess[bytes]:
        try:
            result = subprocess.run(
                ["docker", *arguments],
                capture_output=True,
                check=False,
                timeout=timeout,
            )
        except FileNotFoundError as exc:
            raise DockerGdbUnavailable("Docker CLI is not installed.") from exc
        if check and result.returncode != 0:
            message = result.stderr.decode("utf-8", errors="replace").strip()
            raise DockerGdbUnavailable(message or "Docker command failed.")
        return result

    def _cleanup_docker(self, arguments: List[str]) -> None:
        try:
            self._docker(arguments, timeout=10, check=False)
        except (DockerGdbUnavailable, subprocess.TimeoutExpired):
            pass
