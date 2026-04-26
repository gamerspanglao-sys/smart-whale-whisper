// Shared scoring / classification / risk model used by run-scan and monitor-watchlist.
// Keep in sync with src/lib/tradeLevels.ts (UI-side, same rules, used as fallback).

export interface SparklineStats {
  volatility: number;
  recentTrendPct: number;
  lateDriftPct: number;
  maxDrawdownPct: number;
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

export function analyseSparkline(prices: number[]): SparklineStats {
  if (!prices || prices.length < 10) {
    return { volatility: 0, recentTrendPct: 0, lateDriftPct: 0, maxDrawdownPct: 0 };
  }
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const vol = stdev(returns) * Math.sqrt(24 * 365);
  const recentTrendPct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;

  // Last quarter of the 7d window — useful to detect bottoming/topping inside flat prints
  const lastQuarterStart = Math.floor(prices.length * 0.75);
  const lateStart = prices[lastQuarterStart] || prices[prices.length - 1];
  const lateEnd = prices[prices.length - 1];
  const lateDriftPct = lateStart > 0 ? ((lateEnd - lateStart) / lateStart) * 100 : 0;

  // Max intra-window drawdown (peak → trough)
  let peak = prices[0];
  let maxDd = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = peak > 0 ? (peak - p) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  return { volatility: vol, recentTrendPct, lateDriftPct, maxDrawdownPct: maxDd * 100 };
}

export interface ScoreInput {
  price_change_7d: number;
  price_change_30d: number;
  vol_24h: number;
  market_cap: number;
  volatility: number;
  lateDriftPct: number;
  maxDrawdownPct: number;
}

/**
 * Score ∈ [-5, 10]. Rules are deliberately non-overlapping so a single factor cannot
 * be counted twice. "Why buy now" explanation is built from the 2 biggest reasons.
 */
export function computeScore(d: ScoreInput): { score: number; explanation: string } {
  const reasons: { weight: number; text: string }[] = [];
  const p7 = d.price_change_7d ?? 0;
  const p30 = d.price_change_30d ?? 0;
  const vol = d.volatility;
  const volRatio = d.vol_24h / Math.max(d.market_cap, 1);
  const volPct = (volRatio * 100).toFixed(1);
  const flat = Math.abs(p7) < 5;

  let score = 0;

  // 1) Stealth accumulation — graduated, only when 30d isn't collapsing.
  if (flat && volRatio > 0.03 && p30 > -25) {
    const w = Math.min(3, Math.max(1, Math.round(volRatio * 30))); // 3%→1, 7%→2, 10%+→3
    score += w;
    reasons.push({
      weight: w,
      text: `Heavy turnover (${volPct}% of mcap/day) with flat 7d (${p7.toFixed(1)}%) — buyers absorbing supply`,
    });
  }

  // 2) Post-drawdown base forming
  if (p30 < -15 && p7 > -2 && p7 < 5 && vol < 0.95) {
    score += 3;
    reasons.push({
      weight: 3,
      text: `Stabilising after ${p30.toFixed(1)}% 30d drawdown — basing with contained volatility`,
    });
  }

  // 3) Volatility compression (independent of above — no double count because we exclude falling markets)
  if (vol > 0 && vol < 0.6 && p7 > -8 && p7 < 8) {
    score += 1;
    reasons.push({
      weight: 1,
      text: `Volatility compressed to ${(vol * 100).toFixed(0)}% — coiled spring setup`,
    });
  }

  // 4) Late-week upturn — last 25% of 7d window drifting positive while overall 7d is flat
  if (Math.abs(p7) < 6 && d.lateDriftPct > 1.5) {
    score += 2;
    reasons.push({
      weight: 2,
      text: `Last 24h turning up +${d.lateDriftPct.toFixed(1)}% inside a flat 7d — momentum rotating in`,
    });
  }

  // 5) Liquidity bonus — large, traded names
  if (d.market_cap > 300_000_000 && d.vol_24h > 30_000_000) {
    score += 1;
    reasons.push({
      weight: 1,
      text: `Deep liquidity — mcap $${(d.market_cap / 1e6).toFixed(0)}M, vol $${(d.vol_24h / 1e6).toFixed(0)}M`,
    });
  }

  // ── Penalties ────────────────────────────────────────────────────────────
  if (p7 > 25 && vol > 0.7) {
    score -= 4;
    reasons.push({ weight: -4, text: `Parabolic move (+${p7.toFixed(1)}% in 7d) — extreme chase risk` });
  } else if (p7 > 15) {
    score -= 2;
    reasons.push({ weight: -2, text: `Already rallied +${p7.toFixed(1)}% — entry no longer favourable` });
  } else if (p7 > 10) {
    score -= 1;
    reasons.push({ weight: -1, text: `+${p7.toFixed(1)}% in 7d — wait for pullback` });
  }

  if (p7 < -15) {
    score -= 3;
    reasons.push({ weight: -3, text: `Falling knife (${p7.toFixed(1)}% in 7d) — no support yet` });
  } else if (p7 < -10 && volRatio > 0.06) {
    score -= 2;
    reasons.push({
      weight: -2,
      text: `Dropping ${p7.toFixed(1)}% on heavy volume (${volPct}%) — active distribution`,
    });
  }

  if (d.maxDrawdownPct > 18 && p7 < 0) {
    score -= 1;
    reasons.push({
      weight: -1,
      text: `Deep intra-week drawdown ${d.maxDrawdownPct.toFixed(0)}% — choppy, hard to time`,
    });
  }

  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const explanation = reasons.length
    ? reasons.slice(0, 2).map((r) => r.text).join(". ") + "."
    : "Neutral price action and average volume — nothing standing out.";

  return { score: Math.max(-5, Math.min(10, score)), explanation };
}

export function classify(
  score: number,
  momentum: number,
  volatility: number,
  p7: number,
  hasPriorHistory: boolean,
): { signal: string; phase: string } {
  const momentumOk = hasPriorHistory ? momentum >= 2 : momentum >= 0;
  if (score >= 7 && momentumOk && volatility < 0.7 && p7 < 12 && p7 > -8) {
    return { signal: "Strong", phase: "Accumulation" };
  }
  if (momentum <= -2 || p7 > 25 || p7 < -15) return { signal: "Avoid", phase: "Distribution" };
  if (score >= 5 && momentum >= 0 && p7 < 15) return { signal: "Watchlist", phase: "Accumulation" };
  return { signal: "Neutral", phase: "Neutral" };
}

export function assignTradeLevels(
  signal: string,
  score: number,
  momentum: number,
  p7: number,
  daysInAccumulation: number,
): { buy_tier: string | null; sell_tier: string | null } {
  if (signal === "Avoid") {
    if (p7 > 25 || p7 <= -18 || momentum <= -4) {
      return { buy_tier: null, sell_tier: "Critical exit — heavy distribution or crash risk" };
    }
    if (p7 <= -10 || momentum <= -2) {
      return { buy_tier: null, sell_tier: "Strong exit — reduce exposure" };
    }
    return { buy_tier: null, sell_tier: "Caution — do not add, favour selling" };
  }
  if (signal === "Strong") {
    if (score >= 8 && momentum >= 3 && daysInAccumulation >= 2) {
      return { buy_tier: "Very strong buy — high conviction", sell_tier: null };
    }
    if (score >= 8 || momentum >= 4) {
      return { buy_tier: "Strong buy — favourable zone", sell_tier: null };
    }
    return { buy_tier: "Strong — accumulation (confirm size)", sell_tier: null };
  }
  if (signal === "Watchlist") {
    if (score >= 7) return { buy_tier: "Solid buy watch — near strong", sell_tier: null };
    if (score >= 6) return { buy_tier: "Moderate — build slowly", sell_tier: null };
    return { buy_tier: "Light — early interest only", sell_tier: null };
  }
  if (score >= 4) return { buy_tier: "Speculative — weak edge", sell_tier: null };
  return { buy_tier: "No setup — wait", sell_tier: null };
}

/** Upper mcap for "small / mid" compelling-buy alerts (below large-cap slow grinders). */
export const COMPELLING_BUY_MCAP_MAX = 350_000_000;

export interface CompellingBuyInput {
  market_cap: number;
  score: number;
  momentum: number;
  signal: string;
  buy_tier: string | null;
  price_change_7d: number;
}

/**
 * High-conviction buy opportunity on a smaller market cap.
 * Fires only when score is building, tier is strong, and we are not chasing a vertical move.
 */
export function qualifiesCompellingBuy(d: CompellingBuyInput): boolean {
  if (d.signal === "Avoid") return false;
  if (d.market_cap < 30_000_000 || d.market_cap > COMPELLING_BUY_MCAP_MAX) return false;
  if (d.score < 7) return false;
  if (d.momentum < 2) return false;
  if (d.price_change_7d > 12 || d.price_change_7d < -8) return false;
  const t = d.buy_tier ?? "";
  if (t.startsWith("Very strong")) return true;
  if (t.startsWith("Strong buy")) return true;
  if (d.signal === "Strong" && d.score >= 8 && d.momentum >= 2) return true;
  return false;
}

/** Short line for alert list; full numbers in expanded UI / Scanner. */
export function formatBuyNowSummary(p: {
  symbol: string;
  buy_tier: string | null;
  market_cap: number;
  score: number;
  momentum: number;
  price_change_7d: number;
}): string {
  const m = p.market_cap >= 1e9 ? `${(p.market_cap / 1e9).toFixed(2)}B` : `${Math.round(p.market_cap / 1e6)}M`;
  const tier = p.buy_tier ?? "Compelling buy";
  const mom = p.momentum >= 0 ? `+${p.momentum}` : String(p.momentum);
  const p7 = `${p.price_change_7d >= 0 ? "+" : ""}${p.price_change_7d.toFixed(1)}%`;
  return `${tier} · ${p.symbol} · $${m} cap · score ${p.score} · mom ${mom} · 7d ${p7} — open Scanner for entry / stop / target`;
}

/**
 * Suggested risk zone. Stop is the tighter of (volatility-based) and (recent swing-low × 0.98).
 * Target is a 3R multiple of that risk, floored at 15% so it's meaningful for slow movers.
 */
export function computeRiskZone(
  price: number,
  volatility: number,
  sparkline: number[],
): { entry_low: number; entry_high: number; stop_loss: number; target: number; risk_pct: number; reward_pct: number } {
  const dailyVol = Math.min(0.2, Math.max(0.01, volatility / Math.sqrt(365)));

  let swingLow = price;
  if (sparkline && sparkline.length >= 10) {
    const tail = sparkline.slice(-Math.floor(sparkline.length / 2));
    swingLow = Math.min(...tail);
  }

  const stopByVol = price * (1 - Math.max(0.05, dailyVol * 2.5));
  const stopBySwing = swingLow * 0.98;
  const stop_loss = Math.max(stopByVol, stopBySwing);

  const risk_pct = Math.max(0.03, (price - stop_loss) / price);
  const rewardR = Math.max(0.15, risk_pct * 3);
  const target = price * (1 + rewardR);

  const entry_low = price * (1 - dailyVol * 0.5);
  const entry_high = price * (1 + dailyVol * 0.3);

  return {
    entry_low,
    entry_high,
    stop_loss,
    target,
    risk_pct,
    reward_pct: rewardR,
  };
}
