// Accumulation Scanner — daily/manual scan
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
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency: number | null;
  price_change_percentage_30d_in_currency: number | null;
  atl_date: string | null;
  sparkline_in_7d?: { price: number[] };
}

async function fetchPage(page: number): Promise<CGCoin[]> {
  const url = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=true&price_change_percentage=24h,7d,30d`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`CoinGecko page ${page} failed: ${r.status}`);
  return await r.json();
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function computeFromSparkline(prices: number[]) {
  // Returns realized volatility (stdev of log returns) over the 7d hourly series
  if (!prices || prices.length < 10) return { volatility: 0, recentTrendPct: 0 };
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const vol = stdev(returns) * Math.sqrt(24 * 365); // annualized
  const recentTrendPct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  return { volatility: vol, recentTrendPct };
}

interface ScoreInput {
  price_change_7d: number;
  price_change_30d: number;
  vol_24h: number;
  market_cap: number;
  volatility: number;
  sparkline: number[];
}

function computeScore(d: ScoreInput): { score: number; explanation: string } {
  let score = 0;
  const reasons: string[] = [];
  const p7 = d.price_change_7d ?? 0;
  const p30 = d.price_change_30d ?? 0;
  const volRatio = d.vol_24h / Math.max(d.market_cap, 1); // turnover
  const flat = Math.abs(p7) < 5;
  const compressed = d.volatility > 0 && d.volatility < 0.6; // < 60% annualized vol = quiet

  // Proxy: high turnover while price flat => stealth accumulation (+2 net outflow proxy)
  if (volRatio > 0.05 && flat) {
    score += 2;
    reasons.push("high turnover with flat price");
  }
  // Proxy: rising volume relative to mcap (+2 whale-balance proxy via accumulation)
  if (volRatio > 0.08) {
    score += 2;
    reasons.push("elevated volume vs market cap");
  }
  // Volume rising while price flat (+2)
  if (flat && volRatio > 0.04) {
    score += 2;
    reasons.push("volume rising while price flat");
  }
  // Volatility compression (+1)
  if (compressed) {
    score += 1;
    reasons.push("low volatility compression");
  }
  // Price reclaim from 30d lows but still flat 7d (+2 reserves-decreasing proxy)
  if (p30 < 0 && p7 > -2 && p7 < 4) {
    score += 2;
    reasons.push("base building after 30d drawdown");
  }
  // Penalty: large pump (proxy for inflow / late) (-3)
  if (p7 > 25) {
    score -= 3;
    reasons.push("large 7d pump");
  }
  // Penalty: price drops with high volume (-2)
  if (p7 < -10 && volRatio > 0.06) {
    score -= 2;
    reasons.push("high-volume breakdown");
  }

  const exp = reasons.length
    ? reasons.slice(0, 2).join("; ") + "."
    : "No strong accumulation signals.";
  return { score: Math.max(-5, Math.min(10, score)), explanation: exp };
}

function classify(score: number, momentum: number, volatility: number, p7: number) {
  if (score >= 7 && momentum >= 3 && volatility < 0.7 && p7 < 15) {
    return { signal: "Strong", phase: "Accumulation" };
  }
  if (momentum < 0 || p7 > 25) return { signal: "Avoid", phase: "Distribution" };
  if (score >= 5 && momentum >= 0) return { signal: "Watchlist", phase: "Accumulation" };
  return { signal: "Neutral", phase: "Neutral" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const triggeredBy = body?.triggered_by ?? "manual";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch top 500 coins (2 pages of 250) to keep within free CoinGecko limits
    const pages = await Promise.all([fetchPage(1), fetchPage(2)]);
    const all = pages.flat();

    // Filters: market cap > $30M, volume > $2M, age > 6 months
    const sixMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 180;
    const qualified = all.filter((c) => {
      if (!c.market_cap || c.market_cap < 30_000_000) return false;
      if (!c.total_volume || c.total_volume < 2_000_000) return false;
      if (c.atl_date && new Date(c.atl_date).getTime() > sixMonthsAgo) return false;
      return true;
    });

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Pull prior scores for momentum / streak
    const ids = qualified.map((c) => c.id);
    const { data: priorRows } = await supabase
      .from("asset_snapshots")
      .select("coin_id, snapshot_date, score, days_in_accumulation")
      .in("coin_id", ids)
      .gte("snapshot_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));

    const priorByCoin = new Map<string, { date: string; score: number; days: number }[]>();
    for (const r of priorRows ?? []) {
      const list = priorByCoin.get(r.coin_id) ?? [];
      list.push({ date: r.snapshot_date as string, score: r.score, days: r.days_in_accumulation });
      priorByCoin.set(r.coin_id, list);
    }

    const rows = qualified.map((c) => {
      const sparkline = c.sparkline_in_7d?.price ?? [];
      const { volatility } = computeFromSparkline(sparkline);
      const p7 = c.price_change_percentage_7d_in_currency ?? 0;
      const p30 = c.price_change_percentage_30d_in_currency ?? 0;

      const { score, explanation } = computeScore({
        price_change_7d: p7,
        price_change_30d: p30,
        vol_24h: c.total_volume,
        market_cap: c.market_cap,
        volatility,
        sparkline,
      });

      const history = (priorByCoin.get(c.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const prior7 = [...history].reverse().find((h) => h.date <= sevenDaysAgo);
      const momentum = score - (prior7?.score ?? score);

      const yesterday = history[history.length - 1];
      let days = 0;
      if (yesterday) {
        if (score > yesterday.score || score >= 6) days = (yesterday.days ?? 0) + 1;
      } else if (score >= 6) days = 1;

      const { signal, phase } = classify(score, momentum, volatility, p7);

      // Downsample sparkline to 7 daily points for the UI
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

    // Upsert today's snapshot
    const { error: upErr } = await supabase
      .from("asset_snapshots")
      .upsert(rows, { onConflict: "coin_id,snapshot_date" });
    if (upErr) throw upErr;

    await supabase.from("scan_runs").upsert(
      {
        run_date: today,
        assets_scanned: all.length,
        assets_qualified: qualified.length,
        duration_ms: Date.now() - started,
        triggered_by: triggeredBy,
      },
      { onConflict: "run_date" },
    );

    return new Response(
      JSON.stringify({
        success: true,
        scanned: all.length,
        qualified: qualified.length,
        duration_ms: Date.now() - started,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("scan failed", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
