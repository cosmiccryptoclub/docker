"""
cTrader Open API connector.

Two layers:
  * list_accounts()  — simple REST (api.spotware.com/connect) to fetch the cTID
    profile + trading accounts (incl. the ctidTraderAccountId you need). Works with
    a plain access token; no protobuf. Use this to discover/link accounts.
  * fetch_trades()   — the real deal sync over the Open API (protobuf/TLS): app auth
    -> account auth -> symbols -> deal list, then group deals by positionId into
    trades. Deals without a closePositionDetail are entries; deals with one are
    exits (tp/sl/close inferred from grossProfit).

The protobuf message classes come from `ctrader-open-api` (imported lazily so the
app runs even where that package isn't installed). BETA: the volume->lots scaling
(VOLUME_SCALE) and contract-size assumptions are tuned for cTrader BTC/ETH; verify
against your platform and adjust if PnL looks off.
"""
from __future__ import annotations

import asyncio
import json
import ssl
import struct
import time
from datetime import datetime, timedelta
from typing import List, Optional
from urllib.parse import urlencode

import httpx

from src import config
from src.connectors.base import BaseConnector, NormalizedFill, NormalizedTrade

CONNECT_BASE = "https://api.spotware.com/connect"
TOKEN_URL = "https://openapi.ctrader.com/apps/token"
AUTH_BASE = "https://id.ctrader.com/my/settings/openapi/grantingaccess/"
TOKEN_FILE = config.DATA_DIR / "ctrader_token.json"


def _load_tokens() -> dict:
    try:
        return json.loads(TOKEN_FILE.read_text())
    except Exception:
        return {}


def _save_tokens(data: dict) -> None:
    TOKEN_FILE.write_text(json.dumps(data))

# payload types (from ProtoOAPayloadType)
PT_APP_AUTH_RES = 2101
PT_ACCOUNT_AUTH_RES = 2103
PT_TRADER_RES = 2122
PT_RECONCILE_RES = 2125
PT_SYMBOLS_LIST_RES = 2115
PT_DEAL_LIST_RES = 2134
PT_GET_TRENDBARS_RES = 2138
PT_ERROR_RES = 2142

# candle interval (seconds) -> ProtoOATrendbarPeriod enum value
TRENDBAR_PERIOD = {60: 1, 180: 3, 300: 5, 900: 7, 1800: 8, 3600: 9, 14400: 10, 86400: 12}
TRENDBAR_SCALE = 100000.0   # cTrader trendbar prices are in 1/100000 units

# symbolId <-> name is static per account; cache it so the 20s live snapshot doesn't
# re-download the full symbols list (thousands of rows) on every poll.
_SYMBOLS_CACHE: dict = {}     # (host, ctid) -> (fetched_ts, {symbolId: name})
_SYMBOLS_TTL = 3600.0

VOLUME_SCALE = 100.0        # fallback deal.volume -> lots (BTC/ETH: 0.3 lots => volume 30)
BUY = 1


def _money_digits(msg) -> float:
    """10**moneyDigits, defaulting to 2 ONLY when the field is absent.

    `getattr(msg, 'moneyDigits', 2) or 2` was wrong for JPY-style accounts where
    moneyDigits is legitimately 0 (0 is falsy -> silently became 2 -> /100 errors).
    """
    try:
        if msg.HasField("moneyDigits"):
            return 10 ** msg.moneyDigits
    except Exception:  # noqa: BLE001  (proto2 optional vs proto3 scalar differences)
        d = getattr(msg, "moneyDigits", None)
        if d is not None:
            return 10 ** d
    return 100.0


def _lots_from_volume(volume: float, sym_meta: Optional[dict]) -> float:
    """Convert a cTrader deal volume into lots using the symbol's own lotSize when the
    broker gave us one (correct for every instrument), else the BTC/ETH-tuned fallback."""
    if sym_meta:
        lot_size = sym_meta.get("lot_size") or 0
        if lot_size:
            # volume is in 1/100 units of the base asset; lotSize is units per 1.00 lot
            return (volume / 100.0) / lot_size
    return volume / VOLUME_SCALE


def _group_positions(positions: list, window: int) -> list:
    """
    Merge provisional per-position trades that belong to the same scale-in.

    positions: list of {pid, symbol, direction, opened_at, fills}. Positions on the
    same symbol+direction whose opens fall within `window` seconds of the group's
    first open become one trade (your hotkey multi-entries). window<=0 disables it.
    A group spans at most `window` seconds, so unrelated later trades don't merge.
    """
    groups: list = []
    for p in sorted(positions, key=lambda x: x["opened_at"]):
        placed = False
        if window and window > 0:
            for g in groups:
                if (g["symbol"] == p["symbol"] and g["direction"] == p["direction"]
                        and (p["opened_at"] - g["opened_at"]).total_seconds() <= window):
                    g["fills"].extend(p["fills"])
                    g["pids"].append(p["pid"])
                    placed = True
                    break
        if not placed:
            groups.append({
                "symbol": p["symbol"], "direction": p["direction"],
                "opened_at": p["opened_at"], "fills": list(p["fills"]), "pids": [p["pid"]],
            })
    return groups


class CTraderConnector(BaseConnector):
    name = "ctrader"

    def __init__(self) -> None:
        self.client_id = config.CTRADER_CLIENT_ID
        self.client_secret = config.CTRADER_CLIENT_SECRET
        self.access_token = config.CTRADER_ACCESS_TOKEN
        self.account_id = config.CTRADER_ACCOUNT_ID
        self.host_override = getattr(config, "CTRADER_HOST", "")

    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.active_token())

    # --- token management (OAuth production token, stored + auto-refreshed) --
    def active_token(self) -> str:
        """Prefer a stored OAuth token (auto-refreshing near expiry); fall back to env."""
        tok = _load_tokens()
        if tok.get("refresh_token") and tok.get("expires_at", 0) < time.time() + 86400:
            self._refresh(tok["refresh_token"])
            tok = _load_tokens()
        return tok.get("access_token") or self.access_token

    def authorize_url(self, redirect_uri: str, scope: str = "accounts") -> str:
        return AUTH_BASE + "?" + urlencode({
            "client_id": self.client_id, "redirect_uri": redirect_uri,
            "scope": scope, "product": "web",
        })

    def _store(self, data: dict) -> None:
        _save_tokens({
            "access_token": data["accessToken"],
            "refresh_token": data.get("refreshToken"),
            "expires_at": time.time() + int(data.get("expiresIn", 2628000)),
        })

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        r = httpx.get(TOKEN_URL, params={
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
            "client_id": self.client_id, "client_secret": self.client_secret,
        }, timeout=20.0)
        data = r.json()
        if "accessToken" not in data:
            raise RuntimeError(f"Token exchange failed: {data.get('description') or data}")
        self._store(data)
        return data

    def _refresh(self, refresh_token: str) -> None:
        try:
            r = httpx.get(TOKEN_URL, params={
                "grant_type": "refresh_token", "refresh_token": refresh_token,
                "client_id": self.client_id, "client_secret": self.client_secret,
            }, timeout=20.0)
            data = r.json()
            if "accessToken" in data:
                if not data.get("refreshToken"):
                    data["refreshToken"] = refresh_token
                self._store(data)
        except Exception:
            pass

    def token_status(self) -> dict:
        tok = _load_tokens()
        return {
            "configured": bool(self.client_id and self.client_secret),
            "has_token": bool(tok.get("access_token") or self.access_token),
            "source": "oauth" if tok.get("access_token") else ("env" if self.access_token else None),
            "expires_at": tok.get("expires_at"),
        }

    # --- REST: profile + trading accounts -----------------------------------
    def list_accounts(self) -> dict:
        token = self.active_token()
        if not token:
            raise RuntimeError("No cTrader access token. Click 'Connect cTrader' or set CTRADER_ACCESS_TOKEN.")
        params = {"access_token": token}
        with httpx.Client(timeout=15.0) as c:
            prof = c.get(f"{CONNECT_BASE}/profile", params=params)
            accs = c.get(f"{CONNECT_BASE}/tradingaccounts", params=params)
        if prof.status_code != 200 or accs.status_code != 200:
            raise RuntimeError(f"cTrader connect API error (profile {prof.status_code}, accounts {accs.status_code}). Token may be expired.")
        return {"profile": prof.json().get("data"), "accounts": accs.json().get("data", [])}

    def _resolve_host(self) -> str:
        if self.host_override:
            return self.host_override
        try:
            for a in self.list_accounts()["accounts"]:
                if str(a.get("accountId")) == str(self.account_id):
                    return "live.ctraderapi.com" if a.get("live") else "demo.ctraderapi.com"
        except Exception:
            pass
        return "demo.ctraderapi.com"

    # --- Open API (protobuf) deal sync --------------------------------------
    def fetch_trades(self, since: Optional[datetime] = None, group_window: Optional[int] = None) -> List[NormalizedTrade]:
        if not self.is_configured():
            raise RuntimeError("cTrader not configured (CTRADER_CLIENT_ID/_SECRET/_ACCESS_TOKEN).")
        if not self.account_id:
            raise RuntimeError("CTRADER_ACCOUNT_ID is required (use 'Fetch accounts' to find your ctidTraderAccountId).")
        window = config.CTRADER_GROUP_WINDOW if group_window is None else group_window
        primary = self._resolve_host()
        other = "demo.ctraderapi.com" if primary.startswith("live") else "live.ctraderapi.com"
        errors = []
        for host in (primary, other):
            try:
                return asyncio.run(self._sync(host, since, window))
            except Exception as e:  # noqa: BLE001
                errors.append(f"{host.split('.')[0]}: {e}")
                up = str(e).upper()
                # only fall back to the other host on account-authorization errors
                if not any(k in up for k in ("ACCOUNT_DISABLED", "NOT_AUTHORIZED", "ACCOUNT_NOT")):
                    raise
        raise RuntimeError(
            "Account auth failed on both demo and live hosts — this account is likely "
            "disabled/expired or not enabled for the cTrader Open API. Try a different "
            f"account (e.g. a Spotware demo). [{' | '.join(errors)}]"
        )

    async def _sync(self, host: str, since: Optional[datetime], group_window: int = 60) -> List[NormalizedTrade]:
        # lazy import so the app runs where ctrader-open-api isn't installed
        from ctrader_open_api.messages.OpenApiCommonMessages_pb2 import ProtoMessage
        from ctrader_open_api.messages.OpenApiMessages_pb2 import (
            ProtoOAApplicationAuthReq, ProtoOAAccountAuthReq, ProtoOADealListReq,
            ProtoOADealListRes, ProtoOASymbolsListReq, ProtoOASymbolsListRes, ProtoOAErrorRes,
        )

        ctid = int(self.account_id)
        ctx = ssl.create_default_context()
        reader, writer = await asyncio.open_connection(host, 5035, ssl=ctx)

        async def send(msg):
            pm = ProtoMessage(payloadType=msg.payloadType, payload=msg.SerializeToString())
            data = pm.SerializeToString()
            writer.write(struct.pack(">I", len(data)) + data)
            await writer.drain()

        async def recv():
            header = await asyncio.wait_for(reader.readexactly(4), timeout=20)
            (length,) = struct.unpack(">I", header)
            payload = await asyncio.wait_for(reader.readexactly(length), timeout=20)
            pm = ProtoMessage()
            pm.ParseFromString(payload)
            return pm

        async def await_pt(expected: int):
            for _ in range(50):
                pm = await recv()
                if pm.payloadType == PT_ERROR_RES:
                    err = ProtoOAErrorRes()
                    err.ParseFromString(pm.payload)
                    raise RuntimeError(f"cTrader error {err.errorCode}: {err.description}")
                if pm.payloadType == expected:
                    return pm
            raise RuntimeError(f"cTrader: no response of type {expected}")

        try:
            await send(ProtoOAApplicationAuthReq(clientId=self.client_id, clientSecret=self.client_secret))
            await await_pt(PT_APP_AUTH_RES)
            await send(ProtoOAAccountAuthReq(ctidTraderAccountId=ctid, accessToken=self.active_token()))
            await await_pt(PT_ACCOUNT_AUTH_RES)

            # symbol id -> name (+ lotSize so volume->lots is exact per instrument)
            await send(ProtoOASymbolsListReq(ctidTraderAccountId=ctid))
            sym_pm = await await_pt(PT_SYMBOLS_LIST_RES)
            sres = ProtoOASymbolsListRes()
            sres.ParseFromString(sym_pm.payload)
            symbols = {s.symbolId: s.symbolName for s in sres.symbol}
            sym_meta = {}
            for s in sres.symbol:
                lot = getattr(s, "lotSize", 0) or 0
                # lotSize is in 1/100 units -> units per lot
                sym_meta[s.symbolId] = {"lot_size": (lot / 100.0) if lot else 0}

            # deal list in weekly windows (API limits the range per request).
            # cTrader rate-limits historical requests hard, so throttle + back off
            # on BLOCKED_PAYLOAD_TYPE ("you are being rate limited").
            THROTTLE = 1.1

            async def deal_request(frm, to):
                for attempt in range(6):
                    await asyncio.sleep(THROTTLE)
                    await send(ProtoOADealListReq(ctidTraderAccountId=ctid, fromTimestamp=frm, toTimestamp=to, maxRows=1000))
                    try:
                        pm = await await_pt(PT_DEAL_LIST_RES)
                        res = ProtoOADealListRes()
                        res.ParseFromString(pm.payload)
                        return res
                    except RuntimeError as e:
                        msg = str(e)
                        if "BLOCKED_PAYLOAD_TYPE" in msg or "rate limit" in msg.lower():
                            await asyncio.sleep(2.0 * (attempt + 1))
                            continue
                        raise
                raise RuntimeError("cTrader kept rate-limiting the deal list — wait ~1 minute and retry.")

            end = datetime.utcnow()
            start = since or (end - timedelta(days=90))
            deals = []
            cursor = start
            while cursor < end:
                window_end = min(cursor + timedelta(days=7), end)
                frm = int(cursor.timestamp() * 1000)
                to = int(window_end.timestamp() * 1000)
                while True:
                    res = await deal_request(frm, to)
                    deals.extend(res.deal)
                    if not res.hasMore or not res.deal:
                        break
                    frm = max(d.executionTimestamp for d in res.deal) + 1
                cursor = window_end
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

        return self._deals_to_trades(deals, symbols, group_window, sym_meta)

    # --- Open API (protobuf) trendbars: broker-exact OHLC -------------------
    def fetch_trendbars(self, ctid, items: list) -> list:
        """Fetch broker-exact candles for many (symbol, interval, window) requests in one
        session. `items` = [{symbol, interval_sec, from_ms, to_ms}]; returns a list aligned
        to items, each = list of OHLC dicts (or None if unavailable). Best-effort: any single
        request that errors becomes None rather than failing the batch."""
        if not self.is_configured():
            raise RuntimeError("cTrader not configured (CTRADER_CLIENT_ID/_SECRET + a token).")
        self.account_id = str(ctid)
        primary = self._resolve_host()
        other = "demo.ctraderapi.com" if primary.startswith("live") else "live.ctraderapi.com"
        for host in (primary, other):
            try:
                return asyncio.run(self._fetch_trendbars(host, int(ctid), items))
            except Exception as e:  # noqa: BLE001
                up = str(e).upper()
                if not any(k in up for k in ("ACCOUNT_DISABLED", "NOT_AUTHORIZED", "ACCOUNT_NOT")):
                    raise
        raise RuntimeError("cTrader trendbar fetch failed on both demo and live hosts.")

    async def _fetch_trendbars(self, host: str, ctid: int, items: list) -> list:
        from ctrader_open_api.messages.OpenApiCommonMessages_pb2 import ProtoMessage
        from ctrader_open_api.messages.OpenApiMessages_pb2 import (
            ProtoOAApplicationAuthReq, ProtoOAAccountAuthReq, ProtoOAErrorRes,
            ProtoOASymbolsListReq, ProtoOASymbolsListRes,
            ProtoOAGetTrendbarsReq, ProtoOAGetTrendbarsRes,
        )

        ctx = ssl.create_default_context()
        reader, writer = await asyncio.open_connection(host, 5035, ssl=ctx)

        async def send(msg):
            pm = ProtoMessage(payloadType=msg.payloadType, payload=msg.SerializeToString())
            data = pm.SerializeToString()
            writer.write(struct.pack(">I", len(data)) + data)
            await writer.drain()

        async def recv():
            header = await asyncio.wait_for(reader.readexactly(4), timeout=20)
            (length,) = struct.unpack(">I", header)
            payload = await asyncio.wait_for(reader.readexactly(length), timeout=20)
            pm = ProtoMessage()
            pm.ParseFromString(payload)
            return pm

        async def await_pt(expected: int):
            for _ in range(50):
                pm = await recv()
                if pm.payloadType == PT_ERROR_RES:
                    err = ProtoOAErrorRes()
                    err.ParseFromString(pm.payload)
                    raise RuntimeError(f"cTrader error {err.errorCode}: {err.description}")
                if pm.payloadType == expected:
                    return pm
            raise RuntimeError(f"cTrader: no response of type {expected}")

        results: list = []
        try:
            await send(ProtoOAApplicationAuthReq(clientId=self.client_id, clientSecret=self.client_secret))
            await await_pt(PT_APP_AUTH_RES)
            await send(ProtoOAAccountAuthReq(ctidTraderAccountId=ctid, accessToken=self.active_token()))
            await await_pt(PT_ACCOUNT_AUTH_RES)

            await send(ProtoOASymbolsListReq(ctidTraderAccountId=ctid))
            sym_pm = await await_pt(PT_SYMBOLS_LIST_RES)
            sres = ProtoOASymbolsListRes()
            sres.ParseFromString(sym_pm.payload)
            name2id = {s.symbolName: s.symbolId for s in sres.symbol}
            name2id_up = {k.upper(): v for k, v in name2id.items()}

            for it in items:
                sid = name2id.get(it["symbol"]) or name2id_up.get(str(it["symbol"]).upper())
                period = TRENDBAR_PERIOD.get(it["interval_sec"])
                if not sid or not period:
                    results.append(None)
                    continue
                await asyncio.sleep(0.6)   # throttle historical requests
                await send(ProtoOAGetTrendbarsReq(
                    ctidTraderAccountId=ctid, symbolId=sid, period=period,
                    fromTimestamp=int(it["from_ms"]), toTimestamp=int(it["to_ms"]),
                ))
                try:
                    pm = await await_pt(PT_GET_TRENDBARS_RES)
                    res = ProtoOAGetTrendbarsRes()
                    res.ParseFromString(pm.payload)
                    bars = []
                    for tb in res.trendbar:
                        low = tb.low / TRENDBAR_SCALE
                        bars.append({
                            "time": int(tb.utcTimestampInMinutes) * 60,
                            "open": round(low + tb.deltaOpen / TRENDBAR_SCALE, 5),
                            "high": round(low + tb.deltaHigh / TRENDBAR_SCALE, 5),
                            "low": round(low, 5),
                            "close": round(low + tb.deltaClose / TRENDBAR_SCALE, 5),
                        })
                    bars.sort(key=lambda b: b["time"])
                    results.append(bars or None)
                except RuntimeError as e:
                    msg = str(e)
                    if "BLOCKED_PAYLOAD_TYPE" in msg or "rate limit" in msg.lower():
                        await asyncio.sleep(2.0)
                    results.append(None)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
        return results

    # --- Open API (protobuf) live account snapshot --------------------------
    def fetch_account_snapshot(self, ctid) -> dict:
        """Live open positions + exact used margin + balance straight from cTrader
        (ProtoOAReconcile + ProtoOATrader). Used for the FTMO-style live dashboard."""
        if not self.is_configured():
            raise RuntimeError("cTrader not configured (CTRADER_CLIENT_ID/_SECRET + a token).")
        self.account_id = str(ctid)
        primary = self._resolve_host()
        other = "demo.ctraderapi.com" if primary.startswith("live") else "live.ctraderapi.com"
        for host in (primary, other):
            try:
                return asyncio.run(self._fetch_snapshot(host, int(ctid)))
            except Exception as e:  # noqa: BLE001
                up = str(e).upper()
                if not any(k in up for k in ("ACCOUNT_DISABLED", "NOT_AUTHORIZED", "ACCOUNT_NOT")):
                    raise
        raise RuntimeError("cTrader account snapshot failed on both demo and live hosts.")

    async def _fetch_snapshot(self, host: str, ctid: int) -> dict:
        from ctrader_open_api.messages.OpenApiCommonMessages_pb2 import ProtoMessage
        from ctrader_open_api.messages.OpenApiMessages_pb2 import (
            ProtoOAApplicationAuthReq, ProtoOAAccountAuthReq, ProtoOAErrorRes,
            ProtoOASymbolsListReq, ProtoOASymbolsListRes,
            ProtoOAReconcileReq, ProtoOAReconcileRes, ProtoOATraderReq, ProtoOATraderRes,
        )

        ctx = ssl.create_default_context()
        reader, writer = await asyncio.open_connection(host, 5035, ssl=ctx)

        async def send(msg):
            pm = ProtoMessage(payloadType=msg.payloadType, payload=msg.SerializeToString())
            data = pm.SerializeToString()
            writer.write(struct.pack(">I", len(data)) + data)
            await writer.drain()

        async def recv():
            header = await asyncio.wait_for(reader.readexactly(4), timeout=20)
            (length,) = struct.unpack(">I", header)
            payload = await asyncio.wait_for(reader.readexactly(length), timeout=20)
            pm = ProtoMessage()
            pm.ParseFromString(payload)
            return pm

        async def await_pt(expected: int):
            for _ in range(50):
                pm = await recv()
                if pm.payloadType == PT_ERROR_RES:
                    err = ProtoOAErrorRes()
                    err.ParseFromString(pm.payload)
                    raise RuntimeError(f"cTrader error {err.errorCode}: {err.description}")
                if pm.payloadType == expected:
                    return pm
            raise RuntimeError(f"cTrader: no response of type {expected}")

        try:
            await send(ProtoOAApplicationAuthReq(clientId=self.client_id, clientSecret=self.client_secret))
            await await_pt(PT_APP_AUTH_RES)
            await send(ProtoOAAccountAuthReq(ctidTraderAccountId=ctid, accessToken=self.active_token()))
            await await_pt(PT_ACCOUNT_AUTH_RES)

            cached = _SYMBOLS_CACHE.get((host, ctid))
            if cached and time.time() - cached[0] < _SYMBOLS_TTL:
                id2name, sym_meta = cached[1], cached[2]
            else:
                await send(ProtoOASymbolsListReq(ctidTraderAccountId=ctid))
                sres = ProtoOASymbolsListRes()
                sres.ParseFromString((await await_pt(PT_SYMBOLS_LIST_RES)).payload)
                id2name = {s.symbolId: s.symbolName for s in sres.symbol}
                sym_meta = {s.symbolId: {"lot_size": ((getattr(s, "lotSize", 0) or 0) / 100.0)}
                            for s in sres.symbol}
                _SYMBOLS_CACHE[(host, ctid)] = (time.time(), id2name, sym_meta)

            await send(ProtoOATraderReq(ctidTraderAccountId=ctid))
            tres = ProtoOATraderRes()
            tres.ParseFromString((await await_pt(PT_TRADER_RES)).payload)
            tr = tres.trader
            tmd = _money_digits(tr)
            balance = tr.balance / tmd

            await send(ProtoOAReconcileReq(ctidTraderAccountId=ctid))
            rres = ProtoOAReconcileRes()
            rres.ParseFromString((await await_pt(PT_RECONCILE_RES)).payload)

            positions = []
            for p in rres.position:
                if getattr(p, "positionStatus", 1) not in (1,):   # 1 = OPEN
                    continue
                td = p.tradeData
                md = _money_digits(p)

                def _opt(msg, name):
                    """Optional proto field -> value or None (0.0 is a valid price, so
                    truthiness is not safe here)."""
                    try:
                        return getattr(msg, name) if msg.HasField(name) else None
                    except Exception:  # noqa: BLE001
                        v = getattr(msg, name, 0) or 0
                        return v or None

                positions.append({
                    "position_id": p.positionId,
                    "symbol": id2name.get(td.symbolId, str(td.symbolId)),
                    "direction": "long" if td.tradeSide == BUY else "short",
                    "lots": _lots_from_volume(td.volume, sym_meta.get(td.symbolId)),
                    "entry": p.price,
                    "stop_loss": _opt(p, "stopLoss"),
                    "take_profit": _opt(p, "takeProfit"),
                    "used_margin": getattr(p, "usedMargin", 0) / md,
                    "swap": getattr(p, "swap", 0) / md,
                    "commission": getattr(p, "commission", 0) / md,
                    "open_ts": getattr(td, "openTimestamp", 0),
                })
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

        return {"balance": balance, "used_margin": sum(p["used_margin"] for p in positions),
                "positions": positions}

    @staticmethod
    def _deals_to_trades(deals, symbols, group_window: int = 60,
                         sym_meta: Optional[dict] = None) -> List[NormalizedTrade]:
        from collections import defaultdict
        by_pos = defaultdict(list)
        for d in deals:
            by_pos[d.positionId].append(d)

        def dt(ms):
            return datetime.utcfromtimestamp(ms / 1000)

        positions = []
        for pid, ds in by_pos.items():
            ds.sort(key=lambda d: d.executionTimestamp)
            entries = [d for d in ds if not d.HasField("closePositionDetail")]
            exits = [d for d in ds if d.HasField("closePositionDetail")]
            if not entries:
                continue
            direction = "long" if entries[0].tradeSide == BUY else "short"
            symbol = symbols.get(entries[0].symbolId, str(entries[0].symbolId))
            meta = (sym_meta or {}).get(entries[0].symbolId)

            fills: List[NormalizedFill] = []
            for e in entries:
                md = _money_digits(e)
                fills.append(NormalizedFill(
                    kind="entry", price=e.executionPrice,
                    lots=_lots_from_volume(e.volume, meta),
                    executed_at=dt(e.executionTimestamp),
                    fee=abs(e.commission) / md, external_id=str(e.dealId),
                ))
            for x in exits:
                cpd = x.closePositionDetail
                md_deal = _money_digits(x)                    # commission precision
                md_cpd = _money_digits(cpd)                   # grossProfit / swap precision
                gp = cpd.grossProfit / md_cpd
                kind = "tp" if gp > 0 else ("sl" if gp < 0 else "close")
                lots = _lots_from_volume(cpd.closedVolume or x.volume, meta)
                fills.append(NormalizedFill(
                    kind=kind, price=x.executionPrice, lots=lots,
                    executed_at=dt(x.executionTimestamp),
                    fee=abs(x.commission) / md_deal + abs(cpd.swap) / md_cpd,
                    external_id=str(x.dealId),
                ))

            positions.append({
                "pid": pid, "symbol": symbol, "direction": direction,
                "opened_at": min(f.executed_at for f in fills), "fills": fills,
            })

        out: List[NormalizedTrade] = []
        for g in _group_positions(positions, group_window):
            out.append(NormalizedTrade(
                external_id="ct-" + str(min(g["pids"])),
                symbol=g["symbol"], direction=g["direction"],
                opened_at=min(f.executed_at for f in g["fills"]),
                fills=g["fills"], contract_size=1.0,
                position_ids=[str(p) for p in g["pids"]],
            ))
        return out
