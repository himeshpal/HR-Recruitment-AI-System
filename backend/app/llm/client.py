"""The only place the app talks to an LLM.

Works with any OpenAI-compatible server: Groq by default, or a local Ollama
by changing LLM_BASE_URL in .env. There is deliberately no fallback provider.

Features: on-disk response cache, retry with backoff on rate limits/5xx,
JSON output validated against a Pydantic model (with automatic repair
retries), streaming, and one AgentRun row per call for the activity timeline.
"""

import json
import logging
import re
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Literal, TypeVar

import openai
from pydantic import BaseModel, ValidationError

from app.config import Settings, get_settings
from app.llm.cache import DiskCache

logger = logging.getLogger(__name__)

Messages = list[dict[str, str]]
Tier = Literal["large", "small"]
Effort = Literal["low", "medium", "high"]
T = TypeVar("T", bound=BaseModel)

_RETRYABLE = (
    openai.RateLimitError,
    openai.APIConnectionError,  # includes timeouts
    openai.InternalServerError,
)
_MAX_BACKOFF_SECONDS = 60.0
_RETRY_AFTER_MESSAGE = re.compile(r"try again in ([\d.]+)\s*(ms|s)", re.IGNORECASE)
_REPLAY_CHUNK_CHARS = 24


class LLMError(Exception):
    """The LLM call failed (missing key, rate limit exhausted, bad request...)."""


class LLMValidationError(LLMError):
    """The model kept returning output that does not match the requested schema."""


class LLMJsonRejected(LLMError):
    """The provider refused the model's JSON as malformed (Groq: HTTP 400 json_validate_failed).

    Transient: the model only needs another go, so JSON callers repair it like any other invalid output.
    """

    def __init__(self, message: str, failed_generation: str = ""):
        super().__init__(message)
        self.failed_generation = failed_generation


def _json_rejection(exc: Exception) -> tuple[bool, str]:
    """(is this a json_validate_failed rejection?, the malformed text the model produced)"""
    body = getattr(exc, "body", None)
    data = body if isinstance(body, dict) else {}
    data = data.get("error", data) if isinstance(data.get("error", data), dict) else data
    return data.get("code") == "json_validate_failed", str(data.get("failed_generation") or "")


@dataclass
class LLMResult:
    text: str
    model: str
    tokens: int
    latency_ms: int
    cached: bool


def _extract_json(raw: str) -> str:
    """Strip code fences / stray prose around a JSON object."""
    text = raw.strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise ValueError("no JSON object found in reply")
    return text[start : end + 1]


class LLMClient:
    def __init__(
        self,
        settings: Settings | None = None,
        client: Any = None,
        cache: DiskCache | None = None,
        session_factory: Callable[[], Any] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.settings = settings or get_settings()
        self._client = client
        self.cache = cache or DiskCache(self.settings.llm_cache_dir)
        self.session_factory = session_factory
        self._sleep = sleep
        self._clock = clock
        self._cooldown_until = 0.0  # shared by all threads: one 429 pauses everyone
        self._cooldown_lock = threading.Lock()

    # ---------- plumbing ----------

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self.settings.llm_api_key:
                raise LLMError(
                    "No API key set. Put GROQ_API_KEY in .env (see .env.example), "
                    "or set LLM_API_KEY=ollama when using a local Ollama server."
                )
            self._client = openai.OpenAI(
                api_key=self.settings.llm_api_key,
                base_url=self.settings.llm_base_url,
                timeout=self.settings.llm_timeout_seconds,
                max_retries=0,  # we do our own retries so waits are visible and testable
            )
        return self._client

    def _model(self, tier: Tier, model: str | None) -> str:
        if model:
            return model
        return self.settings.llm_model_large if tier == "large" else self.settings.llm_model_small

    def _wait_for_cooldown(self) -> None:
        with self._cooldown_lock:
            wait = self._cooldown_until - self._clock()
        if wait > 0:
            self._sleep(wait)

    def _with_retries(self, call: Callable[[], Any]) -> Any:
        attempts = self.settings.llm_max_attempts
        for attempt in range(1, attempts + 1):
            self._wait_for_cooldown()
            try:
                return call()
            except _RETRYABLE as exc:
                if attempt == attempts:
                    raise LLMError(f"LLM unavailable after {attempts} attempts: {exc}") from exc
                delay = self._retry_delay(exc, attempt)
                logger.warning("LLM call failed (%s); retry %d in %.1fs", type(exc).__name__, attempt, delay)
                if isinstance(exc, openai.RateLimitError):
                    # A provider limit applies to every request, so make all threads wait it out together.
                    with self._cooldown_lock:
                        self._cooldown_until = max(self._cooldown_until, self._clock() + delay)
                else:
                    self._sleep(delay)
            except openai.APIStatusError as exc:
                rejected, failed_generation = _json_rejection(exc)
                if rejected:
                    raise LLMJsonRejected(f"The model produced malformed JSON: {exc.message}", failed_generation) from exc
                raise LLMError(f"LLM request rejected ({exc.status_code}): {exc.message}") from exc
        raise AssertionError("unreachable")

    @staticmethod
    def _retry_delay(exc: Exception, attempt: int) -> float:
        """How long to wait: the server's Retry-After header, else the 'try again in Xs' in its message."""
        response = getattr(exc, "response", None)
        header = response.headers.get("retry-after") if response is not None else None
        try:
            if header is not None:
                return min(float(header), _MAX_BACKOFF_SECONDS)
        except ValueError:
            pass
        if match := _RETRY_AFTER_MESSAGE.search(str(exc)):
            seconds = float(match[1]) / (1000 if match[2].lower() == "ms" else 1)
            return min(seconds + 0.5, _MAX_BACKOFF_SECONDS)
        return min(2.0**attempt, _MAX_BACKOFF_SECONDS)

    def _request_kwargs(
        self, messages: Messages, model: str, temperature: float, max_tokens: int | None,
        reasoning_effort: Effort | None = None,
    ) -> dict:
        kwargs: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature}
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        # Only Groq's gpt-oss reasoning models take this; other servers may reject unknown params.
        if reasoning_effort and "gpt-oss" in model:
            kwargs["reasoning_effort"] = reasoning_effort
        return kwargs

    def _cache_key(self, kind: str, model: str, messages: Messages, temperature: float,
                   max_tokens: int | None, schema: dict | None = None,
                   reasoning_effort: Effort | None = None) -> str:
        return self.cache.key(
            {"kind": kind, "model": model, "messages": messages, "temperature": temperature,
             "max_tokens": max_tokens, "schema": schema, "effort": reasoning_effort}
        )

    def _log_run(self, agent: str, model: str, key: str, output: str, tokens: int,
                 latency_ms: int, cached: bool) -> None:
        if self.session_factory is None:
            return
        from app.models import AgentRun

        try:
            with self.session_factory() as session:
                session.add(AgentRun(agent=agent, model=model, input_hash=key, output=output,
                                     tokens=tokens, latency_ms=latency_ms, cached=cached))
                session.commit()
        except Exception:  # logging must never break an LLM call
            logger.exception("could not record AgentRun")

    # ---------- public API ----------

    def chat(self, messages: Messages, *, agent: str, tier: Tier = "large", model: str | None = None,
             temperature: float = 0.2, max_tokens: int | None = None, use_cache: bool = True,
             reasoning_effort: Effort | None = None) -> LLMResult:
        model = self._model(tier, model)
        key = self._cache_key("chat", model, messages, temperature, max_tokens,
                              reasoning_effort=reasoning_effort)
        if use_cache and (hit := self.cache.get(key)):
            self._log_run(agent, model, key, hit["text"], 0, 0, True)
            return LLMResult(hit["text"], model, hit.get("tokens", 0), 0, True)

        start = time.perf_counter()
        resp = self._with_retries(
            lambda: self.client.chat.completions.create(
                **self._request_kwargs(messages, model, temperature, max_tokens, reasoning_effort)
            )
        )
        latency = int((time.perf_counter() - start) * 1000)
        text = resp.choices[0].message.content or ""
        tokens = resp.usage.total_tokens if resp.usage else 0
        if use_cache:
            self.cache.set(key, {"text": text, "tokens": tokens})
        self._log_run(agent, model, key, text, tokens, latency, False)
        return LLMResult(text, model, tokens, latency, False)

    def chat_json(self, messages: Messages, schema: type[T], *, agent: str, tier: Tier = "large",
                  model: str | None = None, temperature: float = 0.0, max_tokens: int | None = None,
                  use_cache: bool = True, max_repairs: int = 2,
                  reasoning_effort: Effort | None = None) -> T:
        """Ask for a JSON object and return it validated as `schema`.

        Invalid output is fed back to the model for up to `max_repairs` corrections.
        Only validated results are cached, so a bad reply is never replayed.
        """
        model = self._model(tier, model)
        schema_json = schema.model_json_schema()
        convo: Messages = [
            {"role": "system",
             "content": "Reply with a single JSON object that matches this JSON Schema. "
                        "No prose, no code fences.\n" + json.dumps(schema_json)},
            *messages,
        ]
        key = self._cache_key("json", model, convo, temperature, max_tokens, schema_json,
                              reasoning_effort)
        if use_cache and (hit := self.cache.get(key)):
            self._log_run(agent, model, key, hit["text"], 0, 0, True)
            return schema.model_validate_json(hit["text"])

        total_tokens, start = 0, time.perf_counter()
        last_error = ""
        for _ in range(max_repairs + 1):
            kwargs = self._request_kwargs(convo, model, temperature, max_tokens, reasoning_effort)
            kwargs["response_format"] = {"type": "json_object"}
            try:
                resp = self._with_retries(lambda: self.client.chat.completions.create(**kwargs))
            except LLMJsonRejected as exc:
                last_error = "the JSON was malformed (unbalanced brackets or quotes)"
                convo = [*convo,
                         *([{"role": "assistant", "content": exc.failed_generation}] if exc.failed_generation else []),
                         {"role": "user",
                          "content": f"That reply was invalid: {last_error}.\n"
                                     "Reply again with only the corrected JSON object."}]
                continue
            raw = resp.choices[0].message.content or ""
            total_tokens += resp.usage.total_tokens if resp.usage else 0
            try:
                parsed = schema.model_validate_json(_extract_json(raw))
            except (ValidationError, ValueError) as exc:
                last_error = str(exc)
                convo = [*convo,
                         {"role": "assistant", "content": raw},
                         {"role": "user",
                          "content": f"That reply was invalid: {last_error}\n"
                                     "Reply again with only the corrected JSON object."}]
                continue
            latency = int((time.perf_counter() - start) * 1000)
            text = parsed.model_dump_json()
            if use_cache:
                self.cache.set(key, {"text": text, "tokens": total_tokens})
            self._log_run(agent, model, key, text, total_tokens, latency, False)
            return parsed

        raise LLMValidationError(
            f"{agent}: no valid {schema.__name__} after {max_repairs + 1} attempts. Last error: {last_error}"
        )

    def stream(self, messages: Messages, *, agent: str, tier: Tier = "large", model: str | None = None,
               temperature: float = 0.2, max_tokens: int | None = None,
               use_cache: bool = True, reasoning_effort: Effort | None = None) -> Iterator[str]:
        """Yield the reply piece by piece. Only completed streams are cached."""
        model = self._model(tier, model)
        key = self._cache_key("chat", model, messages, temperature, max_tokens,
                              reasoning_effort=reasoning_effort)
        if use_cache and (hit := self.cache.get(key)):
            text = hit["text"]
            for i in range(0, len(text), _REPLAY_CHUNK_CHARS):
                yield text[i : i + _REPLAY_CHUNK_CHARS]
            self._log_run(agent, model, key, text, 0, 0, True)
            return

        start = time.perf_counter()
        response = self._with_retries(
            lambda: self.client.chat.completions.create(
                **self._request_kwargs(messages, model, temperature, max_tokens, reasoning_effort),
                stream=True
            )
        )
        parts: list[str] = []
        tokens = 0
        for chunk in response:
            if getattr(chunk, "usage", None):
                tokens = chunk.usage.total_tokens
            if chunk.choices and (delta := chunk.choices[0].delta.content):
                parts.append(delta)
                yield delta

        text = "".join(parts)
        if use_cache:
            self.cache.set(key, {"text": text, "tokens": tokens})
        self._log_run(agent, model, key, text, tokens, int((time.perf_counter() - start) * 1000), False)


@lru_cache
def get_llm() -> LLMClient:
    """Shared client used by agents and routers."""
    from app.db import SessionLocal

    return LLMClient(session_factory=SessionLocal)
