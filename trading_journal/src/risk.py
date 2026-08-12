"""
Prop-firm risk rules.

Given an account + its trades, compute status vs the account's limits:
  * daily loss   - today's realized + floating PnL vs daily_loss_limit
  * max loss     - overall drawdown (from start, or trailing peak) vs max_loss_limit
  * profit target- net PnL progress vs profit_target

Floating (open) PnL here uses each open trade's last_price (no network) so this
stays fast for the accounts list; the live dashboard strip shows real-time PnL.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from src.models import Account, Trade
from src import tz

EPS = 1e-9


def _open_unrealized(trades: List[Trade]) -> float:
    total = 0.0
    for t in trades:
        if t.status == "open" and t.remaining_lots > EPS and t.avg_entry and t.last_price:
            sign = 1.0 if t.direction == "long" else -1.0
            total += (t.last_price - t.avg_entry) * sign * t.remaining_lots * (t.contract_size or 1.0)
    return total


def _rule(limit: Optional[float], used: float, warn_frac: float = 0.8) -> Optional[dict]:
    if not limit:
        return None
    used = max(used, 0.0)
    status = "breach" if used >= limit else ("warning" if used >= warn_frac * limit else "ok")
    return {
        "limit": limit, "used": used, "remaining": limit - used,
        "pct": min(used / limit * 100.0, 100.0), "status": status,
    }


def compute_account_risk(account: Account, trades: List[Trade], warn_frac: Optional[float] = None) -> Optional[dict]:
    has_rules = any([account.daily_loss_limit, account.max_loss_limit, account.profit_target])
    if not has_rules:
        return None

    if warn_frac is None:
        from src import settings_store
        warn_frac = max(0.0, min(settings_store.load().get("alert_warning_pct", 80) / 100.0, 1.0))

    closed = [t for t in trades if t.status == "closed"]
    net = sum(t.realized_pnl for t in closed)
    opu = _open_unrealized(trades)

    today = tz.local_today()
    today_real = sum(t.realized_pnl for t in closed if tz.local_date(t.closed_at or t.opened_at) == today)
    today_pnl = today_real + opu

    equity = account.starting_balance + net + opu

    # running peak equity for trailing drawdown
    cur = account.starting_balance
    peak = cur
    for t in sorted(closed, key=lambda x: x.closed_at or x.opened_at):
        cur += t.realized_pnl
        peak = max(peak, cur)
    peak = max(peak, equity)

    daily_used = -today_pnl if today_pnl < 0 else 0.0
    max_used = (peak - equity) if account.trailing_dd else (account.starting_balance - equity)

    daily = _rule(account.daily_loss_limit, daily_used, warn_frac)
    max_loss = _rule(account.max_loss_limit, max(max_used, 0.0), warn_frac)

    profit = None
    if account.profit_target:
        profit = {
            "target": account.profit_target, "progress": net,
            "pct": min(max(net / account.profit_target * 100.0, 0.0), 100.0),
            "reached": net >= account.profit_target,
        }

    statuses = [r["status"] for r in (daily, max_loss) if r]
    overall = "breach" if "breach" in statuses else ("warning" if "warning" in statuses else "ok")

    return {
        "status": overall, "daily": daily, "max_loss": max_loss, "profit": profit,
        "today_pnl": today_pnl, "open_unrealized": opu, "equity": equity,
        "trailing_dd": account.trailing_dd,
    }
