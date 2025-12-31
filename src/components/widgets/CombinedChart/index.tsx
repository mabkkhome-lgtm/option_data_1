'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Zap, Activity, RotateCcw } from 'lucide-react';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { curveMonotoneX } from '@visx/curve';
import { bisector } from 'd3-array';
import { localPoint } from '@visx/event';
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

interface ChartDataSet {
    payoffExpiry: DataPoint[];
    payoffNow: DataPoint[];
    delta: DataPoint[];
    gamma: DataPoint[];
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

type DragMode = 'none' | 'pan' | 'xAxis' | 'yAxis';

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

    // Thales-style zoom/pan state
    const [zoomX, setZoomX] = useState(1);
    const [zoomY, setZoomY] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [dragMode, setDragMode] = useState<DragMode>('none');
    const [hoverZone, setHoverZone] = useState<DragMode>('none');
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, zoomX: 1, zoomY: 1, panX: 0, panY: 0 });

    // Use correct store properties
    const { btcPrice, isConnected } = useLivePriceStore();
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
        useTooltip<TooltipData>();

    // Get connected sources - FIXED: properly handle multiple connections
    const connectedSources = useMemo(() => {
        const connectedIds = connections
            .filter(c => c.targetId === widgetId)
            .map(c => c.sourceId);

        if (connectedIds.length === 0) {
            // Fallback to all trades if no connections
            if (allTrades.length > 0) {
                return [{
                    sourceId: 'default',
                    label: 'All Trades',
                    trades: allTrades,
                    color: '#8b5cf6'
                }] as TradeSource[];
            }
            return [];
        }

        // Get all connected sources
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

    // Get ALL trades from ALL connected sources - FIXED: aggregate properly
    const trades = useMemo(() => {
        return connectedSources.flatMap((source: TradeSource) => source.trades);
    }, [connectedSources]);

    const hasData = trades.length > 0;
    const livePrice = btcPrice || 95000;
    const margin = { top: 20, right: 20, bottom: 50, left: 65 };
    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, dimensions.height - margin.top - margin.bottom);

    // Generate price range centered on live price
    const prices = useMemo(() => {
        return generatePriceRange(livePrice, 0.30, 150);
    }, [livePrice]);

    // Calculate RAW data points - FIXED: aggregate from ALL trades
    const rawData = useMemo((): ChartDataSet | null => {
        if (!hasData) return null;

        const payoffExpiry: DataPoint[] = [];
        const payoffNow: DataPoint[] = [];
        const delta: DataPoint[] = [];
        const gamma: DataPoint[] = [];

        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        for (const price of prices) {
            let totalPayoffExpiry = 0;
            let totalDelta = 0;
            let totalGamma = 0;
            let totalPayoffNow = 0;

            // Sum across ALL trades from ALL connected sources
            for (const trade of trades) {
                const strike = trade.strike;
                const type = trade.type as 'call' | 'put';
                const direction = trade.direction === 'buy' ? 1 : -1;
                const size = trade.size || 1;
                const premium = trade.priceUSD || 0;
                const iv = trade.iv ? trade.iv / 100 : 0.5;

                // Payoff at expiry
                const intrinsic = type === 'call'
                    ? Math.max(0, price - strike)
                    : Math.max(0, strike - price);
                totalPayoffExpiry += (intrinsic - premium) * direction * size;

                // Greeks
                const greeks = calculateGreeks(price, strike, T, r, iv, type);
                totalDelta += greeks.delta * direction * size;
                totalGamma += greeks.gamma * size;

                // Payoff now
                const bsApprox = greeks.delta * (price - strike) * 0.5 + premium;
                totalPayoffNow += (Math.max(0, bsApprox) - premium) * direction * size;
            }

            payoffExpiry.push({ price, value: totalPayoffExpiry });
            payoffNow.push({ price, value: totalPayoffNow });
            delta.push({ price, value: totalDelta });
            gamma.push({ price, value: totalGamma });
        }

        return { payoffExpiry, payoffNow, delta, gamma };
    }, [hasData, trades, prices, daysToExpiry]);

    // Calculate bounds
    const curveScales = useMemo(() => {
        if (!rawData) return null;

        const payoffValues = [
            ...rawData.payoffExpiry.map(d => d.value),
            ...rawData.payoffNow.map(d => d.value)
        ];
        const payoffMin = Math.min(...payoffValues);
        const payoffMax = Math.max(...payoffValues);
        const payoffPadding = Math.max(Math.abs(payoffMax - payoffMin) * 0.15, 100);

        const deltaValues = rawData.delta.map(d => d.value);
        const deltaMin = Math.min(...deltaValues);
        const deltaMax = Math.max(...deltaValues);
        const deltaRange = deltaMax - deltaMin || 1;

        const gammaValues = rawData.gamma.map(d => d.value);
        const gammaMin = Math.min(...gammaValues);
        const gammaMax = Math.max(...gammaValues);
        const gammaRange = gammaMax - gammaMin || 1;

        const payoffRange = (payoffMax - payoffMin) || 1;
        const greekScale = payoffRange * 0.4;

        return {
            minY: payoffMin - payoffPadding,
            maxY: payoffMax + payoffPadding,
            delta: { min: deltaMin, range: deltaRange, scale: greekScale / deltaRange },
            gamma: { min: gammaMin, range: gammaRange, scale: greekScale / gammaRange },
        };
    }, [rawData]);

    // Scale Greeks to fit
    const scaledData = useMemo(() => {
        if (!rawData || !curveScales) return null;

        const scaledDelta = rawData.delta.map(d => ({
            price: d.price,
            value: (d.value - curveScales.delta.min) * curveScales.delta.scale - curveScales.delta.scale * curveScales.delta.range * 0.5,
        }));

        const scaledGamma = rawData.gamma.map(d => ({
            price: d.price,
            value: (d.value - curveScales.gamma.min) * curveScales.gamma.scale - curveScales.gamma.scale * curveScales.gamma.range * 0.5,
        }));

        return {
            payoffExpiry: rawData.payoffExpiry,
            payoffNow: rawData.payoffNow,
            delta: scaledDelta,
            gamma: scaledGamma,
        };
    }, [rawData, curveScales]);

    // Base chart bounds - CENTERED on zero for break-even visibility
    const baseBounds = useMemo(() => {
        if (!curveScales) {
            return { minX: prices[0], maxX: prices[prices.length - 1], minY: -10000, maxY: 10000 };
        }
        // Ensure zero is visible and centered if possible
        const yRange = curveScales.maxY - curveScales.minY;
        const yCenter = (curveScales.maxY + curveScales.minY) / 2;

        return {
            minX: prices[0],
            maxX: prices[prices.length - 1],
            minY: curveScales.minY,
            maxY: curveScales.maxY,
        };
    }, [prices, curveScales]);

    // Apply zoom and pan
    const visibleBounds = useMemo(() => {
        const xRange = (baseBounds.maxX - baseBounds.minX) / zoomX;
        const yRange = (baseBounds.maxY - baseBounds.minY) / zoomY;
        const xCenter = (baseBounds.minX + baseBounds.maxX) / 2 + panX;
        const yCenter = (baseBounds.minY + baseBounds.maxY) / 2 + panY;

        return {
            minX: xCenter - xRange / 2,
            maxX: xCenter + xRange / 2,
            minY: yCenter - yRange / 2,
            maxY: yCenter + yRange / 2,
        };
    }, [baseBounds, zoomX, zoomY, panX, panY]);

    // Scales
    const xScale = useMemo(() => scaleLinear({
        domain: [visibleBounds.minX, visibleBounds.maxX],
        range: [0, innerWidth],
    }), [visibleBounds, innerWidth]);

    const yScale = useMemo(() => scaleLinear({
        domain: [visibleBounds.minY, visibleBounds.maxY],
        range: [innerHeight, 0],
    }), [visibleBounds, innerHeight]);

    // Bisector for tooltip
    const bisectPrice = bisector<DataPoint, number>(d => d.price).left;

    // Determine mouse zone
    const getMouseZone = useCallback((mouseX: number, mouseY: number): DragMode => {
        if (mouseY > innerHeight && mouseY < innerHeight + margin.bottom && mouseX >= 0 && mouseX <= innerWidth) {
            return 'xAxis';
        }
        if (mouseX < 0 && mouseX > -margin.left && mouseY >= 0 && mouseY <= innerHeight) {
            return 'yAxis';
        }
        if (mouseX >= 0 && mouseX <= innerWidth && mouseY >= 0 && mouseY <= innerHeight) {
            return 'pan';
        }
        return 'none';
    }, [innerWidth, innerHeight, margin]);

    // Handle mouse down
    const handleMouseDown = useCallback((event: React.MouseEvent) => {
        const point = localPoint(event);
        if (!point) return;

        const mouseX = point.x - margin.left;
        const mouseY = point.y - margin.top;
        const mode = getMouseZone(mouseX, mouseY);

        if (mode !== 'none') {
            setDragMode(mode);
            setDragStart({ x: event.clientX, y: event.clientY, zoomX, zoomY, panX, panY });
        }
    }, [margin, getMouseZone, zoomX, zoomY, panX, panY]);

    // Handle mouse move
    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        const point = localPoint(event);
        if (point) {
            const mouseX = point.x - margin.left;
            const mouseY = point.y - margin.top;
            setHoverZone(getMouseZone(mouseX, mouseY));
        }

        const dx = event.clientX - dragStart.x;
        const dy = event.clientY - dragStart.y;

        if (dragMode === 'xAxis') {
            const zoomChange = 1 + dx / 200;
            setZoomX(Math.max(0.1, Math.min(10, dragStart.zoomX * zoomChange)));
        } else if (dragMode === 'yAxis') {
            const zoomChange = 1 - dy / 200;
            setZoomY(Math.max(0.1, Math.min(10, dragStart.zoomY * zoomChange)));
        } else if (dragMode === 'pan') {
            const xRange = (baseBounds.maxX - baseBounds.minX) / zoomX;
            const yRange = (baseBounds.maxY - baseBounds.minY) / zoomY;
            setPanX(dragStart.panX - (dx / innerWidth) * xRange);
            setPanY(dragStart.panY + (dy / innerHeight) * yRange);
        } else if (rawData && point) {
            // Show tooltip
            const mouseX = point.x - margin.left;
            const mouseY = point.y - margin.top;

            if (mouseX < 0 || mouseX > innerWidth || mouseY < 0 || mouseY > innerHeight) {
                hideTooltip();
                setCrosshairPos(null);
                return;
            }

            const price = xScale.invert(mouseX);
            const idx = Math.min(
                Math.max(0, bisectPrice(rawData.payoffExpiry, price, 1) - 1),
                rawData.payoffExpiry.length - 1
            );

            setCrosshairPos({ x: mouseX, y: mouseY, price });

            showTooltip({
                tooltipData: {
                    price,
                    payoffExpiry: rawData.payoffExpiry[idx]?.value || 0,
                    payoffNow: rawData.payoffNow[idx]?.value || 0,
                    delta: rawData.delta[idx]?.value || 0,
                    gamma: rawData.gamma[idx]?.value || 0,
                },
                tooltipLeft: point.x,
                tooltipTop: point.y,
            });
        }
    }, [dragMode, dragStart, baseBounds, zoomX, zoomY, innerWidth, innerHeight, rawData, xScale, margin, bisectPrice, showTooltip, hideTooltip, getMouseZone]);

    const handleMouseUp = useCallback(() => {
        setDragMode('none');
    }, []);

    const handleMouseLeave = useCallback(() => {
        setDragMode('none');
        setHoverZone('none');
        hideTooltip();
        setCrosshairPos(null);
    }, [hideTooltip]);

    const handleWheel = useCallback((event: React.WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        setZoomX(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
        setZoomY(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
    }, []);

    const resetView = useCallback(() => {
        setZoomX(1);
        setZoomY(1);
        setPanX(0);
        setPanY(0);
    }, []);

    const toggleCurve = (curve: keyof typeof visibleCurves) => {
        setVisibleCurves(prev => ({ ...prev, [curve]: !prev[curve] }));
    };

    // Get cursor
    const getCursor = () => {
        if (dragMode === 'xAxis' || hoverZone === 'xAxis') return 'ew-resize';
        if (dragMode === 'yAxis' || hoverZone === 'yAxis') return 'ns-resize';
        if (dragMode === 'pan') return 'grabbing';
        if (hoverZone === 'pan') return 'grab';
        return 'default';
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
                {/* Curve toggles */}
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

                {/* Connection info */}
                {connectedSources.length > 0 && (
                    <div className="text-[9px] text-gray-500">
                        {trades.length} trades from {connectedSources.length} source{connectedSources.length > 1 ? 's' : ''}
                    </div>
                )}

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

                {/* Reset button */}
                <button
                    onClick={resetView}
                    className="p-1.5 bg-black/30 hover:bg-black/50 rounded text-gray-400 hover:text-white transition-colors"
                    title="Reset View"
                >
                    <RotateCcw size={14} />
                </button>
            </div>

            {/* Chart */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 nodrag nowheel nopan"
                style={{ touchAction: 'none', position: 'relative', overflow: 'hidden' }}
            >
                {innerWidth > 0 && innerHeight > 0 && scaledData && (
                    <>
                        <svg
                            width={dimensions.width}
                            height={dimensions.height}
                            style={{ cursor: getCursor(), touchAction: 'none' }}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseLeave}
                            onWheel={handleWheel}
                        >
                            <rect width={dimensions.width} height={dimensions.height} fill="transparent" />

                            <Group left={margin.left} top={margin.top}>
                                <defs>
                                    <clipPath id={`clip-${widgetId}`}>
                                        <rect width={innerWidth} height={innerHeight} />
                                    </clipPath>
                                </defs>

                                {/* Grid */}
                                <GridRows scale={yScale} width={innerWidth} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />
                                <GridColumns scale={xScale} height={innerHeight} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />

                                {/* Zero line - BREAK-EVEN */}
                                <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="#58a6ff" strokeWidth={1.5} />

                                {/* Current price line */}
                                <line x1={xScale(livePrice)} x2={xScale(livePrice)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="4,4" />

                                {/* Curves */}
                                <g clipPath={`url(#clip-${widgetId})`}>
                                    {visibleCurves.payoffExpiry && (
                                        <LinePath data={scaledData.payoffExpiry} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.payoffExpiry} strokeWidth={2} curve={curveMonotoneX} />
                                    )}
                                    {visibleCurves.payoffNow && (
                                        <LinePath data={scaledData.payoffNow} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.payoffNow} strokeWidth={2} curve={curveMonotoneX} />
                                    )}
                                    {visibleCurves.delta && (
                                        <LinePath data={scaledData.delta} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.delta} strokeWidth={2} curve={curveMonotoneX} />
                                    )}
                                    {visibleCurves.gamma && (
                                        <LinePath data={scaledData.gamma} x={d => xScale(d.price)} y={d => yScale(d.value)} stroke={curveColors.gamma} strokeWidth={2} curve={curveMonotoneX} />
                                    )}
                                </g>

                                {/* Crosshair */}
                                {crosshairPos && dragMode === 'none' && (
                                    <>
                                        <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                        <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                    </>
                                )}

                                {/* Y Axis with highlight zone */}
                                <rect
                                    x={-margin.left}
                                    y={0}
                                    width={margin.left}
                                    height={innerHeight}
                                    fill={hoverZone === 'yAxis' || dragMode === 'yAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}
                                    style={{ cursor: 'ns-resize' }}
                                />
                                <AxisLeft
                                    scale={yScale}
                                    tickFormat={v => {
                                        const val = Number(v);
                                        if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(0)}K`;
                                        return `$${val.toFixed(0)}`;
                                    }}
                                    stroke="rgba(125, 133, 144, 0.3)"
                                    tickStroke="rgba(125, 133, 144, 0.3)"
                                    tickLabelProps={() => ({ fill: '#7d8590', fontSize: 10, textAnchor: 'end', dy: 4 })}
                                    numTicks={6}
                                />

                                {/* X Axis with highlight zone */}
                                <rect
                                    x={0}
                                    y={innerHeight}
                                    width={innerWidth}
                                    height={margin.bottom}
                                    fill={hoverZone === 'xAxis' || dragMode === 'xAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'}
                                    style={{ cursor: 'ew-resize' }}
                                />
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
                    </>
                )}

                {/* Tooltip */}
                {tooltipOpen && tooltipData && dragMode === 'none' && (
                    <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
                        <div className="font-mono space-y-0.5">
                            <div className="text-cyan-400 font-bold">
                                ${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            {visibleCurves.payoffExpiry && (
                                <div style={{ color: curveColors.payoffExpiry }}>
                                    P(exp): {tooltipData.payoffExpiry >= 0 ? '+' : ''}${tooltipData.payoffExpiry.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                            {visibleCurves.payoffNow && (
                                <div style={{ color: curveColors.payoffNow }}>
                                    P(now): {tooltipData.payoffNow >= 0 ? '+' : ''}${tooltipData.payoffNow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                            {visibleCurves.delta && (
                                <div style={{ color: curveColors.delta }}>
                                    Δ: {tooltipData.delta.toFixed(4)}
                                </div>
                            )}
                            {visibleCurves.gamma && (
                                <div style={{ color: curveColors.gamma }}>
                                    Γ: {tooltipData.gamma.toFixed(6)}
                                </div>
                            )}
                        </div>
                    </TooltipWithBounds>
                )}
            </div>

            {/* Footer */}
            <div className="px-3 py-1.5 border-t border-[rgba(48,54,61,0.3)] bg-[rgba(0,0,0,0.2)] text-[9px] text-gray-500 text-center">
                Drag axes to scale • Drag chart to pan • Scroll to zoom
            </div>
        </div>
    );
});

export default CombinedChartWidget;
