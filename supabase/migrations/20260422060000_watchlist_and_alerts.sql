
-- Watchlist: coins under active monitoring
CREATE TABLE public.watchlist (
  id          BIGSERIAL PRIMARY KEY,
  coin_id     TEXT        NOT NULL UNIQUE,
  symbol      TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by    TEXT        NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
  notes       TEXT,
  active      BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX idx_watchlist_coin ON public.watchlist(coin_id);
CREATE INDEX idx_watchlist_active ON public.watchlist(active) WHERE active = true;

ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read watchlist"   ON public.watchlist FOR SELECT USING (true);
CREATE POLICY "Public insert watchlist" ON public.watchlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update watchlist" ON public.watchlist FOR UPDATE USING (true);
CREATE POLICY "Public delete watchlist" ON public.watchlist FOR DELETE USING (true);

-- Price alerts: signal / score change events
CREATE TABLE public.price_alerts (
  id          BIGSERIAL PRIMARY KEY,
  coin_id     TEXT        NOT NULL,
  symbol      TEXT        NOT NULL,
  name        TEXT        NOT NULL DEFAULT '',
  alert_type  TEXT        NOT NULL, -- 'signal_change' | 'score_up' | 'score_down'
  old_value   TEXT,
  new_value   TEXT,
  score       INT,
  price       NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_coin       ON public.price_alerts(coin_id, created_at DESC);
CREATE INDEX idx_alerts_created_at ON public.price_alerts(created_at DESC);

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read alerts"   ON public.price_alerts FOR SELECT USING (true);
CREATE POLICY "Public insert alerts" ON public.price_alerts FOR INSERT WITH CHECK (true);
