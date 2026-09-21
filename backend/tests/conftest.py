import threading
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.db import Base
from app.llm.cache import DiskCache
from app.llm.client import LLMClient


class FakeCompletions:
    """Stands in for client.chat.completions.

    `script` is either a list of replies (a string, a list of stream pieces, or an Exception, used in
    order) or a function taking the request kwargs and returning one, for parallel code paths.
    """

    def __init__(self, script):
        self.script = script if callable(script) else list(script)
        self.calls = []
        self._lock = threading.Lock()

    def create(self, **kwargs):
        with self._lock:
            self.calls.append(kwargs)
            item = self.script(kwargs) if callable(self.script) else self.script.pop(0)
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
def session_factory(tmp_path):
    """A real SQLite file per test, configured exactly like production (threads get their own connections)."""
    from app import models  # noqa: F401  (registers tables on Base)
    from app.db import make_engine

    engine = make_engine(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def make_llm(tmp_path, session_factory):
    sleeps: list[float] = []
    now = [0.0]

    def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        now[0] += seconds  # sleeping moves the fake clock, so cooldowns behave like real time

    def _make(script) -> tuple[LLMClient, FakeOpenAI]:
        fake = FakeOpenAI(script)
        settings = Settings(llm_api_key="test", llm_cache_dir=tmp_path / "cache", _env_file=None)
        llm = LLMClient(
            settings=settings,
            client=fake,
            cache=DiskCache(tmp_path / "cache"),
            session_factory=session_factory,
            sleep=fake_sleep,
            clock=lambda: now[0],
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
    from app.services.embeddings import get_embedder

    def build(script=()):
        llm, fake = make_llm(script)

        def db_override():
            with session_factory() as session:
                yield session

        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_llm] = lambda: llm
        app.dependency_overrides[get_session_factory] = lambda: session_factory
        app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
        return TestClient(app), fake

    yield build
    app.dependency_overrides.clear()


class FakeEmbedder:
    """Bag-of-words hashing embedder: deterministic, no model download. Shared words mean similarity."""

    def ensure_loaded(self) -> None:
        pass

    def embed(self, texts):
        import re
        import zlib

        import numpy as np

        vectors = np.zeros((len(texts), 128), dtype=np.float32)
        for row, text in enumerate(texts):
            for word in re.findall(r"[a-z0-9+#.]+", text.lower()):
                vectors[row, zlib.crc32(word.encode()) % 128] += 1.0
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / np.where(norms == 0, 1, norms)


@pytest.fixture
def embedder():
    return FakeEmbedder()
