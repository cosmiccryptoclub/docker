"""Database engine + session helpers (SQLite via SQLModel)."""
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import event, inspect, text
from sqlmodel import SQLModel, Session, create_engine

from src.config import DATABASE_URL

# check_same_thread=False so FastAPI's threadpool can share the connection;
# timeout waits out a busy writer instead of raising "database is locked".
engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 15},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    """WAL journal so the background collectors (candles/econ/sync threads) can write
    while the UI reads; NORMAL sync is safe with WAL and much faster."""
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


def _auto_migrate() -> None:
    """Add any model columns missing from an existing DB (SQLite ALTER TABLE ADD COLUMN).

    Lightweight forward-only migration so adding nullable columns to a model never
    breaks a running database. New columns are added nullable; existing rows get NULL.
    """
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in tables:
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                coltype = col.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {coltype}'))


def init_db() -> None:
    """Create tables if they don't exist, then migrate in any new columns."""
    from src import models  # noqa: F401  (registers tables on SQLModel.metadata)

    SQLModel.metadata.create_all(engine)
    try:
        _auto_migrate()
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  auto-migrate skipped: {e}")


def get_session() -> Iterator[Session]:
    """FastAPI dependency: yields a session per request."""
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context manager for use outside of request handlers (seed scripts, sync jobs)."""
    with Session(engine) as session:
        yield session
