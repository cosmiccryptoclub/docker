"""
In-memory event log — a ring buffer of background-task activity surfaced on the Logs page.

Everything still prints to stdout (so container logs are unchanged); `record()` also keeps
the last N events in memory with a level + source for filtering in the UI.
"""
from __future__ import annotations

import time
from collections import deque
from threading import Lock

_MAX = 1000
_LOG: deque = deque(maxlen=_MAX)
_LOCK = Lock()
_SEQ = [0]

LEVELS = ("info", "success", "warning", "error")
_ICON = {"info": "•", "success": "✅", "warning": "⚠️", "error": "❌"}


def record(level: str, source: str, message: str) -> None:
    if level not in LEVELS:
        level = "info"
    with _LOCK:
        _SEQ[0] += 1
        _LOG.appendleft({"id": _SEQ[0], "ts": time.time(), "level": level,
                         "source": source, "message": str(message)})
    try:
        print(f"{_ICON.get(level, '•')} [{source}] {message}")
    except Exception:  # noqa: BLE001  (never let logging break a job)
        pass


def info(source: str, message: str) -> None:
    record("info", source, message)


def success(source: str, message: str) -> None:
    record("success", source, message)


def warning(source: str, message: str) -> None:
    record("warning", source, message)


def error(source: str, message: str) -> None:
    record("error", source, message)


def entries(level: str | None = None, source: str | None = None, limit: int = 300) -> list:
    with _LOCK:
        items = list(_LOG)
    if level:
        items = [e for e in items if e["level"] == level]
    if source:
        items = [e for e in items if e["source"] == source]
    return items[:limit]


def sources() -> list:
    with _LOCK:
        return sorted({e["source"] for e in _LOG})
