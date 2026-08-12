"""
Tag taxonomy import / export.

Import is strictly ADDITIVE — it never renames, recolours, deletes or duplicates
anything that already exists. Categories and options are matched case-insensitively on
their trimmed name, so re-importing the same payload twice is a no-op. That makes it safe
to paste a partial list, paste the same list again, or merge someone else's set into yours.

Two input shapes are accepted so hand-typed notes work as well as machine output:

  JSON   {"categories": [{"name": "...", "color": "#f59e0b", "multi": true,
                          "options": ["...", "..."]}]}

  TEXT   Liquidity Grab            <- a line with no bullet starts a group
           - Medium node hit       <- bullets (-, *, •) or indented lines are its items
           - Large node hit
         Volume nodes
           - HVN
"""
from __future__ import annotations

import json
import re
from typing import List, Optional, Tuple

from sqlmodel import Session, select

from src.models import TagCategory, TagOption

# same palette the Tags page offers, so auto-assigned colours look intentional
PALETTE = ["#3b82f6", "#a855f7", "#22d3ee", "#ec4899", "#eab308",
           "#16c784", "#f59e0b", "#ef4444", "#64748b", "#14b8a6"]

_BULLET = re.compile(r"^\s*(?:[-*•·+]|\d+[.)])\s+(.*\S)\s*$")


def _norm(s: str) -> str:
    return " ".join(str(s or "").split()).strip()


def _key(s: str) -> str:
    return _norm(s).casefold()


def parse_text(raw: str) -> List[dict]:
    """Bullets belong to the last non-bullet line (the group heading)."""
    cats: List[dict] = []
    for line in (raw or "").splitlines():
        if not line.strip():
            continue
        m = _BULLET.match(line)
        if m:
            item = _norm(m.group(1))
            if item and cats:
                cats[-1]["options"].append(item)
            continue
        # an indented non-bullet line is still an item of the current group
        if line[:1] in " \t" and cats:
            cats[-1]["options"].append(_norm(line))
            continue
        heading = _norm(line).rstrip(":")
        if heading:
            cats.append({"name": heading, "options": []})
    return [c for c in cats if c["name"]]


def parse_payload(raw) -> List[dict]:
    """Accept a JSON string/dict/list or the plain-text format. Raises ValueError."""
    if isinstance(raw, (dict, list)):
        data = raw
    else:
        text = str(raw or "").strip()
        if not text:
            raise ValueError("Nothing to import.")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            cats = parse_text(text)
            if not cats:
                raise ValueError("Could not read that. Use JSON, or 'Group' lines followed by '- item' bullets.")
            return cats

    if isinstance(data, dict):
        data = data.get("categories") or data.get("tags") or data.get("groups") or []
    if not isinstance(data, list):
        raise ValueError("Expected a list of groups, or {\"categories\": [...]}.")

    out: List[dict] = []
    for c in data:
        if isinstance(c, str):                       # bare group name
            out.append({"name": _norm(c), "options": []})
            continue
        if not isinstance(c, dict):
            continue
        name = _norm(c.get("name") or c.get("category") or c.get("group") or "")
        if not name:
            continue
        raw_opts = c.get("options") or c.get("tags") or c.get("items") or []
        opts: List[str] = []
        for o in raw_opts:
            label = _norm(o if isinstance(o, str) else (o or {}).get("name", ""))
            if label:
                opts.append(label)
        entry = {"name": name, "options": opts}
        if c.get("color"):
            entry["color"] = str(c["color"]).strip()
        if c.get("multi") is not None:
            entry["multi"] = bool(c["multi"])
        out.append(entry)
    if not out:
        raise ValueError("No groups found in that payload.")
    return out


def merge(session: Session, payload) -> dict:
    """Add anything missing; touch nothing that already exists."""
    cats = parse_payload(payload)

    existing = session.exec(select(TagCategory)).all()
    by_key = {_key(c.name): c for c in existing}
    next_sort = max([c.sort for c in existing], default=-1) + 1
    colour_i = len(existing)

    added_cats: List[str] = []
    added_opts: List[str] = []
    skipped_opts = 0
    skipped_cats = 0

    for spec in cats:
        cat = by_key.get(_key(spec["name"]))
        if cat is None:
            cat = TagCategory(
                name=spec["name"],
                color=spec.get("color") or PALETTE[colour_i % len(PALETTE)],
                multi=spec.get("multi", True),
                sort=next_sort,
            )
            session.add(cat)
            session.flush()
            by_key[_key(cat.name)] = cat
            added_cats.append(cat.name)
            next_sort += 1
            colour_i += 1
        else:
            skipped_cats += 1        # existing group: keep its colour/mode as-is

        opt_keys = {_key(o.name) for o in cat.options}
        opt_sort = max([o.sort for o in cat.options], default=-1) + 1
        for label in spec["options"]:
            if _key(label) in opt_keys:
                skipped_opts += 1
                continue
            session.add(TagOption(category_id=cat.id, name=label, sort=opt_sort))
            opt_keys.add(_key(label))
            opt_sort += 1
            added_opts.append(f"{cat.name} › {label}")

    session.commit()
    return {
        "groups_added": len(added_cats),
        "tags_added": len(added_opts),
        "groups_existing": skipped_cats,
        "tags_skipped": skipped_opts,
        "added_groups": added_cats[:50],
        "added_tags": added_opts[:200],
    }


def export_payload(session: Session, include_inactive: bool = True) -> dict:
    cats = session.exec(select(TagCategory).order_by(TagCategory.sort, TagCategory.id)).all()
    out = []
    for c in cats:
        if not include_inactive and not c.is_active:
            continue
        opts = sorted(c.options, key=lambda o: (o.sort, o.id or 0))
        out.append({
            "name": c.name, "color": c.color, "multi": c.multi,
            "options": [o.name for o in opts if include_inactive or o.is_active],
        })
    return {"categories": out}


LLM_PROMPT = """\
I keep a trading journal. Turn my list of trade reasons / setups below into JSON I can \
import, using EXACTLY this shape and nothing else (no commentary, no markdown fence):

{
  "categories": [
    {
      "name": "Liquidity Grab",
      "color": "#f59e0b",
      "multi": true,
      "options": ["Medium liquidity node hit", "Large liquidity node hit"]
    }
  ]
}

Rules:
- Group related items under a sensible "name". Keep my wording for the items; only fix \
obvious typos and capitalisation.
- "color" must be a hex colour. Give each group a distinct, sensible one \
(e.g. red-ish for risk/liquidation, green-ish for trend, blue-ish for structure).
- "multi": true unless only one item could ever apply to a single trade \
(e.g. a market-regime group), then false.
- Do not invent items I did not write. Do not merge two distinct items into one.
- If an item fits two groups, put it in the more specific one.

Here is my list:
<<<PASTE YOUR NOTES, SCREENSHOTS-AS-TEXT OR SPREADSHEET COLUMNS HERE>>>
"""
