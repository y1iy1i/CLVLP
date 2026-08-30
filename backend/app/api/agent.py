from fastapi import APIRouter

from app.config import agent_settings
from app.models.agent import (
    AgentAnalysisRequest,
    AgentAnalysisResponse,
    AgentStatusResponse,
)
from app.services.algorithm_agent import algorithm_agent


router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/status", response_model=AgentStatusResponse)
def agent_status() -> AgentStatusResponse:
    return AgentStatusResponse(
        configured=agent_settings.configured,
        model=agent_settings.model if agent_settings.configured else None,
    )


@router.post("/analyze", response_model=AgentAnalysisResponse)
async def analyze_code(request: AgentAnalysisRequest) -> AgentAnalysisResponse:
    return await algorithm_agent.analyze(request)
