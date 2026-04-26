// Watchlist Monitor — runs every 30 minutes, tracks only watchlisted coins
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
  price_change_percentage_1h_in_currency: number | null;
  price_change_percentage_7d_in_currency: number | null;
  price_change_percentage_30d_in_currency: number | null;
  sparkline_in_7d?: { price: number[] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
    const cgUrl = `${CG}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=1h,7d,30d`;
    const cgRes = await fetch(cgUrl, { headers: { accept: "application/json" } });
    if (!cgRes.ok) throw new Error(`CoinGecko failed: ${cgRes.status}`);
    const coins: CGCoin[] = await cgRes.json();

    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const { data: priorRows } = await supabase
      .from("asset_snapshots")
      .select(
        "coin_id, snapshot_date, score, signal, days_in_accumulation, price, sell_tier, momentum, market_cap, price_change_7d, buy_tier",
      )
      .in("coin_id", watchlistRows.map((w) => w.coin_id))
      .gte("snapshot_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      .order("snapshot_date", { ascending: false });

    type PriorRow = {
      date: string;
      score: number;
      signal: string;
      days: number;
      price: number;
      sell_tier: string | null;
      momentum: number;
      market_cap: number;
      price_change_7d: number | null;
      buy_tier: string | null;
    };
    const priorByCoin = new Map<string, PriorRow[]>();
    for (const r of priorRows ?? []) {
      const list = priorByCoin.get(r.coin_id) ?? [];
      list.push({
        date: r.snapshot_date,
        score: r.score,
        signal: r.signal,
        days: r.days_in_accumulation,
        price: r.price,
        sell_tier: (r as { sell_tier?: string | null }).sell_tier ?? null,
        momentum: r.momentum,
        market_cap: Number(r.market_cap),
        price_change_7d: r.price_change_7d as number | null,
        buy_tier: (r as { buy_tier?: string | null }).buy_tier ?? null,
      });
      priorByCoin.set(r.coin_id, list);
    }

    const snapshots = coins.map((c) => {
      const sparkline = c.sparkline_in_7d?.price ?? [];
      const stats = analyseSparkline(sparkline);
      const p1h = c.price_change_percentage_1h_in_currency ?? 0;
      const p7 = c.price_change_percentage_7d_in_currency ?? 0;
      const p30 = c.price_change_percentage_30d_in_currency ?? 0;
      const volRatio = c.total_volume / Math.max(c.market_cap, 1);

      const { score, explanation } = computeScore({
        price_change_7d: p7,
        price_change_30d: p30,
        vol_24h: c.total_volume,
        market_cap: c.market_cap,
        volatility: stats.volatility,
        lateDriftPct: stats.lateDriftPct,
        maxDrawdownPct: stats.maxDrawdownPct,
      });

      // Prevent intra-day double counting
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
        _p1h: p1h,
        _vol_ratio: volRatio,
        _prev_sell_tier: (priorByCoin.get(c.id) ?? [])[0]?.sell_tier ?? null,
      };
    });

    const dbRows = snapshots.map(({ _p1h: _, _vol_ratio: __, _prev_sell_tier: ___, ...rest }) => rest);
    if (dbRows.length > 0) {
      const { error: upErr } = await supabase
        .from("asset_snapshots")
        .upsert(dbRows, { onConflict: "coin_id,snapshot_date" });
      if (upErr) throw upErr;
    }

    const alerts: object[] = [];
    let buy_now_count = 0;
    for (const snap of snapshots) {
      const history = priorByCoin.get(snap.coin_id) ?? [];
      const prev = history[0]; // query ordered desc by date

      const latestPrior = [...history].sort((a, b) => b.date.localeCompare(a.date))[0];
      const p7lp = latestPrior?.price_change_7d ?? 0;
      const latestTier = latestPrior
        ? (latestPrior.buy_tier ??
          assignTradeLevels(latestPrior.signal, latestPrior.score, latestPrior.momentum, p7lp, latestPrior.days).buy_tier)
        : null;
      const prevCompelling = latestPrior
        ? qualifiesCompellingBuy({
          market_cap: latestPrior.market_cap,
          score: latestPrior.score,
          momentum: latestPrior.momentum,
          signal: latestPrior.signal,
          buy_tier: latestTier,
          price_change_7d: p7lp,
        })
        : false;
      const nowCompelling = qualifiesCompellingBuy({
        market_cap: snap.market_cap,
        score: snap.score,
        momentum: snap.momentum,
        signal: snap.signal,
        buy_tier: snap.buy_tier ?? null,
        price_change_7d: snap.price_change_7d ?? 0,
      });
      if (nowCompelling && !prevCompelling) {
        buy_now_count++;
        alerts.push({
          coin_id: snap.coin_id,
          symbol: snap.symbol,
          name: snap.name,
          alert_type: "buy_now",
          old_value: latestPrior ? "below_compelling_buy_threshold" : "new_on_watchlist",
          new_value: formatBuyNowSummary({
            symbol: snap.symbol,
            buy_tier: snap.buy_tier,
            market_cap: snap.market_cap,
            score: snap.score,
            momentum: snap.momentum,
            price_change_7d: snap.price_change_7d ?? 0,
          }),
          score: snap.score,
          price: snap.price,
        });
      }

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

      // Explicit exit alert on tier transition (works even within the same day)
      const prevTier = snap._prev_sell_tier;
      const becameCritical = snap.sell_tier?.startsWith("Critical") && !prevTier?.startsWith("Critical");
      const becameStrongExit = snap.sell_tier?.startsWith("Strong exit") && !prevTier?.startsWith("Strong exit") && !prevTier?.startsWith("Critical");
      if (becameCritical || becameStrongExit) {
        alerts.push({
          coin_id: snap.coin_id,
          symbol: snap.symbol,
          name: snap.name,
          alert_type: "exit_now",
          old_value: prevTier ?? prev?.signal ?? null,
          new_value: snap.sell_tier,
          score: snap.score,
          price: snap.price,
        });
      }

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

    await supabase
      .from("watchlist")
      .update({ last_monitored_at: new Date().toISOString() })
      .in("coin_id", watchlistRows.map((w) => w.coin_id));

    return new Response(
      JSON.stringify({
        success: true,
        monitored: snapshots.length,
        alerts_generated: alerts.length,
        buy_now_alerts: buy_now_count,
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
