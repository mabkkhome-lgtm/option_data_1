import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Backfill API Route
 * 
 * Manually triggered to fetch historical trades from Deribit
 * and store them in Supabase.
 * 
 * Usage: POST /api/backfill
 * Body: { currency: "BTC", days: 7 }
 */

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';

function getSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) return null;
    return createClient(url, key);
}

// Parse instrument name
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

export async function POST(request: NextRequest) {
    const startTime = Date.now();

    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({
            error: 'Supabase not configured'
        }, { status: 500 });
    }

    // Parse request body
    let currency = 'BTC';
    let days = 7;

    try {
        const body = await request.json();
        currency = body.currency || 'BTC';
        days = body.days || 7;
    } catch {
        // Use defaults
    }

    const endTimestamp = Date.now();
    const startTimestamp = endTimestamp - days * 24 * 60 * 60 * 1000;

    let totalFetched = 0;
    let totalInserted = 0;
    const errors: string[] = [];

    try {
        // Fetch trades with pagination
        let hasMore = true;
        let lastTimestamp = endTimestamp;
        let pageCount = 0;

        while (hasMore) {
            pageCount++;
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
                const trades = data.result.trades;
                totalFetched += trades.length;

                // Convert and insert
                const dbTrades = trades
                    .map(tradeToDbFormat)
                    .filter((t: any): t is NonNullable<typeof t> => t !== null);

                // Batch upsert
                const batchSize = 500;
                for (let i = 0; i < dbTrades.length; i += batchSize) {
                    const batch = dbTrades.slice(i, i + batchSize);
                    const { error } = await supabase
                        .from('trades')
                        .upsert(batch, { onConflict: 'trade_id', ignoreDuplicates: true });

                    if (error) {
                        errors.push(`Batch ${Math.floor(i / batchSize)}: ${error.message}`);
                    } else {
                        totalInserted += batch.length;
                    }
                }

                // Check if we should continue
                const oldestTimestamp = trades[trades.length - 1].timestamp;
                if (oldestTimestamp <= startTimestamp) {
                    hasMore = false;
                } else {
                    lastTimestamp = oldestTimestamp - 1;
                    hasMore = data.result.has_more && trades.length === 1000;
                }

                // Log progress
                console.log(`[Backfill] Page ${pageCount}: ${trades.length} trades, oldest: ${new Date(oldestTimestamp).toISOString()}`);
            } else {
                hasMore = false;
            }
        }
    } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Unknown error');
    }

    const duration = Date.now() - startTime;

    // Get total count
    const { count: totalInDb } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true })
        .eq('currency', currency);

    return NextResponse.json({
        success: errors.length === 0,
        currency,
        days,
        duration: `${(duration / 1000).toFixed(1)}s`,
        fetched: totalFetched,
        inserted: totalInserted,
        totalInDb,
        errors: errors.length > 0 ? errors : undefined,
        dateRange: {
            from: new Date(startTimestamp).toISOString(),
            to: new Date(endTimestamp).toISOString(),
        },
    });
}

// GET for status check
export async function GET() {
    const supabase = getSupabase();
    if (!supabase) {
        return NextResponse.json({ configured: false });
    }

    const stats: Record<string, number> = {};

    for (const currency of ['BTC', 'ETH', 'SOL']) {
        const { count } = await supabase
            .from('trades')
            .select('*', { count: 'exact', head: true })
            .eq('currency', currency);
        stats[currency] = count || 0;
    }

    // Get date range
    const { data: oldest } = await supabase
        .from('trades')
        .select('timestamp')
        .order('timestamp', { ascending: true })
        .limit(1)
        .single();

    const { data: newest } = await supabase
        .from('trades')
        .select('timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

    return NextResponse.json({
        configured: true,
        stats,
        dateRange: {
            oldest: oldest?.timestamp,
            newest: newest?.timestamp,
        },
    });
}
