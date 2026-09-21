from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    kwargs = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
    return create_engine(url, **kwargs)


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    from app import models  # noqa: F401  (registers tables on Base)

    Base.metadata.create_all(engine)


def get_session_factory() -> sessionmaker:
    """For code that outlives the request's session (for example streaming responses)."""
    return SessionLocal


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
