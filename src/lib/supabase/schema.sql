-- Supabase SQL Schema for Options Trades
-- Run this in Supabase SQL Editor (Settings → SQL Editor)

-- Main trades table
CREATE TABLE IF NOT EXISTS trades (
    id BIGSERIAL PRIMARY KEY,
    trade_id TEXT UNIQUE NOT NULL,
    instrument_name TEXT NOT NULL,
    currency TEXT NOT NULL,
    option_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    strike DECIMAL(20,2) NOT NULL,
    expiry_date DATE NOT NULL,
    price DECIMAL(20,10) NOT NULL,
    price_usd DECIMAL(20,2),
    amount DECIMAL(20,8) NOT NULL,
    iv DECIMAL(10,4),
    index_price DECIMAL(20,2),
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes (critical for fast queries with 1+ year of data)

-- Primary query patterns
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_currency_timestamp ON trades(currency, timestamp DESC);

-- Expiry queries
CREATE INDEX IF NOT EXISTS idx_trades_expiry ON trades(expiry_date);
CREATE INDEX IF NOT EXISTS idx_trades_currency_expiry ON trades(currency, expiry_date, timestamp DESC);

-- Strike queries for heatmaps
CREATE INDEX IF NOT EXISTS idx_trades_currency_strike ON trades(currency, strike);

-- Direction/Type filters
CREATE INDEX IF NOT EXISTS idx_trades_direction ON trades(direction);
CREATE INDEX IF NOT EXISTS idx_trades_option_type ON trades(option_type);

-- Composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_trades_full_filter ON trades(currency, timestamp DESC, direction, option_type);

-- Enable Row Level Security (optional, for multi-user)
-- ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Grant access to anon users (required for public access)
GRANT SELECT, INSERT ON trades TO anon;
GRANT USAGE, SELECT ON SEQUENCE trades_id_seq TO anon;
