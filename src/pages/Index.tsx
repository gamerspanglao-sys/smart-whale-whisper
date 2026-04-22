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
import { Sparkline } from "@/components/Sparkline";
import { SignalBadge } from "@/components/SignalBadge";
import { Activity, RefreshCw, TrendingUp, AlertTriangle, Eye, Radar } from "lucide-react";
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

  const load = async () => {
    setLoading(true);
    const { data: latest } = await supabase
      .from("asset_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1);

    const date = latest?.[0]?.snapshot_date;
    if (!date) {
      setRows([]);
      setLoading(false);
      return;
    }
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

  useEffect(() => {
    load();
  }, []);

  const runScan = async () => {
    setScanning(true);
    toast.info("Scanning markets… ~10s");
    try {
      const { data, error } = await supabase.functions.invoke("run-scan", {
        body: { triggered_by: "manual" },
      });
      if (error) throw error;
      toast.success(`Scan complete · ${data.qualified}/${data.scanned} qualified`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search && !`${r.name} ${r.symbol}`.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (signalFilter !== "all" && r.signal !== signalFilter) return false;
      if (r.score < Number(minScore)) return false;
      if (minMomentum === "positive" && r.momentum <= 0) return false;
      if (minMomentum === "strong" && r.momentum < 3) return false;
      return true;
    });
  }, [rows, search, signalFilter, minScore, minMomentum]);

  const top15 = filtered.slice(0, 15);
  const strongCount = rows.filter((r) => r.signal === "Strong").length;
  const watchCount = rows.filter((r) => r.signal === "Watchlist").length;

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
              <p className="text-xs text-muted-foreground">
                Detect smart-money positioning before breakout
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastRun && (
              <span className="text-xs text-muted-foreground tabular hidden sm:inline">
                Last scan: {lastRun}
              </span>
            )}
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
          <StatCard
            icon={<TrendingUp className="size-4 text-primary" />}
            label="Strong signals"
            value={strongCount.toString()}
            accent
          />
          <StatCard
            icon={<Eye className="size-4 text-accent" />}
            label="Watchlist"
            value={watchCount.toString()}
          />
          <StatCard
            icon={<AlertTriangle className="size-4 text-destructive" />}
            label="Avoid"
            value={rows.filter((r) => r.signal === "Avoid").length.toString()}
          />
        </div>

        {/* Filters */}
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
          <span className="text-xs text-muted-foreground ml-auto">
            Showing top {top15.length} of {filtered.length}
          </span>
        </div>

        {/* Table */}
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
                <TableHead className="text-xs">Trend (7d)</TableHead>
                <TableHead className="text-xs">Signal</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : top15.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    {rows.length === 0
                      ? "No data yet. Click 'Run Scan' to fetch the market."
                      : "No assets match your filters."}
                  </TableCell>
                </TableRow>
              ) : (
                top15.map((r, idx) => (
                  <TableRow
                    key={r.coin_id}
                    className={`border-border ${
                      r.signal === "Strong" ? "bg-primary/[0.04]" : ""
                    }`}
                  >
                    <TableCell className="text-muted-foreground tabular text-xs">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.symbol}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[140px]">{r.name}</div>
                    </TableCell>
                    <TableCell className="text-right tabular text-sm">{fmt.price(r.price)}</TableCell>
                    <TableCell className="text-right tabular text-sm text-muted-foreground">{fmt.usd(r.market_cap)}</TableCell>
                    <TableCell
                      className={`text-right tabular text-sm ${
                        (r.price_change_7d ?? 0) >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {fmt.pct(r.price_change_7d)}
                    </TableCell>
                    <TableCell className="text-right tabular font-semibold">{r.score}</TableCell>
                    <TableCell
                      className={`text-right tabular font-semibold ${
                        r.momentum > 0 ? "text-success" : r.momentum < 0 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {r.momentum > 0 ? "+" : ""}{r.momentum}
                    </TableCell>
                    <TableCell className="text-right tabular text-sm">{r.days_in_accumulation}</TableCell>
                    <TableCell>
                      <Sparkline data={r.sparkline ?? []} />
                    </TableCell>
                    <TableCell><SignalBadge signal={r.signal} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden lg:table-cell max-w-[260px]">
                      {r.explanation}
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
      </main>
    </div>
  );
};

const StatCard = ({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) => (
  <div
    className={`rounded-lg border p-4 bg-card shadow-[var(--shadow-card)] ${
      accent ? "border-primary/30" : "border-border"
    }`}
  >
    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
      {icon}
      {label}
    </div>
    <div className="text-2xl font-semibold tabular">{value}</div>
  </div>
);

export default Index;
