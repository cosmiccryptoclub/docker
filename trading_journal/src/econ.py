"""
Economic calendar — ForexFactory weekly JSON feed (free, keyless).

`refresh()` pulls last/this/next week and upserts into EconEvent, so a full history
accumulates locally over time (like the candle store). Events are then queried for
the dashboard "upcoming news" widget and overlaid on trade charts within their window.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

import httpx
from sqlmodel import Session, select

from src import eventlog
from src.models import EconEvent

FEED_URL = "https://nfs.faireconomy.media/ff_calendar_{feed}.json"
# Only the current week is published — ff_calendar_lastweek/nextweek both 404 (verified
# 12/08/2026). That's fine: refresh() upserts, so running every few hours accumulates a
# permanent local history week by week. Don't re-add the other feeds without probing them.
FEEDS = ("thisweek",)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

KNOWN_CCY = {"USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"}

# index / prop-firm symbol -> the currency whose news drives it
INDEX_CCY = {
    "US100": "USD", "NAS100": "USD", "USTEC": "USD", "US500": "USD", "SPX500": "USD",
    "US30": "USD", "US2000": "USD",
    "GER40": "EUR", "GER30": "EUR", "DE40": "EUR", "DAX": "EUR", "EU50": "EUR",
    "STOXX50": "EUR", "FRA40": "EUR", "ESP35": "EUR",
    "UK100": "GBP", "FTSE100": "GBP",
    "JP225": "JPY", "JPN225": "JPY", "NIKKEI": "JPY",
    "AUS200": "AUD", "HK50": "CNY",
}

IMPACT_RANK = {"High": 3, "Medium": 2, "Low": 1, "Holiday": 0}


def symbol_currencies(symbol: str) -> List[str]:
    """Currencies whose news is relevant to a symbol (for chart overlays)."""
    s = symbol.upper().replace("/", "").replace("_", "").split(".")[0]
    found = set()
    for key, ccy in INDEX_CCY.items():
        if s.startswith(key):
            found.add(ccy)
    # forex / metals: pull any known 3-letter currency codes out of the ticker
    for i in range(0, max(len(s) - 2, 1)):
        if s[i:i + 3] in KNOWN_CCY:
            found.add(s[i:i + 3])
    if not found:
        found.add("USD")   # indices / crypto / metals default to the USD session
    return sorted(found)


def _parse_time(raw: Optional[str]) -> Optional[int]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return None


def fetch_feed(feed: str) -> List[dict]:
    url = FEED_URL.format(feed=feed)
    r = httpx.get(url, headers={"User-Agent": UA}, timeout=20.0)
    r.raise_for_status()
    return r.json()


def refresh(session: Session, feeds=FEEDS) -> dict:
    """Fetch the weekly feeds and upsert events; returns counts."""
    added = updated = 0
    for feed in feeds:
        try:
            rows = fetch_feed(feed)
        except Exception as e:  # noqa: BLE001
            eventlog.warning("econ", f"{feed} fetch failed: {e}")
            continue
        for ev in rows:
            t = _parse_time(ev.get("date"))
            ccy = (ev.get("country") or ev.get("currency") or "").upper()
            title = ev.get("title") or ""
            if not t or not ccy or not title:
                continue
            impact = (ev.get("impact") or "Low").title()
            existing = session.exec(
                select(EconEvent).where(
                    EconEvent.time == t, EconEvent.currency == ccy, EconEvent.title == title
                )
            ).first()
            if existing:
                existing.impact = impact
                existing.forecast = ev.get("forecast") or existing.forecast
                existing.previous = ev.get("previous") or existing.previous
                existing.actual = ev.get("actual") or existing.actual
                existing.fetched_at = datetime.utcnow()
                session.add(existing)
                updated += 1
            else:
                session.add(EconEvent(
                    time=t, currency=ccy, title=title, impact=impact,
                    forecast=ev.get("forecast") or None, previous=ev.get("previous") or None,
                    actual=ev.get("actual") or None,
                ))
                added += 1
        session.commit()
    eventlog.info("econ", f"refreshed: +{added} new, {updated} updated")
    return {"added": added, "updated": updated}


def _row(e: EconEvent) -> dict:
    return {
        "time": e.time, "currency": e.currency, "title": e.title, "impact": e.impact,
        "forecast": e.forecast, "previous": e.previous, "actual": e.actual,
    }


def events(session: Session, start_s: int, end_s: int,
           currencies: Optional[List[str]] = None, min_impact: str = "Low") -> List[dict]:
    stmt = select(EconEvent).where(EconEvent.time >= start_s, EconEvent.time <= end_s)
    if currencies:
        stmt = stmt.where(EconEvent.currency.in_([c.upper() for c in currencies]))
    rows = session.exec(stmt.order_by(EconEvent.time)).all()
    floor = IMPACT_RANK.get(min_impact.title(), 0)
    return [_row(e) for e in rows if IMPACT_RANK.get(e.impact, 0) >= floor]


def upcoming(session: Session, now_s: int, horizon_s: int,
             currencies: Optional[List[str]] = None, min_impact: str = "High",
             limit: int = 12) -> List[dict]:
    rows = events(session, now_s, now_s + horizon_s, currencies, min_impact)
    return rows[:limit]


def stats(session: Session) -> dict:
    from sqlalchemy import func
    total = session.exec(select(func.count()).select_from(EconEvent)).one()
    last = session.exec(select(func.max(EconEvent.fetched_at))).one()
    return {"events": int(total or 0), "last_fetched": last.isoformat() if last else None}
