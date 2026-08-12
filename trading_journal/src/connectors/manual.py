"""
Manual import: turn a JSON payload or a fills CSV into NormalizedTrades.

JSON shape (either a bare list or {"trades": [...]}):
    {
      "external_id": "pos-123", "symbol": "BTCUSD", "direction": "long",
      "opened_at": "2026-07-01T09:00:00", "contract_size": 1.0,
      "initial_stop": 116500, "setup": "London reclaim",
      "fills": [
        {"kind":"entry","price":118000,"lots":0.1,"executed_at":"2026-07-01T09:00:00","fee":1.2},
        {"kind":"tp","price":118600,"lots":0.05,"executed_at":"2026-07-01T09:40:00","fee":0.6}
      ]
    }

CSV shape (one row per fill, grouped into trades by position_id):
    position_id,symbol,direction,kind,price,lots,executed_at,fee
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Dict, List

from src.connectors.base import NormalizedFill, NormalizedTrade


def _dt(value) -> datetime:
    if isinstance(value, datetime):
        return value
    s = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    return dt.replace(tzinfo=None)  # store naive UTC


def parse_json(payload) -> List[NormalizedTrade]:
    if isinstance(payload, dict):
        payload = payload.get("trades", [])
    out: List[NormalizedTrade] = []
    for row in payload:
        fills = [
            NormalizedFill(
                kind=f.get("kind", "entry"),
                price=float(f["price"]),
                lots=float(f["lots"]),
                executed_at=_dt(f["executed_at"]),
                fee=float(f.get("fee", 0) or 0),
                external_id=f.get("external_id"),
                note=f.get("note"),
            )
            for f in row.get("fills", [])
        ]
        opened = min((f.executed_at for f in fills), default=_dt(row["opened_at"]))
        out.append(NormalizedTrade(
            external_id=str(row.get("external_id") or ""),
            symbol=row["symbol"],
            direction=row.get("direction", "long"),
            opened_at=opened,
            fills=fills,
            contract_size=float(row.get("contract_size", 1.0)),
            initial_stop=(float(row["initial_stop"]) if row.get("initial_stop") not in (None, "") else None),
            setup=row.get("setup"),
            raw=row,
        ))
    return out


def parse_fills_csv(text: str) -> List[NormalizedTrade]:
    reader = csv.DictReader(io.StringIO(text))
    groups: Dict[str, List[dict]] = {}
    for row in reader:
        pid = (row.get("position_id") or row.get("external_id") or "").strip()
        groups.setdefault(pid, []).append(row)

    out: List[NormalizedTrade] = []
    for pid, rows in groups.items():
        fills = [
            NormalizedFill(
                kind=(r.get("kind") or "entry").strip().lower(),
                price=float(r["price"]),
                lots=float(r["lots"]),
                executed_at=_dt(r["executed_at"]),
                fee=float(r.get("fee", 0) or 0),
            )
            for r in rows
        ]
        first = rows[0]
        out.append(NormalizedTrade(
            external_id=pid,
            symbol=first["symbol"],
            direction=(first.get("direction") or "long").strip().lower(),
            opened_at=min(f.executed_at for f in fills),
            fills=fills,
            contract_size=float(first.get("contract_size", 1.0) or 1.0),
        ))
    return out
