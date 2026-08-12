"""Shared cTrader sync core, used by the manual endpoint and the auto-sync job."""
from __future__ import annotations

from sqlmodel import Session

from src import eventlog, trade_ops
from src.connectors.ctrader import CTraderConnector
from src.models import Account
from src.sync import upsert_normalized_trades


def _apply_broker_stops(connector: CTraderConnector, ctid: str, trades: list,
                        session: Session | None = None) -> int:
    """Fill in each still-open trade's stop from the broker's live positions.

    Deals (executions) carry no stop price, so a trade that wasn't stopped out has no
    stop at all — no stop line on the chart and no R-multiple. cTrader's open positions
    do carry `stopLoss`, so pull it here and, for a grouped scale-in whose positions have
    different stops, store the lots-weighted average.

    Best-effort: any failure leaves the trades exactly as they were.

    NOTE: this is the stop as it stands *now* — if it was moved after entry, that's what
    you get. Capturing the original stop + every move is roadmap item 2.
    """
    try:
        snap = connector.fetch_account_snapshot(ctid)
    except Exception as e:  # noqa: BLE001
        eventlog.warning("ctrader-sync", f"could not read broker stops: {e}")
        return 0

    by_pid = {str(p.get("position_id")): p for p in (snap.get("positions") or [])}
    if not by_pid:
        return 0

    applied = 0
    for nt in trades:
        # Prefer the ORIGINAL stop we recorded when the position was first watched —
        # the broker only reports the stop as it stands now, which is wrong for R if it
        # was later moved. Falls back to the current stop when there's no history.
        if session is not None:
            try:
                from src import position_watch
                orig = position_watch.original_stop(session, nt.position_ids)
            except Exception:  # noqa: BLE001
                orig = None
            if orig:
                nt.initial_stop = orig["price"]
                nt.stop_is_avg = orig["is_avg"]
                applied += 1
                continue

        stops = [
            (by_pid[pid]["stop_loss"], by_pid[pid].get("lots") or 0.0)
            for pid in (nt.position_ids or [])
            if pid in by_pid and by_pid[pid].get("stop_loss") is not None
        ]
        if not stops:
            continue
        lots = sum(l for _, l in stops)
        nt.initial_stop = (sum(s * l for s, l in stops) / lots) if lots > 0 else stops[0][0]
        nt.stop_is_avg = len({round(s, 8) for s, _ in stops}) > 1
        applied += 1
    return applied


def run_ctrader_sync(session: Session, account: Account, ctid: str, group_window: int | None = None) -> dict:
    connector = CTraderConnector()
    if not connector.is_configured():
        raise RuntimeError("cTrader not configured (CTRADER_CLIENT_ID/_SECRET + a token).")
    connector.account_id = str(ctid)

    # Link the local account to the cTrader account. Without this the Live page can't
    # fetch broker positions (falls back to "local estimate") and position_watch skips
    # the account entirely ("no linked accounts") — so stops/swaps are never recorded.
    if str(account.external_id or "") != str(ctid):
        account.external_id = str(ctid)
        session.add(account)
        session.commit()

    # pick up leverage from cTrader so margin is accurate
    try:
        for a in connector.list_accounts()["accounts"]:
            if str(a.get("accountId")) == str(ctid) and a.get("leverage"):
                account.leverage = int(a["leverage"])
                session.add(account)
                break
    except Exception:  # noqa: BLE001
        pass

    trades = connector.fetch_trades(group_window=group_window)

    # re-apply the user's manual groupings (stored per broker position, so they survive
    # the re-import) BEFORE stops, so a merged trade gets one averaged stop
    merged = trade_ops.apply_position_groups(session, trades)
    if merged:
        eventlog.info("ctrader-sync", f"{account.name}: re-applied {merged} manual merge(s)")

    # deals carry no stop price — use the recorded original, else the broker's live one
    _apply_broker_stops(connector, str(ctid), trades, session)

    # Only drop synced trades this sync no longer produces (e.g. the group window
    # changed, so their ct- ids are gone). Everything else is updated IN PLACE by the
    # upsert, which is what preserves journal fields — notes, tags, rating, mistakes,
    # screenshots, setup/session/timeframe, playbook + checklist, a hand-typed stop.
    # (Deleting them all first, as this used to, silently wiped that on every sync.)
    incoming = {nt.external_id for nt in trades if nt.external_id}
    stale = trade_ops.stale_synced_trades(session, account.id, incoming)
    if stale:
        trade_ops.delete_trades(session, stale)
        session.commit()
        eventlog.info("ctrader-sync", f"{account.name}: cleared {len(stale)} regrouped trade(s)")

    return upsert_normalized_trades(session, account, trades)
