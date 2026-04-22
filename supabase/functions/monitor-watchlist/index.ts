// Watchlist Monitor — runs every 2 hours, tracks only watchlisted coins
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
  const reasons: string[] = [];
  const flat = Math.abs(p7) < 5;
  const compressed = volatility > 0 && volatility < 0.6;

  if (volRatio > 0.05 && flat) { score += 2; reasons.push("high turnover with flat price"); }
  if (volRatio > 0.08)         { score += 2; reasons.push("elevated volume vs market cap"); }
  if (flat && volRatio > 0.04) { score += 2; reasons.push("volume rising while price flat"); }
  if (compressed)              { score += 1; reasons.push("low volatility compression"); }
  if (p30 < 0 && p7 > -2 && p7 < 4) { score += 2; reasons.push("base building after 30d drawdown"); }
  if (p7 > 25)                 { score -= 3; reasons.push("large 7d pump"); }
  if (p7 < -10 && volRatio > 0.06) { score -= 2; reasons.push("high-volume breakdown"); }

  return {
    score: Math.max(-5, Math.min(10, score)),
    explanation: reasons.length ? reasons.slice(0, 2).join("; ") + "." : "No strong signals.",
  };
}

function classify(score: number, momentum: number, volatility: number, p7: number, hasPriorHistory: boolean) {
  const momentumOk = hasPriorHistory ? momentum >= 3 : momentum >= 0;
  if (score >= 7 && momentumOk && volatility < 0.7 && p7 < 15) return { signal: "Strong", phase: "Accumulation" };
  if (momentum < 0 || p7 > 25) return { signal: "Avoid", phase: "Distribution" };
  if (score >= 5 && momentum >= 0) return { signal: "Watchlist", phase: "Accumulation" };
  return { signal: "Neutral", phase: "Neutral" };
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

    // Fetch current market data for watchlist coins only
    const cgUrl = `${CG}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=7d,30d`;
    const cgRes = await fetch(cgUrl, { headers: { accept: "application/json" } });
    if (!cgRes.ok) throw new Error(`CoinGecko failed: ${cgRes.status}`);
    const coins: CGCoin[] = await cgRes.json();

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Pull prior scores for momentum
    const { data: priorRows } = await supabase
      .from("asset_snapshots")
      .select("coin_id, snapshot_date, score, signal, days_in_accumulation, price")
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
      const p7 = c.price_change_percentage_7d_in_currency ?? 0;
      const p30 = c.price_change_percentage_30d_in_currency ?? 0;
      const volRatio = c.total_volume / Math.max(c.market_cap, 1);

      const { score, explanation } = computeScore(p7, p30, volRatio, volatility);

      const history = (priorByCoin.get(c.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const prior7 = [...history].reverse().find((h) => h.date <= sevenDaysAgo);
      const momentum = score - (prior7?.score ?? score);

      const yesterday = history[history.length - 1];
      let days = 0;
      if (yesterday) {
        if (score > yesterday.score || score >= 6) days = (yesterday.days ?? 0) + 1;
      } else if (score >= 6) days = 1;

      const hasPriorHistory = history.length > 0;
      const { signal, phase } = classify(score, momentum, volatility, p7, hasPriorHistory);

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
        explanation,
        sparkline: sparkDaily,
      };
    });

    // Upsert snapshots (updates today's record if already exists from daily scan)
    if (snapshots.length > 0) {
      const { error: upErr } = await supabase
        .from("asset_snapshots")
        .upsert(snapshots, { onConflict: "coin_id,snapshot_date" });
      if (upErr) throw upErr;
    }

    // Generate alerts for signal / score changes
    const alerts: object[] = [];
    for (const snap of snapshots) {
      const history = priorByCoin.get(snap.coin_id) ?? [];
      const prev = history[history.length - 1]; // most recent prior
      if (!prev) continue;

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
