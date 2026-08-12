"""
Metrics engine.

Two layers:
  1. per-trade   -> derive avg entry / realized PnL / R / remaining from Fills.
  2. portfolio   -> KPIs, equity curve, daily PnL calendar, distributions.

Everything is pure and operates on already-loaded objects so it is easy to test.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from statistics import mean
from typing import Dict, Iterable, List, Optional

from src.models import Fill, Trade
from src import tz

EPS = 1e-9


def _sign(direction: str) -> float:
    return 1.0 if direction == "long" else -1.0


# --- per-trade ---------------------------------------------------------------

def compute_trade_metrics(trade: Trade, fills: List[Fill]) -> dict:
    """Return a dict of derived values for a trade given its fills."""
    entries = [f for f in fills if f.kind == "entry"]
    exits = [f for f in fills if f.kind in ("tp", "sl", "close")]

    total_entry_lots = sum(f.lots for f in entries)
    total_exit_lots = sum(f.lots for f in exits)
    cs = trade.contract_size or 1.0
    s = _sign(trade.direction)

    avg_entry = (
        sum(f.price * f.lots for f in entries) / total_entry_lots
        if total_entry_lots > EPS else None
    )
    avg_exit = (
        sum(f.price * f.lots for f in exits) / total_exit_lots
        if total_exit_lots > EPS else None
    )

    fees_total = sum(f.fee for f in fills)

    realized = 0.0
    if avg_entry is not None:
        for x in exits:
            realized += (x.price - avg_entry) * s * x.lots * cs
    realized -= fees_total

    remaining = round(total_entry_lots - total_exit_lots, 8)
    is_closed = total_entry_lots > EPS and remaining <= EPS
    status = "closed" if is_closed else "open"

    opened_at = min((f.executed_at for f in entries), default=trade.opened_at)
    closed_at = max((f.executed_at for f in exits), default=None) if is_closed else None

    # R multiple: net realized / initial planned risk.
    r_multiple = None
    if avg_entry is not None and trade.initial_stop:
        risk_per_lot = abs(avg_entry - trade.initial_stop) * cs
        risk_total = risk_per_lot * total_entry_lots
        if risk_total > EPS:
            r_multiple = realized / risk_total

    # Unrealized on the still-open remainder (needs a mark).
    unrealized = None
    if remaining > EPS and avg_entry is not None and trade.last_price is not None:
        unrealized = (trade.last_price - avg_entry) * s * remaining * cs

    duration_seconds = None
    if closed_at is not None and opened_at is not None:
        duration_seconds = (closed_at - opened_at).total_seconds()

    return {
        "avg_entry": avg_entry,
        "avg_exit": avg_exit,
        "total_entry_lots": round(total_entry_lots, 8),
        "total_exit_lots": round(total_exit_lots, 8),
        "remaining_lots": max(remaining, 0.0),
        "fees_total": fees_total,
        "realized_pnl": realized,
        "unrealized_pnl": unrealized,
        "r_multiple": r_multiple,
        "status": status,
        "opened_at": opened_at,
        "closed_at": closed_at,
        "duration_seconds": duration_seconds,
        "entry_count": len(entries),
        "exit_count": len(exits),
    }


def recompute_trade(trade: Trade, starting_balance: Optional[float] = None) -> Trade:
    """Recompute + write cached metrics onto the Trade in place. Call after any fill change."""
    fills = list(trade.fills)
    # synced trades carry no planned stop; if the trade was stopped out, use the
    # lots-weighted average of the SL fill prices (hotkey scale-ins often have a
    # different SL per position) so the R-multiple reflects the real risk.
    if trade.initial_stop is None:
        sls = [f for f in fills if f.kind == "sl"]
        if sls:
            sl_lots = sum(f.lots for f in sls)
            trade.initial_stop = (
                sum(f.price * f.lots for f in sls) / sl_lots if sl_lots > EPS
                else mean(f.price for f in sls)
            )
            trade.stop_is_avg = len({round(f.price, 8) for f in sls}) > 1
    # sessions are derived from the open time unless the user picked their own
    if not trade.sessions:
        from src import sessions as sess
        opened = min((f.executed_at for f in fills if f.kind == "entry"), default=trade.opened_at)
        trade.sessions = sess.normalise(trade.session) or sess.classify(opened)

    m = compute_trade_metrics(trade, fills)
    trade.avg_entry = m["avg_entry"]
    trade.total_entry_lots = m["total_entry_lots"]
    trade.total_exit_lots = m["total_exit_lots"]
    trade.remaining_lots = m["remaining_lots"]
    trade.fees_total = m["fees_total"]
    trade.realized_pnl = m["realized_pnl"]
    trade.r_multiple = m["r_multiple"]
    trade.status = m["status"]
    trade.closed_at = m["closed_at"]
    if m["opened_at"] is not None:
        trade.opened_at = m["opened_at"]
    if starting_balance:
        trade.return_pct = (m["realized_pnl"] / starting_balance) * 100.0
    trade.updated_at = datetime.utcnow()
    return trade


# --- portfolio ---------------------------------------------------------------

def _closed(trades: Iterable[Trade]) -> List[Trade]:
    return [t for t in trades if t.status == "closed"]


def summary_stats(trades: Iterable[Trade]) -> dict:
    """KPI block computed over the CLOSED trades in the list."""
    closed = sorted(_closed(trades), key=lambda t: t.closed_at or t.opened_at)
    n = len(closed)
    pnls = [t.realized_pnl for t in closed]
    wins = [p for p in pnls if p > EPS]
    losses = [p for p in pnls if p < -EPS]
    breakeven = n - len(wins) - len(losses)

    gross_profit = sum(wins)
    gross_loss = -sum(losses)  # positive number
    net_pnl = sum(pnls)
    total_fees = sum(t.fees_total for t in closed)

    profit_factor = (gross_profit / gross_loss) if gross_loss > EPS else None  # None => ∞
    win_rate = (len(wins) / n * 100.0) if n else 0.0
    avg_win = mean(wins) if wins else 0.0
    avg_loss = mean(losses) if losses else 0.0  # negative
    expectancy = (net_pnl / n) if n else 0.0
    rs = [t.r_multiple for t in closed if t.r_multiple is not None]
    avg_r = mean(rs) if rs else None
    total_r = sum(rs) if rs else 0.0

    # win / loss streaks
    max_win_streak = max_loss_streak = cur = 0
    last_sign = 0
    for p in pnls:
        s = 1 if p > EPS else (-1 if p < -EPS else 0)
        if s == 0:
            cur = 0
            last_sign = 0
            continue
        cur = cur + 1 if s == last_sign else 1
        last_sign = s
        if s > 0:
            max_win_streak = max(max_win_streak, cur)
        else:
            max_loss_streak = max(max_loss_streak, cur)

    durations = [
        (t.closed_at - t.opened_at).total_seconds()
        for t in closed if t.closed_at and t.opened_at
    ]
    avg_duration_hours = (mean(durations) / 3600.0) if durations else None

    decided = len(wins) + len(losses)
    win_rate_no_be = (len(wins) / decided * 100.0) if decided else 0.0

    trading_days = {tz.local_date(t.closed_at or t.opened_at) for t in closed}
    trading_weeks = {d.isocalendar()[:2] for d in trading_days}
    trades_per_day = (n / len(trading_days)) if trading_days else 0.0
    trades_per_week = (n / len(trading_weeks)) if trading_weeks else 0.0
    avg_r_per_day = (total_r / len(trading_days)) if trading_days else None

    # average planned reward:risk (from entry/stop/target)
    rrrs = []
    for t in closed:
        if t.avg_entry and t.initial_stop and t.initial_target:
            risk = abs(t.avg_entry - t.initial_stop)
            reward = abs(t.initial_target - t.avg_entry)
            if risk > EPS:
                rrrs.append(reward / risk)
    avg_planned_rrr = mean(rrrs) if rrrs else None

    # plan adherence (from playbook checklists)
    adhs = []
    for t in closed:
        cl = t.checklist or []
        if cl:
            adhs.append(sum(1 for c in cl if c.get("checked")) / len(cl))
    avg_adherence = (mean(adhs) * 100.0) if adhs else None

    daily = daily_pnl(closed)
    best_day = max(daily.items(), key=lambda kv: kv[1], default=(None, 0.0))
    worst_day = min(daily.items(), key=lambda kv: kv[1], default=(None, 0.0))

    max_dd, max_dd_pct = max_drawdown([p for p in pnls])

    return {
        "trade_count": n,
        "wins": len(wins),
        "losses": len(losses),
        "breakeven": breakeven,
        "net_pnl": net_pnl,
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "total_fees": total_fees,
        "profit_factor": profit_factor,
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "avg_win_loss_ratio": (avg_win / abs(avg_loss)) if avg_loss else None,
        "expectancy": expectancy,
        "avg_r": avg_r,
        "total_r": total_r,
        "largest_win": max(wins) if wins else 0.0,
        "largest_loss": min(losses) if losses else 0.0,
        "biggest_winner_r": max(rs) if rs else None,
        "biggest_loser_r": min(rs) if rs else None,
        "win_rate_no_be": win_rate_no_be,
        "trades_per_day": trades_per_day,
        "trades_per_week": trades_per_week,
        "avg_r_per_day": avg_r_per_day,
        "avg_planned_rrr": avg_planned_rrr,
        "avg_adherence": avg_adherence,
        "trading_days": len(trading_days),
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "avg_duration_hours": avg_duration_hours,
        "best_day": {"date": best_day[0], "pnl": best_day[1]},
        "worst_day": {"date": worst_day[0], "pnl": worst_day[1]},
        "max_drawdown": max_dd,
        "max_drawdown_pct": max_dd_pct,
    }


def equity_curve(trades: Iterable[Trade], starting_balance: float = 0.0) -> List[dict]:
    """Cumulative realized-PnL curve ordered by close time."""
    closed = sorted(_closed(trades), key=lambda t: t.closed_at or t.opened_at)
    out = []
    equity = starting_balance
    cum = 0.0
    cum_r = 0.0
    if closed:
        out.append({
            "t": tz.iso_utc(closed[0].closed_at or closed[0].opened_at),
            "equity": equity, "cum_pnl": 0.0, "cum_r": 0.0, "pnl": 0.0, "trade_id": None,
        })
    for t in closed:
        cum += t.realized_pnl
        equity += t.realized_pnl
        cum_r += t.r_multiple or 0.0
        out.append({
            "t": tz.iso_utc(t.closed_at or t.opened_at),
            "equity": equity,
            "cum_pnl": cum,
            "cum_r": cum_r,
            "pnl": t.realized_pnl,
            "r": t.r_multiple,
            "trade_id": t.id,
            "symbol": t.symbol,
        })
    return out


def daily_pnl(trades: Iterable[Trade]) -> Dict[str, float]:
    """Map YYYY-MM-DD -> realized PnL summed over trades closed that day."""
    out: Dict[str, float] = defaultdict(float)
    for t in _closed(trades):
        d = tz.local_date(t.closed_at or t.opened_at).isoformat()
        out[d] += t.realized_pnl
    return dict(out)


def calendar(trades: Iterable[Trade]) -> List[dict]:
    """Daily rows for the calendar heatmap: date, pnl, trade count."""
    counts: Dict[str, int] = defaultdict(int)
    for t in _closed(trades):
        d = tz.local_date(t.closed_at or t.opened_at).isoformat()
        counts[d] += 1
    pnl = daily_pnl(trades)
    return [
        {"date": d, "pnl": pnl[d], "trades": counts.get(d, 0)}
        for d in sorted(pnl.keys())
    ]


def distribution(trades: Iterable[Trade], key: str) -> List[dict]:
    """
    Aggregate closed trades by an attribute (`symbol`, `setup`, `session`,
    `account_id`, `dow`, `hour`). Returns net pnl / count / win rate per bucket.
    """
    buckets: Dict[str, List[Trade]] = defaultdict(list)
    for t in _closed(trades):
        if key == "session":
            # a trade can sit in several sessions (London/NY overlap) — count it in each
            for name in (t.sessions or ([t.session] if t.session else ["—"])):
                buckets[name].append(t)
            continue
        if key == "dow":
            k = tz.to_local(t.closed_at or t.opened_at).strftime("%a")
        elif key == "hour":
            k = tz.to_local(t.opened_at).strftime("%H:00")
        else:
            k = getattr(t, key, None)
            k = "—" if k in (None, "") else str(k)
        buckets[k].append(t)

    rows = []
    for k, group in buckets.items():
        pnls = [t.realized_pnl for t in group]
        wins = len([p for p in pnls if p > EPS])
        rows.append({
            "key": k,
            "net_pnl": sum(pnls),
            "trades": len(group),
            "win_rate": (wins / len(group) * 100.0) if group else 0.0,
        })
    rows.sort(key=lambda r: r["net_pnl"], reverse=True)
    return rows


def r_distribution(trades: Iterable[Trade]) -> List[dict]:
    """Histogram of R-multiples in 0.5R buckets."""
    buckets: Dict[float, int] = defaultdict(int)
    for t in _closed(trades):
        if t.r_multiple is None:
            continue
        b = round(t.r_multiple * 2) / 2.0  # snap to nearest 0.5
        buckets[b] += 1
    return [{"r": k, "count": v} for k, v in sorted(buckets.items())]


def max_drawdown(pnl_sequence: List[float]) -> tuple[float, Optional[float]]:
    """Max peak-to-trough drop of the cumulative curve. Returns (abs, pct-of-peak)."""
    peak = 0.0
    cum = 0.0
    max_dd = 0.0
    peak_at_max_dd = 0.0
    for p in pnl_sequence:
        cum += p
        peak = max(peak, cum)
        dd = peak - cum
        if dd > max_dd:
            max_dd = dd
            peak_at_max_dd = peak
    pct = (max_dd / peak_at_max_dd * 100.0) if peak_at_max_dd > EPS else None
    return max_dd, pct
