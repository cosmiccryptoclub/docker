"""Upsert NormalizedTrades into the DB (idempotent on external_id per account)."""
from __future__ import annotations

from typing import List

from sqlmodel import Session, select

from src.connectors.base import NormalizedTrade
from src.metrics import recompute_trade
from src.models import Account, Fill, Trade


def upsert_normalized_trades(
    session: Session, account: Account, trades: List[NormalizedTrade]
) -> dict:
    created = 0
    updated = 0
    for nt in trades:
        existing = None
        if nt.external_id:
            existing = session.exec(
                select(Trade).where(
                    Trade.account_id == account.id,
                    Trade.external_id == nt.external_id,
                )
            ).first()

        if existing:
            trade = existing
            updated += 1
            # Replace the fills through the RELATIONSHIP, not session.delete() on each.
            # delete-orphan cascade removes the old rows and leaves the collection
            # consistent; deleting the instances directly left them in trade.fills, and
            # the next read of that collection raised "Instance <Fill> has been deleted".
            trade.fills.clear()
            session.flush()
        else:
            trade = Trade(account_id=account.id, external_id=nt.external_id or None)
            created += 1

        trade.symbol = nt.symbol
        trade.direction = nt.direction
        trade.opened_at = nt.opened_at
        trade.contract_size = nt.contract_size
        if nt.position_ids:
            trade.position_ids = list(nt.position_ids)
        if nt.initial_stop is not None:
            trade.initial_stop = nt.initial_stop
            trade.stop_is_avg = nt.stop_is_avg
        if nt.setup:
            trade.setup = nt.setup
        session.add(trade)
        session.flush()

        # append through the relationship so trade.fills is authoritative afterwards
        for nf in nt.fills:
            trade.fills.append(Fill(
                kind=nf.kind,
                price=nf.price,
                lots=nf.lots,
                executed_at=nf.executed_at,
                fee=nf.fee,
                external_id=nf.external_id,
                note=nf.note,
            ))
        session.flush()
        recompute_trade(trade, account.starting_balance)
        session.add(trade)

    session.commit()
    return {"created": created, "updated": updated, "total": created + updated}
