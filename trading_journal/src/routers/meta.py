"""Meta: enums, distinct values, connector status, version."""
from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from src import config, models
from src.connectors.ctrader import CTraderConnector
from src.db import get_session
from src.models import Symbol, Trade

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("")
def meta(session: Session = Depends(get_session)):
    trades = session.exec(select(Trade)).all()
    setups = sorted({t.setup for t in trades if t.setup})
    used_symbols = sorted({t.symbol for t in trades})
    tags = sorted({tag for t in trades for tag in (t.tags or [])})
    symbols = session.exec(select(Symbol).order_by(Symbol.name)).all()

    return {
        "version": config.APP_VERSION,
        "app_name": config.APP_NAME,
        "symbols": [
            {"name": s.name, "category": s.category, "contract_size": s.contract_size,
             "price_decimals": s.price_decimals, "pip_size": s.pip_size}
            for s in symbols
        ],
        "used_symbols": used_symbols,
        "setups": setups,
        "tags": tags,
        "sessions": models.SESSIONS,
        "account_types": models.ACCOUNT_TYPES,
        "directions": models.DIRECTIONS,
        "fill_kinds": models.FILL_KINDS,
        "connectors": {
            "ctrader": {"configured": CTraderConnector().is_configured()},
        },
    }
