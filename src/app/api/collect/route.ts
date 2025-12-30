import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Trade Collection API Route
 * 
 * Called by Vercel Cron every 5 minutes to fetch new trades from Deribit
 * and store them in Supabase for historical analysis.
 */

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';
const CURRENCIES = ['BTC', 'ETH'];

// Create Supabase client with service role for server-side operations
function getSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
        return null;
    }

    return createClient(url, key);
}

// Verify cron secret for security (optional but recommended)
function verifyCronSecret(request: NextRequest): boolean {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // If no secret configured, allow all requests (development mode)
    if (!cronSecret) return true;

    return authHeader === `Bearer ${cronSecret}`;
}

// Fetch trades from Deribit API
async function fetchDeribitTrades(
    currency: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<any[]> {
    const allTrades: any[] = [];
    let hasMore = true;
    let lastTimestamp = endTimestamp;

    while (hasMore) {
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

// Parse instrument name to extract details
function parseInstrument(name: string) {
    const match = name.match(/^(\w+)-(\d+\w+\d+)-(\d+)-([CP])$/);
    if (!match) return null;

    const expiryStr = match[2];
    const months: Record<string, string> = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
    };

    const day = expiryStr.slice(0, 2);
    const month = months[expiryStr.slice(2, 5)];
    const year = '20' + expiryStr.slice(5, 7);

    return {
        currency: match[1],
        expiry: match[2],
        expiryDate: `${year}-${month}-${day}`,
        strike: parseInt(match[3]),
        optionType: match[4] === 'C' ? 'call' : 'put',
    };
}

// Convert Deribit trade to DB format
function tradeToDbFormat(trade: any) {
    const parsed = parseInstrument(trade.instrument_name);
    if (!parsed) return null;

    return {
        trade_id: trade.trade_id,
        instrument_name: trade.instrument_name,
        currency: parsed.currency,
        option_type: parsed.optionType,
        direction: trade.direction,
        strike: parsed.strike,
        expiry_date: parsed.expiryDate,
        price: trade.price,
        price_usd: trade.price * (trade.index_price || 0),
        amount: trade.amount,
        iv: trade.iv || null,
        index_price: trade.index_price || null,
        timestamp: new Date(trade.timestamp).toISOString(),
    };
}

export async function GET(request: NextRequest) {
    const startTime = Date.now();

    // Verify authorization
    if (!verifyCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({
            error: 'Supabase not configured',
            message: 'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
        }, { status: 500 });
    }

    const results: Record<string, { fetched: number; inserted: number; errors: string[] }> = {};

    for (const currency of CURRENCIES) {
        results[currency] = { fetched: 0, inserted: 0, errors: [] };

        try {
            // Get the timestamp of the most recent trade we have
            const { data: lastTrade } = await supabase
                .from('trades')
                .select('timestamp')
                .eq('currency', currency)
                .order('timestamp', { ascending: false })
                .limit(1)
                .single();

            // Start from last trade timestamp (or 24 hours ago if no trades)
            const startTimestamp = lastTrade
                ? new Date(lastTrade.timestamp).getTime() + 1 // +1ms to avoid duplicates
                : Date.now() - 24 * 60 * 60 * 1000;

            const endTimestamp = Date.now();

            // Fetch trades from Deribit
            const trades = await fetchDeribitTrades(currency, startTimestamp, endTimestamp);
            results[currency].fetched = trades.length;

            if (trades.length > 0) {
                // Convert to DB format
                const dbTrades = trades
                    .map(tradeToDbFormat)
                    .filter((t): t is NonNullable<typeof t> => t !== null);

                // Batch upsert (Supabase has limit of ~1000 per request)
                const batchSize = 500;
                for (let i = 0; i < dbTrades.length; i += batchSize) {
                    const batch = dbTrades.slice(i, i + batchSize);
                    const { error } = await supabase
                        .from('trades')
                        .upsert(batch, { onConflict: 'trade_id', ignoreDuplicates: true });

                    if (error) {
                        results[currency].errors.push(error.message);
                    } else {
                        results[currency].inserted += batch.length;
                    }
                }
            }
        } catch (err) {
            results[currency].errors.push(err instanceof Error ? err.message : 'Unknown error');
        }
    }

    const duration = Date.now() - startTime;

    // Get total trade count
    const { count: totalTrades } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true });

    return NextResponse.json({
        success: true,
        duration: `${duration}ms`,
        totalTradesInDb: totalTrades,
        results,
        timestamp: new Date().toISOString(),
    });
}
