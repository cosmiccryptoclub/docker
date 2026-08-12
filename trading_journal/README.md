# Trade Journal

A self-hosted trading journal for **cTrader**, built around how scalpers actually
trade: hotkey **scale-in entries** and **partial take-profits** are grouped into one
logical trade. Syncs automatically from the cTrader Open API, charts every trade on
real candles, and keeps a permanent local copy of the price data.

One Docker container, SQLite in a volume. Your data never leaves your machine.

![Dashboard](docs/screenshots/dashboard.png)

> All screenshots use the built-in dummy-data generator.

---

## Quick start

```bash
cp .env.example .env          # optional — the app runs without any credentials
docker compose up -d --build
```

Open <http://localhost:5010>, then **Settings → Data & system → Dummy data** to fill
it with realistic trades and explore everything below.

To sync real trades: create an app at [openapi.ctrader.com](https://openapi.ctrader.com/),
put the client ID/secret in `.env`, add `http://localhost:5010/` as a Redirect URI,
then **Settings → cTrader sync → Connect**.

---

## What it does

### One trade = many fills

Hotkey scale-ins and partial TPs collapse into a single logical trade. Average entry,
realized P&L, R-multiple and remaining size are all derived from the individual fills.
Trades opened close together are grouped automatically; anything further apart you can
**merge by hand**, and the grouping survives re-syncs.

![Trades](docs/screenshots/trades.png)

*Expand any trade inline to see its individual fills.*

### Real candles, and a full trade log

Every trade is charted on real price data — Binance for crypto, Yahoo for stocks,
indices, forex and metals — with your entries, partial TPs and (averaged) stop plotted,
plus bar-by-bar replay. Candles are **stored permanently** the first time a trade is
seen, so charts still work years later when the free data sources have long expired.

Underneath, a chronological **trade log**: every entry, every take-profit, every time
you moved your stop, and every overnight swap charge.

![Trade detail](docs/screenshots/trade-detail.png)

### Excursion analytics

Per trade: **MAE/MFE** (how much heat you took vs how far it ran), **capture %** (how
much of the peak you kept) and a **post-mortem** looking ahead past your exit to say
whether you left money on the table or got out at the right time. Aggregated on the
dashboard, plus an **exit optimiser** that replays fixed R-targets against your real
history to find where your exits should have been.

### Tags that find your edge

Fully configurable tag groups with colours, multi/single select and drag-reorder.
Import your own set by pasting a list, uploading a file, or copying the built-in
**LLM prompt** to turn messy notes into importable JSON — imports only ever *add*,
never overwrite or duplicate.

![Tags](docs/screenshots/tags.png)

Then drill down: net P&L, win rate, expectancy and avg R per tag, with best/worst
leaderboards.

![Tag Insights](docs/screenshots/tag-insights.png)

### Calendar & daily journal

Monthly P&L grid. Click any day for its stats, its trades, and a daily journal —
pre-market plan, notes, lessons, mood, discipline rating and a "did I follow the plan?"
flag. **Discipline goals** (max trades/day, daily-loss cap, monthly R target, minimum
checklist adherence) are tracked here and on the dashboard.

![Calendar & Journal](docs/screenshots/calendar-journal.png)

### Weekly review

Week at a glance: stats, per-day results, best and worst trades, and the mistakes you
logged.

![Weekly Review](docs/screenshots/weekly-review.png)

### Missing data

One screen listing every trade with journal fields left blank, counted per field and
clickable to filter — so you can fill the gaps in one pass instead of hunting. Trades
you'll never complete can be ignored.

![Missing data](docs/screenshots/missing-data.png)

### Playbooks

Define strategies with pre-trade rule checklists, then see your win rate bucketed by
how closely you actually followed them.

![Playbooks](docs/screenshots/playbooks.png)

### Prop-firm rules, alerts and tracking

Per-account daily-loss, max-drawdown (static or trailing) and profit targets, with a
configurable warning threshold and **Discord alerts** when you approach a limit, breach
one, or hit a target — as rich embeds, plus an optional daily summary.

Separately, a **prop-firm ledger**: log challenge fees, resets, subscriptions, payouts
and refunds to see total spent, total received, net profit and return-on-fees per firm
and per year, with a tax-summary export.

![Prop firms](docs/screenshots/prop-firms.png)

Alerts arrive as rich embeds with a progress bar per rule. "Send test message" posts a
sample of every alert type at once, so you can see exactly what you'll get:

<img src="docs/screenshots/discord-alerts.png" width="420" alt="Discord alerts">

### Live view

Balance, equity, floating P&L, used/free margin, margin level and open positions
straight from the broker, refreshing every 5 seconds, with positions rolled up by
symbol and direction.

### Accounts

Multiple accounts (prop challenges, funded, demos) with a global aggregated view or
per-account drill-down.

![Accounts](docs/screenshots/accounts.png)

### Backtest sandbox

Replay historical candles and log practice trades into an isolated account that's
excluded from your real stats.

![Backtest](docs/screenshots/backtest.png)

### Everything is configurable

Five tabs of settings — nothing is hard-coded.

**General** — app defaults and cTrader auto-sync targets.

![Settings — general](docs/screenshots/settings-1-general.png)

**cTrader sync** — connect via OAuth, map broker accounts, set the scale-in group window.

![Settings — cTrader sync](docs/screenshots/settings-2-ctrader-sync.png)

**Market data** — candle collection and storage, plus optional broker-exact candles.

![Settings — market data](docs/screenshots/settings-3-market-data.png)

**Goals & alerts** — Discord webhook, warning threshold, per-event toggles and your
discipline goals.

![Settings — goals & alerts](docs/screenshots/settings-4-goals-alerts.png)

**Data & system** — backups, exports, dummy data and manual import.

![Settings — data & system](docs/screenshots/settings-5-data-system.png)

### Runs itself

Background jobs handle auto-sync, candle collection, stop/swap tracking, the economic
calendar and nightly database backups — all visible, with next/last run and a "run now"
button. There's a filterable event log too.

![Scheduled tasks](docs/screenshots/scheduled-tasks.png)

---

## Also in there

- **Economic calendar** — high-impact news overlaid on trade charts, plus an
  upcoming-events widget.
- **Stop-loss tracking** — every stop move recorded (to breakeven, trailed, or widened).
- **Sessions** — auto-detected and overlapping (a 15:00 entry is both London *and* New
  York), including a CME-closed window.
- **Exports** — trades as CSV/JSON honouring your current filters, per-fill CSV, prop
  ledger and tax summary.
- **Screenshot paste** — paste an image straight from the clipboard onto a trade.
- **Timezone aware** — set `APP_TIMEZONE`; daylight saving handled automatically.
- Mobile and tablet friendly, collapsible sidebar, dummy-data generator.

## Stack

FastAPI · SQLModel/SQLite (WAL) · APScheduler · httpx · React 18 · Vite · Tailwind ·
Recharts · lightweight-charts

## Notes

- **No authentication** — this is designed to run on your own machine or LAN. Don't
  expose the port to the internet.
- Volume→lots scaling is tuned for BTC/ETH CFDs and falls back to each symbol's own
  `lotSize` from cTrader — verify P&L on other instruments after your first sync.
- Everything lives in `./data` (database, broker token, settings, screenshots,
  backups). Back up that folder and you've backed up everything. It's gitignored.

## Roadmap

Where this is going next, roughly in order:

- **Crypto CEX connectors** — futures and perpetuals via read-only API keys, so
  exchange trades land in the same journal as your cTrader ones.
- **DEX / on-chain support** — read-only by wallet address, no keys.
- **Spot trading** — positions you buy and *hold*, which don't fit the open/close model.
- **Deposits & withdrawals** — a cash-movement ledger so balances, ROI and drawdown
  stay correct when money moves in or out.
- **Financial reports** — period P&L statements across accounts.
- **Tax reports** for trading (the current export only covers prop-firm fees vs payouts).
- **More import formats** — MT4/5 statements and exchange CSVs alongside the existing
  JSON / fills CSV.
- **Guided backfill** when you link a new account, instead of waiting for the
  incremental collector.
- **Retroactive stop history** — stop-move tracking currently starts the day you run
  it; pulling the history that already exists broker-side would fill in the past.

Ideas and PRs welcome.

## Licence

[MIT](../LICENSE) — do what you like with it, no warranty.
