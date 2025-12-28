'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Play, Pause, RotateCcw, TrendingUp } from 'lucide-react';
import { useStrategyStore } from '@/stores';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { calculateGreeks, generatePriceRange } from '@/lib/options/blackScholes';
import type { ScreenerRow } from '@/components/widgets/MarketScreener';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

/**
 * GreeksViz Widget - Multi-Source Support
 * 
 * When multiple screeners are connected, shows SEPARATE curves for each:
 * - Longs source → Green curves
 * - Shorts source → Red curves
 * 
 * Each source gets its own Delta, Gamma, Theta, Vega curves with
 * the source's assigned color.
 */

type GreekType = 'delta' | 'gamma' | 'theta' | 'vega';

const GREEK_CONFIG: Record<GreekType, { label: string; unit: string; yaxis: string }> = {
    delta: { label: 'Δ', unit: '', yaxis: 'y' },
    gamma: { label: 'Γ', unit: '', yaxis: 'y2' },
    theta: { label: 'Θ', unit: '$/day', yaxis: 'y' },
    vega: { label: 'ν', unit: '$/1%', yaxis: 'y2' },
};

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
    const { activeStrategy } = useStrategyStore();

    // Get raw state from store (stable references)
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    // Get connected sources for this widget
    const connectedSources = useMemo(() => {
        const connectedIds = connections
            .filter(c => c.targetId === widgetId)
            .map(c => c.sourceId);

        if (connectedIds.length === 0) {
            // Fallback: create a default source from all trades
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
        gamma: true,
        theta: false,
        vega: false,
    });
    const [daysToExpiry, setDaysToExpiry] = useState(30);
    const [isAnimating, setIsAnimating] = useState(false);
    const [spotOffset, setSpotOffset] = useState(0);
    const animationRef = useRef<NodeJS.Timeout | null>(null);

    // Auto-detect DTE from first source's trades
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

    // Animation for spot offset sweep
    useEffect(() => {
        if (isAnimating) {
            animationRef.current = setInterval(() => {
                setSpotOffset(prev => {
                    if (prev >= 20) {
                        setIsAnimating(false);
                        return 20;
                    }
                    return prev + 1;
                });
            }, 150);
        } else if (animationRef.current) {
            clearInterval(animationRef.current);
        }
        return () => {
            if (animationRef.current) clearInterval(animationRef.current);
        };
    }, [isAnimating]);

    const hasData = connectedSources.length > 0;

    // Calculate Greeks for EACH source separately
    const perSourceData = useMemo((): SourceGreeksData[] => {
        if (!hasData) return [];

        // Find base underlying from first trade of first source
        const firstTrade = connectedSources[0]?.trades[0];
        const baseUnderlying = firstTrade?.underlying || firstTrade?.indexPrice || 95000;
        const currentUnderlying = baseUnderlying * (1 + spotOffset / 100);

        // Price range: ±30% from base
        const prices = generatePriceRange(baseUnderlying, 0.3, 80);
        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        return connectedSources.map(source => {
            const greeks: Record<GreekType, number[]> = {
                delta: [],
                gamma: [],
                theta: [],
                vega: [],
            };

            for (const spotPrice of prices) {
                let totals = { delta: 0, gamma: 0, theta: 0, vega: 0 };

                for (const trade of source.trades) {
                    const isCall = trade.type === 'call';
                    const isLong = trade.direction === 'buy';
                    const strike = trade.strike;
                    const size = trade.size;
                    const iv = (trade.iv || 50) / 100;
                    const multiplier = isLong ? 1 : -1;

                    const g = calculateGreeks(spotPrice, strike, T, r, iv, isCall ? 'call' : 'put');

                    totals.delta += g.delta * multiplier * size;
                    totals.gamma += g.gamma * multiplier * size;
                    totals.theta += g.theta * multiplier * size;
                    totals.vega += g.vega * multiplier * size;
                }

                greeks.delta.push(totals.delta);
                greeks.gamma.push(totals.gamma);
                greeks.theta.push(totals.theta);
                greeks.vega.push(totals.vega);
            }

            // Find Greeks at current spot
            const spotIdx = prices.findIndex(p => p >= currentUnderlying);
            const greeksAtSpot = {
                delta: spotIdx >= 0 ? greeks.delta[spotIdx] : 0,
                gamma: spotIdx >= 0 ? greeks.gamma[spotIdx] : 0,
                theta: spotIdx >= 0 ? greeks.theta[spotIdx] : 0,
                vega: spotIdx >= 0 ? greeks.vega[spotIdx] : 0,
            };

            return {
                source,
                prices,
                greeks,
                greeksAtSpot,
            };
        });
    }, [connectedSources, daysToExpiry, spotOffset, hasData]);

    // Get current underlying for spot line
    const currentUnderlying = useMemo(() => {
        if (perSourceData.length === 0) return 95000;
        const firstTrade = connectedSources[0]?.trades[0];
        const base = firstTrade?.underlying || firstTrade?.indexPrice || 95000;
        return base * (1 + spotOffset / 100);
    }, [connectedSources, spotOffset, perSourceData]);

    const toggleGreek = (greek: GreekType) => {
        setVisibleGreeks(prev => ({ ...prev, [greek]: !prev[greek] }));
    };

    const startAnimation = () => {
        setSpotOffset(-20);
        setIsAnimating(true);
    };

    const resetAnimation = () => {
        setIsAnimating(false);
        setSpotOffset(0);
    };

    const formatGreek = (value: number, type: GreekType) => {
        if (type === 'gamma') return value.toFixed(6);
        if (type === 'delta') return value.toFixed(2);
        if (type === 'theta') return `$${value.toFixed(2)}`;
        if (type === 'vega') return `$${value.toFixed(2)}`;
        return value.toFixed(4);
    };

    // Empty state
    if (!hasData) {
        return (
            <div className="h-full flex items-center justify-center text-foreground-muted text-sm">
                <div className="text-center p-4">
                    <TrendingUp size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="font-medium">No Data Connected</p>
                    <p className="text-xs opacity-75 mt-1">
                        Connect Market Screeners to visualize Greeks
                    </p>
                </div>
            </div>
        );
    }

    // Build traces - one set of curves per source
    const traces: any[] = [];

    perSourceData.forEach((data, sourceIdx) => {
        const sourceColor = data.source.color || '#8b5cf6';
        const sourceLabel = data.source.label;
        const isFirstSource = sourceIdx === 0;

        (Object.keys(GREEK_CONFIG) as GreekType[])
            .filter(greek => visibleGreeks[greek])
            .forEach((greek, greekIdx) => {
                // Vary opacity/dash for different Greeks within same source
                const lineStyles: Record<GreekType, { dash?: string; width: number }> = {
                    delta: { width: 2 },
                    gamma: { dash: 'dot', width: 2 },
                    theta: { dash: 'dash', width: 1.5 },
                    vega: { dash: 'dashdot', width: 1.5 },
                };

                traces.push({
                    x: data.prices,
                    y: data.greeks[greek],
                    type: 'scatter' as const,
                    mode: 'lines' as const,
                    name: `${sourceLabel} ${GREEK_CONFIG[greek].label}`,
                    line: {
                        color: sourceColor,
                        ...lineStyles[greek],
                    },
                    yaxis: GREEK_CONFIG[greek].yaxis,
                    legendgroup: sourceLabel,
                    showlegend: greekIdx === 0, // Only show one legend entry per source
                });
            });
    });

    // Add spot line and zero line
    const priceRange = perSourceData[0]?.prices || [80000, 110000];

    return (
        <div className="h-full flex flex-col p-2">
            {/* Controls */}
            <div className="flex items-center gap-2 pb-2 border-b border-border-color mb-2 flex-wrap">
                {/* Greek toggles */}
                {(Object.keys(GREEK_CONFIG) as GreekType[]).map((greek) => (
                    <button
                        key={greek}
                        onClick={() => toggleGreek(greek)}
                        className={`text-xs px-2 py-0.5 rounded border transition-all flex items-center gap-1 ${visibleGreeks[greek]
                            ? 'border-accent-primary/50 bg-accent-primary/20 font-medium'
                            : 'border-border-color opacity-40'
                            }`}
                    >
                        {GREEK_CONFIG[greek].label}
                    </button>
                ))}

                {/* DTE */}
                <div className="flex items-center gap-1 text-xs ml-2">
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

                {/* Spot offset */}
                <div className="flex items-center gap-1 text-xs">
                    <span className="text-foreground-muted">Spot:</span>
                    <input
                        type="range"
                        value={spotOffset}
                        onChange={(e) => setSpotOffset(Number(e.target.value))}
                        className="w-16 accent-accent-primary"
                        min="-20"
                        max="20"
                        step="1"
                    />
                    <span className={`w-10 font-mono ${spotOffset >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {spotOffset >= 0 ? '+' : ''}{spotOffset}%
                    </span>
                </div>

                {/* Animation controls */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={isAnimating ? () => setIsAnimating(false) : startAnimation}
                        className="p-1 bg-background-secondary hover:bg-background-tertiary rounded"
                        title={isAnimating ? 'Pause' : 'Animate spot sweep'}
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
                </div>

                <div className="flex-1" />

                {/* Source indicators */}
                <div className="flex items-center gap-2">
                    {connectedSources.map(source => (
                        <span
                            key={source.sourceId}
                            className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{
                                backgroundColor: `${source.color}20`,
                                color: source.color,
                            }}
                        >
                            {source.label} ({source.trades.length})
                        </span>
                    ))}
                </div>
            </div>

            {/* Chart */}
            <div
                className="flex-1 min-h-0"
                onWheel={(e) => e.stopPropagation()}
            >
                <Plot
                    data={[
                        ...traces,
                        // Current spot marker
                        {
                            x: [currentUnderlying, currentUnderlying],
                            y: [-Infinity, Infinity],
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            name: 'Spot',
                            line: { color: '#94a3b8', width: 1, dash: 'dash' as const },
                            showlegend: false,
                        },
                        // Zero line
                        {
                            x: [priceRange[0], priceRange[priceRange.length - 1]],
                            y: [0, 0],
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            line: { color: '#6b7280', width: 1, dash: 'dot' as const },
                            showlegend: false,
                            hoverinfo: 'skip' as const,
                        },
                    ]}
                    layout={{
                        autosize: true,
                        margin: { l: 55, r: 55, t: 10, b: 40 },
                        paper_bgcolor: 'transparent',
                        plot_bgcolor: 'transparent',
                        font: { color: '#e8e6f0', size: 10 },
                        dragmode: 'zoom',
                        xaxis: {
                            title: { text: 'Underlying Price', font: { size: 10 } },
                            gridcolor: 'rgba(100, 100, 120, 0.15)',
                            tickformat: '$,.0f',
                        },
                        yaxis: {
                            title: { text: 'Delta / Theta', font: { size: 10 } },
                            gridcolor: 'rgba(100, 100, 120, 0.15)',
                            zerolinecolor: '#6b7280',
                            side: 'left',
                        },
                        yaxis2: {
                            title: { text: 'Gamma / Vega', font: { size: 10 } },
                            overlaying: 'y',
                            side: 'right',
                            gridcolor: 'rgba(100, 100, 120, 0.05)',
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

            {/* Per-Source Greeks Footer */}
            <div className="pt-2 border-t border-border-color mt-1">
                <div className="space-y-1">
                    {perSourceData.map(data => (
                        <div
                            key={data.source.sourceId}
                            className="flex items-center gap-2 text-xs"
                        >
                            <span
                                className="font-medium w-16 text-right"
                                style={{ color: data.source.color }}
                            >
                                {data.source.label}:
                            </span>
                            <div className="grid grid-cols-4 gap-2 flex-1">
                                {(Object.keys(GREEK_CONFIG) as GreekType[]).map((greek) => (
                                    <div
                                        key={greek}
                                        className="font-mono text-center"
                                        style={{ opacity: visibleGreeks[greek] ? 1 : 0.3 }}
                                    >
                                        <span className="text-foreground-muted text-[10px]">{GREEK_CONFIG[greek].label}</span>
                                        <span className="ml-1">{formatGreek(data.greeksAtSpot[greek], greek)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
