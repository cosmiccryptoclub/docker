"""Helpers for reading/writing the structured tag taxonomy (shared by routers)."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from sqlmodel import Session, select

from src.models import TagCategory, TagOption, TradeTagLink


def set_trade_tag_options(session: Session, trade_id: int, option_ids: List[int]) -> None:
    """Replace a trade's tag links with the given option ids."""
    for link in session.exec(select(TradeTagLink).where(TradeTagLink.trade_id == trade_id)).all():
        session.delete(link)
    session.flush()
    seen = set()
    for oid in option_ids or []:
        if oid in seen:
            continue
        seen.add(oid)
        if session.get(TagOption, oid):
            session.add(TradeTagLink(trade_id=trade_id, option_id=oid))
    session.flush()


def options_for_trades(session: Session, trade_ids: List[int]) -> Dict[int, List[int]]:
    """trade_id -> [option_id, ...] for the given trades."""
    out: Dict[int, List[int]] = defaultdict(list)
    if not trade_ids:
        return out
    rows = session.exec(
        select(TradeTagLink.trade_id, TradeTagLink.option_id)
        .where(TradeTagLink.trade_id.in_(trade_ids))
    ).all()
    for tid, oid in rows:
        out[tid].append(oid)
    return out


def option_index(session: Session) -> Dict[int, dict]:
    """option_id -> {name, category_id, category_name, category_color}."""
    cats = {c.id: c for c in session.exec(select(TagCategory)).all()}
    out: Dict[int, dict] = {}
    for o in session.exec(select(TagOption)).all():
        c = cats.get(o.category_id)
        out[o.id] = {
            "id": o.id, "name": o.name,
            "category_id": o.category_id,
            "category_name": c.name if c else None,
            "category_color": c.color if c else None,
        }
    return out


def trade_ids_with_option(session: Session, option_id: int) -> List[int]:
    return [r for r in session.exec(
        select(TradeTagLink.trade_id).where(TradeTagLink.option_id == option_id)
    ).all()]
