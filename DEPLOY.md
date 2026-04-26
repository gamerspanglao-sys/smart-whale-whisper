# Deploy changes to your Supabase

The repo has one DB migration + two Edge Functions that must be (re)applied for
the new scoring, buy/exit levels, risk zone and exit alerts to work. Three
options, pick whichever is easiest.

## Option A — Supabase Dashboard (no CLI needed)

1. Open Supabase → your project `hcrffntjzzlpjhzsppna` → **SQL Editor** → paste
   the contents of `supabase/migrations/20260426060000_risk_zone_and_backfill.sql`
   and run. The file uses `IF NOT EXISTS` everywhere, so re-running is safe.
2. Open **Edge Functions** → `run-scan` → **Deploy a new version** and paste the
   latest `supabase/functions/run-scan/index.ts`. Also create/update the shared
   module: inside the function editor, create a new file `_shared/scoring.ts`
   with the contents of `supabase/functions/_shared/scoring.ts`, or paste its
   body directly into `run-scan/index.ts` under a `// shared` section and adjust
   the import. The dashboard supports multiple files per function.
3. Repeat step 2 for `monitor-watchlist`.
4. Trigger a fresh scan from the UI ("Run Scan") — new snapshots will carry
   `buy_tier`, `sell_tier`, `entry_low`, `entry_high`, `stop_loss`, `target`.

## Option B — Supabase CLI (recommended)

```powershell
# one-time install (pick one)
winget install Supabase.CLI
# or: scoop install supabase
# or: npm i -g supabase   (not recommended by Supabase, but works)

cd C:\Users\User\smart-whale-whisper
supabase login --token <your_supabase_access_token>   # create under Account → Access Tokens
supabase link --project-ref hcrffntjzzlpjhzsppna
supabase db push                                      # applies pending migrations
supabase functions deploy run-scan
supabase functions deploy monitor-watchlist
```

## Option C — GitHub Actions (set up once, automatic forever)

Add a secret `SUPABASE_ACCESS_TOKEN` in the repo's settings, then the workflow
in `.github/workflows/deploy-pages.yml` can be extended with a
`supabase functions deploy` step so every push to `main` auto-deploys the
functions. Ping me and I'll wire it up if you want hands-off deploys.

## Cron (every 30 min monitor + daily scan)

Run once in the SQL editor to schedule the jobs (creates the cron extension if
needed):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- daily scan at 06:00 UTC
SELECT cron.schedule(
  'run-scan-daily',
  '0 6 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hcrffntjzzlpjhzsppna.supabase.co/functions/v1/run-scan',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('triggered_by', 'cron')
    );
  $$
);

-- watchlist refresh every 30 min
SELECT cron.schedule(
  'monitor-watchlist-30m',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://hcrffntjzzlpjhzsppna.supabase.co/functions/v1/monitor-watchlist',
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  $$
);
```

Check schedules with `SELECT * FROM cron.job;` and runs with
`SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;`.

## Smoke test

After deploying:

1. Click **Run Scan** in the UI.
2. Open any Strong row — the expanded panel should now show a **Suggested risk
   zone** block with Entry / Stop / Target / R:R.
3. The **Buy / exit** column (Scanner + Watchlist) should be populated.
4. In the **Alerts** tab, watch for `exit_now` events when a watchlist coin
   crosses into Critical/Strong exit.
5. **`buy_now` alerts** — green banner + “BUY” badge on the Alerts tab: small/mid
   cap (about USD 30M–350M), score ≥ 7, momentum ≥ +2, strong buy tier, and
   7d move not extended. Emitted on the **first** transition into that state
   (scan or monitor).
