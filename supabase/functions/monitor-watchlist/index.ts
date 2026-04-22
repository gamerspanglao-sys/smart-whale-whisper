// Watchlist Monitor — runs every 30 minutes, tracks only watchlisted coins
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CG = "https://api.coingecko.com/api/v3";

interface CGCoin {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_1h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
  price_change_percentage_30d_in_currency: number | null;
  sparkline_in_7d?: { price: number[] };
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

function computeVolatility(prices: number[]): number {
  if (!prices || prices.length < 10) return 0;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  return stdev(returns) * Math.sqrt(24 * 365);
}

function computeScore(p7: number, p30: number, volRatio: number, volatility: number): { score: number; explanation: string } {
  let score = 0;
  const reasons: { weight: number; text: string }[] = [];
  const flat = Math.abs(p7) < 5;
  const compressed = volatility > 0 && volatility < 0.6;
  const volPct = (volRatio * 100).toFixed(1);

  if (volRatio > 0.05 && flat) {
    score += 2;
    reasons.push({ weight: 2, text: `Heavy trading (${volPct}% of mcap/day) with flat price — classic stealth accumulation by large players` });
  }
  if (volRatio > 0.08) {
    score += 2;
    reasons.push({ weight: 2, text: `Volume is ${volPct}% of market cap — unusually high turnover signals strong interest` });
  }
  if (flat && volRatio > 0.04) {
    score += 2;
    reasons.push({ weight: 2, text: `Price barely moves but volume keeps rising — buyers absorbing supply at current levels` });
  }
  if (compressed) {
    score += 1;
    reasons.push({ weight: 1, text: `Volatility squeezed to ${(volatility * 100).toFixed(0)}% — coiled spring, big move usually follows` });
  }
  if (p30 < 0 && p7 > -2 && p7 < 4) {
    score += 2;
    reasons.push({ weight: 2, text: `Stopped falling after 30d decline (${p30.toFixed(1)}%) and is now stabilising — bottom may be in` });
  }
  if (p7 > 25) {
    score -= 3;
    reasons.push({ weight: -3, text: `Already pumped +${p7.toFixed(1)}% in 7 days — too late, smart money is selling` });
  }
  if (p7 < -10 && volRatio > 0.06) {
    score -= 2;
    reasons.push({ weight: -2, text: `Dropping fast (${p7.toFixed(1)}%) on high volume — actively being dumped` });
  }

  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    score: Math.max(-5, Math.min(10, score)),
    explanation: reasons.length ? reasons.slice(0, 2).map((r) => r.text).join(". ") + "." : "Boring price action — nothing to see here.",
  };
}

function classify(score: number, momentum: number, volatility: number, p7: number, hasPriorHistory: boolean) {
  const momentumOk = hasPriorHistory ? momentum >= 3 : momentum >= 0;
  if (score >= 7 && momentumOk && volatility < 0.7 && p7 < 15) return { signal: "Strong", phase: "Accumulation" };
  if (momentum < 0 || p7 > 25) return { signal: "Avoid", phase: "Distribution" };
  if (score >= 5 && momentum >= 0) return { signal: "Watchlist", phase: "Accumulation" };
  return { signal: "Neutral", phase: "Neutral" };
}

function assignTradeLevels(
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load active watchlist coins
    const { data: watchlistRows, error: wErr } = await supabase
      .from("watchlist")
      .select("coin_id, symbol, name")
      .eq("active", true);
    if (wErr) throw wErr;
    if (!watchlistRows || watchlistRows.length === 0) {
      return new Response(JSON.stringify({ success: true, monitored: 0, message: "Watchlist is empty" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = watchlistRows.map((w) => w.coin_id).join(",");

    // Fetch current market data — include 1h price change
    const cgUrl = `${CG}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=1h,7d,30d`;
    const cgRes = await fetch(cgUrl, { headers: { accept: "application/json" } });
    if (!cgRes.ok) throw new Error(`CoinGecko failed: ${cgRes.status}`);
    const coins: CGCoin[] = await cgRes.json();

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Pull prior scores + last known price for this coin
    const { data: priorRows } = await supabase
      .from("asset_snapshots")
      .select("coin_id, snapshot_date, score, signal, days_in_accumulation, price, created_at")
      .in("coin_id", watchlistRows.map((w) => w.coin_id))
      .gte("snapshot_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      .order("snapshot_date", { ascending: false });

    const priorByCoin = new Map<string, { date: string; score: number; signal: string; days: number; price: number }[]>();
    for (const r of priorRows ?? []) {
      const list = priorByCoin.get(r.coin_id) ?? [];
      list.push({ date: r.snapshot_date, score: r.score, signal: r.signal, days: r.days_in_accumulation, price: r.price });
      priorByCoin.set(r.coin_id, list);
    }

    const snapshots = coins.map((c) => {
      const sparkline = c.sparkline_in_7d?.price ?? [];
      const volatility = computeVolatility(sparkline);
      const p1h = c.price_change_percentage_1h_in_currency ?? 0;
      const p7 = c.price_change_percentage_7d_in_currency ?? 0;
      const p30 = c.price_change_percentage_30d_in_currency ?? 0;
      const volRatio = c.total_volume / Math.max(c.market_cap, 1);

      const { score, explanation } = computeScore(p7, p30, volRatio, volatility);

      // Exclude today's record so intra-day monitor runs don't increment days each time
      const history = (priorByCoin.get(c.id) ?? [])
        .filter((h) => h.date < today)
        .sort((a, b) => a.date.localeCompare(b.date));
      const prior7 = [...history].reverse().find((h) => h.date <= sevenDaysAgo);
      const momentum = score - (prior7?.score ?? score);

      // yesterday = last record from a previous calendar day
      const yesterday = history[history.length - 1];
      let days = 0;
      if (yesterday) {
        if (score > yesterday.score || score >= 6) days = (yesterday.days ?? 0) + 1;
      } else if (score >= 6) days = 1;

      const hasPriorHistory = history.length > 0;
      const { signal, phase } = classify(score, momentum, volatility, p7, hasPriorHistory);
      const { buy_tier, sell_tier } = assignTradeLevels(signal, score, momentum, p7, days);

      const sparkDaily: number[] = [];
      if (sparkline.length) {
        const step = Math.max(1, Math.floor(sparkline.length / 7));
        for (let i = 0; i < sparkline.length; i += step) sparkDaily.push(sparkline[i]);
        if (sparkDaily.length > 7) sparkDaily.length = 7;
      }

      return {
        coin_id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        snapshot_date: today,
        price: c.current_price,
        market_cap: c.market_cap,
        volume_24h: c.total_volume,
        score,
        momentum,
        days_in_accumulation: days,
        volatility,
        price_change_7d: p7,
        price_change_30d: p30,
        volume_change_7d: null,
        signal,
        phase,
        buy_tier,
        sell_tier,
        explanation,
        sparkline: sparkDaily,
        // Store 1h change in explanation suffix for UI access
        _p1h: p1h,
        _prev_price: yesterday?.price ?? null,
      };
    });

    // Upsert snapshots
    const dbRows = snapshots.map(({ _p1h: _, _prev_price: __, ...rest }) => rest);
    if (dbRows.length > 0) {
      const { error: upErr } = await supabase
        .from("asset_snapshots")
        .upsert(dbRows, { onConflict: "coin_id,snapshot_date" });
      if (upErr) throw upErr;
    }

    // Generate alerts: signal change, score change, price spike
    const alerts: object[] = [];
    for (const snap of snapshots) {
      const history = priorByCoin.get(snap.coin_id) ?? [];
      const prev = history[history.length - 1];

      // 1h price spike alert (independent of prior DB history)
      if (Math.abs(snap._p1h) >= 5) {
        alerts.push({
          coin_id: snap.coin_id,
          symbol: snap.symbol,
          name: snap.name,
          alert_type: snap._p1h > 0 ? "price_spike_up" : "price_spike_down",
          old_value: null,
          new_value: `${snap._p1h > 0 ? "+" : ""}${snap._p1h.toFixed(2)}%`,
          score: snap.score,
          price: snap.price,
        });
      }

      if (!prev) continue;

      // Signal change
      if (prev.signal !== snap.signal) {
        alerts.push({
          coin_id: snap.coin_id,
          symbol: snap.symbol,
          name: snap.name,
          alert_type: "signal_change",
          old_value: prev.signal,
          new_value: snap.signal,
          score: snap.score,
          price: snap.price,
        });
      } else if (snap.score - prev.score >= 2) {
        alerts.push({
          coin_id: snap.coin_id,
          symbol: snap.symbol,
          name: snap.name,
          alert_type: "score_up",
          old_value: String(prev.score),
          new_value: String(snap.score),
          score: snap.score,
          price: snap.price,
        });
      } else if (prev.score - snap.score >= 2) {
        alerts.push({
          coin_id: snap.coin_id,
          symbol: snap.symbol,
          name: snap.name,
          alert_type: "score_down",
          old_value: String(prev.score),
          new_value: String(snap.score),
          score: snap.score,
          price: snap.price,
        });
      }
    }

    if (alerts.length > 0) {
      await supabase.from("price_alerts").insert(alerts);
    }

    // Update watchlist last_monitored_at
    await supabase
      .from("watchlist")
      .update({ last_monitored_at: new Date().toISOString() })
      .in("coin_id", watchlistRows.map((w) => w.coin_id));

    return new Response(
      JSON.stringify({
        success: true,
        monitored: snapshots.length,
        alerts_generated: alerts.length,
        duration_ms: Date.now() - started,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("monitor-watchlist failed", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
