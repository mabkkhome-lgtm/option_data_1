# Options Flow Indicator - Complete Documentation

## Project Overview

This is a real-time options flow indicator that calculates and displays key market levels (Support, Resistance, Gamma High, Gamma Low) based on live option trades from Deribit.

**Live URL**: https://app-nine-tau-91.vercel.app

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Deribit API   │────▶│  /api/cron/      │────▶│   Supabase DB   │
│  (Live Trades)  │     │  market-levels   │     │  market_levels  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │                        │
                                │                        │
                                ▼                        ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │   /chart Page    │◀────│  Poll every 5s  │
                        │  TradingView +   │     │  Display levels │
                        │  Options Flow    │     └─────────────────┘
                        └──────────────────┘
```

---

## Pages

### 1. Main Dashboard (`/`)
**URL**: https://app-nine-tau-91.vercel.app/

The main dashboard provides a canvas-based layout with draggable widgets:

**Widgets Available**:
- **Market Screener**: Shows live option trades from Deribit with filters for Side (Long/Short), Expiry, Min Size, etc.
- **Combined Chart**: Visualizes Payoff, Delta, and Gamma curves for connected sources. Shows intersection points and gamma extrema.
- **Payoff Chart**: Simple payoff visualization for a single source.
- **Greeks Viz**: Detailed Greeks visualization.
- **Strategy Builder**: Build and analyze option strategies.
- **Option Filter**: Filter options by various criteria.

**Key Features**:
- Drag and drop widgets
- Connect Market Screener to Combined Chart via "IN" mode
- Real-time price updates via WebSocket
- Multiple source comparison (Longs vs Shorts)

---

### 2. Chart Page (`/chart`)
**URL**: https://app-nine-tau-91.vercel.app/chart

A TradingView-based chart with an integrated Options Flow Indicator panel.

**Features**:
- Full TradingView charting (candlesticks, indicators, drawing tools)
- **Options Flow Indicator Panel** showing:
  - **Support**: Left payoff curve intersection price
  - **Resistance**: Right payoff curve intersection price
  - **Gamma High**: Price where buyer gamma is maximum
  - **Gamma Low**: Price where seller gamma is minimum (most negative)
- Auto-updates every 5 seconds
- Symbol switching (BTC, ETH, SOL, stocks, forex)

---

## API Endpoints

### `/api/cron/market-levels`
**Purpose**: Calculate and save market levels to database

**Method**: GET

**Process**:
1. Fetches live trades from Deribit API (last ~17 hours from CET midnight)
2. Filters for tomorrow's expiry (e.g., 2JAN26)
3. Splits trades into Longs (direction=buy) and Shorts (direction=sell)
4. Calculates Payoff at Expiry curves for both
5. Finds where payoff curves intersect → Support (left) and Resistance (right)
6. Calculates Gamma curves and finds extrema → Gamma High and Gamma Low
7. Saves results to `market_levels` table in Supabase
8. Returns JSON with results and stats

**Response Example**:
```json
{
  "success": true,
  "data": {
    "support": 86285,
    "resistance": 88945,
    "gammaHighPrice": 87839,
    "gammaLowPrice": 88016,
    "timestamp": "2026-01-01T15:54:46.015Z",
    "expiry": "2JAN26"
  },
  "stats": {
    "totalFetched": 2998,
    "filteredTrades": 756,
    "longs": 355,
    "shorts": 401,
    "payoffIntersections": 2
  }
}
```

### `/api/collect`
**Purpose**: Collect and store trades in Supabase (for historical analysis)

### `/api/debug`
**Purpose**: Debug endpoint for analyzing trade distribution

### `/api/deribit`
**Purpose**: Proxy for Deribit API calls

---

## Database Schema (Supabase)

### `market_levels` Table
```sql
CREATE TABLE market_levels (
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
```

### `trades` Table
```sql
CREATE TABLE trades (
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
```

---

## Calculation Logic

### Support & Resistance (Payoff Intersections)

For each price point in the range (spot × 0.7 to spot × 1.3):

**Payoff at Expiry Formula**:
```
For each trade:
  intrinsic = (call) ? max(0, price - strike) : max(0, strike - price)
  payoff = (intrinsic - premium) × direction × size
  
Total Payoff = sum of all trade payoffs
```

**Direction**: 
- `buy` → +1 (Long position, profits when option pays off)
- `sell` → -1 (Short position, profits from premium)

**Intersection Detection**:
- Find where `LongPayoff - ShortPayoff` changes sign
- Left intersection = **Support**
- Right intersection = **Resistance**

### Gamma High & Low

**Gamma Calculation**:
```
For each price point:
  gamma = Black-Scholes gamma × direction × size
  
Long Gamma = sum of gamma for all buy trades (positive)
Short Gamma = sum of gamma for all sell trades (negative)
```

- **Gamma High** = Price where Long Gamma is maximum
- **Gamma Low** = Price where Short Gamma is minimum (most negative)

### Parameters
- **DTE**: Fixed at 7 days (matches frontend default)
- **Risk-free rate**: 5%
- **IV**: From trade data, or 50% fallback
- **Price range**: ±30% from spot
- **Resolution**: 300 price steps

---

## Key Files

### Frontend Components
- `src/app/page.tsx` - Main dashboard page
- `src/app/chart/page.tsx` - TradingView chart page
- `src/components/widgets/CombinedChart/index.tsx` - Combined chart visualization
- `src/components/widgets/MarketScreener/index.tsx` - Trade screener
- `src/components/dashboard/Canvas.tsx` - Draggable widget canvas

### API Routes
- `src/app/api/cron/market-levels/route.ts` - Main calculation endpoint
- `src/app/api/collect/route.ts` - Trade collection
- `src/app/api/debug/route.ts` - Debug utilities

### Libraries
- `src/lib/options/blackScholes.ts` - Black-Scholes pricing engine
- `src/lib/supabase/client.ts` - Supabase client
- `src/lib/api/deribitWebSocket.ts` - WebSocket connection

---

## Environment Variables

Required in Vercel and `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
CRON_SECRET=your_cron_secret (optional)
```

---

## Deployment

### Vercel
```bash
cd /Users/mat/Desktop/indicator/Option_app/app
vercel --prod
```

### Local Development
```bash
npm run dev
```

---

## Update Frequency

- **Chart Page**: Polls API every **5 seconds**
- **API Calculation**: ~1-2 seconds per request
- **Data Source**: Live Deribit trades (last ~17 hours)

---

## Matching Frontend Simulation

The API calculation exactly matches what you see in the Combined Chart when:
1. Market Screener 1 is set to: BTC, Today, Expiry Tomorrow, Side: Long
2. Market Screener 2 is set to: BTC, Today, Expiry Tomorrow, Side: Short
3. Both are connected to Combined Chart in "IN" mode
4. DTE slider is set to 7

The white intersection markers show where the Payoff curves cross:
- **Left intersection** = Support
- **Right intersection** = Resistance

The purple Gamma markers show:
- **Top marker** = Gamma High (max buyer gamma)
- **Bottom marker** = Gamma Low (min seller gamma)

---

## Troubleshooting

### Values not updating
1. Check if chart page is open (triggers polling)
2. Verify API returns success: `curl https://app-nine-tau-91.vercel.app/api/cron/market-levels`
3. Check Supabase dashboard for new rows

### Values don't match dashboard
1. Ensure same time window (Today from CET midnight)
2. Ensure same expiry (Tomorrow)
3. Ensure filters match (Long vs Short)
4. DTE should be 7

### Database permission errors
Run this SQL in Supabase:
```sql
-- Enable RLS
ALTER TABLE market_levels ENABLE ROW LEVEL SECURITY;

-- Allow public read
CREATE POLICY "Public Read" ON market_levels FOR SELECT TO anon USING (true);

-- Allow public insert
CREATE POLICY "Public Insert" ON market_levels FOR INSERT TO anon WITH CHECK (true);
```

---

## Version History

- **2026-01-01**: Fixed calculation to use Payoff intersections instead of Delta. Added CET timezone adjustment. Matched values to within $10 of frontend.
