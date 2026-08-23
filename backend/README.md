# CLVLP Backend

This FastAPI service exposes the Phase 1 simulated Trace endpoint and the
Phase 2 isolated C execution foundation.

## Conda environment

```bash
conda env create -f environment.yml
conda activate clvlp
CLVLP_TRACE_ENGINE=gdb python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
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

The Trace converter now reads every stopped frame, obtains variable types and
values, assigns stable invocation IDs, compares adjacent snapshots, and emits
the public `ExecutionTrace` schema. A Trace step uses the previous stop's source
line with the current stop's state, because GDB stops before executing a line.
Common scalar values become JSON numbers, booleans or characters; pointers,
arrays and other complex values remain lossless GDB strings for later memory
model work.

`POST /api/run` selects its engine with `CLVLP_TRACE_ENGINE=mock|gdb`. The
default remains `mock` for development without Docker; use `gdb` to compile the
submitted source and return a real line-level Trace.

The traced program writes stdout and stderr to separate files inside its
read-only, network-disabled container. The backend reads incremental output at
each stop and again at program exit, so single-line programs, output without a
trailing newline, and stderr remain accurate in the final Trace.

## Tests

```bash
conda activate clvlp
python -m pytest
```
