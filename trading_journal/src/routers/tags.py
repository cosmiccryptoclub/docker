"""Configurable tag taxonomy: categories + options CRUD, with usage counts."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlmodel import Session, select

from src.db import get_session
from src.models import TagCategory, TagOption, TradeTagLink

router = APIRouter(prefix="/api/tags", tags=["tags"])


def _counts(session: Session) -> dict:
    rows = session.exec(
        select(TradeTagLink.option_id, func.count()).group_by(TradeTagLink.option_id)
    ).all()
    return {oid: c for oid, c in rows}


def _serialize(session: Session, include_inactive: bool = True) -> list:
    counts = _counts(session)
    cats = session.exec(select(TagCategory).order_by(TagCategory.sort, TagCategory.id)).all()
    out = []
    for c in cats:
        if not include_inactive and not c.is_active:
            continue
        opts = sorted(c.options, key=lambda o: (o.sort, o.id or 0))
        out.append({
            "id": c.id, "name": c.name, "color": c.color, "multi": c.multi,
            "sort": c.sort, "is_active": c.is_active,
            "options": [
                {"id": o.id, "name": o.name, "sort": o.sort, "is_active": o.is_active,
                 "count": counts.get(o.id, 0)}
                for o in opts if include_inactive or o.is_active
            ],
        })
    return out


@router.get("")
def list_tags(include_inactive: bool = True, session: Session = Depends(get_session)):
    return _serialize(session, include_inactive)


# --- categories --------------------------------------------------------------

@router.get("/export")
def export_tags(include_inactive: bool = True, format: str = "json",
                session: Session = Depends(get_session)):
    """Download the whole taxonomy. Declared before /{...} routes so it isn't swallowed."""
    from src import exporter, tag_io
    payload = tag_io.export_payload(session, include_inactive)
    if format == "text":
        lines = []
        for c in payload["categories"]:
            lines.append(c["name"])
            lines += [f"  - {o}" for o in c["options"]]
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(
            "\n".join(lines),
            headers={"Content-Disposition": 'attachment; filename="tags.txt"'},
        )
    return exporter.json_response(payload, "tags.json")


@router.get("/import-prompt")
def import_prompt():
    """The prompt to hand an LLM along with messy notes, so it returns importable JSON."""
    from src import tag_io
    return {"prompt": tag_io.LLM_PROMPT}


@router.post("/import")
async def import_tags(request: Request, session: Session = Depends(get_session)):
    """Merge a taxonomy in. Strictly additive: never overwrites, renames or duplicates."""
    from src import tag_io
    body = await request.json()
    payload = body.get("data", body) if isinstance(body, dict) else body
    try:
        return {"status": "imported", **tag_io.merge(session, payload)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/categories")
async def create_category(request: Request, session: Session = Depends(get_session)):
    data = await request.json()
    max_sort = session.exec(select(func.max(TagCategory.sort))).one() or 0
    cat = TagCategory(
        name=data.get("name", "New category"),
        color=data.get("color", "#64748b"),
        multi=data.get("multi", True),
        sort=data.get("sort", max_sort + 1),
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return {"id": cat.id, "name": cat.name, "color": cat.color, "multi": cat.multi, "sort": cat.sort, "is_active": cat.is_active, "options": []}


@router.put("/categories/{cat_id}")
async def update_category(cat_id: int, request: Request, session: Session = Depends(get_session)):
    cat = session.get(TagCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Category not found")
    data = await request.json()
    for k in ("name", "color", "multi", "sort", "is_active"):
        if k in data:
            setattr(cat, k, data[k])
    session.add(cat)
    session.commit()
    return {"status": "updated", "id": cat_id}


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, session: Session = Depends(get_session)):
    cat = session.get(TagCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Category not found")
    # remove links for this category's options, then options, then category
    option_ids = [o.id for o in cat.options]
    if option_ids:
        for link in session.exec(select(TradeTagLink).where(TradeTagLink.option_id.in_(option_ids))).all():
            session.delete(link)
    session.delete(cat)  # cascade removes options
    session.commit()
    return {"status": "deleted", "id": cat_id}


@router.put("/categories/reorder")
async def reorder_categories(request: Request, session: Session = Depends(get_session)):
    ids = (await request.json()).get("ids", [])
    for i, cid in enumerate(ids):
        cat = session.get(TagCategory, cid)
        if cat:
            cat.sort = i
            session.add(cat)
    session.commit()
    return {"status": "reordered"}


# --- options -----------------------------------------------------------------

@router.post("/categories/{cat_id}/options")
async def create_option(cat_id: int, request: Request, session: Session = Depends(get_session)):
    if not session.get(TagCategory, cat_id):
        raise HTTPException(404, "Category not found")
    data = await request.json()
    max_sort = session.exec(
        select(func.max(TagOption.sort)).where(TagOption.category_id == cat_id)
    ).one() or 0
    opt = TagOption(category_id=cat_id, name=data.get("name", "New tag"), sort=data.get("sort", max_sort + 1))
    session.add(opt)
    session.commit()
    session.refresh(opt)
    return {"id": opt.id, "name": opt.name, "sort": opt.sort, "is_active": opt.is_active, "count": 0}


@router.put("/options/{opt_id}")
async def update_option(opt_id: int, request: Request, session: Session = Depends(get_session)):
    opt = session.get(TagOption, opt_id)
    if not opt:
        raise HTTPException(404, "Option not found")
    data = await request.json()
    for k in ("name", "sort", "is_active", "category_id"):
        if k in data:
            setattr(opt, k, data[k])
    session.add(opt)
    session.commit()
    return {"status": "updated", "id": opt_id}


@router.delete("/options/{opt_id}")
def delete_option(opt_id: int, session: Session = Depends(get_session)):
    opt = session.get(TagOption, opt_id)
    if not opt:
        raise HTTPException(404, "Option not found")
    for link in session.exec(select(TradeTagLink).where(TradeTagLink.option_id == opt_id)).all():
        session.delete(link)
    session.delete(opt)
    session.commit()
    return {"status": "deleted", "id": opt_id}


@router.put("/categories/{cat_id}/options/reorder")
async def reorder_options(cat_id: int, request: Request, session: Session = Depends(get_session)):
    ids = (await request.json()).get("ids", [])
    for i, oid in enumerate(ids):
        opt = session.get(TagOption, oid)
        if opt and opt.category_id == cat_id:
            opt.sort = i
            session.add(opt)
    session.commit()
    return {"status": "reordered"}
