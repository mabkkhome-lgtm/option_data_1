import { supabase, isSupabaseConfigured, DbTrade, TradeQueryFilters } from './client';

/**
 * Trades Database Operations
 * 
 * Optimized for performance:
 * - Batch inserts (up to 100 at a time)
 * - Indexed queries
 * - Duplicate detection via trade_id
 */

// Buffer for batch inserts
let insertBuffer: DbTrade[] = [];
let insertTimeout: NodeJS.Timeout | null = null;
const BATCH_SIZE = 100;
const BATCH_DELAY = 2000; // 2 seconds

/**
 * Insert a single trade (buffered for batch insert)
 */
export async function insertTrade(trade: DbTrade): Promise<void> {
    if (!isSupabaseConfigured || !supabase) {
        console.log('[DB] Supabase not configured, skipping insert');
        return;
    }

    insertBuffer.push(trade);

    // Flush if buffer is full
    if (insertBuffer.length >= BATCH_SIZE) {
        await flushInsertBuffer();
    } else if (!insertTimeout) {
        // Schedule flush after delay
        insertTimeout = setTimeout(flushInsertBuffer, BATCH_DELAY);
    }
}

/**
 * Flush the insert buffer (batch insert)
 */
async function flushInsertBuffer(): Promise<void> {
    if (insertBuffer.length === 0) return;
    if (!supabase) return;

    const trades = [...insertBuffer];
    insertBuffer = [];

    if (insertTimeout) {
        clearTimeout(insertTimeout);
        insertTimeout = null;
    }

    try {
        // Use upsert to handle duplicates gracefully
        const { error } = await supabase
            .from('trades')
            .upsert(trades, { onConflict: 'trade_id', ignoreDuplicates: true });

        if (error) {
            console.error('[DB] Insert error:', error.message);
        } else {
            console.log(`[DB] Inserted ${trades.length} trades`);
        }
    } catch (err) {
        console.error('[DB] Insert exception:', err);
    }
}

/**
 * Query trades with filters
 */
export async function queryTrades(filters: TradeQueryFilters): Promise<DbTrade[]> {
    if (!isSupabaseConfigured || !supabase) {
        console.log('[DB] Supabase not configured');
        return [];
    }

    let query = supabase
        .from('trades')
        .select('*')
        .order('timestamp', { ascending: false });

    // Apply filters
    if (filters.currency) {
        query = query.eq('currency', filters.currency);
    }

    if (filters.startDate) {
        query = query.gte('timestamp', filters.startDate.toISOString());
    }

    if (filters.endDate) {
        query = query.lte('timestamp', filters.endDate.toISOString());
    }

    if (filters.expiryDate) {
        query = query.eq('expiry_date', filters.expiryDate);
    }

    if (filters.minSize) {
        query = query.gte('amount', filters.minSize);
    }

    if (filters.direction) {
        query = query.eq('direction', filters.direction);
    }

    if (filters.optionType) {
        query = query.eq('option_type', filters.optionType);
    }

    if (filters.limit) {
        query = query.limit(filters.limit);
    } else {
        query = query.limit(1000); // Default limit
    }

    const { data, error } = await query;

    if (error) {
        console.error('[DB] Query error:', error.message);
        return [];
    }

    return data || [];
}

/**
 * Get trade count for date range
 */
export async function getTradeCount(currency: string, startDate: Date, endDate: Date): Promise<number> {
    if (!isSupabaseConfigured || !supabase) return 0;

    const { count, error } = await supabase
        .from('trades')
        .select('*', { count: 'exact', head: true })
        .eq('currency', currency)
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString());

    if (error) {
        console.error('[DB] Count error:', error.message);
        return 0;
    }

    return count || 0;
}

/**
 * Get available expiry dates
 */
export async function getExpiryDates(currency: string): Promise<string[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    const { data, error } = await supabase
        .from('trades')
        .select('expiry_date')
        .eq('currency', currency)
        .order('expiry_date', { ascending: true });

    if (error) {
        console.error('[DB] Expiry query error:', error.message);
        return [];
    }

    // Get unique expiry dates
    const unique = [...new Set(data?.map(d => d.expiry_date) || [])];
    return unique;
}

/**
 * Convert WebSocket trade to DB format
 */
export function wsTradeToDbTrade(trade: any, currency: string): DbTrade {
    // Parse instrument name: BTC-28DEC24-95000-C
    const parts = trade.instrumentName.split('-');
    const expiryStr = parts[1]; // e.g., "28DEC24"
    const strike = parseFloat(parts[2]);
    const optionType = parts[3] === 'C' ? 'call' : 'put';

    // Parse expiry date
    const expiryDate = parseExpiryDate(expiryStr);

    return {
        trade_id: trade.tradeId,
        instrument_name: trade.instrumentName,
        currency: currency,
        option_type: optionType,
        direction: trade.direction,
        strike: strike,
        expiry_date: expiryDate,
        price: trade.price,
        price_usd: trade.price * trade.indexPrice,
        amount: trade.amount,
        iv: trade.iv || null,
        index_price: trade.indexPrice,
        timestamp: new Date(trade.timestamp).toISOString(),
    };
}

function parseExpiryDate(expiryStr: string): string {
    // Parse "28DEC24" format
    const months: Record<string, string> = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
    };

    const day = expiryStr.slice(0, 2);
    const month = months[expiryStr.slice(2, 5)];
    const year = '20' + expiryStr.slice(5, 7);

    return `${year}-${month}-${day}`;
}
