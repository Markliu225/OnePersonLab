from __future__ import annotations

from typing import Awaitable, Callable

from openai import AsyncOpenAI, BadRequestError

from app.schemas import AgentConfig

TokenHandler = Callable[[str], Awaitable[None]]


class OpenAIChatClient:
    def __init__(self, api_key: str | None = None) -> None:
        self._client = AsyncOpenAI(api_key=api_key)

    @staticmethod
    def _prefers_max_completion_tokens(model: str) -> bool:
        return model.lower().startswith("gpt-5")

    @staticmethod
    def _is_token_param_error(exc: BadRequestError) -> bool:
        msg = str(exc)
        return (
            "Unsupported parameter" in msg
            and ("max_tokens" in msg or "max_completion_tokens" in msg)
        )

    @staticmethod
    def _with_token_param(
        *,
        model: str,
        max_tokens: int,
        prefer_completion_param: bool,
    ) -> tuple[dict[str, int], str]:
        param = "max_completion_tokens" if prefer_completion_param else "max_tokens"
        return {param: max_tokens}, param

    async def stream_completion(
        self,
        *,
        agent: AgentConfig,
        messages: list[dict[str, str]],
        on_token: TokenHandler,
    ) -> str:
        prefer_completion_param = self._prefers_max_completion_tokens(agent.model)
        token_kwargs, token_param = self._with_token_param(
            model=agent.model,
            max_tokens=agent.max_tokens,
            prefer_completion_param=prefer_completion_param,
        )

        request_kwargs = {
            "model": agent.model,
            "messages": messages,
            "temperature": agent.temperature,
            "stream": True,
            **token_kwargs,
        }

        try:
            stream = await self._client.chat.completions.create(**request_kwargs)
        except BadRequestError as exc:
            if not self._is_token_param_error(exc):
                raise
            alt_param = "max_tokens" if token_param == "max_completion_tokens" else "max_completion_tokens"
            request_kwargs.pop(token_param, None)
            request_kwargs[alt_param] = agent.max_tokens
            stream = await self._client.chat.completions.create(**request_kwargs)

        content: list[str] = []
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if not delta:
                continue
            content.append(delta)
            await on_token(delta)

        return "".join(content).strip()

    async def completion(
        self,
        *,
        agent: AgentConfig,
        messages: list[dict[str, str]],
    ) -> str:
        prefer_completion_param = self._prefers_max_completion_tokens(agent.model)
        token_kwargs, token_param = self._with_token_param(
            model=agent.model,
            max_tokens=agent.max_tokens,
            prefer_completion_param=prefer_completion_param,
        )

        request_kwargs = {
            "model": agent.model,
            "messages": messages,
            "temperature": agent.temperature,
            **token_kwargs,
        }

        try:
            response = await self._client.chat.completions.create(**request_kwargs)
        except BadRequestError as exc:
            if not self._is_token_param_error(exc):
                raise
            alt_param = "max_tokens" if token_param == "max_completion_tokens" else "max_completion_tokens"
            request_kwargs.pop(token_param, None)
            request_kwargs[alt_param] = agent.max_tokens
            response = await self._client.chat.completions.create(**request_kwargs)

        return (response.choices[0].message.content or "").strip()
