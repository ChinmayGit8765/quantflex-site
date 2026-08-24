# quantflex-site

Public landing page for **QuantFlex**, a derivatives pricing and risk engine.
The engine itself lives in a separate private repository; this repo holds only
the static page and the data it renders.

Live at: https://chinmaygit8765.github.io/quantflex-site/

## What's here

```
index.html            the page
assets/style.css      design tokens shared with the main app
assets/bs.js          closed-form Black-Scholes for the interactive preview
assets/app.js         calculator + renderers for the two JSON payloads
data/demo.json        real engine output — see below
data/feed.json        daily market headlines, rewritten by the scheduled job
scripts/build_feed.py stdlib-only RSS collector
```

## The interactive calculator

`assets/bs.js` is a second implementation of maths the engine already owns,
which is normally worth avoiding. It exists because a static page cannot call
the Python engine, and a preview a visitor can actually move is worth more than
another table of frozen numbers.

It is held honest rather than trusted. On load the page prices the engine's
committed base case in the browser and reports the **measured** difference
against the engine's own value — currently `7.1e-15`. Independently verified
before shipping: put-call parity holds to `4.3e-14` relative across 20,000
random parameter sets, `N(x) + N(-x) - 1` is exactly zero, and the call price is
monotonic in volatility. The normal CDF is Hart's rational approximation (West
2005) rather than Abramowitz-Stegun 7.1.26, which is only good to ~1e-7 and
would be visible in that cross-check.

Scope is deliberately narrow: closed-form European vanillas under GBM. Monte
Carlo, the PDE solver, exotics and the AAD Greeks stay server-side in the real
engine — that is what "coming soon" refers to.

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
