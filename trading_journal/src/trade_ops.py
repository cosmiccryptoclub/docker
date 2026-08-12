"""Trade lifecycle operations shared by sync, routers and admin jobs.

Deleting a Trade does NOT clean up everything on its own: fills cascade via the
relationship, but `TradeTagLink` rows do not (it's a link table with no cascade), so a
plain `session.delete(trade)` leaves orphan links behind. SQLite reuses rowids, so an
orphan can later re-attach to an unrelated trade. Always delete through `delete_trade`.
"""
from __future__ import annotations

from typing import Iterable, List

from sqlmodel import Session, select

from src.models import Fill, Trade, TradeTagLink


def delete_trade(session: Session, trade: Trade) -> None:
    """Delete a trade and every row that doesn't cascade with it."""
    for link in session.exec(
        select(TradeTagLink).where(TradeTagLink.trade_id == trade.id)
    ).all():
        session.delete(link)
    session.delete(trade)          # fills cascade via the relationship


def delete_trades(session: Session, trades: Iterable[Trade]) -> int:
    n = 0
    for t in trades:
        delete_trade(session, t)
        n += 1
    return n


def is_synced(trade: Trade) -> bool:
    """True for trades produced by the cTrader sync (vs manual/imported/dummy)."""
    ext = trade.external_id or ""
    return ext.startswith("ct-") or ext.isdigit()


def apply_position_groups(session: Session, trades: List) -> int:
    """Fold NormalizedTrades together according to saved PositionGroups. Returns merges."""
    from src.models import PositionGroup

    rows = session.exec(select(PositionGroup)).all()
    if not rows:
        return 0
    key_of = {r.position_id: r.group_key for r in rows}

    buckets: dict = {}
    passthrough: List = []
    for nt in trades:
        keys = {key_of[p] for p in (nt.position_ids or []) if p in key_of}
        if len(keys) == 1:
            buckets.setdefault(keys.pop(), []).append(nt)
        else:
            passthrough.append(nt)   # ungrouped, or spanning two groups -> leave alone

    merged_count = 0
    out = list(passthrough)
    for _key, group in buckets.items():
        if len(group) == 1:
            out.append(group[0])
            continue
        group.sort(key=lambda t: t.opened_at)
        base = group[0]
        for other in group[1:]:
            base.fills.extend(other.fills)
            base.position_ids = list(base.position_ids) + list(other.position_ids)
        base.fills.sort(key=lambda f: f.executed_at)
        base.opened_at = min(f.executed_at for f in base.fills)
        # keep a stable id derived from the earliest position so re-syncs match up
        base.external_id = "ct-" + str(min(int(p) for p in base.position_ids if str(p).isdigit()))
        out.append(base)
        merged_count += len(group) - 1

    trades[:] = out
    return merged_count


def merge_trades(session: Session, trades: List[Trade]) -> Trade:
    """Merge existing Trade rows into the earliest one (fills move across, rest deleted).

    Journal fields: the target keeps its own; anything it left blank is filled from the
    others (first non-empty wins) so merging never silently loses a note or a tag.
    """
    from src.metrics import recompute_trade
    from src.models import Account

    trades = sorted(trades, key=lambda t: t.opened_at)
    target, others = trades[0], trades[1:]

    for o in others:
        # Reparent through the RELATIONSHIP, not by writing trade_id.
        # Setting the FK alone left the fills inside o.fills, so the delete-orphan
        # cascade on `session.delete(o)` below deleted them again — the merged trade
        # silently lost that leg. Assigning f.trade lets back_populates move each fill
        # out of o.fills and into target.fills, so it is no longer an orphan.
        for f in list(o.fills):
            f.trade = target
        session.flush()
        if o.fills:      # never delete a trade that still owns fills
            raise RuntimeError(f"merge aborted: trade {o.id} still holds {len(o.fills)} fill(s)")

        # carry over anything the target doesn't already have
        for field in ("setup", "session", "timeframe", "notes", "rating",
                      "playbook_id", "initial_target"):
            if not getattr(target, field, None) and getattr(o, field, None):
                setattr(target, field, getattr(o, field))
        for field in ("tags", "mistakes", "screenshots"):
            merged = list(getattr(target, field) or [])
            for v in (getattr(o, field) or []):
                if v not in merged:
                    merged.append(v)
            setattr(target, field, merged)
        # union the tag links
        for link in session.exec(
            select(TradeTagLink).where(TradeTagLink.trade_id == o.id)
        ).all():
            dup = session.exec(
                select(TradeTagLink).where(
                    TradeTagLink.trade_id == target.id,
                    TradeTagLink.option_id == link.option_id)
            ).first()
            session.delete(link)
            if not dup:
                session.add(TradeTagLink(trade_id=target.id, option_id=link.option_id))

        target.position_ids = list(target.position_ids or []) + list(o.position_ids or [])
        session.delete(o)

    session.flush()
    session.refresh(target)
    acc = session.get(Account, target.account_id)
    recompute_trade(target, acc.starting_balance if acc else 0.0)
    target.candles_stored = False      # window changed -> recollect candles
    session.add(target)
    return target


def stale_synced_trades(session: Session, account_id: int, keep_external_ids: set) -> List[Trade]:
    """Synced trades for an account that the current sync no longer produces.

    Re-grouping (a changed group window) changes the `ct-` ids, so the old rows would
    linger as duplicates. Everything still present is left alone for the upsert to update
    in place — which is what preserves notes/tags/rating/screenshots/etc.
    """
    rows = session.exec(select(Trade).where(Trade.account_id == account_id)).all()
    return [t for t in rows if is_synced(t) and (t.external_id or "") not in keep_external_ids]
