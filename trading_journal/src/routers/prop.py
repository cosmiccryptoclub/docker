"""Prop-firm ledger: challenge/reset fees + payouts, net profit, and tax exports."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from src import exporter
from src.db import get_session
from src.models import Account, PropTransaction

router = APIRouter(prefix="/api/prop", tags=["prop"])

# kinds that are money OUT (costs) vs money IN (income)
COSTS = {"challenge_fee", "reset_fee", "subscription", "other"}
INCOME = {"payout", "refund"}

WRITABLE = {"date", "firm", "kind", "amount", "currency", "account_id",
            "account_size", "reference", "method", "notes"}


def _dict(t: PropTransaction, account_name: Optional[str] = None) -> dict:
    return {
        "id": t.id, "date": t.date, "firm": t.firm, "kind": t.kind,
        "amount": t.amount, "currency": t.currency,
        "account_id": t.account_id, "account": account_name,
        "account_size": t.account_size, "reference": t.reference,
        "method": t.method, "notes": t.notes,
        "signed": (t.amount if t.kind in INCOME else -t.amount),
    }


def _clean(data: dict) -> dict:
    out = {k: v for k, v in data.items() if k in WRITABLE}
    if "amount" in out and out["amount"] is not None:
        out["amount"] = abs(float(out["amount"]))     # sign comes from `kind`
    if "account_size" in out and out["account_size"] in ("", None):
        out["account_size"] = None
    if "account_id" in out and out["account_id"] in ("", 0):
        out["account_id"] = None
    return out


@router.get("")
def list_transactions(firm: Optional[str] = None, year: Optional[int] = None,
                      session: Session = Depends(get_session)):
    """Ledger rows + totals (costs, payouts, net) and per-firm / per-year breakdowns."""
    accounts = {a.id: a.name for a in session.exec(select(Account)).all()}
    stmt = select(PropTransaction)
    if firm:
        stmt = stmt.where(PropTransaction.firm == firm)
    rows = list(session.exec(stmt.order_by(PropTransaction.date.desc())).all())
    if year:
        rows = [r for r in rows if r.date[:4] == str(year)]

    items = [_dict(r, accounts.get(r.account_id)) for r in rows]
    costs = sum(r.amount for r in rows if r.kind in COSTS)
    payouts = sum(r.amount for r in rows if r.kind in INCOME)

    by_firm: dict = defaultdict(lambda: {"firm": "", "costs": 0.0, "payouts": 0.0, "count": 0})
    by_year: dict = defaultdict(lambda: {"year": "", "costs": 0.0, "payouts": 0.0})
    for r in rows:
        f = by_firm[r.firm]
        f["firm"] = r.firm
        f["count"] += 1
        y = by_year[r.date[:4]]
        y["year"] = r.date[:4]
        if r.kind in INCOME:
            f["payouts"] += r.amount
            y["payouts"] += r.amount
        else:
            f["costs"] += r.amount
            y["costs"] += r.amount
    for d in list(by_firm.values()) + list(by_year.values()):
        d["net"] = d["payouts"] - d["costs"]

    return {
        "transactions": items,
        "totals": {"costs": costs, "payouts": payouts, "net": payouts - costs,
                   "count": len(rows)},
        "by_firm": sorted(by_firm.values(), key=lambda d: d["net"], reverse=True),
        "by_year": sorted(by_year.values(), key=lambda d: d["year"], reverse=True),
        "firms": sorted({r.firm for r in rows}),
    }


@router.post("")
async def create_transaction(request: Request, session: Session = Depends(get_session)):
    data = _clean(await request.json())
    if not data.get("firm") or not data.get("date"):
        raise HTTPException(400, "firm and date are required")
    tx = PropTransaction(**data)
    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _dict(tx)


@router.put("/{tx_id}")
async def update_transaction(tx_id: int, request: Request, session: Session = Depends(get_session)):
    tx = session.get(PropTransaction, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    for k, v in _clean(await request.json()).items():
        setattr(tx, k, v)
    session.add(tx)
    session.commit()
    session.refresh(tx)
    return _dict(tx)


@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, session: Session = Depends(get_session)):
    tx = session.get(PropTransaction, tx_id)
    if not tx:
        raise HTTPException(404, "Transaction not found")
    session.delete(tx)
    session.commit()
    return {"status": "deleted", "id": tx_id}


@router.get("/export")
def export_transactions(year: Optional[int] = None, format: str = "csv",
                        session: Session = Depends(get_session)):
    """Full ledger export for bookkeeping / tax returns."""
    accounts = {a.id: a.name for a in session.exec(select(Account)).all()}
    rows = list(session.exec(select(PropTransaction).order_by(PropTransaction.date)).all())
    if year:
        rows = [r for r in rows if r.date[:4] == str(year)]
    items = [_dict(r, accounts.get(r.account_id)) for r in rows]
    stamp = f"-{year}" if year else ""
    if format == "json":
        return exporter.json_response(items, f"prop-firm-ledger{stamp}.json")
    cols = ["date", "firm", "kind", "amount", "signed", "currency", "account",
            "account_size", "reference", "method", "notes"]
    return exporter.csv_response(items, cols, f"prop-firm-ledger{stamp}.csv")


@router.get("/tax-summary")
def tax_summary(year: Optional[int] = None, format: str = "json",
                session: Session = Depends(get_session)):
    """Per-tax-year totals: prop costs, payouts received, and net taxable profit.

    Trading P&L on prop accounts is the FIRM's money — what you actually receive is
    the payout, so the taxable figure here is payouts minus the fees you paid.
    """
    rows = list(session.exec(select(PropTransaction)).all())
    years: dict = defaultdict(lambda: {"year": "", "payouts": 0.0, "costs": 0.0,
                                       "challenge_fees": 0.0, "reset_fees": 0.0,
                                       "subscriptions": 0.0, "other_costs": 0.0,
                                       "refunds": 0.0, "transactions": 0})
    for r in rows:
        y = years[r.date[:4]]
        y["year"] = r.date[:4]
        y["transactions"] += 1
        if r.kind == "payout":
            y["payouts"] += r.amount
        elif r.kind == "refund":
            y["refunds"] += r.amount
        elif r.kind == "challenge_fee":
            y["challenge_fees"] += r.amount
        elif r.kind == "reset_fee":
            y["reset_fees"] += r.amount
        elif r.kind == "subscription":
            y["subscriptions"] += r.amount
        else:
            y["other_costs"] += r.amount
    out = []
    for y in years.values():
        y["costs"] = y["challenge_fees"] + y["reset_fees"] + y["subscriptions"] + y["other_costs"]
        y["net_profit"] = y["payouts"] + y["refunds"] - y["costs"]
        out.append(y)
    out.sort(key=lambda d: d["year"], reverse=True)
    if year:
        out = [y for y in out if y["year"] == str(year)]

    if format == "csv":
        cols = ["year", "payouts", "refunds", "challenge_fees", "reset_fees",
                "subscriptions", "other_costs", "costs", "net_profit", "transactions"]
        return exporter.csv_response(out, cols, "prop-tax-summary.csv")
    return {"years": out, "generated_at": datetime.utcnow().isoformat() + "Z"}
