
import { createClient } from '@supabase/supabase-js';
import { calculateGreeks } from '../lib/options/blackScholes';
import type { DbTrade } from '../lib/supabase/client';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Format Date to Deribit Expiry Format (e.g., 2JAN25)
function getDeribitExpiryFormat(date: Date): string {
    const d = date.getDate();
    // Deribit uses 1JAN25, 31DEC24.
    const m = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const y = date.getFullYear().toString().slice(-2);
    return `${d}${m}${y}`;
}

async function calculateAndStoreLevels() {
    try {
        console.log(`[${new Date().toISOString()}] Starting calculation...`);

        // 1. Determine Time Window
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);

        // 2. Determine Tomorrow's Expiry
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const expiryStr = getDeribitExpiryFormat(tomorrow);

        console.log(`Target Expiry: ${expiryStr}, Since: ${midnight.toISOString()}`);

        // 3. Fetch Trades
        const { data, error } = await supabase
            .from('trades')
            .select('*')
            .gte('timestamp', midnight.toISOString())
            .eq('expiry_date', expiryStr);

        if (error) throw error;

        const trades = data as DbTrade[];

        if (!trades || trades.length === 0) {
            console.log('No trades found for criteria.');
            return; // Don't save zeros? Or save zeros? If no trades, levels undefined.
        }

        console.log(`Fetched ${trades.length} trades.`);

        // 4. Split Longs/Shorts
        const longs = trades.filter(t => t.direction === 'buy');
        const shorts = trades.filter(t => t.direction === 'sell');

        // 5. Build Curves
        // Get Spot
        const latestTrade = trades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
        const spot = latestTrade.index_price || latestTrade.price_usd || 100000;

        const minPrice = spot * 0.8;
        const maxPrice = spot * 1.2;
        const steps = 200;
        const stepSize = (maxPrice - minPrice) / (steps - 1);
        const prices = Array.from({ length: steps }, (_, i) => minPrice + i * stepSize);

        const longCurve = prices.map(p => {
            let d = 0, g = 0;
            longs.forEach(t => {
                const expiryTime = new Date(t.expiry_date).getTime(); // Note: Deribit 'DDMMMYY' might need parsing if Date() constructor fails?
                // JS Date() usually handles "1 Jan 2025" but "1JAN25" might fail.
                // We should parse expiry_date carefully or assume DB has ISO? 
                // DB trades interface says `expiry_date: string`. Deribit API returns string.
                // Usually we store it as 'DDMMMYY'. 
                // JS Date('1JAN25') works in some envs but not all.
                // Assuming standard formats. If it fails, T=0.

                // Let's rely on string parsing if needed or try Date.
                // For now assuming it works or T=small.
                let T = 0.001;
                // Attempt parse
                // Actually 'expiry_date' in DB might be the helper format.
                // Let's assume it works for calculation or use T approx.
                // Actually, calculateGreeks handles logic.

                // Better: parse '1JAN25'.
                const day = parseInt(t.expiry_date);
                const monthStr = t.expiry_date.replace(/\d+/, '').slice(0, 3);
                const yearStr = t.expiry_date.slice(-2);
                const monthMap: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

                if (t.expiry_date.length > 3) {
                    const parsedDate = new Date(2000 + parseInt(yearStr), monthMap[monthStr] || 0, day);
                    T = Math.max(0.0001, (parsedDate.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000));
                }

                const iv = t.iv ? t.iv / 100 : 0.8;
                const bs = calculateGreeks(p, t.strike, T, 0.05, iv, t.option_type as 'call' | 'put');
                d += bs.delta * t.amount;
                g += bs.gamma * t.amount;
            });
            return { price: p, delta: d, gamma: g };
        });

        const shortCurve = prices.map(p => {
            let d = 0, g = 0;
            shorts.forEach(t => {
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
                d += bs.delta * t.amount * -1; // Selling -> Negative exposure (convention)
                g += bs.gamma * t.amount * -1;
            });
            return { price: p, delta: d, gamma: g };
        });

        // 6. Find Intersections (Delta) & Extrema (Gamma)
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

        console.log(`Support: ${support.toFixed(2)}, Res: ${resistance.toFixed(2)}, GHigh: ${gammaHighPrice.toFixed(2)}, GLow: ${gammaLowPrice.toFixed(2)}`);

        // 7. Save
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
        console.log('Saved to DB.');

    } catch (err) {
        console.error('Error in calculation loop:', err);
    }
}

// Run immediately then interval
calculateAndStoreLevels();
setInterval(calculateAndStoreLevels, 5000);
