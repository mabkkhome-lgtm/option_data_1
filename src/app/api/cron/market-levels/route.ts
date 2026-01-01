import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { calculateGreeks } from '@/lib/options/blackScholes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';

function getDeribitExpiryFormat(date: Date): string {
    const d = date.getUTCDate();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const m = months[date.getUTCMonth()];
    const y = date.getUTCFullYear().toString().slice(-2);
    return `${d}${m}${y}`;
}

function parseInstrument(name: string) {
    const match = name.match(/^(\w+)-(\d{1,2})(\w{3})(\d{2})-(\d+)-([CP])$/);
    if (!match) return null;
    return {
        currency: match[1],
        expiry: `${match[2]}${match[3]}${match[4]}`,
        strike: parseInt(match[5]),
        optionType: match[6] === 'C' ? 'call' : 'put' as 'call' | 'put',
    };
}

async function fetchDeribitTrades(currency: string, startTimestamp: number, endTimestamp: number): Promise<any[]> {
    const allTrades: any[] = [];
    let hasMore = true;
    let lastTimestamp = endTimestamp;

    while (hasMore && allTrades.length < 15000) {
        const url = new URL(`${DERIBIT_API_BASE}/public/get_last_trades_by_currency`);
        url.searchParams.append('currency', currency);
        url.searchParams.append('kind', 'option');
        url.searchParams.append('count', '1000');
        url.searchParams.append('sorting', 'desc');
        url.searchParams.append('start_timestamp', startTimestamp.toString());
        url.searchParams.append('end_timestamp', lastTimestamp.toString());

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.result?.trades && data.result.trades.length > 0) {
            allTrades.push(...data.result.trades);
            const oldestTimestamp = data.result.trades[data.result.trades.length - 1].timestamp;
            if (oldestTimestamp <= startTimestamp) {
                hasMore = false;
            } else {
                lastTimestamp = oldestTimestamp - 1;
                hasMore = data.result.has_more && data.result.trades.length === 1000;
            }
        } else {
            hasMore = false;
        }
    }

    return allTrades;
}

export async function GET() {
    try {
        console.log(`[Cron] Starting calculation at ${new Date().toISOString()}`);

        const now = new Date();
        const midnightUTC = new Date(now);
        midnightUTC.setUTCHours(0, 0, 0, 0);
        const userMidnight = new Date(midnightUTC.getTime() - 1 * 60 * 60 * 1000);

        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const expiryTarget = getDeribitExpiryFormat(tomorrow);

        console.log(`[Cron] User midnight (CET): ${userMidnight.toISOString()}`);

        const windowStart = userMidnight.getTime();
        const endTs = now.getTime();
        const allDeribitTrades = await fetchDeribitTrades('BTC', windowStart, endTs);

        console.log(`[Cron] Fetched ${allDeribitTrades.length} total trades`);

        // Filter for tomorrow's expiry
        const trades = allDeribitTrades.filter(t => {
            const parsed = parseInstrument(t.instrument_name);
            return parsed && parsed.expiry === expiryTarget;
        }).map(t => {
            const parsed = parseInstrument(t.instrument_name)!;
            return {
                ...t,
                strike: parsed.strike,
                option_type: parsed.optionType,
                iv: t.iv,
                index_price: t.index_price,
                amount: t.amount,
                direction: t.direction,
                price_usd: t.price * t.index_price, // Premium in USD
            };
        });

        console.log(`[Cron] Filtered to ${trades.length} trades`);

        const longs = trades.filter(t => t.direction === 'buy');
        const shorts = trades.filter(t => t.direction === 'sell');

        const spot = allDeribitTrades[0]?.index_price || 88000;

        // Price range
        const minPrice = spot * 0.7;
        const maxPrice = spot * 1.3;
        const numSteps = 300;
        const prices: number[] = [];
        for (let i = 0; i < numSteps; i++) {
            prices.push(minPrice + (maxPrice - minPrice) * (i / (numSteps - 1)));
        }

        const daysToExpiry = 7;
        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        // Build PAYOFF AT EXPIRY, DELTA, and GAMMA curves
        const buildCurve = (tradeList: any[]) => {
            return prices.map(price => {
                let totalPayoffExpiry = 0;
                let totalDelta = 0;
                let totalGamma = 0;

                for (const trade of tradeList) {
                    const strike = trade.strike;
                    const type = trade.option_type as 'call' | 'put';
                    const direction = trade.direction === 'buy' ? 1 : -1;
                    const size = trade.amount || 1;
                    const premium = trade.price_usd || 0;
                    const iv = trade.iv ? trade.iv / 100 : 0.5;

                    // PAYOFF AT EXPIRY (exactly like CombinedChart)
                    const intrinsic = type === 'call'
                        ? Math.max(0, price - strike)
                        : Math.max(0, strike - price);
                    totalPayoffExpiry += (intrinsic - premium) * direction * size;

                    // GREEKS
                    const greeks = calculateGreeks(price, strike, T, r, iv, type);
                    totalDelta += greeks.delta * direction * size;
                    totalGamma += greeks.gamma * direction * size;
                }

                return { price, payoff: totalPayoffExpiry, delta: totalDelta, gamma: totalGamma };
            });
        };

        const longCurve = buildCurve(longs);
        const shortCurve = buildCurve(shorts);

        // Find PAYOFF intersections (Support/Resistance from white intersection markers)
        const payoffIntersections: number[] = [];
        for (let i = 0; i < prices.length - 1; i++) {
            const diff = longCurve[i].payoff - shortCurve[i].payoff;
            const diff_next = longCurve[i + 1].payoff - shortCurve[i + 1].payoff;

            if (Math.sign(diff) !== Math.sign(diff_next)) {
                const fraction = Math.abs(diff) / (Math.abs(diff) + Math.abs(diff_next));
                const crossPrice = prices[i] + (prices[i + 1] - prices[i]) * fraction;
                payoffIntersections.push(crossPrice);
            }
        }

        payoffIntersections.sort((a, b) => a - b);

        // Support = left payoff intersection, Resistance = right payoff intersection
        const support = payoffIntersections.length > 0 ? payoffIntersections[0] : spot;
        const resistance = payoffIntersections.length > 1
            ? payoffIntersections[payoffIntersections.length - 1]
            : support;

        // Find Gamma extrema (unchanged)
        let gammaHigh = -Infinity, gammaHighPrice = spot;
        let gammaLow = Infinity, gammaLowPrice = spot;

        for (const p of longCurve) {
            if (p.gamma > gammaHigh) { gammaHigh = p.gamma; gammaHighPrice = p.price; }
        }
        for (const p of shortCurve) {
            if (p.gamma < gammaLow) { gammaLow = p.gamma; gammaLowPrice = p.price; }
        }

        // Debug: Payoff values at key prices
        const debugPrices = [84000, 85000, 86000, 86300, 87000, 88000, 88900, 89000, 90000];
        const debugPayoff: any[] = [];
        for (const dp of debugPrices) {
            const idx = prices.findIndex(p => p >= dp);
            if (idx >= 0) {
                debugPayoff.push({
                    price: Math.round(prices[idx]),
                    L: Math.round(longCurve[idx].payoff),
                    S: Math.round(shortCurve[idx].payoff),
                    diff: Math.round(longCurve[idx].payoff - shortCurve[idx].payoff)
                });
            }
        }

        const result = {
            support: Math.round(support),
            resistance: Math.round(resistance),
            gammaHighPrice: Math.round(gammaHighPrice),
            gammaLowPrice: Math.round(gammaLowPrice),
            timestamp: now.toISOString(),
            expiry: expiryTarget
        };

        console.log(`[Cron] Result: S=${result.support}, R=${result.resistance}, GH=${result.gammaHighPrice}, GL=${result.gammaLowPrice}`);

        // Save to DB
        if (supabase) {
            await supabase.from('market_levels').insert({
                timestamp: now.toISOString(),
                expiry_date: expiryTarget,
                current_price: spot,
                gamma_high_price: gammaHighPrice,
                gamma_low_price: gammaLowPrice,
                support_price: support,
                resistance_price: resistance,
                window_start: userMidnight.toISOString()
            });
        }

        return NextResponse.json({
            success: true,
            data: result,
            stats: {
                totalFetched: allDeribitTrades.length,
                filteredTrades: trades.length,
                longs: longs.length,
                shorts: shorts.length,
                payoffIntersections: payoffIntersections.length,
                allPayoffIntersections: payoffIntersections.map(p => Math.round(p)),
                debugPayoff,
                spot: Math.round(spot),
                windowStart: userMidnight.toISOString()
            }
        });

    } catch (error) {
        console.error('Cron job error:', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
