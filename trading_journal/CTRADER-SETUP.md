# Connecting cTrader

How to register a cTrader Open API application, get your credentials, and connect the
journal to your trading account.

You only need this to sync **real trades**. The app runs fine without it — use
**Settings → Data & system → Dummy data** to explore first.

> **Plan for a wait.** Spotware review every application by hand, so there's a delay
> between applying and being able to sync. Apply early.

---

## Contents

1. [What you'll need](#1-what-youll-need)
2. [Register your application](#2-register-your-application)
3. [Wait for approval](#3-wait-for-approval)
4. [Add your Redirect URI](#4-add-your-redirect-uri)
5. [Put the credentials in `.env`](#5-put-the-credentials-in-env)
6. [Connect and sync](#6-connect-and-sync)
7. [Troubleshooting](#7-troubleshooting)
8. [How the token is handled](#8-how-the-token-is-handled)

---

## 1. What you'll need

- A **cTrader ID (cTID)** — the account you log into cTrader with. Free at
  <https://id.ctrader.com/>.
- At least one **trading account** linked to that cTID (demo is fine).
- The journal already running, so you know its URL — by default
  <http://localhost:5010>.

---

## 2. Register your application

1. Go to the **[cTrader Open API portal](https://openapi.ctrader.com/apps)** and sign
   in with your cTrader ID.
2. Click **Add new App**.
3. Fill in the two mandatory fields:

   | Field | What to put |
   |---|---|
   | **Application name** | Anything — e.g. `My Trading Journal` |
   | **Description** | See below — this matters |

4. Submit.

### Write a real description

Spotware review each application manually and **a vague description is the main reason
they come back asking questions**, which adds days. Say plainly what it does, that it's
for your own account, and that it's read-only.

Something like:

> A private, self-hosted trading journal for my own cTrader accounts. It uses the Open
> API to read my historical deals and open positions so it can group them into trades
> and calculate my own performance statistics (win rate, R-multiple, drawdown). It is
> read-only — it never places, modifies or closes orders. Single user, runs locally in
> Docker on my own machine, not distributed to anyone else.

Adjust it to be true for you. If you do intend to share it with others, say so — being
straight with them is faster than being asked twice.

---

## 3. Wait for approval

Your app starts at status **Submitted**. Spotware review it and email you when it
becomes **Active** — commonly a day or two, but it varies.

**You cannot sync until the app is Active.** The Client ID and Secret exist before
then, but they won't authenticate.

If they email asking for more detail, reply with specifics about what data you read and
what you do with it.

---

## 4. Add your Redirect URI

Once the app is **Active**, open it in the portal and add a **Redirect URI**.

This is the address cTrader sends you back to after you approve access, so it must be
**exactly** the URL you use to reach the journal, including the trailing slash:

```
http://localhost:5010/
```

Running it on another machine on your network? Use that address instead, e.g.
`http://192.168.1.50:5010/`. If you use several, add them all — the portal accepts
multiple.

> ⚠️ **Two things that catch people out:**
> - The **default redirect URI** shown in the portal is for the *Playground only* and
>   will not work here. You must add your own.
> - It must match **character for character**. Missing the trailing `/`, or using
>   `127.0.0.1` when you browse to `localhost`, gives
>   *"Provided application does not contain provided URI"*.

---

## 5. Put the credentials in `.env`

Copy the **Client ID** and **Client Secret** from your app's page in the portal into
the journal's `.env`:

```ini
CTRADER_CLIENT_ID=your_client_id_here
CTRADER_CLIENT_SECRET=your_client_secret_here
```

Leave the rest blank — the app fetches the token for you:

```ini
CTRADER_ACCESS_TOKEN=
CTRADER_ACCOUNT_ID=
```

Then restart so it picks up the change:

```bash
docker compose up -d
```

> `.env` is gitignored and never leaves your machine. Treat the Client Secret like a
> password: don't paste it into chats, screenshots or issues.

---

## 6. Connect and sync

In the journal, go to **Settings → cTrader sync**:

1. **Connect cTrader (production token)** — sends you to cTrader to approve access,
   then back. The status dot turns green: *"Production token connected (OAuth)."*
2. **Fetch my cTrader accounts** — lists every trading account on your cTID.
3. For each one you want, pick the **local account** to sync into and press **Sync**.

That's it. From then on the app re-syncs on its own (every 5 minutes by default,
adjustable under **Settings → General**), captures candles for new trades, and records
stop moves and swap charges on open positions.

**Grouping:** the *group window* decides how far apart two entries can be and still
count as one scale-in trade — 120 seconds by default. Raise it if you scale in slowly;
anything wider can still be merged by hand from the Trades page.

---

## 7. Troubleshooting

**`RET_ACCOUNT_DISABLED`**
Almost always a **sandbox token**. The Playground's *"Get token"* button issues one that
can list accounts but cannot read deals. Use the **Connect cTrader** button in the app
instead, which runs the production OAuth flow.

If you already connected properly and still see it, that specific account isn't enabled
for the Open API. Some prop-firm demo accounts aren't — try another account to confirm.

**"Provided application does not contain provided URI"**
Your Redirect URI doesn't match. Re-read [step 4](#4-add-your-redirect-uri) — it's
almost always a missing trailing slash, or `localhost` vs `127.0.0.1`.

**`BLOCKED_PAYLOAD_TYPE: You are being rate limited`**
cTrader limits historical requests hard. The app already throttles and backs off, so
this normally resolves itself; if a sync fails, wait a minute and retry.

**Nothing syncs, no error**
Check **Scheduled Tasks** — a failed auto-sync shows red with the reason. **Logs**
has the detail.

**P&L looks wrong on some instruments**
Volume→lots conversion uses each symbol's own lot size from cTrader where available and
falls back to a BTC/ETH-tuned constant. Verify a couple of trades against your platform
after the first sync and open an issue if something's off.

---

## 8. How the token is handled

- The OAuth token is stored in **`data/ctrader_token.json`** on your machine — never
  committed, never sent anywhere but cTrader.
- It's **refreshed automatically** when it nears expiry, so day to day you won't think
  about it.
- Tokens last roughly a month. If sync stops and the Logs point at authentication,
  press **Connect cTrader** again to re-authorise.
- The app only ever **reads**. It requests deals, positions, symbols and account
  details — it never sends an order.

---

## Reference

- [Register an application — cTrader Help Centre](https://help.ctrader.com/open-api/api-application/)
- [Creating a new app — cTrader Help Centre](https://help.ctrader.com/open-api/creating-new-app/)
- [App and account authentication](https://help.ctrader.com/open-api/account-authentication/)
- [Open API portal](https://openapi.ctrader.com/apps)
