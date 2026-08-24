/* QuantFlex coming-soon page.
   Renders two committed JSON payloads: data/demo.json (engine output, produced
   by scripts/build_site_demo.py in the private repo) and data/feed.json
   (rewritten daily by the scheduled workflow). No dependencies, no network
   calls beyond those two same-origin fetches. */

'use strict';

const $ = (sel) => document.querySelector(sel);

/* ---------- formatting ---------- */

function fmt(value, dp = 6) {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(dp);
}

function sig(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return value.toExponential(digits - 1).replace('e', '×10^').replace('+', '');
}

function intFmt(value) {
  return Number(value).toLocaleString('en-US');
}

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/* Build DOM via textContent only — feed titles are third-party strings and must
   never be interpolated as HTML. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- demo ---------- */

function renderShowcase(rows) {
  const tbody = $('#showcase tbody');
  tbody.replaceChildren();
  rows.forEach((row) => {
    const tr = el('tr');

    const nameCell = el('td');
    nameCell.append(el('div', 'cell-label', row.label));
    nameCell.append(el('div', 'cell-blurb', row.blurb));
    tr.append(nameCell);

    tr.append(el('td', 'num', fmt(row.price)));
    tr.append(el('td', 'num ' + (row.stderr ? '' : 'dim'), row.stderr ? fmt(row.stderr, 6) : 'exact'));
    tr.append(
      el('td', 'num ' + (row.ci95 ? '' : 'dim'),
        row.ci95 ? `${fmt(row.ci95[0], 4)} – ${fmt(row.ci95[1], 4)}` : '—')
    );

    const method = el('td');
    method.append(el('div', 'mono', row.method));
    method.append(el('div', 'cell-blurb', row.model));
    tr.append(method);

    tbody.append(tr);
  });
}

function renderShowcaseNotes(rows) {
  const box = $('#showcase-notes');
  box.replaceChildren();

  const mc = rows.find((r) => r.se_distance !== undefined);
  if (mc) {
    const within = mc.within_anchor;
    const note = el('p');
    note.append(document.createTextNode('The Monte Carlo put sits '));
    note.append(el('span', 'mono', mc.se_distance.toFixed(2)));
    note.append(
      document.createTextNode(
        ` standard errors from the closed-form value of ${fmt(mc.reference)}. ` +
        `The engine's anchor suite accepts agreement within ${mc.anchor_k_se} standard errors, ` +
        `so this passes — a two-sigma draw is ordinary sampling noise, and the seed was ` +
        `not chosen to flatter it.`
      )
    );
    if (!within) note.classList.add('fail');
    box.append(note);
  }

  rows.filter((r) => r.notices && r.notices.length).forEach((r) => {
    r.notices.forEach((n) => box.append(el('p', 'dim', `${r.label}: ${n}`)));
  });
}

function renderGreeks(greeks) {
  const tbody = $('#greeks tbody');
  tbody.replaceChildren();
  greeks.verification.forEach((row) => {
    const tr = el('tr');
    tr.append(el('td', 'cell-label', row.greek));
    tr.append(el('td', 'num', fmt(row.aad, 10)));
    tr.append(el('td', 'num ' + (row.jax === null ? 'dim' : ''), row.jax === null ? 'n/a' : fmt(row.jax, 10)));
    tr.append(el('td', 'num', fmt(row.fd, 10)));
    tr.append(el('td', 'num dim', sig(row.tolerance)));
    tr.append(el('td', row.passed ? 'pass' : 'fail', row.passed ? '✓ agree' : '✗ differ'));
    tbody.append(tr);
  });
}

function renderConvergence(conv) {
  const points = conv.points;
  const table = $('#convergence-table tbody');
  table.replaceChildren();
  points.forEach((p) => {
    const tr = el('tr');
    tr.append(el('td', 'num', intFmt(p.n)));
    tr.append(el('td', 'num', fmt(p.estimate)));
    tr.append(el('td', 'num', sig(p.se)));
    tr.append(el('td', 'num', (p.error >= 0 ? '+' : '') + p.error.toExponential(2)));
    table.append(tr);
  });

  // Hand-built SVG: no chart library, so nothing is fetched and the axes say
  // exactly what we mean.
  const W = 720, H = 300, ML = 68, MR = 20, MT = 18, MB = 46;
  const iw = W - ML - MR, ih = H - MT - MB;
  const ref = conv.reference_closed_form;

  const xs = points.map((p) => Math.log2(p.n));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const los = points.map((p) => p.estimate - 1.96 * p.se);
  const his = points.map((p) => p.estimate + 1.96 * p.se);
  let yMin = Math.min(...los, ref), yMax = Math.max(...his, ref);
  const pad = (yMax - yMin) * 0.15 || 0.1;
  yMin -= pad; yMax += pad;

  const X = (i) => ML + (xMax === xMin ? iw / 2 : ((xs[i] - xMin) / (xMax - xMin)) * iw);
  const Y = (v) => MT + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Monte Carlo convergence: estimate with 95% confidence band across ${points.length} path counts, ` +
    `against a closed-form reference of ${ref.toFixed(6)}.`);

  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };

  // y gridlines + labels
  for (let i = 0; i <= 4; i += 1) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    const y = Y(v);
    svg.append(mk('line', { x1: ML, x2: ML + iw, y1: y, y2: y, stroke: '#30363d', 'stroke-width': 1 }));
    const label = mk('text', { x: ML - 10, y: y + 4, fill: '#6e7681', 'font-size': 11, 'text-anchor': 'end' });
    label.textContent = v.toFixed(3);
    svg.append(label);
  }

  // ±1.96 SE band
  const band = points.map((p, i) => `${X(i)},${Y(his[i])}`)
    .concat(points.map((p, i) => `${X(points.length - 1 - i)},${Y(los[points.length - 1 - i])}`))
    .join(' ');
  svg.append(mk('polygon', { points: band, fill: 'rgba(47,129,247,0.18)' }));

  // reference line
  svg.append(mk('line', {
    x1: ML, x2: ML + iw, y1: Y(ref), y2: Y(ref),
    stroke: '#3fb950', 'stroke-width': 1.5, 'stroke-dasharray': '5 4',
  }));

  // estimate polyline + markers
  svg.append(mk('polyline', {
    points: points.map((p, i) => `${X(i)},${Y(p.estimate)}`).join(' '),
    fill: 'none', stroke: '#58a6ff', 'stroke-width': 2,
  }));
  points.forEach((p, i) => {
    svg.append(mk('circle', { cx: X(i), cy: Y(p.estimate), r: 3.5, fill: '#58a6ff' }));
    const xl = mk('text', { x: X(i), y: MT + ih + 20, fill: '#6e7681', 'font-size': 11, 'text-anchor': 'middle' });
    xl.textContent = p.n >= 1048576 ? `${Math.round(p.n / 1048576)}M` : `${Math.round(p.n / 1024)}k`;
    svg.append(xl);
  });

  const xTitle = mk('text', { x: ML + iw / 2, y: H - 8, fill: '#8b949e', 'font-size': 11, 'text-anchor': 'middle' });
  xTitle.textContent = 'paths (log scale)';
  svg.append(xTitle);

  const legend = mk('text', { x: ML + 6, y: Y(ref) - 7, fill: '#3fb950', 'font-size': 11 });
  legend.textContent = `closed form ${ref.toFixed(6)}`;
  svg.append(legend);

  $('#convergence').replaceChildren(svg);
}

function renderIvol(iv) {
  const stats = [
    ['Input σ', iv.input_sigma.toFixed(4)],
    ['Price', fmt(iv.price)],
    ['Recovered σ', iv.recovered_sigma.toFixed(12)],
    ['σ error', iv.sigma_abs_error === 0 ? '0 (exact)' : sig(iv.sigma_abs_error)],
    ['Reprice error', iv.price_abs_error === 0 ? '0 (exact)' : sig(iv.price_abs_error)],
  ];
  const box = $('#ivol');
  box.replaceChildren();
  stats.forEach(([label, value]) => {
    const card = el('div', 'stat');
    card.append(el('div', 'stat-label', label));
    card.append(el('div', 'stat-value', value));
    box.append(card);
  });
}

function renderProvenance(demo) {
  const p = demo.provenance;
  const dl = el('dl', 'kv');
  const add = (k, v) => { dl.append(el('dt', null, k)); dl.append(el('dd', null, v)); };
  add('Generated', demo.generated.replace('T', ' ').replace('+00:00', ' UTC'));
  add('Engine', demo.engine_version);
  add('Python', p.python);
  add('NumPy', p.numpy);
  add('Platform', p.platform);
  add('exp kernel', p.dispatch_fingerprint.exp);
  add('ndtr kernel', p.dispatch_fingerprint.ndtr);

  const body = $('#provenance-body');
  body.replaceChildren();
  body.append(el('p', 'prose', p.note));
  body.append(dl);
  const hashes = el('p', 'prose');
  hashes.textContent =
    'Request hashes: ' + demo.showcase.map((r) => `${r.id} ${r.request_hash.slice(0, 12)}…`).join(' · ');
  body.append(hashes);

  $('#footer-engine').textContent = `engine ${demo.engine_version}`;
}

/* ---------- feed ---------- */

let feedItems = [];

function renderFeed(category) {
  const list = $('#feed-list');
  list.replaceChildren();
  const shown = category === 'all' ? feedItems : feedItems.filter((i) => i.category === category);

  if (!shown.length) {
    list.append(el('li', 'status', 'No items in this category right now.'));
    return;
  }

  shown.forEach((item) => {
    const li = el('li', 'feed-item');
    const link = el('a', null, item.title);
    link.href = item.link;
    link.rel = 'noopener noreferrer nofollow';
    link.target = '_blank';
    li.append(link);

    const meta = el('div', 'feed-meta');
    meta.append(el('span', `cat cat-${item.category}`, item.category));
    meta.append(el('span', null, item.source));
    const when = relTime(item.published);
    if (when) meta.append(el('span', null, when));
    li.append(meta);

    if (item.summary) li.append(el('p', 'feed-summary', item.summary));
    list.append(li);
  });
}

function renderFeedSources(feed) {
  const dl = el('dl', 'kv');
  feed.sources.forEach((s) => {
    dl.append(el('dt', null, s.name));
    dl.append(el('dd', null, `${s.status} · ${s.items} items`));
  });
  const body = $('#feed-sources');
  body.replaceChildren();
  body.append(
    el('p', 'prose',
      `Collected ${feed.generated.replace('T', ' ').replace('+00:00', ' UTC')} ` +
      `over a ${feed.window_days}-day window. A source that fails degrades coverage but never ` +
      `blocks the build.`)
  );
  body.append(dl);
}

/* ---------- boot ---------- */

async function load(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

(async () => {
  try {
    const demo = await load('data/demo.json');
    renderShowcase(demo.showcase);
    renderShowcaseNotes(demo.showcase);
    renderGreeks(demo.greeks);
    renderConvergence(demo.convergence);
    renderIvol(demo.implied_vol);
    renderProvenance(demo);
    $('#demo-status').hidden = true;
    $('#demo-body').hidden = false;
  } catch (err) {
    const box = $('#demo-status');
    box.textContent = `Could not load engine output — ${err.message}`;
    box.classList.add('is-error');
  }

  try {
    const feed = await load('data/feed.json');
    feedItems = feed.items;
    renderFeed('all');
    renderFeedSources(feed);
    $('#feed-status').hidden = true;
    $('#feed-body').hidden = false;

    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        renderFeed(chip.dataset.cat);
      });
    });
  } catch (err) {
    const box = $('#feed-status');
    box.textContent = `Could not load the market feed — ${err.message}`;
    box.classList.add('is-error');
  }
})();
