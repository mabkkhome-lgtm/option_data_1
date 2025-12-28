'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { useStrategyStore } from '@/stores';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateGreeks, generatePriceRange } from '@/lib/options/blackScholes';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

/**
 * GreeksViz Widget - Thales-Inspired Design
 * 
 * Features:
 * - Live price ticker with connection status
 * - Multiple sources with colored curves
 * - Gradient fills under curves
 * - Compact header controls
 */

type GreekType = 'delta' | 'gamma' | 'theta' | 'vega';

interface GreeksVizProps {
    widgetId: string;
}

interface SourceGreeksData {
    source: TradeSource;
    prices: number[];
    greeks: Record<GreekType, number[]>;
    greeksAtSpot: Record<GreekType, number>;
}

export function GreeksVizWidget({ widgetId }: GreeksVizProps) {
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

    const [visibleGreeks, setVisibleGreeks] = useState<Record<GreekType, boolean>>({
        delta: true,
        gamma: false,
        theta: false,
        vega: false,
    });
    const [daysToExpiry, setDaysToExpiry] = useState(30);

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

    // Calculate Greeks for each source
    const perSourceData = useMemo((): SourceGreeksData[] => {
        if (!hasData) return [];

        const firstTrade = connectedSources[0]?.trades[0];
        const baseUnderlying = livePrice || firstTrade?.underlying || firstTrade?.indexPrice || 95000;

        const prices = generatePriceRange(baseUnderlying, 0.25, 60);
        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        return connectedSources.map(source => {
            const greeks: Record<GreekType, number[]> = {
                delta: [], gamma: [], theta: [], vega: [],
            };

            for (const spotPrice of prices) {
                let totals = { delta: 0, gamma: 0, theta: 0, vega: 0 };

                for (const trade of source.trades) {
                    const isCall = trade.type === 'call';
                    const isLong = trade.direction === 'buy';
                    const multiplier = isLong ? 1 : -1;
                    const iv = (trade.iv || 50) / 100;

                    const g = calculateGreeks(spotPrice, trade.strike, T, r, iv, isCall ? 'call' : 'put');

                    totals.delta += g.delta * multiplier * trade.size;
                    totals.gamma += g.gamma * multiplier * trade.size;
                    totals.theta += g.theta * multiplier * trade.size;
                    totals.vega += g.vega * multiplier * trade.size;
                }

                greeks.delta.push(totals.delta);
                greeks.gamma.push(totals.gamma);
                greeks.theta.push(totals.theta);
                greeks.vega.push(totals.vega);
            }

            const spotIdx = prices.findIndex(p => p >= baseUnderlying);
            const greeksAtSpot = {
                delta: spotIdx >= 0 ? greeks.delta[spotIdx] : 0,
                gamma: spotIdx >= 0 ? greeks.gamma[spotIdx] : 0,
                theta: spotIdx >= 0 ? greeks.theta[spotIdx] : 0,
                vega: spotIdx >= 0 ? greeks.vega[spotIdx] : 0,
            };

            return { source, prices, greeks, greeksAtSpot };
        });
    }, [connectedSources, daysToExpiry, hasData, livePrice]);

    const toggleGreek = (greek: GreekType) => {
        setVisibleGreeks(prev => ({ ...prev, [greek]: !prev[greek] }));
    };

    // Empty state
    if (!hasData) {
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

    // Build traces with gradient fills
    const traces: any[] = [];
    const greekColors: Record<GreekType, string> = {
        delta: '#22c55e',
        gamma: '#8b5cf6',
        theta: '#ef4444',
        vega: '#f59e0b',
    };

    perSourceData.forEach((data) => {
        const sourceColor = data.source.color || '#8b5cf6';

        (Object.keys(greekColors) as GreekType[])
            .filter(greek => visibleGreeks[greek])
            .forEach((greek) => {
                // Main line
                traces.push({
                    x: data.prices,
                    y: data.greeks[greek],
                    type: 'scatter' as const,
                    mode: 'lines' as const,
                    name: `${data.source.label} ${greek.charAt(0).toUpperCase() + greek.slice(1)}`,
                    line: { color: sourceColor, width: 2 },
                    fill: 'tozeroy',
                    fillcolor: `${sourceColor}15`,
                });
            });
    });

    const priceRange = perSourceData[0]?.prices || [80000, 110000];

    return (
        <div className="h-full flex flex-col bg-transparent">
            {/* Header with live price */}
            <div className="px-3 py-2 border-b border-[rgba(48,54,61,0.5)] flex items-center gap-3 bg-[rgba(255,255,255,0.02)]">
                {/* Live Price Ticker */}
                <div className="flex items-center gap-2 bg-black/30 px-2 py-1 rounded-lg">
                    <Zap size={12} className={isConnected ? 'text-green-400' : 'text-gray-500'} />
                    <span className="text-xs text-gray-400">BTC</span>
                    <span className="text-sm font-mono font-bold text-white">
                        ${livePrice.toLocaleString()}
                    </span>
                </div>

                {/* Greek toggles */}
                <div className="flex items-center gap-1">
                    {(Object.keys(greekColors) as GreekType[]).map((greek) => (
                        <button
                            key={greek}
                            onClick={() => toggleGreek(greek)}
                            className={`text-[10px] px-2 py-0.5 rounded font-medium transition-all ${visibleGreeks[greek]
                                ? 'bg-white/10 text-white'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            {greek.charAt(0).toUpperCase() + greek.slice(1)}
                        </button>
                    ))}
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
            <div className="flex-1 min-h-0">
                <Plot
                    data={[
                        ...traces,
                        // Current price marker
                        {
                            x: [livePrice, livePrice],
                            y: [Math.min(...(traces[0]?.y || [0])) * 1.5, Math.max(...(traces[0]?.y || [0])) * 1.5],
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            name: 'Current',
                            line: { color: '#fbbf24', width: 2, dash: 'dot' as const },
                            showlegend: false,
                        },
                        // Zero line
                        {
                            x: [priceRange[0], priceRange[priceRange.length - 1]],
                            y: [0, 0],
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            line: { color: '#374151', width: 1 },
                            showlegend: false,
                            hoverinfo: 'skip' as const,
                        },
                    ]}
                    layout={{
                        autosize: true,
                        margin: { l: 55, r: 20, t: 10, b: 40 },
                        paper_bgcolor: 'transparent',
                        plot_bgcolor: 'transparent',
                        font: { color: '#7d8590', size: 10, family: 'system-ui' },
                        dragmode: 'pan',
                        xaxis: {
                            gridcolor: 'rgba(48, 54, 61, 0.4)',
                            gridwidth: 1,
                            tickformat: '$,.0f',
                            tickfont: { size: 10, color: '#7d8590' },
                            showspikes: true,
                            spikecolor: '#58a6ff',
                            spikethickness: 1,
                            spikedash: 'dot',
                            spikemode: 'across',
                            rangeslider: { visible: false },
                        },
                        yaxis: {
                            gridcolor: 'rgba(48, 54, 61, 0.4)',
                            gridwidth: 1,
                            zerolinecolor: '#58a6ff',
                            zerolinewidth: 1,
                            tickfont: { size: 10, color: '#7d8590' },
                            showspikes: true,
                            spikecolor: '#58a6ff',
                            spikethickness: 1,
                            spikedash: 'dot',
                        },
                        showlegend: false,
                        hovermode: 'x unified',
                        hoverlabel: {
                            bgcolor: 'rgba(13, 17, 23, 0.95)',
                            bordercolor: 'rgba(88, 166, 255, 0.3)',
                            font: { color: '#e6edf3', size: 12, family: 'system-ui' },
                        },
                        transition: { duration: 300, easing: 'cubic-in-out' },
                    }}
                    config={{
                        displayModeBar: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
                        responsive: true,
                        scrollZoom: true,
                    }}
                    style={{ width: '100%', height: '100%' }}
                />
            </div>

            {/* Footer - Greeks at current price */}
            <div className="px-3 py-2 border-t border-[rgba(48,54,61,0.5)] bg-[rgba(255,255,255,0.02)]">
                <div className="grid grid-cols-4 gap-2 text-xs">
                    {perSourceData.map(data => (
                        (Object.keys(greekColors) as GreekType[]).map((greek) => (
                            visibleGreeks[greek] && (
                                <div
                                    key={`${data.source.sourceId}-${greek}`}
                                    className="flex items-center justify-between bg-black/30 rounded px-2 py-1"
                                >
                                    <span style={{ color: data.source.color }} className="font-medium">
                                        {data.source.label} {greek.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="font-mono text-white">
                                        {greek === 'gamma' ? data.greeksAtSpot[greek].toFixed(6) :
                                            greek === 'delta' ? data.greeksAtSpot[greek].toFixed(2) :
                                                `$${data.greeksAtSpot[greek].toFixed(2)}`}
                                    </span>
                                </div>
                            )
                        ))
                    ))}
                </div>
            </div>
        </div>
    );
}
