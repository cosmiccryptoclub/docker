"""Trades: list / create / detail / update / delete + add fills."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlmodel import Session, select

from src import marketdata, trade_ops
from src.candles import build_chart, persist_excursions
from src.db import get_session
from src.metrics import compute_trade_metrics, recompute_trade
from src.models import Account, Fill, Trade
from src.queries import get_trades, parse_dt
from src.serializers import trade_dict
from src.tag_service import set_trade_tag_options

router = APIRouter(prefix="/api/trades", tags=["trades"])

SORT_FIELDS = {
    "opened_at": Trade.opened_at,
    "closed_at": Trade.closed_at,
    "realized_pnl": Trade.realized_pnl,
    "r_multiple": Trade.r_multiple,
    "symbol": Trade.symbol,
}

# journaling / risk fields the client may set on create or update
WRITABLE = {
    "account_id", "symbol", "direction", "opened_at", "contract_size",
    "initial_stop", "initial_target", "planned_targets", "last_price",
    "setup", "session", "sessions", "timeframe", "tags", "rating", "confidence", "notes", "mistakes",
    "screenshots", "mae_price", "mfe_price", "external_id",
    "playbook_id", "checklist", "data_ignored",
}


def _acc_balance(session: Session, account_id: int) -> float:
    acc = session.get(Account, account_id)
    return acc.starting_balance if acc else 0.0


@router.get("")
def list_trades(
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    direction: Optional[str] = None,
    setup: Optional[str] = None,
    session_name: Optional[str] = Query(None, alias="session"),
    tag: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    search: Optional[str] = None,
    tag_option_ids: Optional[str] = None,
    tag_match: str = "all",
    sort: str = "opened_at",
    order: str = "desc",
    limit: int = 200,
    offset: int = 0,
    session: Session = Depends(get_session),
):
    tag_ids = None
    if tag_option_ids:
        tag_ids = [int(x) for x in str(tag_option_ids).split(",") if x.strip().isdigit()]
    rows = get_trades(
        session, account_id=account_id, status=status, symbol=symbol,
        direction=direction, setup=setup, session_name=session_name, tag=tag,
        start=parse_dt(start), end=parse_dt(end), search=search,
        tag_option_ids=tag_ids, tag_match=tag_match,
    )
    reverse = order.lower() != "asc"
    key = sort if sort in SORT_FIELDS else "opened_at"

    def sort_key(t: Trade):
        v = getattr(t, key)
        if v is None:
            return (0, "")
        return (1, v)

    rows.sort(key=sort_key, reverse=reverse)
    total = len(rows)
    page = rows[offset: offset + limit]

    # enrich with entry/exit fill counts (single grouped query, no N+1)
    ids = [t.id for t in page]
    counts: dict[int, dict] = {}
    if ids:
        q = (
            select(Fill.trade_id, Fill.kind, func.count())
            .where(Fill.trade_id.in_(ids))
            .group_by(Fill.trade_id, Fill.kind)
        )
        for tid, kind, c in session.exec(q):
            d = counts.setdefault(tid, {"entry": 0, "exit": 0})
            d["entry" if kind == "entry" else "exit"] += c

    items = []
    for t in page:
        dd = trade_dict(t)
        c = counts.get(t.id, {"entry": 0, "exit": 0})
        dd["entry_count"] = c["entry"]
        dd["exit_count"] = c["exit"]
        items.append(dd)
    return {"total": total, "count": len(items), "trades": items}


@router.get("/export")
def export_trades(
    format: str = "csv",
    include_fills: bool = False,
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    direction: Optional[str] = None,
    setup: Optional[str] = None,
    session_name: Optional[str] = Query(None, alias="session"),
    tag: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    search: Optional[str] = None,
    tag_option_ids: Optional[str] = None,
    tag_match: str = "all",
    session: Session = Depends(get_session),
):
    """Export the CURRENT filtered trade set as CSV or JSON (times in app timezone).

    Declared before /{trade_id} so "export" isn't swallowed by the id route.
    """
    from src import exporter

    tag_ids = None
    if tag_option_ids:
        tag_ids = [int(x) for x in str(tag_option_ids).split(",") if x.strip().isdigit()]
    rows = get_trades(
        session, account_id=account_id, status=status, symbol=symbol,
        direction=direction, setup=setup, session_name=session_name, tag=tag,
        start=parse_dt(start), end=parse_dt(end), search=search,
        tag_option_ids=tag_ids, tag_match=tag_match,
    )
    rows.sort(key=lambda t: t.closed_at or t.opened_at)
    accounts = {a.id: a.name for a in session.exec(select(Account)).all()}

    if format == "json":
        payload = [trade_dict(t, list(t.fills)) for t in rows]
        return exporter.json_response(payload, "trades.json")

    if include_fills:
        frows = [exporter.fill_row(f, t) for t in rows for f in sorted(t.fills, key=lambda x: x.executed_at)]
        return exporter.csv_response(frows, exporter.FILL_COLUMNS, "trade-fills.csv")

    out = []
    for t in rows:
        row = exporter.trade_row(t, accounts.get(t.account_id, ""))
        m = compute_trade_metrics(t, list(t.fills))
        row["avg_exit"] = m["avg_exit"]
        out.append(row)
    return exporter.csv_response(out, exporter.TRADE_COLUMNS, "trades.csv")


@router.post("/group")
async def group_trades(request: Request, session: Session = Depends(get_session)):
    """Manually merge several trades into one logical trade (wide-spaced scale-ins).

    The grouping is stored per BROKER POSITION so a re-sync reproduces it instead of
    splitting them apart again.
    """
    import uuid
    from src.models import PositionGroup

    body = await request.json()
    ids = [int(i) for i in (body.get("trade_ids") or [])]
    if len(ids) < 2:
        raise HTTPException(400, "Select at least two trades to group.")

    trades = [t for t in (session.get(Trade, i) for i in ids) if t]
    if len(trades) != len(ids):
        raise HTTPException(404, "One or more trades not found.")
    if len({t.account_id for t in trades}) > 1:
        raise HTTPException(400, "Trades must be on the same account.")
    if len({t.symbol for t in trades}) > 1:
        raise HTTPException(400, "Trades must be on the same symbol.")
    if len({t.direction for t in trades}) > 1:
        raise HTTPException(400, "Trades must be in the same direction.")

    key = uuid.uuid4().hex[:12]
    account_id = trades[0].account_id
    for t in trades:
        for pid in (t.position_ids or []):
            existing = session.exec(
                select(PositionGroup).where(PositionGroup.position_id == str(pid))
            ).first()
            if existing:
                existing.group_key = key
                session.add(existing)
            else:
                session.add(PositionGroup(position_id=str(pid), group_key=key,
                                          account_id=account_id))
    merged = trade_ops.merge_trades(session, trades)
    session.commit()
    session.refresh(merged)
    return trade_dict(merged, list(merged.fills))


@router.post("/{trade_id}/ungroup")
def ungroup_trade(trade_id: int, session: Session = Depends(get_session)):
    """Forget a manual grouping. The trade splits back apart on the next sync."""
    from src.models import PositionGroup

    trade = session.get(Trade, trade_id)
    if not trade:
        raise HTTPException(404, "Trade not found")
    removed = 0
    for pid in (trade.position_ids or []):
        for row in session.exec(
            select(PositionGroup).where(PositionGroup.position_id == str(pid))
        ).all():
            session.delete(row)
            removed += 1
    session.commit()
    if not removed:
        return {"status": "not-grouped", "id": trade_id}
    return {"status": "ungrouped", "id": trade_id,
            "note": "Re-sync this account to split the trade back apart."}


@router.post("")
async def create_trade(request: Request, session: Session = Depends(get_session)):
    data = await request.json()
    fills_data = data.pop("fills", [])
    tag_option_ids = data.pop("tag_option_ids", None)
    if "opened_at" in data:
        data["opened_at"] = parse_dt(data["opened_at"])
    trade = Trade(**{k: v for k, v in data.items() if k in WRITABLE})
    if not session.get(Account, trade.account_id):
        raise HTTPException(400, "account_id does not exist")
    session.add(trade)
    session.flush()
    for f in fills_data:
        session.add(Fill(
            trade_id=trade.id,
            kind=f.get("kind", "entry"),
            price=float(f["price"]),
            lots=float(f["lots"]),
            executed_at=parse_dt(f.get("executed_at")) or trade.opened_at,
            fee=float(f.get("fee", 0) or 0),
            note=f.get("note"),
        ))
    session.flush()
    if tag_option_ids is not None:
        set_trade_tag_options(session, trade.id, tag_option_ids)
    session.refresh(trade)
    recompute_trade(trade, _acc_balance(session, trade.account_id))
    session.add(trade)
    session.commit()
    session.refresh(trade)
    return trade_dict(trade, list(trade.fills))


@router.get("/{trade_id}")
def get_trade(trade_id: int, session: Session = Depends(get_session)):
    trade = session.get(Trade, trade_id)
    if not trade:
        raise HTTPException(404, "Trade not found")
    return trade_dict(trade, list(trade.fills))


@router.get("/{trade_id}/log")
def get_trade_log(trade_id: int, session: Session = Depends(get_session)):
    """Unified chronological trade log: fills + stop moves + swap / financing charges."""
    from src import position_watch, tz

    trade = session.get(Trade, trade_id)
    if not trade:
        raise HTTPException(404, "Trade not found")

    rows = []
    for f in sorted(trade.fills, key=lambda x: x.executed_at):
        rows.append({
            "at": tz.iso_utc(f.executed_at), "kind": f.kind, "group": "fill",
            "price": f.price, "lots": f.lots, "fee": f.fee, "note": f.note,
            "fill_id": f.id,
        })

    swap_total = 0.0
    for e in position_watch.events_for(session, trade.position_ids):
        row = {"at": tz.iso_utc(e.at), "kind": e.kind, "group": "event",
               "price": e.price, "prev_price": e.prev_price,
               "amount": e.amount, "note": e.note, "position_id": e.position_id}
        if e.kind == "swap" and e.amount:
            swap_total += e.amount
        rows.append(row)

    rows.sort(key=lambda r: r["at"] or "")
    return {
        "trade_id": trade_id,
        "rows": rows,
        "totals": {
            "fees": trade.fees_total,
            "swap": swap_total,
            "entries": len([r for r in rows if r["kind"] == "entry"]),
            "exits": len([r for r in rows if r["kind"] in ("tp", "sl", "close")]),
            "stop_moves": len([r for r in rows if r["kind"] == "stop_change"]),
        },
    }


@router.get("/{trade_id}/chart")
def get_trade_chart(trade_id: int, session: Session = Depends(get_session)):
    """Candles + entry/TP/SL levels + MAE/MFE/post-mortem analysis + econ-event overlay."""
    trade = session.get(Trade, trade_id)
    if not trade:
        raise HTTPException(404, "Trade not found")
    dec = marketdata.price_decimals(trade.symbol, trade.avg_entry)
    chart = build_chart(trade, list(trade.fills), decimals=dec, session=session)
    # cache excursion metrics onto the trade so aggregate dashboards read them cheaply
    persist_excursions(trade, chart.get("analysis", {}))
    session.add(trade)
    session.commit()

    # economic-calendar events within the chart window (medium+ impact, relevant currencies)
    chart["events"] = []
    try:
        from src import econ, settings_store
        candles = chart.get("candles") or []
        if candles and settings_store.load().get("econ_calendar", True):
            chart["events"] = econ.events(
                session, candles[0]["time"], candles[-1]["time"],
                currencies=econ.symbol_currencies(trade.symbol), min_impact="Medium",
            )
    except Exception:  # noqa: BLE001
        pass
    return chart


@router.put("/{trade_id}")
async def update_trade(trade_id: int, request: Request, session: Session = Depends(get_session)):
    trade = session.get(Trade, trade_id)
    if not trade:
        raise HTTPException(404, "Trade not found")
    data = await request.json()
    tag_option_ids = data.pop("tag_option_ids", None)
    for k, v in data.items():
        if k in WRITABLE:
            if k == "opened_at":
                v = parse_dt(v)
            setattr(trade, k, v)
    if tag_option_ids is not None:
        set_trade_tag_options(session, trade.id, tag_option_ids)
    session.flush()
    session.refresh(trade)
    recompute_trade(trade, _acc_balance(session, trade.account_id))
    session.add(trade)
    session.commit()
    session.refresh(trade)
    return trade_dict(trade, list(trade.fills))


@router.delete("/{trade_id}")
def delete_trade(trade_id: int, session: Session = Depends(get_session)):
    trade = session.get(Trade, trade_id)
    if not trade:
        raise HTTPException(404, "Trade not found")
    trade_ops.delete_trade(session, trade)   # fills cascade; tag links do not
    session.commit()
    return {"status": "deleted", "id": trade_id}


@router.post("/{trade_id}/fills")
async def add_fill(trade_id: int, request: Request, session: Session = Depends(get_session)):
    trade = session.get(Trade, trade_id)
    if not trade:
        raise HTTPException(404, "Trade not found")
    f = await request.json()
    fill = Fill(
        trade_id=trade_id,
        kind=f.get("kind", "entry"),
        price=float(f["price"]),
        lots=float(f["lots"]),
        executed_at=parse_dt(f.get("executed_at")) or trade.opened_at,
        fee=float(f.get("fee", 0) or 0),
        note=f.get("note"),
    )
    session.add(fill)
    session.flush()
    session.refresh(trade)
    recompute_trade(trade, _acc_balance(session, trade.account_id))
    session.add(trade)
    session.commit()
    session.refresh(trade)
    return trade_dict(trade, list(trade.fills))
