"""Convert ORM objects into JSON-friendly dicts (with live-computed extras)."""
from typing import List, Optional

from src.metrics import compute_trade_metrics
from src import tz
from src.models import Account, Fill, Trade


def account_dict(a: Account, stats: Optional[dict] = None) -> dict:
    d = {
        "id": a.id,
        "name": a.name,
        "broker": a.broker,
        "account_type": a.account_type,
        "prop_firm": a.prop_firm,
        "currency": a.currency,
        "starting_balance": a.starting_balance,
        "leverage": a.leverage,
        "color": a.color,
        "external_id": a.external_id,
        "is_active": a.is_active,
        "is_backtest": a.is_backtest,
        "notes": a.notes,
        "daily_loss_limit": a.daily_loss_limit,
        "max_loss_limit": a.max_loss_limit,
        "profit_target": a.profit_target,
        "trailing_dd": a.trailing_dd,
        "created_at": tz.iso_utc(a.created_at),
    }
    if stats is not None:
        d["stats"] = stats
    return d


def fill_dict(f: Fill) -> dict:
    return {
        "id": f.id,
        "trade_id": f.trade_id,
        "kind": f.kind,
        "price": f.price,
        "lots": f.lots,
        "executed_at": tz.iso_utc(f.executed_at),
        "fee": f.fee,
        "note": f.note,
        "external_id": f.external_id,
    }


def trade_dict(t: Trade, fills: Optional[List[Fill]] = None) -> dict:
    """Serialize a trade. If `fills` is passed, include them + live computed extras."""
    d = {
        "id": t.id,
        "account_id": t.account_id,
        "symbol": t.symbol,
        "direction": t.direction,
        "status": t.status,
        "opened_at": tz.iso_utc(t.opened_at),
        "closed_at": tz.iso_utc(t.closed_at),
        "contract_size": t.contract_size,
        "initial_stop": t.initial_stop,
        "initial_target": t.initial_target,
        "planned_targets": t.planned_targets or [],
        "last_price": t.last_price,
        "setup": t.setup,
        "session": t.session,
        "sessions": t.sessions or [],
        "confidence": t.confidence,
        "timeframe": t.timeframe,
        "playbook_id": t.playbook_id,
        "checklist": t.checklist or [],
        "tags": t.tags or [],
        "rating": t.rating,
        "notes": t.notes,
        "mistakes": t.mistakes or [],
        "screenshots": t.screenshots or [],
        "external_id": t.external_id,
        # cached metrics
        "avg_entry": t.avg_entry,
        "total_entry_lots": t.total_entry_lots,
        "total_exit_lots": t.total_exit_lots,
        "remaining_lots": t.remaining_lots,
        "notional": (t.avg_entry or 0) * (t.total_entry_lots or 0) * (t.contract_size or 1),
        "realized_pnl": t.realized_pnl,
        "fees_total": t.fees_total,
        "r_multiple": t.r_multiple,
        "return_pct": t.return_pct,
    }
    d["position_ids"] = t.position_ids or []
    d["stop_is_avg"] = t.stop_is_avg
    if fills is not None:
        m = compute_trade_metrics(t, fills)
        d["fills"] = [fill_dict(f) for f in sorted(fills, key=lambda x: x.executed_at)]
        d["avg_exit"] = m["avg_exit"]
        d["unrealized_pnl"] = m["unrealized_pnl"]
        d["duration_seconds"] = m["duration_seconds"]
        d["entry_count"] = m["entry_count"]
        d["exit_count"] = m["exit_count"]
        # structured tag taxonomy
        cl = t.checklist or []
        d["adherence"] = (sum(1 for c in cl if c.get("checked")) / len(cl) * 100) if cl else None
        opts = list(t.tag_options)
        d["tag_option_ids"] = [o.id for o in opts]
        d["tags_structured"] = [
            {"id": o.id, "name": o.name, "category_id": o.category_id,
             "category_name": o.category.name if o.category else None,
             "category_color": o.category.color if o.category else None}
            for o in opts
        ]
    return d
