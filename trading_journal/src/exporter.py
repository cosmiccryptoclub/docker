"""CSV/JSON export helpers (trades, fills, prop-firm ledger, tax summary)."""
from __future__ import annotations

import csv
import io
import json
from typing import Iterable, List

from fastapi.responses import Response

from src import tz


def csv_response(rows: List[dict], columns: Iterable[str], filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(columns), extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    # utf-8-sig so Excel opens £/€ correctly
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def json_response(payload, filename: str) -> Response:
    return Response(
        content=json.dumps(payload, indent=2, default=str),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


TRADE_COLUMNS = [
    "id", "account", "symbol", "direction", "status",
    "opened_at", "closed_at", "duration_hours",
    "entry_lots", "exit_lots", "avg_entry", "avg_exit",
    "realized_pnl", "fees", "r_multiple", "return_pct",
    "initial_stop", "mae_r", "mfe_r", "captured_pct",
    "setup", "session", "timeframe", "rating", "confidence", "tags", "mistakes", "notes",
    "external_id",
]


def trade_row(t, account_name: str = "") -> dict:
    """One flat row per trade — the shape used by both CSV export and tax summaries."""
    dur = None
    if t.closed_at and t.opened_at:
        dur = round((t.closed_at - t.opened_at).total_seconds() / 3600.0, 3)
    lt = tz.to_local
    return {
        "id": t.id,
        "account": account_name,
        "symbol": t.symbol,
        "direction": t.direction,
        "status": t.status,
        "opened_at": lt(t.opened_at).strftime("%Y-%m-%d %H:%M:%S") if t.opened_at else "",
        "closed_at": lt(t.closed_at).strftime("%Y-%m-%d %H:%M:%S") if t.closed_at else "",
        "duration_hours": dur,
        "entry_lots": t.total_entry_lots,
        "exit_lots": t.total_exit_lots,
        "avg_entry": t.avg_entry,
        "avg_exit": None,
        "realized_pnl": round(t.realized_pnl, 2),
        "fees": round(t.fees_total, 2),
        "r_multiple": round(t.r_multiple, 3) if t.r_multiple is not None else None,
        "return_pct": round(t.return_pct, 3) if t.return_pct is not None else None,
        "initial_stop": t.initial_stop,
        "mae_r": round(t.mae_r, 3) if t.mae_r is not None else None,
        "mfe_r": round(t.mfe_r, 3) if t.mfe_r is not None else None,
        "captured_pct": round(t.captured_pct, 1) if t.captured_pct is not None else None,
        "setup": t.setup or "",
        "session": ", ".join(t.sessions or ([t.session] if t.session else [])),
        "confidence": t.confidence,
        "timeframe": t.timeframe or "",
        "rating": t.rating,
        "tags": ", ".join(t.tags or []),
        "mistakes": ", ".join(t.mistakes or []),
        "notes": (t.notes or "").replace("\n", " ").strip(),
        "external_id": t.external_id or "",
    }


FILL_COLUMNS = [
    "trade_id", "symbol", "direction", "kind", "executed_at",
    "price", "lots", "fee", "note", "external_id",
]


def fill_row(f, t) -> dict:
    return {
        "trade_id": t.id, "symbol": t.symbol, "direction": t.direction,
        "kind": f.kind,
        "executed_at": tz.to_local(f.executed_at).strftime("%Y-%m-%d %H:%M:%S") if f.executed_at else "",
        "price": f.price, "lots": f.lots, "fee": round(f.fee, 4),
        "note": f.note or "", "external_id": f.external_id or "",
    }
