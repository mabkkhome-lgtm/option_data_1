'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    RefreshCw,
    Download,
    ArrowUpDown,
    Calendar,
    ChevronDown,
    ChevronUp,
    Zap,
    Target,
    TrendingUp,
} from 'lucide-react';
import { deribitService } from '@/lib/api/deribit';
import { useTradesSelectionStore } from '@/stores/tradesSelection';
import { queryTrades } from '@/lib/supabase/trades';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
    detectStrategies,
    isBlockTrade,
    getStrategyColor,
    type DetectedStrategy,
    type TradeForDetection
} from '@/lib/strategy/detector';

export interface ScreenerRow {
    id: string;
    instrumentName: string;
    type: 'call' | 'put';
    expiry: string;
    expiryDate: Date;
    strike: number;
    direction: 'buy' | 'sell';
    size: number;
    price: number;      // In BTC terms
    priceUSD: number;   // In USD
    iv?: number;
    indexPrice?: number;
    timestamp: Date;
    blockTradeId?: string;
    underlying?: number;
    openInterest?: number;  // Open Interest for this instrument
    // Strategy detection
    strategyId?: string;
    strategyName?: string;
    strategyColor?: string;
    isBlockTrade?: boolean;
}

type SortField = 'timestamp' | 'size' | 'price' | 'strike' | 'iv' | 'expiry' | 'priceUSD' | 'openInterest';
type SortDirection = 'asc' | 'desc';

// Parse expiry string to Date
function parseExpiryDate(expiry: string): Date {
    const match = expiry.match(/^(\d+)([A-Z]+)(\d+)$/);
    if (!match) return new Date(0);

    const day = parseInt(match[1]);
    const monthStr = match[2];
    const year = 2000 + parseInt(match[3]);

    const months: Record<string, number> = {
        JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
        JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
    };

    return new Date(year, months[monthStr] || 0, day);
}

// Format expiry for display
function formatExpiry(expiry: string): string {
    const match = expiry.match(/^(\d+)([A-Z]+)(\d+)$/);
    if (!match) return expiry;
    return `${match[1]} ${match[2].charAt(0)}${match[2].slice(1).toLowerCase()}`;
}

// Time preset options
const TIME_PRESETS = [
    { label: 'Today', hours: -1 }, // Special: midnight today
    { label: '1H', hours: 1 },
    { label: '6H', hours: 6 },
    { label: '1D', hours: 24 },
    { label: '7D', hours: 168 },
];

interface MarketScreenerProps {
    widgetId: string;
}

export function MarketScreenerWidget({ widgetId }: MarketScreenerProps) {
    const [isMounted, setIsMounted] = useState(false);
    const [trades, setTrades] = useState<ScreenerRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currency, setCurrency] = useState('BTC');
    const [sortField, setSortField] = useState<SortField>('timestamp');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [activePreset, setActivePreset] = useState('Today');

    // Date range - default to midnight today until now
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0); // Set to midnight today
        return d;
    });
    const [endDate, setEndDate] = useState(() => new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);

    // Filters
    const [typeFilter, setTypeFilter] = useState<'all' | 'call' | 'put'>('all');
    const [sideFilter, setSideFilter] = useState({ long: true, short: true });
    const [minSize, setMinSize] = useState(0);
    const [expiryFilter, setExpiryFilter] = useState<string[]>([]);
    const [strategyFilter, setStrategyFilter] = useState<'all' | 'strategies' | 'blocks'>('all');

    // Detected strategies
    const [detectedStrategies, setDetectedStrategies] = useState<DetectedStrategy[]>([]);

    // Source label for multi-screener connections (like Thales Long/Short)
    // Uses widgetId as sourceId so connections route data correctly
    const [sourceLabel, setSourceLabel] = useState('Longs');
    const labelColors: Record<string, string> = {
        'Longs': '#22c55e',
        'Shorts': '#ef4444',
        'Buyers': '#3b82f6',
        'Sellers': '#f59e0b',
        'Custom': '#8b5cf6',
    };

    // Selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const { setSourceTrades } = useTradesSelectionStore();

    useEffect(() => {
        setIsMounted(true);

        // Load saved filters from localStorage
        try {
            const saved = localStorage.getItem('market-screener-filters');
            if (saved) {
                const filters = JSON.parse(saved);
                if (filters.currency) setCurrency(filters.currency);
                if (filters.typeFilter) setTypeFilter(filters.typeFilter);
                if (filters.sideFilter) setSideFilter(filters.sideFilter);
                if (typeof filters.minSize === 'number') setMinSize(filters.minSize);
                if (filters.strategyFilter) setStrategyFilter(filters.strategyFilter);
                if (filters.sourceLabel) setSourceLabel(filters.sourceLabel);
            }
        } catch (e) {
            console.warn('[MarketScreener] Failed to load saved filters:', e);
        }
    }, []);

    // Save filters to localStorage when they change
    useEffect(() => {
        if (!isMounted) return;
        try {
            localStorage.setItem('market-screener-filters', JSON.stringify({
                currency,
                typeFilter,
                sideFilter,
                minSize,
                strategyFilter,
                sourceLabel,
            }));
        } catch (e) {
            console.warn('[MarketScreener] Failed to save filters:', e);
        }
    }, [isMounted, currency, typeFilter, sideFilter, minSize, strategyFilter, sourceLabel]);

    // Track if we've set default expiry
    const [hasSetDefaultExpiry, setHasSetDefaultExpiry] = useState(false);

    // Format date for datetime-local input
    const formatDateForInput = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    // Fetch trades and detect strategies
    const fetchTrades = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const startTimestamp = startDate.getTime();
            const endTimestamp = endDate.getTime();

            // Try Deribit API first - fetch ALL trades (no limit), paginate until done
            let apiTrades: any[] = [];
            try {
                // Fetch all pages - no limit
                let hasMore = true;
                let lastTimestamp = endTimestamp;
                let pageCount = 0;

                while (hasMore) {
                    pageCount++;
                    const result = await deribitService.getTradesByCurrency(
                        currency,
                        'option',
                        1000, // Max per API call
                        startTimestamp,
                        lastTimestamp
                    );

                    if (result?.trades && result.trades.length > 0) {
                        apiTrades = [...apiTrades, ...result.trades];
                        // Get timestamp of oldest trade for next page
                        const oldestTimestamp = result.trades[result.trades.length - 1].timestamp;

                        // Stop if we've reached trades before our start date
                        if (oldestTimestamp <= startTimestamp) {
                            hasMore = false;
                        } else {
                            lastTimestamp = oldestTimestamp - 1;
                            // Continue only if API indicates more data AND we got a full page
                            hasMore = result.has_more && result.trades.length === 1000;
                        }
                    } else {
                        hasMore = false;
                    }
                }
                console.log(`[MarketScreener] Fetched ${apiTrades.length} trades from API in ${pageCount} calls`);
            } catch (apiErr) {
                console.warn('[MarketScreener] Deribit API error, trying database:', apiErr);
            }

            // Also query Supabase for historical data
            let dbTrades: any[] = [];
            if (isSupabaseConfigured) {
                try {
                    const dbResult = await queryTrades({
                        currency: currency as 'BTC' | 'ETH',
                        startDate: startDate,
                        endDate: endDate,
                        limit: 10000, // Get as many historical trades as possible
                    });
                    dbTrades = dbResult.map(t => ({
                        trade_id: t.trade_id,
                        instrument_name: t.instrument_name,
                        direction: t.direction,
                        amount: parseFloat(String(t.amount)),
                        price: parseFloat(String(t.price)),
                        iv: t.iv ? parseFloat(String(t.iv)) : null,
                        index_price: t.index_price ? parseFloat(String(t.index_price)) : null,
                        timestamp: new Date(t.timestamp).getTime(),
                        block_trade_id: null,
                    }));
                } catch (dbErr) {
                    console.warn('[MarketScreener] Supabase query error:', dbErr);
                }
            }

            // Combine and deduplicate by trade_id
            const allTrades = [...apiTrades, ...dbTrades];
            const uniqueTradesMap = new Map();
            allTrades.forEach(t => {
                if (!uniqueTradesMap.has(t.trade_id)) {
                    uniqueTradesMap.set(t.trade_id, t);
                }
            });
            const combinedTrades = Array.from(uniqueTradesMap.values());

            console.log(`[MarketScreener] Found ${apiTrades.length} from API, ${dbTrades.length} from DB, ${combinedTrades.length} unique`);


            const rows: ScreenerRow[] = [];
            const tradesForDetection: TradeForDetection[] = [];

            if (combinedTrades.length > 0) {
                for (const trade of combinedTrades) {
                    const parsed = deribitService.parseInstrumentName(trade.instrument_name);
                    if (!parsed) continue;

                    const underlying = trade.index_price || 0;
                    const priceUSD = trade.price * underlying;
                    const isBlock = isBlockTrade({
                        id: trade.trade_id,
                        size: trade.amount,
                        timestamp: trade.timestamp,
                        type: parsed.type,
                        strike: parsed.strike,
                        expiry: parsed.expiry,
                        direction: trade.direction,
                        price: trade.price,
                    });

                    rows.push({
                        id: trade.trade_id,
                        instrumentName: trade.instrument_name,
                        type: parsed.type,
                        expiry: parsed.expiry,
                        expiryDate: parseExpiryDate(parsed.expiry),
                        strike: parsed.strike,
                        direction: trade.direction,
                        size: trade.amount,
                        price: trade.price,
                        priceUSD,
                        iv: trade.iv,
                        indexPrice: trade.index_price,
                        underlying: trade.index_price,
                        timestamp: new Date(trade.timestamp),
                        blockTradeId: trade.block_trade_id,
                        isBlockTrade: isBlock,
                    });

                    tradesForDetection.push({
                        id: trade.trade_id,
                        timestamp: trade.timestamp,
                        type: parsed.type,
                        strike: parsed.strike,
                        expiry: parsed.expiry,
                        direction: trade.direction,
                        size: trade.amount,
                        price: trade.price,
                        underlying: trade.index_price,
                    });
                }
            }

            // Detect strategies
            const strategies = detectStrategies(tradesForDetection);
            setDetectedStrategies(strategies);

            // Annotate trades with strategy info
            const strategyLegIds = new Map<string, { id: string; name: string; color: string }>();
            strategies.forEach((strat, idx) => {
                const stratId = `strat-${idx}`;
                strat.legs.forEach(leg => {
                    strategyLegIds.set(leg.id, {
                        id: stratId,
                        name: strat.name,
                        color: getStrategyColor(strat.type),
                    });
                });
            });

            // Fetch Open Interest data for all instruments
            let oiMap = new Map<string, number>();
            try {
                const tickers = await deribitService.getAllTickers(currency);
                tickers.forEach(ticker => {
                    oiMap.set(ticker.instrument_name, ticker.open_interest);
                });
                console.log(`[MarketScreener] Fetched OI for ${oiMap.size} instruments`);
            } catch (oiErr) {
                console.warn('[MarketScreener] Failed to fetch OI data:', oiErr);
            }

            const annotatedRows = rows.map(row => {
                const stratInfo = strategyLegIds.get(row.id);
                const openInterest = oiMap.get(row.instrumentName);
                return {
                    ...row,
                    openInterest,
                    ...(stratInfo && {
                        strategyId: stratInfo.id,
                        strategyName: stratInfo.name,
                        strategyColor: stratInfo.color,
                    }),
                };
            });

            setTrades(annotatedRows);
            setSelectedIds(new Set(annotatedRows.map(r => r.id)));
        } catch (err) {
            console.error('[MarketScreener] Failed to fetch trades:', err);
            setError('Failed to fetch data');
        }

        setIsLoading(false);
    }, [currency, startDate, endDate]);

    useEffect(() => {
        if (isMounted) {
            fetchTrades();
        }
    }, [isMounted, fetchTrades]);

    // Get unique expiries sorted by date
    const availableExpiries = useMemo(() => {
        const expiryMap = new Map<string, Date>();
        trades.forEach(t => {
            if (!expiryMap.has(t.expiry)) {
                expiryMap.set(t.expiry, t.expiryDate);
            }
        });
        return [...expiryMap.entries()]
            .sort((a, b) => a[1].getTime() - b[1].getTime())
            .map(e => e[0]);
    }, [trades]);

    // Auto-select tomorrow's expiry as default on first load
    useEffect(() => {
        if (hasSetDefaultExpiry || availableExpiries.length === 0) return;

        // Find tomorrow's date range
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        // Find the first expiry that's tomorrow or later
        const tomorrowExpiry = availableExpiries.find(exp => {
            const expDate = parseExpiryDate(exp);
            return expDate.getTime() >= tomorrow.getTime();
        });

        if (tomorrowExpiry) {
            setExpiryFilter([tomorrowExpiry]);
            setHasSetDefaultExpiry(true);
        }
    }, [availableExpiries, hasSetDefaultExpiry]);
    // Apply filters
    const filteredTrades = useMemo(() => {
        return trades.filter((trade) => {
            if (typeFilter !== 'all' && trade.type !== typeFilter) return false;
            if (!sideFilter.long && trade.direction === 'buy') return false;
            if (!sideFilter.short && trade.direction === 'sell') return false;
            if (minSize > 0 && trade.size < minSize) return false;
            if (expiryFilter.length > 0 && !expiryFilter.includes(trade.expiry)) return false;
            if (strategyFilter === 'strategies' && !trade.strategyName) return false;
            if (strategyFilter === 'blocks' && !trade.isBlockTrade) return false;
            return true;
        });
    }, [trades, typeFilter, sideFilter, minSize, expiryFilter, strategyFilter]);

    // Apply sorting
    const sortedTrades = useMemo(() => {
        return [...filteredTrades].sort((a, b) => {
            let comparison = 0;
            switch (sortField) {
                case 'timestamp':
                    comparison = a.timestamp.getTime() - b.timestamp.getTime();
                    break;
                case 'size':
                    comparison = a.size - b.size;
                    break;
                case 'price':
                    comparison = a.price - b.price;
                    break;
                case 'priceUSD':
                    comparison = a.priceUSD - b.priceUSD;
                    break;
                case 'strike':
                    comparison = a.strike - b.strike;
                    break;
                case 'iv':
                    comparison = (a.iv || 0) - (b.iv || 0);
                    break;
                case 'expiry':
                    comparison = a.expiryDate.getTime() - b.expiryDate.getTime();
                    break;
                case 'openInterest':
                    comparison = (a.openInterest || 0) - (b.openInterest || 0);
                    break;
            }
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }, [filteredTrades, sortField, sortDirection]);

    // Send FILTERED and SELECTED trades to visualizers
    // This ensures screener filters affect what the visualizers display
    useEffect(() => {
        // Only send trades that are both filtered AND selected
        const tradesForVisualizer = filteredTrades.filter(t => selectedIds.has(t.id));
        setSourceTrades(widgetId, sourceLabel, tradesForVisualizer, labelColors[sourceLabel]);
    }, [selectedIds, filteredTrades, setSourceTrades, widgetId, sourceLabel]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === sortedTrades.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(sortedTrades.map(t => t.id)));
        }
    };

    const setTimePreset = (preset: { label: string; hours: number }) => {
        const end = new Date();
        let start: Date;

        if (preset.hours === -1) {
            // Special case: "Today" preset - from midnight today
            start = new Date();
            start.setHours(0, 0, 0, 0);
        } else {
            start = new Date(end.getTime() - preset.hours * 60 * 60 * 1000);
        }

        setStartDate(start);
        setEndDate(end);
        setActivePreset(preset.label);
    };

    const exportCSV = () => {
        const headers = ['Timestamp', 'Instrument', 'Type', 'Direction', 'Size', 'Price', 'PriceUSD', 'IV', 'Strategy'];
        const rows = sortedTrades.map((t) => [
            t.timestamp.toISOString(),
            t.instrumentName,
            t.type,
            t.direction,
            t.size.toFixed(2),
            t.price.toFixed(6),
            t.priceUSD.toFixed(2),
            t.iv?.toFixed(1) || '',
            t.strategyName || '',
        ]);
        const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `option_trades_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    // Stats - Thales-style summary
    const selectedTrades = filteredTrades.filter(t => selectedIds.has(t.id));
    const selectedCount = selectedIds.size;
    const blockTradeCount = trades.filter(t => t.isBlockTrade).length;
    const strategyCount = detectedStrategies.length;

    // Calculate Thales-style summary stats from selected trades
    const summaryStats = useMemo(() => {
        const selected = filteredTrades.filter(t => selectedIds.has(t.id));

        // Count positions by asset (BTC, ETH, etc.)
        const assetCounts: Record<string, number> = {};
        selected.forEach(t => {
            const asset = t.instrumentName.split('-')[0]; // BTC, ETH, SOL
            assetCounts[asset] = (assetCounts[asset] || 0) + 1;
        });

        // Total size (contracts)
        const totalSize = selected.reduce((sum, t) => sum + t.size, 0);

        // Total entry value (premium × size in USD)
        const totalEntryValue = selected.reduce((sum, t) => sum + (t.priceUSD * t.size), 0);

        // Separate longs (buys) and shorts (sells)
        const longSize = selected.filter(t => t.direction === 'buy').reduce((sum, t) => sum + t.size, 0);
        const shortSize = selected.filter(t => t.direction === 'sell').reduce((sum, t) => sum + t.size, 0);

        return { assetCounts, totalSize, totalEntryValue, longSize, shortSize };
    }, [filteredTrades, selectedIds]);

    const formatDate = (date: Date) => date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const formatTime = (date: Date) => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const formatPrice = (n: number) => {
        if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
        return `$${n.toFixed(0)}`;
    };
    const formatStrike = (n: number) => {
        if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
        return n.toString();
    };

    return (
        <div className="h-full flex flex-col text-xs bg-background-widget overflow-hidden">
            {/* Header Row 1 */}
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border-color bg-background-secondary/30 flex-wrap">
                <select
                    className="bg-background-tertiary text-foreground text-xs px-2 py-1 rounded border border-border-color font-medium"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                >
                    <option value="BTC">BTC</option>
                    <option value="ETH">ETH</option>
                    <option value="SOL">SOL</option>
                </select>

                {/* Source Label Selector - for multi-screener connections */}
                <div className="flex items-center gap-1">
                    <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: labelColors[sourceLabel] }}
                    />
                    <select
                        className="bg-background-tertiary text-foreground text-xs px-2 py-1 rounded border border-border-color"
                        value={sourceLabel}
                        onChange={(e) => setSourceLabel(e.target.value)}
                        style={{ borderColor: labelColors[sourceLabel] }}
                    >
                        <option value="Longs">📈 Longs</option>
                        <option value="Shorts">📉 Shorts</option>
                        <option value="Buyers">🟢 Buyers</option>
                        <option value="Sellers">🔴 Sellers</option>
                        <option value="Custom">🔮 Custom</option>
                    </select>
                </div>

                {/* Time presets */}
                <div className="flex gap-0.5 bg-background-tertiary rounded p-0.5">
                    {TIME_PRESETS.map(preset => (
                        <button
                            key={preset.label}
                            onClick={() => setTimePreset(preset)}
                            className={`px-2 py-0.5 text-xs rounded transition-all ${activePreset === preset.label
                                ? 'bg-accent-primary text-black font-bold'
                                : 'text-foreground-muted hover:bg-background-secondary'
                                }`}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>

                {/* Date picker toggle */}
                <button
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className="flex items-center gap-1 px-2 py-1 bg-background-tertiary hover:bg-background-secondary rounded border border-border-color text-xs"
                >
                    <Calendar size={12} />
                    <span>{formatDate(startDate)} - {formatDate(endDate)}</span>
                    {showDatePicker ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                <button
                    onClick={fetchTrades}
                    disabled={isLoading}
                    className="px-3 py-1 bg-accent-primary text-black text-xs font-bold rounded hover:bg-accent-primary/80 disabled:opacity-50 flex items-center gap-1"
                >
                    {isLoading ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Fetch
                </button>

                <div className="flex-1" />

                {/* Thales-style Summary Stats */}
                <div className="flex gap-4 text-xs">
                    {/* Position Count */}
                    <div className="text-center" title="Total number of positions">
                        <div className="text-foreground-muted text-[10px]">Position Count</div>
                        <div className="font-mono font-bold text-white text-sm">{selectedCount}</div>
                    </div>

                    {/* Total Size */}
                    <div className="text-center" title="Total contract size">
                        <div className="text-foreground-muted text-[10px]">Total Size</div>
                        <div className="font-mono font-bold text-white text-sm">{Math.round(summaryStats.totalSize).toLocaleString()}</div>
                    </div>

                    {/* Total Entry Value */}
                    <div className="text-center" title="Total entry value (premium paid)">
                        <div className="text-foreground-muted text-[10px]">Total Entry Value</div>
                        <div className="font-mono font-bold text-white text-sm">
                            {summaryStats.totalEntryValue >= 1000000
                                ? `${(summaryStats.totalEntryValue / 1000000).toFixed(1)}M`
                                : summaryStats.totalEntryValue >= 1000
                                    ? `${(summaryStats.totalEntryValue / 1000).toFixed(0)}K`
                                    : summaryStats.totalEntryValue.toFixed(0)}
                        </div>
                    </div>

                    <div className="w-px h-8 bg-border-color" />

                    {/* Strategies */}
                    <div className="text-center" title="Detected strategies">
                        <div className="text-foreground-muted text-[10px] flex items-center gap-0.5">
                            <Target size={10} /> Strats
                        </div>
                        <div className="font-mono font-bold text-purple-400">{strategyCount}</div>
                    </div>

                    {/* Blocks */}
                    <div className="text-center" title="Block trades (≥10)">
                        <div className="text-foreground-muted text-[10px] flex items-center gap-0.5">
                            <Zap size={10} /> Blocks
                        </div>
                        <div className="font-mono font-bold text-orange-400">{blockTradeCount}</div>
                    </div>
                </div>

                <button onClick={exportCSV} className="p-1.5 hover:bg-background-tertiary rounded" title="Export CSV">
                    <Download size={14} />
                </button>
            </div>

            {/* Expanded date picker */}
            {showDatePicker && (
                <div className="px-2 py-2 border-b border-border-color bg-background-tertiary/50 flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <label className="text-foreground-muted text-xs">From:</label>
                        <input
                            type="datetime-local"
                            value={formatDateForInput(startDate)}
                            onChange={(e) => {
                                const date = new Date(e.target.value);
                                if (!isNaN(date.getTime())) {
                                    setStartDate(date);
                                    setActivePreset('');
                                }
                            }}
                            className="bg-background-secondary text-foreground text-xs px-2 py-1 rounded border border-border-color"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-foreground-muted text-xs">To:</label>
                        <input
                            type="datetime-local"
                            value={formatDateForInput(endDate)}
                            onChange={(e) => {
                                const date = new Date(e.target.value);
                                if (!isNaN(date.getTime())) {
                                    setEndDate(date);
                                    setActivePreset('');
                                }
                            }}
                            className="bg-background-secondary text-foreground text-xs px-2 py-1 rounded border border-border-color"
                        />
                    </div>
                    <button
                        onClick={() => setEndDate(new Date())}
                        className="px-2 py-1 bg-background-secondary text-foreground-muted text-xs rounded hover:bg-background-tertiary"
                    >
                        Now
                    </button>
                </div>
            )}

            {/* Filter Row */}
            <div className="flex items-center gap-2 px-2 py-1 border-b border-border-color bg-background-tertiary/30 flex-wrap">
                <span className="text-foreground-muted font-mono">{sortedTrades.length} trades</span>

                <div className="w-px h-4 bg-border-color" />

                {/* Type Filter */}
                <div className="flex gap-0.5">
                    {(['all', 'call', 'put'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setTypeFilter(type)}
                            className={`px-2 py-0.5 text-xs rounded transition-all ${typeFilter === type
                                ? type === 'call' ? 'bg-green-500/20 text-green-400 font-medium'
                                    : type === 'put' ? 'bg-red-500/20 text-red-400 font-medium'
                                        : 'bg-background-secondary text-foreground font-medium'
                                : 'text-foreground-muted hover:bg-background-secondary'
                                }`}
                        >
                            {type === 'all' ? 'All' : type === 'call' ? 'Call' : 'Put'}
                        </button>
                    ))}
                </div>

                <div className="w-px h-4 bg-border-color" />

                {/* Side Filter */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setSideFilter(f => ({ ...f, long: !f.long }))}
                        className={`px-2 py-0.5 text-xs rounded ${sideFilter.long ? 'bg-green-500/20 text-green-400' : 'text-foreground-muted opacity-50'}`}
                    >
                        Long
                    </button>
                    <button
                        onClick={() => setSideFilter(f => ({ ...f, short: !f.short }))}
                        className={`px-2 py-0.5 text-xs rounded ${sideFilter.short ? 'bg-red-500/20 text-red-400' : 'text-foreground-muted opacity-50'}`}
                    >
                        Short
                    </button>
                </div>

                <div className="w-px h-4 bg-border-color" />

                {/* Strategy Filter */}
                <div className="flex gap-0.5">
                    {(['all', 'strategies', 'blocks'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setStrategyFilter(f)}
                            className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 ${strategyFilter === f
                                ? f === 'strategies' ? 'bg-purple-500/20 text-purple-400 font-medium'
                                    : f === 'blocks' ? 'bg-orange-500/20 text-orange-400 font-medium'
                                        : 'bg-background-secondary text-foreground font-medium'
                                : 'text-foreground-muted hover:bg-background-secondary'
                                }`}
                        >
                            {f === 'strategies' && <Target size={10} />}
                            {f === 'blocks' && <Zap size={10} />}
                            {f === 'all' ? 'All' : f === 'strategies' ? 'Strategies' : 'Blocks'}
                        </button>
                    ))}
                </div>

                {/* Expiry Filter */}
                {availableExpiries.length > 0 && (
                    <>
                        <div className="w-px h-4 bg-border-color" />
                        <select
                            value={expiryFilter.length === 0 ? 'all' : expiryFilter[0]}
                            onChange={(e) => setExpiryFilter(e.target.value === 'all' ? [] : [e.target.value])}
                            className="bg-background-secondary text-foreground text-xs px-2 py-0.5 rounded border border-border-color"
                        >
                            <option value="all">All Expiries</option>
                            {availableExpiries.map(exp => (
                                <option key={exp} value={exp}>{formatExpiry(exp)}</option>
                            ))}
                        </select>
                    </>
                )}

                {/* Min Size */}
                <div className="flex items-center gap-1">
                    <span className="text-foreground-muted">Min:</span>
                    <input
                        type="number"
                        value={minSize}
                        onChange={(e) => setMinSize(Number(e.target.value))}
                        className="bg-background-secondary text-foreground text-xs px-1.5 py-0.5 rounded border border-border-color w-12"
                        step="0.1"
                        min="0"
                    />
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1">
                    {error}
                </div>
            )}

            {/* Table */}
            <div
                className="flex-1 overflow-auto min-h-0"
                onWheel={(e) => e.stopPropagation()}
            >
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-background-secondary z-10">
                        <tr className="border-b border-border-color">
                            <th className="p-1.5 text-left w-6">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === sortedTrades.length && sortedTrades.length > 0}
                                    onChange={toggleSelectAll}
                                    className="accent-accent-primary w-3 h-3"
                                />
                            </th>
                            <th className="p-1.5 text-left text-foreground-muted">Type</th>
                            <th
                                className="p-1.5 text-left cursor-pointer hover:text-accent-primary group"
                                onClick={() => handleSort('expiry')}
                            >
                                <span className="flex items-center gap-1">
                                    Expiry
                                    <ArrowUpDown size={10} className="opacity-50 group-hover:opacity-100" />
                                </span>
                            </th>
                            <th
                                className="p-1.5 text-right cursor-pointer hover:text-accent-primary"
                                onClick={() => handleSort('strike')}
                            >
                                Strike
                            </th>
                            <th className="p-1.5 text-left">Side</th>
                            <th
                                className="p-1.5 text-right cursor-pointer hover:text-accent-primary"
                                onClick={() => handleSort('size')}
                            >
                                Size
                            </th>
                            <th
                                className="p-1.5 text-right cursor-pointer hover:text-accent-primary"
                                onClick={() => handleSort('priceUSD')}
                            >
                                Premium
                            </th>
                            <th
                                className="p-1.5 text-right cursor-pointer hover:text-accent-primary"
                                onClick={() => handleSort('iv')}
                            >
                                IV
                            </th>
                            <th
                                className="p-1.5 text-right cursor-pointer hover:text-accent-primary"
                                onClick={() => handleSort('openInterest')}
                                title="Open Interest"
                            >
                                OI
                            </th>
                            <th className="p-1.5 text-left">Strategy</th>
                            <th
                                className="p-1.5 text-left cursor-pointer hover:text-accent-primary"
                                onClick={() => handleSort('timestamp')}
                            >
                                Time
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedTrades.map((trade) => (
                            <tr
                                key={trade.id}
                                className={`border-b border-border-color/20 hover:bg-background-tertiary/50 cursor-pointer transition-colors ${selectedIds.has(trade.id) ? 'bg-accent-primary/5' : ''
                                    }`}
                                onClick={() => toggleSelect(trade.id)}
                                style={trade.strategyColor ? { borderLeftColor: trade.strategyColor, borderLeftWidth: '3px' } : {}}
                            >
                                <td className="p-1.5" onClick={(e) => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(trade.id)}
                                        onChange={() => toggleSelect(trade.id)}
                                        className="accent-accent-primary w-3 h-3"
                                    />
                                </td>
                                <td className="p-1.5">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${trade.type === 'call'
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-red-500/20 text-red-400'
                                        }`}>
                                        {trade.type === 'call' ? 'C' : 'P'}
                                    </span>
                                </td>
                                <td className="p-1.5 font-mono text-foreground-muted">{formatExpiry(trade.expiry)}</td>
                                <td className="p-1.5 text-right font-mono font-medium">{formatStrike(trade.strike)}</td>
                                <td className="p-1.5">
                                    <span className={`text-[10px] font-bold ${trade.direction === 'buy' ? 'text-green-400' : 'text-red-400'
                                        }`}>
                                        {trade.direction === 'buy' ? 'BUY' : 'SELL'}
                                    </span>
                                </td>
                                <td className="p-1.5 text-right font-mono">{trade.size.toFixed(1)}</td>
                                <td className="p-1.5 text-right font-mono">{formatPrice(trade.priceUSD)}</td>
                                <td className="p-1.5 text-right font-mono text-accent-primary font-medium">
                                    {trade.iv ? `${trade.iv.toFixed(0)}%` : '-'}
                                </td>
                                <td className="p-1.5 text-right font-mono text-cyan-400" title="Open Interest">
                                    {trade.openInterest ? trade.openInterest.toLocaleString() : '-'}
                                </td>
                                <td className="p-1.5">
                                    <div className="flex items-center gap-1">
                                        {trade.strategyName && (
                                            <span
                                                className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
                                                style={{ backgroundColor: trade.strategyColor }}
                                            >
                                                {trade.strategyName}
                                            </span>
                                        )}
                                        {trade.isBlockTrade && (
                                            <span className="px-1 py-0.5 rounded text-[9px] bg-orange-500/20 text-orange-400 flex items-center gap-0.5">
                                                <Zap size={8} /> Block
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="p-1.5 font-mono text-foreground-muted text-[10px]">
                                    {formatTime(trade.timestamp)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-2 py-1 border-t border-border-color text-[10px] text-foreground-muted bg-background-secondary/30">
                <span>{formatDate(startDate)} {formatTime(startDate)}</span>
                <div className="flex items-center gap-2">
                    <span className="font-mono">Total Size: {summaryStats.totalSize.toFixed(1)} {currency}</span>
                    <span>|</span>
                    <span>Deribit Options</span>
                </div>
                <span>{formatDate(endDate)} {formatTime(endDate)}</span>
            </div>
        </div>
    );
}
