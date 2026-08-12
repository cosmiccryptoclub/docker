"""
Discord notifications — rich embeds for prop-rule alerts, targets and daily summaries.

Every builder returns a Discord *embed* dict rather than a string, so alerts render as
coloured cards with fields instead of a wall of bullet points. `send_discord` still
accepts a plain string for anything simple.
"""
from __future__ import annotations

from typing import List, Optional

import httpx

from src import tz
from src.models import Account
from src.risk import compute_account_risk

USERNAME = "Trade Journal"

# embed accent colours
RED = 0xEA3943
AMBER = 0xF59E0B
GREEN = 0x16C784
BLUE = 0x3B82F6
SLATE = 0x64748B


def _money(v) -> str:
    if v is None:
        return "—"
    return f"{'-' if v < 0 else ''}${abs(v):,.2f}"


def _money0(v) -> str:
    if v is None:
        return "—"
    return f"{'-' if v < 0 else ''}${abs(v):,.0f}"


def _bar(pct: Optional[float], width: int = 12) -> str:
    """Text progress bar — Discord embeds have no native meter."""
    if pct is None:
        return ""
    filled = max(0, min(int(round(pct / 100 * width)), width))
    return "█" * filled + "░" * (width - filled)


def _field(name: str, value: str, inline: bool = True) -> dict:
    return {"name": name, "value": value or "—", "inline": inline}


def send_discord(webhook: str, content=None, embeds: Optional[List[dict]] = None) -> bool:
    """Post to a Discord webhook. `content` may be a string, an embed dict, or None."""
    if not webhook:
        return False
    payload: dict = {"username": USERNAME}
    if isinstance(content, dict):          # a single embed passed positionally
        embeds = [content] + list(embeds or [])
        content = None
    if content:
        payload["content"] = content
    if embeds:
        payload["embeds"] = embeds[:10]    # Discord caps at 10
    if not payload.get("content") and not payload.get("embeds"):
        return False
    try:
        r = httpx.post(webhook, json=payload, timeout=10.0)
        if r.status_code >= 300:
            print(f"⚠️  Discord returned {r.status_code}: {r.text[:200]}")
        return r.status_code < 300
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  Discord post failed: {e}")
        return False


def _rule_field(label: str, rule: Optional[dict]) -> Optional[dict]:
    if not rule:
        return None
    pct = rule.get("pct")
    return _field(
        f"{label}",
        f"`{_bar(pct)}` **{pct:.0f}%**\n{_money0(rule['used'])} of {_money0(rule['limit'])}"
        f"\n{_money0(rule['remaining'])} left",
    )


def prop_alert_embed(account: Account, risk: dict) -> dict:
    status = risk["status"]
    breach = status == "breach"
    fields = [f for f in (
        _rule_field("Daily loss", risk.get("daily")),
        _rule_field("Max drawdown", risk.get("max_loss")),
    ) if f]
    fields.append(_field("Today's P&L", _money(risk.get("today_pnl"))))
    fields.append(_field("Equity", _money(risk.get("equity"))))
    if risk.get("open_unrealized"):
        fields.append(_field("Floating", _money(risk["open_unrealized"])))
    return {
        "title": f"{'🚨 Rule BREACHED' if breach else '⚠️ Approaching limit'} — {account.name}",
        "description": ("A prop rule has been breached. Stop trading this account."
                        if breach else "You're close to a prop-firm limit."),
        "color": RED if breach else AMBER,
        "fields": fields,
        "footer": {"text": f"{account.prop_firm or account.broker} · {account.account_type}"},
    }


def target_reached_embed(account: Account, risk: dict) -> dict:
    p = risk.get("profit") or {}
    return {
        "title": f"🎯 Profit target reached — {account.name}",
        "description": "Nice. Consider locking it in and requesting the payout.",
        "color": GREEN,
        "fields": [
            _field("Progress", f"`{_bar(p.get('pct'))}` **{(p.get('pct') or 0):.0f}%**\n"
                               f"{_money0(p.get('progress'))} of {_money0(p.get('target'))}"),
            _field("Equity", _money(risk.get("equity"))),
            _field("Today's P&L", _money(risk.get("today_pnl"))),
        ],
        "footer": {"text": f"{account.prop_firm or account.broker} · {account.account_type}"},
    }


def daily_summary_embed(session, day=None) -> dict:
    from sqlmodel import select

    from src.queries import get_trades

    today = day or tz.local_today()
    rows, total, trades_n, wins_n = [], 0.0, 0, 0
    for acc in session.exec(select(Account)).all():
        if acc.is_backtest:
            continue
        trades = get_trades(session, account_id=acc.id)
        day_trades = [t for t in trades
                      if t.status == "closed" and tz.local_date(t.closed_at or t.opened_at) == today]
        if not day_trades:
            continue
        pnl = sum(t.realized_pnl for t in day_trades)
        wins = len([t for t in day_trades if t.realized_pnl > 0])
        rows.append(f"{'🟢' if pnl >= 0 else '🔴'} **{acc.name}** — {_money(pnl)} "
                    f"({len(day_trades)} trades, {wins}W/{len(day_trades) - wins}L)")
        total += pnl
        trades_n += len(day_trades)
        wins_n += wins

    if not rows:
        return {
            "title": f"📊 Daily summary — {today:%a %d %b %Y}",
            "description": "No closed trades today.",
            "color": SLATE,
        }
    win_rate = (wins_n / trades_n * 100) if trades_n else 0
    return {
        "title": f"📊 Daily summary — {today:%a %d %b %Y}",
        "description": "\n".join(rows),
        "color": GREEN if total >= 0 else RED,
        "fields": [
            _field("Net P&L", _money(total)),
            _field("Trades", str(trades_n)),
            _field("Win rate", f"{win_rate:.0f}%"),
        ],
    }


def test_embeds(session) -> List[dict]:
    """Samples of every alert type, so 'Send test' shows exactly what to expect."""
    from sqlmodel import select

    acc = session.exec(select(Account).where(Account.is_backtest == False)).first()  # noqa: E712
    demo = acc or Account(name="FTMO 100k", starting_balance=100_000.0,
                          prop_firm="FTMO", account_type="prop-challenge")

    warn = {
        "status": "warning", "today_pnl": -2_430.0, "equity": 97_570.0, "open_unrealized": -180.0,
        "daily": {"limit": 3_000.0, "used": 2_430.0, "remaining": 570.0, "pct": 81.0, "status": "warning"},
        "max_loss": {"limit": 10_000.0, "used": 2_430.0, "remaining": 7_570.0, "pct": 24.3, "status": "ok"},
    }
    breach = {
        "status": "breach", "today_pnl": -3_120.0, "equity": 96_880.0, "open_unrealized": 0.0,
        "daily": {"limit": 3_000.0, "used": 3_120.0, "remaining": -120.0, "pct": 100.0, "status": "breach"},
        "max_loss": {"limit": 10_000.0, "used": 3_120.0, "remaining": 6_880.0, "pct": 31.2, "status": "ok"},
    }
    target = {
        "status": "ok", "today_pnl": 1_240.0, "equity": 110_400.0,
        "profit": {"target": 10_000.0, "progress": 10_400.0, "pct": 100.0, "reached": True},
    }

    out = [{
        "title": "✅ Trade Journal connected",
        "description": "Alerts are live. Below is a sample of each alert you'll receive.",
        "color": BLUE,
    }]
    out.append(prop_alert_embed(demo, warn))
    out.append(prop_alert_embed(demo, breach))
    out.append(target_reached_embed(demo, target))
    out.append(daily_summary_embed(session))
    return out


# --- kept for callers that still want plain text ----------------------------
def prop_alert_message(account: Account, risk: dict) -> dict:
    return prop_alert_embed(account, risk)


def target_reached_message(account: Account, risk: dict) -> dict:
    return target_reached_embed(account, risk)


def daily_summary_message(session) -> dict:
    return daily_summary_embed(session)
