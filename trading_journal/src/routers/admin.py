"""Admin: seed/reset, import (JSON/CSV), cTrader sync, file uploads."""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlmodel import Session, select

from src import eventlog, marketdata
from src.config import UPLOADS_DIR
from src.connectors.ctrader import CTraderConnector
from src.connectors.manual import parse_fills_csv, parse_json
from src.db import get_session
from src.models import Account, Fill, Playbook, Symbol, TagCategory, TagOption, Trade, TradeTagLink
from src.seed import generate
from src.sync import upsert_normalized_trades

router = APIRouter(prefix="/api/admin", tags=["admin"])

ALLOWED_IMG = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


@router.post("/seed")
def seed(reset: bool = True, seed: int | None = None, account_id: int | None = None,
         count: int | None = None, days: int | None = None,
         session: Session = Depends(get_session)):
    """Generate demo trades.

    With account_id, trades are ADDED to that account (nothing is wiped) and your own
    tag groups / playbooks are used, so the result reflects your real setup.
    """
    try:
        result = generate(session, reset=reset, rng_seed=seed, account_id=account_id,
                          count=count, days=days or 90)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "seeded", **result}


def _backfill_candles_job():
    """Fetch + store real candles (and recompute excursions on them) for every closed
    trade, so their charts stay available after providers expire the intraday window."""
    import time as _time
    from src.candles import build_chart, persist_excursions
    from src.db import session_scope

    with session_scope() as session:
        trades = session.exec(select(Trade).where(Trade.status == "closed")).all()
        done = fetched = 0
        for t in trades:
            try:
                dec = marketdata.price_decimals(t.symbol, t.avg_entry)
                chart = build_chart(t, list(t.fills), decimals=dec, session=session)
                persist_excursions(t, chart.get("analysis", {}))
                t.candles_stored = True
                session.add(t)
                session.commit()
                done += 1
                if chart.get("analysis", {}).get("fetched"):
                    fetched += 1
                    _time.sleep(0.3)   # be gentle on Yahoo
            except Exception as e:  # noqa: BLE001
                eventlog.warning("backfill", f"trade {t.id} failed: {e}")
        eventlog.success("backfill", f"processed {done} trades ({fetched} with real candles stored)")


@router.post("/backfill-candles")
def backfill_candles():
    """Kick off a background job that stores real candles for all trades."""
    import threading
    threading.Thread(target=_backfill_candles_job, daemon=True).start()
    return {"status": "started"}


@router.get("/candle-stats")
def candle_stats(session: Session = Depends(get_session)):
    from src import candlestore
    return candlestore.stored_stats(session)


def _refresh_trendbars_job():
    """Fetch broker-exact cTrader trendbars for every real trade + recompute charts on them."""
    from src import candlestore
    from src.candles import build_chart, persist_excursions
    from src.db import session_scope

    with session_scope() as session:
        trades = session.exec(
            select(Trade).where(Trade.status == "closed", Trade.external_id.is_not(None))
        ).all()
        res = candlestore.refresh_trendbars(session, trades, force=True)
        for t in trades:
            try:
                dec = marketdata.price_decimals(t.symbol, t.avg_entry)
                chart = build_chart(t, list(t.fills), decimals=dec, session=session)
                persist_excursions(t, chart.get("analysis", {}))
                t.candles_stored = True
                session.add(t)
                session.commit()
            except Exception as e:  # noqa: BLE001
                session.rollback()
                eventlog.warning("trendbars", f"trade {t.id} recompute failed: {e}")
        eventlog.success("trendbars", f"done — {res.get('stored', 0)} trades on broker-exact candles")


@router.post("/refresh-trendbars")
def refresh_trendbars():
    """Kick off a background job that replaces stored candles with cTrader trendbars."""
    import threading
    if not CTraderConnector().is_configured():
        raise HTTPException(400, "Connect cTrader first — trendbars need a working Open API token.")
    threading.Thread(target=_refresh_trendbars_job, daemon=True).start()
    return {"status": "started"}


@router.post("/recompute-excursions")
def recompute_excursions(account_id: int | None = None, session: Session = Depends(get_session)):
    """Populate cached MAE/MFE/capture/post-mortem for closed trades (real candles when available)."""
    from src.candles import build_chart, persist_excursions
    stmt = select(Trade).where(Trade.status == "closed")
    if account_id:
        stmt = stmt.where(Trade.account_id == account_id)
    trades = session.exec(stmt).all()
    done = 0
    for t in trades:
        dec = marketdata.price_decimals(t.symbol, t.avg_entry)
        chart = build_chart(t, list(t.fills), decimals=dec)
        persist_excursions(t, chart.get("analysis", {}))
        session.add(t)
        done += 1
    session.commit()
    return {"status": "done", "trades": done}


@router.post("/reset")
def reset(session: Session = Depends(get_session)):
    for model in (TradeTagLink, TagOption, TagCategory, Fill, Trade, Playbook, Account, Symbol):
        for row in session.exec(select(model)).all():
            session.delete(row)
    session.commit()
    # deleted accounts leave stale auto-sync targets + alert state behind — clear them
    from src import settings_store
    settings_store.save({"ctrader_syncs": [], "prop_alert_state": {}})
    return {"status": "reset"}


@router.post("/import/json")
async def import_json(request: Request, session: Session = Depends(get_session)):
    body = await request.json()
    account_id = body.get("account_id")
    acc = session.get(Account, account_id) if account_id else None
    if not acc:
        raise HTTPException(400, "Valid account_id is required")
    trades = parse_json(body.get("trades", body))
    result = upsert_normalized_trades(session, acc, trades)
    return {"status": "imported", **result}


@router.post("/import/csv")
async def import_csv(
    account_id: int = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
):
    acc = session.get(Account, account_id)
    if not acc:
        raise HTTPException(400, "Valid account_id is required")
    text = (await file.read()).decode("utf-8", errors="replace")
    trades = parse_fills_csv(text)
    result = upsert_normalized_trades(session, acc, trades)
    return {"status": "imported", **result}


@router.get("/ctrader/status")
def ctrader_status():
    return CTraderConnector().token_status()


@router.get("/ctrader/auth-url")
def ctrader_auth_url(redirect_uri: str):
    """Build the OAuth authorization-code URL (gives a PRODUCTION token, unlike the Playground)."""
    c = CTraderConnector()
    if not c.client_id:
        raise HTTPException(400, "No CTRADER_CLIENT_ID set in .env.")
    return {"url": c.authorize_url(redirect_uri), "redirect_uri": redirect_uri}


@router.post("/ctrader/exchange")
async def ctrader_exchange(request: Request):
    body = await request.json()
    code, redirect_uri = body.get("code"), body.get("redirect_uri")
    if not code or not redirect_uri:
        raise HTTPException(400, "code and redirect_uri are required")
    try:
        CTraderConnector().exchange_code(code, redirect_uri)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Token exchange failed: {e}")
    return {"status": "connected"}


@router.get("/ctrader/accounts")
def ctrader_accounts():
    """Fetch the cTID profile + trading accounts (REST) so you can find your ctidTraderAccountId."""
    connector = CTraderConnector()
    if not connector.access_token:
        raise HTTPException(400, "No CTRADER_ACCESS_TOKEN set in .env.")
    try:
        return connector.list_accounts()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"cTrader connect failed: {e}")


@router.post("/sync/ctrader")
def sync_ctrader(account_id: int, ctid: str | None = None, group_window: int | None = None,
                 name: str = "", session: Session = Depends(get_session)):
    """Pull deals from a cTrader account (ctid, or CTRADER_ACCOUNT_ID) into a local account."""
    from src import settings_store
    from src.ctrader_sync import run_ctrader_sync

    acc = session.get(Account, account_id)
    if not acc:
        raise HTTPException(400, "Select a local account to sync into (account_id).")
    connector = CTraderConnector()
    if not connector.is_configured():
        raise HTTPException(400, "cTrader credentials not configured (CTRADER_CLIENT_ID/_SECRET + a token).")
    target_ctid = ctid or connector.account_id
    if not target_ctid:
        raise HTTPException(400, "No cTrader account selected (ctidTraderAccountId).")
    try:
        result = run_ctrader_sync(session, acc, target_ctid, group_window)
    except NotImplementedError as e:
        raise HTTPException(501, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"cTrader sync failed: {e}")

    # remember this mapping so auto-sync can repeat it
    settings_store.record_ctrader_sync(target_ctid, acc.id, name)
    eventlog.success("ctrader-sync", f"{acc.name}: {result.get('total', 0)} trades")
    return {"status": "synced", **result}


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMG:
        raise HTTPException(400, f"Unsupported file type '{ext}'")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / name
    dest.write_bytes(await file.read())
    return {"filename": name, "url": f"/uploads/{name}"}
