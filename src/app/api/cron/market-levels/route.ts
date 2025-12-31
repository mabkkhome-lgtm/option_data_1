
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { calculateGreeks } from '@/lib/options/blackScholes';
import type { DbTrade } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow 1 minute timeout for calculation

// Format Date to Deribit Expiry Format (e.g., 2JAN25)
function getDeribitExpiryFormat(date: Date): string {
    const d = date.getDate();
    const m = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const y = date.getFullYear().toString().slice(-2);
    return `${d}${m}${y}`;
}

export async function GET(request: Request) {
    // Optional: Add simple secret check to prevent unauthorized calls
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // Allow unauthenticated for now if CRON_SECRET not set, or return 401
    }

    try {
        console.log(`[Cron] Starting calculation at ${new Date().toISOString()}`);

        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);

        // Determine Tomorrow's Expiry
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const expiryStr = getDeribitExpiryFormat(tomorrow);

        // Fetch Trades
        if (!supabase) throw new Error('Supabase client not initialized');

        const { data, error } = await supabase
            .from('trades')
            .select('*')
            .gte('timestamp', midnight.toISOString())
            .eq('expiry_date', expiryStr);

        if (error) throw error;

        const trades = data as DbTrade[];

        if (!trades || trades.length === 0) {
            return NextResponse.json({ message: 'No trades found', expiry: expiryStr });
        }

        // Split Longs (Buyers) / Shorts (Sellers)
        const longs = trades.filter(t => t.direction === 'buy');
        const shorts = trades.filter(t => t.direction === 'sell');

        // Build Curves
        // Spot Price from latest trade or index
        const latestTrade = trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
        const spot = latestTrade.index_price || latestTrade.price_usd || 100000;

        const minPrice = spot * 0.8;
        const maxPrice = spot * 1.2;
        const steps = 200;
        const stepSize = (maxPrice - minPrice) / (steps - 1);
        const prices = Array.from({ length: steps }, (_, i) => minPrice + i * stepSize);

        const buildCurve = (tradeList: DbTrade[], multiplier: number) => {
            return prices.map(p => {
                let sumDelta = 0;
                let sumGamma = 0;
                tradeList.forEach(t => {
                    const day = parseInt(t.expiry_date);
                    const monthStr = t.expiry_date.replace(/\d+/, '').slice(0, 3);
                    const yearStr = t.expiry_date.slice(-2);
                    const monthMap: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
                    let T = 0.001;

                    if (t.expiry_date.length > 3) {
                        const parsedDate = new Date(2000 + parseInt(yearStr), monthMap[monthStr] || 0, day);
                        T = Math.max(0.0001, (parsedDate.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000));
                    }

                    const iv = t.iv ? t.iv / 100 : 0.8;
                    const bs = calculateGreeks(p, t.strike, T, 0.05, iv, t.option_type as 'call' | 'put');
                    sumDelta += bs.delta * t.amount * multiplier;
                    sumGamma += bs.gamma * t.amount * multiplier;
                });
                return { price: p, delta: sumDelta, gamma: sumGamma };
            });
        };

        const longCurve = buildCurve(longs, 1);
        const shortCurve = buildCurve(shorts, -1); // Sellers have negative exposure

        // Find Intersections (Delta Support/Resistance)
        const intersections: number[] = [];
        for (let i = 0; i < prices.length - 1; i++) {
            const d1 = longCurve[i].delta;
            const d2 = shortCurve[i].delta;
            const diff = d1 - d2;

            const d1_next = longCurve[i + 1].delta;
            const d2_next = shortCurve[i + 1].delta;
            const diff_next = d1_next - d2_next;

            if (Math.sign(diff) !== Math.sign(diff_next)) {
                const frac = Math.abs(diff) / (Math.abs(diff) + Math.abs(diff_next));
                const price = prices[i] + (prices[i + 1] - prices[i]) * frac;
                intersections.push(price);
            }
        }

        intersections.sort((a, b) => a - b);
        const support = intersections.length > 0 ? intersections[0] : 0;
        const resistance = intersections.length > 1 ? intersections[intersections.length - 1] : support;

        // Find Gamma Extrema
        let gammaHigh = -Infinity;
        let gammaHighPrice = 0;
        longCurve.forEach(p => {
            if (p.gamma > gammaHigh) { gammaHigh = p.gamma; gammaHighPrice = p.price; }
        });

        let gammaLow = Infinity;
        let gammaLowPrice = 0;
        shortCurve.forEach(p => {
            if (p.gamma < gammaLow) { gammaLow = p.gamma; gammaLowPrice = p.price; }
        });

        // Save to DB
        const { error: insertError } = await supabase.from('market_levels').insert({
            timestamp: now.toISOString(),
            expiry_date: expiryStr,
            current_price: spot,
            gamma_high_price: gammaHighPrice,
            gamma_low_price: gammaLowPrice,
            support_price: support,
            resistance_price: resistance,
            window_start: midnight.toISOString()
        });

        if (insertError) throw insertError;

        return NextResponse.json({
            success: true,
            data: { support, resistance, gammaHighPrice, gammaLowPrice }
        });

    } catch (error) {
        console.error('Cron job error:', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
