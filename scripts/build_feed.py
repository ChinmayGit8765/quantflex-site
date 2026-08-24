"""Build the daily finance feed for the QuantFlex coming-soon page.

Deliberately stdlib-only (urllib + xml.etree) so the scheduled workflow needs no
`pip install` step and cannot break on a dependency release. Mirrors the source
list and parsing behaviour of the private repo's Market Intel pipeline
(apps/api/src/quantflex_api/intel/), reduced to the extractive path: no LLM, no
database, no API key.

Failure-tolerant by design: a dead or rate-limited feed degrades coverage and is
recorded in `sources`, but never fails the build. A run that reaches zero items
exits non-zero so a total outage is visible rather than silently publishing an
empty page.

Usage: python scripts/build_feed.py --out data/feed.json
"""

from __future__ import annotations

import argparse
import datetime
import html
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

USER_AGENT = "quantflex-site-feed/1.0 (+https://github.com/ChinmayGit8765)"
TIMEOUT_S = 20
MAX_PER_SOURCE = 8
MAX_TOTAL = 30
FRESH_WINDOW = datetime.timedelta(days=3)


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    category: str


# Public, ToS-friendly syndication feeds only — headlines and the summaries the
# publishers deliberately syndicate, never scraped article bodies.
SOURCES: tuple[Source, ...] = (
    Source("Yahoo Finance", "https://finance.yahoo.com/news/rssindex", "stocks"),
    Source("CNBC Top News", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "stocks"),
    Source("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "stocks"),
    Source("CNBC Earnings", "https://www.cnbc.com/id/15839135/device/rss/rss.html", "stocks"),
    Source("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "crypto"),
    Source("Cointelegraph", "https://cointelegraph.com/rss", "crypto"),
    Source(
        "Yahoo Gold Futures",
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC%3DF&region=US&lang=en-US",
        "gold",
    ),
    Source(
        "Yahoo GLD",
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GLD&region=US&lang=en-US",
        "gold",
    ),
)

_TAG_RE = re.compile(r"<[^>]+>")


@dataclass
class Item:
    title: str
    link: str
    source: str
    category: str
    published: str
    summary: str = ""
    _dt: datetime.datetime | None = field(default=None, repr=False)


def _strip_html(text: str) -> str:
    return " ".join(html.unescape(_TAG_RE.sub(" ", text)).split())


def _text(element: ElementTree.Element | None) -> str:
    return (element.text or "").strip() if element is not None else ""


def _parse_date(raw: str) -> datetime.datetime | None:
    if not raw:
        return None
    for parse in (parsedate_to_datetime, datetime.datetime.fromisoformat):
        try:
            parsed = parse(raw.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.UTC)
        return parsed.astimezone(datetime.UTC)
    return None


def _parse(raw: bytes, source: Source, header_charset: str | None) -> list[Item]:
    """Parse RSS 2.0 or Atom. Unknown shapes yield nothing rather than raising.

    Takes BYTES, not str: feeds disagree about encoding (MarketWatch is not
    UTF-8), and ElementTree honours the document's own `<?xml encoding=...?>`
    declaration when handed bytes. Decoding to str first would force a guess and
    silently corrupt smart quotes into U+FFFD.
    """
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        # No/erroneous declaration — fall back to the HTTP Content-Type charset.
        try:
            root = ElementTree.fromstring(raw.decode(header_charset or "utf-8", errors="replace"))
        except (ElementTree.ParseError, LookupError):
            return []

    atom = "{http://www.w3.org/2005/Atom}"
    nodes = root.findall(".//item") or root.findall(f".//{atom}entry")

    items: list[Item] = []
    for node in nodes[:MAX_PER_SOURCE]:
        title = _text(node.find("title")) or _text(node.find(f"{atom}title"))
        if not title:
            continue

        link = _text(node.find("link"))
        if not link:
            anchor = node.find(f"{atom}link")
            link = anchor.get("href", "") if anchor is not None else ""

        raw_date = (
            _text(node.find("pubDate"))
            or _text(node.find(f"{atom}updated"))
            or _text(node.find(f"{atom}published"))
        )
        summary = _text(node.find("description")) or _text(node.find(f"{atom}summary"))
        when = _parse_date(raw_date)

        items.append(
            Item(
                title=_strip_html(title),
                link=link.strip(),
                source=source.name,
                category=source.category,
                published=when.isoformat() if when else "",
                summary=_strip_html(summary)[:280],
                _dt=when,
            )
        )
    return items


def _fetch(source: Source) -> tuple[list[Item], str]:
    request = urllib.request.Request(source.url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            raw = response.read()
            charset = response.headers.get_content_charset()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        return [], f"unavailable ({type(exc).__name__})"
    items = _parse(raw, source, charset)
    return items, "ok" if items else "no parseable items"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/feed.json")
    args = parser.parse_args()

    now = datetime.datetime.now(datetime.UTC)
    cutoff = now - FRESH_WINDOW

    collected: list[Item] = []
    statuses: list[dict[str, str | int]] = []
    for source in SOURCES:
        items, status = _fetch(source)
        fresh = [i for i in items if i._dt is None or i._dt >= cutoff]
        collected.extend(fresh)
        statuses.append(
            {"name": source.name, "category": source.category, "status": status, "items": len(fresh)}
        )
        print(f"  {source.name:<20} {status:<28} {len(fresh)} fresh")

    # Newest first; undated items sort last rather than being dropped.
    collected.sort(key=lambda i: i._dt or datetime.datetime.min.replace(tzinfo=datetime.UTC), reverse=True)

    seen: set[str] = set()
    unique: list[Item] = []
    for item in collected:
        key = item.title.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    selected = unique[:MAX_TOTAL]
    payload = {
        "generated": now.isoformat(timespec="seconds"),
        "window_days": FRESH_WINDOW.days,
        "counts": {
            category: sum(1 for i in selected if i.category == category)
            for category in ("stocks", "crypto", "gold")
        },
        "sources": statuses,
        "items": [
            {
                "title": i.title,
                "link": i.link,
                "source": i.source,
                "category": i.category,
                "published": i.published,
                "summary": i.summary,
            }
            for i in selected
        ],
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")

    live = sum(1 for s in statuses if s["status"] == "ok")
    print(f"\nwrote {args.out}: {len(selected)} items from {live}/{len(SOURCES)} live sources")
    if not selected:
        print("ERROR: every source failed — refusing to publish an empty feed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
