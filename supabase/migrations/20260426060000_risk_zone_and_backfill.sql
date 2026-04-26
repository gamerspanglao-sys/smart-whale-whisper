-- Risk management columns + schema backfill for any column referenced by the
-- edge functions but missing from earlier migrations (keeps deploys idempotent).

-- Watchlist: last monitored timestamp (used by monitor-watchlist)
ALTER TABLE public.watchlist
  ADD COLUMN IF NOT EXISTS last_monitored_at TIMESTAMPTZ;

-- Risk zone (suggested entry band, stop, target) — computed on each snapshot
ALTER TABLE public.asset_snapshots
  ADD COLUMN IF NOT EXISTS entry_low  NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_high NUMERIC,
  ADD COLUMN IF NOT EXISTS stop_loss  NUMERIC,
  ADD COLUMN IF NOT EXISTS target     NUMERIC;

-- Trade tier columns (ensure present even if the earlier migration was skipped)
ALTER TABLE public.asset_snapshots
  ADD COLUMN IF NOT EXISTS buy_tier  TEXT,
  ADD COLUMN IF NOT EXISTS sell_tier TEXT;

-- Index to quickly surface the latest Strong setups
CREATE INDEX IF NOT EXISTS idx_snapshots_signal_score
  ON public.asset_snapshots(signal, score DESC)
  WHERE signal = 'Strong';
