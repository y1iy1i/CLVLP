# CLVLP Backend

This FastAPI service exposes the Phase 1 simulated Trace endpoint and the
Phase 2 isolated C execution foundation.

## Conda environment

```bash
conda env create -f environment.yml
conda activate clvlp
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

When `environment.yml` changes, update the existing environment with
`conda env update -f environment.yml --prune`.

The API is available at `http://127.0.0.1:8000`, with interactive documentation
at `http://127.0.0.1:8000/docs`.

## Docker C executor

The real compile-and-run endpoint requires Docker Desktop and the local executor
image:

```bash
cd docker/executor
docker build -t clvlp-c-executor:phase2b-gdb .
```

`POST /api/execute` compiles one `main.c` with GCC 13.4 in C11 mode, then runs
the binary without network access and with CPU, memory, process, time and output
limits.

The same image includes GDB 13.1. The backend GDB/MI controller can set
breakpoints, step through the program, and request structured line, variable,
and stack-frame records. Only the GDB container receives `SYS_PTRACE`; the
normal compile and execute containers retain the stricter capability set.

`POST /api/run` still returns the Phase 1 simulated Execution Trace. The GDB/MI
records are not converted to the public Trace schema until the next Phase 2B
milestone.

## Tests

```bash
conda activate clvlp
python -m pytest
```
