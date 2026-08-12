"""Backtest sandbox: historical candle windows for manual replay-trading."""
from fastapi import APIRouter, HTTPException

from src import marketdata
from src.queries import parse_dt

router = APIRouter(prefix="/api/backtest", tags=["backtest"])

INTERVAL_SECONDS = {"1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400}


@router.get("/candles")
def candles(symbol: str = "BTCUSD", start: str = "", interval: str = "1m", limit: int = 500):
    """Real candles for `limit` bars starting at `start` (for a supported symbol)."""
    if not marketdata.supported(symbol):
        raise HTTPException(400, f"{symbol} not supported for backtesting (BTC/ETH only for now).")
    sec = INTERVAL_SECONDS.get(interval, 60)
    limit = max(50, min(limit, 1000))
    start_dt = parse_dt(start)
    if not start_dt:
        raise HTTPException(400, "A valid start datetime is required.")
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = start_ms + limit * sec * 1000
    bars = marketdata.fetch_klines(symbol, interval, start_ms, end_ms)
    if not bars:
        raise HTTPException(502, "Could not fetch candles (check the date is in the past and the market existed).")
    return {"symbol": symbol, "interval": interval, "interval_seconds": sec, "candles": bars}
