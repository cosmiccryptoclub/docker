"""Live spot price + real-time unrealized PnL / margin / equity on open positions."""
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from src import marketdata
from src import tz
from src.db import get_session
from src.models import Account, Trade
from src.risk import compute_account_risk

router = APIRouter(prefix="/api/live", tags=["live"])

# short-lived cache of the cTrader reconcile snapshot (heavy call) per ctid
_SNAP_TTL = 20.0
_snap_cache: dict = {}


@router.get("/prices")
def prices(symbols: str = "BTCUSD,ETHUSD"):
    out = {}
    for s in symbols.split(","):
        s = s.strip()
        if s:
            out[s] = marketdata.get_price(s)
    return out


@router.get("/open")
def open_positions(account_id: Optional[int] = None, session: Session = Depends(get_session)):
    """Open trades with live unrealized PnL on the remaining size."""
    stmt = select(Trade).where(Trade.status == "open")
    if account_id:
        stmt = stmt.where(Trade.account_id == account_id)
    trades = session.exec(stmt).all()

    price_cache: dict = {}
    positions = []
    total = 0.0
    have_live = False
    for t in trades:
        if t.remaining_lots <= 1e-9 or t.avg_entry is None:
            continue
        # only mark against the real market for real (synced/imported) trades;
        # dummy trades have fictional prices, so fall back to their last_price.
        is_real = t.external_id is not None
        price = None
        if is_real:
            if t.symbol not in price_cache:
                price_cache[t.symbol] = marketdata.get_price(t.symbol)
            price = price_cache[t.symbol]
        live = price is not None
        mark = price if live else t.last_price
        if mark is None:
            continue
        have_live = have_live or live
        sign = 1.0 if t.direction == "long" else -1.0
        upnl = (mark - t.avg_entry) * sign * t.remaining_lots * (t.contract_size or 1.0)
        total += upnl
        positions.append({
            "trade_id": t.id, "symbol": t.symbol, "direction": t.direction,
            "remaining_lots": t.remaining_lots, "avg_entry": t.avg_entry,
            "mark": mark, "live": live, "unrealized": upnl, "account_id": t.account_id,
        })
    positions.sort(key=lambda p: p["unrealized"])
    return {"total_unrealized": total, "count": len(positions), "has_live": have_live, "positions": positions}


def _price(symbol: str, cache: dict):
    if symbol not in cache:
        cache[symbol] = marketdata.get_price(symbol)
    return cache[symbol]


def _ctrader_snapshot(ctid: str, fresh: bool = False):
    """Cached cTrader reconcile snapshot (positions + used margin + balance)."""
    from src.connectors.ctrader import CTraderConnector
    now = time.time()
    hit = _snap_cache.get(ctid)
    if hit and not fresh and now - hit[0] < _SNAP_TTL:
        return hit[1]
    try:
        snap = CTraderConnector().fetch_account_snapshot(ctid)
        _snap_cache[ctid] = (now, snap)
        return snap
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  [live] cTrader snapshot for {ctid} failed: {e}")
        return None


def _account_snapshot(session: Session, acc: Account, price_cache: dict, fresh: bool) -> dict:
    """FTMO-style live snapshot: balance, equity, floating PnL, used/free margin, level."""
    from src.connectors.ctrader import CTraderConnector

    all_trades = session.exec(select(Trade).where(Trade.account_id == acc.id)).all()
    realized = sum(t.realized_pnl for t in all_trades if t.status == "closed")
    lev = acc.leverage or 0

    snap = None
    if acc.external_id and CTraderConnector().is_configured():
        snap = _ctrader_snapshot(str(acc.external_id), fresh=fresh)

    positions = []
    if snap:                                   # broker truth: exact positions, margin, balance
        source = "ctrader"
        balance = snap["balance"]
        used_margin = snap["used_margin"]
        for p in snap["positions"]:
            price = _price(p["symbol"], price_cache)
            sign = 1.0 if p["direction"] == "long" else -1.0
            mark = price if price is not None else p["entry"]
            upnl = (mark - p["entry"]) * sign * p["lots"] + (p.get("swap", 0) or 0)
            positions.append({
                "symbol": p["symbol"], "direction": p["direction"], "lots": p["lots"],
                "entry": p["entry"], "mark": mark, "live": price is not None,
                "unrealized": upnl, "margin": p["used_margin"], "swap": p.get("swap", 0),
            })
    else:                                      # local fallback: DB open trades + est. margin
        source = "local"
        balance = acc.starting_balance + realized
        used_margin = 0.0
        for t in all_trades:
            if t.status != "open" or t.remaining_lots <= 1e-9 or t.avg_entry is None:
                continue
            cs = t.contract_size or 1.0
            price = _price(t.symbol, price_cache) if t.external_id else None
            mark = price if price is not None else t.last_price
            if mark is None:
                continue
            sign = 1.0 if t.direction == "long" else -1.0
            upnl = (mark - t.avg_entry) * sign * t.remaining_lots * cs
            notional = t.avg_entry * t.remaining_lots * cs
            margin = notional / lev if lev else notional
            used_margin += margin
            positions.append({
                "symbol": t.symbol, "direction": t.direction, "lots": t.remaining_lots,
                "entry": t.avg_entry, "mark": mark, "live": price is not None,
                "unrealized": upnl, "margin": margin, "swap": 0.0, "trade_id": t.id,
            })

    floating = sum(p["unrealized"] for p in positions)
    equity = balance + floating
    free_margin = equity - used_margin
    margin_level = (equity / used_margin * 100.0) if used_margin > 1e-9 else None
    positions.sort(key=lambda p: p["unrealized"])

    risk = compute_account_risk(acc, all_trades)
    return {
        "account_id": acc.id, "name": acc.name, "color": acc.color, "currency": acc.currency,
        "source": source, "balance": balance, "realized_pnl": realized,
        "floating_pnl": floating, "equity": equity,
        "used_margin": used_margin, "free_margin": free_margin, "margin_level": margin_level,
        "open_count": len(positions), "leverage": lev, "positions": positions,
        "risk": risk,
    }


@router.get("/account")
def account_snapshot(account_id: Optional[int] = None, fresh: bool = False,
                     session: Session = Depends(get_session)):
    """Live FTMO-style snapshot for one account (or all non-backtest accounts aggregated)."""
    if account_id:
        accts = [a for a in [session.get(Account, account_id)] if a]
    else:
        accts = [a for a in session.exec(select(Account)).all() if not a.is_backtest]

    price_cache: dict = {}
    rows = [_account_snapshot(session, a, price_cache, fresh) for a in accts]

    totals = {
        "balance": sum(r["balance"] for r in rows),
        "equity": sum(r["equity"] for r in rows),
        "floating_pnl": sum(r["floating_pnl"] for r in rows),
        "used_margin": sum(r["used_margin"] for r in rows),
        "free_margin": sum(r["free_margin"] for r in rows),
        "open_count": sum(r["open_count"] for r in rows),
    }
    any_ct = any(r["source"] == "ctrader" for r in rows)
    return {"accounts": rows, "totals": totals, "source": "ctrader" if any_ct else "local",
            "as_of": tz.iso_utc(datetime.utcnow())}
