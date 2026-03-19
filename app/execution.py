from __future__ import annotations

import asyncio
import re
import shlex
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(slots=True)
class ExecutionResult:
    command: str
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    script_path: str


def extract_python_block(text: str) -> str | None:
    match = re.search(r"```python\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if not match:
        match = re.search(r"```\s*(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()

    # Fallback: tolerate truncated model outputs where the closing fence is missing.
    start = re.search(r"```python\s*", text, re.IGNORECASE)
    if not start:
        start = re.search(r"```\s*", text)
    if not start:
        return None

    return text[start.end() :].strip()


def extract_run_command(text: str) -> str | None:
    match = re.search(r"^RUN:\s*(.+)$", text, re.MULTILINE)
    if not match:
        return None
    return match.group(1).strip()


def _is_safe_command(command: str) -> bool:
    try:
        tokens = shlex.split(command)
    except ValueError:
        return False
    if not tokens:
        return False
    return tokens[0] in {"python", "python3"}


async def run_generated_experiment(
    *,
    agent_id: str,
    content: str,
    timeout_sec: int,
    base_dir: Path,
) -> ExecutionResult:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    run_dir = base_dir / f"{agent_id}-{timestamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    code = extract_python_block(content)
    script_path = run_dir / "experiment.py"

    if not code:
        script_path.write_text(
            "raise RuntimeError('No python code block was provided by this coding agent')\n",
            encoding="utf-8",
        )
    else:
        script_path.write_text(code + "\n", encoding="utf-8")

    command = extract_run_command(content) or "python experiment.py"
    if not _is_safe_command(command):
        command = "python experiment.py"

    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=str(run_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    timed_out = False
    try:
        stdout_raw, stderr_raw = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
        exit_code = proc.returncode
    except asyncio.TimeoutError:
        timed_out = True
        proc.kill()
        await proc.wait()
        stdout_raw = b""
        stderr_raw = f"Timed out after {timeout_sec} seconds".encode("utf-8")
        exit_code = None

    return ExecutionResult(
        command=command,
        exit_code=exit_code,
        stdout=stdout_raw.decode("utf-8", errors="replace"),
        stderr=stderr_raw.decode("utf-8", errors="replace"),
        timed_out=timed_out,
        script_path=str(script_path),
    )
