# docker

Self-hosted apps that run in Docker. Each folder is a standalone `docker-compose`
stack — clone the repo, pick a folder, run one command.

Everything here runs entirely on your own machine. No cloud accounts, no telemetry;
your data stays in a `data/` folder you control.

---

## What's inside

| App | What it is |
|---|---|
| **[trading_journal](trading_journal/)** | A trading journal for **cTrader**, built around scale-in entries and partial take-profits. Auto-syncs your trades, charts them on real candles, and tracks prop-firm rules with Discord alerts. |

*More to come.*

---

## Quick start

**New to Docker?** Start with **[DOCKER-SETUP.md](DOCKER-SETUP.md)** — a complete
install guide for Windows and macOS, plus everything you need to run and maintain
these containers. (It's written so you can also just hand the whole file to an AI
assistant and have it walk you through.)

Already set up?

```bash
git clone https://github.com/cosmiccryptoclub/docker.git
cd docker/trading_journal

cp .env.example .env          # Windows: copy .env.example .env
docker compose up -d --build
```

Then open the port listed in that app's README (the trading journal is
<http://localhost:5010>).

Connecting the trading journal to a real cTrader account needs an Open API application —
see **[trading_journal/CTRADER-SETUP.md](trading_journal/CTRADER-SETUP.md)**.

---

## How these apps are laid out

Every app follows the same conventions, so once you've run one you can run any of them:

```
<app>/
├── docker-compose.yml    # how to run it — ports live here
├── Dockerfile            # how to build it
├── .env.example          # config template — copy to .env and fill in
├── data/                 # your database, uploads, backups (gitignored)
└── README.md             # what it does, screenshots, setup
```

- **Config** goes in `.env`, never committed. Each app ships a `.env.example`.
- **Data** goes in `data/`, never committed. Back that folder up and you've backed up
  everything.
- **`docker compose down` keeps your data** — it only removes the container. Only
  `down -v` deletes it.
- **Updating** is `git pull` then `docker compose up -d --build`. Your data and config
  survive untouched.

Ports are set in each app's `docker-compose.yml`. If one clashes with something you
already run, change the number on the *left* of the colon.

---

## Contributing

Issues and pull requests welcome. If you add an app, please follow the layout above —
a `.env.example` (never a real `.env`), a gitignored `data/` folder, and a README that
says what it does and which port it uses.

## Licence

[MIT](LICENSE) — do what you like with it, no warranty.
