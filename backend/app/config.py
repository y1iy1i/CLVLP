import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@dataclass(frozen=True)
class AgentSettings:
    base_url: str = os.getenv("CLVLP_AGENT_BASE_URL", "").rstrip("/")
    api_key: str = os.getenv("CLVLP_AGENT_API_KEY", "")
    model: str = os.getenv("CLVLP_AGENT_MODEL", "")
    timeout_seconds: float = float(
        os.getenv("CLVLP_AGENT_TIMEOUT_SECONDS", "30")
    )

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


agent_settings = AgentSettings()
