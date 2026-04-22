/** Mirrors supabase/functions/*/index.ts — buy vs exit levels when score ties. */

export type TradeLevels = {
  buy_tier: string | null;
  sell_tier: string | null;
  buy_rank: number;
  sell_rank: number;
};

export function assignTradeLevels(
  signal: string,
  score: number,
  momentum: number,
  p7: number,
  daysInAccumulation: number,
): TradeLevels {
  if (signal === "Avoid") {
    let sell_tier: string;
    let sell_rank: number;
    if (p7 > 25 || p7 <= -18 || momentum <= -4) {
      sell_tier = "Critical exit — heavy distribution or crash risk";
      sell_rank = 3;
    } else if (p7 <= -10 || momentum <= -2) {
      sell_tier = "Strong exit — reduce exposure";
      sell_rank = 2;
    } else {
      sell_tier = "Caution — do not add, favour selling";
      sell_rank = 1;
    }
    return { buy_tier: null, sell_tier, buy_rank: 0, sell_rank };
  }

  if (signal === "Strong") {
    let buy_tier: string;
    let buy_rank: number;
    if (score >= 8 && momentum >= 3 && daysInAccumulation >= 2) {
      buy_tier = "Very strong buy — high conviction";
      buy_rank = 5;
    } else if (score >= 8 || momentum >= 4) {
      buy_tier = "Strong buy — favourable zone";
      buy_rank = 4;
    } else {
      buy_tier = "Strong — accumulation (confirm size)";
      buy_rank = 3;
    }
    return { buy_tier, sell_tier: null, buy_rank, sell_rank: 0 };
  }

  if (signal === "Watchlist") {
    let buy_tier: string;
    let buy_rank: number;
    if (score >= 7) {
      buy_tier = "Solid buy watch — near strong";
      buy_rank = 3;
    } else if (score >= 6) {
      buy_tier = "Moderate — build slowly";
      buy_rank = 2;
    } else {
      buy_tier = "Light — early interest only";
      buy_rank = 1;
    }
    return { buy_tier, sell_tier: null, buy_rank, sell_rank: 0 };
  }

  if (score >= 4) {
    return {
      buy_tier: "Speculative — weak edge",
      sell_tier: null,
      buy_rank: 1,
      sell_rank: 0,
    };
  }
  return {
    buy_tier: "No setup — wait",
    sell_tier: null,
    buy_rank: 0,
    sell_rank: 0,
  };
}

export type TierSortSnapshot = {
  symbol: string;
  signal: string;
  score: number;
  momentum: number;
  days_in_accumulation: number;
  price_change_7d: number | null;
  volatility: number | null;
};

/** When scores tie: higher conviction / cleaner setup first. */
export function compareLongConviction(a: TierSortSnapshot, b: TierSortSnapshot): number {
  const la = assignTradeLevels(a.signal, a.score, a.momentum, a.price_change_7d ?? 0, a.days_in_accumulation);
  const lb = assignTradeLevels(b.signal, b.score, b.momentum, b.price_change_7d ?? 0, b.days_in_accumulation);
  if (lb.buy_rank !== la.buy_rank) return lb.buy_rank - la.buy_rank;
  if (b.momentum !== a.momentum) return b.momentum - a.momentum;
  if (b.days_in_accumulation !== a.days_in_accumulation) return b.days_in_accumulation - a.days_in_accumulation;
  const va = a.volatility ?? 1;
  const vb = b.volatility ?? 1;
  if (va !== vb) return va - vb;
  const ap = Math.abs(a.price_change_7d ?? 0);
  const bp = Math.abs(b.price_change_7d ?? 0);
  if (ap !== bp) return ap - bp;
  return a.symbol.localeCompare(b.symbol);
}

/** Avoid tab: most severe distribution first. */
export function compareAvoidSeverity(a: TierSortSnapshot, b: TierSortSnapshot): number {
  const la = assignTradeLevels(a.signal, a.score, a.momentum, a.price_change_7d ?? 0, a.days_in_accumulation);
  const lb = assignTradeLevels(b.signal, b.score, b.momentum, b.price_change_7d ?? 0, b.days_in_accumulation);
  if (lb.sell_rank !== la.sell_rank) return lb.sell_rank - la.sell_rank;
  if (a.momentum !== b.momentum) return a.momentum - b.momentum;
  const p7a = a.price_change_7d ?? 0;
  const p7b = b.price_change_7d ?? 0;
  if (p7a !== p7b) return p7a - p7b;
  return a.score - b.score;
}

export function displayTiers(s: {
  buy_tier?: string | null;
  sell_tier?: string | null;
  signal: string;
  score: number;
  momentum: number;
  price_change_7d: number | null;
  days_in_accumulation: number;
}): { buy: string | null; sell: string | null } {
  const c = assignTradeLevels(s.signal, s.score, s.momentum, s.price_change_7d ?? 0, s.days_in_accumulation);
  return {
    buy: s.buy_tier ?? c.buy_tier,
    sell: s.sell_tier ?? c.sell_tier,
  };
}
