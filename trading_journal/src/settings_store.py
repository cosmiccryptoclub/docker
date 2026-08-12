"""App-level preferences persisted in data/settings.json."""
from __future__ import annotations

import json
from typing import Any

from src.config import DATA_DIR

SETTINGS_FILE = DATA_DIR / "settings.json"

DEFAULTS: dict[str, Any] = {
    "ctrader_group_window": 120,      # default seconds to group scale-ins on sync
    "ctrader_autosync_minutes": 5,    # 0 = off
    "ctrader_syncs": [],              # [{ctid, account_id, ctrader_name}] auto-sync targets
    "default_leverage": 0,            # 0 = none (margin = notional)
    # --- Discord alerts ---
    "discord_webhook_url": "",
    "discord_alerts": True,           # master switch for prop-rule breach/warning alerts
    "alert_warning_pct": 80,          # warn when >= this % of a limit is used (0-100)
    "alert_daily_loss": True,         # alert on daily-loss limit breaches/warnings
    "alert_max_dd": True,             # alert on max-drawdown limit breaches/warnings
    "alert_profit_target": True,      # alert when a profit target is reached
    "daily_summary_hour": -1,         # app-timezone hour (0-23) to post a daily summary; -1 = off
    "db_backups": True,               # nightly SQLite backup into data/backups (keep 14)
    "prop_alert_state": {},           # account_id -> last alerted signal (internal)
    # --- Candle history (real OHLC persistence) ---
    "candle_autostore": True,         # keep real candles for every trade, automatically
    "candle_collect_minutes": 30,     # how often the background collector runs
    "ctrader_trendbars": False,       # prefer broker-exact cTrader trendbars over Yahoo (opt-in)
    # --- Position watch (stop moves + swap charges on open positions) ---
    "position_watch": True,
    "position_watch_minutes": 3,
    # --- Economic calendar (ForexFactory) ---
    "econ_calendar": True,            # keep the economic calendar refreshed + overlay on charts
    "econ_refresh_hours": 6,          # how often to refresh the feed
    # --- Discipline goals (0 = off) ---
    "goal_max_trades_per_day": 0,     # cap on trades opened per day
    "goal_max_daily_loss": 0,         # personal daily-loss cap ($), separate from prop rules
    "goal_monthly_r": 0,              # target R for the month
    "goal_min_adherence_pct": 0,      # min playbook-checklist adherence you hold yourself to
    "goal_risk_per_trade_r": 0,       # intended risk per trade (informational)
}

GOAL_KEYS = (
    "goal_max_trades_per_day", "goal_max_daily_loss", "goal_monthly_r",
    "goal_min_adherence_pct", "goal_risk_per_trade_r",
)


def load() -> dict:
    try:
        data = json.loads(SETTINGS_FILE.read_text())
    except Exception:
        data = {}
    return {**DEFAULTS, **data}


def save(data: dict) -> dict:
    merged = {**load(), **data}
    SETTINGS_FILE.write_text(json.dumps(merged, indent=2))
    return merged


def record_ctrader_sync(ctid, account_id: int, ctrader_name: str = "") -> None:
    """Remember a manual sync so auto-sync can repeat it."""
    s = load()
    syncs = [m for m in s.get("ctrader_syncs", []) if str(m.get("ctid")) != str(ctid)]
    syncs.append({"ctid": str(ctid), "account_id": account_id, "ctrader_name": ctrader_name})
    save({"ctrader_syncs": syncs})
