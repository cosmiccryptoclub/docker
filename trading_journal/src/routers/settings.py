"""App preferences: group window, cTrader auto-sync, Discord alerts, etc."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from src.db import get_session

from src import notify, settings_store

router = APIRouter(prefix="/api/settings", tags=["settings"])

ALLOWED = {
    "ctrader_group_window", "ctrader_autosync_minutes", "ctrader_syncs", "default_leverage",
    "discord_webhook_url", "discord_alerts", "daily_summary_hour",
    "alert_warning_pct", "alert_daily_loss", "alert_max_dd", "alert_profit_target",
    "candle_autostore", "candle_collect_minutes", "ctrader_trendbars",
    "econ_calendar", "econ_refresh_hours", "db_backups",
    "position_watch", "position_watch_minutes",
    "goal_max_trades_per_day", "goal_max_daily_loss", "goal_monthly_r",
    "goal_min_adherence_pct", "goal_risk_per_trade_r",
}


@router.get("")
def get_settings():
    return settings_store.load()


@router.put("")
async def update_settings(request: Request):
    data = await request.json()
    clean = {k: v for k, v in data.items() if k in ALLOWED}
    merged = settings_store.save(clean)
    # reschedule auto-sync / alert jobs if anything changed
    from src import scheduler
    scheduler.reschedule()
    return merged


@router.post("/test-discord")
def test_discord(session: Session = Depends(get_session)):
    """Post one sample of every alert type so you can see exactly how they'll look."""
    webhook = settings_store.load().get("discord_webhook_url", "")
    if not webhook:
        raise HTTPException(400, "Set a Discord webhook URL first (and Save).")
    embeds = notify.test_embeds(session)
    if not notify.send_discord(webhook, embeds=embeds):
        raise HTTPException(502, "Discord webhook post failed — check the URL.")
    return {"status": "sent", "samples": len(embeds)}
