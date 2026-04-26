// Accumulation Scanner — daily/manual scan across CoinGecko top 500
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  analyseSparkline,
  assignTradeLevels,
  classify,
  computeRiskZone,
  computeScore,
  formatBuyNowSummary,
  qualifiesCompellingBuy,
} from "../_shared/scoring.ts";

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

const STABLE_SYMBOLS = new Set([
  "USDT","USDC","DAI","BUSD","TUSD","USDP","USDD","FDUSD","PYUSD","GUSD",
  "FRAX","LUSD","USDE","USDS","CRVUSD","MIM","SUSD","USTC","USDJ","HUSD",
  "USDX","USD0","USDY","USDB","CUSD","OUSD","DOLA","ALUSD","MUSD","USDV",
  "FXUSD","USDM","XUSD","AUSD","RLUSD","USD1","GHO","USDBC","BOLD",
  "MKUSD","COEUR","USDZ","USDA","EUSD","USDF","FRXUSD",
  "EURS","EURT","EURC","EURCV","AEUR","EURA","AGEUR",
  "XAUT","PAXG",
  "RSR",
]);

function isStablecoin(name: string, sym: string, price: number, p7: number, p30: number, vol: number): boolean {
  const s = sym.toUpperCase();
  if (STABLE_SYMBOLS.has(s)) return true;
  if (/^US?D[A-Z0-9]{0,3}$/.test(s)) return true;
  if (/^EUR[A-Z0-9]{0,3}$/.test(s)) return true;
  if (/usd|euro|tether|stablecoin|dollar/i.test(name)) return true;
  const peggedNearDollar = price > 0.90 && price < 1.10;
  const peggedNearEuro = price > 1.00 && price < 1.25;
  const frozen = Math.abs(p7) < 1 && Math.abs(p30) < 3;
  if ((peggedNearDollar || peggedNearEuro) && frozen && vol < 0.15) return true;
  return false;
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

    const pages = await Promise.all([fetchPage(1), fetchPage(2)]);
    const all = pages.flat();

    const sixMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 180;
    const qualified = all.filter((c) => {
      if (!c.market_cap || c.market_cap < 30_000_000) return false;
      if (!c.total_volume || c.total_volume < 2_000_000) return false;
      if (c.atl_date && new Date(c.atl_date).getTime() > sixMonthsAgo) return false;
      const p7 = c.price_change_percentage_7d_in_currency ?? 0;
      const p30 = c.price_change_percentage_30d_in_currency ?? 0;
      const sparkline = c.sparkline_in_7d?.price ?? [];
      const { volatility } = analyseSparkline(sparkline);
      if (isStablecoin(c.name, c.symbol, c.current_price, p7, p30, volatility)) return false;
      return true;
    });

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const ids = qualified.map((c) => c.id);
    const { data: priorRows } = await supabase
      .from("asset_snapshots")
      .select(
        "coin_id, snapshot_date, score, days_in_accumulation, signal, momentum, market_cap, price_change_7d, buy_tier",
      )
      .in("coin_id", ids)
      .gte("snapshot_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));

    type PriorSnap = {
      date: string;
      score: number;
      days: number;
      signal: string;
      momentum: number;
      market_cap: number;
      price_change_7d: number | null;
      buy_tier: string | null;
    };
    const priorByCoin = new Map<string, PriorSnap[]>();
    for (const r of priorRows ?? []) {
      const list = priorByCoin.get(r.coin_id) ?? [];
      list.push({
        date: r.snapshot_date as string,
        score: r.score,
        days: r.days_in_accumulation,
        signal: r.signal as string,
        momentum: r.momentum,
        market_cap: Number(r.market_cap),
        price_change_7d: r.price_change_7d as number | null,
        buy_tier: (r as { buy_tier?: string | null }).buy_tier ?? null,
      });
      priorByCoin.set(r.coin_id, list);
    }

    const rows = qualified.map((c) => {
      const sparkline = c.sparkline_in_7d?.price ?? [];
      const stats = analyseSparkline(sparkline);
      const p7 = c.price_change_percentage_7d_in_currency ?? 0;
      const p30 = c.price_change_percentage_30d_in_currency ?? 0;

      const { score, explanation } = computeScore({
        price_change_7d: p7,
        price_change_30d: p30,
        vol_24h: c.total_volume,
        market_cap: c.market_cap,
        volatility: stats.volatility,
        lateDriftPct: stats.lateDriftPct,
        maxDrawdownPct: stats.maxDrawdownPct,
      });

      // Exclude today's own records so re-runs don't keep pushing days_in_accumulation up
      const history = (priorByCoin.get(c.id) ?? [])
        .filter((h) => h.date < today)
        .sort((a, b) => a.date.localeCompare(b.date));
      const prior7 = [...history].reverse().find((h) => h.date <= sevenDaysAgo);
      const momentum = score - (prior7?.score ?? score);

      const yesterday = history[history.length - 1];
      let days = 0;
      if (yesterday) {
        if (score > yesterday.score || score >= 6) days = (yesterday.days ?? 0) + 1;
      } else if (score >= 6) days = 1;

      const hasPriorHistory = history.length > 0;
      const { signal, phase } = classify(score, momentum, stats.volatility, p7, hasPriorHistory);
      const { buy_tier, sell_tier } = assignTradeLevels(signal, score, momentum, p7, days);
      const risk = computeRiskZone(c.current_price, stats.volatility, sparkline);

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
        volatility: stats.volatility,
        price_change_7d: p7,
        price_change_30d: p30,
        volume_change_7d: null,
        signal,
        phase,
        buy_tier,
        sell_tier,
        entry_low: risk.entry_low,
        entry_high: risk.entry_high,
        stop_loss: risk.stop_loss,
        target: risk.target,
        explanation,
        sparkline: sparkDaily,
      };
    });

    const { error: upErr } = await supabase
      .from("asset_snapshots")
      .upsert(rows, { onConflict: "coin_id,snapshot_date" });
    if (upErr) throw upErr;

    // Watchlist auto-management
    const { data: existingWatchlist } = await supabase
      .from("watchlist")
      .select("coin_id, symbol, name")
      .eq("active", true);

    const watchedIds = new Set((existingWatchlist ?? []).map((w) => w.coin_id));

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

    const toDeactivate = rows.filter((r) => r.signal === "Avoid" && watchedIds.has(r.coin_id));
    if (toDeactivate.length > 0) {
      await supabase
        .from("watchlist")
        .update({ active: false })
        .in("coin_id", toDeactivate.map((r) => r.coin_id));
    }

    // Alerts: signal changes, score jumps, and explicit exit alerts for watched coins
    const { data: prevSnapshots } = await supabase
      .from("asset_snapshots")
      .select("coin_id, signal, score, price, sell_tier")
      .in("coin_id", [...watchedIds])
      .lt("snapshot_date", today)
      .order("snapshot_date", { ascending: false });

    const prevByCoin = new Map<string, { signal: string; score: number; price: number; sell_tier: string | null }>();
    for (const s of prevSnapshots ?? []) {
      if (!prevByCoin.has(s.coin_id)) {
        prevByCoin.set(s.coin_id, {
          signal: s.signal,
          score: s.score,
          price: s.price,
          sell_tier: (s as { sell_tier?: string | null }).sell_tier ?? null,
        });
      }
    }

    const alerts: object[] = [];
    let buy_now_count = 0;

    // High-visibility "time to buy" — small/mid cap + strong tier + momentum (all coins, not only watchlist)
    for (const r of rows) {
      const hist = (priorByCoin.get(r.coin_id) ?? [])
        .filter((h) => h.date < today)
        .sort((a, b) => a.date.localeCompare(b.date));
      const prev = hist[hist.length - 1];
      const p7p = prev?.price_change_7d ?? 0;
      const prevTier = prev
        ? (prev.buy_tier ??
          assignTradeLevels(prev.signal, prev.score, prev.momentum, p7p, prev.days).buy_tier)
        : null;
      const prevQ = prev
        ? qualifiesCompellingBuy({
          market_cap: prev.market_cap,
          score: prev.score,
          momentum: prev.momentum,
          signal: prev.signal,
          buy_tier: prevTier,
          price_change_7d: p7p,
        })
        : false;
      const nowQ = qualifiesCompellingBuy({
        market_cap: r.market_cap,
        score: r.score,
        momentum: r.momentum,
        signal: r.signal,
        buy_tier: r.buy_tier ?? null,
        price_change_7d: r.price_change_7d ?? 0,
      });
      if (nowQ && !prevQ) {
        buy_now_count++;
        alerts.push({
          coin_id: r.coin_id,
          symbol: r.symbol,
          name: r.name,
          alert_type: "buy_now",
          old_value: prev ? "below_compelling_buy_threshold" : "first_scan",
          new_value: formatBuyNowSummary({
            symbol: r.symbol,
            buy_tier: r.buy_tier,
            market_cap: r.market_cap,
            score: r.score,
            momentum: r.momentum,
            price_change_7d: r.price_change_7d ?? 0,
          }),
          score: r.score,
          price: r.price,
        });
      }
    }

    for (const r of rows) {
      if (!watchedIds.has(r.coin_id)) continue;
      const prev = prevByCoin.get(r.coin_id);
      if (!prev) continue;

      const becameCriticalExit = r.sell_tier?.startsWith("Critical") && !prev.sell_tier?.startsWith("Critical");
      const becameStrongExit = r.sell_tier?.startsWith("Strong exit") && !prev.sell_tier?.startsWith("Strong exit") && !prev.sell_tier?.startsWith("Critical");

      if (becameCriticalExit || becameStrongExit) {
        alerts.push({
          coin_id: r.coin_id,
          symbol: r.symbol,
          name: r.name,
          alert_type: "exit_now",
          old_value: prev.sell_tier ?? prev.signal,
          new_value: r.sell_tier,
          score: r.score,
          price: r.price,
        });
      } else if (prev.signal !== r.signal) {
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

    await supabase.from("scan_runs").insert({
      run_date: today,
      assets_scanned: all.length,
      assets_qualified: qualified.length,
      duration_ms: Date.now() - started,
      triggered_by: triggeredBy,
    });

    return new Response(
      JSON.stringify({
        success: true,
        scanned: all.length,
        qualified: qualified.length,
        watchlist_added: toAdd.length,
        watchlist_deactivated: toDeactivate.length,
        alerts_generated: alerts.length,
        buy_now_alerts: buy_now_count,
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
