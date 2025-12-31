'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Zap, Activity, RotateCcw, ZoomIn, ZoomOut, MoveHorizontal, MoveVertical } from 'lucide-react';
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

    // Independent zoom for X and Y axes
    const [zoomX, setZoomX] = useState(1);
    const [zoomY, setZoomY] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 });

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

    // Generate price range - wider for better visualization
    const prices = useMemo(() => {
        return generatePriceRange(livePrice, 0.30, 150);
    }, [livePrice]);

    // Calculate RAW data points (un-normalized)
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

            for (const trade of trades) {
                const strike = trade.strike;
                const type = trade.type as 'call' | 'put';
                const direction = trade.direction === 'buy' ? 1 : -1;
                const size = trade.size || 1;
                const premium = trade.priceUSD || 0;
                const iv = trade.iv ? trade.iv / 100 : 0.5;

                // Payoff at expiry - classic hockey stick
                const intrinsic = type === 'call'
                    ? Math.max(0, price - strike)
                    : Math.max(0, strike - price);
                totalPayoffExpiry += (intrinsic - premium) * direction * size;

                // Greeks using library
                const greeks = calculateGreeks(price, strike, T, r, iv, type);

                // Raw Greeks values
                totalDelta += greeks.delta * direction * size;
                totalGamma += greeks.gamma * size; // Gamma is always positive

                // Payoff now using delta approximation
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

    // Normalize each curve to fit in a common visual range
    const normalizedData = useMemo((): ChartDataSet | null => {
        if (!rawData) return null;

        const normalize = (data: DataPoint[]): DataPoint[] => {
            const values = data.map(d => d.value);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const range = max - min || 1;

            return data.map(d => ({
                price: d.price,
                value: (d.value - min) / range * 2 - 1, // Normalize to -1 to 1
            }));
        };

        return {
            payoffExpiry: normalize(rawData.payoffExpiry),
            payoffNow: normalize(rawData.payoffNow),
            delta: normalize(rawData.delta),
            gamma: normalize(rawData.gamma),
        };
    }, [rawData]);

    // Base chart bounds
    const baseBounds = useMemo(() => {
        return {
            minX: prices[0],
            maxX: prices[prices.length - 1],
            minY: -1.2,
            maxY: 1.2,
        };
    }, [prices]);

    // Apply zoom and pan to get visible bounds
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

    // Handle mouse wheel for zoom
    const handleWheel = useCallback((event: React.WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;

        if (event.shiftKey) {
            // Shift + scroll = Y axis only
            setZoomY(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
        } else if (event.ctrlKey || event.metaKey) {
            // Ctrl/Cmd + scroll = both axes
            setZoomX(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
            setZoomY(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
        } else {
            // Normal scroll = X axis only
            setZoomX(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
        }
    }, []);

    // Handle mouse drag for pan
    const handleMouseDown = useCallback((event: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: event.clientX, y: event.clientY, panX, panY });
    }, [panX, panY]);

    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        if (isDragging) {
            const dx = event.clientX - dragStart.x;
            const dy = event.clientY - dragStart.y;

            // Convert pixel movement to data units
            const xRange = (baseBounds.maxX - baseBounds.minX) / zoomX;
            const yRange = (baseBounds.maxY - baseBounds.minY) / zoomY;

            setPanX(dragStart.panX - (dx / innerWidth) * xRange);
            setPanY(dragStart.panY + (dy / innerHeight) * yRange);
        } else if (rawData) {
            // Show tooltip
            const point = localPoint(event);
            if (!point) return;

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
    }, [isDragging, dragStart, baseBounds, zoomX, zoomY, innerWidth, innerHeight, rawData, xScale, margin, bisectPrice, showTooltip, hideTooltip]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setIsDragging(false);
        hideTooltip();
        setCrosshairPos(null);
    }, [hideTooltip]);

    // Reset zoom/pan
    const resetView = useCallback(() => {
        setZoomX(1);
        setZoomY(1);
        setPanX(0);
        setPanY(0);
    }, []);

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

                {/* Zoom hint */}
                <div className="text-[9px] text-gray-500 hidden md:block">
                    Scroll: X | Shift+Scroll: Y
                </div>

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

            {/* Chart */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 nodrag nowheel nopan"
                style={{ touchAction: 'none', position: 'relative', overflow: 'hidden' }}
            >
                {innerWidth > 0 && innerHeight > 0 && normalizedData && (
                    <>
                        <svg
                            width={dimensions.width}
                            height={dimensions.height}
                            style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseLeave}
                            onWheel={handleWheel}
                        >
                            <rect width={dimensions.width} height={dimensions.height} fill="transparent" />

                            <Group left={margin.left} top={margin.top}>
                                {/* Clip path for chart area */}
                                <defs>
                                    <clipPath id={`clip-${widgetId}`}>
                                        <rect width={innerWidth} height={innerHeight} />
                                    </clipPath>
                                </defs>

                                {/* Grid */}
                                <GridRows scale={yScale} width={innerWidth} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />
                                <GridColumns scale={xScale} height={innerHeight} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />

                                {/* Zero line */}
                                <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="rgba(255,255,255,0.3)" strokeWidth={1} />

                                {/* Current price line */}
                                <line
                                    x1={xScale(livePrice)}
                                    x2={xScale(livePrice)}
                                    y1={0}
                                    y2={innerHeight}
                                    stroke="rgba(255,255,255,0.5)"
                                    strokeWidth={1}
                                    strokeDasharray="4,4"
                                />

                                {/* Curves with clipping */}
                                <g clipPath={`url(#clip-${widgetId})`}>
                                    {visibleCurves.payoffExpiry && (
                                        <LinePath
                                            data={normalizedData.payoffExpiry}
                                            x={d => xScale(d.price)}
                                            y={d => yScale(d.value)}
                                            stroke={curveColors.payoffExpiry}
                                            strokeWidth={2}
                                            curve={curveMonotoneX}
                                        />
                                    )}
                                    {visibleCurves.payoffNow && (
                                        <LinePath
                                            data={normalizedData.payoffNow}
                                            x={d => xScale(d.price)}
                                            y={d => yScale(d.value)}
                                            stroke={curveColors.payoffNow}
                                            strokeWidth={2}
                                            curve={curveMonotoneX}
                                        />
                                    )}
                                    {visibleCurves.delta && (
                                        <LinePath
                                            data={normalizedData.delta}
                                            x={d => xScale(d.price)}
                                            y={d => yScale(d.value)}
                                            stroke={curveColors.delta}
                                            strokeWidth={2}
                                            curve={curveMonotoneX}
                                        />
                                    )}
                                    {visibleCurves.gamma && (
                                        <LinePath
                                            data={normalizedData.gamma}
                                            x={d => xScale(d.price)}
                                            y={d => yScale(d.value)}
                                            stroke={curveColors.gamma}
                                            strokeWidth={2}
                                            curve={curveMonotoneX}
                                        />
                                    )}
                                </g>

                                {/* Crosshair */}
                                {crosshairPos && !isDragging && (
                                    <>
                                        <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                        <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                    </>
                                )}

                                {/* Y Axis */}
                                <AxisLeft
                                    scale={yScale}
                                    tickFormat={() => ''} // No Y labels for normalized view
                                    stroke="rgba(125, 133, 144, 0.3)"
                                    tickStroke="rgba(125, 133, 144, 0.3)"
                                    numTicks={6}
                                />

                                {/* X Axis */}
                                <AxisBottom
                                    scale={xScale}
                                    top={innerHeight}
                                    tickFormat={v => `${(Number(v) / 1000).toFixed(0)},000`}
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
                                onClick={() => setZoomX(prev => Math.min(10, prev * 1.2))}
                                className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                title="Zoom X In"
                            >
                                <MoveHorizontal size={14} />
                            </button>
                            <button
                                onClick={() => setZoomY(prev => Math.min(10, prev * 1.2))}
                                className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                title="Zoom Y In"
                            >
                                <MoveVertical size={14} />
                            </button>
                            <button
                                onClick={() => { setZoomX(prev => Math.min(10, prev * 1.2)); setZoomY(prev => Math.min(10, prev * 1.2)); }}
                                className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                title="Zoom Both In"
                            >
                                <ZoomIn size={14} />
                            </button>
                            <button
                                onClick={() => { setZoomX(prev => Math.max(0.1, prev * 0.8)); setZoomY(prev => Math.max(0.1, prev * 0.8)); }}
                                className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                title="Zoom Both Out"
                            >
                                <ZoomOut size={14} />
                            </button>
                            <button
                                onClick={resetView}
                                className="p-1 bg-black/50 hover:bg-black/70 rounded text-white"
                                title="Reset View"
                            >
                                <RotateCcw size={14} />
                            </button>
                        </div>

                        {/* Zoom indicators */}
                        <div className="absolute top-2 right-2 text-[9px] text-gray-500 bg-black/30 px-1.5 py-0.5 rounded">
                            X:{zoomX.toFixed(1)}x Y:{zoomY.toFixed(1)}x
                        </div>
                    </>
                )}

                {/* Tooltip - shows RAW values */}
                {tooltipOpen && tooltipData && !isDragging && (
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
        </div>
    );
});

export default CombinedChartWidget;
