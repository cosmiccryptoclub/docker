"""
Data model for the trade journal.

Core idea (matches how you actually trade on cTrader):

    Account 1---* Trade 1---* Fill

A **Trade** is one *logical* position on one symbol/direction. It is built from
many **Fills** (executions):

    * kind="entry"  -> a scale-in / add (your hotkey multi-entries)
    * kind="tp"     -> a partial take-profit (ATP1..ATP4)
    * kind="sl"     -> stopped out
    * kind="close"  -> manual / other close

So "enter 3 times then take 4 partial TPs" = 1 Trade with 7 Fills. All the
money math (avg entry, realized PnL, R, remaining size) is derived from the
fills in `metrics.py` and cached back onto the Trade for fast list/aggregation.
"""
from datetime import datetime
from typing import List, Optional

from sqlalchemy import JSON, Column, Index, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel


# --- enumerated string values (kept as plain str for SQLite friendliness) ----
ACCOUNT_TYPES = ["demo", "prop-challenge", "prop-funded", "live"]
DIRECTIONS = ["long", "short"]
TRADE_STATUS = ["open", "closed"]
FILL_KINDS = ["entry", "tp", "sl", "close"]
SESSIONS = ["Asia", "London", "New York", "CME Closed", "Closed", "Weekend"]  # see src/sessions.py


class Account(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    broker: str = "cTrader"
    account_type: str = "demo"            # one of ACCOUNT_TYPES
    prop_firm: Optional[str] = None       # "FundingPips", "FTMO", ...
    currency: str = "USD"
    starting_balance: float = 100_000.0
    leverage: Optional[int] = None
    color: str = "#3b82f6"                # UI accent for this account
    external_id: Optional[str] = Field(default=None, index=True)  # ctidTraderAccountId
    is_active: bool = True
    is_backtest: bool = False              # backtest sandbox account (excluded from global stats)
    notes: Optional[str] = None

    # prop-firm risk rules (all optional, in account currency)
    daily_loss_limit: Optional[float] = None   # max loss allowed in one day
    max_loss_limit: Optional[float] = None     # overall max loss / drawdown
    profit_target: Optional[float] = None       # challenge target
    trailing_dd: bool = False                   # max loss trails peak equity vs from start

    created_at: datetime = Field(default_factory=datetime.utcnow)

    trades: List["Trade"] = Relationship(back_populates="account")


class Symbol(SQLModel, table=True):
    """Instrument metadata used for PnL/point math and display."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)   # "BTCUSD"
    category: str = "crypto"                      # crypto|forex|indices|commodities|stocks|futures
    contract_size: float = 1.0                    # units per 1.0 lot
    quote_currency: str = "USD"
    pip_size: float = 1.0                         # price move that counts as "1 point/pip"
    price_decimals: int = 2


# --- configurable tag taxonomy ----------------------------------------------
# A TagCategory is a group ("Technical Analysis", "Order Flow"…); it holds many
# TagOptions ("Order Block", "Fair Value Gap"…). A Trade links to many options
# across categories (multi-select), so you can drill performance down by any tag.

class TradeTagLink(SQLModel, table=True):
    trade_id: int = Field(foreign_key="trade.id", primary_key=True)
    option_id: int = Field(foreign_key="tagoption.id", primary_key=True)


class TagCategory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    color: str = "#64748b"
    multi: bool = True                 # allow multiple options selected per trade
    sort: int = 0
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    options: List["TagOption"] = Relationship(
        back_populates="category",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "order_by": "TagOption.sort"},
    )


class TagOption(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    category_id: int = Field(foreign_key="tagcategory.id", index=True)
    name: str = Field(index=True)
    sort: int = 0
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    category: Optional[TagCategory] = Relationship(back_populates="options")


class Playbook(SQLModel, table=True):
    """A named strategy with a pre-trade rule checklist."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    color: str = "#3b82f6"
    rules: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    sort: int = 0
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Trade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    account_id: int = Field(foreign_key="account.id", index=True)

    symbol: str = Field(index=True)
    direction: str = "long"               # long|short
    status: str = Field(default="open", index=True)  # open|closed (derived, cached)

    opened_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    closed_at: Optional[datetime] = Field(default=None, index=True)

    contract_size: float = 1.0            # snapshot from Symbol at creation (units per lot)

    # Risk / planning
    initial_stop: Optional[float] = None      # price -> used for R multiple
    stop_is_avg: Optional[bool] = None        # stop is a weighted avg across scale-ins
    initial_target: Optional[float] = None    # price -> first planned target
    planned_targets: List[dict] = Field(default_factory=list, sa_column=Column(JSON))
    # planned_targets: [{"price": 118000, "lots": 0.1, "label": "ATP1"}, ...]

    # Live/last mark (for unrealized PnL on open trades)
    last_price: Optional[float] = None

    # Journaling
    setup: Optional[str] = Field(default=None, index=True)   # strategy / playbook name
    session: Optional[str] = None            # legacy single label; superseded by `sessions`
    sessions: List[str] = Field(default_factory=list, sa_column=Column(JSON))  # overlapping
    timeframe: Optional[str] = None
    playbook_id: Optional[int] = Field(default=None, foreign_key="playbook.id", index=True)
    checklist: List[dict] = Field(default_factory=list, sa_column=Column(JSON))  # [{"rule","checked"}]
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    rating: Optional[int] = None                             # 1..5 self-grade (execution)
    confidence: Optional[int] = None                         # 1..5 conviction at entry
    notes: Optional[str] = None
    mistakes: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    data_ignored: Optional[bool] = None   # hide from the Missing data page
    screenshots: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    # Excursion (max adverse / favourable), price terms; optional
    mae_price: Optional[float] = None
    mfe_price: Optional[float] = None

    external_id: Optional[str] = Field(default=None, index=True)  # broker position id
    # every broker position folded into this trade (scale-ins grouped auto or manually);
    # used to attach TradeEvents and to re-apply manual grouping on each sync
    position_ids: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    # --- cached derived metrics (recomputed whenever fills change) -----------
    avg_entry: Optional[float] = None
    total_entry_lots: float = 0.0
    total_exit_lots: float = 0.0
    remaining_lots: float = 0.0
    realized_pnl: float = 0.0
    fees_total: float = 0.0
    r_multiple: Optional[float] = None
    return_pct: Optional[float] = None       # realized_pnl / account.starting_balance * 100

    # cached excursion analysis (from candles; see candles.build_chart)
    mfe_r: Optional[float] = None
    mae_r: Optional[float] = None
    mfe_dollar: Optional[float] = None
    mae_dollar: Optional[float] = None
    captured_pct: Optional[float] = None         # realized / MFE (winners)
    left_on_table_r: Optional[float] = None       # post-mortem: room after exit, in R
    analysis_source: Optional[str] = None         # 'binance' | 'synthetic'
    candles_stored: bool = Field(default=False, index=True)  # real candles persisted to store

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    account: Optional[Account] = Relationship(back_populates="trades")
    fills: List["Fill"] = Relationship(
        back_populates="trade",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "order_by": "Fill.executed_at"},
    )
    tag_options: List["TagOption"] = Relationship(link_model=TradeTagLink)


class Fill(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trade_id: int = Field(foreign_key="trade.id", index=True)

    kind: str = "entry"                   # entry|tp|sl|close
    price: float = 0.0
    lots: float = 0.0                     # size of this execution, in lots
    executed_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    fee: float = 0.0                      # commission + swap (account currency, cost as positive)
    note: Optional[str] = None
    external_id: Optional[str] = Field(default=None, index=True)  # broker deal/position id
    created_at: datetime = Field(default_factory=datetime.utcnow)

    trade: Optional[Trade] = Relationship(back_populates="fills")


TRADE_EVENT_KINDS = ["stop_change", "target_change", "swap", "commission"]


class TradeEvent(SQLModel, table=True):
    """Non-execution things that happen to a position while it's open.

    Keyed by BROKER POSITION ID, not trade id: the sync deletes/recreates trade rows when
    grouping changes, so anything keyed on trade.id would be orphaned. The trade log joins
    these in via Trade.position_ids.

      stop_change / target_change -> price (+ prev_price); amount unused
      swap / commission           -> amount charged (negative = cost); price unused
    """
    __table_args__ = (
        UniqueConstraint("position_id", "kind", "at", name="uq_trade_event"),
        Index("ix_trade_event_pos", "position_id", "at"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    position_id: str = Field(index=True)
    account_id: Optional[int] = Field(default=None, foreign_key="account.id", index=True)
    kind: str = "stop_change"
    at: datetime = Field(default_factory=datetime.utcnow, index=True)
    price: Optional[float] = None          # new SL/TP price
    prev_price: Optional[float] = None     # what it was before (None = first seen)
    amount: Optional[float] = None         # swap / commission charged
    symbol: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PositionGroup(SQLModel, table=True):
    """User-defined grouping of broker positions into one logical trade.

    Persisted independently of Trade rows so a re-sync (which recreates them) can
    re-apply the grouping. One row per position; positions sharing a group_key merge.
    """
    __table_args__ = (Index("ix_posgroup_key", "group_key"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    position_id: str = Field(index=True, unique=True)
    group_key: str = Field(index=True)
    account_id: Optional[int] = Field(default=None, foreign_key="account.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


PROP_TX_KINDS = ["challenge_fee", "reset_fee", "payout", "refund", "subscription", "other"]


class PropTransaction(SQLModel, table=True):
    """Money in/out with a prop firm: challenge purchases, resets, and payouts.

    `amount` is always POSITIVE; the sign is derived from `kind` (fees are costs,
    payouts/refunds are income) so net profit = payouts + refunds − fees.
    """
    __table_args__ = (Index("ix_proptx_date", "date"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    date: str = Field(index=True)                    # "YYYY-MM-DD" (local/app tz)
    firm: str = Field(index=True)                     # "FTMO", "FundingPips", ...
    kind: str = "challenge_fee"                       # one of PROP_TX_KINDS
    amount: float = 0.0                               # positive magnitude
    currency: str = "USD"
    account_id: Optional[int] = Field(default=None, foreign_key="account.id", index=True)
    account_size: Optional[float] = None              # e.g. 100000 (for challenge fees)
    reference: Optional[str] = None                   # invoice / payout id
    method: Optional[str] = None                      # card, crypto, bank…
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DayNote(SQLModel, table=True):
    """One journal entry per calendar day (mindset, plan, lessons) — global across accounts."""
    id: Optional[int] = Field(default=None, primary_key=True)
    date: str = Field(index=True, unique=True)          # "YYYY-MM-DD" (UTC)
    notes: Optional[str] = None                          # free-form journal
    plan: Optional[str] = None                           # pre-market plan / bias
    lessons: Optional[str] = None                        # what to improve
    rating: Optional[int] = None                         # 1..5 discipline self-grade
    followed_plan: Optional[bool] = None                 # did you stick to the plan?
    mood: Optional[str] = None                            # e.g. calm / anxious / fomo
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class EconEvent(SQLModel, table=True):
    """Economic-calendar event (ForexFactory), persisted so history accumulates over time."""
    __table_args__ = (
        UniqueConstraint("time", "currency", "title", name="uq_econ"),
        Index("ix_econ_time", "time"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    time: int              # epoch seconds (UTC)
    currency: str          # USD, EUR, GBP, ...
    title: str
    impact: str = "Low"    # High | Medium | Low | Holiday
    forecast: Optional[str] = None
    previous: Optional[str] = None
    actual: Optional[str] = None
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class Candle(SQLModel, table=True):
    """Persisted OHLC bars so trades keep real candles even after providers expire them."""
    __table_args__ = (
        UniqueConstraint("symbol", "interval", "time", name="uq_candle"),
        Index("ix_candle_lookup", "symbol", "interval", "time"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    symbol: str
    interval: int          # seconds
    time: int              # epoch seconds
    open: float
    high: float
    low: float
    close: float
    source: str = "yahoo"


class CandleFetch(SQLModel, table=True):
    """Records which (symbol, interval, window) ranges have been fetched + stored."""
    __table_args__ = (Index("ix_candlefetch_lookup", "symbol", "interval"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    symbol: str
    interval: int
    start: int             # epoch seconds
    end: int
    source: str
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
