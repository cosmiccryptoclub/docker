"""Shared trade filtering used by both the list endpoint and analytics."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select

from src.models import Account, Trade, TradeTagLink


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    s = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        dt = datetime.fromisoformat(s + "T00:00:00")
    return dt.replace(tzinfo=None)


def get_trades(
    session: Session,
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    direction: Optional[str] = None,
    setup: Optional[str] = None,
    session_name: Optional[str] = None,
    tag: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    search: Optional[str] = None,
    tag_option_ids: Optional[List[int]] = None,
    tag_match: str = "all",
) -> List[Trade]:
    stmt = select(Trade)
    if account_id:
        stmt = stmt.where(Trade.account_id == account_id)
    if status:
        stmt = stmt.where(Trade.status == status)
    if symbol:
        stmt = stmt.where(Trade.symbol == symbol)
    if direction:
        stmt = stmt.where(Trade.direction == direction)
    if setup:
        stmt = stmt.where(Trade.setup == setup)
    if start:
        stmt = stmt.where(Trade.opened_at >= start)
    if end:
        stmt = stmt.where(Trade.opened_at <= end)

    rows = list(session.exec(stmt).all())

    # global views exclude backtest-sandbox accounts (they're a separate playground)
    if not account_id:
        bt = {a.id for a in session.exec(select(Account).where(Account.is_backtest == True)).all()}  # noqa: E712
        if bt:
            rows = [t for t in rows if t.account_id not in bt]

    if tag_option_ids:
        wanted = set(tag_option_ids)
        links = session.exec(
            select(TradeTagLink.trade_id, TradeTagLink.option_id)
            .where(TradeTagLink.option_id.in_(wanted))
        ).all()
        matched: dict[int, set] = {}
        for tid, oid in links:
            matched.setdefault(tid, set()).add(oid)
        if tag_match == "any":
            keep = {tid for tid, opts in matched.items() if opts}
        else:  # all
            keep = {tid for tid, opts in matched.items() if wanted.issubset(opts)}
        rows = [t for t in rows if t.id in keep]

    if session_name:
        # sessions overlap, so a trade matches if the filter is any of its labels
        rows = [t for t in rows if session_name in (t.sessions or ([t.session] if t.session else []))]
    if tag:
        rows = [t for t in rows if tag in (t.tags or [])]
    if search:
        s = search.lower()
        rows = [
            t for t in rows
            if s in (t.notes or "").lower()
            or s in (t.setup or "").lower()
            or s in t.symbol.lower()
            or any(s in tg.lower() for tg in (t.tags or []))
        ]
    return rows


def portfolio_starting_balance(session: Session, account_id: Optional[int]) -> float:
    if account_id:
        acc = session.get(Account, account_id)
        return acc.starting_balance if acc else 0.0
    return sum(a.starting_balance for a in session.exec(select(Account)).all())
