import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from app.models.execution import (
    CompilerDescriptor,
    ExecuteRequest,
    ExecutionError,
    ExecutionLimits,
    ExecutionResult,
    OutputTruncation,
)
from app.models.trace import TraceSource


DEFAULT_IMAGE = "clvlp-c-executor:phase2b-gdb"
COMPILE_TIMEOUT_SECONDS = 10
RUN_TIMEOUT_SECONDS = 2
HOST_RUN_TIMEOUT_SECONDS = 6
MEMORY_MEGABYTES = 128
COMPILE_MEMORY_MEGABYTES = 256
CPU_COUNT = 0.5
PROCESS_LIMIT = 64
MAX_OUTPUT_BYTES = 65_536


class DockerExecutionUnavailable(RuntimeError):
    pass


def docker_security_arguments(memory_megabytes: int) -> List[str]:
    return [
        "--network",
        "none",
        "--cpus",
        str(CPU_COUNT),
        "--memory",
        f"{memory_megabytes}m",
        "--memory-swap",
        f"{memory_megabytes}m",
        "--pids-limit",
        str(PROCESS_LIMIT),
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=32m",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
    ]


def _decode(value: bytes) -> str:
    return value.decode("utf-8", errors="replace")


class DockerExecutionEngine:
    def __init__(self, image: Optional[str] = None) -> None:
        self.image = image or os.getenv("CLVLP_EXECUTOR_IMAGE", DEFAULT_IMAGE)

    def execute(self, request: ExecuteRequest) -> ExecutionResult:
        started_at = time.monotonic()
        run_token = uuid4().hex[:12]
        run_id = f"execute_{run_token}"
        volume_name = f"clvlp-build-{run_token}"
        compile_container = f"clvlp-compile-{run_token}"
        runtime_container = f"clvlp-runtime-{run_token}"

        self._ensure_image()

        with tempfile.TemporaryDirectory(prefix="clvlp-source-", dir="/private/tmp") as source_dir:
            Path(source_dir, "main.c").write_text(request.code, encoding="utf-8")

            try:
                self._docker(["volume", "create", volume_name], timeout=10)
                try:
                    compile_result = self._compile(
                        source_dir=source_dir,
                        volume_name=volume_name,
                        container_name=compile_container,
                    )
                except subprocess.TimeoutExpired:
                    self._remove_container(compile_container)
                    return self._result(
                        run_id=run_id,
                        request=request,
                        status="compile_error",
                        stdout=b"",
                        stderr=b"",
                        exit_code=None,
                        started_at=started_at,
                        error=ExecutionError(
                            type="compile_timeout",
                            message="Compilation exceeded the time limit.",
                        ),
                    )

                if compile_result.returncode != 0:
                    return self._result(
                        run_id=run_id,
                        request=request,
                        status="compile_error",
                        stdout=compile_result.stdout,
                        stderr=compile_result.stderr,
                        exit_code=None,
                        started_at=started_at,
                        error=ExecutionError(
                            type="compile_error",
                            message="GCC could not compile the submitted source.",
                        ),
                    )

                try:
                    runtime_result = self._run_program(
                        volume_name=volume_name,
                        container_name=runtime_container,
                    )
                except subprocess.TimeoutExpired:
                    self._remove_container(runtime_container)
                    return self._result(
                        run_id=run_id,
                        request=request,
                        status="timeout",
                        stdout=b"",
                        stderr=b"",
                        exit_code=None,
                        started_at=started_at,
                        error=ExecutionError(
                            type="timeout",
                            message="The program exceeded the execution time limit.",
                        ),
                    )

                if runtime_result.returncode == 124:
                    status = "timeout"
                    exit_code = None
                    error = ExecutionError(
                        type="timeout",
                        message="The program exceeded the execution time limit.",
                    )
                elif runtime_result.returncode == 0:
                    status = "completed"
                    exit_code = 0
                    error = None
                else:
                    status = "runtime_error"
                    exit_code = runtime_result.returncode
                    error = ExecutionError(
                        type="runtime_error",
                        message="The program exited with a non-zero status.",
                    )

                return self._result(
                    run_id=run_id,
                    request=request,
                    status=status,
                    stdout=runtime_result.stdout,
                    stderr=runtime_result.stderr,
                    exit_code=exit_code,
                    started_at=started_at,
                    error=error,
                )
            finally:
                self._remove_container(compile_container)
                self._remove_container(runtime_container)
                self._docker(
                    ["volume", "rm", "--force", volume_name],
                    timeout=10,
                    check=False,
                )

    def _ensure_image(self) -> None:
        result = self._docker(
            ["image", "inspect", self.image],
            timeout=10,
            check=False,
        )
        if result.returncode != 0:
            raise DockerExecutionUnavailable(
                f"Docker executor image '{self.image}' is not available."
            )

    def _compile(
        self,
        source_dir: str,
        volume_name: str,
        container_name: str,
    ) -> subprocess.CompletedProcess:
        return self._docker(
            [
                "run",
                "--rm",
                "--name",
                container_name,
                *docker_security_arguments(COMPILE_MEMORY_MEGABYTES),
                "--mount",
                f"type=bind,source={source_dir},target=/workspace,readonly",
                "--mount",
                f"type=volume,source={volume_name},target=/build",
                self.image,
                "/usr/local/bin/clvlp-compile",
            ],
            timeout=COMPILE_TIMEOUT_SECONDS,
            check=False,
        )

    def _run_program(
        self,
        volume_name: str,
        container_name: str,
    ) -> subprocess.CompletedProcess:
        return self._docker(
            [
                "run",
                "--rm",
                "--name",
                container_name,
                *docker_security_arguments(MEMORY_MEGABYTES),
                "--env",
                f"CLVLP_RUN_TIMEOUT_SECONDS={RUN_TIMEOUT_SECONDS}",
                "--env",
                f"CLVLP_MAX_OUTPUT_BYTES={MAX_OUTPUT_BYTES}",
                "--mount",
                f"type=volume,source={volume_name},target=/build,readonly",
                self.image,
                "/usr/local/bin/clvlp-run",
            ],
            timeout=HOST_RUN_TIMEOUT_SECONDS,
            check=False,
        )

    def _result(
        self,
        run_id: str,
        request: ExecuteRequest,
        status: str,
        stdout: bytes,
        stderr: bytes,
        exit_code: Optional[int],
        started_at: float,
        error: Optional[ExecutionError],
    ) -> ExecutionResult:
        stdout_truncated = len(stdout) >= MAX_OUTPUT_BYTES
        stderr_truncated = len(stderr) >= MAX_OUTPUT_BYTES
        stdout = stdout[:MAX_OUTPUT_BYTES]
        stderr = stderr[:MAX_OUTPUT_BYTES]

        return ExecutionResult(
            runId=run_id,
            status=status,
            source=TraceSource(entryFile=request.entryFile),
            compiler=CompilerDescriptor(image=self.image),
            stdout=_decode(stdout),
            stderr=_decode(stderr),
            exitCode=exit_code,
            durationMs=round((time.monotonic() - started_at) * 1000),
            outputTruncated=OutputTruncation(
                stdout=stdout_truncated,
                stderr=stderr_truncated,
            ),
            limits=ExecutionLimits(
                compileTimeoutSeconds=COMPILE_TIMEOUT_SECONDS,
                runTimeoutSeconds=RUN_TIMEOUT_SECONDS,
                memoryMegabytes=MEMORY_MEGABYTES,
                cpuCount=CPU_COUNT,
                processLimit=PROCESS_LIMIT,
                maxOutputBytes=MAX_OUTPUT_BYTES,
                networkEnabled=False,
            ),
            error=error,
        )

    @staticmethod
    def _docker(
        arguments: List[str],
        timeout: int,
        check: bool = True,
    ) -> subprocess.CompletedProcess:
        try:
            result = subprocess.run(
                ["docker", *arguments],
                capture_output=True,
                check=False,
                timeout=timeout,
            )
        except FileNotFoundError as exc:
            raise DockerExecutionUnavailable("Docker CLI is not installed.") from exc
        except subprocess.TimeoutExpired:
            raise

        if check and result.returncode != 0:
            message = _decode(result.stderr).strip() or "Docker command failed."
            raise DockerExecutionUnavailable(message)
        return result

    def _remove_container(self, container_name: str) -> None:
        self._docker(
            ["rm", "--force", container_name],
            timeout=10,
            check=False,
        )
