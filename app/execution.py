from __future__ import annotations

import asyncio
import re
import shlex
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Sequence

from app.schemas import SandboxConfig


@dataclass(slots=True)
class ExecutionResult:
    command: str
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    script_path: str
    python_executable: str
    sandbox_mode: str
    requirements: list[str]
    setup_stdout: str
    setup_stderr: str
    setup_failed: bool


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


def extract_requirements(text: str) -> list[str]:
    block_pattern = re.compile(r"```([a-zA-Z0-9_-]*)\s*(.*?)```", re.DOTALL)
    for match in block_pattern.finditer(text):
        language = (match.group(1) or "").strip().lower()
        body = (match.group(2) or "").strip()
        if language not in {"requirements", "requirement", "pip", "txt"}:
            continue
        reqs = _parse_requirements_lines(body)
        if reqs:
            return reqs

    inline_match = re.search(r"^REQUIREMENTS:\s*(.+)$", text, re.MULTILINE)
    if inline_match:
        reqs = _parse_requirements_lines(inline_match.group(1))
        if reqs:
            return reqs

    return []


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


def _parse_requirements_lines(raw: str) -> list[str]:
    requirements: list[str] = []
    for line in raw.splitlines():
        cleaned = line.strip()
        if not cleaned or cleaned.startswith("#"):
            continue
        if cleaned.startswith("- "):
            cleaned = cleaned[2:].strip()
        requirements.append(cleaned)
    return requirements


def _format_command(tokens: Sequence[str]) -> str:
    return " ".join(shlex.quote(token) for token in tokens)


def _normalize_run_tokens(command: str, python_executable: str) -> list[str]:
    try:
        tokens = shlex.split(command)
    except ValueError:
        return [python_executable, "experiment.py"]
    if not tokens:
        return [python_executable, "experiment.py"]
    if tokens[0] not in {"python", "python3"}:
        return [python_executable, "experiment.py"]
    return [python_executable, *tokens[1:]]


async def _run_exec(
    *,
    tokens: Sequence[str],
    cwd: Path,
    timeout_sec: int | None,
) -> tuple[int | None, str, str, bool]:
    proc = await asyncio.create_subprocess_exec(
        *tokens,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    if timeout_sec is None or timeout_sec <= 0:
        stdout_raw, stderr_raw = await proc.communicate()
        return proc.returncode, stdout_raw.decode("utf-8", errors="replace"), stderr_raw.decode(
            "utf-8", errors="replace"
        ), False

    try:
        stdout_raw, stderr_raw = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
        return proc.returncode, stdout_raw.decode("utf-8", errors="replace"), stderr_raw.decode(
            "utf-8", errors="replace"
        ), False
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return None, "", f"Timed out after {timeout_sec} seconds", True


async def _prepare_python_environment(
    *,
    sandbox: SandboxConfig,
    run_dir: Path,
    workspace_root: Path,
    setup_logs: list[str],
) -> tuple[str, bool]:
    mode = sandbox.mode

    if mode == "system":
        return sandbox.python_bin, True

    if mode == "ephemeral_venv":
        venv_dir = run_dir / ".venv"
    else:
        shared = Path(sandbox.shared_venv_path)
        venv_dir = shared if shared.is_absolute() else workspace_root / shared

    venv_dir = venv_dir.resolve()
    python_executable = str((venv_dir / "bin" / "python").resolve())
    if Path(python_executable).exists():
        setup_logs.append(f"[sandbox] Reusing virtual environment: {venv_dir}")
        return python_executable, True

    setup_logs.append(f"[sandbox] Creating virtual environment: {venv_dir}")
    venv_dir.parent.mkdir(parents=True, exist_ok=True)
    code, out, err, timed_out = await _run_exec(
        tokens=[sandbox.python_bin, "-m", "venv", str(venv_dir)],
        cwd=workspace_root,
        timeout_sec=sandbox.setup_timeout_sec,
    )
    if out:
        setup_logs.append(out.strip())
    if err:
        setup_logs.append(err.strip())
    if timed_out or code != 0:
        reason = "timed out" if timed_out else f"failed with exit code {code}"
        setup_logs.append(f"[sandbox] Virtual environment creation {reason}.")
        return python_executable, False

    setup_logs.append("[sandbox] Virtual environment created successfully.")
    return python_executable, True


async def run_generated_experiment(
    *,
    agent_id: str,
    content: str,
    timeout_sec: int | None,
    base_dir: Path,
    workspace_root: Path,
    sandbox: SandboxConfig,
) -> ExecutionResult:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    run_dir = base_dir / f"{agent_id}-{timestamp}"
    run_dir.mkdir(parents=True, exist_ok=True)
    run_dir = run_dir.resolve()

    code = extract_python_block(content)
    script_path = run_dir / "experiment.py"

    if not code:
        script_path.write_text(
            "raise RuntimeError('No python code block was provided by this coding agent')\n",
            encoding="utf-8",
        )
    else:
        script_path.write_text(code + "\n", encoding="utf-8")

    setup_logs: list[str] = []
    requirements = extract_requirements(content)
    python_executable, sandbox_ok = await _prepare_python_environment(
        sandbox=sandbox,
        run_dir=run_dir,
        workspace_root=workspace_root,
        setup_logs=setup_logs,
    )
    if not sandbox_ok:
        setup_stderr = "\n".join(setup_logs).strip()
        return ExecutionResult(
            command="python experiment.py",
            exit_code=1,
            stdout="",
            stderr=f"Sandbox setup failed.\n{setup_stderr}",
            timed_out=False,
            script_path=str(script_path),
            python_executable=python_executable,
            sandbox_mode=sandbox.mode,
            requirements=requirements,
            setup_stdout="",
            setup_stderr=setup_stderr,
            setup_failed=True,
        )

    if sandbox.auto_install_requirements and requirements:
        req_file = run_dir / "requirements-agent.txt"
        req_file.write_text("\n".join(requirements) + "\n", encoding="utf-8")
        pip_cmd = [python_executable, "-m", "pip", "install", "-r", str(req_file)]
        if sandbox.pip_index_url:
            pip_cmd.extend(["--index-url", sandbox.pip_index_url])
        if sandbox.pip_extra_index_url:
            pip_cmd.extend(["--extra-index-url", sandbox.pip_extra_index_url])

        setup_logs.append(f"[sandbox] Installing dependencies: {' '.join(requirements)}")
        setup_code, setup_out, setup_err, setup_timed_out = await _run_exec(
            tokens=pip_cmd,
            cwd=run_dir,
            timeout_sec=sandbox.setup_timeout_sec,
        )
        if setup_out:
            setup_logs.append(setup_out.strip())
        if setup_err:
            setup_logs.append(setup_err.strip())
        if setup_timed_out or setup_code != 0:
            reason = "timed out" if setup_timed_out else f"failed with exit code {setup_code}"
            setup_stderr = "\n".join(setup_logs + [f"[sandbox] Dependency installation {reason}."]).strip()
            return ExecutionResult(
                command="python experiment.py",
                exit_code=1,
                stdout="",
                stderr=f"Dependency installation failed.\n{setup_stderr}",
                timed_out=False,
                script_path=str(script_path),
                python_executable=python_executable,
                sandbox_mode=sandbox.mode,
                requirements=requirements,
                setup_stdout="\n".join(setup_logs).strip(),
                setup_stderr=setup_stderr,
                setup_failed=True,
            )

    requested_command = extract_run_command(content) or "python experiment.py"
    if not _is_safe_command(requested_command):
        requested_command = "python experiment.py"
    command_tokens = _normalize_run_tokens(requested_command, python_executable)
    command = _format_command(command_tokens)

    exit_code, stdout_text, stderr_text, timed_out = await _run_exec(
        tokens=command_tokens,
        cwd=run_dir,
        timeout_sec=timeout_sec,
    )
    setup_stdout = "\n".join(setup_logs).strip()

    return ExecutionResult(
        command=command,
        exit_code=exit_code,
        stdout=stdout_text,
        stderr=stderr_text,
        timed_out=timed_out,
        script_path=str(script_path),
        python_executable=python_executable,
        sandbox_mode=sandbox.mode,
        requirements=requirements,
        setup_stdout=setup_stdout,
        setup_stderr="",
        setup_failed=False,
    )
