from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db import Base
from app.llm.cache import DiskCache
from app.llm.client import LLMClient


class FakeCompletions:
    """Stands in for client.chat.completions. Each script item is a reply string or an Exception."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        if kwargs.get("stream"):
            return iter(
                SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))], usage=None)
                for piece in item
            )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=item))],
            usage=SimpleNamespace(total_tokens=10),
        )


class FakeOpenAI:
    def __init__(self, script):
        self.completions = FakeCompletions(script)
        self.chat = SimpleNamespace(completions=self.completions)


@pytest.fixture
def session_factory():
    from app import models  # noqa: F401  (registers tables on Base)

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def make_llm(tmp_path, session_factory):
    sleeps: list[float] = []

    def _make(script) -> tuple[LLMClient, FakeOpenAI]:
        fake = FakeOpenAI(script)
        settings = Settings(llm_api_key="test", llm_cache_dir=tmp_path / "cache", _env_file=None)
        llm = LLMClient(
            settings=settings,
            client=fake,
            cache=DiskCache(tmp_path / "cache"),
            session_factory=session_factory,
            sleep=sleeps.append,
        )
        llm.sleeps = sleeps
        return llm, fake

    return _make


@pytest.fixture
def api(session_factory, make_llm):
    """A TestClient wired to an in-memory DB and a scripted fake LLM: `client, fake = api([...])`."""
    from fastapi.testclient import TestClient

    from app.db import get_db, get_session_factory
    from app.llm.client import get_llm
    from app.main import app

    def build(script=()):
        llm, fake = make_llm(script)

        def db_override():
            with session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_llm] = lambda: llm
        app.dependency_overrides[get_session_factory] = lambda: session_factory
        return TestClient(app), fake

    yield build
    app.dependency_overrides.clear()
