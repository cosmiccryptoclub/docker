"""Daily journal, monthly calendar, and discipline-goal tracking."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel import Session, select

from src import metrics, settings_store, tz
from src.db import get_session
from src.models import Account, DayNote, Trade
from src.queries import get_trades

router = APIRouter(prefix="/api/journal", tags=["journal"])


def _day_key(t: Trade) -> str:
    return tz.local_date(t.closed_at or t.opened_at).isoformat()


def _adherence(t: Trade) -> Optional[float]:
    cl = t.checklist or []
    if not cl:
        return None
    return sum(1 for c in cl if c.get("checked")) / len(cl)


def _goals(s: dict) -> dict:
    return {k: s.get(k, 0) for k in settings_store.GOAL_KEYS}


def _note_dict(n: Optional[DayNote], d: str) -> dict:
    if not n:
        return {"date": d, "notes": "", "plan": "", "lessons": "",
                "rating": None, "followed_plan": None, "mood": "", "tags": []}
    return {
        "date": n.date, "notes": n.notes or "", "plan": n.plan or "",
        "lessons": n.lessons or "", "rating": n.rating,
        "followed_plan": n.followed_plan, "mood": n.mood or "", "tags": n.tags or [],
    }


@router.get("/month")
def month(year: int, month: int, account_id: Optional[int] = None,
          session: Session = Depends(get_session)):
    """Per-day PnL / R / note + goal flags for a calendar month grid."""
    trades = [t for t in get_trades(session, account_id=account_id) if t.status == "closed"]
    ndays = monthrange(year, month)[1]
    lo, hi = date(year, month, 1), date(year, month, ndays)

    by_day: dict[str, list] = {}
    for t in trades:
        d = tz.local_date(t.closed_at or t.opened_at)
        if lo <= d <= hi:
            by_day.setdefault(d.isoformat(), []).append(t)

    notes = {n.date: n for n in session.exec(
        select(DayNote).where(DayNote.date >= lo.isoformat(), DayNote.date <= hi.isoformat())
    ).all()}

    s = settings_store.load()
    max_trades = int(s.get("goal_max_trades_per_day", 0) or 0)
    max_daily_loss = float(s.get("goal_max_daily_loss", 0) or 0)

    days = []
    for iso, ts in by_day.items():
        pnl = sum(t.realized_pnl for t in ts)
        n = notes.get(iso)
        days.append({
            "date": iso, "pnl": pnl, "trades": len(ts),
            "r": sum((t.r_multiple or 0.0) for t in ts),
            "wins": len([t for t in ts if t.realized_pnl > 1e-9]),
            "has_note": n is not None,
            "rating": n.rating if n else None,
            "followed_plan": n.followed_plan if n else None,
            "over_trades": bool(max_trades and len(ts) > max_trades),
            "broke_daily_loss": bool(max_daily_loss and pnl < -max_daily_loss),
        })
    for iso, n in notes.items():   # journaled days with no trades
        if iso not in by_day:
            days.append({"date": iso, "pnl": 0.0, "trades": 0, "r": 0.0, "wins": 0,
                         "has_note": True, "rating": n.rating, "followed_plan": n.followed_plan,
                         "over_trades": False, "broke_daily_loss": False})

    all_ts = [t for ts in by_day.values() for t in ts]
    totals = metrics.summary_stats(all_ts)
    return {"year": year, "month": month, "days": days, "totals": totals, "goals": _goals(s)}


@router.get("/day")
def day(date_str: str = Query(..., alias="date"), account_id: Optional[int] = None,
        session: Session = Depends(get_session)):
    """A single day: its closed trades, day stats, journal note, and goal flags."""
    accounts = {a.id: a for a in session.exec(select(Account)).all()}
    trades = [t for t in get_trades(session, account_id=account_id)
              if t.status == "closed" and _day_key(t) == date_str]

    def brief(t):
        return {
            "id": t.id, "symbol": t.symbol, "direction": t.direction,
            "realized_pnl": t.realized_pnl, "r_multiple": t.r_multiple,
            "opened_at": tz.iso_utc(t.opened_at),
            "closed_at": tz.iso_utc(t.closed_at or t.opened_at),
            "setup": t.setup, "rating": t.rating,
            "account": accounts[t.account_id].name if t.account_id in accounts else None,
        }

    trades_sorted = sorted(trades, key=lambda t: t.closed_at or t.opened_at)
    stats = metrics.summary_stats(trades)
    adhs = [a for a in (_adherence(t) for t in trades) if a is not None]
    stats["avg_adherence"] = (sum(adhs) / len(adhs) * 100) if adhs else None

    n = session.exec(select(DayNote).where(DayNote.date == date_str)).first()

    s = settings_store.load()
    max_trades = int(s.get("goal_max_trades_per_day", 0) or 0)
    max_daily_loss = float(s.get("goal_max_daily_loss", 0) or 0)
    flags = {
        "over_trades": bool(max_trades and len(trades) > max_trades),
        "broke_daily_loss": bool(max_daily_loss and stats["net_pnl"] < -max_daily_loss),
    }
    return {"date": date_str, "note": _note_dict(n, date_str),
            "trades": [brief(t) for t in trades_sorted], "stats": stats,
            "flags": flags, "goals": _goals(s)}


@router.put("/day")
async def upsert_day(request: Request, date_str: str = Query(..., alias="date"),
                     session: Session = Depends(get_session)):
    body = await request.json()
    n = session.exec(select(DayNote).where(DayNote.date == date_str)).first()
    if not n:
        n = DayNote(date=date_str)
    for k in ("notes", "plan", "lessons", "mood"):
        if k in body:
            setattr(n, k, body[k])
    if "rating" in body:
        n.rating = body["rating"]
    if "followed_plan" in body:
        n.followed_plan = body["followed_plan"]
    if "tags" in body and isinstance(body["tags"], list):
        n.tags = body["tags"]
    n.updated_at = datetime.utcnow()
    session.add(n)
    session.commit()
    session.refresh(n)
    return _note_dict(n, date_str)


@router.get("/goals")
def goals(account_id: Optional[int] = None, session: Session = Depends(get_session)):
    """Discipline goals + current progress (today's trades/loss, month-to-date R, adherence)."""
    s = settings_store.load()
    trades = get_trades(session, account_id=account_id)
    closed = [t for t in trades if t.status == "closed"]

    today = tz.local_today()
    first = today.replace(day=1)

    today_trades = [t for t in trades if tz.local_date(t.opened_at) == today]
    today_closed = [t for t in closed if tz.local_date(t.closed_at or t.opened_at) == today]
    today_pnl = sum(t.realized_pnl for t in today_closed)

    month_closed = [t for t in closed if tz.local_date(t.closed_at or t.opened_at) >= first]
    month_r = sum((t.r_multiple or 0.0) for t in month_closed)
    adhs = [a for a in (_adherence(t) for t in month_closed) if a is not None]

    return {
        "goals": _goals(s),
        "progress": {
            "trades_today": len(today_trades),
            "today_pnl": today_pnl,
            "daily_loss_today": max(-today_pnl, 0.0),
            "month_r": month_r,
            "adherence_pct": (sum(adhs) / len(adhs) * 100) if adhs else None,
        },
    }
