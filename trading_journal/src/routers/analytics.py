"""Analytics: summary KPIs, equity curve, calendar, distributions, overview."""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from src.db import get_session
from src import metrics, tz
from src.models import Account
from src.queries import get_trades, parse_dt, portfolio_starting_balance
from src.tag_service import option_index, options_for_trades

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

CommonFilters = dict


def _parse_ids(value: Optional[str]) -> Optional[list]:
    if not value:
        return None
    out = []
    for part in str(value).split(","):
        part = part.strip()
        if part:
            try:
                out.append(int(part))
            except ValueError:
                pass
    return out or None


def _filters(
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    direction: Optional[str] = None,
    setup: Optional[str] = None,
    session_name: Optional[str] = Query(None, alias="session"),
    tag: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    search: Optional[str] = None,
    tag_option_ids: Optional[str] = None,
    tag_match: str = "all",
) -> CommonFilters:
    return dict(
        account_id=account_id, status=status, symbol=symbol, direction=direction,
        setup=setup, session_name=session_name, tag=tag,
        start=parse_dt(start), end=parse_dt(end), search=search,
        tag_option_ids=_parse_ids(tag_option_ids), tag_match=tag_match,
    )


@router.get("/summary")
def summary(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    trades = get_trades(session, **f)
    return metrics.summary_stats(trades)


@router.get("/equity")
def equity(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    trades = get_trades(session, **f)
    sb = portfolio_starting_balance(session, f["account_id"])
    return metrics.equity_curve(trades, sb)


@router.get("/calendar")
def calendar(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    trades = get_trades(session, **f)
    return metrics.calendar(trades)


@router.get("/distribution")
def distribution(
    by: str = "symbol",
    f: CommonFilters = Depends(_filters),
    session: Session = Depends(get_session),
):
    trades = get_trades(session, **f)
    return metrics.distribution(trades, by)


@router.get("/r-distribution")
def r_distribution(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    trades = get_trades(session, **f)
    return metrics.r_distribution(trades)


@router.get("/tags")
def tag_performance(
    min_trades: int = 1,
    f: CommonFilters = Depends(_filters),
    session: Session = Depends(get_session),
):
    """Per-category / per-option performance drill-down over the filtered trades."""
    all_trades = get_trades(session, **f)
    trades = [t for t in all_trades if t.status == "closed"]
    idx = option_index(session)
    opt_map = options_for_trades(session, [t.id for t in trades])

    # Stats need a realized result, so open trades are excluded — but if ALL the tagged
    # trades are still open the page looks broken. Count them so the UI can say why.
    open_ids = [t.id for t in all_trades if t.status == "open"]
    open_tagged = len([tid for tid, opts in options_for_trades(session, open_ids).items() if opts])

    from collections import defaultdict
    by_opt = defaultdict(list)
    for t in trades:
        for oid in opt_map.get(t.id, []):
            by_opt[oid].append(t)

    cats: dict = {}
    for oid, ts in by_opt.items():
        meta = idx.get(oid)
        if not meta or len(ts) < min_trades:
            continue
        s = metrics.summary_stats(ts)
        row = {
            "option_id": oid, "name": meta["name"],
            "trades": s["trade_count"], "net_pnl": s["net_pnl"],
            "win_rate": s["win_rate"], "expectancy": s["expectancy"],
            "avg_r": s["avg_r"], "wins": s["wins"], "losses": s["losses"],
            "profit_factor": s["profit_factor"],
        }
        cat = cats.setdefault(meta["category_id"], {
            "category_id": meta["category_id"], "name": meta["category_name"],
            "color": meta["category_color"], "options": [],
        })
        cat["options"].append(row)

    categories = sorted(cats.values(), key=lambda c: (c["name"] or ""))
    for c in categories:
        c["options"].sort(key=lambda r: r["net_pnl"], reverse=True)
        c["net_pnl"] = sum(o["net_pnl"] for o in c["options"])
    flat = [o for c in categories for o in c["options"]]
    return {"categories": categories, "flat": flat,
            "open_tagged": open_tagged, "closed_count": len(trades)}


@router.get("/playbooks")
def playbook_performance(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    """Per-playbook performance + win rate bucketed by checklist adherence."""
    from collections import defaultdict
    from statistics import mean
    from src.models import Playbook

    trades = [t for t in get_trades(session, **f) if t.status == "closed"]
    pbs = {p.id: p for p in session.exec(select(Playbook)).all()}

    def adherence(t):
        cl = t.checklist or []
        return (sum(1 for c in cl if c.get("checked")) / len(cl)) if cl else None

    groups = defaultdict(list)
    for t in trades:
        if t.playbook_id:
            groups[t.playbook_id].append(t)

    playbooks = []
    for pid, ts in groups.items():
        p = pbs.get(pid)
        s = metrics.summary_stats(ts)
        adhs = [a for a in (adherence(t) for t in ts) if a is not None]
        playbooks.append({
            "playbook_id": pid, "name": p.name if p else str(pid), "color": p.color if p else "#888",
            "trades": s["trade_count"], "net_pnl": s["net_pnl"], "win_rate": s["win_rate"],
            "expectancy": s["expectancy"], "avg_r": s["avg_r"],
            "avg_adherence": (mean(adhs) * 100 if adhs else None),
        })
    playbooks.sort(key=lambda r: r["net_pnl"], reverse=True)

    buckets = {"< 50%": [], "50–80%": [], "≥ 80%": []}
    for t in trades:
        a = adherence(t)
        if a is None:
            continue
        key = "< 50%" if a < 0.5 else ("50–80%" if a < 0.8 else "≥ 80%")
        buckets[key].append(t)
    bucket_rows = []
    for label, ts in buckets.items():
        s = metrics.summary_stats(ts) if ts else None
        bucket_rows.append({
            "bucket": label, "trades": len(ts),
            "win_rate": s["win_rate"] if s else None,
            "net_pnl": s["net_pnl"] if s else 0.0,
            "avg_r": s["avg_r"] if s else None,
        })
    return {"playbooks": playbooks, "adherence_buckets": bucket_rows}


@router.get("/review")
def review(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    """Composed period review: stats, daily, best/worst trades, mistakes, setups."""
    from collections import Counter

    accounts = {a.id: a for a in session.exec(select(Account)).all()}
    trades = get_trades(session, **f)
    closed = [t for t in trades if t.status == "closed"]

    def brief(t):
        return {
            "id": t.id, "symbol": t.symbol, "direction": t.direction,
            "realized_pnl": t.realized_pnl, "r_multiple": t.r_multiple,
            "closed_at": tz.iso_utc(t.closed_at or t.opened_at),
            "setup": t.setup, "account": accounts[t.account_id].name if t.account_id in accounts else None,
        }

    by_pnl = sorted(closed, key=lambda t: t.realized_pnl)
    worst = [brief(t) for t in by_pnl[:5]]
    best = [brief(t) for t in reversed(by_pnl[-5:])]

    mc = Counter()
    for t in closed:
        for m in (t.mistakes or []):
            mc[m] += 1
    mistakes = [{"mistake": k, "count": v} for k, v in mc.most_common(10)]

    return {
        "summary": metrics.summary_stats(closed),
        "calendar": metrics.calendar(closed),
        "best_trades": best,
        "worst_trades": worst,
        "mistakes": mistakes,
        "by_setup": metrics.distribution(closed, "setup"),
        "open_count": len([t for t in trades if t.status == "open"]),
    }


@router.get("/exit-optimiser")
def exit_optimiser(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    """
    What-if fixed R-target simulation (à la Edgewonk's trade-management optimiser).

    For each candidate target T (in R), simulate each closed trade assuming a fixed
    1R stop: if MAE reached 1R it stops (-1R); else if MFE reached T it banks +T;
    otherwise your actual result stands. Uses the cached per-trade MAE/MFE (view a
    trade or run recompute-excursions to populate).
    """
    from statistics import mean

    trades = [t for t in get_trades(session, **f)
              if t.status == "closed" and t.mfe_r is not None]
    n = len(trades)
    targets = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]
    rows = []
    for T in targets:
        rs = []
        for t in trades:
            if t.mae_r is not None and t.mae_r >= 1.0:
                r = -1.0
            elif t.mfe_r is not None and t.mfe_r >= T:
                r = T
            else:
                r = t.r_multiple if t.r_multiple is not None else 0.0
            rs.append(r)
        exp = mean(rs) if rs else 0.0
        wins = len([r for r in rs if r > 0])
        rows.append({"target_r": T, "expectancy_r": exp, "win_rate": (wins / len(rs) * 100.0) if rs else 0.0})

    r_vals = [t.r_multiple for t in trades if t.r_multiple is not None]
    caps = [t.captured_pct for t in trades if t.captured_pct is not None]
    return {
        "count": n,
        "targets": rows,
        "current_expectancy_r": mean(r_vals) if r_vals else None,
        "best": max(rows, key=lambda r: r["expectancy_r"]) if rows else None,
        "avg_mfe_r": mean([t.mfe_r for t in trades]) if trades else None,
        "avg_mae_r": mean([t.mae_r for t in trades if t.mae_r is not None]) if trades else None,
        "avg_capture": mean(caps) if caps else None,
    }


MISSING_FIELDS = [
    {"key": "tags", "label": "Analysis tags"},
    {"key": "setup", "label": "Setup"},
    {"key": "timeframe", "label": "Timeframe"},
    {"key": "rating", "label": "Rating"},
    {"key": "notes", "label": "Notes"},
    {"key": "initial_stop", "label": "Stop"},
    {"key": "playbook_id", "label": "Playbook"},
    {"key": "confidence", "label": "Confidence"},
]


@router.get("/missing")
def missing_data(f: CommonFilters = Depends(_filters), include_ignored: bool = False,
                 session: Session = Depends(get_session)):
    """Trades with journal fields left blank, so they can be filled in from one screen."""
    accounts = {a.id: a for a in session.exec(select(Account)).all()}
    trades = get_trades(session, **f)
    opt_map = options_for_trades(session, [t.id for t in trades])

    rows, counts = [], {m["key"]: 0 for m in MISSING_FIELDS}
    ignored = 0
    for t in trades:
        if t.data_ignored:
            ignored += 1
            if not include_ignored:
                continue
        missing = []
        if not opt_map.get(t.id):
            missing.append("tags")
        for key in ("setup", "timeframe", "notes"):
            if not getattr(t, key, None):
                missing.append(key)
        if not t.rating:
            missing.append("rating")
        if not t.confidence:
            missing.append("confidence")
        if t.initial_stop is None:
            missing.append("initial_stop")
        if not t.playbook_id:
            missing.append("playbook_id")
        if not missing and not t.data_ignored:
            continue
        for k in missing:
            counts[k] = counts.get(k, 0) + 1
        acc = accounts.get(t.account_id)
        rows.append({
            "id": t.id, "symbol": t.symbol, "direction": t.direction, "status": t.status,
            "opened_at": tz.iso_utc(t.opened_at), "closed_at": tz.iso_utc(t.closed_at),
            "realized_pnl": t.realized_pnl, "r_multiple": t.r_multiple,
            "account": acc.name if acc else None, "account_color": acc.color if acc else None,
            "missing": missing, "missing_count": len(missing),
            "data_ignored": bool(t.data_ignored),
        })

    rows.sort(key=lambda r: (-r["missing_count"], r["opened_at"] or ""))
    complete = len(trades) - len([r for r in rows if not r["data_ignored"]]) - (0 if include_ignored else ignored)
    return {
        "fields": MISSING_FIELDS,
        "rows": rows,
        "counts": counts,
        "total_trades": len(trades),
        "incomplete": len([r for r in rows if not r["data_ignored"]]),
        "ignored": ignored,
        "complete": max(complete, 0),
    }


@router.get("/overview")
def overview(f: CommonFilters = Depends(_filters), session: Session = Depends(get_session)):
    """One call that powers the dashboard."""
    trades = get_trades(session, **f)
    sb = portfolio_starting_balance(session, f["account_id"])

    # per-account breakdown (net pnl / count) within the filtered set
    accounts = {a.id: a for a in session.exec(select(Account)).all()}
    per_account = {}
    for t in trades:
        if t.status != "closed":
            continue
        a = accounts.get(t.account_id)
        row = per_account.setdefault(t.account_id, {
            "account_id": t.account_id,
            "name": a.name if a else str(t.account_id),
            "color": a.color if a else "#888",
            "net_pnl": 0.0, "trades": 0,
        })
        row["net_pnl"] += t.realized_pnl
        row["trades"] += 1

    open_trades = [t for t in trades if t.status == "open"]

    # aggregate excursion analytics (from cached per-trade MAE/MFE; view a trade to populate)
    from statistics import mean
    closed = [t for t in trades if t.status == "closed"]
    mfe_rs = [t.mfe_r for t in closed if t.mfe_r is not None]
    mae_rs = [t.mae_r for t in closed if t.mae_r is not None]
    caps = [t.captured_pct for t in closed if t.captured_pct is not None]
    left = [t.left_on_table_r for t in closed if t.left_on_table_r is not None]
    excursions = {
        "avg_mfe_r": mean(mfe_rs) if mfe_rs else None,
        "avg_mae_r": mean(mae_rs) if mae_rs else None,
        "avg_capture": mean(caps) if caps else None,
        "avg_left_r": mean(left) if left else None,
        "left_money_pct": (len([x for x in left if x > 0.5]) / len(left) * 100) if left else None,
        "count": len(mfe_rs),
    }

    summary = metrics.summary_stats(trades)
    closed_sorted = sorted(closed, key=lambda t: t.closed_at or t.opened_at)
    last5 = [{
        "result": ("W" if t.realized_pnl > 1e-9 else "L" if t.realized_pnl < -1e-9 else "B"),
        "r": t.r_multiple, "pnl": t.realized_pnl, "trade_id": t.id,
    } for t in closed_sorted[-5:]]
    roi = (summary["net_pnl"] / sb * 100.0) if sb else None

    return {
        "summary": summary,
        "roi": roi,
        "last5": last5,
        "excursions": excursions,
        "equity": metrics.equity_curve(trades, sb),
        "calendar": metrics.calendar(trades),
        "by_symbol": metrics.distribution(trades, "symbol"),
        "by_setup": metrics.distribution(trades, "setup"),
        "by_session": metrics.distribution(trades, "session"),
        "by_dow": metrics.distribution(trades, "dow"),
        "by_hour": metrics.distribution(trades, "hour"),
        "r_distribution": metrics.r_distribution(trades),
        "per_account": sorted(per_account.values(), key=lambda r: r["net_pnl"], reverse=True),
        "open_count": len(open_trades),
        "starting_balance": sb,
    }
