"""Phase 0 check: get a real reply from the configured LLM, then prove the cache works.

Run from backend/:   .venv\\Scripts\\python scripts\\llm_smoke.py
"""

import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import BaseModel

from app.config import get_settings
from app.db import SessionLocal, init_db
from app.llm.client import LLMClient, LLMError
from app.models import AgentRun


class Greeting(BaseModel):
    greeting: str
    language: str


def main() -> int:
    settings = get_settings()
    print(f"Provider : {settings.llm_base_url}")
    print(f"Models   : large={settings.llm_model_large}  small={settings.llm_model_small}")

    init_db()
    llm = LLMClient(session_factory=SessionLocal)
    # a fresh token per run keeps step 2 a real call, so the check is repeatable
    nonce = uuid.uuid4().hex[:8]
    messages = [{"role": "user",
                 "content": f"Say hello in one short sentence, and name the language. (ref {nonce})"}]

    try:
        first = llm.chat(messages, agent="smoke", tier="small", use_cache=False)
        print(f"\n1) plain chat : {first.text.strip()!r}  ({first.latency_ms} ms, {first.tokens} tokens)")

        second = llm.chat_json(messages, Greeting, agent="smoke", tier="small")
        print(f"2) JSON chat  : {second.model_dump()}")
        third = llm.chat_json(messages, Greeting, agent="smoke", tier="small")
        print(f"3) same again : {third.model_dump()}")
    except LLMError as exc:
        print(f"\nFAILED: {exc}")
        return 1

    with SessionLocal() as session:
        runs = session.query(AgentRun).filter_by(agent="smoke").order_by(AgentRun.id.desc()).limit(3).all()
    cached_flags = [r.cached for r in reversed(runs)]
    print(f"\nAgentRun rows (oldest first) cached flags: {cached_flags}")

    ok = cached_flags == [False, False, True]
    print("PASS: real reply received and the repeat call was served from cache." if ok
          else "FAIL: expected the last call to be a cache hit.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
