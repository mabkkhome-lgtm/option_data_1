'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Zap, TrendingUp, TrendingDown, RotateCcw, Activity } from 'lucide-react';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateOptionPrice, generatePriceRange } from '@/lib/options/blackScholes';

import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { localPoint } from '@visx/event';
import { curveMonotoneX } from '@visx/curve';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { bisector } from 'd3-array';

type DragMode = 'none' | 'pan' | 'xAxis' | 'yAxis';

interface PayoffChartProps {
    widgetId: string;
}

interface DataPoint {
    price: number;
    pnl: number;
}

interface SourcePayoffData {
    sourceId: string;
    label: string;
    color: string;
    expiryPayoffs: DataPoint[];
    currentPayoffs: DataPoint[];
    minPnL: number;
    maxPnL: number;
}

// Default colors
const sourceColors = [
    { solid: '#ef4444', dashed: '#f97316' },
    { solid: '#eab308', dashed: '#fbbf24' },
    { solid: '#22c55e', dashed: '#10b981' },
    { solid: '#06b6d4', dashed: '#0ea5e9' },
    { solid: '#a855f7', dashed: '#8b5cf6' },
];

const getSourceColor = (label: string, index: number) => {
    const l = label.toLowerCase();
    if (l.includes('long') || l.includes('buy')) return '#22c55e';
    if (l.includes('short') || l.includes('sell')) return '#ef4444';
    return sourceColors[index % sourceColors.length].solid;
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

export function PayoffChartWidget({ widgetId }: PayoffChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Store connections
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    // Live price
    const { btcPrice, isConnected } = useLivePriceStore();
    const livePrice = btcPrice || 95000;

    // View options
    const [daysToExpiry, setDaysToExpiry] = useState(30);
    const [showExpiry, setShowExpiry] = useState(true);
    const [showNow, setShowNow] = useState(true);

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
        sources: { label: string; offset: number; expiry: number; current: number; color: string }[];
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

    // Responsive sizing
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

    // Calculate Data Per Source
    const perSourceData = useMemo((): SourcePayoffData[] => {
        if (!hasData) return [];

        const prices = generatePriceRange(livePrice, 0.3, 100);
        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        return connectedSources.map((source, idx) => {
            const expiryPayoffs: DataPoint[] = [];
            const currentPayoffs: DataPoint[] = [];

            for (const spotPrice of prices) {
                let expiryPnL = 0;
                let currentPnL = 0;

                for (const trade of source.trades) {
                    const isCall = trade.type === 'call';
                    const isLong = trade.direction === 'buy';
                    const strike = trade.strike;
                    const size = trade.size || 1;
                    const premium = (trade.price || 0) * (trade.underlying || trade.indexPrice || livePrice);
                    // Note: Simplification used priceUSD in combined chart, here calculating from premium * underlying if not available?
                    // CombinedChart used trade.priceUSD. Let's try to align.
                    const cost = (trade.priceUSD || premium) * size;

                    const iv = trade.iv ? trade.iv / 100 : 0.8;

                    // Payoff at Expiry
                    const intrinsic = isCall ? Math.max(0, spotPrice - strike) : Math.max(0, strike - spotPrice);
                    const expiryValue = intrinsic * size;
                    expiryPnL += isLong ? (expiryValue - cost) : (cost - expiryValue);

                    // Payoff Now
                    const currentPrice = calculateOptionPrice(spotPrice, strike, T, r, iv, isCall ? 'call' : 'put');
                    const currentValue = currentPrice * size;
                    currentPnL += isLong ? (currentValue - cost) : (cost - currentValue);
                }
                expiryPayoffs.push({ price: spotPrice, pnl: expiryPnL });
                currentPayoffs.push({ price: spotPrice, pnl: currentPnL });
            }

            const allVals = [...expiryPayoffs.map(d => d.pnl), ...currentPayoffs.map(d => d.pnl)];

            return {
                sourceId: source.sourceId,
                label: source.label,
                color: getSourceColor(source.label, idx),
                expiryPayoffs,
                currentPayoffs,
                minPnL: Math.min(...allVals),
                maxPnL: Math.max(...allVals)
            };
        });
    }, [hasData, connectedSources, livePrice, daysToExpiry]);

    // Bounds
    const baseBounds = useMemo(() => {
        if (perSourceData.length === 0) return { minX: 80000, maxX: 100000, minY: -1000, maxY: 1000 };

        const prices = perSourceData[0].expiryPayoffs.map(d => d.price);
        const minX = prices[0];
        const maxX = prices[prices.length - 1];

        const minPnL = Math.min(...perSourceData.map(s => s.minPnL));
        const maxPnL = Math.max(...perSourceData.map(s => s.maxPnL));

        const padding = Math.max(Math.abs(maxPnL - minPnL) * 0.1, 100);

        return {
            minX, maxX,
            minY: minPnL - padding,
            maxY: maxPnL + padding
        };
    }, [perSourceData]);

    // Apply zoom/pan
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

    const xScale = useMemo(() => scaleLinear({ domain: [visibleBounds.minX, visibleBounds.maxX], range: [0, innerWidth] }), [visibleBounds, innerWidth]);
    const yScale = useMemo(() => scaleLinear({ domain: [visibleBounds.minY, visibleBounds.maxY], range: [innerHeight, 0] }), [visibleBounds, innerHeight]);
    const bisectPrice = bisector<DataPoint, number>(d => d.price).left;

    // Mouse handlers
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
        } else if (perSourceData.length > 0 && point) {
            const mouseX = point.x - margin.left;
            const mouseY = point.y - margin.top;
            if (mouseX < 0 || mouseX > innerWidth || mouseY < 0 || mouseY > innerHeight) {
                hideTooltip();
                setCrosshairPos(null);
                return;
            }
            const price = xScale.invert(mouseX);
            setCrosshairPos({ x: mouseX, y: mouseY, price });

            const sources = perSourceData.map(src => {
                const idx = Math.min(Math.max(0, bisectPrice(src.expiryPayoffs, price, 1) - 1), src.expiryPayoffs.length - 1);
                return {
                    label: src.label,
                    color: src.color,
                    expiry: src.expiryPayoffs[idx]?.pnl || 0,
                    current: src.currentPayoffs[idx]?.pnl || 0,
                    offset: 0
                };
            });

            showTooltip({
                tooltipData: { price, sources },
                tooltipLeft: point.x,
                tooltipTop: point.y,
            });
        }
    }, [dragMode, dragStart, baseBounds, zoomX, zoomY, innerWidth, innerHeight, perSourceData, xScale, margin, bisectPrice, showTooltip, hideTooltip, getMouseZone]);

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

                {/* Legends */}
                <div className="flex items-center gap-2 overflow-hidden">
                    {perSourceData.map(src => (
                        <div key={src.sourceId} className="flex items-center gap-1 text-[9px]">
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: src.color }} />
                            <span className="text-gray-400 truncate max-w-[60px]">{src.label}</span>
                        </div>
                    ))}
                </div>

                <div className="flex-1" />

                <div className="flex items-center gap-1 ml-auto">
                    <button onClick={() => setShowExpiry(!showExpiry)} className={`text-[9px] px-1.5 py-0.5 rounded ${showExpiry ? 'bg-purple-500/30 text-purple-300' : 'text-gray-600'}`}>Exp</button>
                    <button onClick={() => setShowNow(!showNow)} className={`text-[9px] px-1.5 py-0.5 rounded ${showNow ? 'bg-cyan-500/30 text-cyan-300' : 'text-gray-600'}`}>Now</button>
                </div>

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
                {innerWidth > 0 && innerHeight > 0 && (
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
                                {perSourceData.map(src => (
                                    <g key={src.sourceId}>
                                        {showExpiry && (
                                            <LinePath
                                                data={src.expiryPayoffs}
                                                x={d => xScale(d.price)}
                                                y={d => yScale(d.pnl)}
                                                stroke={src.color}
                                                strokeWidth={2}
                                                curve={curveMonotoneX}
                                            />
                                        )}
                                        {showNow && (
                                            <LinePath
                                                data={src.currentPayoffs}
                                                x={d => xScale(d.price)}
                                                y={d => yScale(d.pnl)}
                                                stroke={src.color}
                                                strokeWidth={1.5}
                                                strokeDasharray="4,4"
                                                curve={curveMonotoneX}
                                                opacity={0.8}
                                            />
                                        )}
                                    </g>
                                ))}
                            </g>

                            {crosshairPos && dragMode === 'none' && (
                                <>
                                    <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                    <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                </>
                            )}

                            <rect x={-margin.left} y={0} width={margin.left} height={innerHeight} fill={hoverZone === 'yAxis' || dragMode === 'yAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'} style={{ cursor: 'ns-resize' }} />
                            <AxisLeft scale={yScale} stroke="rgba(125, 133, 144, 0.3)" tickStroke="rgba(125, 133, 144, 0.3)" tickLabelProps={() => ({ fill: '#7d8590', fontSize: 9, textAnchor: 'end', dy: 3 })} numTicks={6} tickFormat={v => `${(Number(v) / 1000).toFixed(0)}k`} />

                            <rect x={0} y={innerHeight} width={innerWidth} height={margin.bottom} fill={hoverZone === 'xAxis' || dragMode === 'xAxis' ? 'rgba(88, 166, 255, 0.1)' : 'transparent'} style={{ cursor: 'ew-resize' }} />
                            <AxisBottom scale={xScale} top={innerHeight} tickFormat={v => `${(Number(v) / 1000).toFixed(0)}k`} stroke="rgba(125, 133, 144, 0.3)" tickStroke="rgba(125, 133, 144, 0.3)" tickLabelProps={() => ({ fill: '#7d8590', fontSize: 9, textAnchor: 'middle' })} numTicks={6} />
                        </Group>
                    </svg>
                )}
                {tooltipOpen && tooltipData && dragMode === 'none' && (
                    <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
                        <div className="font-mono space-y-1">
                            <div className="text-cyan-400 font-bold text-xs">${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            {tooltipData.sources.map((src, i) => (
                                <div key={i} className="border-t border-gray-700 pt-1">
                                    <div className="flex items-center gap-1 text-[10px] mb-0.5">
                                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: src.color }} />
                                        <span className="text-gray-400 font-bold">{src.label}</span>
                                    </div>
                                    {showExpiry && (
                                        <div className="text-[10px] flex justify-between gap-4" style={{ color: src.color }}>
                                            <span>Exp:</span>
                                            <span>{src.expiry >= 0 ? '+' : ''}${src.expiry.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                    )}
                                    {showNow && (
                                        <div className="text-[10px] flex justify-between gap-4 opacity-80" style={{ color: src.color }}>
                                            <span>Now:</span>
                                            <span>{src.current >= 0 ? '+' : ''}${src.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                    )}
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

export default PayoffChartWidget;
