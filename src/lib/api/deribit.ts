// Deribit API Service for fetching real crypto options data
// Uses Next.js API route to bypass CORS

export interface DeribitInstrument {
    instrument_name: string;
    kind: 'option' | 'future';
    option_type?: 'call' | 'put';
    strike?: number;
    expiration_timestamp: number;
    creation_timestamp: number;
    base_currency: string;
    quote_currency: string;
    is_active: boolean;
}

export interface DeribitTicker {
    instrument_name: string;
    mark_price: number;
    best_bid_price: number;
    best_ask_price: number;
    last_price: number;
    open_interest: number;
    volume_24h: number;
    greeks?: {
        delta: number;
        gamma: number;
        theta: number;
        vega: number;
        rho: number;
    };
    mark_iv?: number;
    underlying_price?: number;
    timestamp: number;
}

export interface DeribitTrade {
    trade_id: string;
    instrument_name: string;
    direction: 'buy' | 'sell';
    price: number;
    amount: number;
    timestamp: number;
    iv?: number;
    index_price?: number;
    tick_direction: number;
    liquidation?: string;
    block_trade_id?: string;
}

export interface HistoricalDataPoint {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

class DeribitService {
    private cache: Map<string, { data: unknown; timestamp: number }> = new Map();
    private cacheDuration = 30000; // 30 seconds

    private async fetchViaProxy<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
        // Build URL for our Next.js API route
        const url = new URL('/api/deribit', typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
        url.searchParams.append('endpoint', endpoint);

        if (params) {
            Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
        }

        const cacheKey = url.toString();
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
            return cached.data as T;
        }

        try {
            const response = await fetch(url.toString());

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `API error: ${response.status}`);
            }

            const data = await response.json();
            this.cache.set(cacheKey, { data, timestamp: Date.now() });
            return data as T;
        } catch (error) {
            console.error('Deribit API fetch error:', error);
            throw error;
        }
    }

    // Get all option instruments for a currency
    async getInstruments(currency: string = 'BTC', kind: string = 'option'): Promise<DeribitInstrument[]> {
        return this.fetchViaProxy<DeribitInstrument[]>('/public/get_instruments', {
            currency,
            kind,
            expired: 'false',
        });
    }

    // Get ticker for a specific instrument
    async getTicker(instrumentName: string): Promise<DeribitTicker> {
        return this.fetchViaProxy<DeribitTicker>('/public/ticker', {
            instrument_name: instrumentName,
        });
    }

    // Get multiple tickers at once
    async getAllTickers(currency: string = 'BTC'): Promise<DeribitTicker[]> {
        return this.fetchViaProxy<DeribitTicker[]>('/public/get_book_summary_by_currency', {
            currency,
            kind: 'option',
        });
    }

    // Get index price for underlying
    async getIndexPrice(currency: string = 'BTC'): Promise<{ index_price: number; estimated_delivery_price: number }> {
        return this.fetchViaProxy('/public/get_index_price', {
            index_name: `${currency.toLowerCase()}_usd`,
        });
    }

    // Get historical trades for an instrument
    async getTrades(
        instrumentName: string,
        count: number = 100,
        startTimestamp?: number,
        endTimestamp?: number
    ): Promise<{ trades: DeribitTrade[]; has_more: boolean }> {
        const params: Record<string, string> = {
            instrument_name: instrumentName,
            count: count.toString(),
            sorting: 'desc',
        };

        if (startTimestamp) {
            params.start_timestamp = startTimestamp.toString();
        }
        if (endTimestamp) {
            params.end_timestamp = endTimestamp.toString();
        }

        return this.fetchViaProxy('/public/get_last_trades_by_instrument', params);
    }

    // Get historical trades by currency (all instruments)
    async getTradesByCurrency(
        currency: string = 'BTC',
        kind: string = 'option',
        count: number = 100,
        startTimestamp?: number,
        endTimestamp?: number
    ): Promise<{ trades: DeribitTrade[]; has_more: boolean }> {
        const params: Record<string, string> = {
            currency,
            kind,
            count: count.toString(),
            sorting: 'desc',
        };

        if (startTimestamp) {
            params.start_timestamp = startTimestamp.toString();
        }
        if (endTimestamp) {
            params.end_timestamp = endTimestamp.toString();
        }

        return this.fetchViaProxy('/public/get_last_trades_by_currency', params);
    }

    // Get OHLCV candlestick data
    async getOHLCV(
        instrumentName: string,
        resolution: string = '1D',
        startTimestamp: number,
        endTimestamp: number
    ): Promise<HistoricalDataPoint[]> {
        const data = await this.fetchViaProxy<{
            ticks: number[];
            open: number[];
            high: number[];
            low: number[];
            close: number[];
            volume: number[];
        }>('/public/get_tradingview_chart_data', {
            instrument_name: instrumentName,
            resolution,
            start_timestamp: startTimestamp.toString(),
            end_timestamp: endTimestamp.toString(),
        });

        return data.ticks.map((timestamp, i) => ({
            timestamp,
            open: data.open[i],
            high: data.high[i],
            low: data.low[i],
            close: data.close[i],
            volume: data.volume[i],
        }));
    }

    // Get volatility index
    async getVolatilityIndex(currency: string = 'BTC'): Promise<{ volatility: number; timestamp: number }> {
        return this.fetchViaProxy('/public/get_volatility_index_data', {
            currency,
            resolution: '1',
        });
    }

    // Helper to parse instrument name
    parseInstrumentName(name: string): {
        currency: string;
        expiry: string;
        strike: number;
        type: 'call' | 'put';
    } | null {
        // Format: BTC-27DEC24-95000-C
        const match = name.match(/^(\w+)-(\d+\w+\d+)-(\d+)-([CP])$/);
        if (!match) return null;

        return {
            currency: match[1],
            expiry: match[2],
            strike: parseInt(match[3]),
            type: match[4] === 'C' ? 'call' : 'put',
        };
    }

    // Helper to get expiry dates
    async getExpiryDates(currency: string = 'BTC'): Promise<string[]> {
        const instruments = await this.getInstruments(currency);
        const expiries = new Set<string>();

        instruments.forEach((inst) => {
            const parsed = this.parseInstrumentName(inst.instrument_name);
            if (parsed) {
                expiries.add(parsed.expiry);
            }
        });

        return Array.from(expiries).sort();
    }

    // Get option chain for specific expiry
    async getOptionChain(currency: string = 'BTC', expiry: string): Promise<{
        strikes: number[];
        calls: Map<number, DeribitTicker>;
        puts: Map<number, DeribitTicker>;
        underlyingPrice: number;
    }> {
        const [tickers, indexData] = await Promise.all([
            this.getAllTickers(currency),
            this.getIndexPrice(currency),
        ]);

        const calls = new Map<number, DeribitTicker>();
        const puts = new Map<number, DeribitTicker>();
        const strikes = new Set<number>();

        tickers.forEach((ticker) => {
            const parsed = this.parseInstrumentName(ticker.instrument_name);
            if (parsed && parsed.expiry === expiry) {
                strikes.add(parsed.strike);
                if (parsed.type === 'call') {
                    calls.set(parsed.strike, ticker);
                } else {
                    puts.set(parsed.strike, ticker);
                }
            }
        });

        return {
            strikes: Array.from(strikes).sort((a, b) => a - b),
            calls,
            puts,
            underlyingPrice: indexData.index_price,
        };
    }
}

// Export singleton instance
export const deribitService = new DeribitService();

export default DeribitService;
