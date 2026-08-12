# Getting started with Docker

A complete, copy-pasteable guide to installing Docker and running the apps in this
repo — on **Windows** or **macOS**. No prior Docker knowledge assumed.

> **Using an AI assistant?** Paste this whole file into ChatGPT / Claude and say
> *"walk me through this step by step for my machine"*. It has everything needed.

---

## Contents

1. [What Docker is (and why bother)](#1-what-docker-is-and-why-bother)
2. [Install on Windows](#2-install-on-windows)
3. [Install on macOS](#3-install-on-macos)
4. [Check it works](#4-check-it-works)
5. [Get the code](#5-get-the-code)
6. [Run an app](#6-run-an-app)
7. [Everyday commands](#7-everyday-commands)
8. [Where your data lives](#8-where-your-data-lives)
9. [Updating an app](#9-updating-an-app)
10. [Troubleshooting](#10-troubleshooting)
11. [Learn more](#11-learn-more)

---

## 1. What Docker is (and why bother)

Docker packages an application **together with everything it needs to run** — the
right Python version, the right libraries, the right settings — into a single unit
called an **image**. Running that image gives you a **container**: an isolated little
box on your machine that behaves identically whether you're on Windows, a Mac, or a
server in a cupboard.

Why it's worth the setup:

- **No "works on my machine".** You don't install Python, Node or a database. The
  container already has them, at the exact versions the app was built against.
- **Nothing pollutes your computer.** Delete the container and it's gone cleanly.
- **One command to run.** `docker compose up -d` and the app is live.

Three words you'll see constantly:

| Term | What it means |
|---|---|
| **Image** | The blueprint — a snapshot of an app and its dependencies. Built once. |
| **Container** | A running instance of an image. Disposable. |
| **Volume / bind mount** | A folder that survives the container being destroyed. **This is where your data lives.** |

**Docker Compose** is the tool that reads a `docker-compose.yml` file and starts
everything for you with the right ports, folders and settings. Every app in this repo
has one.

---

## 2. Install on Windows

**Requirements:** Windows 10 64-bit (build 19044+) or Windows 11, and virtualisation
enabled in your BIOS (it usually already is).

### Step 1 — Install WSL 2

Docker on Windows runs on top of WSL 2 (Windows Subsystem for Linux). Open
**PowerShell as Administrator** and run:

```powershell
wsl --install
```

Restart when prompted. If you already have WSL, make sure it's up to date:

```powershell
wsl --update
```

### Step 2 — Install Docker Desktop

Download and run the installer:
<https://www.docker.com/products/docker-desktop/>

During install, leave **"Use WSL 2 instead of Hyper-V"** ticked. Restart if asked.

### Step 3 — Start it

Launch **Docker Desktop** from the Start menu and wait for the whale icon in your
system tray to stop animating. That means the engine is running.

> Docker Desktop must be **running** for any `docker` command to work. Set it to start
> on login: *Settings → General → Start Docker Desktop when you sign in*.

### Step 4 — Install Git

<https://git-scm.com/download/win> — accept the defaults.

---

## 3. Install on macOS

### Step 1 — Install Docker Desktop

Download the build that matches your Mac:
<https://www.docker.com/products/docker-desktop/>

- **Apple Silicon** (M1/M2/M3/M4) — "Mac with Apple chip"
- **Intel** — "Mac with Intel chip"

Not sure? Click the Apple menu → *About This Mac* and look at "Chip" or "Processor".

Drag Docker to Applications, launch it, and accept the privileged-helper prompt.
Wait for the whale icon in the menu bar to settle.

### Step 2 — Install Git

macOS ships with it. Run `git --version` in Terminal; if prompted, let it install the
Command Line Tools.

**Prefer Homebrew?**

```bash
brew install --cask docker    # then launch Docker.app once
brew install git
```

---

## 4. Check it works

Open **PowerShell** (Windows) or **Terminal** (macOS) and run:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

The last command downloads a tiny test image and prints *"Hello from Docker!"*. If you
see that, you're ready.

> `docker compose` (with a space) is the current syntax. Older guides use
> `docker-compose` with a hyphen — both usually work, but prefer the space.

---

## 5. Get the code

Pick a folder you'll remember, then:

```bash
git clone https://github.com/cosmiccryptoclub/docker.git
cd docker
```

That gives you every app in this repo. Each lives in its own subfolder.

---

## 6. Run an app

Every app follows the same pattern. Using the trading journal as the example:

```bash
cd trading_journal

# 1. Create your config from the template (then edit it if you need to)
cp .env.example .env          # Windows PowerShell: copy .env.example .env

# 2. Build and start it, in the background
docker compose up -d --build
```

First run takes a few minutes — it downloads base images and builds the app. Later
runs take seconds.

Then open the app in your browser. Each app's own README says which port it uses (the
trading journal is <http://localhost:5010>).

**What the flags mean:**

| Flag | Meaning |
|---|---|
| `up` | Create and start the containers |
| `-d` | Detached — run in the background instead of filling your terminal |
| `--build` | Rebuild the image first (use it after any code change) |

---

## 7. Everyday commands

Run these from inside an app's folder (the one with `docker-compose.yml`).

```bash
# See what's running
docker compose ps

# Watch the logs live (Ctrl+C to stop watching — the app keeps running)
docker compose logs -f

# Last 100 log lines only
docker compose logs --tail=100

# Restart
docker compose restart

# Stop (containers removed, YOUR DATA IS KEPT)
docker compose down

# Start again
docker compose up -d
```

Across your whole machine:

```bash
docker ps                # all running containers
docker stats             # live CPU / memory use
docker system df         # how much disk Docker is using
docker system prune -a   # reclaim space (deletes unused images — safe for data)
```

> **`docker compose down` does not delete your data.** It removes the containers only.
> The one command that *does* delete data is `docker compose down -v` — the `-v`
> removes volumes. Avoid it unless you genuinely want a clean slate.

---

## 8. Where your data lives

Apps in this repo store everything in a **`data/` folder next to the
`docker-compose.yml`**, mapped into the container like this:

```yaml
volumes:
  - ./data:/app/data
```

That means your database, settings, uploads and backups sit in ordinary files on your
own computer. Practical consequences:

- **Rebuilding or updating the app never touches your data.** The container is
  disposable; `data/` is not.
- **To back up, copy the `data/` folder.** That's the whole backup.
- **To move to a new machine,** copy `data/` across after cloning.
- **`data/` is gitignored** — it never gets committed or pushed. Your database and
  credentials stay on your machine.

Config lives in **`.env`**, also gitignored. Each app ships a `.env.example` showing
which values it accepts.

---

## 9. Updating an app

```bash
cd docker            # the repo root
git pull             # fetch the latest code

cd trading_journal   # the app you want to update
docker compose down
docker compose up -d --build
```

Your `data/` and `.env` are untouched — you keep everything.

If an update adds new settings, they'll appear in `.env.example`. Compare it with your
`.env` and copy across anything new.

---

## 10. Troubleshooting

**"docker: command not found" / "The system cannot find the file"**
Docker Desktop isn't installed or isn't running. Launch it and wait for the whale icon
to stop animating.

**"port is already allocated" / "bind: address already in use"**
Something else is using that port. Either stop it, or change the *left* number in the
app's `docker-compose.yml`:

```yaml
ports:
  - "5010:8000"     # change 5010 -> 5011, then browse to localhost:5011
```

Only change the number on the left of the colon.

**Changes to the code aren't showing up**
You rebuilt without `--build`. Run `docker compose up -d --build`.

**It's using a lot of RAM (Windows)**
WSL 2 can be greedy. Create `C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
memory=4GB
processors=2
```

Then `wsl --shutdown` in PowerShell and restart Docker Desktop.

**Build fails on Apple Silicon**
Rare, but if a base image lacks an ARM build, add `platform: linux/amd64` under the
service in `docker-compose.yml`. It'll run under emulation — slower but working.

**Start completely fresh (deletes that app's data)**

```bash
docker compose down -v
```

---

## 11. Learn more

**Official**
- [Docker — Get Started](https://docs.docker.com/get-started/) — the best first read
- [Docker Compose overview](https://docs.docker.com/compose/)
- [Compose file reference](https://docs.docker.com/reference/compose-file/)
- [Docker CLI reference](https://docs.docker.com/reference/cli/docker/)

**Tutorials**
- [Play with Docker](https://labs.play-with-docker.com/) — a free browser sandbox, no install
- [Docker curriculum](https://docker-curriculum.com/) — a friendly beginner walkthrough
- [Awesome Docker](https://github.com/veggiemonk/awesome-docker) — a big curated list

**Video**
- [Docker in 100 Seconds — Fireship](https://www.youtube.com/watch?v=Gjnup-PuquQ) — the 2-minute version
- [Docker Tutorial for Beginners — TechWorld with Nana](https://www.youtube.com/watch?v=3c-iBn73dDE) — thorough, ~3 hours

**Reference**
- [Docker Hub](https://hub.docker.com/) — where public images come from
- [Best practices for writing Dockerfiles](https://docs.docker.com/build/building/best-practices/)
