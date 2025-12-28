'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Play, Pause, RotateCcw, Download, TrendingUp } from 'lucide-react';
import { useStrategyStore } from '@/stores';
import { useTradesSelectionStore } from '@/stores/tradesSelection';
import {
    calculateOptionPrice,
    calculateImpliedVolatility,
    generatePriceRange
} from '@/lib/options/blackScholes';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

/**
 * PayoffChart Widget - Based on Thales MFI Research
 * 
 * Features:
 * - P&L at expiration (intrinsic value)
 * - P&L at current time (with time value via Black-Scholes)
 * - Time decay animation
 * - Breakeven calculation
 * - Max profit/loss display
 * - Connection-aware: only shows trades from connected screeners
 */

interface PayoffChartProps {
    widgetId: string;
}

export function PayoffChartWidget({ widgetId }: PayoffChartProps) {
    const { activeStrategy } = useStrategyStore();

    // Get raw state from store (stable references)
    const sources = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    // Compute trades for this target widget using useMemo (avoids infinite loop)
    const selectedTrades = useMemo(() => {
        const connectedSources = connections
            .filter(c => c.targetId === widgetId)
            .map(c => c.sourceId);

        // If no connections, return all trades (backward compat)
        if (connectedSources.length === 0) {
            return allTrades;
        }

        // Otherwise, return only trades from connected sources
        const trades: typeof allTrades = [];
        connectedSources.forEach(sid => {
            const source = sources.get(sid);
            if (source) {
                trades.push(...source.trades);
            }
        });

        // Deduplicate
        return trades.filter((trade, index, self) =>
            index === self.findIndex(t => t.id === trade.id)
        );
    }, [sources, connections, allTrades, widgetId]);

    // Controls
    const [daysToExpiry, setDaysToExpiry] = useState(30);
    const [showExpiry, setShowExpiry] = useState(true);
    const [showCurrent, setShowCurrent] = useState(true);
    const [isAnimating, setIsAnimating] = useState(false);
    const [animationDay, setAnimationDay] = useState(0);
    const animationRef = useRef<NodeJS.Timeout | null>(null);

    // Auto-detect DTE from trades
    useEffect(() => {
        if (selectedTrades.length > 0) {
            // Try to parse expiry from first trade to estimate DTE
            const firstTrade = selectedTrades[0];
            if (firstTrade.expiryDate) {
                const now = new Date();
                const msToExpiry = firstTrade.expiryDate.getTime() - now.getTime();
                const days = Math.max(1, Math.ceil(msToExpiry / (1000 * 60 * 60 * 24)));
                setDaysToExpiry(Math.min(365, days));
            }
        }
    }, [selectedTrades]);

    // Animation control
    useEffect(() => {
        if (isAnimating) {
            animationRef.current = setInterval(() => {
                setAnimationDay(prev => {
                    if (prev >= daysToExpiry) {
                        setIsAnimating(false);
                        return daysToExpiry;
                    }
                    return prev + 1;
                });
            }, 100);
        } else if (animationRef.current) {
            clearInterval(animationRef.current);
        }
        return () => {
            if (animationRef.current) clearInterval(animationRef.current);
        };
    }, [isAnimating, daysToExpiry]);

    const hasData = selectedTrades.length > 0;

    // Calculate payoff data
    const chartData = useMemo(() => {
        if (!hasData) return null;

        const trades = selectedTrades;
        const currentUnderlying = trades[0]?.underlying || trades[0]?.indexPrice || 95000;

        // Price range: ±30%
        const prices = generatePriceRange(currentUnderlying, 0.3, 150);
        const expiryPayoffs: number[] = [];
        const currentPayoffs: number[] = [];
        const animatedPayoffs: number[] = [];

        const r = 0.05; // Risk-free rate
        const T_current = Math.max(0.001, daysToExpiry / 365);
        const T_animated = Math.max(0.001, (daysToExpiry - animationDay) / 365);

        for (const spotPrice of prices) {
            let totalExpiryPnL = 0;
            let totalCurrentPnL = 0;
            let totalAnimatedPnL = 0;

            for (const trade of trades) {
                const isCall = trade.type === 'call';
                const isLong = trade.direction === 'buy';
                const strike = trade.strike;
                const size = trade.size;
                const iv = (trade.iv || 50) / 100;
                const multiplier = isLong ? 1 : -1;

                // Entry cost in USD (price is in BTC terms, multiply by underlying)
                const entryUnderlying = trade.underlying || trade.indexPrice || currentUnderlying;
                const entryPremiumUSD = trade.price * entryUnderlying;

                // === EXPIRY P&L (intrinsic only) ===
                const intrinsic = isCall
                    ? Math.max(0, spotPrice - strike)
                    : Math.max(0, strike - spotPrice);
                const expiryPnL = (intrinsic - entryPremiumUSD) * multiplier * size;
                totalExpiryPnL += expiryPnL;

                // === CURRENT P&L (with time value) ===
                const currentValue = calculateOptionPrice(spotPrice, strike, T_current, r, iv, isCall ? 'call' : 'put');
                const currentPnL = (currentValue - entryPremiumUSD) * multiplier * size;
                totalCurrentPnL += currentPnL;

                // === ANIMATED P&L ===
                const animatedValue = calculateOptionPrice(spotPrice, strike, T_animated, r, iv, isCall ? 'call' : 'put');
                const animatedPnL = (animatedValue - entryPremiumUSD) * multiplier * size;
                totalAnimatedPnL += animatedPnL;
            }

            expiryPayoffs.push(totalExpiryPnL);
            currentPayoffs.push(totalCurrentPnL);
            animatedPayoffs.push(totalAnimatedPnL);
        }

        // Calculate analytics
        const maxProfit = Math.max(...expiryPayoffs);
        const maxLoss = Math.min(...expiryPayoffs);

        // Find breakevens (where payoff crosses zero)
        const breakevens: number[] = [];
        for (let i = 1; i < expiryPayoffs.length; i++) {
            const prev = expiryPayoffs[i - 1];
            const curr = expiryPayoffs[i];
            if ((prev <= 0 && curr >= 0) || (prev >= 0 && curr <= 0)) {
                const ratio = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr));
                const breakeven = prices[i - 1] + ratio * (prices[i] - prices[i - 1]);
                breakevens.push(breakeven);
            }
        }

        return {
            prices,
            expiryPayoffs,
            currentPayoffs,
            animatedPayoffs,
            currentUnderlying,
            maxProfit,
            maxLoss,
            breakevens,
        };
    }, [selectedTrades, daysToExpiry, animationDay, hasData]);

    // Animation controls
    const startAnimation = () => {
        setAnimationDay(0);
        setIsAnimating(true);
    };

    const resetAnimation = () => {
        setIsAnimating(false);
        setAnimationDay(0);
    };

    // Format helpers
    const formatUSD = (n: number) => {
        if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
        if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
        return `$${n.toFixed(0)}`;
    };

    // Export chart
    const exportChart = () => {
        const plotDiv = document.querySelector('.payoff-chart .js-plotly-plot');
        if (plotDiv) {
            // @ts-ignore
            window.Plotly?.downloadImage(plotDiv, { format: 'png', width: 1200, height: 600, filename: 'payoff_chart' });
        }
    };

    // Empty state
    if (!hasData) {
        return (
            <div className="h-full flex items-center justify-center text-foreground-muted text-sm">
                <div className="text-center p-4">
                    <TrendingUp size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="font-medium">No Data Selected</p>
                    <p className="text-xs opacity-75 mt-1">
                        Select trades in Market Screener
                    </p>
                </div>
            </div>
        );
    }

    if (!chartData) {
        return (
            <div className="h-full flex items-center justify-center text-foreground-muted">
                Calculating...
            </div>
        );
    }

    return (
        <div className="payoff-chart h-full flex flex-col p-2">
            {/* Controls */}
            <div className="flex items-center gap-3 pb-2 border-b border-border-color mb-2 flex-wrap">
                {/* Curve toggles */}
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <span className="w-3 h-0.5 bg-red-500 rounded"></span>
                    <input
                        type="checkbox"
                        checked={showExpiry}
                        onChange={(e) => setShowExpiry(e.target.checked)}
                        className="accent-red-500 w-3 h-3"
                    />
                    <span className="text-foreground-muted">Expiry</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <span className="w-3 h-0.5 bg-cyan-400 rounded"></span>
                    <input
                        type="checkbox"
                        checked={showCurrent}
                        onChange={(e) => setShowCurrent(e.target.checked)}
                        className="accent-cyan-400 w-3 h-3"
                    />
                    <span className="text-foreground-muted">T+0</span>
                </label>

                {/* DTE input */}
                <div className="flex items-center gap-1 text-xs">
                    <span className="text-foreground-muted">DTE:</span>
                    <input
                        type="number"
                        value={daysToExpiry}
                        onChange={(e) => setDaysToExpiry(Math.max(1, Math.min(365, Number(e.target.value))))}
                        className="bg-background-secondary text-foreground px-1.5 py-0.5 rounded border border-border-color w-14"
                        min="1"
                        max="365"
                    />
                </div>

                {/* Animation controls */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={isAnimating ? () => setIsAnimating(false) : startAnimation}
                        className="p-1 bg-background-secondary hover:bg-background-tertiary rounded"
                        title={isAnimating ? 'Pause' : 'Animate time decay'}
                    >
                        {isAnimating ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <button
                        onClick={resetAnimation}
                        className="p-1 bg-background-secondary hover:bg-background-tertiary rounded"
                        title="Reset"
                    >
                        <RotateCcw size={12} />
                    </button>
                    {animationDay > 0 && (
                        <span className="text-xs text-yellow-400 font-mono ml-1">
                            T+{animationDay}d
                        </span>
                    )}
                </div>

                <div className="flex-1" />

                <span className="text-xs text-cyan-400 font-mono">{selectedTrades.length} trades</span>

                <button
                    onClick={exportChart}
                    className="p-1 hover:bg-background-tertiary rounded"
                    title="Export PNG"
                >
                    <Download size={12} />
                </button>
            </div>

            {/* Chart */}
            <div
                className="flex-1 min-h-0"
                onWheel={(e) => e.stopPropagation()}
            >
                <Plot
                    data={[
                        // Expiry P&L (red)
                        ...(showExpiry ? [{
                            x: chartData.prices,
                            y: chartData.expiryPayoffs,
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            name: 'At Expiry',
                            line: { color: '#ef4444', width: 2 },
                            fill: 'tozeroy' as const,
                            fillcolor: 'rgba(239, 68, 68, 0.05)',
                        }] : []),

                        // Current P&L (cyan)
                        ...(showCurrent ? [{
                            x: chartData.prices,
                            y: chartData.currentPayoffs,
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            name: `T+0 (${daysToExpiry}d to exp)`,
                            line: { color: '#22d3ee', width: 2 },
                        }] : []),

                        // Animated P&L (yellow) - only show if animating
                        ...(animationDay > 0 ? [{
                            x: chartData.prices,
                            y: chartData.animatedPayoffs,
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            name: `T+${animationDay}d`,
                            line: { color: '#fbbf24', width: 2, dash: 'dot' as const },
                        }] : []),

                        // Zero line
                        {
                            x: [chartData.prices[0], chartData.prices[chartData.prices.length - 1]],
                            y: [0, 0],
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            line: { color: '#6b7280', width: 1, dash: 'dot' as const },
                            showlegend: false,
                            hoverinfo: 'skip' as const,
                        },

                        // Current price marker
                        {
                            x: [chartData.currentUnderlying],
                            y: [0],
                            type: 'scatter' as const,
                            mode: 'text+markers' as const,
                            name: 'Spot',
                            marker: { color: '#94a3b8', size: 10, symbol: 'diamond' },
                            text: [formatUSD(chartData.currentUnderlying)],
                            textposition: 'top center' as const,
                            textfont: { size: 9, color: '#94a3b8' },
                        },

                        // Breakeven markers
                        ...chartData.breakevens.map((be, i) => ({
                            x: [be],
                            y: [0],
                            type: 'scatter' as const,
                            mode: 'markers' as const,
                            name: i === 0 ? 'Breakeven' : undefined,
                            showlegend: i === 0,
                            marker: { color: '#8b5cf6', size: 8, symbol: 'x' },
                            hovertemplate: `Breakeven: ${formatUSD(be)}<extra></extra>`,
                        })),
                    ]}
                    layout={{
                        autosize: true,
                        margin: { l: 55, r: 20, t: 10, b: 40 },
                        paper_bgcolor: 'transparent',
                        plot_bgcolor: 'transparent',
                        font: { color: '#e8e6f0', size: 10 },
                        dragmode: 'zoom',
                        xaxis: {
                            title: { text: 'Underlying Price', font: { size: 10 } },
                            gridcolor: 'rgba(100, 100, 120, 0.15)',
                            tickformat: '$,.0f',
                            zeroline: false,
                        },
                        yaxis: {
                            title: { text: 'P&L ($)', font: { size: 10 } },
                            gridcolor: 'rgba(100, 100, 120, 0.15)',
                            zerolinecolor: '#6b7280',
                            zerolinewidth: 1,
                            tickformat: '$,.0f',
                        },
                        showlegend: true,
                        legend: {
                            orientation: 'h',
                            y: -0.15,
                            x: 0.5,
                            xanchor: 'center',
                            font: { size: 9 },
                        },
                        hovermode: 'x unified',
                        hoverlabel: {
                            bgcolor: '#1a1625',
                            bordercolor: '#3b3352',
                            font: { color: '#e8e6f0', size: 11 },
                        },
                    }}
                    config={{
                        displayModeBar: false,
                        responsive: true,
                        scrollZoom: true,
                    }}
                    style={{ width: '100%', height: '100%' }}
                />
            </div>

            {/* Analytics Footer */}
            <div className="pt-2 border-t border-border-color mt-1">
                <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-green-500/10 rounded p-1.5 text-center">
                        <div className="text-green-400 text-[10px]">Max Profit</div>
                        <div className="font-mono font-bold text-green-400">
                            {chartData.maxProfit === Infinity ? '∞' : formatUSD(chartData.maxProfit)}
                        </div>
                    </div>
                    <div className="bg-red-500/10 rounded p-1.5 text-center">
                        <div className="text-red-400 text-[10px]">Max Loss</div>
                        <div className="font-mono font-bold text-red-400">
                            {chartData.maxLoss === -Infinity ? '∞' : formatUSD(chartData.maxLoss)}
                        </div>
                    </div>
                    <div className="bg-purple-500/10 rounded p-1.5 text-center">
                        <div className="text-purple-400 text-[10px]">Breakeven</div>
                        <div className="font-mono text-[10px] text-purple-400">
                            {chartData.breakevens.length > 0
                                ? chartData.breakevens.slice(0, 2).map(b => formatUSD(b)).join(' / ')
                                : 'None'}
                        </div>
                    </div>
                    <div className="bg-cyan-500/10 rounded p-1.5 text-center">
                        <div className="text-cyan-400 text-[10px]">Spot</div>
                        <div className="font-mono font-bold text-cyan-400">
                            {formatUSD(chartData.currentUnderlying)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
