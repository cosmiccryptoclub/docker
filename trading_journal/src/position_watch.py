"""
Position watcher — records what happens to open positions between executions.

Deals only tell you about executions, so everything that happens *while* a position is
open (stop moved to breakeven, stop trailed or widened, overnight swap charged) is
invisible to the deal sync. This polls the broker's open positions and writes a
TradeEvent whenever a watched value changes.

Forward-going only: it can only see changes from the moment it starts running.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from src import eventlog
from src.models import Account, TradeEvent

EPS = 1e-9


def _last(session: Session, position_id: str, kind: str) -> Optional[TradeEvent]:
    return session.exec(
        select(TradeEvent)
        .where(TradeEvent.position_id == position_id, TradeEvent.kind == kind)
        .order_by(TradeEvent.at.desc())
    ).first()


def _record(session: Session, *, position_id: str, account_id, kind: str, symbol: str,
            at: datetime, price=None, prev_price=None, amount=None, note=None) -> bool:
    """Insert an event, skipping exact duplicates (the unique key is position+kind+at)."""
    exists = session.exec(
        select(TradeEvent).where(
            TradeEvent.position_id == position_id,
            TradeEvent.kind == kind,
            TradeEvent.at == at,
        )
    ).first()
    if exists:
        return False
    session.add(TradeEvent(
        position_id=position_id, account_id=account_id, kind=kind, symbol=symbol,
        at=at, price=price, prev_price=prev_price, amount=amount, note=note,
    ))
    return True


def poll_account(session: Session, account: Account, snapshot: dict) -> dict:
    """Compare a live snapshot against what we last saw and record any changes."""
    now = datetime.utcnow()
    stops = swaps = 0

    for p in snapshot.get("positions") or []:
        pid = str(p.get("position_id"))
        symbol = p.get("symbol")

        # --- stop loss ------------------------------------------------------
        sl = p.get("stop_loss")
        if sl is not None:
            prev = _last(session, pid, "stop_change")
            if prev is None or abs((prev.price or 0.0) - sl) > EPS:
                note = None
                if prev is None:
                    note = "initial"
                elif prev.price is not None:
                    entry = p.get("entry")
                    long = p.get("direction") == "long"
                    if entry is not None:
                        # a stop moved further from entry is a widened stop
                        was = abs(entry - prev.price)
                        now_d = abs(entry - sl)
                        if now_d > was + EPS:
                            note = "widened"
                        elif (long and sl >= entry) or (not long and sl <= entry):
                            note = "breakeven+"
                        else:
                            note = "tightened"
                if _record(session, position_id=pid, account_id=account.id,
                           kind="stop_change", symbol=symbol, at=now,
                           price=sl, prev_price=prev.price if prev else None, note=note):
                    stops += 1

        # --- swap (cumulative on the position; store the delta charged) ------
        swap = p.get("swap")
        if swap is not None and abs(swap) > EPS:
            prev = _last(session, pid, "swap")
            seen = 0.0
            if prev is not None:
                # reconstruct what we've already recorded for this position
                rows = session.exec(
                    select(TradeEvent).where(
                        TradeEvent.position_id == pid, TradeEvent.kind == "swap")
                ).all()
                seen = sum(r.amount or 0.0 for r in rows)
            delta = swap - seen
            if abs(delta) > 0.005:      # ignore sub-cent noise
                if _record(session, position_id=pid, account_id=account.id,
                           kind="swap", symbol=symbol, at=now, amount=delta):
                    swaps += 1

    if stops or swaps:
        session.commit()
    return {"stops": stops, "swaps": swaps}


def poll_all(session: Session) -> dict:
    """Poll every cTrader-linked account. Best-effort; never raises."""
    from src.connectors.ctrader import CTraderConnector

    connector = CTraderConnector()
    if not connector.is_configured():
        return {"stops": 0, "swaps": 0, "accounts": 0}

    totals = {"stops": 0, "swaps": 0, "accounts": 0}
    for acc in session.exec(select(Account)).all():
        if acc.is_backtest or not acc.external_id:
            continue
        try:
            snap = connector.fetch_account_snapshot(str(acc.external_id))
        except Exception as e:  # noqa: BLE001
            eventlog.warning("positions", f"{acc.name}: snapshot failed: {e}")
            continue
        res = poll_account(session, acc, snap)
        totals["stops"] += res["stops"]
        totals["swaps"] += res["swaps"]
        totals["accounts"] += 1

    if totals["stops"] or totals["swaps"]:
        eventlog.info("positions",
                      f"recorded {totals['stops']} stop change(s), {totals['swaps']} swap charge(s)")
    return totals


def events_for(session: Session, position_ids, ) -> list:
    """All recorded events for a trade's positions, oldest first."""
    pids = [str(p) for p in (position_ids or [])]
    if not pids:
        return []
    rows = session.exec(
        select(TradeEvent).where(TradeEvent.position_id.in_(pids)).order_by(TradeEvent.at)
    ).all()
    return rows


def original_stop(session: Session, position_ids) -> Optional[dict]:
    """The earliest recorded stop per position -> lots-unaware weighted-free average.

    Used to recover the ORIGINAL stop (before it was moved) for R, which is more correct
    than the broker's current stop that the sync writes.
    """
    pids = [str(p) for p in (position_ids or [])]
    if not pids:
        return None
    firsts = []
    for pid in pids:
        row = session.exec(
            select(TradeEvent)
            .where(TradeEvent.position_id == pid, TradeEvent.kind == "stop_change")
            .order_by(TradeEvent.at)
        ).first()
        if row and row.price is not None:
            firsts.append(row.price)
    if not firsts:
        return None
    return {"price": sum(firsts) / len(firsts), "is_avg": len(set(firsts)) > 1,
            "count": len(firsts)}
