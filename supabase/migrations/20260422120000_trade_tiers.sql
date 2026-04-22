-- Human-readable buy / sell conviction tiers (computed on each scan / monitor run)
ALTER TABLE public.asset_snapshots
  ADD COLUMN IF NOT EXISTS buy_tier TEXT,
  ADD COLUMN IF NOT EXISTS sell_tier TEXT;
