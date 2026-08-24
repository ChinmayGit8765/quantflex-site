# quantflex-site

Public landing page for **QuantFlex**, a derivatives pricing and risk engine.
The engine itself lives in a separate private repository; this repo holds only
the static page and the data it renders.

Live at: https://chinmaygit8765.github.io/quantflex-site/

## What's here

```
index.html            the page
assets/style.css      design tokens shared with the main app
assets/app.js         renders the two JSON payloads (no dependencies)
data/demo.json        real engine output — see below
data/feed.json        daily market headlines, rewritten by the scheduled job
scripts/build_feed.py stdlib-only RSS collector
```

## The two data files

**`data/demo.json` — engine output, committed as a snapshot.**
Produced by `scripts/build_site_demo.py` in the private engine repo. It is a
snapshot rather than a scheduled job on purpose: the engine is deterministic
under fixed seeds, so the numbers only change when the engine changes. There is
nothing to refresh daily, and therefore no cross-repo credential to manage.
Regenerate it by running that script and copying the result here.

Every figure on the page comes from a real `price()` / `greeks()` call, and each
row carries the `request_hash` that reproduces it. Nothing is hand-typed.

**`data/feed.json` — daily headlines, rewritten by CI.**
`.github/workflows/feed.yml` runs `scripts/build_feed.py` on a daily cron and
commits the result if it changed. The collector is deliberately stdlib-only
(`urllib` + `xml.etree`), so the job needs no `pip install`, holds no secrets,
and cannot break on a dependency release.

It reads bytes rather than text and lets `ElementTree` honour each feed's own
encoding declaration — several of these feeds are not UTF-8, and force-decoding
corrupts punctuation into `U+FFFD`.

Failure handling is asymmetric on purpose: an individual dead feed degrades
coverage and is reported under "Source health" on the page, but a run in which
*every* source fails exits non-zero rather than publishing an empty feed.

## Running locally

```sh
python scripts/build_feed.py --out data/feed.json
python -m http.server 8000     # then open http://localhost:8000
```

A plain `file://` open will not work — the page fetches the JSON payloads, which
browsers block from the filesystem.

## Not financial advice

This is an engineering and mathematics project. Nothing here is a recommendation
to buy or sell any instrument, and the headlines are third-party links reproduced
from public syndication feeds.
