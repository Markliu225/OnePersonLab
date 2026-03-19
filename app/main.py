from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.websockets import WebSocketState

from app.env_loader import load_project_env
from app.openai_client import OpenAIChatClient
from app.orchestrator import OnePersonLabOrchestrator
from app.schemas import LabConfig, WsStartMessage

APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT.parent
load_project_env(PROJECT_ROOT)

app = FastAPI(title="One-Person Lab", version="0.1.0")
app.mount("/static", StaticFiles(directory=APP_ROOT / "static"), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(APP_ROOT / "templates" / "index.html")


@app.get("/api/health")
async def health() -> JSONResponse:
    key_exists = bool(os.getenv("OPENAI_API_KEY"))
    return JSONResponse({"ok": True, "openai_key_loaded": key_exists})


@app.get("/api/default-config")
async def default_config() -> LabConfig:
    return LabConfig(
        topic="Design a low-cost autonomous research loop for prompt optimization.",
        iterations=2,
        discussion_rounds=2,
        execution_timeout_sec=60,
        idea_agents=[
            {
                "name": "Theory Builder",
                "model": "gpt-5.3",
                "temperature": 0.7,
                "system_prompt": (
                    "You are a theory-oriented research scientist. Build testable hypotheses "
                    "and make assumptions explicit."
                ),
            },
            {
                "name": "Skeptical Reviewer",
                "model": "gpt-5.3",
                "temperature": 0.4,
                "system_prompt": (
                    "You are a critical reviewer. Find weak claims, confounders, and failure modes."
                ),
            },
        ],
        coding_agents=[
            {
                "name": "Rapid Prototyper",
                "model": "gpt-5.3",
                "temperature": 0.3,
                "max_tokens": 1600,
                "system_prompt": (
                    "You are an experimental engineer. Produce concise, runnable Python validations."
                ),
            },
            {
                "name": "Adversarial Tester",
                "model": "gpt-5.3",
                "temperature": 0.5,
                "max_tokens": 1600,
                "system_prompt": (
                    "You stress-test hypotheses with edge cases and robustness checks."
                ),
            },
        ],
        paper_agent={
            "name": "Paper Writer",
            "model": "gpt-5.3",
            "temperature": 0.2,
            "system_prompt": (
                "You are an academic writer. Report methods and results honestly, "
                "including negative findings."
            ),
            "max_tokens": 1800,
        },
    )


@app.websocket("/ws/lab")
async def lab_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    lock = asyncio.Lock()

    async def emit(payload: dict) -> None:
        async with lock:
            await websocket.send_json(payload)

    try:
        inbound = await websocket.receive_json()
        start = WsStartMessage.model_validate(inbound)
        if start.type != "start":
            await emit({"type": "error", "message": "First message must be {type: start, config: ...}"})
            await websocket.close(code=1003)
            return

        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            await emit(
                {
                    "type": "error",
                    "message": "OPENAI_API_KEY is missing. Put it in environment, .env, or .env.example and restart.",
                }
            )
            await websocket.close(code=1011)
            return

        client = OpenAIChatClient(api_key=api_key)
        orchestrator = OnePersonLabOrchestrator(client=client, emit=emit, workspace_root=PROJECT_ROOT)

        await orchestrator.run(start.config)

    except WebSocketDisconnect:
        return
    except ValidationError as exc:
        await emit({"type": "error", "message": f"Invalid request: {exc}"})
    except Exception as exc:  # noqa: BLE001
        await emit({"type": "error", "message": f"Runtime error: {exc}"})
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            await websocket.close()
