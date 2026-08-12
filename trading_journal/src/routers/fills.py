"""Fill update / delete (each recomputes its parent trade)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from src.db import get_session
from src.metrics import recompute_trade
from src.models import Account, Fill, Trade
from src.queries import parse_dt
from src.serializers import trade_dict

router = APIRouter(prefix="/api/fills", tags=["fills"])

FILL_WRITABLE = {"kind", "price", "lots", "executed_at", "fee", "note", "external_id"}


def _recompute_parent(session: Session, trade_id: int):
    trade = session.get(Trade, trade_id)
    session.refresh(trade)
    acc = session.get(Account, trade.account_id)
    recompute_trade(trade, acc.starting_balance if acc else 0.0)
    session.add(trade)
    session.commit()
    session.refresh(trade)
    return trade


@router.put("/{fill_id}")
async def update_fill(fill_id: int, request: Request, session: Session = Depends(get_session)):
    fill = session.get(Fill, fill_id)
    if not fill:
        raise HTTPException(404, "Fill not found")
    data = await request.json()
    for k, v in data.items():
        if k in FILL_WRITABLE:
            if k == "executed_at":
                v = parse_dt(v)
            elif k in ("price", "lots", "fee"):
                v = float(v)
            setattr(fill, k, v)
    session.add(fill)
    session.commit()
    trade = _recompute_parent(session, fill.trade_id)
    return trade_dict(trade, list(trade.fills))


@router.delete("/{fill_id}")
def delete_fill(fill_id: int, session: Session = Depends(get_session)):
    fill = session.get(Fill, fill_id)
    if not fill:
        raise HTTPException(404, "Fill not found")
    trade_id = fill.trade_id
    session.delete(fill)
    session.commit()
    trade = _recompute_parent(session, trade_id)
    return trade_dict(trade, list(trade.fills))
