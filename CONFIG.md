# Options Flow Indicator - Configuration Guide

## Environment Variables

### Required `.env.local`

Location: `/Users/mat/Desktop/indicator/Option_app/app/.env.local`

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-anon-key...
CRON_SECRET=your-secret-for-cron-jobs
```

### Vercel Environment Variables

These same variables must be set in your Vercel project:
1. Go to https://vercel.com/dashboard
2. Select your project
3. Settings → Environment Variables
4. Add all three variables above

---

## Supabase Configuration

### Database Tables

Run this SQL in Supabase SQL Editor to create/verify tables:

```sql
-- Market Levels Table (stores calculated S/R/GH/GL)
CREATE TABLE IF NOT EXISTS market_levels (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expiry_date TEXT NOT NULL,
    current_price DECIMAL,
    gamma_high_price DECIMAL,
    gamma_low_price DECIMAL,
    support_price DECIMAL,
    resistance_price DECIMAL,
    window_start TIMESTAMPTZ
);

-- Trades Table (optional, for historical analysis)
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    trade_id TEXT UNIQUE,
    timestamp TIMESTAMPTZ,
    instrument_name TEXT,
    direction TEXT,
    amount DECIMAL,
    price DECIMAL,
    iv DECIMAL,
    index_price DECIMAL,
    currency TEXT,
    expiry_date TEXT,
    strike DECIMAL,
    option_type TEXT
);

-- Enable RLS and allow public access
ALTER TABLE market_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read market_levels" ON market_levels
    FOR SELECT TO anon USING (true);

CREATE POLICY "Public Insert market_levels" ON market_levels
    FOR INSERT TO anon WITH CHECK (true);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public Read trades" ON trades
    FOR SELECT TO anon USING (true);

CREATE POLICY "Public Insert trades" ON trades
    FOR INSERT TO anon WITH CHECK (true);
```

---

## Vercel Configuration

### `vercel.json`

Location: `/Users/mat/Desktop/indicator/Option_app/app/vercel.json`

Currently empty (no special config needed):
```json
{}
```

Note: Cron jobs are not available on Vercel Hobby plan. Instead, the chart page polls the API every 5 seconds to trigger calculations.

---

## Next.js Configuration

### `next.config.ts`

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
```

---

## Package Dependencies

### Key Dependencies in `package.json`:

```json
{
  "dependencies": {
    "next": "15.1.3",
    "react": "^19.0.0",
    "@supabase/supabase-js": "^2.47.12",
    "@visx/visx": "^3.12.0",
    "zustand": "^5.0.2",
    "lucide-react": "^0.469.0",
    "tailwindcss": "^3.4.17"
  }
}
```

---

## GitHub Actions (Optional)

### `.github/workflows/cron.yml`

For automated 5-minute background updates (requires GitHub Secrets):

```yaml
name: Market Levels Cron
on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:  # Manual trigger

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Market Levels Calculation
        run: |
          curl -X GET "https://app-nine-tau-91.vercel.app/api/cron/market-levels?secret=${{ secrets.CRON_SECRET }}"
```

To enable:
1. Go to GitHub repository → Settings → Secrets
2. Add secret: `CRON_SECRET` with same value as in Vercel
3. Go to Actions tab → Enable workflows

---

## File Locations Summary

| File | Purpose |
|------|---------|
| `.env.local` | Local environment variables |
| `vercel.json` | Vercel deployment config |
| `next.config.ts` | Next.js config |
| `package.json` | NPM dependencies |
| `DOCUMENTATION.md` | Full project documentation |
| `README.md` | Quick reference guide |
| `CONFIG.md` | This configuration guide |

---

## Troubleshooting

### "Cannot read properties of undefined" errors
- Check `.env.local` has correct Supabase credentials
- Verify Vercel has the same environment variables

### Database insert fails
- Run the RLS policy SQL in Supabase
- Check Supabase logs for permission errors

### Values not updating
- Ensure chart page is open (triggers polling)
- Check browser console for fetch errors
- Verify API returns success: `curl https://app-nine-tau-91.vercel.app/api/cron/market-levels`

### Build fails
```bash
cd /Users/mat/Desktop/indicator/Option_app/app
rm -rf .next node_modules
npm install
npm run build
```
