from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.env_loader import load_project_env
from app.openai_client import OpenAIChatClient
from app.orchestrator import OnePersonLabOrchestrator
from app.schemas import LabConfig


def build_config(
    topic: str,
    model: str,
    sandbox_mode: str,
    shared_venv_path: str,
    auto_install_requirements: bool,
) -> LabConfig:
    return LabConfig(
        topic=topic,
        iterations=1,
        discussion_rounds=1,
        execution_timeout_sec=45,
        coding_repair_attempts=2,
        sandbox={
            "mode": sandbox_mode,
            "python_bin": "python3",
            "shared_venv_path": shared_venv_path,
            "auto_install_requirements": auto_install_requirements,
            "setup_timeout_sec": 600,
        },
        idea_agents=[
            {
                "name": "Hypothesis Builder",
                "model": model,
                "temperature": 0.7,
                "max_tokens": 600,
                "system_prompt": "Build concrete and testable hypotheses with explicit assumptions.",
            },
            {
                "name": "Critical Reviewer",
                "model": model,
                "temperature": 0.4,
                "max_tokens": 600,
                "system_prompt": "Challenge weak claims and identify confounders.",
            },
        ],
        coding_agents=[
            {
                "name": "Experiment Coder",
                "model": model,
                "temperature": 0.3,
                "max_tokens": 1600,
                "system_prompt": "Write runnable Python experiments to validate claims.",
            }
        ],
        paper_agent={
            "name": "Paper Writer",
            "model": model,
            "temperature": 0.2,
            "max_tokens": 1200,
            "system_prompt": "Write an honest markdown research draft from the logs.",
        },
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="Run one real One-Person-Lab iteration in terminal")
    parser.add_argument("--topic", required=True, help="Research topic")
    parser.add_argument("--model", default="gpt-5.3", help="OpenAI model id")
    parser.add_argument(
        "--sandbox-mode",
        default="ephemeral_venv",
        choices=["system", "ephemeral_venv", "shared_venv"],
        help="Local execution sandbox mode",
    )
    parser.add_argument(
        "--shared-venv-path",
        default=".lab_venv",
        help="Path for shared venv when sandbox mode is shared_venv",
    )
    parser.add_argument(
        "--no-auto-install-requirements",
        action="store_true",
        help="Disable automatic installation of requirements blocks from coding agents",
    )
    args = parser.parse_args()

    load_project_env(PROJECT_ROOT)
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is missing. Put it in env, .env, or .env.example first.")

    async def emit(event: dict) -> None:
        et = event.get("type", "unknown")
        if et == "token":
            return
        print(f"[{et}] {event}")

    config = build_config(
        topic=args.topic,
        model=args.model,
        sandbox_mode=args.sandbox_mode,
        shared_venv_path=args.shared_venv_path,
        auto_install_requirements=not args.no_auto_install_requirements,
    )
    client = OpenAIChatClient(api_key=api_key)
    orchestrator = OnePersonLabOrchestrator(client=client, emit=emit, workspace_root=PROJECT_ROOT)

    paper = await orchestrator.run(config)
    output_path = Path("lab_runs") / "latest_paper.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(paper, encoding="utf-8")
    print(f"\nSaved paper draft to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
