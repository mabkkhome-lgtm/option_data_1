'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Zap, RotateCcw, Activity } from 'lucide-react';
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
    zIndex: 100,
};

export function GreeksVizWidget({ widgetId }: GreeksVizProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Store
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);
    const { btcPrice, isConnected } = useLivePriceStore();
    const livePrice = btcPrice || 95000;

    // View State
    const [visibleGreeks, setVisibleGreeks] = useState<Record<GreekType, boolean>>({
        delta: true, gamma: true, theta: false, vega: false,
    });
    const [daysToExpiry, setDaysToExpiry] = useState(30);

    // Zoom/Pan
    const [zoomX, setZoomX] = useState(1);
    const [zoomY, setZoomY] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [dragMode, setDragMode] = useState<DragMode>('none');
    const [hoverZone, setHoverZone] = useState<DragMode>('none');
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, zoomX: 1, zoomY: 1, panX: 0, panY: 0 });

    // Tooltip
    const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; price: number } | null>(null);
    const { showTooltip, hideTooltip, tooltipOpen, tooltipData, tooltipLeft, tooltipTop } = useTooltip<{
        price: number;
        values: { sourceLabel: string; greek: string; value: number; color: string }[];
    }>();

    // Get connected sources
    const connectedSources = useMemo(() => {
        const connectedIds = connections
            .filter(c => c.targetId === widgetId)
            .map(c => c.sourceId);

        if (connectedIds.length === 0) {
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

        return connectedIds
            .map(id => sourcesMap.get(id))
            .filter((s): s is TradeSource => s !== undefined && s.trades.length > 0);
    }, [sourcesMap, connections, allTrades, widgetId]);

    // Responsive Sizing
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

    // Zoom Handler
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
    const margin = { top: 20, right: 20, bottom: 50, left: 60 };
    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, dimensions.height - margin.top - margin.bottom);

    // Calculate Per Source Data
    const perSourceData = useMemo(() => {
        if (!hasData) return { sources: [], prices: [] };
        const prices = generatePriceRange(livePrice, 0.3, 100);
        const T = Math.max(0.001, daysToExpiry / 365);

        // First pass: Calculate curves for each source
        const sources = connectedSources.map(source => {
            const greeks: Record<GreekType, { price: number; value: number }[]> = {
                delta: [], gamma: [], theta: [], vega: []
            };

            for (const price of prices) {
                let delta = 0, gamma = 0, theta = 0, vega = 0;
                for (const trade of source.trades) {
                    const isCall = trade.type === 'call';
                    const isLong = trade.direction === 'buy';
                    const mult = isLong ? (trade.size || 1) : -(trade.size || 1);
                    const iv = trade.iv ? trade.iv / 100 : 0.8;
                    const g = calculateGreeks(price, trade.strike, T, 0.05, iv, isCall ? 'call' : 'put');

                    delta += g.delta * mult;
                    gamma += g.gamma * mult;
                    theta += g.theta * mult;
                    vega += g.vega * mult;
                }
                greeks.delta.push({ price, value: delta });
                greeks.gamma.push({ price, value: gamma });
                greeks.theta.push({ price, value: theta });
                greeks.vega.push({ price, value: vega });
            }
            return { label: source.label, greeks };
        });

        // Global Normalization per Greek Type
        // We find global min/max across all sources for each Greek, then scale all to shared range
        const normalizedSources = sources.map(s => ({
            label: s.label,
            greeks: {} as Record<GreekType, { price: number; value: number, raw: number }[]>
        }));

        (Object.keys(greekColors) as GreekType[]).forEach(type => {
            let min = Infinity, max = -Infinity;
            sources.forEach(s => {
                const vals = s.greeks[type].map(d => d.value);
                min = Math.min(min, ...vals);
                max = Math.max(max, ...vals);
            });
            const range = max - min || 1;
            // Pad range
            const pRange = range * 1.2;
            const center = (max + min) / 2;
            // Scale to fit -1 to 1 roughly, but preserving relative size
            // Actually, best to map [min, max] to chart height range?
            // The chart Y domain is typically fixed or arbitrary for greeks? 
            // Previous code used [-1.2, 1.2] Y domain.

            // Let's normalize data to [-1, 1] based on global global max magnitude
            const absMax = Math.max(Math.abs(min), Math.abs(max)) || 1;

            sources.forEach((s, idx) => {
                normalizedSources[idx].greeks[type] = s.greeks[type].map(d => ({
                    price: d.price,
                    raw: d.value, // Keep raw for tooltip
                    value: d.value / absMax // Normalize to -1...1
                }));
            });
        });

        return { sources: normalizedSources, prices };

    }, [hasData, connectedSources, livePrice, daysToExpiry]);

    // Bounds
    const baseBounds = useMemo(() => {
        if (!perSourceData.prices) return { minX: 80000, maxX: 100000, minY: -1.2, maxY: 1.2 };
        return {
            minX: perSourceData.prices[0],
            maxX: perSourceData.prices[perSourceData.prices.length - 1],
            minY: -1.2,
            maxY: 1.2 // Fixed range due to normalization
        };
    }, [perSourceData]);

    // Zoom/Pan
    const visibleBounds = useMemo(() => {
        const xRange = (baseBounds.maxX - baseBounds.minX) / zoomX;
        const yRange = (baseBounds.maxY - baseBounds.minY) / zoomY;
        const xCenter = (baseBounds.minX + baseBounds.maxX) / 2 + panX;
        const yCenter = (baseBounds.minY + baseBounds.maxY) / 2 + panY;
        return { minX: xCenter - xRange / 2, maxX: xCenter + xRange / 2, minY: yCenter - yRange / 2, maxY: yCenter + yRange / 2 };
    }, [baseBounds, zoomX, zoomY, panX, panY]);

    const xScale = useMemo(() => scaleLinear({ domain: [visibleBounds.minX, visibleBounds.maxX], range: [0, innerWidth] }), [visibleBounds, innerWidth]);
    const yScale = useMemo(() => scaleLinear({ domain: [visibleBounds.minY, visibleBounds.maxY], range: [innerHeight, 0] }), [visibleBounds, innerHeight]);
    const bisectPrice = bisector<{ price: number }, number>(d => d.price).left;

    // Handlers
    const getMouseZone = useCallback((mouseX: number, mouseY: number): DragMode => {
        if (mouseY > innerHeight && mouseY < innerHeight + margin.bottom && mouseX >= 0 && mouseX <= innerWidth) return 'xAxis';
        if (mouseX < 0 && mouseX > -margin.left && mouseY >= 0 && mouseY <= innerHeight) return 'yAxis';
        if (mouseX >= 0 && mouseX <= innerWidth && mouseY >= 0 && mouseY <= innerHeight) return 'pan';
        return 'none';
    }, [innerWidth, innerHeight, margin]);

    const handleMouseDown = useCallback((event: React.MouseEvent) => {
        const point = localPoint(event);
        if (!point) return;
        const mode = getMouseZone(point.x - margin.left, point.y - margin.top);
        if (mode !== 'none') {
            setDragMode(mode);
            setDragStart({ x: event.clientX, y: event.clientY, zoomX, zoomY, panX, panY });
        }
    }, [margin, getMouseZone, zoomX, zoomY, panX, panY]);

    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        const point = localPoint(event);
        if (point) setHoverZone(getMouseZone(point.x - margin.left, point.y - margin.top));

        const dx = event.clientX - dragStart.x;
        const dy = event.clientY - dragStart.y;

        if (dragMode === 'xAxis') {
            setZoomX(Math.max(0.1, Math.min(10, dragStart.zoomX * (1 + dx / 200))));
        } else if (dragMode === 'yAxis') {
            setZoomY(Math.max(0.1, Math.min(10, dragStart.zoomY * (1 - dy / 200))));
        } else if (dragMode === 'pan') {
            const xRange = (baseBounds.maxX - baseBounds.minX) / zoomX;
            const yRange = (baseBounds.maxY - baseBounds.minY) / zoomY;
            setPanX(dragStart.panX - (dx / innerWidth) * xRange);
            setPanY(dragStart.panY + (dy / innerHeight) * yRange);
        } else if (perSourceData.sources && point) {
            const mouseX = point.x - margin.left;
            const mouseY = point.y - margin.top;
            if (mouseX < 0 || mouseX > innerWidth || mouseY < 0 || mouseY > innerHeight) {
                hideTooltip();
                setCrosshairPos(null);
                return;
            }
            const price = xScale.invert(mouseX);
            setCrosshairPos({ x: mouseX, y: mouseY, price });

            const values: { sourceLabel: string; greek: string; value: number; color: string }[] = [];
            (Object.keys(visibleGreeks) as GreekType[]).forEach(type => {
                if (visibleGreeks[type]) {
                    perSourceData.sources.forEach(src => {
                        const data = src.greeks[type];
                        const idx = Math.min(Math.max(0, bisectPrice(data, price, 1) - 1), data.length - 1);
                        const val = data[idx]?.raw || 0;
                        values.push({
                            sourceLabel: src.label,
                            greek: greekLabels[type],
                            value: val,
                            color: greekColors[type]
                        });
                    });
                }
            });

            showTooltip({
                tooltipData: { price, values },
                tooltipLeft: point.x,
                tooltipTop: point.y,
            });
        }
    }, [dragMode, dragStart, baseBounds, zoomX, zoomY, innerWidth, innerHeight, perSourceData, xScale, margin, bisectPrice, showTooltip, hideTooltip, getMouseZone, visibleGreeks]);

    const handleMouseUp = () => setDragMode('none');
    const handleMouseLeave = () => { setDragMode('none'); hideTooltip(); setCrosshairPos(null); };
    const resetView = () => { setZoomX(1); setZoomY(1); setPanX(0); setPanY(0); };

    if (!hasData) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-foreground-muted bg-transparent p-4">
                <Activity size={32} className="mb-2 opacity-50" />
                <p className="text-sm">Connect a Market Screener</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-transparent overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-2 py-1 border-b border-[rgba(48,54,61,0.5)] flex items-center gap-2 bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-1 bg-black/30 px-1.5 py-0.5 rounded">
                    <Zap size={10} className={isConnected ? 'text-green-400' : 'text-gray-500'} />
                    <span className="text-[10px] font-mono text-white">${livePrice.toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-1">
                    {(Object.keys(greekColors) as GreekType[]).map(greek => (
                        <button
                            key={greek}
                            onClick={() => setVisibleGreeks(p => ({ ...p, [greek]: !p[greek] }))}
                            className={`text-[9px] px-2 py-0.5 rounded transition-all ${visibleGreeks[greek] ? 'text-white' : 'text-gray-600'}`}
                            style={{ backgroundColor: visibleGreeks[greek] ? greekColors[greek] + '40' : 'transparent', color: visibleGreeks[greek] ? greekColors[greek] : undefined }}
                        >
                            {greekLabels[greek].split(' ')[0]}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                <div className="flex items-center gap-1 text-[9px]">
                    <span className="text-gray-500">DTE</span>
                    <input type="number" value={daysToExpiry} onChange={(e) => setDaysToExpiry(Math.max(1, Math.min(365, Number(e.target.value))))} className="w-8 bg-black/30 text-white px-1 py-0.5 rounded text-center border border-gray-800" />
                </div>

                <button onClick={resetView} className="p-1 bg-black/30 hover:bg-black/50 rounded text-gray-400 hover:text-white">
                    <RotateCcw size={10} />
                </button>
            </div>

            {/* Chart */}
            <div ref={containerRef} className="flex-1 min-h-0 w-full relative" style={{ touchAction: 'none', cursor: dragMode !== 'none' ? 'grabbing' : 'default' }}>
                {innerWidth > 0 && innerHeight > 0 && perSourceData.sources && (
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
                                <clipPath id={`clip-${widgetId}`}><rect width={innerWidth} height={innerHeight} /></clipPath>
                            </defs>
                            <GridRows scale={yScale} width={innerWidth} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />
                            <GridColumns scale={xScale} height={innerHeight} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />
                            <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="#58a6ff" strokeWidth={1} />
                            <line x1={xScale(livePrice)} x2={xScale(livePrice)} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.5)" strokeWidth={1} strokeDasharray="4,4" />

                            <g clipPath={`url(#clip-${widgetId})`}>
                                {(Object.keys(visibleGreeks) as GreekType[]).map(type => {
                                    if (!visibleGreeks[type]) return null;
                                    return perSourceData.sources.map((src, idx) => (
                                        <LinePath
                                            key={`${src.label}-${type}`}
                                            data={src.greeks[type]}
                                            x={d => xScale(d.price)}
                                            y={d => yScale(d.value)}
                                            stroke={greekColors[type]}
                                            strokeWidth={2}
                                            strokeDasharray={idx === 0 ? '' : idx === 1 ? '5,5' : '2,2'}
                                            curve={curveMonotoneX}
                                            opacity={0.8}
                                        />
                                    ));
                                })}
                            </g>

                            {crosshairPos && dragMode === 'none' && (
                                <>
                                    <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                    <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                </>
                            )}

                            <rect x={-margin.left} y={0} width={margin.left} height={innerHeight} fill={hoverZone === 'yAxis' || dragMode === 'yAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'} style={{ cursor: 'ns-resize' }} />
                            <AxisLeft scale={yScale} stroke="rgba(125, 133, 144, 0.3)" tickStroke="rgba(125, 133, 144, 0.3)" tickLabelProps={() => ({ fill: '#7d8590', fontSize: 9, textAnchor: 'end', dy: 3 })} numTicks={6} />

                            <rect x={0} y={innerHeight} width={innerWidth} height={margin.bottom} fill={hoverZone === 'xAxis' || dragMode === 'xAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'} style={{ cursor: 'ew-resize' }} />
                            <AxisBottom scale={xScale} top={innerHeight} tickFormat={v => `${(Number(v) / 1000).toFixed(0)}k`} stroke="rgba(125, 133, 144, 0.3)" tickStroke="rgba(125, 133, 144, 0.3)" tickLabelProps={() => ({ fill: '#7d8590', fontSize: 9, textAnchor: 'middle' })} numTicks={6} />
                        </Group>
                    </svg>
                )}

                {tooltipOpen && tooltipData && dragMode === 'none' && (
                    <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
                        <div className="font-mono space-y-1">
                            <div className="text-cyan-400 font-bold text-xs">${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            {tooltipData.values.map((v, i) => (
                                <div key={i} className="flex items-center gap-1 text-[10px]">
                                    <span className="text-gray-400">{v.sourceLabel}</span>
                                    <span style={{ color: v.color }}>{v.greek.split(' ')[0]}:</span>
                                    <span className="text-white">{v.value.toFixed(4)}</span>
                                </div>
                            ))}
                        </div>
                    </TooltipWithBounds>
                )}
            </div>

            <div className="shrink-0 px-2 py-1 border-t border-[rgba(48,54,61,0.3)] bg-[rgba(0,0,0,0.2)] text-[8px] text-gray-600 text-center">
                Drag axes to scale • Drag chart to pan • Scroll to zoom
            </div>
        </div>
    );
}

export default GreeksVizWidget;
