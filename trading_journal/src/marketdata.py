"""
Market-data provider — real OHLC candles + spot price from Binance.

You scalp BTC (fast partial TPs → 1-minute candles) and sometimes swing, so the
interval auto-selects: 1m for short trades, coarsening to 5m/15m/1h/1d for longer
windows so a single request stays under Binance's 1000-bar limit.

Only spot-pair symbols are supported (BTCUSD→BTCUSDT, ETHUSD→ETHUSDT). Anything
else (indices, gold) returns None and the caller falls back to synthetic candles.
Public, keyless endpoints; a .vision fallback host covers regions that block the
main API.
"""
from __future__ import annotations

import time
from typing import List, Optional

import httpx

from src import config

# cTrader-style symbol -> Binance spot symbol (explicit overrides; most crypto is
# resolved dynamically from CRYPTO_BASES below)
SYMBOL_MAP = {
    "BTCUSD": "BTCUSDT",
    "ETHUSD": "ETHUSDT",
    "BTCUSDT": "BTCUSDT",
    "ETHUSDT": "ETHUSDT",
}

# Crypto bases we accept as "<BASE>USD" / "<BASE>USDT" and route to Binance.
# Deliberately a whitelist: a bare 3-5 letter ticker is far more likely to be an
# equity (AMD, SUI-like tickers exist on both sides), so we never guess.
CRYPTO_BASES = {
    "BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "MATIC", "LTC",
    "BCH", "BNB", "TRX", "SHIB", "UNI", "ATOM", "ETC", "FIL", "NEAR", "APT", "ARB",
    "OP", "INJ", "SUI", "PEPE", "AAVE", "ALGO", "XLM", "VET", "ICP", "HBAR", "TIA",
    "SEI", "FTM", "SAND", "MANA", "GRT", "RUNE", "EGLD", "FLOW", "CRV", "LDO", "WIF",
}


def _clean(symbol: str) -> str:
    """Normalise a broker ticker: US100.cash -> US100, AAPL.US -> AAPL, BTC/USD -> BTCUSD."""
    return symbol.upper().split(".")[0].replace("/", "").replace("_", "").replace("-", "")


def _crypto_base(s: str):
    """'DOGEUSD' -> 'DOGE' when the base is a known crypto, else None."""
    for quote in ("USDT", "USD"):
        if s.endswith(quote):
            base = s[: -len(quote)]
            if base in CRYPTO_BASES:
                return base
    return None


def is_equity(s: str) -> bool:
    """A plain 1-5 letter ticker that isn't an index alias, fiat code or crypto pair."""
    return (
        s.isalpha() and 1 <= len(s) <= 5
        and s not in YAHOO_MAP and s not in FIAT and s not in CRYPTO_BASES
    )


def binance_symbol(symbol: str):
    """cTrader ticker -> Binance spot pair, or None if it isn't crypto we can fetch."""
    s = _clean(symbol)
    if s in SYMBOL_MAP:
        return SYMBOL_MAP[s]
    base = _crypto_base(s)
    return f"{base}USDT" if base else None

INTERVALS = [
    ("1m", 60), ("3m", 180), ("5m", 300), ("15m", 900), ("30m", 1800),
    ("1h", 3600), ("2h", 7200), ("4h", 14400), ("1d", 86400),
]

HOSTS = [config.BINANCE_BASE, "https://data-api.binance.vision"]

_price_cache: dict = {}   # symbol -> (ts, price)
_PRICE_TTL = 20           # seconds


def supported(symbol: str) -> bool:
    """Binance-backed (crypto)."""
    return binance_symbol(symbol) is not None


def price_decimals(symbol: str, price: Optional[float] = None) -> int:
    """Display/rounding decimals per instrument (shared by charts + jobs).

    Altcoins vary wildly (SOL ~2dp, DOGE ~5dp, SHIB ~8dp), so when a reference price
    is available the precision is derived from its magnitude; the symbol rules below
    only cover the majors and non-crypto instruments.
    """
    s = symbol.upper().split(".")[0].replace("/", "").replace("_", "")
    if s in YAHOO_MAP:                                        # indices / metals / energy
        return 2
    if is_equity(s):                                          # single stocks
        return 2
    if s.startswith("BTC"):
        return 1
    if s.startswith(("ETH", "BNB")):
        return 2
    # forex pair — but only if it isn't a crypto ticker (SOLUSD/ADAUSD are 6 letters too)
    if (len(s) == 6 and s.isalpha() and s[:3] in FIAT and s[3:] in FIAT):
        return 3 if s.endswith("JPY") else 5
    if price is not None and price > 0:
        # keep ~6 significant figures, clamped to a sane range
        for cutoff, dec in ((10_000, 1), (1_000, 2), (100, 3), (1, 4), (0.01, 6)):
            if price >= cutoff:
                return dec
        return 8
    return 2


# --- Yahoo Finance (free, no key) for indices / metals / forex / energy -------
YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
YAHOO_MAP = {
    # indices (prop-firm names -> Yahoo)
    "US100": "^NDX", "NAS100": "^NDX", "USTEC": "^NDX", "NDX": "^NDX", "NAS": "^NDX",
    "US500": "^GSPC", "SPX500": "^GSPC", "SPX": "^GSPC", "US30": "^DJI", "DJI30": "^DJI", "DJI": "^DJI",
    "US2000": "^RUT", "GER40": "^GDAXI", "GER30": "^GDAXI", "DE40": "^GDAXI", "DAX": "^GDAXI", "DAX40": "^GDAXI",
    "UK100": "^FTSE", "FTSE100": "^FTSE", "EU50": "^STOXX50E", "STOXX50": "^STOXX50E", "ESP35": "^IBEX",
    "FRA40": "^FCHI", "JP225": "^N225", "JPN225": "^N225", "NIKKEI": "^N225", "HK50": "^HSI", "AUS200": "^AXJO",
    # metals / energy
    "XAUUSD": "GC=F", "GOLD": "GC=F", "XAGUSD": "SI=F", "SILVER": "SI=F", "XPTUSD": "PL=F",
    "USOIL": "CL=F", "WTI": "CL=F", "XTIUSD": "CL=F", "UKOIL": "BZ=F", "BRENT": "BZ=F", "XBRUSD": "BZ=F",
    "NATGAS": "NG=F", "XNGUSD": "NG=F", "COPPER": "HG=F",
}


# real fiat currency codes — used to tell a forex pair (EURUSD) apart from a
# 6-letter crypto ticker (SOLUSD, ADAUSD), which must NOT be treated as forex.
FIAT = {
    "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "SEK", "NOK", "DKK",
    "PLN", "CZK", "HUF", "TRY", "ZAR", "MXN", "SGD", "HKD", "CNH", "CNY",
}


def yahoo_symbol(symbol: str) -> Optional[str]:
    """cTrader ticker -> Yahoo ticker. Indices/metals/energy via YAHOO_MAP, forex as
    EURUSD=X, single stocks as their plain ticker (AAPL, NFLX, SPCX), and crypto that
    Binance doesn't list as BASE-USD."""
    s = _clean(symbol)
    if s in YAHOO_MAP:
        return YAHOO_MAP[s]
    if len(s) == 6 and s[:3] in FIAT and s[3:] in FIAT:   # forex pair -> EURUSD=X
        return f"{s}=X"
    base = _crypto_base(s)
    if base:
        return f"{base}-USD"                 # crypto fallback when Binance has no pair
    if is_equity(s):
        return s                             # single stock: AAPL, AMD, NFLX, SPCX
    return None


def _yahoo_interval(seconds: int) -> str:
    for cutoff, name in ((60, "1m"), (300, "5m"), (900, "15m"), (1800, "30m"), (3600, "1h")):
        if seconds <= cutoff:
            return name
    return "1d"


def fetch_yahoo(symbol: str, interval_seconds: int, start_ms: int, end_ms: int) -> Optional[List[dict]]:
    ysym = yahoo_symbol(symbol)
    if not ysym:
        return None
    params = {
        "interval": _yahoo_interval(interval_seconds),
        "period1": start_ms // 1000, "period2": end_ms // 1000,
        "includePrePost": "false",
    }
    try:
        r = httpx.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}",
                      params=params, headers={"User-Agent": YAHOO_UA}, timeout=12.0)
        if r.status_code != 200:
            return None
        result = r.json().get("chart", {}).get("result")
        if not result:
            return None
        res = result[0]
        ts = res.get("timestamp") or []
        q = (res.get("indicators", {}).get("quote") or [{}])[0]
        o, h, l, c = q.get("open", []), q.get("high", []), q.get("low", []), q.get("close", [])
        out = []
        for i, t in enumerate(ts):
            if i >= len(c) or None in (o[i], h[i], l[i], c[i]):
                continue
            out.append({"time": int(t), "open": float(o[i]), "high": float(h[i]), "low": float(l[i]), "close": float(c[i])})
        return out or None
    except Exception:
        return None


def pick_interval(span_seconds: float, max_bars: int = 1000) -> tuple[str, int]:
    for name, sec in INTERVALS:
        if span_seconds / sec <= max_bars:
            return name, sec
    return "1d", 86400


def _get(path: str, params: dict) -> Optional[list | dict]:
    for host in HOSTS:
        try:
            r = httpx.get(f"{host}{path}", params=params, timeout=10.0)
            if r.status_code == 200:
                return r.json()
        except Exception:
            continue
    return None


def fetch_klines(symbol: str, interval: str, start_ms: int, end_ms: int) -> Optional[List[dict]]:
    """Real OHLC bars in [start_ms, end_ms]. Returns None on unsupported/failure."""
    bsym = binance_symbol(symbol)
    if not bsym:
        return None
    data = _get("/api/v3/klines", {
        "symbol": bsym, "interval": interval,
        "startTime": start_ms, "endTime": end_ms, "limit": 1000,
    })
    if not isinstance(data, list) or not data:
        return None
    return [{
        "time": int(k[0] // 1000),
        "open": float(k[1]), "high": float(k[2]),
        "low": float(k[3]), "close": float(k[4]),
    } for k in data]


def get_price(symbol: str) -> Optional[float]:
    """Current (or ~15-min delayed) price. Binance for crypto, Yahoo otherwise. Cached."""
    now = time.time()
    bsym = binance_symbol(symbol)
    if bsym:
        cached = _price_cache.get(bsym)
        if cached and now - cached[0] < _PRICE_TTL:
            return cached[1]
        data = _get("/api/v3/ticker/price", {"symbol": bsym})
        if isinstance(data, dict) and "price" in data:
            price = float(data["price"])
            _price_cache[bsym] = (now, price)
            return price
        return None
    ysym = yahoo_symbol(symbol)
    if not ysym:
        return None
    cached = _price_cache.get(ysym)
    if cached and now - cached[0] < 60:
        return cached[1]
    bars = fetch_yahoo(symbol, 300, int((now - 3 * 86400) * 1000), int(now * 1000))
    if not bars:
        return None
    price = bars[-1]["close"]
    _price_cache[ysym] = (now, price)
    return price
