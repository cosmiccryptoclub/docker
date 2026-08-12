"""
Dummy-data generator.

Produces realistic trades that mirror how you actually trade on cTrader:
scale-in entries (multi-position hotkeys) + up to 4 partial take-profits
(ATP1-4), stop-outs, break-evens and a few still-open positions, spread across
FundingPips / FTMO / demo accounts.

Run standalone:
    python -m src.seed            # wipe + reseed
    python -m src.seed --if-empty # only seed if there are no accounts yet
    python -m src.seed --reset    # explicit wipe + reseed

Or call generate(session, ...) from the /api/admin endpoints.
"""
from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta
from typing import List, Tuple

from sqlmodel import Session, select

from src.candles import build_chart, persist_excursions
from src.db import engine, init_db
from src.metrics import recompute_trade
from src.models import (
    Account, Fill, Playbook, Symbol, TagCategory, TagOption, Trade, TradeTagLink,
)

# --- reference data ----------------------------------------------------------

SYMBOLS = [
    {"name": "BTCUSD", "category": "crypto", "contract_size": 1.0, "pip_size": 1.0, "price_decimals": 1},
    {"name": "ETHUSD", "category": "crypto", "contract_size": 1.0, "pip_size": 0.1, "price_decimals": 2},
    {"name": "XAUUSD", "category": "commodities", "contract_size": 100.0, "pip_size": 0.1, "price_decimals": 2},
    {"name": "NAS100", "category": "indices", "contract_size": 1.0, "pip_size": 0.25, "price_decimals": 2},
]

# per-symbol generation ranges: price, per-leg move, stop distance, lot size, contract size
SYM_CFG = {
    "BTCUSD": {"px": (92000, 118000), "move": (150, 1800), "stop": (200, 900), "lots": (0.05, 0.60), "cs": 1.0, "dec": 1},
    "ETHUSD": {"px": (2800, 4200), "move": (8, 90), "stop": (10, 45), "lots": (0.30, 3.00), "cs": 1.0, "dec": 2},
    "XAUUSD": {"px": (2300, 2700), "move": (3, 30), "stop": (4, 15), "lots": (0.05, 0.50), "cs": 100.0, "dec": 2},
    "NAS100": {"px": (17000, 21000), "move": (15, 160), "stop": (20, 80), "lots": (0.20, 2.00), "cs": 1.0, "dec": 2},
}
SYM_WEIGHTS = {"BTCUSD": 0.55, "ETHUSD": 0.20, "XAUUSD": 0.12, "NAS100": 0.13}

# Account colors are a categorical (identity) palette, validated for CVD/normal-vision
# separation on the dark chart surface (dataviz skill). Green/red are intentionally
# left out so they don't clash with profit/loss semantics.
ACCOUNTS = [
    {"name": "FundingPips 100k (Funded)", "account_type": "prop-funded", "prop_firm": "FundingPips", "starting_balance": 100_000, "color": "#3b82f6",
     "daily_loss_limit": 5_000, "max_loss_limit": 10_000, "trailing_dd": False},
    {"name": "FundingPips 100k (Challenge)", "account_type": "prop-challenge", "prop_firm": "FundingPips", "starting_balance": 100_000, "color": "#a855f7",
     "daily_loss_limit": 5_000, "max_loss_limit": 10_000, "profit_target": 8_000, "trailing_dd": False},
    {"name": "FTMO 100k (Funded)", "account_type": "prop-funded", "prop_firm": "FTMO", "starting_balance": 100_000, "color": "#22d3ee",
     "daily_loss_limit": 5_000, "max_loss_limit": 10_000, "trailing_dd": True},
    {"name": "cTrader Demo A", "account_type": "demo", "prop_firm": None, "starting_balance": 50_000, "color": "#ec4899"},
    {"name": "cTrader Demo B", "account_type": "demo", "prop_firm": None, "starting_balance": 25_000, "color": "#eab308"},
]

DAY_PLANS = [
    "Asia range mapped. Only trading the London sweep of it — no chasing.",
    "CPI at 13:30. Flat into the print, then trade the reaction from the reclaim.",
    "Trend day expected. Buy pullbacks into VWAP, no counter-trend shorts.",
    "Low conviction — half size, two trades max, done by lunch.",
    "NY open sweep of the overnight high is the only setup I want today.",
]
DAY_NOTES = [
    "Followed the plan for the first two trades then forced a third. That one lost.",
    "Clean session. Took what was there and stopped when the range went quiet.",
    "Choppy tape, cut size early — right call.",
    "Missed the main move waiting for a perfect entry that never came.",
    "Good execution, patient entries, let the runner work.",
]
DAY_LESSONS = [
    "Stop adding to losers — the third entry is always the mistake.",
    "When the range is under 40 points, walk away.",
    "Wait for the reclaim candle to close before entering.",
    "Size down after two losses in a row.",
    "Do not trade the first five minutes of the NY open.",
]

SETUPS = ["London reclaim", "NY open sweep", "Asia range break", "Liquidity grab", "Trend continuation", "Failed breakout", "VWAP bounce", "Session high/low"]
SESSIONS = ["Asia", "London", "New York"]
TIMEFRAMES = ["1m", "5m", "15m", "1h"]
TAG_POOL = ["A+ setup", "news", "counter-trend", "scalp", "swing", "revenge", "fomo", "planned", "high-conviction", "chop"]
MISTAKE_POOL = ["moved stop", "no stop", "oversized", "chased entry", "early exit", "held too long", "traded news", "revenge trade"]
NOTES_POOL = [
    "Clean setup, executed the plan.",
    "Scaled in on the retest, worked well.",
    "Took first TP too early, left money on the table.",
    "Should not have added to the loser.",
    "Good patience waiting for confirmation.",
    "Choppy conditions, small size was right.",
    "News spike stopped me, size was fine.",
    "",
]

# session hour windows (UTC-ish) used to place opened_at realistically
SESSION_HOURS = {"Asia": (0, 6), "London": (7, 11), "New York": (13, 20)}

# --- default tag taxonomy (cleaned from the user's TA + Exocharts lists) ------
TAXONOMY = [
    {"name": "Technical Analysis", "color": "#3b82f6", "multi": True, "options": [
        "Value Area (AMT)", "High/Low Volume Node", "Market Structure", "Anchored VWAP",
        "Order Block", "Fib Ext 1:1", "Fib Ext 1:2", "Golden Zone",
        "Symmetry / Balance Zone", "VWAP Close", "Key Level", "D/W/M Level",
        "CME Gap", "Fair Value Gap", "VWAP"]},
    {"name": "Order Flow (Exocharts)", "color": "#a855f7", "multi": True, "options": [
        "nPOC", "Composite nPOC", "Session nPOC", "TPOC", "vPOC",
        "Single Print", "Buying Tail", "Selling Tail", "Trapped Traders", "Volume Threshold"]},
    {"name": "Liquidity", "color": "#22d3ee", "multi": True, "options": [
        "SFP", "Low Liquidity Grab", "Medium Liquidity Grab", "Large Liquidity Grab",
        "10M+ Liquidation", "20M+ Liquidation", "Trapped Long", "Trapped Short"]},
    {"name": "Market Regime", "color": "#eab308", "multi": False, "options": [
        "Trending Up", "Trending Down", "Ranging", "With Trend", "Counter Trend"]},
    {"name": "News & Events", "color": "#f97316", "multi": True, "options": [
        "Bullish News", "Bearish News", "High-Impact News", "No News"]},
    {"name": "Psychology", "color": "#ec4899", "multi": True, "options": [
        "A+ Conviction", "Planned", "Disciplined", "FOMO", "Revenge", "Hesitation", "Chased Entry"]},
]

# tags that (in the dummy data) skew toward winners / losers, so the tag-insights
# drill-down shows a real signal instead of noise.
GOOD_TAGS = {"A+ Conviction", "Planned", "Disciplined", "Order Block", "With Trend",
             "Golden Zone", "Value Area (AMT)", "Key Level"}
BAD_TAGS = {"FOMO", "Revenge", "Chased Entry", "Hesitation", "Counter Trend",
            "Trapped Long", "Trapped Short", "High-Impact News"}

PLAYBOOKS = [
    {"name": "Scalp — Liquidity Grab", "color": "#22d3ee", "rules": [
        "HTF bias clear", "Liquidity swept", "Confirmation candle", "Stop beyond the sweep",
        "Risk ≤ 1%", "Session active (London/NY)"]},
    {"name": "Swing — Trend Continuation", "color": "#3b82f6", "rules": [
        "Trend intact on HTF", "Pullback into value / OB", "Confluence (FVG / vPOC)",
        "Stop beyond structure", "Risk ≤ 1%", "No high-impact news soon"]},
    {"name": "Reversal — SFP", "color": "#a855f7", "rules": [
        "Clear liquidity pool", "Swing failure pattern", "Reclaim of level",
        "Divergence / exhaustion", "Stop beyond the wick", "Defined invalidation"]},
]


def _weighted_choice(rng: random.Random, weights: dict) -> str:
    keys = list(weights.keys())
    return rng.choices(keys, weights=[weights[k] for k in keys], k=1)[0]


def _sessions_for(opened_at: datetime) -> List[str]:
    """Real overlapping sessions, same rule the app applies to synced trades."""
    from src import sessions as sess
    return sess.classify(opened_at)


def _round(v: float, dec: int) -> float:
    return round(v, dec)


def _split_lots(rng: random.Random, total: float, parts: int) -> List[float]:
    """Split `total` lots into `parts` positive chunks, rounded to 2dp, summing to total."""
    if parts <= 1:
        return [round(total, 2)]
    weights = [rng.uniform(0.5, 1.5) for _ in range(parts)]
    s = sum(weights)
    chunks = [round(total * w / s, 2) for w in weights]
    # fix rounding drift on the last chunk
    drift = round(total - sum(chunks), 2)
    chunks[-1] = round(chunks[-1] + drift, 2)
    chunks = [max(c, 0.01) for c in chunks]
    return chunks


def _make_trade(rng: random.Random, account: Account, opened_at: datetime) -> Tuple[Trade, List[Fill]]:
    sym = _weighted_choice(rng, SYM_WEIGHTS)
    cfg = SYM_CFG[sym]
    dec = cfg["dec"]
    direction = "long" if rng.random() < 0.55 else "short"
    sign = 1.0 if direction == "long" else -1.0

    entry_base = rng.uniform(*cfg["px"])
    total_lots = round(rng.uniform(*cfg["lots"]), 2)
    total_lots = max(total_lots, 0.02)

    # --- scale-in entries (your multi-position hotkeys) ---------------------
    n_entries = rng.choices([1, 2, 3], weights=[0.45, 0.35, 0.20])[0]
    entry_lots = _split_lots(rng, total_lots, n_entries)
    fills: List[Fill] = []
    t = opened_at
    entry_prices = []
    for i, lots in enumerate(entry_lots):
        # scale-ins cluster around the base within a fraction of the move range
        px = _round(entry_base + rng.uniform(-1, 1) * cfg["move"][0] * 0.6, dec)
        entry_prices.append((px, lots))
        fills.append(Fill(kind="entry", price=px, lots=lots, executed_at=t,
                          fee=round(lots * 2.2, 2)))
        t = t + timedelta(minutes=rng.randint(1, 9))

    avg_entry = sum(p * l for p, l in entry_prices) / sum(l for _, l in entry_prices)
    stop_dist = rng.uniform(*cfg["stop"])
    initial_stop = _round(avg_entry - sign * stop_dist, dec)

    outcome = rng.choices(
        ["win", "loss", "breakeven", "open"],
        weights=[0.50, 0.36, 0.05, 0.09],
    )[0]

    planned_targets = []
    mfe = avg_entry
    mae = avg_entry

    if outcome == "win":
        n_tp = rng.choices([2, 3, 4], weights=[0.3, 0.4, 0.3])[0]
        tp_lots = _split_lots(rng, total_lots, n_tp)
        # increasing distances, like ATP1..ATP4
        base_move = rng.uniform(*cfg["move"])
        for i in range(n_tp):
            dist = base_move * (0.6 + 0.5 * i) * rng.uniform(0.85, 1.15)
            px = _round(avg_entry + sign * dist, dec)
            t = t + timedelta(minutes=rng.randint(3, 90))
            fills.append(Fill(kind="tp", price=px, lots=tp_lots[i], executed_at=t,
                              fee=round(tp_lots[i] * 2.2, 2), note=f"ATP{i+1}"))
            planned_targets.append({"label": f"ATP{i+1}", "price": px, "lots": tp_lots[i]})
            mfe = px
        mae = _round(avg_entry - sign * stop_dist * rng.uniform(0.1, 0.6), dec)

    elif outcome == "loss":
        # sometimes bank one small TP before getting stopped on the rest
        remaining = total_lots
        if rng.random() < 0.30:
            part = round(total_lots * rng.uniform(0.2, 0.4), 2)
            part = min(max(part, 0.01), total_lots - 0.01)
            px = _round(avg_entry + sign * rng.uniform(*cfg["move"]) * 0.7, dec)
            t = t + timedelta(minutes=rng.randint(3, 40))
            fills.append(Fill(kind="tp", price=px, lots=part, executed_at=t,
                              fee=round(part * 2.2, 2), note="ATP1"))
            mfe = px
            remaining = round(total_lots - part, 2)
        sl_px = _round(initial_stop + rng.uniform(-1, 1) * cfg["move"][0] * 0.15, dec)
        t = t + timedelta(minutes=rng.randint(5, 120))
        fills.append(Fill(kind="sl", price=sl_px, lots=remaining, executed_at=t,
                          fee=round(remaining * 2.2, 2), note="stopped out"))
        mae = sl_px

    elif outcome == "breakeven":
        px = _round(avg_entry + sign * rng.uniform(-0.1, 0.1) * cfg["move"][0], dec)
        t = t + timedelta(minutes=rng.randint(5, 60))
        fills.append(Fill(kind="close", price=px, lots=total_lots, executed_at=t,
                          fee=round(total_lots * 2.2, 2), note="scratched"))

    # outcome == "open": leave entries only (optionally one partial TP)
    last_price = None
    if outcome == "open":
        if rng.random() < 0.4:
            part = round(total_lots * rng.uniform(0.2, 0.5), 2)
            part = min(max(part, 0.01), total_lots - 0.01)
            px = _round(avg_entry + sign * rng.uniform(*cfg["move"]) * 0.6, dec)
            t = t + timedelta(minutes=rng.randint(3, 60))
            fills.append(Fill(kind="tp", price=px, lots=part, executed_at=t,
                              fee=round(part * 2.2, 2), note="ATP1"))
        last_price = _round(avg_entry + sign * rng.uniform(-1, 1.4) * cfg["move"][0], dec)

    trade = Trade(
        account_id=account.id,
        symbol=sym,
        direction=direction,
        opened_at=opened_at,
        contract_size=cfg["cs"],
        initial_stop=initial_stop,
        initial_target=(planned_targets[0]["price"] if planned_targets else None),
        planned_targets=planned_targets,
        last_price=last_price,
        setup=rng.choice(SETUPS),
        sessions=_sessions_for(opened_at),
        timeframe=rng.choice(TIMEFRAMES),
        confidence=rng.choice([None, 2, 3, 3, 4, 4, 5]),
        tags=rng.sample(TAG_POOL, k=rng.randint(0, 3)),
        rating=rng.choice([None, 2, 3, 3, 4, 4, 5]),
        notes=rng.choice(NOTES_POOL) or None,
        mistakes=(rng.sample(MISTAKE_POOL, k=rng.randint(0, 2)) if outcome == "loss" else []),
        mae_price=mae,
        mfe_price=mfe,
        external_id=None,
    )
    return trade, fills


def generate(session: Session, reset: bool = True, per_account: Tuple[int, int] = (32, 68),
             days: int = 90, rng_seed: int | None = None,
             account_id: int | None = None, count: int | None = None) -> dict:
    """Generate demo trades.

    account_id=None  -> the original behaviour: build the demo accounts (and, with
                        reset=True, wipe first).
    account_id=<id>  -> add trades to that existing account only. Never wipes, never
                        creates accounts, and reuses whatever tag groups/playbooks are
                        already configured so your own taxonomy is exercised rather than
                        duplicated. Seeded trades get a "seed-" external_id so they can
                        be told apart from synced ones.
    """
    rng = random.Random(rng_seed)
    target = session.get(Account, account_id) if account_id else None
    if account_id and not target:
        raise ValueError(f"Account {account_id} not found")
    if target:
        reset = False

    if reset:
        for model in (TradeTagLink, TagOption, TagCategory, Fill, Trade, Playbook, Account, Symbol):
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()

    if target:
        accounts: List[Account] = [target]
    else:
        # symbols
        for s in SYMBOLS:
            session.add(Symbol(**s))
        # accounts
        accounts = []
        for a in ACCOUNTS:
            acc = Account(broker="cTrader", currency="USD", **a)
            session.add(acc)
            accounts.append(acc)
        session.commit()
        for acc in accounts:
            session.refresh(acc)

    # tag taxonomy + pools
    cat_option_ids: dict = {}
    good_ids: List[int] = []
    bad_ids: List[int] = []
    single_select: List[set] = []          # option-id sets for single-select groups
    existing_cats = session.exec(select(TagCategory)).all() if target else []
    if existing_cats:
        # your own groups — exercise those instead of duplicating the built-in set
        for c in existing_cats:
            ids = [o.id for o in c.options if o.is_active]
            if ids:
                cat_option_ids[c.name] = ids
                if not c.multi:
                    single_select.append(set(ids))
            for o in c.options:
                if o.name in GOOD_TAGS:
                    good_ids.append(o.id)
                if o.name in BAD_TAGS:
                    bad_ids.append(o.id)
    for ci, cat in enumerate([] if existing_cats else TAXONOMY):
        c = TagCategory(name=cat["name"], color=cat["color"], multi=cat["multi"], sort=ci)
        session.add(c)
        session.flush()
        ids = []
        for oi, name in enumerate(cat["options"]):
            o = TagOption(category_id=c.id, name=name, sort=oi)
            session.add(o)
            session.flush()
            ids.append(o.id)
            if name in GOOD_TAGS:
                good_ids.append(o.id)
            if name in BAD_TAGS:
                bad_ids.append(o.id)
        cat_option_ids[cat["name"]] = ids
        if not cat["multi"]:
            single_select.append(set(ids))
    # playbooks — reuse yours if you already have some
    playbook_defs = []
    if target:
        for p_ in session.exec(select(Playbook)).all():
            playbook_defs.append((p_.id, p_.rules or []))
    for pi, pb in enumerate([] if playbook_defs else PLAYBOOKS):
        p = Playbook(name=pb["name"], color=pb["color"], rules=pb["rules"], sort=pi)
        session.add(p)
        session.flush()
        playbook_defs.append((p.id, pb["rules"]))
    session.commit()

    now = datetime.utcnow()
    total_trades = 0
    for acc in accounts:
        n = count if count else rng.randint(*per_account)
        for _ in range(n):
            day_offset = rng.randint(0, days)
            sess = rng.choice(list(SESSION_HOURS))
            h0, h1 = SESSION_HOURS[sess]
            opened_at = (now - timedelta(days=day_offset)).replace(
                hour=rng.randint(h0, h1), minute=rng.randint(0, 59), second=0, microsecond=0
            )
            trade, fills = _make_trade(rng, acc, opened_at)
            # marker so seeded rows are distinguishable from synced ones
            trade.external_id = f"seed-{rng.getrandbits(48):012x}"
            session.add(trade)
            session.flush()
            for f in fills:
                f.trade_id = trade.id
                session.add(f)
            session.flush()
            session.refresh(trade)
            recompute_trade(trade, acc.starting_balance)
            # cache excursion metrics from synthetic candles (dummy data => no network)
            if trade.status == "closed":
                _dec = SYM_CFG.get(trade.symbol, {}).get("dec", 2)
                chart = build_chart(trade, list(trade.fills), decimals=_dec, allow_real=False)
                persist_excursions(trade, chart.get("analysis", {}))
            session.add(trade)

            # assign tag options (biased by outcome so the drill-down shows signal).
            # Category names come from whatever taxonomy is in play, so this stays
            # generic rather than hard-coding the built-in group names.
            picks = set()
            group_names = list(cat_option_ids.keys())
            rng.shuffle(group_names)
            if group_names:
                take = rng.randint(1, min(5, len(group_names)))
                for gname in group_names[:take]:
                    opts = cat_option_ids[gname]
                    if opts:
                        picks.add(rng.choice(opts))
            win = trade.realized_pnl > 0
            if win:
                if good_ids and rng.random() < 0.7:
                    for oid in rng.sample(good_ids, k=min(rng.randint(1, 2), len(good_ids))):
                        picks.add(oid)
                if bad_ids and rng.random() < 0.15:
                    picks.add(rng.choice(bad_ids))
            else:
                if bad_ids and rng.random() < 0.6:
                    for oid in rng.sample(bad_ids, k=min(rng.randint(1, 2), len(bad_ids))):
                        picks.add(oid)
                if good_ids and rng.random() < 0.2:
                    picks.add(rng.choice(good_ids))
            # enforce single-select categories (keep one, prefer the outcome-aligned tag)
            for cat_ids in single_select:
                in_cat = [oid for oid in picks if oid in cat_ids]
                if len(in_cat) > 1:
                    prefer = set(good_ids if win else bad_ids)
                    keep = next((oid for oid in in_cat if oid in prefer), in_cat[0])
                    for oid in in_cat:
                        if oid != keep:
                            picks.discard(oid)
            for oid in picks:
                session.add(TradeTagLink(trade_id=trade.id, option_id=oid))

            # playbook + checklist (adherence biased by outcome for signal)
            if playbook_defs:
                pb_id, pb_rules = rng.choice(playbook_defs)
                p_check = 0.85 if win else 0.42
                trade.playbook_id = pb_id
                trade.checklist = [{"rule": r, "checked": rng.random() < p_check} for r in (pb_rules or [])]
            session.add(trade)

            total_trades += 1
        session.commit()

    # --- daily journal entries, so the Calendar page isn't empty ---------------
    from src.models import DayNote
    from src import tz as _tz
    day_notes = 0
    traded_days = sorted({_tz.local_date(t.opened_at).isoformat()
                          for acc in accounts
                          for t in session.exec(select(Trade).where(Trade.account_id == acc.id)).all()})
    for iso in traded_days:
        if session.exec(select(DayNote).where(DayNote.date == iso)).first():
            continue
        if rng.random() > 0.65:          # journal most days, not every day
            continue
        session.add(DayNote(
            date=iso,
            plan=rng.choice(DAY_PLANS),
            notes=rng.choice(DAY_NOTES),
            lessons=rng.choice(DAY_LESSONS),
            mood=rng.choice(["calm", "focused", "confident", "anxious", "fomo", "bored"]),
            rating=rng.choice([2, 3, 3, 4, 4, 5]),
            followed_plan=rng.random() < 0.7,
        ))
        day_notes += 1
    session.commit()

    return {"accounts": len(accounts), "symbols": len(SYMBOLS),
            "trades": total_trades, "day_notes": day_notes,
            "account": accounts[0].name if target else None}


def main():
    parser = argparse.ArgumentParser(description="Seed the trade journal with dummy data.")
    parser.add_argument("--if-empty", action="store_true", help="only seed if there are no accounts")
    parser.add_argument("--reset", action="store_true", help="wipe existing data first")
    parser.add_argument("--seed", type=int, default=None, help="RNG seed for reproducibility")
    args = parser.parse_args()

    init_db()
    with Session(engine) as session:
        existing = session.exec(select(Account)).first()
        if args.if_empty and existing is not None:
            print("ℹ️  DB already has data; skipping seed (--if-empty).")
            return
        result = generate(session, reset=not args.if_empty or args.reset, rng_seed=args.seed)
        print(f"✅ Seeded: {result}")


if __name__ == "__main__":
    main()
