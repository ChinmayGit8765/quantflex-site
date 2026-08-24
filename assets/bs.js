/* Closed-form Black-Scholes in the browser — the interactive preview only.
 *
 * This is a SECOND implementation of maths the engine already owns, which is
 * normally a thing to avoid. It exists because a static page cannot call the
 * Python engine, and a preview a visitor can actually move is worth more than
 * another table of frozen numbers.
 *
 * The honesty guard: on load the page prices the engine's committed base case
 * here and reports the ACTUAL difference against the engine's value (see
 * `selfCheck` and the badge under the calculator). It is a measured agreement,
 * not a claimed one — and if this file ever drifts, the page says so instead of
 * quietly showing wrong numbers.
 *
 * Scope: closed-form European vanillas under GBM. Monte Carlo, the PDE solver,
 * exotics and the AAD Greeks all stay server-side in the real engine — that is
 * exactly what the "coming soon" refers to.
 */

'use strict';

/* Normal CDF via Hart's rational approximation (as given in West 2005,
 * "Better approximations to cumulative normal functions"). Accurate to roughly
 * double precision across the domain, unlike the Abramowitz-Stegun 7.1.26
 * polynomial that is only good to ~1e-7 and would show up immediately in the
 * self-check below. */
function normCdf(x) {
  const z = Math.abs(x);
  if (z > 37) return x > 0 ? 1 : 0;

  const e = Math.exp(-z * z / 2);
  let c;

  if (z < 7.07106781186547) {
    let b = 3.52624965998911e-02 * z + 0.700383064443688;
    b = b * z + 6.37396220353165;
    b = b * z + 33.912866078383;
    b = b * z + 112.079291497871;
    b = b * z + 221.213596169931;
    b = b * z + 220.206867912376;

    let d = 8.83883476483184e-02 * z + 1.75566716318264;
    d = d * z + 16.064177579207;
    d = d * z + 86.7807322029461;
    d = d * z + 296.564248779674;
    d = d * z + 637.333633378831;
    d = d * z + 793.826512519948;
    d = d * z + 440.413735824752;

    c = e * b / d;
  } else {
    let b = z + 0.65;
    b = z + 4 / b;
    b = z + 3 / b;
    b = z + 2 / b;
    b = z + 1 / b;
    c = e / (b * 2.506628274631);
  }

  return x > 0 ? 1 - c : c;
}

function normPdf(x) {
  return Math.exp(-x * x / 2) / 2.5066282746310002;
}

/* Returns price plus the five Greeks in DESK units, matching the engine's
 * conventions: vega per 1 volatility point, theta per calendar day with the
 * sign flipped (a long option decays), rho per 1 rate point. `thetaRaw` is the
 * unflipped dV/dT the engine stores internally. */
function blackScholes({ spot, strike, rate, divYield, sigma, expiry, kind }) {
  const S = spot, K = strike, r = rate, q = divYield, v = sigma, T = expiry;

  // Degenerate inputs collapse to intrinsic rather than producing NaN.
  if (!(T > 0) || !(v > 0) || !(S > 0) || !(K > 0)) {
    const intrinsic = kind === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: NaN, gamma: NaN, vega: 0, theta: 0, rho: 0, d1: NaN, d2: NaN };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (v * v) / 2) * T) / (v * sqrtT);
  const d2 = d1 - v * sqrtT;
  const dfQ = Math.exp(-q * T);
  const dfR = Math.exp(-r * T);
  const nd1 = normPdf(d1);

  let price, delta, thetaRaw, rho;
  if (kind === 'call') {
    price = S * dfQ * normCdf(d1) - K * dfR * normCdf(d2);
    delta = dfQ * normCdf(d1);
    thetaRaw = -(S * dfQ * nd1 * v) / (2 * sqrtT) - r * K * dfR * normCdf(d2) + q * S * dfQ * normCdf(d1);
    rho = K * T * dfR * normCdf(d2);
  } else {
    price = K * dfR * normCdf(-d2) - S * dfQ * normCdf(-d1);
    delta = -dfQ * normCdf(-d1);
    thetaRaw = -(S * dfQ * nd1 * v) / (2 * sqrtT) + r * K * dfR * normCdf(-d2) - q * S * dfQ * normCdf(-d1);
    rho = -K * T * dfR * normCdf(-d2);
  }

  const gamma = (dfQ * nd1) / (S * v * sqrtT);
  const vega = S * dfQ * nd1 * sqrtT;

  return {
    price,
    delta,
    gamma,
    vega: vega / 100,        // per 1 vol point
    theta: thetaRaw / 365,   // per calendar day
    thetaRaw,
    rho: rho / 100,          // per 1 rate point
    d1,
    d2,
  };
}

/* Compare this file against the engine's committed base case. Returns the
 * measured absolute difference so the page can state a fact rather than a
 * promise. */
function selfCheck(demo) {
  const row = demo.showcase.find((r) => r.id === 'european-analytic');
  if (!row) return null;
  const base = demo.base_case;
  const here = blackScholes({
    spot: base.spot,
    strike: base.strike,
    rate: base.rate,
    divYield: base.div_yield,
    sigma: base.sigma,
    expiry: base.expiry,
    kind: 'put',
  }).price;
  return { engine: row.price, browser: here, absDiff: Math.abs(here - row.price) };
}
