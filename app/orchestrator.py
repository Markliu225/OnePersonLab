from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.execution import ExecutionResult, run_generated_experiment
from app.openai_client import OpenAIChatClient
from app.schemas import AgentConfig, LabConfig

EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass(slots=True)
class Turn:
    stage: str
    iteration: int
    round_index: int
    agent_id: str
    agent_name: str
    content: str


@dataclass(slots=True)
class CodingFeedback:
    agent_id: str
    agent_name: str
    proposal: str
    execution: ExecutionResult
    analysis: str


class OnePersonLabOrchestrator:
    def __init__(
        self,
        *,
        client: OpenAIChatClient,
        emit: EventEmitter,
        workspace_root: Path,
    ) -> None:
        self._client = client
        self._emit = emit
        self._workspace_root = workspace_root
        self._turns: list[Turn] = []

    async def run(self, config: LabConfig) -> str:
        run_id = uuid.uuid4().hex[:12]
        run_dir = self._workspace_root / "lab_runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        await self._emit(
            {
                "type": "run_started",
                "run_id": run_id,
                "topic": config.topic,
                "iterations": config.iterations,
                "discussion_rounds": config.discussion_rounds,
            }
        )

        current_conclusion = ""
        feedback_summary = ""
        coding_memory: list[CodingFeedback] = []

        for iteration in range(1, config.iterations + 1):
            await self._emit(
                {
                    "type": "stage_started",
                    "stage": "idea_discussion",
                    "iteration": iteration,
                    "message": f"Iteration {iteration}: discussion agents are debating.",
                }
            )

            consensus, current_conclusion = await self._run_idea_stage(
                config=config,
                iteration=iteration,
                previous_conclusion=current_conclusion,
                feedback_summary=feedback_summary,
            )

            await self._emit(
                {
                    "type": "iteration_conclusion",
                    "iteration": iteration,
                    "consensus": consensus,
                    "conclusion": current_conclusion,
                }
            )

            await self._emit(
                {
                    "type": "stage_started",
                    "stage": "coding_validation",
                    "iteration": iteration,
                    "message": f"Iteration {iteration}: coding agents are validating the idea.",
                }
            )

            coding_batch = await self._run_coding_stage(
                config=config,
                iteration=iteration,
                conclusion=current_conclusion,
                run_dir=run_dir,
            )
            coding_memory.extend(coding_batch)

            feedback_summary = await self._summarize_coding_feedback(
                config=config,
                iteration=iteration,
                coding_batch=coding_batch,
                conclusion=current_conclusion,
            )

        await self._emit(
            {
                "type": "stage_started",
                "stage": "paper_writing",
                "iteration": config.iterations,
                "message": "Paper agent is drafting the manuscript.",
            }
        )

        paper = await self._write_paper(config=config, final_conclusion=current_conclusion, coding_memory=coding_memory)

        await self._emit({"type": "run_finished", "paper": paper})
        return paper

    async def _run_idea_stage(
        self,
        *,
        config: LabConfig,
        iteration: int,
        previous_conclusion: str,
        feedback_summary: str,
    ) -> tuple[bool, str]:
        consensus_reached = False
        last_assessment = ""

        for round_index in range(1, config.discussion_rounds + 1):
            for agent in config.idea_agents:
                prompt = self._build_idea_prompt(
                    topic=config.topic,
                    iteration=iteration,
                    round_index=round_index,
                    previous_conclusion=previous_conclusion,
                    feedback_summary=feedback_summary,
                )
                content = await self._stream_turn(
                    stage="idea_discussion",
                    iteration=iteration,
                    round_index=round_index,
                    agent=agent,
                    user_prompt=prompt,
                )
                self._turns.append(
                    Turn(
                        stage="idea_discussion",
                        iteration=iteration,
                        round_index=round_index,
                        agent_id=agent.id or "idea-agent",
                        agent_name=agent.name,
                        content=content,
                    )
                )

            consensus_reached, last_assessment = await self._assess_consensus(
                config=config,
                iteration=iteration,
                round_index=round_index,
            )
            await self._emit(
                {
                    "type": "consensus_update",
                    "iteration": iteration,
                    "round": round_index,
                    "consensus_reached": consensus_reached,
                    "assessment": last_assessment,
                }
            )
            if consensus_reached:
                break

        return consensus_reached, last_assessment

    async def _run_coding_stage(
        self,
        *,
        config: LabConfig,
        iteration: int,
        conclusion: str,
        run_dir: Path,
    ) -> list[CodingFeedback]:
        results: list[CodingFeedback] = []

        for agent in config.coding_agents:
            proposal_prompt = self._build_coding_prompt(
                topic=config.topic,
                conclusion=conclusion,
                iteration=iteration,
                sandbox_mode=config.sandbox.mode,
            )
            proposal = await self._stream_turn(
                stage="coding_proposal",
                iteration=iteration,
                round_index=1,
                agent=agent,
                user_prompt=proposal_prompt,
            )

            execution = await run_generated_experiment(
                agent_id=agent.id or "coding-agent",
                content=proposal,
                timeout_sec=config.execution_timeout_sec,
                base_dir=run_dir,
                workspace_root=self._workspace_root,
                sandbox=config.sandbox,
            )

            repair_attempt = 0
            while repair_attempt < config.coding_repair_attempts and (
                execution.setup_failed or execution.exit_code != 0 or execution.timed_out
            ):
                repair_attempt += 1
                await self._emit(
                    {
                        "type": "repair_attempt_started",
                        "iteration": iteration,
                        "agent_id": agent.id,
                        "agent_name": agent.name,
                        "repair_attempt": repair_attempt,
                        "reason": "Execution failed, requesting code repair.",
                    }
                )
                repair_prompt = self._build_repair_prompt(
                    topic=config.topic,
                    conclusion=conclusion,
                    previous_proposal=proposal,
                    execution=execution,
                    repair_attempt=repair_attempt,
                )
                proposal = await self._stream_turn(
                    stage="coding_repair",
                    iteration=iteration,
                    round_index=repair_attempt,
                    agent=agent,
                    user_prompt=repair_prompt,
                )
                execution = await run_generated_experiment(
                    agent_id=agent.id or "coding-agent",
                    content=proposal,
                    timeout_sec=config.execution_timeout_sec,
                    base_dir=run_dir,
                    workspace_root=self._workspace_root,
                    sandbox=config.sandbox,
                )

            await self._emit(
                {
                    "type": "execution_result",
                    "iteration": iteration,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "command": execution.command,
                    "exit_code": execution.exit_code,
                    "timed_out": execution.timed_out,
                    "script_path": execution.script_path,
                    "repair_attempt": repair_attempt,
                    "python_executable": execution.python_executable,
                    "sandbox_mode": execution.sandbox_mode,
                    "requirements": execution.requirements,
                    "setup_failed": execution.setup_failed,
                    "setup_stdout": self._truncate(execution.setup_stdout, 3000),
                    "setup_stderr": self._truncate(execution.setup_stderr, 3000),
                    "stdout": self._truncate(execution.stdout, 5000),
                    "stderr": self._truncate(execution.stderr, 5000),
                }
            )

            analysis_prompt = self._build_analysis_prompt(config.topic, conclusion, proposal, execution)
            analysis = await self._stream_turn(
                stage="coding_feedback",
                iteration=iteration,
                round_index=1,
                agent=agent,
                user_prompt=analysis_prompt,
            )

            results.append(
                CodingFeedback(
                    agent_id=agent.id or "coding-agent",
                    agent_name=agent.name,
                    proposal=proposal,
                    execution=execution,
                    analysis=analysis,
                )
            )

        return results

    async def _summarize_coding_feedback(
        self,
        *,
        config: LabConfig,
        iteration: int,
        coding_batch: list[CodingFeedback],
        conclusion: str,
    ) -> str:
        summarizer = AgentConfig(
            id="feedback-synthesizer",
            name="Feedback Synthesizer",
            model=config.idea_agents[0].model,
            system_prompt=(
                "You synthesize coding experiment results for a discussion team. "
                "Be factual and preserve failed runs."
            ),
            temperature=0.2,
            max_tokens=1000,
        )

        payload = []
        for item in coding_batch:
            payload.append(
                {
                    "agent": item.agent_name,
                    "exit_code": item.execution.exit_code,
                    "timed_out": item.execution.timed_out,
                    "stdout": self._truncate(item.execution.stdout, 2000),
                    "stderr": self._truncate(item.execution.stderr, 2000),
                    "analysis": self._truncate(item.analysis, 2000),
                }
            )

        prompt = (
            "Summarize these coding validations for the idea-discussion group.\n"
            f"Topic: {config.topic}\n"
            f"Current conclusion candidate: {conclusion}\n"
            f"Iteration: {iteration}\n"
            "Return sections: Confirmed, Refuted, Risks, Next iteration focus.\n"
            f"Data:\n{json.dumps(payload, ensure_ascii=False, indent=2)}"
        )

        summary = await self._stream_turn(
            stage="coding_summary",
            iteration=iteration,
            round_index=1,
            agent=summarizer,
            user_prompt=prompt,
        )

        await self._emit({"type": "coding_summary_done", "iteration": iteration, "summary": summary})
        return summary

    async def _write_paper(
        self,
        *,
        config: LabConfig,
        final_conclusion: str,
        coding_memory: list[CodingFeedback],
    ) -> str:
        coding_digest = []
        for item in coding_memory:
            coding_digest.append(
                {
                    "agent": item.agent_name,
                    "exit_code": item.execution.exit_code,
                    "timed_out": item.execution.timed_out,
                    "stdout": self._truncate(item.execution.stdout, 1200),
                    "stderr": self._truncate(item.execution.stderr, 1200),
                    "feedback": self._truncate(item.analysis, 1600),
                }
            )

        prompt = (
            "Draft a concise but rigorous research manuscript in Markdown.\n"
            "Use sections: Title, Abstract, Introduction, Method, Experiments, Results, "
            "Limitations, Future Work, Conclusion.\n"
            "Do not invent successful results when the execution logs show failure.\n"
            f"Topic: {config.topic}\n"
            f"Final conclusion from idea team: {final_conclusion}\n"
            f"Idea transcript (recent):\n{self._format_recent_turns(stage='idea_discussion', limit=12)}\n"
            f"Coding logs:\n{json.dumps(coding_digest, ensure_ascii=False, indent=2)}"
        )

        return await self._stream_turn(
            stage="paper_writing",
            iteration=config.iterations,
            round_index=1,
            agent=config.paper_agent,
            user_prompt=prompt,
        )

    async def _assess_consensus(self, *, config: LabConfig, iteration: int, round_index: int) -> tuple[bool, str]:
        moderator = AgentConfig(
            id="moderator",
            name="Moderator",
            model=config.idea_agents[0].model,
            system_prompt=(
                "You are a strict research moderator. Judge whether consensus is reached "
                "and summarize the current best conclusion."
            ),
            temperature=0.1,
            max_tokens=500,
        )

        recent = self._format_recent_turns(stage="idea_discussion", limit=10)
        prompt = (
            "Analyze the following discussion transcript and decide whether consensus is reached.\n"
            "Return strict JSON with keys: consensus_reached (boolean), conclusion (string), "
            "unresolved_questions (array of strings).\n"
            f"Topic: {config.topic}\n"
            f"Iteration: {iteration}, Round: {round_index}\n"
            f"Transcript:\n{recent}"
        )

        raw = await self._client.completion(
            agent=moderator,
            messages=[
                {"role": "system", "content": moderator.system_prompt},
                {"role": "user", "content": prompt},
            ],
        )

        parsed = self._extract_json(raw)
        consensus = bool(parsed.get("consensus_reached", False))
        conclusion = str(parsed.get("conclusion") or "No stable conclusion yet.").strip()

        unresolved = parsed.get("unresolved_questions")
        if isinstance(unresolved, list) and unresolved:
            conclusion = f"{conclusion}\n\nUnresolved:\n- " + "\n- ".join(str(x) for x in unresolved)

        return consensus, conclusion

    async def _stream_turn(
        self,
        *,
        stage: str,
        iteration: int,
        round_index: int,
        agent: AgentConfig,
        user_prompt: str,
    ) -> str:
        message_id = uuid.uuid4().hex

        await self._emit(
            {
                "type": "message_start",
                "stage": stage,
                "iteration": iteration,
                "round": round_index,
                "message_id": message_id,
                "agent_id": agent.id,
                "agent_name": agent.name,
                "model": agent.model,
            }
        )

        async def on_token(delta: str) -> None:
            await self._emit(
                {
                    "type": "token",
                    "message_id": message_id,
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "stage": stage,
                    "delta": delta,
                }
            )

        full_text = await self._client.stream_completion(
            agent=agent,
            messages=[
                {"role": "system", "content": agent.system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            on_token=on_token,
        )

        await self._emit(
            {
                "type": "message_done",
                "stage": stage,
                "iteration": iteration,
                "round": round_index,
                "message_id": message_id,
                "agent_id": agent.id,
                "agent_name": agent.name,
                "content": full_text,
            }
        )
        return full_text

    def _build_idea_prompt(
        self,
        *,
        topic: str,
        iteration: int,
        round_index: int,
        previous_conclusion: str,
        feedback_summary: str,
    ) -> str:
        recent_idea = self._format_recent_turns(stage="idea_discussion", limit=8)
        return (
            "You are participating in a multi-agent research debate.\n"
            f"Topic: {topic}\n"
            f"Iteration {iteration}, Round {round_index}.\n"
            f"Previous conclusion candidate:\n{previous_conclusion or 'None'}\n\n"
            f"Feedback from coding validators:\n{feedback_summary or 'None'}\n\n"
            f"Recent discussion:\n{recent_idea or 'No prior turns.'}\n\n"
            "Provide rigorous reasoning with concrete assumptions.\n"
            "End with exactly these fields:\n"
            "Position: <one sentence>\n"
            "Evidence Needed: <bullet list>\n"
            "Next Action: <one sentence>"
        )

    def _build_coding_prompt(self, *, topic: str, conclusion: str, iteration: int, sandbox_mode: str) -> str:
        return (
            "You are a coding validation agent in a research lab.\n"
            f"Topic: {topic}\n"
            f"Conclusion candidate to validate: {conclusion}\n"
            f"Iteration: {iteration}\n"
            f"Local sandbox mode: {sandbox_mode}\n"
            "Create one reproducible Python experiment to test a key claim.\n"
            "Output format:\n"
            "1) Brief rationale (max 4 sentences)\n"
            "2) Optional dependency block using ```requirements ... ``` (only if needed)\n"
            "3) A single Python code block that is runnable locally on CPU\n"
            "4) One command line in the form RUN: python experiment.py\n"
            "5) Expected signal that would support or weaken the claim\n"
            "Keep runtime short. For deep learning (e.g., CNN), use a tiny dataset/sample and minimal epochs."
        )

    def _build_repair_prompt(
        self,
        *,
        topic: str,
        conclusion: str,
        previous_proposal: str,
        execution: ExecutionResult,
        repair_attempt: int,
    ) -> str:
        return (
            "Your previous experiment did not run successfully. Repair it and return a fully runnable version.\n"
            f"Repair attempt: {repair_attempt}\n"
            f"Topic: {topic}\n"
            f"Conclusion candidate: {conclusion}\n"
            f"Previous proposal:\n{self._truncate(previous_proposal, 2200)}\n\n"
            f"Sandbox mode: {execution.sandbox_mode}\n"
            f"Python executable: {execution.python_executable}\n"
            f"Setup failed: {execution.setup_failed}\n"
            f"Setup stdout:\n{self._truncate(execution.setup_stdout, 1800)}\n"
            f"Setup stderr:\n{self._truncate(execution.setup_stderr, 1800)}\n"
            f"Execution stderr:\n{self._truncate(execution.stderr, 2200)}\n\n"
            "Return the same output format:\n"
            "1) Brief rationale\n"
            "2) Optional ```requirements``` block\n"
            "3) One Python code block\n"
            "4) RUN: python experiment.py\n"
            "5) Expected signal\n"
            "Do not explain the old error; provide corrected runnable output."
        )

    def _build_analysis_prompt(
        self,
        topic: str,
        conclusion: str,
        proposal: str,
        execution: ExecutionResult,
    ) -> str:
        return (
            "Interpret this coding experiment result for the discussion team.\n"
            f"Topic: {topic}\n"
            f"Conclusion candidate: {conclusion}\n"
            f"Agent proposal:\n{self._truncate(proposal, 1800)}\n\n"
            "Execution logs:\n"
            f"Sandbox mode: {execution.sandbox_mode}\n"
            f"Python executable: {execution.python_executable}\n"
            f"Requirements: {', '.join(execution.requirements) if execution.requirements else 'None'}\n"
            f"Setup failed: {execution.setup_failed}\n"
            f"Setup STDOUT:\n{self._truncate(execution.setup_stdout, 1200)}\n"
            f"Setup STDERR:\n{self._truncate(execution.setup_stderr, 1200)}\n"
            f"Command: {execution.command}\n"
            f"Exit code: {execution.exit_code}\n"
            f"Timed out: {execution.timed_out}\n"
            f"STDOUT:\n{self._truncate(execution.stdout, 2200)}\n"
            f"STDERR:\n{self._truncate(execution.stderr, 2200)}\n\n"
            "Respond with sections:\n"
            "- What worked\n"
            "- What failed\n"
            "- Implication for the hypothesis\n"
            "- Recommendation for next discussion round"
        )

    def _format_recent_turns(self, *, stage: str, limit: int) -> str:
        scoped = [turn for turn in self._turns if turn.stage == stage][-limit:]
        lines = []
        for turn in scoped:
            lines.append(
                f"[Iteration {turn.iteration} / Round {turn.round_index}] {turn.agent_name}: "
                f"{self._truncate(turn.content, 600)}"
            )
        return "\n\n".join(lines)

    def _extract_json(self, raw: str) -> dict[str, Any]:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return {}

        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def _truncate(text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        return text[: limit - 80] + "\n...[truncated]...\n" + text[-60:]
