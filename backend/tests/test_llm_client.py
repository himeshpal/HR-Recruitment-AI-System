import httpx
import openai
import pytest
from pydantic import BaseModel

from app.llm.client import LLMError, LLMValidationError
from app.models import AgentRun

MSG = [{"role": "user", "content": "hi"}]


class Verdict(BaseModel):
    decision: str
    score: int


def _rate_limit(retry_after: str | None = None) -> openai.RateLimitError:
    headers = {"retry-after": retry_after} if retry_after else {}
    response = httpx.Response(429, headers=headers, request=httpx.Request("POST", "http://x/v1"))
    return openai.RateLimitError("slow down", response=response, body=None)


def test_second_identical_call_is_served_from_cache(make_llm):
    llm, fake = make_llm(["hello"])
    first = llm.chat(MSG, agent="t")
    second = llm.chat(MSG, agent="t")
    assert (first.text, first.cached) == ("hello", False)
    assert (second.text, second.cached) == ("hello", True)
    assert len(fake.completions.calls) == 1


def test_use_cache_false_always_calls_the_model(make_llm):
    llm, fake = make_llm(["a", "b"])
    llm.chat(MSG, agent="t", use_cache=False)
    llm.chat(MSG, agent="t", use_cache=False)
    assert len(fake.completions.calls) == 2


def test_tier_selects_the_configured_model(make_llm):
    llm, fake = make_llm(["x", "y"])
    llm.chat(MSG, agent="t", tier="large")
    llm.chat(MSG, agent="t", tier="small")
    models = [c["model"] for c in fake.completions.calls]
    assert models == [llm.settings.llm_model_large, llm.settings.llm_model_small]


def test_retries_on_rate_limit_and_honours_retry_after(make_llm):
    llm, fake = make_llm([_rate_limit("3"), "ok"])
    assert llm.chat(MSG, agent="t").text == "ok"
    assert llm.sleeps == [3.0]


def test_gives_up_after_max_attempts(make_llm):
    llm, fake = make_llm([_rate_limit()] * 4)
    with pytest.raises(LLMError, match="4 attempts"):
        llm.chat(MSG, agent="t")
    assert len(fake.completions.calls) == 4


def test_bad_request_is_not_retried(make_llm):
    response = httpx.Response(400, request=httpx.Request("POST", "http://x/v1"))
    err = openai.BadRequestError("bad model", response=response, body=None)
    llm, fake = make_llm([err])
    with pytest.raises(LLMError, match="400"):
        llm.chat(MSG, agent="t")
    assert len(fake.completions.calls) == 1


def test_chat_json_returns_validated_model_and_caches_it(make_llm):
    llm, fake = make_llm(['{"decision": "hire", "score": 9}'])
    a = llm.chat_json(MSG, Verdict, agent="t")
    b = llm.chat_json(MSG, Verdict, agent="t")
    assert a == b == Verdict(decision="hire", score=9)
    assert len(fake.completions.calls) == 1
    assert fake.completions.calls[0]["response_format"] == {"type": "json_object"}


def test_chat_json_strips_code_fences(make_llm):
    llm, _ = make_llm(['```json\n{"decision": "hire", "score": 1}\n```'])
    assert llm.chat_json(MSG, Verdict, agent="t").score == 1


def test_chat_json_repairs_invalid_output(make_llm):
    llm, fake = make_llm(["not json at all", '{"decision": "no", "score": "x"}', '{"decision": "maybe", "score": 5}'])
    result = llm.chat_json(MSG, Verdict, agent="t")
    assert result == Verdict(decision="maybe", score=5)
    assert len(fake.completions.calls) == 3
    # the model is told what was wrong on the retry
    assert "invalid" in fake.completions.calls[1]["messages"][-1]["content"]


def test_chat_json_raises_when_output_never_validates(make_llm):
    llm, fake = make_llm(["nope"] * 3)
    with pytest.raises(LLMValidationError):
        llm.chat_json(MSG, Verdict, agent="t")
    assert len(fake.completions.calls) == 3


def test_invalid_output_is_never_cached(make_llm):
    llm, fake = make_llm(["nope", "nope", "nope", '{"decision": "ok", "score": 1}'])
    with pytest.raises(LLMValidationError):
        llm.chat_json(MSG, Verdict, agent="t")
    assert llm.chat_json(MSG, Verdict, agent="t").decision == "ok"


def test_stream_yields_pieces_then_replays_from_cache(make_llm):
    llm, fake = make_llm([["Hel", "lo ", "there"]])
    assert list(llm.stream(MSG, agent="t")) == ["Hel", "lo ", "there"]
    assert "".join(llm.stream(MSG, agent="t")) == "Hello there"
    assert len(fake.completions.calls) == 1


def test_abandoned_stream_is_not_cached(make_llm):
    llm, fake = make_llm([["a", "b", "c"], ["a", "b", "c"]])
    gen = llm.stream(MSG, agent="t")
    next(gen)
    gen.close()
    assert "".join(llm.stream(MSG, agent="t")) == "abc"
    assert len(fake.completions.calls) == 2


def test_every_call_is_logged_as_an_agent_run(make_llm, session_factory):
    llm, _ = make_llm(["hello"])
    llm.chat(MSG, agent="jd_generator")
    llm.chat(MSG, agent="jd_generator")
    with session_factory() as s:
        rows = s.query(AgentRun).order_by(AgentRun.id).all()
    assert [(r.agent, r.cached) for r in rows] == [("jd_generator", False), ("jd_generator", True)]
    assert rows[0].tokens == 10


def test_missing_api_key_gives_a_clear_error(tmp_path):
    from app.config import Settings
    from app.llm.client import LLMClient

    llm = LLMClient(settings=Settings(llm_api_key="", llm_cache_dir=tmp_path, _env_file=None))
    with pytest.raises(LLMError, match="GROQ_API_KEY"):
        llm.chat(MSG, agent="t")
