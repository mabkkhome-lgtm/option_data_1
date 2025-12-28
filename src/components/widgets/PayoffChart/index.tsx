'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { useStrategyStore } from '@/stores';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateOptionPrice, generatePriceRange } from '@/lib/options/blackScholes';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

/**
 * PayoffChart Widget - Thales-Inspired Design
 * 
 * Features:
 * - Live price with profit/loss indicator
 * - Green/Red gradient fills for profit/loss zones
 * - Multiple sources with colored curves
 * - Breakeven markers
 */

interface PayoffChartProps {
    widgetId: string;
}

export function PayoffChartWidget({ widgetId }: PayoffChartProps) {
    // Store connections
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    // Live price
    const { btcPrice, isConnected } = useLivePriceStore();
    const livePrice = btcPrice || 95000;

    // Get connected sources
    const connectedSources = useMemo(() => {
        const connectedIds = connections
            .filter(c => c.targetId === widgetId)
            .map(c => c.sourceId);

        if (connectedIds.length === 0) {
            if (allTrades.length > 0) {
                return [{
                    sourceId: 'default',
                    label: 'All',
                    trades: allTrades,
                    color: '#8b5cf6'
                }] as TradeSource[];
            }
            return [];
        }

        return connectedIds
            .map(id => sourcesMap.get(id))
            .filter((s): s is TradeSource => s !== undefined && s.trades.length > 0);
    }, [sourcesMap, connections, allTrades, widgetId]);

    const [daysToExpiry, setDaysToExpiry] = useState(30);
    const [showExpiry, setShowExpiry] = useState(true);
    const [showNow, setShowNow] = useState(true);

    // Auto-detect DTE
    useEffect(() => {
        if (connectedSources.length > 0 && connectedSources[0].trades.length > 0) {
            const firstTrade = connectedSources[0].trades[0];
            if (firstTrade.expiryDate) {
                const now = new Date();
                const msToExpiry = firstTrade.expiryDate.getTime() - now.getTime();
                const days = Math.max(1, Math.ceil(msToExpiry / (1000 * 60 * 60 * 24)));
                setDaysToExpiry(Math.min(365, days));
            }
        }
    }, [connectedSources]);

    const hasData = connectedSources.length > 0;

    // Calculate P&L for each source
    const chartData = useMemo(() => {
        if (!hasData) return null;

        const firstTrade = connectedSources[0]?.trades[0];
        const baseUnderlying = livePrice || firstTrade?.underlying || firstTrade?.indexPrice || 95000;
        const prices = generatePriceRange(baseUnderlying, 0.25, 60);
        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        const sourcesData = connectedSources.map(source => {
            const expiryPayoffs: number[] = [];
            const currentPayoffs: number[] = [];

            for (const spotPrice of prices) {
                let expiryPnL = 0;
                let currentPnL = 0;

                for (const trade of source.trades) {
                    const isCall = trade.type === 'call';
                    const isLong = trade.direction === 'buy';
                    const strike = trade.strike;
                    const size = trade.size;
                    const iv = (trade.iv || 50) / 100;
                    const multiplier = isLong ? 1 : -1;
                    const entryPriceUSD = trade.priceUSD || trade.price * baseUnderlying;

                    // At expiry: intrinsic value
                    const intrinsic = isCall
                        ? Math.max(0, spotPrice - strike)
                        : Math.max(0, strike - spotPrice);
                    const expiryValue = intrinsic * size;
                    expiryPnL += multiplier * expiryValue - (isLong ? entryPriceUSD : -entryPriceUSD);

                    // Now: option value with time value
                    const currentValue = calculateOptionPrice(spotPrice, strike, T, r, iv, isCall ? 'call' : 'put') * size;
                    currentPnL += multiplier * currentValue - (isLong ? entryPriceUSD : -entryPriceUSD);
                }

                expiryPayoffs.push(expiryPnL);
                currentPayoffs.push(currentPnL);
            }

            // Find P&L at current price
            const spotIdx = prices.findIndex(p => p >= livePrice);
            const pnlAtSpot = spotIdx >= 0 ? currentPayoffs[spotIdx] : 0;

            return {
                source,
                prices,
                expiryPayoffs,
                currentPayoffs,
                pnlAtSpot,
            };
        });

        return sourcesData;
    }, [connectedSources, daysToExpiry, hasData, livePrice]);

    // Empty state
    if (!hasData || !chartData) {
        return (
            <div className="h-full flex items-center justify-center text-foreground-muted text-sm">
                <div className="text-center p-4">
                    <TrendingUp size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="font-medium">Connect a Market Screener</p>
                    <p className="text-xs opacity-75 mt-1">
                        Draw a connection from screener to this widget
                    </p>
                </div>
            </div>
        );
    }

    // Calculate total P&L at current price
    const totalPnL = chartData.reduce((sum, d) => sum + d.pnlAtSpot, 0);
    const isProfitable = totalPnL >= 0;

    // Build traces
    const traces: any[] = [];

    chartData.forEach((data) => {
        const sourceColor = data.source.color || '#8b5cf6';

        // Current P&L curve
        if (showNow) {
            traces.push({
                x: data.prices,
                y: data.currentPayoffs,
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: `${data.source.label} Now`,
                line: { color: sourceColor, width: 2 },
                fill: 'tozeroy',
                fillcolor: `${sourceColor}20`,
            });
        }

        // Expiry P&L curve
        if (showExpiry) {
            traces.push({
                x: data.prices,
                y: data.expiryPayoffs,
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: `${data.source.label} Expiry`,
                line: { color: sourceColor, width: 1, dash: 'dot' as const },
            });
        }
    });

    const priceRange = chartData[0]?.prices || [80000, 110000];
    const allPayoffs = chartData.flatMap(d => [...d.expiryPayoffs, ...d.currentPayoffs]);
    const minY = Math.min(...allPayoffs) * 1.1;
    const maxY = Math.max(...allPayoffs) * 1.1;

    return (
        <div className="h-full flex flex-col bg-gradient-to-b from-[#0f0a1a] to-[#1a1025]">
            {/* Header with live price and P&L */}
            <div className="px-3 py-2 border-b border-purple-500/20 flex items-center gap-3">
                {/* Live Price */}
                <div className="flex items-center gap-2 bg-black/30 px-2 py-1 rounded-lg">
                    <Zap size={12} className={isConnected ? 'text-green-400' : 'text-gray-500'} />
                    <span className="text-xs text-gray-400">BTC</span>
                    <span className="text-sm font-mono font-bold text-white">
                        ${livePrice.toLocaleString()}
                    </span>
                </div>

                {/* P&L at current price */}
                <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${isProfitable ? 'bg-green-500/20' : 'bg-red-500/20'
                    }`}>
                    {isProfitable ? (
                        <TrendingUp size={14} className="text-green-400" />
                    ) : (
                        <TrendingDown size={14} className="text-red-400" />
                    )}
                    <span className={`text-sm font-mono font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'
                        }`}>
                        {isProfitable ? '+' : ''}${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                </div>

                {/* Curve toggles */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowNow(!showNow)}
                        className={`text-[10px] px-2 py-0.5 rounded font-medium ${showNow ? 'bg-white/10 text-white' : 'text-gray-500'
                            }`}
                    >
                        Now
                    </button>
                    <button
                        onClick={() => setShowExpiry(!showExpiry)}
                        className={`text-[10px] px-2 py-0.5 rounded font-medium ${showExpiry ? 'bg-white/10 text-white' : 'text-gray-500'
                            }`}
                    >
                        Expiry
                    </button>
                </div>

                {/* DTE */}
                <div className="flex items-center gap-1 text-xs ml-auto">
                    <span className="text-gray-500">DTE</span>
                    <input
                        type="number"
                        value={daysToExpiry}
                        onChange={(e) => setDaysToExpiry(Math.max(1, Math.min(365, Number(e.target.value))))}
                        className="w-12 bg-black/30 text-white px-1.5 py-0.5 rounded border border-purple-500/30 text-center"
                        min="1"
                        max="365"
                    />
                </div>

                {/* Source badges */}
                {connectedSources.map(source => (
                    <span
                        key={source.sourceId}
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{
                            backgroundColor: `${source.color}30`,
                            color: source.color,
                        }}
                    >
                        {source.label}
                    </span>
                ))}
            </div>

            {/* Chart */}
            <div className="flex-1 min-h-0" onWheel={(e) => e.stopPropagation()}>
                <Plot
                    data={[
                        ...traces,
                        // Current price marker
                        {
                            x: [livePrice, livePrice],
                            y: [minY, maxY],
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            name: 'Current',
                            line: { color: '#fbbf24', width: 2, dash: 'dot' as const },
                            showlegend: false,
                        },
                        // Zero line (breakeven)
                        {
                            x: [priceRange[0], priceRange[priceRange.length - 1]],
                            y: [0, 0],
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            line: { color: '#6b7280', width: 1 },
                            showlegend: false,
                            hoverinfo: 'skip' as const,
                        },
                    ]}
                    layout={{
                        autosize: true,
                        margin: { l: 55, r: 20, t: 5, b: 35 },
                        paper_bgcolor: 'transparent',
                        plot_bgcolor: 'transparent',
                        font: { color: '#9ca3af', size: 9 },
                        dragmode: 'zoom',
                        xaxis: {
                            gridcolor: 'rgba(75, 85, 99, 0.2)',
                            tickformat: '$,.0f',
                            tickfont: { size: 9 },
                        },
                        yaxis: {
                            title: { text: 'P&L ($)', font: { size: 9 } },
                            gridcolor: 'rgba(75, 85, 99, 0.2)',
                            zerolinecolor: '#6b7280',
                            tickfont: { size: 9 },
                            tickformat: '$,.0f',
                        },
                        showlegend: false,
                        hovermode: 'x unified',
                        hoverlabel: {
                            bgcolor: '#1f2937',
                            bordercolor: '#4b5563',
                            font: { color: '#f9fafb', size: 11 },
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

            {/* Footer - Per-source P&L */}
            <div className="px-3 py-2 border-t border-purple-500/20 bg-black/20">
                <div className="flex items-center gap-4 text-xs">
                    {chartData.map(data => {
                        const pnl = data.pnlAtSpot;
                        const isProfit = pnl >= 0;
                        return (
                            <div
                                key={data.source.sourceId}
                                className="flex items-center gap-2"
                            >
                                <span style={{ color: data.source.color }} className="font-medium">
                                    {data.source.label}
                                </span>
                                <span className={`font-mono ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                    {isProfit ? '+' : ''}${pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
