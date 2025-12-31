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

interface SourceChartData {
    sourceId: string;
    label: string;
    color: string;
    payoffExpiry: DataPoint[];
    payoffNow: DataPoint[];
    delta: DataPoint[];
    gamma: DataPoint[];
}

interface TooltipData {
    price: number;
    sources: {
        label: string;
        color: string;
        payoffExpiry: number;
        payoffNow: number;
        delta: number;
        gamma: number;
    }[];
}

// Default source colors (cycle through these)
const sourceColors = [
    { solid: '#ef4444', dashed: '#f97316' }, // Red / Orange
    { solid: '#eab308', dashed: '#fbbf24' }, // Yellow / Amber
    { solid: '#22c55e', dashed: '#10b981' }, // Green / Emerald
    { solid: '#06b6d4', dashed: '#0ea5e9' }, // Cyan / Sky
    { solid: '#a855f7', dashed: '#8b5cf6' }, // Purple / Violet
];

// Smart color picker based on label content
const getSourceColor = (label: string, index: number) => {
    const l = label.toLowerCase();
    if (l.includes('long') || l.includes('buy')) return { solid: '#22c55e', dashed: '#4ade80' }; // Green for Buyers
    if (l.includes('short') || l.includes('sell')) return { solid: '#ef4444', dashed: '#f87171' }; // Red for Sellers
    // Fallback
    return sourceColors[index % sourceColors.length];
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
    zIndex: 100,
};

type DragMode = 'none' | 'pan' | 'xAxis' | 'yAxis';

export const CombinedChartWidget = memo(function CombinedChartWidget({ widgetId }: CombinedChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [daysToExpiry, setDaysToExpiry] = useState(7);
    const [visibleCurves, setVisibleCurves] = useState({
        payoffExpiry: true,
        payoffNow: true,
        delta: false,
        gamma: false,
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

    // Store
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

    // Responsive sizing - FORCE resize updates
    useEffect(() => {
        if (!containerRef.current) return;

        const updateDimensions = () => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                setDimensions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
            }
        };

        updateDimensions();

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setDimensions({ width: Math.floor(width), height: Math.floor(height) });
            }
        });

        resizeObserver.observe(containerRef.current);
        window.addEventListener('resize', updateDimensions);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', updateDimensions);
        };
    }, []);

    // Zoom Handler (Non-passive for prevention)
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            setZoomX(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
            setZoomY(prev => Math.max(0.1, Math.min(10, prev * zoomFactor)));
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const hasData = connectedSources.length > 0 && connectedSources.some(s => s.trades.length > 0);
    const livePrice = btcPrice || 95000;
    const margin = { top: 10, right: 15, bottom: 40, left: 55 };
    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, dimensions.height - margin.top - margin.bottom);

    // Generate price range
    const prices = useMemo(() => {
        return generatePriceRange(livePrice, 0.3, 100);
    }, [livePrice]);

    // Calculate data PER SOURCE
    const perSourceData = useMemo((): SourceChartData[] => {
        if (!hasData) return [];

        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        return connectedSources.map((source, idx) => {
            // Determines color based on label (Longs=Green, Shorts=Red)
            const colorScheme = getSourceColor(source.label, idx);

            const payoffExpiry: DataPoint[] = [];
            const payoffNow: DataPoint[] = [];
            const delta: DataPoint[] = [];
            const gamma: DataPoint[] = [];

            for (const price of prices) {
                let totalPayoffExpiry = 0;
                let totalDelta = 0;
                let totalGamma = 0;
                let totalPayoffNow = 0;

                // Only sum trades from THIS source
                for (const trade of source.trades) {
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

                    // IMPORTANT: Greeks must be multiplied by direction!
                    // Long = +Gamma, Short = -Gamma
                    totalDelta += greeks.delta * direction * size;
                    totalGamma += greeks.gamma * direction * size;

                    // Payoff now (simplified)
                    const bsApprox = greeks.delta * (price - strike) * 0.5 + premium;
                    totalPayoffNow += (Math.max(0, bsApprox) - premium) * direction * size;
                }

                payoffExpiry.push({ price, value: totalPayoffExpiry });
                payoffNow.push({ price, value: totalPayoffNow });
                delta.push({ price, value: totalDelta });
                gamma.push({ price, value: totalGamma });
            }

            return {
                sourceId: source.sourceId,
                label: source.label,
                color: source.color || colorScheme.solid,
                payoffExpiry,
                payoffNow,
                delta,
                gamma,
            };
        });
    }, [hasData, connectedSources, prices, daysToExpiry]);

    // Calculate bounds from ALL sources
    const baseBounds = useMemo(() => {
        if (perSourceData.length === 0) {
            return {
                minX: prices[0],
                maxX: prices[prices.length - 1],
                minY: -10000,
                maxY: 10000,
                deltaScale: 1,
                gammaScale: 1,
                minDelta: 0,
                minGamma: 0
            };
        }

        let minY = 0, maxY = 0;
        let minDelta = 0, maxDelta = 0;
        let minGamma = 0, maxGamma = 0;

        for (const source of perSourceData) {
            // Payoff bounds
            const payoffs = [
                ...source.payoffExpiry.map(d => d.value),
                ...source.payoffNow.map(d => d.value),
            ];
            minY = Math.min(minY, ...payoffs);
            maxY = Math.max(maxY, ...payoffs);

            // Delta bounds
            const deltas = source.delta.map(d => d.value);
            minDelta = Math.min(minDelta, ...deltas);
            maxDelta = Math.max(maxDelta, ...deltas);

            // Gamma bounds
            const gammas = source.gamma.map(d => d.value);
            minGamma = Math.min(minGamma, ...gammas);
            maxGamma = Math.max(maxGamma, ...gammas);
        }

        const yPadding = Math.max(Math.abs(maxY - minY) * 0.15, 500);
        const yRange = (maxY + yPadding) - (minY - yPadding) || 1000;

        // Calculate scaling factors to map Greeks to approx 60% of chart height
        const deltaRange = maxDelta - minDelta || 1;
        const gammaRange = maxGamma - minGamma || 1;

        // Center Greeks around 0 if possible, or just fit them
        const deltaScale = (yRange * 0.6) / deltaRange;
        const gammaScale = (yRange * 0.6) / gammaRange;

        return {
            minX: prices[0],
            maxX: prices[prices.length - 1],
            minY: minY - yPadding,
            maxY: maxY + yPadding,
            deltaScale,
            gammaScale,
            minDelta,
            minGamma
        };
    }, [prices, perSourceData]);

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

    // Helper to map Greek values to Y-axis
    const getDeltaY = useCallback((val: number) => {
        return yScale(val * (baseBounds.deltaScale ?? 1));
    }, [yScale, baseBounds]);

    const getGammaY = useCallback((val: number) => {
        return yScale(val * (baseBounds.gammaScale ?? 1));
    }, [yScale, baseBounds]);

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
        } else if (perSourceData.length > 0 && point) {
            // Show tooltip
            const mouseX = point.x - margin.left;
            const mouseY = point.y - margin.top;

            if (mouseX < 0 || mouseX > innerWidth || mouseY < 0 || mouseY > innerHeight) {
                hideTooltip();
                setCrosshairPos(null);
                return;
            }

            const price = xScale.invert(mouseX);
            setCrosshairPos({ x: mouseX, y: mouseY, price });

            const sources = perSourceData.map(source => {
                const idx = Math.min(
                    Math.max(0, bisectPrice(source.payoffExpiry, price, 1) - 1),
                    source.payoffExpiry.length - 1
                );
                return {
                    label: source.label,
                    color: source.color,
                    payoffExpiry: source.payoffExpiry[idx]?.value || 0,
                    payoffNow: source.payoffNow[idx]?.value || 0,
                    delta: source.delta[idx]?.value || 0,
                    gamma: source.gamma[idx]?.value || 0,
                };
            });

            showTooltip({
                tooltipData: { price, sources },
                tooltipLeft: point.x,
                tooltipTop: point.y,
            });
        }
    }, [dragMode, dragStart, baseBounds, zoomX, zoomY, innerWidth, innerHeight, perSourceData, xScale, margin, bisectPrice, showTooltip, hideTooltip, getMouseZone]);

    const handleMouseUp = useCallback(() => {
        setDragMode('none');
    }, []);

    const handleMouseLeave = useCallback(() => {
        setDragMode('none');
        setHoverZone('none');
        hideTooltip();
        setCrosshairPos(null);
    }, [hideTooltip]);

    const resetView = useCallback(() => {
        setZoomX(1);
        setZoomY(1);
        setPanX(0);
        setPanY(0);
    }, []);

    const toggleCurve = (curve: keyof typeof visibleCurves) => {
        setVisibleCurves(prev => ({ ...prev, [curve]: !prev[curve] }));
    };

    const getCursor = () => {
        if (dragMode === 'xAxis' || hoverZone === 'xAxis') return 'ew-resize';
        if (dragMode === 'yAxis' || hoverZone === 'yAxis') return 'ns-resize';
        if (dragMode === 'pan') return 'grabbing';
        if (hoverZone === 'pan') return 'grab';
        return 'default';
    };

    const totalTrades = connectedSources.reduce((sum, s) => sum + s.trades.length, 0);

    if (!hasData) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-foreground-muted bg-transparent p-4">
                <Activity size={32} className="mb-2 opacity-50" />
                <p className="text-sm">Connect trades from Market Screeners</p>
                <p className="text-xs opacity-60 mt-1">Drag from output socket to input socket</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-transparent overflow-hidden">
            {/* Compact Header */}
            <div className="shrink-0 px-2 py-1 border-b border-[rgba(48,54,61,0.5)] flex items-center gap-2 bg-[rgba(255,255,255,0.02)]">
                {/* Curve toggles - inline */}
                <div className="flex items-center gap-0.5">
                    <button onClick={() => toggleCurve('payoffExpiry')} className={`text-[9px] px-1 py-0.5 rounded font-bold ${visibleCurves.payoffExpiry ? 'opacity-100 bg-red-500/20' : 'opacity-30'}`} style={{ color: '#ef4444' }}>P</button>
                    <button onClick={() => toggleCurve('payoffNow')} className={`text-[9px] px-1 py-0.5 rounded font-bold ${visibleCurves.payoffNow ? 'opacity-100 bg-orange-500/20' : 'opacity-30'}`} style={{ color: '#f97316' }}>P</button>
                    <button onClick={() => toggleCurve('delta')} className={`text-[9px] px-1 py-0.5 rounded font-bold ${visibleCurves.delta ? 'opacity-100 bg-green-500/20' : 'opacity-30'}`} style={{ color: '#22c55e' }}>Δ</button>
                    <button onClick={() => toggleCurve('gamma')} className={`text-[9px] px-1 py-0.5 rounded font-bold ${visibleCurves.gamma ? 'opacity-100 bg-purple-500/20' : 'opacity-30'}`} style={{ color: '#a855f7' }}>Γ</button>
                </div>

                {/* Source legends */}
                <div className="flex items-center gap-1">
                    {connectedSources.map((source, idx) => {
                        const colors = getSourceColor(source.label, idx);
                        const baseColor = source.color || colors.solid;
                        return (
                            <div key={source.sourceId} className="flex items-center gap-1 text-[9px]">
                                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: baseColor }} />
                                <span className="text-gray-400">{source.label}</span>
                            </div>
                        );
                    })}
                </div>

                <div className="flex-1" />

                <div className="text-[8px] text-gray-500">{totalTrades} trades / {connectedSources.length} src</div>

                <div className="flex items-center gap-1 bg-black/30 px-1.5 py-0.5 rounded">
                    <Zap size={10} className={isConnected ? 'text-green-400' : 'text-gray-500'} />
                    <span className="text-[10px] font-mono text-white">${livePrice.toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-1">
                    <input
                        type="number"
                        value={daysToExpiry}
                        onChange={(e) => setDaysToExpiry(Math.max(1, Math.min(365, Number(e.target.value))))}
                        className="w-8 bg-black/30 text-white text-[10px] px-1 py-0.5 rounded border border-cyan-500/30 text-center"
                        min="1"
                        max="365"
                    />
                    <span className="text-[8px] text-gray-500">DTE</span>
                </div>

                <button onClick={resetView} className="p-1 bg-black/30 hover:bg-black/50 rounded text-gray-400 hover:text-white">
                    <RotateCcw size={12} />
                </button>
            </div>

            {/* Chart - takes remaining space */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 w-full relative"
                style={{
                    touchAction: 'none',
                    overflow: 'hidden',
                    cursor: getCursor()
                }}
            >
                {innerWidth > 0 && innerHeight > 0 && perSourceData.length > 0 && (
                    <svg
                        width={dimensions.width}
                        height={dimensions.height}
                        style={{ display: 'block' }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeave}
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
                            <line x1={xScale(livePrice)} x2={xScale(livePrice)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.6)" strokeWidth={1} strokeDasharray="4,4" />

                            {/* Curves per source */}
                            <g clipPath={`url(#clip-${widgetId})`}>
                                {perSourceData.map((source, idx) => {
                                    const colors = getSourceColor(source.label, idx);
                                    const baseColor = source.color || colors.solid;

                                    // Find Gamma Extrema
                                    let maxGamma = -Infinity, minGamma = Infinity;
                                    let maxGammaPrice = 0, minGammaPrice = 0;
                                    let maxGammaVal = 0, minGammaVal = 0;

                                    if (visibleCurves.gamma) {
                                        source.gamma.forEach(d => {
                                            if (d.value > maxGamma) { maxGamma = d.value; maxGammaPrice = d.price; maxGammaVal = d.value; }
                                            if (d.value < minGamma) { minGamma = d.value; minGammaPrice = d.price; minGammaVal = d.value; }
                                        });
                                    }

                                    return (
                                        <g key={source.sourceId}>
                                            {/* Payoff at expiry - SOLID line */}
                                            {visibleCurves.payoffExpiry && (
                                                <LinePath
                                                    data={source.payoffExpiry}
                                                    x={d => xScale(d.price)}
                                                    y={d => yScale(d.value)}
                                                    stroke={baseColor}
                                                    strokeWidth={2}
                                                    curve={curveMonotoneX}
                                                />
                                            )}
                                            {/* Payoff now - DASHED line */}
                                            {visibleCurves.payoffNow && (
                                                <LinePath
                                                    data={source.payoffNow}
                                                    x={d => xScale(d.price)}
                                                    y={d => yScale(d.value)}
                                                    stroke={baseColor}
                                                    strokeWidth={1.5}
                                                    strokeDasharray="4,4"
                                                    curve={curveMonotoneX}
                                                    opacity={0.7}
                                                />
                                            )}
                                            {/* Delta - GREEN, Scaled */}
                                            {visibleCurves.delta && (
                                                <LinePath
                                                    data={source.delta}
                                                    x={d => xScale(d.price)}
                                                    y={d => getDeltaY(d.value)}
                                                    stroke="#22c55e"
                                                    strokeWidth={1.5}
                                                    curve={curveMonotoneX}
                                                    opacity={0.8}
                                                />
                                            )}
                                            {/* Gamma - PURPLE, Scaled */}
                                            {visibleCurves.gamma && (
                                                <>
                                                    <LinePath
                                                        data={source.gamma}
                                                        x={d => xScale(d.price)}
                                                        y={d => getGammaY(d.value)}
                                                        stroke="#a855f7"
                                                        strokeWidth={1.5}
                                                        curve={curveMonotoneX}
                                                        opacity={0.8}
                                                    />
                                                    {/* Max Gamma Marker */}
                                                    {maxGamma > -Infinity && (
                                                        <g>
                                                            <circle
                                                                cx={xScale(maxGammaPrice)}
                                                                cy={getGammaY(maxGammaVal)}
                                                                r={3}
                                                                fill="#a855f7"
                                                                stroke="#fff"
                                                                strokeWidth={1}
                                                            />
                                                            <text
                                                                x={xScale(maxGammaPrice)}
                                                                y={getGammaY(maxGammaVal) - 8}
                                                                fill="#a855f7"
                                                                fontSize={9}
                                                                textAnchor="middle"
                                                                fontWeight="bold"
                                                            >
                                                                Max Γ
                                                            </text>
                                                            <text
                                                                x={xScale(maxGammaPrice)}
                                                                y={getGammaY(maxGammaVal) - 18}
                                                                fill="#a855f7"
                                                                fontSize={9}
                                                                textAnchor="middle"
                                                            >
                                                                ${maxGammaPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                            </text>
                                                        </g>
                                                    )}
                                                    {/* Min Gamma Marker (only if significantly different from 0 or negative) */}
                                                    {minGamma < 0 && (
                                                        <g>
                                                            <circle
                                                                cx={xScale(minGammaPrice)}
                                                                cy={getGammaY(minGammaVal)}
                                                                r={3}
                                                                fill="#a855f7"
                                                                stroke="#fff"
                                                                strokeWidth={1}
                                                            />
                                                            <text
                                                                x={xScale(minGammaPrice)}
                                                                y={getGammaY(minGammaVal) + 14}
                                                                fill="#a855f7"
                                                                fontSize={9}
                                                                textAnchor="middle"
                                                                fontWeight="bold"
                                                            >
                                                                Min Γ
                                                            </text>
                                                            <text
                                                                x={xScale(minGammaPrice)}
                                                                y={getGammaY(minGammaVal) + 24}
                                                                fill="#a855f7"
                                                                fontSize={9}
                                                                textAnchor="middle"
                                                            >
                                                                ${minGammaPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                            </text>
                                                        </g>
                                                    )}
                                                </>
                                            )}
                                        </g>
                                    );
                                })}

                                {/* Intersection Markers (Only if 2+ sources) */}
                                {perSourceData.length >= 2 && visibleCurves.gamma && (() => {
                                    const s1 = perSourceData[0];
                                    const s2 = perSourceData[1];
                                    const intersections = [];

                                    for (let i = 0; i < s1.gamma.length - 1; i++) {
                                        const v1 = s1.gamma[i].value;
                                        const v2 = s2.gamma[i].value;
                                        const diff = v1 - v2;

                                        const v1_next = s1.gamma[i + 1].value;
                                        const v2_next = s2.gamma[i + 1].value;
                                        const diff_next = v1_next - v2_next;

                                        if (Math.sign(diff) !== Math.sign(diff_next)) {
                                            const fraction = Math.abs(diff) / (Math.abs(diff) + Math.abs(diff_next));
                                            const crossPrice = s1.gamma[i].price + (s1.gamma[i + 1].price - s1.gamma[i].price) * fraction;
                                            const crossVal = v1 + (v1_next - v1) * fraction;
                                            intersections.push({ x: crossPrice, y: crossVal });
                                        }
                                    }

                                    return intersections.map((pt, i) => (
                                        <g key={`cross-${i}`}>
                                            <circle
                                                cx={xScale(pt.x)}
                                                cy={getGammaY(pt.y)}
                                                r={3}
                                                fill="white"
                                                stroke="#a855f7"
                                                strokeWidth={1.5}
                                            />
                                            <text
                                                x={xScale(pt.x)}
                                                y={getGammaY(pt.y) - 8}
                                                fill="white"
                                                fontSize={9}
                                                textAnchor="middle"
                                            >
                                                ${pt.x.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                            </text>
                                        </g>
                                    ));
                                })()}
                            </g>

                            {/* Crosshair */}
                            {crosshairPos && dragMode === 'none' && (
                                <>
                                    <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                    <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                </>
                            )}

                            {/* Y Axis zone */}
                            <rect x={-margin.left} y={0} width={margin.left} height={innerHeight} fill={hoverZone === 'yAxis' || dragMode === 'yAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'} />
                            <AxisLeft
                                scale={yScale}
                                tickFormat={v => {
                                    const val = Number(v);
                                    if (Math.abs(val) >= 1000) return `$${(val / 1000).toFixed(0)}K`;
                                    return `$${val.toFixed(0)}`;
                                }}
                                stroke="rgba(125, 133, 144, 0.3)"
                                tickStroke="rgba(125, 133, 144, 0.3)"
                                tickLabelProps={() => ({ fill: '#7d8590', fontSize: 9, textAnchor: 'end', dy: 3 })}
                                numTicks={5}
                            />

                            {/* X Axis zone */}
                            <rect x={0} y={innerHeight} width={innerWidth} height={margin.bottom} fill={hoverZone === 'xAxis' || dragMode === 'xAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'} />
                            <AxisBottom
                                scale={xScale}
                                top={innerHeight}
                                tickFormat={v => `${(Number(v) / 1000).toFixed(0)}K`}
                                stroke="rgba(125, 133, 144, 0.3)"
                                tickStroke="rgba(125, 133, 144, 0.3)"
                                tickLabelProps={() => ({ fill: '#7d8590', fontSize: 9, textAnchor: 'middle' })}
                                numTicks={6}
                            />
                        </Group>
                    </svg>
                )}

                {/* Tooltip */}
                {tooltipOpen && tooltipData && dragMode === 'none' && (
                    <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
                        <div className="font-mono space-y-1">
                            <div className="text-cyan-400 font-bold text-xs">
                                ${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            {tooltipData.sources.map((src, i) => (
                                <div key={i} className="border-t border-gray-700 pt-1">
                                    <div className="flex items-center gap-1 text-[10px] mb-0.5">
                                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: src.color }} />
                                        <span className="text-gray-400 font-bold">{src.label}</span>
                                    </div>
                                    {visibleCurves.payoffExpiry && (
                                        <div className="text-[10px] flex justify-between gap-4" style={{ color: src.color }}>
                                            <span>Payoff (Exp):</span>
                                            <span>{src.payoffExpiry >= 0 ? '+' : ''}${src.payoffExpiry.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                    )}
                                    {visibleCurves.payoffNow && (
                                        <div className="text-[10px] flex justify-between gap-4 opacity-80" style={{ color: src.color }}>
                                            <span>Payoff (Now):</span>
                                            <span>{src.payoffNow >= 0 ? '+' : ''}${src.payoffNow.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                    )}
                                    {visibleCurves.delta && (
                                        <div className="text-[10px] flex justify-between gap-4 text-green-400">
                                            <span>Delta:</span>
                                            <span>{src.delta.toFixed(4)}</span>
                                        </div>
                                    )}
                                    {visibleCurves.gamma && (
                                        <div className="text-[10px] flex justify-between gap-4 text-purple-400">
                                            <span>Gamma:</span>
                                            <span>{src.gamma.toFixed(6)}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </TooltipWithBounds>
                )}
            </div>

            {/* Minimal footer */}
            <div className="shrink-0 px-2 py-1 border-t border-[rgba(48,54,61,0.3)] bg-[rgba(0,0,0,0.2)] text-[8px] text-gray-600 text-center">
                Drag axes to scale • Drag chart to pan • Scroll to zoom
            </div>
        </div>
    );
});

export default CombinedChartWidget;
