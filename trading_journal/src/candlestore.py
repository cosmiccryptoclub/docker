"""
Local candle store — persist OHLC so trades keep real candles forever.

Providers expire intraday history (Yahoo 1m ~30d, 5m ~60d; Binance keeps years).
`get_candles` serves from the DB when the requested window has already been fetched
(recorded in CandleFetch), otherwise it fetches from the provider, stores the bars,
records the coverage, and returns them. So the first time a trade's chart is built
(on view or during backfill), its candles are captured permanently.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Tuple

from sqlmodel import Session, select

from src import eventlog, marketdata
from src.models import Candle, CandleFetch


def _covered(session: Session, symbol: str, interval: int, start_s: int, end_s: int,
             source: Optional[str] = None) -> Optional[CandleFetch]:
    stmt = select(CandleFetch).where(
        CandleFetch.symbol == symbol,
        CandleFetch.interval == interval,
        CandleFetch.start <= start_s,
        CandleFetch.end >= end_s,
    )
    if source:
        stmt = stmt.where(CandleFetch.source == source)
    return session.exec(stmt).first()


def _read(session: Session, symbol: str, interval: int, start_s: int, end_s: int) -> List[dict]:
    rows = session.exec(
        select(Candle).where(
            Candle.symbol == symbol,
            Candle.interval == interval,
            Candle.time >= start_s,
            Candle.time <= end_s,
        ).order_by(Candle.time)
    ).all()
    return [{"time": r.time, "open": r.open, "high": r.high, "low": r.low, "close": r.close} for r in rows]


def _store(session: Session, symbol: str, interval: int, bars: List[dict], source: str) -> None:
    if not bars:
        return
    lo, hi = bars[0]["time"], bars[-1]["time"]
    existing = set(session.exec(
        select(Candle.time).where(
            Candle.symbol == symbol, Candle.interval == interval,
            Candle.time >= lo, Candle.time <= hi,
        )
    ).all())
    for b in bars:
        if b["time"] not in existing:
            session.add(Candle(symbol=symbol, interval=interval, time=b["time"],
                               open=b["open"], high=b["high"], low=b["low"], close=b["close"], source=source))
    session.commit()


def _replace_window(session: Session, symbol: str, interval: int, start_s: int, end_s: int,
                    bars: List[dict], source: str) -> None:
    """Authoritatively replace a window's candles (e.g. broker-exact cTrader trendbars):
    delete overlapping candles + coverage rows, insert the new bars, record one coverage row."""
    for c in session.exec(select(Candle).where(
        Candle.symbol == symbol, Candle.interval == interval,
        Candle.time >= start_s, Candle.time <= end_s,
    )).all():
        session.delete(c)
    for cf in session.exec(select(CandleFetch).where(
        CandleFetch.symbol == symbol, CandleFetch.interval == interval,
        CandleFetch.start <= end_s, CandleFetch.end >= start_s,   # overlapping windows
    )).all():
        session.delete(cf)
    for b in bars:
        session.add(Candle(symbol=symbol, interval=interval, time=b["time"],
                           open=b["open"], high=b["high"], low=b["low"], close=b["close"], source=source))
    session.add(CandleFetch(symbol=symbol, interval=interval, start=start_s, end=end_s,
                            source=source, fetched_at=datetime.utcnow()))
    session.commit()


def _bars_consistent(bars: List[dict], prices: List[float]) -> bool:
    """Guard: only trust replacement candles if the trade's fills fall within their range."""
    if not bars or not prices:
        return False
    lo = min(b["low"] for b in bars)
    hi = max(b["high"] for b in bars)
    span = (hi - lo) or 1.0
    return all(lo - 0.15 * span <= p <= hi + 0.15 * span for p in prices)


def refresh_trendbars(session: Session, trades: list, force: bool = False) -> dict:
    """Fetch broker-exact cTrader trendbars for eligible trades and replace their stored
    candles. Opt-in + best-effort: needs a configured connector; anything that fails or looks
    inconsistent is skipped, leaving the Yahoo/Binance candles untouched."""
    from src.candles import chart_window
    from src.connectors.ctrader import CTraderConnector, TRENDBAR_PERIOD
    from src.models import Account

    connector = CTraderConnector()
    if not connector.is_configured():
        return {"stored": 0, "reason": "cTrader not configured"}

    accounts = {a.id: a for a in session.exec(select(Account)).all()}
    by_ctid: dict = {}
    for t in trades:
        if t.status != "closed" or not t.external_id or not t.fills:
            continue
        acc = accounts.get(t.account_id)
        if not acc or not acc.external_id:
            continue
        start_ms, end_ms, isec, iname = chart_window(list(t.fills), t.closed_at)
        if isec not in TRENDBAR_PERIOD:
            continue
        start_s, end_s = start_ms // 1000, end_ms // 1000
        if not force and _covered(session, t.symbol, isec, start_s, end_s, source="ctrader"):
            continue
        by_ctid.setdefault(str(acc.external_id), []).append(
            {"symbol": t.symbol, "interval_sec": isec, "from_ms": start_ms, "to_ms": end_ms,
             "_t": t, "_s": start_s, "_e": end_s})

    stored = 0
    for ctid, items in by_ctid.items():
        reqs = [{k: it[k] for k in ("symbol", "interval_sec", "from_ms", "to_ms")} for it in items]
        try:
            results = connector.fetch_trendbars(ctid, reqs) or []
        except Exception as e:  # noqa: BLE001
            eventlog.warning("trendbars", f"{ctid} failed: {e}")
            continue
        for it, bars in zip(items, results):
            t = it["_t"]
            if bars and _bars_consistent(bars, [f.price for f in t.fills]):
                _replace_window(session, t.symbol, it["interval_sec"], it["_s"], it["_e"], bars, "ctrader")
                stored += 1
    if stored:
        eventlog.info("trendbars", f"stored broker-exact candles for {stored} trades")
    return {"stored": stored}


def get_candles(session: Session, symbol: str, interval_sec: int, interval_name: str,
                start_ms: int, end_ms: int) -> Tuple[Optional[List[dict]], Optional[str], bool]:
    """Return (candles, source, fetched_from_network) — store first, else fetch + store."""
    start_s, end_s = start_ms // 1000, end_ms // 1000

    cov = _covered(session, symbol, interval_sec, start_s, end_s)
    if cov:
        return _read(session, symbol, interval_sec, start_s, end_s), cov.source, False

    # fetch from the right provider
    if marketdata.supported(symbol):
        bars, source = marketdata.fetch_klines(symbol, interval_name, start_ms, end_ms), "binance"
    elif marketdata.yahoo_symbol(symbol):
        bars, source = marketdata.fetch_yahoo(symbol, interval_sec, start_ms, end_ms), "yahoo"
    else:
        return None, None, False

    if not bars:
        # nothing live (e.g. provider expired the window); serve whatever we already have
        stored = _read(session, symbol, interval_sec, start_s, end_s)
        return (stored or None), (stored and "store" or None), False

    _store(session, symbol, interval_sec, bars, source)
    session.add(CandleFetch(symbol=symbol, interval=interval_sec, start=start_s, end=end_s,
                            source=source, fetched_at=datetime.utcnow()))
    session.commit()
    return bars, source, True


def _dec_for(symbol: str, price=None) -> int:
    return marketdata.price_decimals(symbol, price)


def collect_pending(session: Session, limit: Optional[int] = None, throttle: float = 0.3,
                    force: bool = False) -> dict:
    """Store real candles for closed real trades that haven't been captured yet.

    Marks each trade `candles_stored=True` afterwards so it isn't reprocessed. Runs
    from the background collector (all the time) and right after each auto-sync, so
    every new trade's candles are captured while the provider still has them.
    """
    import time as _time
    from sqlalchemy import or_

    from src.candles import build_chart, persist_excursions
    from src.models import Trade

    stmt = select(Trade).where(Trade.status == "closed", Trade.external_id.is_not(None))
    if not force:
        stmt = stmt.where(or_(Trade.candles_stored == False, Trade.candles_stored.is_(None)))  # noqa: E712
    stmt = stmt.order_by(Trade.closed_at.desc())   # newest first — grab fresh windows before they expire
    if limit:
        stmt = stmt.limit(limit)
    trades = session.exec(stmt).all()

    # prefer broker-exact cTrader trendbars when opted in (populates the store first)
    from src import settings_store
    if settings_store.load().get("ctrader_trendbars"):
        try:
            refresh_trendbars(session, trades, force=force)
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  [candles] trendbar refresh failed: {e}")

    done = real = 0
    for t in trades:
        try:
            chart = build_chart(t, list(t.fills), decimals=_dec_for(t.symbol, t.avg_entry), session=session)
            persist_excursions(t, chart.get("analysis", {}))
            t.candles_stored = True
            session.add(t)
            session.commit()
            done += 1
            if chart.get("analysis", {}).get("fetched"):   # only when we actually hit the network
                real += 1
                _time.sleep(throttle)   # be gentle on the provider
        except Exception as e:  # noqa: BLE001
            session.rollback()
            eventlog.warning("candles", f"trade {t.id} failed: {e}")
    if done:
        eventlog.info("candles", f"processed {done} trades ({real} fetched from Binance/Yahoo)")
    return {"processed": done, "real": real}


def stored_stats(session: Session) -> dict:
    from sqlalchemy import func

    from src.models import Trade
    total = session.exec(select(func.count()).select_from(Candle)).one()
    symbols = session.exec(select(func.count(func.distinct(Candle.symbol)))).one()
    trendbars = session.exec(select(func.count()).select_from(Candle).where(Candle.source == "ctrader")).one()
    pending = session.exec(
        select(func.count()).select_from(Trade).where(
            Trade.status == "closed", Trade.external_id.is_not(None),
            (Trade.candles_stored == False) | (Trade.candles_stored.is_(None)),  # noqa: E712
        )
    ).one()
    return {"candles": int(total or 0), "symbols": int(symbols or 0),
            "trendbar_candles": int(trendbars or 0), "pending_trades": int(pending or 0)}
