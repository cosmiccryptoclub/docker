"""
Trading-session classification.

A trade gets a LIST of sessions, not one label — the real windows overlap, and a London
entry that runs into the New York open genuinely belongs to both. Derived from the OPEN
time in the app timezone (APP_TIMEZONE, default Europe/London) so it follows BST/GMT.

Windows (app-local, deliberately overlapping):

    Asia         00:00–09:00   Tokyo/Sydney into the London pre-open
    London       08:00–17:00
    New York     13:00–22:00   overlaps London 13:00–17:00
    CME Closed   22:00–23:00   CME's daily maintenance halt
    Closed       anything left over (the thin overnight tape)
    Weekend      Sat/Sun — exclusive: FX and indices are shut, so the intraday
                 windows are meaningless even though crypto keeps trading

The user can override the list by hand; classification only fills it in when empty.
"""
from __future__ import annotations

from datetime import datetime, time
from typing import List, Optional

from src import tz

ASIA = "Asia"
LONDON = "London"
NEW_YORK = "New York"
CME_CLOSED = "CME Closed"
CLOSED = "Closed"
WEEKEND = "Weekend"

# order used for checkboxes and chart buckets
ALL = [ASIA, LONDON, NEW_YORK, CME_CLOSED, CLOSED, WEEKEND]

# (label, start_hour, end_hour) — end exclusive
_WINDOWS = [
    (ASIA, 0, 9),
    (LONDON, 8, 17),
    (NEW_YORK, 13, 22),
    (CME_CLOSED, 22, 23),
]


def classify(opened_at: Optional[datetime]) -> List[str]:
    """Naive-UTC open time -> every session it falls inside ([] if no timestamp)."""
    if opened_at is None:
        return []
    local = tz.to_local(opened_at)
    if local.weekday() >= 5:              # 5 = Saturday, 6 = Sunday
        return [WEEKEND]
    h = local.hour
    hits = [name for name, start, end in _WINDOWS if start <= h < end]
    return hits or [CLOSED]


def normalise(value) -> List[str]:
    """Accept a list, a comma-separated string or a single legacy label -> clean list."""
    if not value:
        return []
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",")]
    else:
        parts = [str(p).strip() for p in value]
    seen, out = set(), []
    for p in parts:
        if not p or p.casefold() in seen:
            continue
        # tolerate the old "Other" label and any casing
        match = next((a for a in ALL if a.casefold() == p.casefold()), None)
        label = match or p
        seen.add(label.casefold())
        out.append(label)
    return out
