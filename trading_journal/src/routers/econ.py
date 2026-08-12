"""Economic calendar: upcoming high-impact news + window queries + manual refresh."""
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session

from src import econ
from src.db import get_session, session_scope

router = APIRouter(prefix="/api/econ", tags=["econ"])


def _split(value: Optional[str]):
    if not value:
        return None
    return [v.strip().upper() for v in str(value).split(",") if v.strip()]


@router.get("")
def list_events(start: int, end: int, currencies: Optional[str] = None, min_impact: str = "Low",
                session: Session = Depends(get_session)):
    """Events in an epoch-seconds window, optionally filtered by currency + min impact."""
    return {"events": econ.events(session, start, end, _split(currencies), min_impact)}


@router.get("/upcoming")
def upcoming(hours: int = 168, currencies: Optional[str] = None, min_impact: str = "High",
             limit: int = 12, session: Session = Depends(get_session)):
    now_s = int(datetime.utcnow().timestamp())
    return {"events": econ.upcoming(session, now_s, hours * 3600, _split(currencies), min_impact, limit)}


@router.get("/status")
def status(session: Session = Depends(get_session)):
    return econ.stats(session)


@router.post("/refresh")
def refresh():
    def _job():
        try:
            with session_scope() as session:
                econ.refresh(session)
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  [econ] manual refresh failed: {e}")
    threading.Thread(target=_job, daemon=True).start()
    return {"status": "started"}
