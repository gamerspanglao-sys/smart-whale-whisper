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
  const reasons: { weight: number; text: string }[] = [];
  const p7 = d.price_change_7d ?? 0;
  const p30 = d.price_change_30d ?? 0;
  const volRatio = d.vol_24h / Math.max(d.market_cap, 1);
  const flat = Math.abs(p7) < 5;
  const compressed = d.volatility > 0 && d.volatility < 0.6;
  const volPct = (volRatio * 100).toFixed(1);

  // Stealth accumulation — heavy trading while price stays flat = whales loading up quietly
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
    reasons.push({ weight: 1, text: `Volatility squeezed to ${(d.volatility * 100).toFixed(0)}% — coiled spring, big move usually follows` });
  }
  if (p30 < 0 && p7 > -2 && p7 < 4) {
    score += 2;
    reasons.push({ weight: 2, text: `Stopped falling after 30d decline (${p30.toFixed(1)}%) and is now stabilising — bottom may be in` });
  }

  // Penalties
  if (p7 > 25) {
    score -= 3;
    reasons.push({ weight: -3, text: `Already pumped +${p7.toFixed(1)}% in 7 days — too late, smart money is selling` });
  }
  if (p7 < -10 && volRatio > 0.06) {
    score -= 2;
    reasons.push({ weight: -2, text: `Dropping fast (${p7.toFixed(1)}%) on high volume — actively being dumped` });
  }

  // Pick the most informative reason (highest absolute weight)
  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const exp = reasons.length
    ? reasons.slice(0, 2).map((r) => r.text).join(". ") + "."
    : "Boring price action and average volume — nothing to see here.";

  return { score: Math.max(-5, Math.min(10, score)), explanation: exp };
}

function classify(score: number, momentum: number, volatility: number, p7: number, hasPriorHistory: boolean) {
  // On day-1 (no prior history) momentum is always 0 — use lower bar for Strong
  const momentumOk = hasPriorHistory ? momentum >= 3 : momentum >= 0;
  if (score >= 7 && momentumOk && volatility < 0.7 && p7 < 15) {
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
    const STABLE_SYMBOLS = new Set([
      // USD-pegged
      "USDT","USDC","DAI","BUSD","TUSD","USDP","USDD","FDUSD","PYUSD","GUSD",
      "FRAX","LUSD","USDE","USDS","CRVUSD","MIM","SUSD","USTC","USDJ","HUSD",
      "USDX","USD0","USDY","USDB","CUSD","OUSD","DOLA","ALUSD","MUSD","USDV",
      "FXUSD","USDM","XUSD","AUSD","RLUSD","USD1","GHO","USDBC","USDS","BOLD",
      "MKUSD","COEUR","USDZ","USDA","USDD","USDX","EUSD","USDF","FRXUSD",
      // EUR-pegged
      "EURS","EURT","EURC","EURCV","AEUR","EURA","AGEUR",
      // Precious metals
      "XAUT","PAXG",
      // Other
      "RSR",
    ]);
    const isStableName = (name: string, sym: string, price: number, p7: number, p30: number, vol: number) => {
      const s = sym.toUpperCase();
      if (STABLE_SYMBOLS.has(s)) return true;
      // Symbol pattern: USD variants, EUR variants
      if (/^US?D[A-Z0-9]{0,3}$/.test(s)) return true;
      if (/^EUR[A-Z0-9]{0,3}$/.test(s)) return true;
      if (/usd|euro|tether|stablecoin|dollar/i.test(name)) return true;
      // Behaviour-based: very low volatility + pegged price ± 10% + almost no price movement
      const peggedNearDollar = price > 0.90 && price < 1.10;
      const peggedNearEuro = price > 1.00 && price < 1.25;
      const frozen = Math.abs(p7) < 1 && Math.abs(p30) < 3;
      if ((peggedNearDollar || peggedNearEuro) && frozen && vol < 0.15) return true;
      return false;
    };
    const qualified = all.filter((c) => {
      if (!c.market_cap || c.market_cap < 30_000_000) return false;
      if (!c.total_volume || c.total_volume < 2_000_000) return false;
      if (c.atl_date && new Date(c.atl_date).getTime() > sixMonthsAgo) return false;
      const p7 = c.price_change_percentage_7d_in_currency ?? 0;
      const p30 = c.price_change_percentage_30d_in_currency ?? 0;
      const sparkline = c.sparkline_in_7d?.price ?? [];
      const { volatility } = computeFromSparkline(sparkline);
      if (isStableName(c.name, c.symbol, c.current_price, p7, p30, volatility)) return false;
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

      const hasPriorHistory = history.length > 0;
      const { signal, phase } = classify(score, momentum, volatility, p7, hasPriorHistory);

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

    // ── Watchlist: auto-add coins with score >= 7, remove "Avoid" ──────────
    const { data: existingWatchlist } = await supabase
      .from("watchlist")
      .select("coin_id, symbol, name")
      .eq("active", true);

    const watchedIds = new Set((existingWatchlist ?? []).map((w) => w.coin_id));

    // Auto-add strong candidates not yet on watchlist
    const toAdd = rows.filter((r) => r.score >= 7 && r.signal !== "Avoid" && !watchedIds.has(r.coin_id));
    if (toAdd.length > 0) {
      await supabase.from("watchlist").upsert(
        toAdd.map((r) => ({
          coin_id: r.coin_id,
          symbol: r.symbol,
          name: r.name,
          added_by: "auto",
          active: true,
        })),
        { onConflict: "coin_id" },
      );
    }

    // Deactivate watchlist entries that turned "Avoid"
    const toDeactivate = rows.filter((r) => r.signal === "Avoid" && watchedIds.has(r.coin_id));
    if (toDeactivate.length > 0) {
      await supabase
        .from("watchlist")
        .update({ active: false })
        .in("coin_id", toDeactivate.map((r) => r.coin_id));
    }

    // ── Alerts: signal changes for watchlist coins ───────────────────────────
    const { data: prevSnapshots } = await supabase
      .from("asset_snapshots")
      .select("coin_id, signal, score, price")
      .in("coin_id", [...watchedIds])
      .lt("snapshot_date", today)
      .order("snapshot_date", { ascending: false });

    // Keep only the most recent snapshot per coin
    const prevByCoin = new Map<string, { signal: string; score: number; price: number }>();
    for (const s of prevSnapshots ?? []) {
      if (!prevByCoin.has(s.coin_id)) {
        prevByCoin.set(s.coin_id, { signal: s.signal, score: s.score, price: s.price });
      }
    }

    const alerts: object[] = [];
    for (const r of rows) {
      if (!watchedIds.has(r.coin_id)) continue;
      const prev = prevByCoin.get(r.coin_id);
      if (!prev) continue;

      if (prev.signal !== r.signal) {
        alerts.push({
          coin_id: r.coin_id,
          symbol: r.symbol,
          name: r.name,
          alert_type: "signal_change",
          old_value: prev.signal,
          new_value: r.signal,
          score: r.score,
          price: r.price,
        });
      } else if (r.score - prev.score >= 3) {
        alerts.push({
          coin_id: r.coin_id,
          symbol: r.symbol,
          name: r.name,
          alert_type: "score_up",
          old_value: String(prev.score),
          new_value: String(r.score),
          score: r.score,
          price: r.price,
        });
      } else if (prev.score - r.score >= 3) {
        alerts.push({
          coin_id: r.coin_id,
          symbol: r.symbol,
          name: r.name,
          alert_type: "score_down",
          old_value: String(prev.score),
          new_value: String(r.score),
          score: r.score,
          price: r.price,
        });
      }
    }

    if (alerts.length > 0) {
      await supabase.from("price_alerts").insert(alerts);
    }
    // ────────────────────────────────────────────────────────────────────────

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
        watchlist_added: toAdd.length,
        alerts_generated: alerts.length,
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
