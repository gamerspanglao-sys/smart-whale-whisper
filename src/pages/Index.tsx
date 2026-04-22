import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkline } from "@/components/Sparkline";
import { SignalBadge } from "@/components/SignalBadge";
import {
  Activity,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Eye,
  Radar,
  BookmarkPlus,
  BookmarkMinus,
  Bell,
  ArrowUpCircle,
  ArrowDownCircle,
  Repeat2,
  Zap,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

interface Snapshot {
  coin_id: string;
  symbol: string;
  name: string;
  snapshot_date: string;
  price: number;
  market_cap: number;
  volume_24h: number;
  score: number;
  momentum: number;
  days_in_accumulation: number;
  volatility: number | null;
  price_change_7d: number | null;
  price_change_30d: number | null;
  signal: string;
  phase: string;
  explanation: string | null;
  sparkline: number[] | null;
}

interface WatchlistItem {
  coin_id: string;
  symbol: string;
  name: string;
  added_at: string;
  added_by: string;
  active: boolean;
  last_monitored_at: string | null;
}

interface PriceAlert {
  id: number;
  coin_id: string;
  symbol: string;
  name: string;
  alert_type: string;
  old_value: string | null;
  new_value: string | null;
  score: number | null;
  price: number | null;
  created_at: string;
}

const fmt = {
  usd: (n: number) =>
    n >= 1e9
      ? `$${(n / 1e9).toFixed(2)}B`
      : n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
  price: (n: number) =>
    n >= 1
      ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : `$${n.toPrecision(3)}`,
  pct: (n: number | null) =>
    n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`,
  time: (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  },
};

const Index = () => {
  const [rows, setRows] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [signalFilter, setSignalFilter] = useState("all");
  const [minScore, setMinScore] = useState("0");
  const [minMomentum, setMinMomentum] = useState("any");
  const [showLimit, setShowLimit] = useState(25);

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchlistSnapshots, setWatchlistSnapshots] = useState<Snapshot[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [monitoring, setMonitoring] = useState(false);

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const watchedIds = useMemo(() => new Set(watchlist.filter((w) => w.active).map((w) => w.coin_id)), [watchlist]);

  const load = async () => {
    setLoading(true);
    const { data: latest } = await supabase
      .from("asset_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1);

    const date = latest?.[0]?.snapshot_date;
    if (!date) { setRows([]); setLoading(false); return; }
    setLastRun(date);

    const { data } = await supabase
      .from("asset_snapshots")
      .select("*")
      .eq("snapshot_date", date)
      .order("momentum", { ascending: false })
      .order("score", { ascending: false });

    setRows((data as unknown as Snapshot[]) ?? []);
    setLoading(false);
  };

  const loadWatchlist = async () => {
    setWatchlistLoading(true);
    const { data: wl } = await supabase
      .from("watchlist")
      .select("*")
      .eq("active", true)
      .order("added_at", { ascending: false });
    const items = (wl ?? []) as WatchlistItem[];
    setWatchlist(items);

    if (items.length > 0) {
      const { data: latest } = await supabase
        .from("asset_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(1);
      const date = latest?.[0]?.snapshot_date;
      if (date) {
        const { data: snaps } = await supabase
          .from("asset_snapshots")
          .select("*")
          .eq("snapshot_date", date)
          .in("coin_id", items.map((i) => i.coin_id))
          .order("score", { ascending: false });
        setWatchlistSnapshots((snaps as unknown as Snapshot[]) ?? []);
      }
    } else {
      setWatchlistSnapshots([]);
    }
    setWatchlistLoading(false);
  };

  const loadAlerts = async () => {
    setAlertsLoading(true);
    const { data } = await supabase
      .from("price_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setAlerts((data as unknown as PriceAlert[]) ?? []);
    setAlertsLoading(false);
  };

  useEffect(() => {
    load();
    loadWatchlist();
    loadAlerts();
  }, []);

  const runScan = async () => {
    setScanning(true);
    toast.info("Scanning markets… ~10s");
    try {
      const { data, error } = await supabase.functions.invoke("run-scan", {
        body: { triggered_by: "manual" },
      });
      if (error) throw error;
      toast.success(
        `Scan complete · ${data.qualified}/${data.scanned} qualified · +${data.watchlist_added ?? 0} to watchlist · ${data.alerts_generated ?? 0} alerts`
      );
      await Promise.all([load(), loadWatchlist(), loadAlerts()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const runMonitor = async () => {
    setMonitoring(true);
    toast.info("Monitoring watchlist…");
    try {
      const { data, error } = await supabase.functions.invoke("monitor-watchlist", {});
      if (error) throw error;
      toast.success(`Monitor complete · ${data.monitored} coins · ${data.alerts_generated} alerts`);
      await Promise.all([loadWatchlist(), loadAlerts()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Monitor failed");
    } finally {
      setMonitoring(false);
    }
  };

  const addToWatchlist = async (row: Snapshot) => {
    const { error } = await supabase.from("watchlist").upsert(
      { coin_id: row.coin_id, symbol: row.symbol, name: row.name, added_by: "manual", active: true },
      { onConflict: "coin_id" },
    );
    if (error) { toast.error("Failed to add"); return; }
    toast.success(`${row.symbol} added to Watchlist`);
    await loadWatchlist();
  };

  const removeFromWatchlist = async (coinId: string, symbol: string) => {
    const { error } = await supabase.from("watchlist").update({ active: false }).eq("coin_id", coinId);
    if (error) { toast.error("Failed to remove"); return; }
    toast.info(`${symbol} removed from Watchlist`);
    await loadWatchlist();
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search && !`${r.name} ${r.symbol}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (signalFilter !== "all" && r.signal !== signalFilter) return false;
      if (r.score < Number(minScore)) return false;
      if (minMomentum === "positive" && r.momentum <= 0) return false;
      if (minMomentum === "strong" && r.momentum < 3) return false;
      return true;
    });
  }, [rows, search, signalFilter, minScore, minMomentum]);

  const topRows = filtered.slice(0, showLimit);
  const strongCount = rows.filter((r) => r.signal === "Strong").length;
  const watchCount = rows.filter((r) => r.signal === "Watchlist").length;
  const newAlertsCount = alerts.filter((a) => {
    const mins = (Date.now() - new Date(a.created_at).getTime()) / 60000;
    return mins < 60;
  }).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="container py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-primary/15 border border-primary/30 grid place-items-center">
              <Radar className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Accumulation Scanner</h1>
              <p className="text-xs text-muted-foreground">Detect smart-money positioning before breakout</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastRun && (
              <span className="text-xs text-muted-foreground tabular hidden sm:inline">
                Last scan: {lastRun}
              </span>
            )}
            <Button onClick={runMonitor} disabled={monitoring} size="sm" variant="outline">
              <Repeat2 className={`size-4 mr-2 ${monitoring ? "animate-spin" : ""}`} />
              {monitoring ? "Monitoring…" : "Monitor"}
            </Button>
            <Button onClick={runScan} disabled={scanning} size="sm">
              <RefreshCw className={`size-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
              {scanning ? "Scanning…" : "Run Scan"}
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={<Activity className="size-4" />} label="Universe" value={rows.length.toString()} />
          <StatCard icon={<TrendingUp className="size-4 text-primary" />} label="Strong signals" value={strongCount.toString()} accent />
          <StatCard icon={<Eye className="size-4 text-accent" />} label="Watchlist" value={watchCount.toString()} />
          <StatCard icon={<AlertTriangle className="size-4 text-destructive" />} label="Avoid" value={rows.filter((r) => r.signal === "Avoid").length.toString()} />
        </div>

        <Tabs defaultValue="scanner">
          <TabsList className="mb-4">
            <TabsTrigger value="scanner">
              <Radar className="size-3.5 mr-1.5" /> Scanner
            </TabsTrigger>
            <TabsTrigger value="watchlist">
              <Eye className="size-3.5 mr-1.5" /> Watchlist
              {watchedIds.size > 0 && (
                <span className="ml-1.5 bg-primary/20 text-primary text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                  {watchedIds.size}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="alerts">
              <Bell className="size-3.5 mr-1.5" /> Alerts
              {newAlertsCount > 0 && (
                <span className="ml-1.5 bg-destructive/20 text-destructive text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                  {newAlertsCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── SCANNER TAB ── */}
          <TabsContent value="scanner" className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Input
                placeholder="Search ticker or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
              <Select value={signalFilter} onValueChange={setSignalFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All signals</SelectItem>
                  <SelectItem value="Strong">Strong</SelectItem>
                  <SelectItem value="Watchlist">Watchlist</SelectItem>
                  <SelectItem value="Neutral">Neutral</SelectItem>
                  <SelectItem value="Avoid">Avoid</SelectItem>
                </SelectContent>
              </Select>
              <Select value={minScore} onValueChange={setMinScore}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Score ≥ 0</SelectItem>
                  <SelectItem value="3">Score ≥ 3</SelectItem>
                  <SelectItem value="5">Score ≥ 5</SelectItem>
                  <SelectItem value="7">Score ≥ 7</SelectItem>
                </SelectContent>
              </Select>
              <Select value={minMomentum} onValueChange={setMinMomentum}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any momentum</SelectItem>
                  <SelectItem value="positive">Positive momentum</SelectItem>
                  <SelectItem value="strong">Momentum ≥ 3</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-2">
                Showing {topRows.length} of {filtered.length}
                {filtered.length > showLimit && (
                  <button onClick={() => setShowLimit((l) => l + 25)} className="underline text-primary hover:opacity-80">
                    Show more
                  </button>
                )}
              </span>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden shadow-[var(--shadow-card)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="w-10 text-xs">#</TableHead>
                    <TableHead className="text-xs">Asset</TableHead>
                    <TableHead className="text-right text-xs">Price</TableHead>
                    <TableHead className="text-right text-xs">Mkt Cap</TableHead>
                    <TableHead className="text-right text-xs">7d</TableHead>
                    <TableHead className="text-right text-xs">Score</TableHead>
                    <TableHead className="text-right text-xs">Momentum</TableHead>
                    <TableHead className="text-right text-xs">Days</TableHead>
                    <TableHead className="text-xs">Trend</TableHead>
                    <TableHead className="text-xs">Signal</TableHead>
                    <TableHead className="text-xs hidden lg:table-cell">Why</TableHead>
                    <TableHead className="w-10 text-xs"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={12} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : topRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                        {rows.length === 0 ? "No data yet. Click 'Run Scan'." : "No assets match filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    topRows.map((r, idx) => (
                      <TableRow key={r.coin_id} className={`border-border ${r.signal === "Strong" ? "bg-primary/[0.04]" : ""}`}>
                        <TableCell className="text-muted-foreground tabular text-xs">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.symbol}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[140px]">{r.name}</div>
                        </TableCell>
                        <TableCell className="text-right tabular text-sm">{fmt.price(r.price)}</TableCell>
                        <TableCell className="text-right tabular text-sm text-muted-foreground">{fmt.usd(r.market_cap)}</TableCell>
                        <TableCell className={`text-right tabular text-sm ${(r.price_change_7d ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                          {fmt.pct(r.price_change_7d)}
                        </TableCell>
                        <TableCell className="text-right tabular font-semibold">{r.score}</TableCell>
                        <TableCell className={`text-right tabular font-semibold ${r.momentum > 0 ? "text-success" : r.momentum < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {r.momentum > 0 ? "+" : ""}{r.momentum}
                        </TableCell>
                        <TableCell className="text-right tabular text-sm">{r.days_in_accumulation}</TableCell>
                        <TableCell><Sparkline data={r.sparkline ?? []} /></TableCell>
                        <TableCell><SignalBadge signal={r.signal} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground hidden lg:table-cell max-w-[240px]">{r.explanation}</TableCell>
                        <TableCell>
                          {watchedIds.has(r.coin_id) ? (
                            <button
                              onClick={() => removeFromWatchlist(r.coin_id, r.symbol)}
                              title="Remove from Watchlist"
                              className="text-primary hover:text-destructive transition-colors"
                            >
                              <BookmarkMinus className="size-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => addToWatchlist(r)}
                              title="Add to Watchlist"
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <BookmarkPlus className="size-4" />
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Signals derived from price, volume and volatility trends. Not financial advice.
            </p>
          </TabsContent>

          {/* ── WATCHLIST TAB ── */}
          <TabsContent value="watchlist" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {watchedIds.size === 0
                  ? "No coins in watchlist. Add from Scanner or they'll auto-add when score ≥ 7."
                  : `${watchedIds.size} coin${watchedIds.size > 1 ? "s" : ""} under monitoring · refreshes every 2 hours`}
              </p>
              <Button onClick={runMonitor} disabled={monitoring || watchedIds.size === 0} size="sm" variant="outline">
                <Repeat2 className={`size-4 mr-2 ${monitoring ? "animate-spin" : ""}`} />
                {monitoring ? "…" : "Refresh now"}
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden shadow-[var(--shadow-card)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="text-xs">Asset</TableHead>
                    <TableHead className="text-right text-xs">Price</TableHead>
                    <TableHead className="text-right text-xs">7d</TableHead>
                    <TableHead className="text-right text-xs">Score</TableHead>
                    <TableHead className="text-right text-xs">Momentum</TableHead>
                    <TableHead className="text-right text-xs">Days</TableHead>
                    <TableHead className="text-xs">Trend</TableHead>
                    <TableHead className="text-xs">Signal</TableHead>
                    <TableHead className="text-xs">Added</TableHead>
                    <TableHead className="w-10 text-xs"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {watchlistLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : watchlist.filter((w) => w.active).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                        Watchlist is empty. Add coins from the Scanner tab.
                      </TableCell>
                    </TableRow>
                  ) : (
                    watchlist.filter((w) => w.active).map((w) => {
                      const snap = watchlistSnapshots.find((s) => s.coin_id === w.coin_id);
                      return (
                        <TableRow key={w.coin_id} className={`border-border ${snap?.signal === "Strong" ? "bg-primary/[0.04]" : ""}`}>
                          <TableCell>
                            <div className="font-medium">{w.symbol}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[140px]">{w.name}</div>
                            {w.added_by === "auto" && (
                              <span className="text-[10px] text-primary/70">auto-added</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular text-sm">{snap ? fmt.price(snap.price) : "—"}</TableCell>
                          <TableCell className={`text-right tabular text-sm ${(snap?.price_change_7d ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                            {fmt.pct(snap?.price_change_7d ?? null)}
                          </TableCell>
                          <TableCell className="text-right tabular font-semibold">{snap?.score ?? "—"}</TableCell>
                          <TableCell className={`text-right tabular font-semibold ${(snap?.momentum ?? 0) > 0 ? "text-success" : (snap?.momentum ?? 0) < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {snap ? `${snap.momentum > 0 ? "+" : ""}${snap.momentum}` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular text-sm">{snap?.days_in_accumulation ?? "—"}</TableCell>
                          <TableCell>{snap ? <Sparkline data={snap.sparkline ?? []} /> : "—"}</TableCell>
                          <TableCell>{snap ? <SignalBadge signal={snap.signal} /> : "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            <div>{fmt.time(w.added_at)}</div>
                            {w.last_monitored_at && (
                              <div className="flex items-center gap-1 text-[10px] text-primary/70 mt-0.5">
                                <Clock className="size-2.5" />
                                {fmt.time(w.last_monitored_at)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={() => removeFromWatchlist(w.coin_id, w.symbol)}
                              title="Remove"
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <BookmarkMinus className="size-4" />
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ── ALERTS TAB ── */}
          <TabsContent value="alerts" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Signal and score change events for watchlisted coins
              </p>
              <Button onClick={loadAlerts} size="sm" variant="outline" disabled={alertsLoading}>
                <RefreshCw className={`size-4 mr-2 ${alertsLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden shadow-[var(--shadow-card)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="text-xs">Time</TableHead>
                    <TableHead className="text-xs">Asset</TableHead>
                    <TableHead className="text-xs">Event</TableHead>
                    <TableHead className="text-xs">Change</TableHead>
                    <TableHead className="text-right text-xs">Score</TableHead>
                    <TableHead className="text-right text-xs">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alertsLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : alerts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        No alerts yet. Run a scan or monitor to generate events.
                      </TableCell>
                    </TableRow>
                  ) : (
                    alerts.map((a) => (
                      <TableRow key={a.id} className="border-border">
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt.time(a.created_at)}</TableCell>
                        <TableCell>
                          <div className="font-medium">{a.symbol}</div>
                          <div className="text-xs text-muted-foreground">{a.name}</div>
                        </TableCell>
                        <TableCell>
                          <AlertIcon type={a.alert_type} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {a.alert_type === "signal_change" ? (
                            <span>
                              <SignalBadge signal={a.old_value ?? ""} />
                              <span className="mx-1 text-muted-foreground">→</span>
                              <SignalBadge signal={a.new_value ?? ""} />
                            </span>
                          ) : (
                            <span className={a.alert_type === "score_up" ? "text-success" : "text-destructive"}>
                              {a.old_value} → {a.new_value}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular font-semibold">{a.score ?? "—"}</TableCell>
                        <TableCell className="text-right tabular text-sm">{a.price ? fmt.price(a.price) : "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

const AlertIcon = ({ type }: { type: string }) => {
  if (type === "signal_change") return (
    <span className="inline-flex items-center gap-1 text-xs text-accent font-medium">
      <Bell className="size-3" /> Signal change
    </span>
  );
  if (type === "score_up") return (
    <span className="inline-flex items-center gap-1 text-xs text-success font-medium">
      <ArrowUpCircle className="size-3" /> Score up
    </span>
  );
  if (type === "price_spike_up") return (
    <span className="inline-flex items-center gap-1 text-xs text-success font-medium">
      <Zap className="size-3" /> Price spike ↑
    </span>
  );
  if (type === "price_spike_down") return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
      <Zap className="size-3" /> Price spike ↓
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
      <ArrowDownCircle className="size-3" /> Score down
    </span>
  );
};

const StatCard = ({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) => (
  <div className={`rounded-lg border p-4 bg-card shadow-[var(--shadow-card)] ${accent ? "border-primary/30" : "border-border"}`}>
    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">{icon}{label}</div>
    <div className="text-2xl font-semibold tabular">{value}</div>
  </div>
);

export default Index;
