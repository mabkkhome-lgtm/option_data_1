# Options Flow Indicator - Quick Reference

## Live URLs

| Page | URL |
|------|-----|
| Main Dashboard | https://app-nine-tau-91.vercel.app/ |
| Chart Page | https://app-nine-tau-91.vercel.app/chart |
| API Endpoint | https://app-nine-tau-91.vercel.app/api/cron/market-levels |

---

## What Each Level Means

### Support ($86,285)
- **Definition**: Left payoff curve intersection between Longs and Shorts
- **Trading Meaning**: Price level where buyer and seller payoff exposure is equal
- **Behavior**: Price tends to bounce UP from this level

### Resistance ($88,945)
- **Definition**: Right payoff curve intersection between Longs and Shorts
- **Trading Meaning**: Price level where buyer and seller payoff exposure is equal
- **Behavior**: Price tends to bounce DOWN from this level

### Gamma High ($87,839)
- **Definition**: Price where buyer gamma exposure is maximum
- **Trading Meaning**: Price level where market makers need to buy as price rises
- **Behavior**: Can act as a magnet for price ("gamma squeeze" potential)

### Gamma Low ($88,016)
- **Definition**: Price where seller gamma exposure is most negative
- **Trading Meaning**: Price level where sellers are most exposed
- **Behavior**: Can act as resistance due to hedging pressure

---

## How to Use

### On the Dashboard
1. Open https://app-nine-tau-91.vercel.app/
2. Add two Market Screener widgets
3. Configure Screener 1: BTC, Today, Expiry Tomorrow, Side: **Long**
4. Configure Screener 2: BTC, Today, Expiry Tomorrow, Side: **Short**
5. Add Combined Chart widget
6. Connect both screeners to the Combined Chart (click "IN" mode)
7. The white dots show Support/Resistance
8. The purple markers show Gamma High/Low

### On the Chart Page
1. Open https://app-nine-tau-91.vercel.app/chart
2. The Options Flow Indicator panel shows all 4 levels
3. Values update every 5 seconds automatically
4. Use TradingView drawing tools to mark these levels on the chart

---

## Files Location

```
/Users/mat/Desktop/indicator/Option_app/app/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main dashboard
│   │   ├── chart/page.tsx              # Chart page with TradingView
│   │   └── api/
│   │       ├── cron/market-levels/     # Main calculation API
│   │       ├── collect/                # Trade collection
│   │       └── debug/                  # Debug utilities
│   ├── components/
│   │   └── widgets/
│   │       ├── CombinedChart/          # Combined chart visualization
│   │       ├── MarketScreener/         # Trade screener
│   │       └── ...
│   └── lib/
│       ├── options/blackScholes.ts     # Pricing engine
│       └── supabase/client.ts          # Database client
├── DOCUMENTATION.md                     # Full documentation
└── README.md                            # This quick reference
```

---

## Commands

### Deploy to Production
```bash
cd /Users/mat/Desktop/indicator/Option_app/app
vercel --prod
```

### Run Locally
```bash
cd /Users/mat/Desktop/indicator/Option_app/app
npm run dev
```

### Test API
```bash
curl -s "https://app-nine-tau-91.vercel.app/api/cron/market-levels" | jq '.data'
```

---

## Database (Supabase)

**Project URL**: Check your Supabase dashboard

**Table**: `market_levels`

| Column | Description |
|--------|-------------|
| support_price | Left payoff intersection |
| resistance_price | Right payoff intersection |
| gamma_high_price | Max buyer gamma price |
| gamma_low_price | Min seller gamma price |
| current_price | Spot price at calculation |
| expiry_date | Target expiry (e.g., "2JAN26") |
| timestamp | When calculated |

---

## Update Frequency

- **Chart Page**: Polls every **5 seconds** when open
- **Database**: Updated with each poll
- **Data Source**: Live Deribit trades from CET midnight

---

## Last Updated

2026-01-01 by AI Assistant (Antigravity)
