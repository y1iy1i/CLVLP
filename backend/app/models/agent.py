from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


AlgorithmModuleKind = Literal[
    "program",
    "function",
    "algorithm",
    "operation",
    "data_structure",
]


class AgentAnalysisRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100_000)
    entryFile: str = Field(default="main.c", min_length=1)
    sourceHash: str = Field(min_length=1, max_length=128)
    evidence: Dict[str, Any] = Field(default_factory=dict)


class AgentAlgorithmModule(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    family: Optional[str] = Field(default=None, max_length=60)
    kind: AlgorithmModuleKind
    sourceNodeIds: List[str] = Field(min_length=1, max_length=100)
    visualizationHints: List[str] = Field(default_factory=list, max_length=10)
    confidence: float = Field(ge=0, le=1)
    evidence: List[str] = Field(default_factory=list, max_length=10)


class AgentStatusResponse(BaseModel):
    configured: bool
    model: Optional[str] = None
    protocol: Literal["openai_compatible"] = "openai_compatible"


class AgentAnalysisResponse(BaseModel):
    configured: bool
    status: Literal["completed", "unavailable", "failed"]
    sourceHash: str
    modules: List[AgentAlgorithmModule] = Field(default_factory=list)
    message: Optional[str] = None
