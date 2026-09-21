from collections.abc import Iterator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    if not url.startswith("sqlite"):
        return create_engine(url)
    # Screening writes from several threads. A busy timeout makes writers wait for each other instead of
    # failing with "database is locked", and WAL mode lets readers carry on while a write is in progress.
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _enable_wal(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA journal_mode=WAL")

    return engine


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def _add_missing_columns() -> None:
    """Tiny migration step: add columns that newer models have but an older dev database lacks.

    create_all() only creates missing tables, never missing columns. Only plain nullable
    columns can be added this way, which is all this project needs.
    """
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name not in existing:
                    ddl_type = column.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl_type}'))


def init_db() -> None:
    from app import models  # noqa: F401  (registers tables on Base)

    Base.metadata.create_all(engine)
    _add_missing_columns()


def get_session_factory() -> sessionmaker:
    """For code that outlives the request's session (for example streaming responses)."""
    return SessionLocal


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
