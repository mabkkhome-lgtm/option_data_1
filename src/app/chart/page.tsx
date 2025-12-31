'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import {
    ArrowLeft,
    TrendingUp,
    TrendingDown,
    Activity,
    RefreshCw,
    Clock,
    Zap
} from 'lucide-react';

// TradingView Widget Types
declare global {
    interface Window {
        TradingView: any;
    }
}

interface MarketLevel {
    id: number;
    timestamp: string;
    expiry_date: string;
    current_price: number;
    gamma_high_price: number;
    gamma_low_price: number;
    support_price: number;
    resistance_price: number;
}

export default function ChartPage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [widget, setWidget] = useState<any>(null);
    const [symbol, setSymbol] = useState('BINANCE:BTCUSDT');
    const [interval, setInterval] = useState('15');
    const [levels, setLevels] = useState<MarketLevel | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    // Fetch latest market levels from Supabase
    const fetchLevels = useCallback(async () => {
        if (!supabase) return;

        try {
            const { data, error } = await supabase
                .from('market_levels')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(1);

            if (error) throw error;
            if (data && data.length > 0) {
                setLevels(data[0]);
                setLastUpdate(new Date());
            }
        } catch (err) {
            console.error('Failed to fetch levels:', err);
        }
    }, []);

    // Initialize TradingView Widget
    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://s3.tradingview.com/tv.js';
        script.async = true;
        script.onload = () => {
            if (containerRef.current && window.TradingView) {
                const tvWidget = new window.TradingView.widget({
                    autosize: true,
                    symbol: symbol,
                    interval: interval,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    theme: 'dark',
                    style: '1',
                    locale: 'en',
                    toolbar_bg: '#0d1117',
                    enable_publishing: false,
                    allow_symbol_change: true,
                    container_id: 'tradingview_chart',
                    hide_side_toolbar: false,
                    studies: [
                        'MASimple@tv-basicstudies',
                        'RSI@tv-basicstudies',
                        'MACD@tv-basicstudies',
                        'BB@tv-basicstudies'
                    ],
                    drawings_access: {
                        type: 'all',
                        tools: [{ name: 'Regression Trend' }]
                    },
                    saved_data: null,
                    withdateranges: true,
                    hide_top_toolbar: false,
                    details: true,
                    hotlist: true,
                    calendar: true,
                    show_popup_button: true,
                    popup_width: '1000',
                    popup_height: '650',
                    watchlist: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'NASDAQ:AAPL', 'NASDAQ:TSLA', 'NASDAQ:NVDA', 'FOREXCOM:EURUSD', 'COMEX:GC1!'],
                    overrides: {
                        "paneProperties.background": "#0d1117",
                        "paneProperties.backgroundType": "solid",
                        "mainSeriesProperties.candleStyle.upColor": "#22c55e",
                        "mainSeriesProperties.candleStyle.downColor": "#ef4444",
                        "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
                        "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
                    }
                });
                setWidget(tvWidget);
            }
            setLoading(false);
        };
        document.head.appendChild(script);

        return () => {
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
        };
    }, []);

    // Fetch levels on mount and set up polling
    useEffect(() => {
        fetchLevels();
        const pollInterval = window.setInterval(fetchLevels, 5000);
        return () => window.clearInterval(pollInterval);
    }, [fetchLevels]);

    // Format price
    const formatPrice = (price: number | null | undefined) => {
        if (price === null || price === undefined) return '-';
        return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    };

    // Format time ago
    const formatTimeAgo = (date: Date | null) => {
        if (!date) return '-';
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m ago`;
    };

    return (
        <div className="h-screen w-screen flex flex-col bg-[#0d1117] text-white overflow-hidden">
            {/* Top Navigation Bar */}
            <header className="h-12 border-b border-[#30363d] bg-[#161b22] flex items-center px-4 gap-4 shrink-0">
                <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
                    <ArrowLeft size={18} />
                    <span className="text-sm">Dashboard</span>
                </Link>

                <div className="w-px h-6 bg-[#30363d]" />

                <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                    Advanced Chart
                </h1>

                <div className="flex-1" />

                {/* Live Price from Levels */}
                {levels && (
                    <div className="flex items-center gap-2 text-sm">
                        <Activity size={14} className="text-cyan-400 animate-pulse" />
                        <span className="text-gray-400">BTC:</span>
                        <span className="font-mono font-bold text-white">
                            {formatPrice(levels.current_price)}
                        </span>
                    </div>
                )}

                <div className="w-px h-6 bg-[#30363d]" />

                {/* Last Update */}
                <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock size={12} />
                    <span>{formatTimeAgo(lastUpdate)}</span>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Chart Area (TradingView) */}
                <div className="flex-1 relative">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] z-10">
                            <div className="flex flex-col items-center gap-4">
                                <RefreshCw size={32} className="text-cyan-400 animate-spin" />
                                <span className="text-gray-400">Loading TradingView...</span>
                            </div>
                        </div>
                    )}
                    <div id="tradingview_chart" ref={containerRef} className="w-full h-full" />
                </div>

                {/* Right Sidebar - Market Levels Indicator */}
                <div className="w-72 border-l border-[#30363d] bg-[#161b22] flex flex-col shrink-0">
                    {/* Indicator Header */}
                    <div className="p-3 border-b border-[#30363d]">
                        <div className="flex items-center gap-2">
                            <Zap size={16} className="text-yellow-400" />
                            <span className="font-bold text-sm">Options Flow Indicator</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">
                            Support/Resistance from Options Greeks
                        </p>
                    </div>

                    {/* Levels Display */}
                    <div className="p-3 space-y-4">
                        {levels ? (
                            <>
                                {/* Support Level */}
                                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendingUp size={14} className="text-green-400" />
                                        <span className="text-xs text-green-400 font-medium">SUPPORT</span>
                                    </div>
                                    <div className="text-2xl font-bold font-mono text-green-400">
                                        {formatPrice(levels.support_price)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-1">
                                        Buyer/Seller Delta Cross (Left)
                                    </div>
                                </div>

                                {/* Resistance Level */}
                                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendingDown size={14} className="text-red-400" />
                                        <span className="text-xs text-red-400 font-medium">RESISTANCE</span>
                                    </div>
                                    <div className="text-2xl font-bold font-mono text-red-400">
                                        {formatPrice(levels.resistance_price)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-1">
                                        Buyer/Seller Delta Cross (Right)
                                    </div>
                                </div>

                                {/* Gamma High */}
                                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Activity size={14} className="text-purple-400" />
                                        <span className="text-xs text-purple-400 font-medium">GAMMA HIGH</span>
                                    </div>
                                    <div className="text-2xl font-bold font-mono text-purple-400">
                                        {formatPrice(levels.gamma_high_price)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-1">
                                        Max Buyer Gamma Exposure
                                    </div>
                                </div>

                                {/* Gamma Low */}
                                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Activity size={14} className="text-orange-400" />
                                        <span className="text-xs text-orange-400 font-medium">GAMMA LOW</span>
                                    </div>
                                    <div className="text-2xl font-bold font-mono text-orange-400">
                                        {formatPrice(levels.gamma_low_price)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-1">
                                        Max Seller Gamma Exposure
                                    </div>
                                </div>

                                {/* Meta Info */}
                                <div className="pt-3 border-t border-[#30363d] space-y-2 text-[10px] text-gray-500">
                                    <div className="flex justify-between">
                                        <span>Expiry:</span>
                                        <span className="font-mono text-gray-400">{levels.expiry_date}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Updated:</span>
                                        <span className="font-mono text-gray-400">
                                            {new Date(levels.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-8">
                                <RefreshCw size={24} className="text-gray-600 animate-spin mx-auto mb-2" />
                                <p className="text-xs text-gray-500">Loading levels...</p>
                            </div>
                        )}
                    </div>

                    {/* Price Bands Visualization */}
                    {levels && (
                        <div className="mt-auto p-3 border-t border-[#30363d]">
                            <div className="text-[10px] text-gray-500 mb-2">Price Bands</div>
                            <div className="relative h-24 bg-[#0d1117] rounded border border-[#30363d]">
                                {/* Visualize levels as horizontal lines */}
                                {(() => {
                                    const prices = [
                                        levels.gamma_low_price,
                                        levels.support_price,
                                        levels.current_price,
                                        levels.resistance_price,
                                        levels.gamma_high_price
                                    ].filter(p => p > 0);
                                    const min = Math.min(...prices) * 0.99;
                                    const max = Math.max(...prices) * 1.01;
                                    const range = max - min;

                                    const getY = (price: number) => {
                                        return 100 - ((price - min) / range) * 100;
                                    };

                                    return (
                                        <>
                                            {/* Support */}
                                            <div
                                                className="absolute left-0 right-0 h-px bg-green-500"
                                                style={{ top: `${getY(levels.support_price)}%` }}
                                            >
                                                <span className="absolute -left-1 -top-2 text-[8px] text-green-400">S</span>
                                            </div>
                                            {/* Resistance */}
                                            <div
                                                className="absolute left-0 right-0 h-px bg-red-500"
                                                style={{ top: `${getY(levels.resistance_price)}%` }}
                                            >
                                                <span className="absolute -left-1 -top-2 text-[8px] text-red-400">R</span>
                                            </div>
                                            {/* Gamma High */}
                                            <div
                                                className="absolute left-0 right-0 h-px bg-purple-500 opacity-60"
                                                style={{ top: `${getY(levels.gamma_high_price)}%` }}
                                            >
                                                <span className="absolute -left-1 -top-2 text-[8px] text-purple-400">γH</span>
                                            </div>
                                            {/* Gamma Low */}
                                            <div
                                                className="absolute left-0 right-0 h-px bg-orange-500 opacity-60"
                                                style={{ top: `${getY(levels.gamma_low_price)}%` }}
                                            >
                                                <span className="absolute -left-1 -top-2 text-[8px] text-orange-400">γL</span>
                                            </div>
                                            {/* Current Price */}
                                            <div
                                                className="absolute left-0 right-0 h-0.5 bg-cyan-400"
                                                style={{ top: `${getY(levels.current_price)}%` }}
                                            >
                                                <span className="absolute right-1 -top-2 text-[8px] text-cyan-400 font-bold">
                                                    {formatPrice(levels.current_price)}
                                                </span>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
