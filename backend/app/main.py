from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.execute import router as execute_router
from app.api.agent import router as agent_router
from app.api.run import router as run_router


app = FastAPI(
    title="CLVLP API",
    description="Execution Trace API for the C Language Visual Learning Platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(run_router)
app.include_router(execute_router)
app.include_router(agent_router)
