"""Central configuration + filesystem paths."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# --- Paths -------------------------------------------------------------------
# /app/data is a docker volume, so the DB + uploads survive container rebuilds.
DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
# When running the backend outside docker (local dev), fall back to ./data.
if not DATA_DIR.parent.exists():
    DATA_DIR = Path(__file__).resolve().parent.parent / "data"

UPLOADS_DIR = DATA_DIR / "uploads"
STATIC_DIR = Path(os.getenv("STATIC_DIR", "/app/static"))
if not STATIC_DIR.exists():
    STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "journal.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")

# --- cTrader Open API (optional) --------------------------------------------
CTRADER_CLIENT_ID = os.getenv("CTRADER_CLIENT_ID", "")
CTRADER_CLIENT_SECRET = os.getenv("CTRADER_CLIENT_SECRET", "")
CTRADER_ACCESS_TOKEN = os.getenv("CTRADER_ACCESS_TOKEN", "")
CTRADER_ACCOUNT_ID = os.getenv("CTRADER_ACCOUNT_ID", "")
CTRADER_HOST = os.getenv("CTRADER_HOST", "")  # override live/demo host autodetect
# group cTrader positions on same symbol+direction opened within N seconds into one
# scale-in trade (your hotkey multi-entries). 0 disables grouping.
CTRADER_GROUP_WINDOW = int(os.getenv("CTRADER_GROUP_WINDOW", "120"))

# --- Market data (real candles / live price) --------------------------------
BINANCE_BASE = os.getenv("BINANCE_BASE", "https://api.binance.com")

# --- Display / day-boundary timezone -----------------------------------------
# Storage is ALWAYS naive UTC (container TZ=UTC). This IANA zone only decides how
# datetimes are grouped into "days" (calendar, daily loss, journal) and displayed.
# DST changes (BST<->GMT) are handled automatically by zoneinfo.
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Europe/London")

APP_NAME = "Trade Journal"
APP_VERSION = "0.7.0"
