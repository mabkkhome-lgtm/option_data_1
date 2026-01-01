import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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
        const now = new Date();
        const midnightUTC = new Date(now);
        midnightUTC.setUTCHours(0, 0, 0, 0);
        const userMidnight = new Date(midnightUTC.getTime() - 1 * 60 * 60 * 1000);

        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const expiryTarget = getDeribitExpiryFormat(tomorrow);

        const windowStart = userMidnight.getTime();
        const endTs = now.getTime();
        const allDeribitTrades = await fetchDeribitTrades('BTC', windowStart, endTs);

        const trades = allDeribitTrades.filter(t => {
            const parsed = parseInstrument(t.instrument_name);
            return parsed && parsed.expiry === expiryTarget;
        }).map(t => {
            const parsed = parseInstrument(t.instrument_name)!;
            return {
                strike: parsed.strike,
                optionType: parsed.optionType,
                direction: t.direction,
                amount: t.amount,
            };
        });

        const longs = trades.filter(t => t.direction === 'buy');
        const shorts = trades.filter(t => t.direction === 'sell');

        // Analyze option mix by strike and type
        const longCallsByStrike = new Map<number, number>();
        const longPutsByStrike = new Map<number, number>();
        const shortCallsByStrike = new Map<number, number>();
        const shortPutsByStrike = new Map<number, number>();

        for (const t of longs) {
            if (t.optionType === 'call') {
                longCallsByStrike.set(t.strike, (longCallsByStrike.get(t.strike) || 0) + t.amount);
            } else {
                longPutsByStrike.set(t.strike, (longPutsByStrike.get(t.strike) || 0) + t.amount);
            }
        }

        for (const t of shorts) {
            if (t.optionType === 'call') {
                shortCallsByStrike.set(t.strike, (shortCallsByStrike.get(t.strike) || 0) + t.amount);
            } else {
                shortPutsByStrike.set(t.strike, (shortPutsByStrike.get(t.strike) || 0) + t.amount);
            }
        }

        // Summary
        const longCallTotal = longs.filter(t => t.optionType === 'call').reduce((s, t) => s + t.amount, 0);
        const longPutTotal = longs.filter(t => t.optionType === 'put').reduce((s, t) => s + t.amount, 0);
        const shortCallTotal = shorts.filter(t => t.optionType === 'call').reduce((s, t) => s + t.amount, 0);
        const shortPutTotal = shorts.filter(t => t.optionType === 'put').reduce((s, t) => s + t.amount, 0);

        // Top strikes
        const allStrikes = new Set([...longCallsByStrike.keys(), ...longPutsByStrike.keys(),
        ...shortCallsByStrike.keys(), ...shortPutsByStrike.keys()]);
        const strikeDetails = Array.from(allStrikes).sort((a, b) => a - b).map(strike => ({
            strike,
            longCall: longCallsByStrike.get(strike) || 0,
            longPut: longPutsByStrike.get(strike) || 0,
            shortCall: shortCallsByStrike.get(strike) || 0,
            shortPut: shortPutsByStrike.get(strike) || 0,
        }));

        return NextResponse.json({
            expiryTarget,
            totalTrades: trades.length,
            longs: longs.length,
            shorts: shorts.length,
            summary: {
                longCallTotal: Math.round(longCallTotal * 100) / 100,
                longPutTotal: Math.round(longPutTotal * 100) / 100,
                shortCallTotal: Math.round(shortCallTotal * 100) / 100,
                shortPutTotal: Math.round(shortPutTotal * 100) / 100,
            },
            strikeDetails: strikeDetails.slice(0, 25),
        });

    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
