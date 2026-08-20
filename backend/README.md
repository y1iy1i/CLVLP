# CLVLP Backend

This FastAPI service exposes a simulated C execution endpoint for the Phase 1
data-flow prototype. It validates the request and returns a versioned Execution
Trace without compiling or executing the submitted C source.

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

## Tests

```bash
conda activate clvlp
python -m pytest
```
