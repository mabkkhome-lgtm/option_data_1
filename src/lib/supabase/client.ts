import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Client
 * 
 * Initialize with environment variables.
 * Will gracefully handle missing credentials.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Check if Supabase is configured
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Create client (or null if not configured)
export const supabase = isSupabaseConfigured
    ? createClient(supabaseUrl!, supabaseAnonKey!)
    : null;

// Database types
export interface DbTrade {
    id?: number;
    trade_id: string;
    instrument_name: string;
    currency: string;
    option_type: string;
    direction: string;
    strike: number;
    expiry_date: string;
    price: number;
    price_usd: number | null;
    amount: number;
    iv: number | null;
    index_price: number | null;
    timestamp: string;
    created_at?: string;
}

export interface TradeQueryFilters {
    currency?: 'BTC' | 'ETH';
    startDate?: Date;
    endDate?: Date;
    expiryDate?: string;
    minSize?: number;
    direction?: 'buy' | 'sell';
    optionType?: 'call' | 'put';
    limit?: number;
}
