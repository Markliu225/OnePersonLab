from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class AgentConfig(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1, max_length=80)
    model: str = Field(default="gpt-5.3", min_length=1, max_length=120)
    system_prompt: str = Field(min_length=1, max_length=5000)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=900, ge=0)

    @model_validator(mode="after")
    def ensure_id(self) -> "AgentConfig":
        if self.max_tokens is not None and self.max_tokens <= 0:
            # 0 means "do not send token limit parameter to the API".
            self.max_tokens = None
        if self.id:
            return self
        slug = re.sub(r"[^a-zA-Z0-9]+", "-", self.name).strip("-").lower()
        self.id = slug or "agent"
        return self


class SandboxConfig(BaseModel):
    mode: Literal["system", "ephemeral_venv", "shared_venv"] = "ephemeral_venv"
    python_bin: str = Field(default="python3", min_length=1, max_length=200)
    shared_venv_path: str = Field(default=".lab_venv", min_length=1, max_length=400)
    auto_install_requirements: bool = True
    setup_timeout_sec: int = Field(default=300, ge=0)
    pip_index_url: Optional[str] = Field(default=None, max_length=500)
    pip_extra_index_url: Optional[str] = Field(default=None, max_length=500)


class LabConfig(BaseModel):
    topic: str = Field(min_length=4, max_length=3000)
    iterations: int = Field(default=2, ge=1, le=6)
    discussion_rounds: int = Field(default=2, ge=1, le=6)
    idea_agents: list[AgentConfig] = Field(min_length=1, max_length=12)
    coding_agents: list[AgentConfig] = Field(min_length=1, max_length=12)
    paper_agent: Optional[AgentConfig] = None
    execution_timeout_sec: int = Field(default=60, ge=0)
    coding_repair_attempts: int = Field(default=1, ge=0, le=5)
    sandbox: SandboxConfig = Field(default_factory=SandboxConfig)

    @model_validator(mode="after")
    def ensure_paper_agent(self) -> "LabConfig":
        if self.paper_agent is None:
            base_model = self.idea_agents[0].model
            self.paper_agent = AgentConfig(
                id="paper-writer",
                name="Paper Writer",
                model=base_model,
                system_prompt=(
                    "You are a research paper author. Write a clear, honest, and rigorous "
                    "paper draft using the transcript and experiment logs."
                ),
                temperature=0.4,
                max_tokens=1800,
            )
        return self


class WsStartMessage(BaseModel):
    type: str
    config: LabConfig


class WsCancelMessage(BaseModel):
    type: str
