'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Zap, RotateCcw } from 'lucide-react';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateGreeks, generatePriceRange } from '@/lib/options/blackScholes';

import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { localPoint } from '@visx/event';
import { curveMonotoneX } from '@visx/curve';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { bisector } from 'd3-array';

type GreekType = 'delta' | 'gamma' | 'theta' | 'vega';
type DragMode = 'none' | 'pan' | 'xAxis' | 'yAxis';

interface GreeksVizProps {
    widgetId: string;
}

interface SourceGreeksData {
    source: TradeSource;
    prices: number[];
    greeks: Record<GreekType, { price: number; value: number }[]>;
    greeksAtSpot: Record<GreekType, number>;
}

const greekColors: Record<GreekType, string> = {
    delta: '#22c55e',
    gamma: '#a855f7',
    theta: '#ef4444',
    vega: '#fbbf24',
};

const greekLabels: Record<GreekType, string> = {
    delta: 'Δ Delta',
    gamma: 'Γ Gamma',
    theta: 'Θ Theta',
    vega: 'ν Vega',
};

const tooltipStyles = {
    ...defaultStyles,
    background: 'rgba(13, 17, 23, 0.95)',
    border: '1px solid rgba(88, 166, 255, 0.3)',
    color: '#e6edf3',
    fontSize: '12px',
    padding: '8px 12px',
    borderRadius: '8px',
};

export function GreeksVizWidget({ widgetId }: GreeksVizProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 400, height: 300 });

    // Store connections
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    // Live price
    const { btcPrice, isConnected } = useLivePriceStore();
    const livePrice = btcPrice || 95000;

    // Visible Greeks
    const [visibleGreeks, setVisibleGreeks] = useState<Record<GreekType, boolean>>({
        delta: true,
        gamma: true,
        theta: false,
        vega: false,
    });

    const [daysToExpiry, setDaysToExpiry] = useState(30);

    // Tooltip and crosshair state
    const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; price: number } | null>(null);
    const { showTooltip, hideTooltip, tooltipOpen, tooltipData, tooltipLeft, tooltipTop } = useTooltip<{
        price: number;
        values: { label: string; value: number; color: string }[];
    }>();

    // Thales-style zoom/pan state
    const [zoomX, setZoomX] = useState(1);
    const [zoomY, setZoomY] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [dragMode, setDragMode] = useState<DragMode>('none');
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, zoomX: 1, zoomY: 1, panX: 0, panY: 0 });
    const [cursor, setCursor] = useState('grab');

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

    // Responsive sizing
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

    const hasData = connectedSources.length > 0;
    const margin = { top: 20, right: 20, bottom: 50, left: 65 };
    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, dimensions.height - margin.top - margin.bottom);

    const toggleGreek = (greek: GreekType) => {
        setVisibleGreeks(prev => ({ ...prev, [greek]: !prev[greek] }));
    };

    // Calculate Greeks for each source
    const perSourceData = useMemo((): SourceGreeksData[] => {
        if (!hasData) return [];

        const firstTrade = connectedSources[0]?.trades[0];
        const baseUnderlying = livePrice || firstTrade?.underlying || firstTrade?.indexPrice || 95000;

        const prices = generatePriceRange(baseUnderlying, 0.25, 60);
        const T = Math.max(0.001, daysToExpiry / 365);

        return connectedSources.map(source => {
            const greeks: Record<GreekType, { price: number; value: number }[]> = {
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

                greeks.delta.push({ price, value: deltaSum });
                greeks.gamma.push({ price, value: gammaSum });
                greeks.theta.push({ price, value: thetaSum });
                greeks.vega.push({ price, value: vegaSum });
            }

            const spotIdx = Math.floor(prices.length / 2);
            greeksAtSpot.delta = greeks.delta[spotIdx]?.value || 0;
            greeksAtSpot.gamma = greeks.gamma[spotIdx]?.value || 0;
            greeksAtSpot.theta = greeks.theta[spotIdx]?.value || 0;
            greeksAtSpot.vega = greeks.vega[spotIdx]?.value || 0;

            return { source, prices, greeks, greeksAtSpot };
        });
    }, [connectedSources, livePrice, daysToExpiry, hasData]);

    // Calculate chart bounds
    const baseBounds = useMemo(() => {
        if (perSourceData.length === 0) return { minX: 80000, maxX: 110000, minY: -1, maxY: 1 };

        const allPrices = perSourceData[0]?.prices || [];
        const minX = Math.min(...allPrices);
        const maxX = Math.max(...allPrices);

        // Get combined min/max for visible Greeks (normalized)
        return { minX, maxX, minY: -1.2, maxY: 1.2 };
    }, [perSourceData]);

    // Get normalized data for a Greek
    const getNormalizedGreekData = useCallback((greek: GreekType, data: { price: number; value: number }[]) => {
        const values = data.map(d => d.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        return data.map(d => ({
            price: d.price,
            value: (d.value - min) / range * 2 - 1,
        }));
    }, []);

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
    const bisectPrice = bisector<{ price: number; value: number }, number>(d => d.price).left;

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
            const zone = dragMode !== 'none' ? dragMode : getMouseZone(mouseX, mouseY);

            if (zone === 'xAxis') setCursor('ew-resize');
            else if (zone === 'yAxis') setCursor('ns-resize');
            else if (zone === 'pan') setCursor(dragMode === 'pan' ? 'grabbing' : 'grab');
            else setCursor('default');
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
        } else if (perSourceData.length > 0) {
            // Show tooltip
            const pt = localPoint(event);
            if (!pt) return;

            const mouseX = pt.x - margin.left;
            const mouseY = pt.y - margin.top;

            if (mouseX < 0 || mouseX > innerWidth || mouseY < 0 || mouseY > innerHeight) {
                hideTooltip();
                setCrosshairPos(null);
                return;
            }

            const price = xScale.invert(mouseX);

            setCrosshairPos({ x: mouseX, y: mouseY, price });

            const values: { label: string; value: number; color: string }[] = [];
            for (const sourceData of perSourceData) {
                for (const greek of Object.keys(visibleGreeks) as GreekType[]) {
                    if (visibleGreeks[greek]) {
                        const data = sourceData.greeks[greek];
                        const idx = Math.min(bisectPrice(data, price, 1) - 1, data.length - 1);
                        const d = data[Math.max(0, idx)];
                        if (d) {
                            values.push({
                                label: `${sourceData.source.label} ${greekLabels[greek]}`,
                                value: d.value,
                                color: greekColors[greek],
                            });
                        }
                    }
                }
            }

            showTooltip({
                tooltipData: { price, values },
                tooltipLeft: pt.x,
                tooltipTop: pt.y,
            });
        }
    }, [dragMode, dragStart, baseBounds, zoomX, zoomY, innerWidth, innerHeight, perSourceData, xScale, margin, bisectPrice, visibleGreeks, showTooltip, hideTooltip, getMouseZone]);

    const handleMouseUp = useCallback(() => {
        setDragMode('none');
    }, []);

    const handleMouseLeave = useCallback(() => {
        setDragMode('none');
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

    if (!hasData) {
        return (
            <div className="h-full flex flex-col bg-transparent">
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-500">
                        <p className="text-sm">Connect a Market Screener</p>
                        <p className="text-xs mt-1">to visualize Greeks</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-transparent">
            {/* Header */}
            <div className="px-3 py-2 border-b border-[rgba(48,54,61,0.5)] flex items-center gap-3 bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-2 bg-black/30 px-2 py-1 rounded-lg">
                    <Zap size={12} className={isConnected ? 'text-green-400' : 'text-gray-500'} />
                    <span className="text-xs text-gray-400">BTC</span>
                    <span className="text-sm font-mono font-bold text-white">${livePrice.toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-1">
                    {(Object.keys(greekColors) as GreekType[]).map(greek => (
                        <button
                            key={greek}
                            onClick={() => toggleGreek(greek)}
                            className={`text-[10px] px-2 py-0.5 rounded transition-all ${visibleGreeks[greek]
                                ? 'text-white'
                                : 'text-gray-600 hover:text-gray-400'
                                }`}
                            style={{ backgroundColor: visibleGreeks[greek] ? greekColors[greek] + '40' : 'transparent', color: visibleGreeks[greek] ? greekColors[greek] : undefined }}
                        >
                            {greekLabels[greek].split(' ')[0]}
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
                        min="1"
                        max="365"
                    />
                </div>

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
                {innerWidth > 0 && innerHeight > 0 && (
                    <>
                        <svg
                            width={dimensions.width}
                            height={dimensions.height}
                            style={{ cursor, touchAction: 'none' }}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseLeave}
                            onWheel={handleWheel}
                        >
                            <rect width={dimensions.width} height={dimensions.height} fill="transparent" />

                            <Group left={margin.left} top={margin.top}>
                                <defs>
                                    <clipPath id={`clip-greeks-${widgetId}`}>
                                        <rect width={innerWidth} height={innerHeight} />
                                    </clipPath>
                                </defs>

                                {/* Grid */}
                                <GridRows scale={yScale} width={innerWidth} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />
                                <GridColumns scale={xScale} height={innerHeight} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />

                                {/* Zero line */}
                                <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="#58a6ff" strokeWidth={1} />

                                {/* Current price line */}
                                <line x1={xScale(livePrice)} x2={xScale(livePrice)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="4,4" />

                                {/* Greek curves */}
                                <g clipPath={`url(#clip-greeks-${widgetId})`}>
                                    {perSourceData.map((sourceData) => (
                                        <g key={sourceData.source.sourceId}>
                                            {(Object.keys(visibleGreeks) as GreekType[]).map(greek => {
                                                if (!visibleGreeks[greek]) return null;
                                                const normalizedData = getNormalizedGreekData(greek, sourceData.greeks[greek]);
                                                return (
                                                    <LinePath
                                                        key={greek}
                                                        data={normalizedData}
                                                        x={d => xScale(d.price)}
                                                        y={d => yScale(d.value)}
                                                        stroke={greekColors[greek]}
                                                        strokeWidth={2}
                                                        curve={curveMonotoneX}
                                                    />
                                                );
                                            })}
                                        </g>
                                    ))}
                                </g>

                                {/* Crosshair */}
                                {crosshairPos && dragMode === 'none' && (
                                    <>
                                        <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                        <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                    </>
                                )}

                                {/* Axes */}
                                <AxisLeft
                                    scale={yScale}
                                    stroke="rgba(125, 133, 144, 0.3)"
                                    tickStroke="rgba(125, 133, 144, 0.3)"
                                    tickLabelProps={() => ({ fill: '#7d8590', fontSize: 10, textAnchor: 'end', dy: 4 })}
                                    numTicks={6}
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
                        <div className="font-mono text-xs">
                            <div className="text-gray-400 mb-1">
                                Price: ${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            {tooltipData.values.map((v, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span style={{ color: v.color }}>{v.label}:</span>
                                    <span className="text-white">{v.value.toFixed(4)}</span>
                                </div>
                            ))}
                        </div>
                    </TooltipWithBounds>
                )}
            </div>

            {/* Footer hint */}
            <div className="px-3 py-1.5 border-t border-[rgba(48,54,61,0.3)] bg-[rgba(0,0,0,0.2)] text-[9px] text-gray-500 text-center">
                Drag axis to scale • Drag chart to pan • Scroll to zoom
            </div>
        </div>
    );
}

export default GreeksVizWidget;
