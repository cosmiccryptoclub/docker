"""App-timezone helpers.

Storage is naive UTC everywhere; this module is the ONE place that converts to the
configured display/day-boundary timezone (APP_TIMEZONE, default Europe/London).
DST transitions are handled by zoneinfo, so "a trading day" follows the wall clock.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from src import config

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo(config.APP_TIMEZONE)
except Exception:  # unknown zone name -> fall back to UTC rather than crash
    _TZ = timezone.utc
    print(f"⚠️  Unknown APP_TIMEZONE '{config.APP_TIMEZONE}', falling back to UTC")


def app_tz():
    return _TZ


def to_local(dt: datetime) -> datetime:
    """Naive-UTC datetime -> aware datetime in the app timezone."""
    return dt.replace(tzinfo=timezone.utc).astimezone(_TZ)


def local_date(dt: datetime) -> date:
    """The app-timezone calendar day a naive-UTC datetime falls on."""
    return to_local(dt).date()


def local_today() -> date:
    return datetime.now(_TZ).date()


def local_hour(dt: datetime) -> int:
    return to_local(dt).hour


def iso_utc(dt: datetime | None) -> str | None:
    """Serialize a naive-UTC datetime with an explicit 'Z' so browsers render it in
    the viewer's local time instead of silently treating it as local already."""
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"
