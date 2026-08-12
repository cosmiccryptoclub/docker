"""Accounts CRUD + per-account stats."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from src import trade_ops
from src.db import get_session
from src.metrics import summary_stats
from src.models import Account, Fill, Trade
from src.queries import get_trades
from src.risk import compute_account_risk
from src.serializers import account_dict

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("")
def list_accounts(with_stats: bool = False, session: Session = Depends(get_session)):
    accounts = session.exec(select(Account).order_by(Account.created_at)).all()
    out = []
    for a in accounts:
        stats = None
        if with_stats:
            trades = get_trades(session, account_id=a.id)
            s = summary_stats(trades)
            open_trades = [t for t in trades if t.status == "open"]
            s["open_trades"] = len(open_trades)
            s["balance"] = a.starting_balance + s["net_pnl"]
            s["risk"] = compute_account_risk(a, trades)
            stats = s
        out.append(account_dict(a, stats))
    return out


@router.post("")
async def create_account(request: Request, session: Session = Depends(get_session)):
    data = await request.json()
    acc = Account(**{k: v for k, v in data.items() if hasattr(Account, k)})
    session.add(acc)
    session.commit()
    session.refresh(acc)
    return account_dict(acc)


@router.get("/{account_id}")
def get_account(account_id: int, session: Session = Depends(get_session)):
    acc = session.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    trades = get_trades(session, account_id=account_id)
    stats = summary_stats(trades)
    stats["open_trades"] = len([t for t in trades if t.status == "open"])
    stats["balance"] = acc.starting_balance + stats["net_pnl"]
    stats["risk"] = compute_account_risk(acc, trades)
    return account_dict(acc, stats)


@router.put("/{account_id}")
async def update_account(account_id: int, request: Request, session: Session = Depends(get_session)):
    acc = session.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    data = await request.json()
    for k, v in data.items():
        if hasattr(Account, k) and k not in ("id", "created_at"):
            setattr(acc, k, v)
    session.add(acc)
    session.commit()
    session.refresh(acc)
    return account_dict(acc)


@router.delete("/{account_id}")
def delete_account(account_id: int, session: Session = Depends(get_session)):
    acc = session.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    # delete trades + fills belonging to this account
    trades = session.exec(select(Trade).where(Trade.account_id == account_id)).all()
    for t in trades:
        for f in session.exec(select(Fill).where(Fill.trade_id == t.id)).all():
            session.delete(f)
        trade_ops.delete_trade(session, t)   # also clears tag links
    session.delete(acc)
    session.commit()
    return {"status": "deleted", "id": account_id}
