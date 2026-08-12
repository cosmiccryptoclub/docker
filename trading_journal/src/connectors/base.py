"""
Pluggable connector interface.

Every source (cTrader now; crypto exchanges / DEXs later) implements this and
returns a normalized list of `NormalizedTrade`. The import layer (routers/sync)
then upserts them into the DB so the rest of the app never has to care where a
trade came from.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional


@dataclass
class NormalizedFill:
    kind: str            # entry|tp|sl|close
    price: float
    lots: float
    executed_at: datetime
    fee: float = 0.0
    external_id: Optional[str] = None
    note: Optional[str] = None


@dataclass
class NormalizedTrade:
    external_id: str                 # broker position id (used for idempotent upsert)
    symbol: str
    direction: str                   # long|short
    opened_at: datetime
    fills: List[NormalizedFill] = field(default_factory=list)
    contract_size: float = 1.0
    initial_stop: Optional[float] = None
    stop_is_avg: Optional[bool] = None   # stop is a weighted average of several positions
    position_ids: List[str] = field(default_factory=list)  # broker position ids in this trade
    setup: Optional[str] = None
    raw: Optional[dict] = None        # keep the source payload for debugging


class BaseConnector:
    """Implement fetch_trades() (and optionally the OAuth/auth bits)."""

    name: str = "base"

    def is_configured(self) -> bool:  # pragma: no cover - trivial
        raise NotImplementedError

    def fetch_trades(self, since: Optional[datetime] = None) -> List[NormalizedTrade]:
        raise NotImplementedError
