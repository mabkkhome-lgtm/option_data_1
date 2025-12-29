'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Zap, TrendingUp, TrendingDown, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateOptionPrice, generatePriceRange } from '@/lib/options/blackScholes';

// Visx imports for smooth SVG charting (like Thales)
import { scaleLinear } from '@visx/scale';
import { LinePath, AreaClosed } from '@visx/shape';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { localPoint } from '@visx/event';
import { Zoom } from '@visx/zoom';
import { RectClipPath } from '@visx/clip-path';
import { curveMonotoneX } from '@visx/curve';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { bisector } from 'd3-array';

interface PayoffChartProps {
    widgetId: string;
}

// Tooltip styles matching dark theme
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

    // Tooltip state
    const { showTooltip, hideTooltip, tooltipOpen, tooltipData, tooltipLeft, tooltipTop } = useTooltip<{
        price: number;
        values: { label: string; value: number; color: string }[];
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

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setDimensions({ width, height });
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
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

    // Initial transform for zoom
    const initialTransform = {
        scaleX: 1,
        scaleY: 1,
        translateX: 0,
        translateY: 0,
        skewX: 0,
        skewY: 0,
    };

    // Bisector for tooltip
    const bisectPrice = bisector<{ price: number; pnl: number }, number>(d => d.price).left;

    // Handle tooltip
    const handleTooltip = useCallback(
        (event: React.MouseEvent | React.TouchEvent, xScale: any, yScale: any) => {
            if (!chartData) return;

            const point = localPoint(event);
            if (!point) return;

            const x = point.x - margin.left;
            const price = xScale.invert(x);

            const values = chartData.sourcesData.flatMap(data => {
                const result: { label: string; value: number; color: string }[] = [];

                if (showExpiry) {
                    const idx = bisectPrice(data.expiryPayoffs, price, 1);
                    const d0 = data.expiryPayoffs[idx - 1];
                    const d1 = data.expiryPayoffs[idx];
                    const d = d1 && price - d0?.price > d1.price - price ? d1 : d0;
                    if (d) {
                        result.push({ label: `${data.source.label} Expiry`, value: d.pnl, color: data.source.color || '#a855f7' });
                    }
                }

                if (showNow) {
                    const idx = bisectPrice(data.currentPayoffs, price, 1);
                    const d0 = data.currentPayoffs[idx - 1];
                    const d1 = data.currentPayoffs[idx];
                    const d = d1 && price - d0?.price > d1.price - price ? d1 : d0;
                    if (d) {
                        result.push({ label: `${data.source.label} Now`, value: d.pnl, color: '#22d3ee' });
                    }
                }

                return result;
            });

            showTooltip({
                tooltipData: { price, values },
                tooltipLeft: point.x,
                tooltipTop: point.y,
            });
        },
        [chartData, showExpiry, showNow, showTooltip, margin.left, bisectPrice]
    );

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
            </div>

            {/* Chart - SVG based for smooth interactions */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 nodrag nowheel nopan"
                style={{ touchAction: 'none' }}
            >
                {chartData && innerWidth > 0 && innerHeight > 0 && (
                    <Zoom<SVGSVGElement>
                        width={dimensions.width}
                        height={dimensions.height}
                        scaleXMin={0.5}
                        scaleXMax={10}
                        scaleYMin={0.5}
                        scaleYMax={10}
                        initialTransformMatrix={initialTransform}
                    >
                        {(zoom) => {
                            // Create scales with zoom transform applied
                            const xScale = scaleLinear({
                                domain: [chartData.minPrice, chartData.maxPrice],
                                range: [0, innerWidth],
                            });

                            const yScale = scaleLinear({
                                domain: [chartData.minPnL, chartData.maxPnL],
                                range: [innerHeight, 0],
                            });

                            // Apply zoom transformation to scales
                            const zoomedXScale = scaleLinear({
                                domain: xScale.domain().map(d => (d - zoom.transformMatrix.translateX / zoom.transformMatrix.scaleX) / zoom.transformMatrix.scaleX * zoom.transformMatrix.scaleX + zoom.transformMatrix.translateX / zoom.transformMatrix.scaleX),
                                range: [0, innerWidth],
                            });

                            return (
                                <svg
                                    width={dimensions.width}
                                    height={dimensions.height}
                                    ref={zoom.containerRef}
                                    style={{ cursor: zoom.isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                                    onMouseDown={zoom.dragStart}
                                    onMouseMove={(e) => {
                                        zoom.dragMove(e);
                                        if (!zoom.isDragging) {
                                            handleTooltip(e, xScale, yScale);
                                        }
                                    }}
                                    onMouseUp={zoom.dragEnd}
                                    onMouseLeave={() => {
                                        zoom.dragEnd();
                                        hideTooltip();
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
                                    <RectClipPath id={`chart-clip-${widgetId}`} width={innerWidth} height={innerHeight} />

                                    {/* Background */}
                                    <rect width={dimensions.width} height={dimensions.height} fill="transparent" />

                                    <Group left={margin.left} top={margin.top}>
                                        {/* Apply zoom transform */}
                                        <g transform={zoom.toString()}>
                                            {/* Grid */}
                                            <GridRows
                                                scale={yScale}
                                                width={innerWidth}
                                                stroke="rgba(72, 79, 88, 0.3)"
                                                strokeDasharray="2,2"
                                            />
                                            <GridColumns
                                                scale={xScale}
                                                height={innerHeight}
                                                stroke="rgba(72, 79, 88, 0.3)"
                                                strokeDasharray="2,2"
                                            />

                                            {/* Zero line */}
                                            <line
                                                x1={0}
                                                x2={innerWidth}
                                                y1={yScale(0)}
                                                y2={yScale(0)}
                                                stroke="#58a6ff"
                                                strokeWidth={1}
                                            />

                                            {/* Current price line */}
                                            <line
                                                x1={xScale(livePrice)}
                                                x2={xScale(livePrice)}
                                                y1={0}
                                                y2={innerHeight}
                                                stroke="#fbbf24"
                                                strokeWidth={2}
                                                strokeDasharray="5,5"
                                            />
                                            <text
                                                x={xScale(livePrice)}
                                                y={-5}
                                                fill="#fbbf24"
                                                fontSize={10}
                                                textAnchor="middle"
                                            >
                                                ${livePrice.toLocaleString()}
                                            </text>

                                            {/* P&L curves */}
                                            {chartData.sourcesData.map((data, idx) => (
                                                <g key={data.source.sourceId}>
                                                    {showExpiry && (
                                                        <>
                                                            {/* Fill area for expiry */}
                                                            <AreaClosed
                                                                data={data.expiryPayoffs}
                                                                x={d => xScale(d.price)}
                                                                y={d => yScale(d.pnl)}
                                                                yScale={yScale}
                                                                curve={curveMonotoneX}
                                                                fill={`url(#gradient-${idx})`}
                                                                opacity={0.3}
                                                            />
                                                            {/* Line for expiry */}
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

                                            {/* Gradient definitions */}
                                            <defs>
                                                {chartData.sourcesData.map((data, idx) => (
                                                    <linearGradient key={idx} id={`gradient-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                                                        <stop offset="50%" stopColor="transparent" stopOpacity={0} />
                                                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
                                                    </linearGradient>
                                                ))}
                                            </defs>
                                        </g>

                                        {/* Axes (outside zoom transform so they stay fixed) */}
                                        <AxisLeft
                                            scale={yScale}
                                            stroke="#484f58"
                                            tickStroke="#484f58"
                                            tickLabelProps={() => ({
                                                fill: '#7d8590',
                                                fontSize: 10,
                                                textAnchor: 'end',
                                                dy: '0.33em',
                                                dx: -4,
                                            })}
                                            tickFormat={(v) => `$${Number(v).toLocaleString()}`}
                                            numTicks={5}
                                        />
                                        <AxisBottom
                                            scale={xScale}
                                            top={innerHeight}
                                            stroke="#484f58"
                                            tickStroke="#484f58"
                                            tickLabelProps={() => ({
                                                fill: '#7d8590',
                                                fontSize: 10,
                                                textAnchor: 'middle',
                                            })}
                                            tickFormat={(v) => `$${Number(v).toLocaleString()}`}
                                            numTicks={5}
                                        />

                                        {/* Axis labels */}
                                        <text
                                            x={innerWidth / 2}
                                            y={innerHeight + 40}
                                            fill="#7d8590"
                                            fontSize={11}
                                            textAnchor="middle"
                                        >
                                            Underlying Price
                                        </text>
                                        <text
                                            x={-innerHeight / 2}
                                            y={-50}
                                            fill="#7d8590"
                                            fontSize={11}
                                            textAnchor="middle"
                                            transform="rotate(-90)"
                                        >
                                            P&L ($)
                                        </text>
                                    </Group>

                                    {/* Zoom controls */}
                                    <Group top={margin.top + 5} left={dimensions.width - 80}>
                                        <rect
                                            x={0}
                                            y={0}
                                            width={24}
                                            height={24}
                                            rx={4}
                                            fill="rgba(13, 17, 23, 0.8)"
                                            stroke="rgba(88, 166, 255, 0.3)"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => zoom.scale({ scaleX: 1.2, scaleY: 1.2 })}
                                        />
                                        <text x={12} y={16} fill="#7d8590" fontSize={14} textAnchor="middle" style={{ pointerEvents: 'none' }}>+</text>

                                        <rect
                                            x={28}
                                            y={0}
                                            width={24}
                                            height={24}
                                            rx={4}
                                            fill="rgba(13, 17, 23, 0.8)"
                                            stroke="rgba(88, 166, 255, 0.3)"
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => zoom.scale({ scaleX: 0.8, scaleY: 0.8 })}
                                        />
                                        <text x={40} y={16} fill="#7d8590" fontSize={14} textAnchor="middle" style={{ pointerEvents: 'none' }}>−</text>

                                        <rect
                                            x={56}
                                            y={0}
                                            width={24}
                                            height={24}
                                            rx={4}
                                            fill="rgba(13, 17, 23, 0.8)"
                                            stroke="rgba(88, 166, 255, 0.3)"
                                            style={{ cursor: 'pointer' }}
                                            onClick={zoom.reset}
                                        />
                                        <text x={68} y={16} fill="#7d8590" fontSize={10} textAnchor="middle" style={{ pointerEvents: 'none' }}>⟲</text>
                                    </Group>
                                </svg>
                            );
                        }}
                    </Zoom>
                )}
            </div>

            {/* Tooltip */}
            {tooltipOpen && tooltipData && (
                <TooltipWithBounds
                    left={tooltipLeft}
                    top={tooltipTop}
                    style={tooltipStyles}
                >
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
                    <div className="ml-auto text-gray-500 text-[10px]">
                        Scroll to zoom • Drag to pan • Click +/− to zoom
                    </div>
                </div>
            </div>
        </div>
    );
}
