"""Background scheduler for cTrader auto-sync, candle collection, econ refresh, alerts.

BackgroundScheduler runs jobs in worker threads, so the connector's asyncio.run()
socket sync works fine (it can't run on the main event loop). Every job runs through
`_tracked` so its start/finish/failure lands in the event log and its last-run status
powers the Scheduled Tasks page.
"""
from __future__ import annotations

import time
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import select

from src import eventlog, notify, settings_store, tz
from src.ctrader_sync import run_ctrader_sync
from src.db import session_scope
from src.models import Account
from src.queries import get_trades
from src.risk import compute_account_risk

scheduler = BackgroundScheduler()
JOB_ID = "ctrader_autosync"

# job_id -> {last_run, status, message, duration} (for the Scheduled Tasks page)
LAST_RUN: dict = {}


def autosync_job() -> str:
    s = settings_store.load()
    if int(s.get("ctrader_autosync_minutes", 0) or 0) <= 0:
        return "auto-sync disabled"
    window = int(s.get("ctrader_group_window", 120) or 120)
    targets = s.get("ctrader_syncs", [])
    if not targets:
        return "no accounts linked — sync one from Settings first"

    synced = 0
    problems = []
    for m in targets:
        name = m.get("ctrader_name") or m.get("ctid")
        try:
            with session_scope() as session:
                acc = session.get(Account, m["account_id"])
                if not acc:
                    # the mapped local account was deleted — say so instead of
                    # silently reporting a successful no-op
                    problems.append(f"{name}: local account {m['account_id']} no longer exists")
                    continue
                res = run_ctrader_sync(session, acc, m["ctid"], window)
                synced += 1
                eventlog.info("autosync", f"{name} → {acc.name}: {res.get('total', 0)} trades")
        except Exception as e:  # noqa: BLE001
            problems.append(f"{name}: {e}")
            eventlog.error("autosync", f"{name} failed: {e}")

    if synced and s.get("candle_autostore", True):
        try:
            from src import candlestore
            with session_scope() as session:
                candlestore.collect_pending(session)
        except Exception as e:  # noqa: BLE001
            eventlog.warning("autosync", f"candle collect failed: {e}")

    # surface failures as a FAILED task, not a green "synced 0 account(s)" —
    # that is how a fortnight of broken syncs went unnoticed
    if problems:
        raise RuntimeError(f"{len(problems)} of {len(targets)} failed — " + "; ".join(problems)[:300])
    return f"synced {synced} account(s)"


def candle_collect_job() -> str:
    s = settings_store.load()
    if not s.get("candle_autostore", True):
        return "candle collection disabled"
    from src import candlestore
    with session_scope() as session:
        res = candlestore.collect_pending(session, limit=80)
    return f"{res.get('processed', 0)} trades, {res.get('real', 0)} fetched from provider"


def position_watch_job() -> str:
    """Record stop moves + swap charges on open positions (deals don't carry them)."""
    s = settings_store.load()
    if not s.get("position_watch", True):
        return "position watch disabled"
    from src import position_watch
    with session_scope() as session:
        res = position_watch.poll_all(session)
    if not res["accounts"]:
        return "no linked accounts"
    return f"{res['stops']} stop change(s), {res['swaps']} swap charge(s)"


def econ_refresh_job() -> str:
    s = settings_store.load()
    if not s.get("econ_calendar", True):
        return "econ calendar disabled"
    from src import econ
    with session_scope() as session:
        res = econ.refresh(session)
    return f"+{res.get('added', 0)} new, {res.get('updated', 0)} updated"


def _alert_level(risk: dict, en_daily: bool, en_maxdd: bool) -> str:
    statuses = []
    if en_daily and risk.get("daily"):
        statuses.append(risk["daily"]["status"])
    if en_maxdd and risk.get("max_loss"):
        statuses.append(risk["max_loss"]["status"])
    return "breach" if "breach" in statuses else ("warning" if "warning" in statuses else "ok")


def prop_check_job() -> str:
    s = settings_store.load()
    webhook = s.get("discord_webhook_url", "")
    if not webhook or not s.get("discord_alerts", True):
        return "alerts disabled"
    en_daily = bool(s.get("alert_daily_loss", True))
    en_maxdd = bool(s.get("alert_max_dd", True))
    en_target = bool(s.get("alert_profit_target", True))
    state = dict(s.get("prop_alert_state", {}))
    changed = alerts = 0
    with session_scope() as session:
        # refresh marks on open real trades so floating PnL in the rules is current
        from src import marketdata
        from src.models import Trade
        from sqlmodel import select as _select
        for t in session.exec(_select(Trade).where(Trade.status == "open")).all():
            if t.external_id and t.remaining_lots > 1e-9:
                p = marketdata.get_price(t.symbol)
                if p:
                    t.last_price = p
                    session.add(t)
        session.commit()

        for acc in session.exec(select(Account)).all():
            if acc.is_backtest:
                continue
            risk = compute_account_risk(acc, get_trades(session, account_id=acc.id))
            if not risk:
                continue
            level = _alert_level(risk, en_daily, en_maxdd)
            reached = bool(en_target and (risk.get("profit") or {}).get("reached"))
            sig = f"{level}:{int(reached)}"
            prev = state.get(str(acc.id))
            if sig != prev:
                if level in ("warning", "breach"):
                    notify.send_discord(webhook, notify.prop_alert_message(acc, risk))
                    eventlog.warning("prop-alert", f"{acc.name}: {level}")
                    alerts += 1
                if reached and not (prev or "").endswith(":1"):
                    notify.send_discord(webhook, notify.target_reached_message(acc, risk))
                    eventlog.success("prop-alert", f"{acc.name}: profit target reached")
                    alerts += 1
                state[str(acc.id)] = sig
                changed += 1
    if changed:
        settings_store.save({"prop_alert_state": state})
    return f"{alerts} alert(s) sent" if alerts else "no changes"


def daily_summary_job() -> str:
    s = settings_store.load()
    webhook = s.get("discord_webhook_url", "")
    if not webhook:
        return "no webhook"
    with session_scope() as session:
        notify.send_discord(webhook, notify.daily_summary_message(session))
    return "summary posted"


def db_backup_job() -> str:
    """Nightly SQLite backup into data/backups (online backup API, WAL-safe), keep last 14."""
    s = settings_store.load()
    if not s.get("db_backups", True):
        return "backups disabled"
    import sqlite3
    from src import config
    backups = config.DATA_DIR / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = tz.to_local(datetime.utcnow()).strftime("%Y%m%d-%H%M")
    dest = backups / f"journal-{stamp}.db"
    src_conn = sqlite3.connect(str(config.DB_PATH))
    try:
        dst_conn = sqlite3.connect(str(dest))
        with dst_conn:
            src_conn.backup(dst_conn)
        dst_conn.close()
    finally:
        src_conn.close()
    # rotate: newest 14 kept
    kept = sorted(backups.glob("journal-*.db"), reverse=True)
    for old in kept[14:]:
        try:
            old.unlink()
        except Exception:  # noqa: BLE001
            pass
    return f"backed up to {dest.name} ({len(kept[:14])} kept)"


# job registry: id -> (label, function)
JOBS = {
    "ctrader_autosync": ("cTrader auto-sync", autosync_job),
    "candle_collect": ("Candle collection (Binance / Yahoo)", candle_collect_job),
    "position_watch": ("Position watch (stop moves / swaps)", position_watch_job),
    "econ_refresh": ("Economic-calendar refresh", econ_refresh_job),
    "prop_check": ("Prop-rule / target alerts", prop_check_job),
    "daily_summary": ("Daily Discord summary", daily_summary_job),
    "db_backup": ("Nightly database backup", db_backup_job),
}


def _tracked(job_id: str):
    """Wrap a job so its run is timed, logged, and recorded for the Tasks page."""
    label, fn = JOBS[job_id]

    def wrapper():
        start = time.time()
        try:
            result = fn()
            dur = time.time() - start
            msg = result if isinstance(result, str) else f"{label} finished"
            LAST_RUN[job_id] = {"last_run": start, "status": "ok", "message": msg, "duration": dur}
            eventlog.success(job_id, f"{label}: {msg} ({dur:.1f}s)")
        except Exception as e:  # noqa: BLE001
            dur = time.time() - start
            LAST_RUN[job_id] = {"last_run": start, "status": "error", "message": str(e), "duration": dur}
            eventlog.error(job_id, f"{label} failed: {e}")

    return wrapper


def run_job_now(job_id: str) -> bool:
    """Trigger a scheduled job immediately in a background thread."""
    if job_id not in JOBS:
        return False
    import threading
    threading.Thread(target=_tracked(job_id), daemon=True).start()
    return True


def list_jobs() -> list:
    jobs = {j.id: j for j in scheduler.get_jobs()}
    out = []
    for jid, (label, _fn) in JOBS.items():
        j = jobs.get(jid)
        lr = LAST_RUN.get(jid, {})
        out.append({
            "id": jid, "label": label,
            "scheduled": j is not None,
            "next_run": j.next_run_time.timestamp() if (j and j.next_run_time) else None,
            "trigger": str(j.trigger) if j else None,
            "last_run": lr.get("last_run"), "last_status": lr.get("status"),
            "last_message": lr.get("message"), "last_duration": lr.get("duration"),
        })
    return out


def _clear(job_id):
    try:
        scheduler.remove_job(job_id)
    except Exception:
        pass


def reschedule() -> None:
    s = settings_store.load()

    _clear(JOB_ID)
    mins = int(s.get("ctrader_autosync_minutes", 0) or 0)
    if mins > 0:
        scheduler.add_job(_tracked(JOB_ID), "interval", minutes=mins, id=JOB_ID, replace_existing=True)
        eventlog.info("scheduler", f"cTrader auto-sync every {mins} min")

    _clear("prop_check")
    if s.get("discord_webhook_url") and s.get("discord_alerts", True):
        scheduler.add_job(_tracked("prop_check"), "interval", minutes=5, id="prop_check", replace_existing=True)

    _clear("daily_summary")
    hour = int(s.get("daily_summary_hour", -1))
    if s.get("discord_webhook_url") and 0 <= hour <= 23:
        scheduler.add_job(_tracked("daily_summary"), "cron", hour=hour, minute=0,
                          timezone=tz.app_tz(), id="daily_summary", replace_existing=True)
        eventlog.info("scheduler", f"Daily Discord summary at {hour:02d}:00 {tz.app_tz()}")

    _clear("db_backup")
    if s.get("db_backups", True):
        scheduler.add_job(_tracked("db_backup"), "cron", hour=3, minute=30,
                          timezone=tz.app_tz(), id="db_backup", replace_existing=True)

    _clear("candle_collect")
    if s.get("candle_autostore", True):
        cmins = max(5, int(s.get("candle_collect_minutes", 30) or 30))
        scheduler.add_job(_tracked("candle_collect"), "interval", minutes=cmins, id="candle_collect", replace_existing=True)
        eventlog.info("scheduler", f"Candle auto-collect every {cmins} min")

    _clear("position_watch")
    if s.get("position_watch", True):
        pmins = max(1, int(s.get("position_watch_minutes", 3) or 3))
        scheduler.add_job(_tracked("position_watch"), "interval", minutes=pmins,
                          id="position_watch", replace_existing=True)
        eventlog.info("scheduler", f"Position watch every {pmins} min")

    _clear("econ_refresh")
    if s.get("econ_calendar", True):
        hrs = max(1, int(s.get("econ_refresh_hours", 6) or 6))
        scheduler.add_job(_tracked("econ_refresh"), "interval", hours=hrs, id="econ_refresh", replace_existing=True)
        eventlog.info("scheduler", f"Economic-calendar refresh every {hrs}h")


def _backfill_sessions() -> None:
    """Fill in `sessions` for trades that predate multi-session support."""
    from sqlmodel import select as _sel
    from src import sessions as sess
    from src.models import Trade
    try:
        with session_scope() as session:
            rows = session.exec(_sel(Trade)).all()
            n = 0
            for t in rows:
                if t.sessions:
                    continue
                t.sessions = sess.normalise(t.session) or sess.classify(t.opened_at)
                session.add(t)
                n += 1
            if n:
                session.commit()
                eventlog.info("sessions", f"backfilled sessions on {n} trade(s)")
    except Exception as e:  # noqa: BLE001
        eventlog.warning("sessions", f"backfill failed: {e}")


def _initial_candle_backfill() -> None:
    try:
        from src import candlestore
        with session_scope() as session:
            candlestore.collect_pending(session)
    except Exception as e:  # noqa: BLE001
        eventlog.warning("candles", f"initial backfill failed: {e}")


def start() -> None:
    if not scheduler.running:
        scheduler.start()
    reschedule()
    s = settings_store.load()
    import threading
    threading.Thread(target=_backfill_sessions, daemon=True).start()
    if s.get("candle_autostore", True):
        threading.Thread(target=_initial_candle_backfill, daemon=True).start()
    if s.get("econ_calendar", True):
        threading.Thread(target=_tracked("econ_refresh"), daemon=True).start()


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
