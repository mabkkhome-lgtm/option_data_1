'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import {
    ArrowLeft,
    TrendingUp,
    TrendingDown,
    Activity,
    RefreshCw,
    Clock,
    Zap,
    Info
} from 'lucide-react';
import { AdvancedChart } from '@/components/chart/AdvancedChart';

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
    const [levels, setLevels] = useState<MarketLevel | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [showSidebar, setShowSidebar] = useState(true);
    const [chartHeight, setChartHeight] = useState(600);

    // Set chart height on client side only
    useEffect(() => {
        setChartHeight(window.innerHeight - 100);
        const handleResize = () => setChartHeight(window.innerHeight - 100);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Trigger calculation and fetch latest market levels
    const fetchLevels = useCallback(async () => {
        if (!supabase) return;

        try {
            // 1. Trigger the calculation (fire-and-forget for speed, but we await to ensure it completed)
            await fetch('/api/cron/market-levels');

            // 2. Fetch the latest result from DB
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
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch levels:', err);
            setLoading(false);
        }
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

                {/* Toggle Sidebar */}
                <button
                    onClick={() => setShowSidebar(!showSidebar)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${showSidebar ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'
                        }`}
                >
                    Options Flow
                </button>

                {/* Last Update */}
                <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock size={12} />
                    <span>{formatTimeAgo(lastUpdate)}</span>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Chart Area - Custom Advanced Chart */}
                <div className="flex-1 relative p-2">
                    <AdvancedChart
                        symbol="BTCUSDT"
                        interval="15m"
                        height={chartHeight}
                        optionsLevels={levels ? {
                            support: levels.support_price,
                            resistance: levels.resistance_price,
                            gammaHigh: levels.gamma_high_price,
                            gammaLow: levels.gamma_low_price,
                        } : undefined}
                    />
                </div>

                {/* Right Sidebar - Market Levels Indicator */}
                {showSidebar && (
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

                        {/* Info Banner */}
                        <div className="mx-3 mt-3 p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                            <div className="flex items-start gap-2">
                                <Info size={14} className="text-cyan-400 mt-0.5 shrink-0" />
                                <p className="text-[10px] text-cyan-300">
                                    All technical indicators are now available! Click "Indicators" button on the chart to add SMA, EMA, RSI, MACD, VWAP, Bollinger Bands, and more.
                                </p>
                            </div>
                        </div>

                        {/* Levels Display */}
                        <div className="p-3 space-y-4 overflow-y-auto">
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
                                    <RefreshCw size={24} className={`text-gray-600 mx-auto mb-2 ${loading ? 'animate-spin' : ''}`} />
                                    <p className="text-xs text-gray-500 mb-2">{loading ? 'Loading levels...' : 'No Data Found'}</p>
                                    {!loading && (
                                        <div className="text-[10px] text-red-400 bg-red-900/20 p-2 rounded">
                                            Check if Dashboard is open or check Database RLS policies.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Price Levels Visualization */}
                        {levels && (
                            <div className="mt-auto p-3 border-t border-[#30363d] bg-[#0d1117]">
                                <div className="text-[10px] text-gray-500 mb-2 flex justify-between">
                                    <span>Signal Bands</span>
                                    <span className={levels.current_price >= levels.support_price && levels.current_price <= levels.resistance_price ? "text-green-500" : "text-yellow-500"}>
                                        {levels.current_price >= levels.support_price && levels.current_price <= levels.resistance_price ? "Safe Zone" : "Breakout"}
                                    </span>
                                </div>
                                <div className="relative h-40 w-full bg-[#161b22] rounded border border-[#30363d] overflow-hidden">
                                    {(() => {
                                        // Calculate range for visualization
                                        const prices = [
                                            levels.gamma_low_price,
                                            levels.support_price,
                                            levels.current_price,
                                            levels.resistance_price,
                                            levels.gamma_high_price
                                        ].filter(p => !isNaN(p) && p > 0);

                                        if (prices.length === 0) return <div className="flex items-center justify-center h-full text-xs text-gray-600">No Valid Data</div>;

                                        const min = Math.min(...prices) * 0.98;
                                        const max = Math.max(...prices) * 1.02;
                                        const range = max - min || 1;

                                        const getY = (price: number) => {
                                            return 100 - ((price - min) / range) * 100;
                                        };

                                        return (
                                            <>
                                                {/* Gamma High Line (Purple) */}
                                                <div className="absolute w-full border-t border-purple-500/50 border-dashed" style={{ top: `${getY(levels.gamma_high_price)}%` }}>
                                                    <span className="absolute right-1 -top-2.5 text-[8px] text-purple-400 bg-[#161b22] px-1">Γ High</span>
                                                </div>

                                                {/* Resistance Line (Red) - Background Fill */}
                                                <div className="absolute w-full h-px bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" style={{ top: `${getY(levels.resistance_price)}%` }}>
                                                    <span className="absolute left-1 -top-2.5 text-[8px] text-red-400 bg-[#161b22] px-1 font-bold">RES</span>
                                                </div>

                                                {/* Current Price (Cyan) - Pulsing */}
                                                <div className="absolute w-full h-0.5 bg-cyan-400 z-10" style={{ top: `${getY(levels.current_price)}%` }}>
                                                    <div className="absolute right-0 -top-1.5 h-3 w-3 bg-cyan-400 rounded-full animate-ping opacity-75"></div>
                                                    <div className="absolute right-0 -top-1 h-2 w-2 bg-cyan-400 rounded-full"></div>
                                                </div>

                                                {/* Support Line (Green) - Background Fill */}
                                                <div className="absolute w-full h-px bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" style={{ top: `${getY(levels.support_price)}%` }}>
                                                    <span className="absolute left-1 -top-2.5 text-[8px] text-green-400 bg-[#161b22] px-1 font-bold">SUP</span>
                                                </div>

                                                {/* Gamma Low Line (Orange) */}
                                                <div className="absolute w-full border-t border-orange-500/50 border-dashed" style={{ top: `${getY(levels.gamma_low_price)}%` }}>
                                                    <span className="absolute right-1 -top-2.5 text-[8px] text-orange-400 bg-[#161b22] px-1">Γ Low</span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
