'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Zap, TrendingUp, TrendingDown, RotateCcw } from 'lucide-react';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateOptionPrice, generatePriceRange } from '@/lib/options/blackScholes';

import { scaleLinear } from '@visx/scale';
import { LinePath, AreaClosed } from '@visx/shape';
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

const tooltipStyles = {
    ...defaultStyles,
    background: 'rgba(13, 17, 23, 0.95)',
    border: '1px solid rgba(88, 166, 255, 0.3)',
    color: '#e6edf3',
    fontSize: '12px',
    padding: '8px 12px',
    borderRadius: '8px',
};

export function PayoffChartWidget({ widgetId }: PayoffChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 400, height: 300 });

    // Store connections
    const sourcesMap = useTradesSelectionStore(state => state.sources);
    const connections = useTradesSelectionStore(state => state.connections);
    const allTrades = useTradesSelectionStore(state => state.selectedTrades);

    // Live price
    const { btcPrice, isConnected } = useLivePriceStore();
    const livePrice = btcPrice || 95000;

    // Tooltip and crosshair state
    const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; price: number; pnl: number } | null>(null);
    const { showTooltip, hideTooltip, tooltipOpen, tooltipData, tooltipLeft, tooltipTop } = useTooltip<{
        price: number;
        pnl: number;
        values: { label: string; value: number; color: string }[];
    }>();

    // View options
    const [daysToExpiry, setDaysToExpiry] = useState(30);
    const [showExpiry, setShowExpiry] = useState(true);
    const [showNow, setShowNow] = useState(true);

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

    // Calculate P&L for each source
    const chartData = useMemo(() => {
        if (!hasData) return null;

        const firstTrade = connectedSources[0]?.trades[0];
        const baseUnderlying = livePrice || firstTrade?.underlying || firstTrade?.indexPrice || 95000;
        const prices = generatePriceRange(baseUnderlying, 0.25, 60);
        const T = Math.max(0.001, daysToExpiry / 365);
        const r = 0.05;

        const sourcesData = connectedSources.map(source => {
            const expiryPayoffs: { price: number; pnl: number }[] = [];
            const currentPayoffs: { price: number; pnl: number }[] = [];

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

                expiryPayoffs.push({ price: spotPrice, pnl: expiryPnL });
                currentPayoffs.push({ price: spotPrice, pnl: currentPnL });
            }

            const spotIdx = prices.findIndex(p => p >= livePrice) || Math.floor(prices.length / 2);
            const pnlAtSpot = expiryPayoffs[spotIdx]?.pnl || 0;

            return { source, expiryPayoffs, currentPayoffs, pnlAtSpot };
        });

        // Calculate bounds
        const allPnLs = sourcesData.flatMap(d => [...d.expiryPayoffs.map(p => p.pnl), ...d.currentPayoffs.map(p => p.pnl)]);
        const minPnL = Math.min(...allPnLs) * 1.1;
        const maxPnL = Math.max(...allPnLs) * 1.1;
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        return { prices, sourcesData, minPnL, maxPnL, minPrice, maxPrice };
    }, [connectedSources, livePrice, daysToExpiry, hasData]);

    const totalPnL = chartData?.sourcesData.reduce((sum, d) => sum + d.pnlAtSpot, 0) || 0;
    const isProfitable = totalPnL >= 0;

    // Base bounds
    const baseBounds = useMemo(() => {
        if (!chartData) return { minX: 80000, maxX: 110000, minY: -10000, maxY: 10000 };
        return {
            minX: chartData.minPrice,
            maxX: chartData.maxPrice,
            minY: chartData.minPnL,
            maxY: chartData.maxPnL,
        };
    }, [chartData]);

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
    const bisectPrice = bisector<{ price: number; pnl: number }, number>(d => d.price).left;

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
        } else if (chartData) {
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
            const pnlValue = yScale.invert(mouseY);

            const values = chartData.sourcesData.flatMap(data => {
                const result: { label: string; value: number; color: string }[] = [];

                if (showExpiry) {
                    const idx = Math.min(bisectPrice(data.expiryPayoffs, price, 1) - 1, data.expiryPayoffs.length - 1);
                    const d = data.expiryPayoffs[Math.max(0, idx)];
                    if (d) {
                        result.push({ label: `${data.source.label} Expiry`, value: d.pnl, color: data.source.color || '#a855f7' });
                    }
                }

                if (showNow) {
                    const idx = Math.min(bisectPrice(data.currentPayoffs, price, 1) - 1, data.currentPayoffs.length - 1);
                    const d = data.currentPayoffs[Math.max(0, idx)];
                    if (d) {
                        result.push({ label: `${data.source.label} Now`, value: d.pnl, color: '#22d3ee' });
                    }
                }

                return result;
            });

            const primaryPnL = values.length > 0 ? values[0].value : pnlValue;

            setCrosshairPos({ x: mouseX, y: mouseY, price, pnl: primaryPnL });

            showTooltip({
                tooltipData: { price, pnl: primaryPnL, values },
                tooltipLeft: pt.x,
                tooltipTop: pt.y,
            });
        }
    }, [dragMode, dragStart, baseBounds, zoomX, zoomY, innerWidth, innerHeight, chartData, xScale, yScale, margin, bisectPrice, showExpiry, showNow, showTooltip, hideTooltip, getMouseZone]);

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
                        <p className="text-xs mt-1">to visualize P&L curves</p>
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
                {chartData && innerWidth > 0 && innerHeight > 0 && (
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
                                    <clipPath id={`clip-payoff-${widgetId}`}>
                                        <rect width={innerWidth} height={innerHeight} />
                                    </clipPath>
                                    {chartData.sourcesData.map((data, idx) => (
                                        <linearGradient key={idx} id={`gradient-${widgetId}-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                                            <stop offset="50%" stopColor="transparent" stopOpacity={0} />
                                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                                        </linearGradient>
                                    ))}
                                </defs>

                                {/* Grid */}
                                <GridRows scale={yScale} width={innerWidth} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />
                                <GridColumns scale={xScale} height={innerHeight} stroke="rgba(72, 79, 88, 0.3)" strokeDasharray="2,2" />

                                {/* Zero line (break-even) */}
                                <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} stroke="#58a6ff" strokeWidth={1.5} />

                                {/* Current price line */}
                                <line x1={xScale(livePrice)} x2={xScale(livePrice)} y1={0} y2={innerHeight} stroke="#fbbf24" strokeWidth={2} strokeDasharray="5,5" />
                                <text x={xScale(livePrice)} y={-5} fill="#fbbf24" fontSize={10} textAnchor="middle">
                                    ${livePrice.toLocaleString()}
                                </text>

                                {/* P&L curves */}
                                <g clipPath={`url(#clip-payoff-${widgetId})`}>
                                    {chartData.sourcesData.map((data, idx) => (
                                        <g key={data.source.sourceId}>
                                            {showExpiry && (
                                                <>
                                                    <AreaClosed
                                                        data={data.expiryPayoffs}
                                                        x={d => xScale(d.price)}
                                                        y={d => yScale(d.pnl)}
                                                        yScale={yScale}
                                                        curve={curveMonotoneX}
                                                        fill={`url(#gradient-${widgetId}-${idx})`}
                                                        opacity={0.3}
                                                    />
                                                    <LinePath
                                                        data={data.expiryPayoffs}
                                                        x={d => xScale(d.price)}
                                                        y={d => yScale(d.pnl)}
                                                        stroke={data.source.color || '#a855f7'}
                                                        strokeWidth={2}
                                                        curve={curveMonotoneX}
                                                    />
                                                </>
                                            )}
                                            {showNow && (
                                                <LinePath
                                                    data={data.currentPayoffs}
                                                    x={d => xScale(d.price)}
                                                    y={d => yScale(d.pnl)}
                                                    stroke="#22d3ee"
                                                    strokeWidth={2}
                                                    strokeDasharray="5,5"
                                                    curve={curveMonotoneX}
                                                />
                                            )}
                                        </g>
                                    ))}
                                </g>

                                {/* Crosshair */}
                                {crosshairPos && dragMode === 'none' && (
                                    <>
                                        <line x1={crosshairPos.x} x2={crosshairPos.x} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                        <line x1={0} x2={innerWidth} y1={crosshairPos.y} y2={crosshairPos.y} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="4,4" />
                                        <circle cx={crosshairPos.x} cy={crosshairPos.y} r={4} fill="#58a6ff" stroke="#fff" strokeWidth={1.5} />
                                    </>
                                )}

                                {/* Axes */}
                                <AxisLeft
                                    scale={yScale}
                                    stroke="#484f58"
                                    tickStroke="#484f58"
                                    tickLabelProps={() => ({ fill: '#7d8590', fontSize: 10, textAnchor: 'end', dy: '0.33em', dx: -4 })}
                                    tickFormat={(v) => `$${Number(v).toLocaleString()}`}
                                    numTicks={5}
                                />
                                <AxisBottom
                                    scale={xScale}
                                    top={innerHeight}
                                    stroke="#484f58"
                                    tickStroke="#484f58"
                                    tickLabelProps={() => ({ fill: '#7d8590', fontSize: 10, textAnchor: 'middle' })}
                                    tickFormat={(v) => `$${Number(v).toLocaleString()}`}
                                    numTicks={5}
                                />

                                {/* Axis labels */}
                                <text x={innerWidth / 2} y={innerHeight + 40} fill="#7d8590" fontSize={11} textAnchor="middle">
                                    Underlying Price
                                </text>
                                <text x={-innerHeight / 2} y={-50} fill="#7d8590" fontSize={11} textAnchor="middle" transform="rotate(-90)">
                                    P&L ($)
                                </text>
                            </Group>
                        </svg>
                    </>
                )}

                {/* Tooltip */}
                {tooltipOpen && tooltipData && dragMode === 'none' && (
                    <TooltipWithBounds left={tooltipLeft} top={tooltipTop} style={tooltipStyles}>
                        <div className="font-mono text-xs">
                            <div className="text-gray-400 mb-1">Price: ${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            {tooltipData.values.map((v, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span style={{ color: v.color }}>{v.label}:</span>
                                    <span className={v.value >= 0 ? 'text-green-400' : 'text-red-400'}>
                                        {v.value >= 0 ? '+' : ''}${v.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </TooltipWithBounds>
                )}
            </div>

            {/* Footer */}
            <div className="px-3 py-1.5 border-t border-[rgba(48,54,61,0.3)] bg-[rgba(0,0,0,0.2)] flex items-center gap-4 text-xs">
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
                <div className="ml-auto text-gray-500 text-[9px]">
                    Drag axis to scale • Drag chart to pan • Scroll to zoom
                </div>
            </div>
        </div>
    );
}

export default PayoffChartWidget;
