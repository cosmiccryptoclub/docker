"""
Candle + per-trade excursion analysis.

Candle source, in order:
  1. REAL Binance klines — for supported symbols (BTC/ETH) on real trades
     (those with an external_id from sync/import) whose fill prices line up with
     the market. 1-minute for scalps, auto-coarsening for swing trades.
  2. SYNTHETIC — candles generated through the actual fills, for dummy/test data
     or unsupported symbols, so the chart + metrics stay self-consistent.

Everything downstream (MAE, MFE, capture %, post-mortem) is derived from whatever
candles it gets, so switching a trade to real data needs no other changes.
"""
from __future__ import annotations

import random
from datetime import timedelta
from typing import List, Optional

from src import marketdata

EPS = 1e-9
NICE_TF = (60, 180, 300, 900, 1800, 3600, 7200, 14400, 86400)


def _nice_interval(span_seconds: float) -> int:
    target = max(60.0, span_seconds / 120.0)
    for tf in NICE_TF:
        if tf >= target:
            return tf
    return 86400


def _avg(fills) -> float:
    lots = sum(f.lots for f in fills)
    return sum(f.price * f.lots for f in fills) / lots if lots > EPS else (fills[0].price if fills else 0.0)


def chart_window(fills, closed_at):
    """The candle window + interval build_chart uses, so collectors match its store keys.
    Returns (start_ms, end_ms, interval_seconds, interval_name). Keep in sync with build_chart."""
    fills = sorted(fills, key=lambda f: f.executed_at)
    open_t = fills[0].executed_at
    close_t = closed_at or fills[-1].executed_at
    dur = max((close_t - open_t).total_seconds(), 60.0)
    start = open_t - timedelta(seconds=dur * 0.4)
    end = close_t + timedelta(seconds=dur)
    span = (end - start).total_seconds()
    iname, isec = marketdata.pick_interval(span)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000), isec, iname


def _prices_consistent(candles: List[dict], prices: List[float]) -> bool:
    """Guard: real candles only apply if the fills fall within the candle range."""
    lo = min(c["low"] for c in candles)
    hi = max(c["high"] for c in candles)
    span = (hi - lo) or 1.0
    return all(lo - 0.15 * span <= p <= hi + 0.15 * span for p in prices)


def _synthetic_candles(trade, fills, avg_entry, sign, close_t, start, span, risk_dist, prices, decimals):
    interval = _nice_interval(span)
    n = min(int(span / interval) + 2, 1500)
    sigma = max(risk_dist * 0.09, (max(prices) - min(prices)) / max(len(prices), 1) * 0.6, avg_entry * 0.0006)
    anchors = [(f.executed_at, f.price) for f in fills]

    def anchor_price(t):
        if t <= anchors[0][0]:
            return anchors[0][1]
        if t >= anchors[-1][0]:
            return None
        for i in range(1, len(anchors)):
            if t <= anchors[i][0]:
                t0, p0 = anchors[i - 1]
                t1, p1 = anchors[i]
                frac = (t - t0).total_seconds() / max((t1 - t0).total_seconds(), 1)
                return p0 + (p1 - p0) * frac
        return anchors[-1][1]

    rng = random.Random(trade.id or 1)
    post_fav = rng.random() < 0.5
    candles: List[dict] = []
    prev_close = anchors[0][1]
    for i in range(n):
        t = start + timedelta(seconds=i * interval)
        base = anchor_price(t)
        if base is None:
            drift = (sign if post_fav else -sign) * sigma * 0.09 if t > close_t else 0.0
            close = prev_close + rng.gauss(0, sigma * 0.6) + drift
        else:
            close = base + rng.gauss(0, sigma * 0.5)
        openp = prev_close
        hi = max(openp, close) + abs(rng.gauss(0, sigma * 0.4))
        lo = min(openp, close) - abs(rng.gauss(0, sigma * 0.4))
        candles.append({
            "time": int(t.timestamp()), "open": round(openp, decimals),
            "high": round(hi, decimals), "low": round(lo, decimals), "close": round(close, decimals),
        })
        prev_close = close
    return candles, interval


def build_chart(trade, fills, decimals: int = 2, allow_real: bool = True, session=None) -> dict:
    fills = sorted(fills, key=lambda f: f.executed_at)
    if not fills:
        return {"candles": [], "levels": {}, "analysis": {}, "interval": 0}

    entries = [f for f in fills if f.kind == "entry"]
    exits = [f for f in fills if f.kind in ("tp", "sl", "close")]
    sign = 1.0 if trade.direction == "long" else -1.0
    cs = trade.contract_size or 1.0
    avg_entry = trade.avg_entry or (_avg(entries) if entries else fills[0].price)
    total_entry_lots = trade.total_entry_lots or sum(f.lots for f in entries) or 1.0
    total_exit_lots = sum(f.lots for f in exits) or total_entry_lots
    avg_exit = _avg(exits) if exits else None

    open_t = fills[0].executed_at
    close_t = trade.closed_at or fills[-1].executed_at
    dur = max((close_t - open_t).total_seconds(), 60.0)
    post = dur
    start = open_t - timedelta(seconds=dur * 0.4)
    end = close_t + timedelta(seconds=post)
    span = (end - start).total_seconds()

    prices = [f.price for f in fills]
    stop = trade.initial_stop
    risk_dist = abs(avg_entry - stop) if stop else max((max(prices) - min(prices)), avg_entry * 0.004)

    # 1) real candles for real (synced/imported) trades: Binance for crypto,
    #    Yahoo Finance for indices / metals / forex / energy.
    source = "synthetic"
    fetched = False
    candles: Optional[List[dict]] = None
    interval = 0
    if allow_real and trade.external_id and session is not None:
        from src import candlestore
        start_ms, end_ms, isec, iname = chart_window(fills, trade.closed_at)
        real, src, fetched = candlestore.get_candles(session, trade.symbol, isec, iname, start_ms, end_ms)
        if real and _prices_consistent(real, prices):
            candles, interval, source = real, isec, src or "store"
        else:
            fetched = False

    # 2) synthetic fallback
    if candles is None:
        candles, interval = _synthetic_candles(trade, fills, avg_entry, sign, close_t, start, span, risk_dist, prices, decimals)

    # --- excursions over the in-trade window --------------------------------
    o_ts, c_ts = int(open_t.timestamp()), int(close_t.timestamp())
    in_win = [b for b in candles if o_ts <= b["time"] <= c_ts] or candles
    hi = max(b["high"] for b in in_win)
    lo = min(b["low"] for b in in_win)
    if sign > 0:
        mfe_dist, mae_dist = max(hi - avg_entry, 0.0), max(avg_entry - lo, 0.0)
        mfe_price, mae_price = hi, lo
    else:
        mfe_dist, mae_dist = max(avg_entry - lo, 0.0), max(hi - avg_entry, 0.0)
        mfe_price, mae_price = lo, hi

    mfe_dollar = mfe_dist * total_entry_lots * cs
    mae_dollar = mae_dist * total_entry_lots * cs
    realized = trade.realized_pnl or 0.0
    captured_pct = (realized / mfe_dollar * 100.0) if (mfe_dollar > EPS and realized > 0) else None
    mfe_r = (mfe_dist / risk_dist) if risk_dist > EPS else None
    mae_r = (mae_dist / risk_dist) if risk_dist > EPS else None

    # --- post-mortem --------------------------------------------------------
    post_bars = [b for b in candles if b["time"] >= c_ts]
    post_mortem = None
    if exits and avg_exit is not None and post_bars:
        if sign > 0:
            ext = max(b["high"] for b in post_bars)
            rev = min(b["low"] for b in post_bars)
        else:
            ext = min(b["low"] for b in post_bars)
            rev = max(b["high"] for b in post_bars)
        fav_dist = max((ext - avg_exit) * sign, 0.0)
        adverse_after = max((avg_exit - rev) * sign, 0.0)
        left = fav_dist * total_exit_lots * cs
        left_r = (fav_dist / risk_dist) if risk_dist > EPS else None
        if adverse_after >= fav_dist and adverse_after > 0.25 * risk_dist:
            verdict = "good exit — price reversed"
        elif left_r is not None and left_r > 0.5:
            verdict = "left money on the table"
        else:
            verdict = "roughly fair exit"
        post_mortem = {
            "window_seconds": post, "extension_price": round(ext, decimals),
            "left_on_table": left, "left_on_table_r": left_r,
            "reversed_after": adverse_after > fav_dist, "verdict": verdict,
        }

    analysis = {
        "avg_entry": avg_entry, "avg_exit": avg_exit, "risk_distance": risk_dist,
        "mae_price": round(mae_price, decimals), "mae_distance": mae_dist, "mae_dollar": mae_dollar, "mae_r": mae_r,
        "mfe_price": round(mfe_price, decimals), "mfe_distance": mfe_dist, "mfe_dollar": mfe_dollar, "mfe_r": mfe_r,
        "realized_pnl": realized, "captured_pct": captured_pct, "r_multiple": trade.r_multiple,
        "post_mortem": post_mortem,
        "source": source, "synthetic": source == "synthetic", "fetched": fetched,
    }

    # the plotted stop is a lots-weighted average when the scale-ins had different stops
    # (recorded on the trade at sync/recompute time); fall back to inspecting SL fills.
    if trade.stop_is_avg is not None:
        stop_is_avg = bool(trade.stop_is_avg)
    else:
        sl_prices = {round(f.price, 10) for f in fills if f.kind == "sl"}
        stop_is_avg = bool(
            trade.initial_stop is not None and len(sl_prices) > 1
            and min(sl_prices) <= trade.initial_stop <= max(sl_prices)
        )

    levels = {
        "avg_entry": avg_entry, "initial_stop": trade.initial_stop,
        "stop_is_avg": stop_is_avg,
        "open_time": int(open_t.timestamp()),
        "close_time": int(close_t.timestamp()) if trade.closed_at else None,
        "entries": [{"time": int(f.executed_at.timestamp()), "price": f.price, "lots": f.lots} for f in entries],
        "tps": [{"time": int(f.executed_at.timestamp()), "price": f.price, "lots": f.lots, "note": f.note} for f in fills if f.kind == "tp"],
        "sls": [{"time": int(f.executed_at.timestamp()), "price": f.price, "lots": f.lots} for f in fills if f.kind == "sl"],
        "closes": [{"time": int(f.executed_at.timestamp()), "price": f.price, "lots": f.lots} for f in fills if f.kind == "close"],
        "planned_targets": trade.planned_targets or [],
    }

    return {"candles": candles, "levels": levels, "analysis": analysis,
            "interval": interval, "decimals": decimals}


def persist_excursions(trade, analysis: dict) -> None:
    """Write the excursion metrics onto the Trade so aggregates read them cheaply."""
    if not analysis:
        return
    trade.mfe_r = analysis.get("mfe_r")
    trade.mae_r = analysis.get("mae_r")
    trade.mfe_dollar = analysis.get("mfe_dollar")
    trade.mae_dollar = analysis.get("mae_dollar")
    trade.captured_pct = analysis.get("captured_pct")
    pm = analysis.get("post_mortem") or {}
    trade.left_on_table_r = pm.get("left_on_table_r")
    trade.analysis_source = analysis.get("source")
