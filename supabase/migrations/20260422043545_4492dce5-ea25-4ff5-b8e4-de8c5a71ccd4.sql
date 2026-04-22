
CREATE TABLE public.asset_snapshots (
  id BIGSERIAL PRIMARY KEY,
  coin_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  price NUMERIC NOT NULL,
  market_cap NUMERIC NOT NULL,
  volume_24h NUMERIC NOT NULL,
  score INT NOT NULL,
  momentum INT NOT NULL DEFAULT 0,
  days_in_accumulation INT NOT NULL DEFAULT 0,
  volatility NUMERIC,
  price_change_7d NUMERIC,
  price_change_30d NUMERIC,
  volume_change_7d NUMERIC,
  signal TEXT NOT NULL,
  phase TEXT NOT NULL,
  explanation TEXT,
  sparkline JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(coin_id, snapshot_date)
);

CREATE INDEX idx_snapshots_date ON public.asset_snapshots(snapshot_date DESC);
CREATE INDEX idx_snapshots_coin ON public.asset_snapshots(coin_id, snapshot_date DESC);

ALTER TABLE public.asset_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to snapshots"
  ON public.asset_snapshots FOR SELECT
  USING (true);

CREATE TABLE public.scan_runs (
  id BIGSERIAL PRIMARY KEY,
  run_date DATE NOT NULL UNIQUE,
  assets_scanned INT NOT NULL,
  assets_qualified INT NOT NULL,
  duration_ms INT,
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to scan runs"
  ON public.scan_runs FOR SELECT
  USING (true);
