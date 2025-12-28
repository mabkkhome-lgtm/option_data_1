'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateOptionPrice, generatePriceRange } from '@/lib/options/blackScholes';

/**
 * PayoffChart Widget - ECharts Version (SSR-Safe)
 */

interface PayoffChartProps {
    widgetId: string;
}

export function PayoffChartWidget({ widgetId }: PayoffChartProps) {
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

    const [daysToExpiry, setDaysToExpiry] = useState(30);
    const [showExpiry, setShowExpiry] = useState(true);
    const [showNow, setShowNow] = useState(true);

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
                    const size = trade.size || 1;
                    const premium = (trade.price || 0) * (trade.underlying || trade.indexPrice || baseUnderlying);
                    const iv = trade.iv ? trade.iv / 100 : 0.8;

                    let intrinsicValue = 0;
                    if (isCall) {
                        intrinsicValue = Math.max(0, spotPrice - strike);
                    } else {
                        intrinsicValue = Math.max(0, strike - spotPrice);
                    }
                    const expiryValue = intrinsicValue * size;
                    const cost = premium * size;
                    expiryPnL += isLong ? (expiryValue - cost) : (cost - expiryValue);

                    const currentPrice = calculateOptionPrice(spotPrice, strike, T, r, iv, isCall ? 'call' : 'put');
                    const currentValue = currentPrice * size;
                    currentPnL += isLong ? (currentValue - cost) : (cost - currentValue);
                }

                expiryPayoffs.push(expiryPnL);
                currentPayoffs.push(currentPnL);
            }

            const spotIdx = prices.findIndex(p => p >= livePrice) || Math.floor(prices.length / 2);
            const pnlAtSpot = expiryPayoffs[spotIdx] || 0;

            return { source, prices, expiryPayoffs, currentPayoffs, pnlAtSpot };
        });

        return { prices, sourcesData };
    }, [connectedSources, livePrice, daysToExpiry, hasData]);

    const totalPnL = chartData?.sourcesData.reduce((sum, d) => sum + d.pnlAtSpot, 0) || 0;
    const isProfitable = totalPnL >= 0;

    // Initialize and update ECharts
    useEffect(() => {
        if (!chartRef.current || !echarts) return;

        if (!chartInstance.current) {
            chartInstance.current = echarts.init(chartRef.current, 'dark');
        }

        const chart = chartInstance.current;
        const prices = chartData?.prices || [];
        const series: any[] = [];

        chartData?.sourcesData.forEach(data => {
            if (showExpiry) {
                series.push({
                    name: `${data.source.label} Expiry`,
                    type: 'line',
                    data: data.expiryPayoffs.map((v, i) => [prices[i], v]),
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { color: data.source.color || '#a855f7', width: 2 },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(34, 197, 94, 0.3)' },
                            { offset: 0.5, color: 'rgba(0, 0, 0, 0)' },
                            { offset: 1, color: 'rgba(239, 68, 68, 0.3)' },
                        ]),
                    },
                });
            }

            if (showNow) {
                series.push({
                    name: `${data.source.label} Now`,
                    type: 'line',
                    data: data.currentPayoffs.map((v, i) => [prices[i], v]),
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { color: '#22d3ee', width: 2, type: 'dashed' },
                });
            }
        });

        // Zero line and current price marker
        series.push({
            name: 'Breakeven',
            type: 'line',
            markLine: { silent: true, symbol: 'none', lineStyle: { color: '#58a6ff', type: 'solid', width: 1 }, data: [{ yAxis: 0 }], label: { show: false } },
            data: [],
        });

        if (livePrice && prices.length > 0) {
            series.push({
                name: 'Current Price',
                type: 'line',
                markLine: { silent: true, symbol: 'none', lineStyle: { color: '#fbbf24', type: 'dashed', width: 2 }, data: [{ xAxis: livePrice }], label: { formatter: '${c}', color: '#fbbf24' } },
                data: [],
            });
        }

        const option = {
            backgroundColor: 'transparent',
            animation: true,
            animationDuration: 300,
            grid: { left: 65, right: 20, top: 20, bottom: 60 },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(13, 17, 23, 0.95)',
                borderColor: 'rgba(88, 166, 255, 0.3)',
                textStyle: { color: '#e6edf3' },
                axisPointer: { type: 'cross', lineStyle: { color: '#58a6ff', type: 'dashed' } },
                // Format tooltip values to 2 decimal places
                valueFormatter: (value: number) => '$' + value.toFixed(2),
            },
            xAxis: {
                type: 'value',
                name: 'Underlying Price',
                nameLocation: 'center',
                nameGap: 30,
                axisLine: { lineStyle: { color: '#484f58' } },
                axisLabel: { color: '#7d8590', formatter: (v: number) => '$' + v.toLocaleString() },
                splitLine: { show: false },  // NO GRID LINES
            },
            yAxis: {
                type: 'value',
                name: 'P&L ($)',
                axisLine: { lineStyle: { color: '#484f58' } },
                axisLabel: { color: '#7d8590', formatter: (v: number) => '$' + v.toLocaleString() },
                splitLine: { show: false },  // NO GRID LINES
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

        // Use notMerge: false to PRESERVE dataZoom state during updates!
        chart.setOption(option, { notMerge: false, lazyUpdate: true });

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
    }, [chartData, showExpiry, showNow, livePrice, echarts]);

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
                    <span className="text-sm font-mono font-bold text-white">${livePrice.toLocaleString()}</span>
                </div>

                <div className={`flex items-center gap-1 px-2 py-1 rounded-lg ${isProfitable ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                    {isProfitable ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
                    <span className={`text-sm font-mono font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
                        {isProfitable ? '+' : ''}${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <button onClick={() => setShowExpiry(!showExpiry)} className={`text-[10px] px-2 py-0.5 rounded ${showExpiry ? 'bg-purple-500/30 text-purple-300' : 'text-gray-500'}`}>Expiry</button>
                    <button onClick={() => setShowNow(!showNow)} className={`text-[10px] px-2 py-0.5 rounded ${showNow ? 'bg-cyan-500/30 text-cyan-300' : 'text-gray-500'}`}>Now</button>
                </div>

                <div className="flex items-center gap-1 text-xs">
                    <span className="text-gray-500">DTE</span>
                    <input type="number" value={daysToExpiry} onChange={(e) => setDaysToExpiry(Math.max(1, Math.min(365, Number(e.target.value))))} className="w-12 bg-black/30 text-white px-1.5 py-0.5 rounded border border-cyan-500/30 text-center" min="1" max="365" />
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
                <div className="flex items-center gap-4 text-xs">
                    {chartData?.sourcesData.map(data => {
                        const pnl = data.pnlAtSpot;
                        const isProfit = pnl >= 0;
                        return (
                            <div key={data.source.sourceId} className="flex items-center gap-2">
                                <span style={{ color: data.source.color }} className="font-medium">{data.source.label}</span>
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
