'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateGreeks, generatePriceRange } from '@/lib/options/blackScholes';

/**
 * GreeksViz Widget - ECharts Version (SSR-Safe)
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

const greekColors: Record<GreekType, string> = {
    delta: '#22c55e',
    gamma: '#a855f7',
    theta: '#ef4444',
    vega: '#fbbf24',
};

export function GreeksVizWidget({ widgetId }: GreeksVizProps) {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<any>(null);
    const [echarts, setEcharts] = useState<any>(null);

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

    // Load ECharts dynamically (SSR-safe)
    useEffect(() => {
        import('echarts').then(mod => {
            setEcharts(mod);
        });
    }, []);

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

        return connectedSources.map(source => {
            const greeks: Record<GreekType, number[]> = {
                delta: [], gamma: [], theta: [], vega: []
            };
            const greeksAtSpot: Record<GreekType, number> = {
                delta: 0, gamma: 0, theta: 0, vega: 0
            };

            for (const price of prices) {
                let deltaSum = 0, gammaSum = 0, thetaSum = 0, vegaSum = 0;

                for (const trade of source.trades) {
                    const strike = trade.strike || 0;
                    const isCall = trade.type === 'call';
                    const isLong = trade.direction === 'buy';
                    const size = trade.size || 1;
                    const iv = trade.iv ? trade.iv / 100 : 0.8;
                    const multiplier = isLong ? size : -size;

                    const g = calculateGreeks(price, strike, T, 0.05, iv, isCall ? 'call' : 'put');
                    deltaSum += g.delta * multiplier;
                    gammaSum += g.gamma * multiplier;
                    thetaSum += g.theta * multiplier;
                    vegaSum += g.vega * multiplier;
                }

                greeks.delta.push(deltaSum);
                greeks.gamma.push(gammaSum);
                greeks.theta.push(thetaSum);
                greeks.vega.push(vegaSum);
            }

            const spotIdx = Math.floor(prices.length / 2);
            greeksAtSpot.delta = greeks.delta[spotIdx] || 0;
            greeksAtSpot.gamma = greeks.gamma[spotIdx] || 0;
            greeksAtSpot.theta = greeks.theta[spotIdx] || 0;
            greeksAtSpot.vega = greeks.vega[spotIdx] || 0;

            return { source, prices, greeks, greeksAtSpot };
        });
    }, [connectedSources, livePrice, daysToExpiry, hasData]);

    const toggleGreek = (greek: GreekType) => {
        setVisibleGreeks(prev => ({ ...prev, [greek]: !prev[greek] }));
    };

    // Initialize and update ECharts
    useEffect(() => {
        if (!chartRef.current || !echarts) return;

        // Initialize chart
        if (!chartInstance.current) {
            chartInstance.current = echarts.init(chartRef.current, 'dark');
        }

        const chart = chartInstance.current;
        const priceRange = perSourceData[0]?.prices || [];

        // Build series data
        const series: any[] = [];

        perSourceData.forEach(data => {
            (Object.keys(greekColors) as GreekType[]).forEach(greek => {
                if (visibleGreeks[greek]) {
                    series.push({
                        name: `${data.source.label} ${greek}`,
                        type: 'line',
                        data: data.greeks[greek].map((v, i) => [priceRange[i], v]),
                        smooth: true,
                        symbol: 'none',
                        lineStyle: {
                            color: greekColors[greek],
                            width: 2,
                        },
                        areaStyle: {
                            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                { offset: 0, color: greekColors[greek] + '40' },
                                { offset: 1, color: greekColors[greek] + '00' },
                            ]),
                        },
                    });
                }
            });
        });

        // Add current price marker
        if (livePrice && priceRange.length > 0) {
            series.push({
                name: 'Current Price',
                type: 'line',
                markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { color: '#fbbf24', type: 'dashed', width: 2 },
                    data: [{ xAxis: livePrice }],
                    label: { formatter: '${c}', color: '#fbbf24' },
                },
                data: [],
            });
        }

        const option = {
            backgroundColor: 'transparent',
            animation: true,
            animationDuration: 300,
            grid: { left: 60, right: 20, top: 20, bottom: 60 },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(13, 17, 23, 0.95)',
                borderColor: 'rgba(88, 166, 255, 0.3)',
                textStyle: { color: '#e6edf3' },
                axisPointer: { type: 'cross', lineStyle: { color: '#58a6ff', type: 'dashed' } },
            },
            xAxis: {
                type: 'value',
                name: 'Price',
                nameLocation: 'center',
                nameGap: 30,
                axisLine: { lineStyle: { color: '#484f58' } },
                axisLabel: { color: '#7d8590', formatter: (v: number) => '$' + v.toLocaleString() },
                splitLine: { lineStyle: { color: 'rgba(48, 54, 61, 0.4)' } },
            },
            yAxis: {
                type: 'value',
                axisLine: { lineStyle: { color: '#484f58' } },
                axisLabel: { color: '#7d8590' },
                splitLine: { lineStyle: { color: 'rgba(48, 54, 61, 0.4)' } },
            },
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: 0,
                    zoomOnMouseWheel: true,   // Scroll to zoom
                    moveOnMouseWheel: false,  // Don't pan on scroll
                    moveOnMouseMove: true,    // DRAG TO PAN - enabled!
                    preventDefaultMouseMove: true,
                    filterMode: 'none',       // Don't filter data on zoom
                },
                {
                    type: 'inside',
                    yAxisIndex: 0,
                    zoomOnMouseWheel: true,
                    moveOnMouseWheel: false,
                    moveOnMouseMove: true,    // DRAG TO PAN - enabled!
                    filterMode: 'none',
                },
                {
                    type: 'slider',
                    xAxisIndex: 0,
                    height: 25,
                    bottom: 5,
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(48, 54, 61, 0.4)',
                    fillerColor: 'rgba(88, 166, 255, 0.3)',
                    handleStyle: { color: '#58a6ff', borderColor: '#58a6ff' },
                    textStyle: { color: '#7d8590' },
                    dataBackground: {
                        lineStyle: { color: 'rgba(88, 166, 255, 0.3)' },
                        areaStyle: { color: 'rgba(88, 166, 255, 0.1)' },
                    },
                },
            ],
            series,
        };

        chart.setOption(option, true);

        // Handle resize with error protection
        let resizeObserver: ResizeObserver | null = null;
        try {
            resizeObserver = new ResizeObserver(() => {
                try {
                    if (chart && !chart.isDisposed()) {
                        chart.resize();
                    }
                } catch (e) {
                    console.warn('Chart resize error:', e);
                }
            });
            if (chartRef.current) {
                resizeObserver.observe(chartRef.current);
            }
        } catch (e) {
            console.warn('ResizeObserver error:', e);
        }

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
        };
    }, [perSourceData, visibleGreeks, livePrice, echarts]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            try {
                if (chartInstance.current && !chartInstance.current.isDisposed()) {
                    chartInstance.current.dispose();
                }
            } catch (e) {
                console.warn('Chart dispose error:', e);
            }
            chartInstance.current = null;
        };
    }, []);

    return (
        <div className="h-full flex flex-col bg-transparent">
            {/* Header */}
            <div className="px-3 py-2 border-b border-[rgba(48,54,61,0.5)] flex items-center gap-3 bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-2 bg-black/30 px-2 py-1 rounded-lg">
                    <Zap size={12} className={isConnected ? 'text-green-400' : 'text-gray-500'} />
                    <span className="text-xs text-gray-400">BTC</span>
                    <span className="text-sm font-mono font-bold text-white">
                        ${livePrice.toLocaleString()}
                    </span>
                </div>

                <div className="flex items-center gap-1">
                    {(['delta', 'gamma', 'theta', 'vega'] as GreekType[]).map((greek) => (
                        <button
                            key={greek}
                            onClick={() => toggleGreek(greek)}
                            className={`text-[10px] px-2 py-0.5 rounded font-medium transition-all ${visibleGreeks[greek] ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                            style={visibleGreeks[greek] ? { borderBottom: `2px solid ${greekColors[greek]}` } : {}}
                        >
                            {greek.charAt(0).toUpperCase() + greek.slice(1)}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-1 text-xs ml-auto">
                    <span className="text-gray-500">DTE</span>
                    <input
                        type="number"
                        value={daysToExpiry}
                        onChange={(e) => setDaysToExpiry(Math.max(1, Math.min(365, Number(e.target.value))))}
                        className="w-12 bg-black/30 text-white px-1.5 py-0.5 rounded border border-cyan-500/30 text-center"
                        min="1" max="365"
                    />
                </div>
            </div>

            {/* Chart */}
            <div className="flex-1 min-h-0">
                {!echarts ? (
                    <div className="flex items-center justify-center h-full text-gray-500">Loading chart...</div>
                ) : (
                    <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
                )}
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-[rgba(48,54,61,0.5)] bg-[rgba(255,255,255,0.02)]">
                <div className="grid grid-cols-4 gap-2 text-xs">
                    {perSourceData.map(data => (
                        (Object.keys(greekColors) as GreekType[]).map((greek) => (
                            visibleGreeks[greek] && (
                                <div key={`${data.source.sourceId}-${greek}`} className="flex items-center justify-between bg-black/30 rounded px-2 py-1">
                                    <span style={{ color: greekColors[greek] }} className="font-medium">{greek.charAt(0).toUpperCase()}</span>
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
