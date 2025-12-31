'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Zap, Activity, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { curveMonotoneX } from '@visx/curve';
import { bisector } from 'd3-array';
import { localPoint } from '@visx/event';
import { Zoom } from '@visx/zoom';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';

import { useLivePriceStore } from '@/stores/livePrice';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { calculateGreeks, generatePriceRange } from '@/lib/options/blackScholes';

interface CombinedChartProps {
    widgetId: string;
}

interface DataPoint {
    price: number;
    value: number;
}

interface TooltipData {
    price: number;
    payoffExpiry: number;
    payoffNow: number;
    delta: number;
    gamma: number;
}

// Curve colors matching Thales style
const curveColors = {
    payoffExpiry: '#ef4444',  // Red - P at expiry
    payoffNow: '#f97316',     // Orange - P now  
    delta: '#22c55e',         // Green - Delta
    gamma: '#a855f7',         // Purple - Gamma
};

// Tooltip styles
const tooltipStyles = {
    ...defaultStyles,
    background: 'rgba(13, 17, 23, 0.95)',
    border: '1px solid rgba(88, 166, 255, 0.3)',
    color: '#e6edf3',
    fontSize: '11px',
    padding: '8px 12px',
    borderRadius: '8px',
};

export const CombinedChartWidget = memo(function CombinedChartWidget({ widgetId }: CombinedChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [daysToExpiry, setDaysToExpiry] = useState(7);
    const [visibleCurves, setVisibleCurves] = useState({
        payoffExpiry: true,
        payoffNow: true,
        delta: true,
        gamma: true,
    });
    const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; price: number } | null>(null);

    // Use correct store properties
    const { btcPrice, isConnected } = useLivePriceStore();
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
        useTooltip<TooltipData>();

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

    // Responsive sizing with ResizeObserver
    useEffect(() => {
        if (!containerRef.current) return;

        const updateDimensions = () => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                setDimensions({ width: rect.width, height: rect.height });
            }
        };

        updateDimensions();

        let rafId: number | null = null;
        const resizeObserver = new ResizeObserver(() => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(updateDimensions);
        });

        resizeObserver.observe(containerRef.current);
        window.addEventListener('resize', updateDimensions);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', updateDimensions);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    // Get trades from connected sources
    const trades = useMemo(() => {
        return connectedSources.flatMap((source: TradeSource) => source.trades);
    }, [connectedSources]);

    const hasData = trades.length > 0;
    const livePrice = btcPrice || 95000;
    const margin = { top: 20, right: 20, bottom: 50, left: 65 };
    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, dimensions.height - margin.top - margin.bottom);

    // Generate price range
    const prices = useMemo(() => {
        return generatePriceRange(livePrice, 0.20, 100);
    }, [livePrice]);

    // Calculate ALL data points
    const chartData = useMemo(() => {
        if (!hasData) return null;

        const payoffExpiry: DataPoint[] = [];
        const payoffNow: DataPoint[] = [];
        const delta: DataPoint[] = [];
        const gamma: DataPoint[] = [];

        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        for (const price of prices) {
            let totalPayoffExpiry = 0;
            let totalPayoffNow = 0;
            let totalDelta = 0;
            let totalGamma = 0;

            for (const trade of trades) {
                const strike = trade.strike;
                const type = trade.type as 'call' | 'put';
                const direction = trade.direction === 'buy' ? 1 : -1;
                const size = trade.size;
                const premium = trade.priceUSD || 0;
                const iv = trade.iv ? trade.iv / 100 : 0.5;

                // Payoff at expiry
                const intrinsic = type === 'call'
                    ? Math.max(0, price - strike)
                    : Math.max(0, strike - price);
                totalPayoffExpiry += (intrinsic * direction - premium) * size;

                // Greeks using library
                const greeks = calculateGreeks(price, strike, T, r, iv, type);

                // Payoff now (approximated)
                const bsValue = type === 'call'
                    ? Math.max(0, greeks.delta * (price - strike) + premium * 0.5)
                    : Math.max(0, -greeks.delta * (strike - price) + premium * 0.5);
                totalPayoffNow += (bsValue * direction - premium) * size;

                // Greeks - scaled for visibility
                totalDelta += greeks.delta * direction * size;
                totalGamma += greeks.gamma * Math.abs(size);
            }

            payoffExpiry.push({ price, value: totalPayoffExpiry });
            payoffNow.push({ price, value: totalPayoffNow });
            delta.push({ price, value: totalDelta * livePrice * 0.01 }); // Scale delta
            gamma.push({ price, value: totalGamma * livePrice * livePrice * 0.0001 }); // Scale gamma
        }

        return { payoffExpiry, payoffNow, delta, gamma };
    }, [hasData, trades, prices, daysToExpiry, livePrice]);

    // Chart bounds
    const chartBounds = useMemo(() => {
        if (!chartData) return { minX: 80000, maxX: 110000, minY: -10000, maxY: 10000 };

        const allValues: number[] = [];
        if (visibleCurves.payoffExpiry) allValues.push(...chartData.payoffExpiry.map(d => d.value));
        if (visibleCurves.payoffNow) allValues.push(...chartData.payoffNow.map(d => d.value));
        if (visibleCurves.delta) allValues.push(...chartData.delta.map(d => d.value));
        if (visibleCurves.gamma) allValues.push(...chartData.gamma.map(d => d.value));

        if (allValues.length === 0) return { minX: 80000, maxX: 110000, minY: -10000, maxY: 10000 };

        const minY = Math.min(...allValues);
        const maxY = Math.max(...allValues);
        const padding = Math.max(Math.abs(maxY - minY) * 0.15, 100);

        return {
            minX: prices[0],
            maxX: prices[prices.length - 1],
            minY: minY - padding,
            maxY: maxY + padding
        };
    }, [chartData, prices, visibleCurves]);

    // Initial zoom transform
    const initialTransform = {
        scaleX: 1,
        scaleY: 1,
        translateX: 0,
        translateY: 0,
        skewX: 0,
        skewY: 0,
    };

    // Bisector for tooltip
    const bisectPrice = bisector<DataPoint, number>(d => d.price).left;

    // Handle tooltip
    const handleTooltip = useCallback(
        (event: React.MouseEvent, xScale: any, yScale: any) => {
            if (!chartData) return;

            const point = localPoint(event);
            if (!point) return;

            const mouseX = point.x - margin.left;
            const mouseY = point.y - margin.top;
            const price = xScale.invert(mouseX);

            const idx = Math.min(bisectPrice(chartData.payoffExpiry, price, 1), chartData.payoffExpiry.length - 1);

            setCrosshairPos({
                x: Math.max(0, Math.min(innerWidth, mouseX)),
                y: Math.max(0, Math.min(innerHeight, mouseY)),
                price,
            });

            showTooltip({
                tooltipData: {
                    price,
                    payoffExpiry: chartData.payoffExpiry[idx]?.value || 0,
                    payoffNow: chartData.payoffNow[idx]?.value || 0,
                    delta: chartData.delta[idx]?.value || 0,
                    gamma: chartData.gamma[idx]?.value || 0,
                },
                tooltipLeft: point.x,
                tooltipTop: point.y,
            });
        },
        [chartData, margin, innerWidth, innerHeight, showTooltip, bisectPrice]
    );

    const toggleCurve = (curve: keyof typeof visibleCurves) => {
        setVisibleCurves(prev => ({ ...prev, [curve]: !prev[curve] }));
    };

    if (!hasData) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-foreground-muted bg-transparent p-4">
                <Activity size={32} className="mb-2 opacity-50" />
                <p className="text-sm">Connect trades from a Market Screener</p>
                <p className="text-xs opacity-60 mt-1">Use the socket handle on the left</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-transparent">
            {/* Header with curve toggles */}
            <div className="px-3 py-2 border-b border-[rgba(48,54,61,0.5)] flex items-center gap-2 bg-[rgba(255,255,255,0.02)]">
                {/* Curve toggles - styled like Thales */}
                <div className="flex flex-col gap-0.5">
                    {Object.entries(curveColors).map(([key, color]) => (
                        <button
                            key={key}
                            onClick={() => toggleCurve(key as keyof typeof visibleCurves)}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold transition-opacity ${visibleCurves[key as keyof typeof visibleCurves] ? 'opacity-100' : 'opacity-30'
                                }`}
                            style={{ color }}
                        >
                            {key === 'payoffExpiry' ? 'P' : key === 'payoffNow' ? 'P' : key === 'delta' ? 'D' : 'G'}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                {/* Live price */}
                <div className="flex items-center gap-2 bg-black/30 px-2 py-1 rounded-lg">
                    <Zap size={12} className={isConnected ? 'text-green-400' : 'text-gray-500'} />
                    <span className="text-xs text-gray-400">BTC</span>
                    <span className="text-sm font-mono font-bold text-white">${livePrice.toLocaleString()}</span>
                </div>

                {/* Days to expiry */}
                <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-gray-500">DTE:</span>
                    <input
                        type="number"
                        value={daysToExpiry}
                        onChange={(e) => setDaysToExpiry(Math.max(1, Math.min(365, Number(e.target.value))))}
                        className="w-12 bg-black/30 text-white px-1.5 py-0.5 rounded border border-cyan-500/30 text-center"
                        min="1"
                        max="365"
                    />
                </div>
            </div>

            {/* Chart with Zoom/Pan */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 nodrag nowheel nopan"
                style={{ touchAction: 'none', position: 'relative', overflow: 'hidden' }}
            >
                {innerWidth > 0 && innerHeight > 0 && chartData && (
                    <Zoom<SVGSVGElement>
                        width={dimensions.width}
                        height={dimensions.height}
                        scaleXMin={0.5}
                        scaleXMax={5}
                        scaleYMin={0.5}
                        scaleYMax={5}
                        initialTransformMatrix={initialTransform}
                    >
                        {(zoom) => {
                            // Base scales
                            const baseXScale = scaleLinear({
                                domain: [chartBounds.minX, chartBounds.maxX],
                                range: [0, innerWidth],
                            });
                            const baseYScale = scaleLinear({
                                domain: [chartBounds.minY, chartBounds.maxY],
                                range: [innerHeight, 0],
                            });

                            // Zoomed scales
                            const { scaleX, scaleY, translateX, translateY } = zoom.transformMatrix;
                            const zoomedXDomain = [
                                baseXScale.invert(-translateX / scaleX),
                                baseXScale.invert((innerWidth - translateX) / scaleX),
                            ];
                            const zoomedYDomain = [
                                baseYScale.invert((innerHeight - translateY) / scaleY),
                                baseYScale.invert(-translateY / scaleY),
                            ];

                            const xScale = scaleLinear({ domain: zoomedXDomain, range: [0, innerWidth] });
                            const yScale = scaleLinear({ domain: zoomedYDomain, range: [innerHeight, 0] });

                            return (
                                <>
                                    <svg
                                        width={dimensions.width}
                                        height={dimensions.height}
                                        ref={zoom.containerRef}
                                        style={{ cursor: zoom.isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                                        onMouseDown={zoom.dragStart}
                                        onMouseMove={(e) => {
                                            zoom.dragMove(e);
                                            if (!zoom.isDragging) handleTooltip(e, xScale, yScale);
                                        }}
                                        onMouseUp={zoom.dragEnd}
                                        onMouseLeave={() => {
                                            zoom.dragEnd();
                                            hideTooltip();
                                            setCrosshairPos(null);
                                        }}
                                        onTouchStart={zoom.dragStart}
                                        onTouchMove={zoom.dragMove}
                                        onTouchEnd={zoom.dragEnd}
                                        onWheel={(e) => {
                                            e.stopPropagation();
                                            const point = localPoint(e);
                                            if (point) {
                                                zoom.scale({ scaleX: e.deltaY > 0 ? 0.95 : 1.05, scaleY: e.deltaY > 0 ? 0.95 : 1.05, point });
                                            }
                                        }}
                                    >
                                        <rect width={dimensions.width} height={dimensions.height} fill="transparent" />

                                        <Group left={margin.left} top={margin.top}>
                                            {/* Grid */}
                                            <GridRows scale={yScale} width={innerWidth} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />
                                            <GridColumns scale={xScale} height={innerHeight} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />

                                            {/* Zero line */}
                                            <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="#58a6ff" strokeWidth={1} />

                                            {/* Current price line */}
                                            <line x1={xScale(livePrice)} x2={xScale(livePrice)} y1={0} y2={innerHeight} stroke="#fbbf24" strokeWidth={2} strokeDasharray="4,4" />

                                            {/* Curves */}
                                            {visibleCurves.payoffExpiry && (
                                                <LinePath data={chartData.payoffExpiry} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.payoffExpiry} strokeWidth={2} curve={curveMonotoneX} />
                                            )}
                                            {visibleCurves.payoffNow && (
                                                <LinePath data={chartData.payoffNow} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.payoffNow} strokeWidth={2} curve={curveMonotoneX} />
                                            )}
                                            {visibleCurves.delta && (
                                                <LinePath data={chartData.delta} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.delta} strokeWidth={2} curve={curveMonotoneX} />
                                            )}
                                            {visibleCurves.gamma && (
                                                <LinePath data={chartData.gamma} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.gamma} strokeWidth={2} curve={curveMonotoneX} />
                                            )}

                                            {/* Crosshair */}
                                            {crosshairPos && (
                                                <>
                                                    <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                                    <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                                </>
                                            )}

                                            {/* Y Axis */}
                                            <AxisLeft
                                                scale={yScale}
                                                tickFormat={v => {
                                                    const val = Number(v);
                                                    if (Math.abs(val) >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                                                    if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}K`;
                                                    return val.toFixed(0);
                                                }}
                                                stroke="rgba(125, 133, 144, 0.3)"
                                                tickStroke="rgba(125, 133, 144, 0.3)"
                                                tickLabelProps={() => ({ fill: '#7d8590', fontSize: 10, textAnchor: 'end', dy: 4 })}
                                                numTicks={6}
                                            />

                                            {/* X Axis */}
                                            <AxisBottom
                                                scale={xScale}
                                                top={innerHeight}
                                                tickFormat={v => `${(Number(v) / 1000).toFixed(0)}K`}
                                                stroke="rgba(125, 133, 144, 0.3)"
                                                tickStroke="rgba(125, 133, 144, 0.3)"
                                                tickLabelProps={() => ({ fill: '#7d8590', fontSize: 10, textAnchor: 'middle', dy: -4 })}
                                                numTicks={6}
                                            />
                                        </Group>
                                    </svg>

                                    {/* Zoom controls */}
                                    <div className="absolute bottom-2 right-2 flex gap-1">
                                        <button
                                            onClick={() => zoom.scale({ scaleX: 1.2, scaleY: 1.2 })}
                                            className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                            title="Zoom In"
                                        >
                                            <ZoomIn size={14} />
                                        </button>
                                        <button
                                            onClick={() => zoom.scale({ scaleX: 0.8, scaleY: 0.8 })}
                                            className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                            title="Zoom Out"
                                        >
                                            <ZoomOut size={14} />
                                        </button>
                                        <button
                                            onClick={() => zoom.reset()}
                                            className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                            title="Reset"
                                        >
                                            <RotateCcw size={14} />
                                        </button>
                                    </div>
                                </>
                            );
                        }}
                    </Zoom>
                )}

                {/* Tooltip */}
                {tooltipOpen && tooltipData && (
                    <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
                        <div className="font-mono space-y-0.5">
                            <div className="text-cyan-400 font-bold">
                                ${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            {visibleCurves.payoffExpiry && (
                                <div style={{ color: curveColors.payoffExpiry }}>
                                    P(exp): ${tooltipData.payoffExpiry.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                            {visibleCurves.payoffNow && (
                                <div style={{ color: curveColors.payoffNow }}>
                                    P(now): ${tooltipData.payoffNow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                            {visibleCurves.delta && (
                                <div style={{ color: curveColors.delta }}>
                                    Δ: {tooltipData.delta.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                            {visibleCurves.gamma && (
                                <div style={{ color: curveColors.gamma }}>
                                    Γ: {tooltipData.gamma.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                        </div>
                    </TooltipWithBounds>
                )}
            </div>
        </div>
    );
});

export default CombinedChartWidget;
