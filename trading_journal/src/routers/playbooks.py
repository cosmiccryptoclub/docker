"""Playbooks CRUD — named strategies with pre-trade rule checklists."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from src.db import get_session
from src.models import Playbook, Trade

router = APIRouter(prefix="/api/playbooks", tags=["playbooks"])


def _serialize(p: Playbook) -> dict:
    return {
        "id": p.id, "name": p.name, "description": p.description,
        "color": p.color, "rules": p.rules or [], "sort": p.sort, "is_active": p.is_active,
    }


@router.get("")
def list_playbooks(session: Session = Depends(get_session)):
    pbs = session.exec(select(Playbook).order_by(Playbook.sort, Playbook.id)).all()
    return [_serialize(p) for p in pbs]


@router.post("")
async def create_playbook(request: Request, session: Session = Depends(get_session)):
    data = await request.json()
    p = Playbook(
        name=data.get("name", "New playbook"),
        description=data.get("description"),
        color=data.get("color", "#3b82f6"),
        rules=data.get("rules", []),
        sort=data.get("sort", 0),
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return _serialize(p)


@router.put("/{pb_id}")
async def update_playbook(pb_id: int, request: Request, session: Session = Depends(get_session)):
    p = session.get(Playbook, pb_id)
    if not p:
        raise HTTPException(404, "Playbook not found")
    data = await request.json()
    for k in ("name", "description", "color", "rules", "sort", "is_active"):
        if k in data:
            setattr(p, k, data[k])
    session.add(p)
    session.commit()
    return _serialize(p)


@router.delete("/{pb_id}")
def delete_playbook(pb_id: int, session: Session = Depends(get_session)):
    p = session.get(Playbook, pb_id)
    if not p:
        raise HTTPException(404, "Playbook not found")
    # detach from trades
    for t in session.exec(select(Trade).where(Trade.playbook_id == pb_id)).all():
        t.playbook_id = None
        session.add(t)
    session.delete(p)
    session.commit()
    return {"status": "deleted", "id": pb_id}
