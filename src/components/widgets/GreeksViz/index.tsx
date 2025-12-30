'use client';

import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Zap } from 'lucide-react';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { useLivePriceStore } from '@/stores/livePrice';
import { calculateGreeks, generatePriceRange } from '@/lib/options/blackScholes';

// Visx imports for smooth SVG charting (like Thales)
import { scaleLinear } from '@visx/scale';
import { LinePath, AreaClosed } from '@visx/shape';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { localPoint } from '@visx/event';
import { Zoom } from '@visx/zoom';
import { curveMonotoneX } from '@visx/curve';
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip';
import { bisector } from 'd3-array';

type GreekType = 'delta' | 'gamma' | 'theta' | 'vega';

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

    // Tooltip and crosshair state
    const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number; price: number; value: number } | null>(null);
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

    const [visibleGreeks, setVisibleGreeks] = useState<Record<GreekType, boolean>>({
        delta: true,
        gamma: false,
        theta: false,
        vega: false,
    });
    const [daysToExpiry, setDaysToExpiry] = useState(30);

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

        // Set initial dimensions immediately
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            setDimensions({ width: rect.width, height: rect.height });
        }

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setDimensions({ width, height });
                }
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
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
    const chartBounds = useMemo(() => {
        if (perSourceData.length === 0) return { minX: 0, maxX: 100, minY: -1, maxY: 1 };

        const allPrices = perSourceData[0]?.prices || [];
        const minX = Math.min(...allPrices);
        const maxX = Math.max(...allPrices);

        let minY = 0;
        let maxY = 0;

        for (const sourceData of perSourceData) {
            for (const greek of Object.keys(visibleGreeks) as GreekType[]) {
                if (visibleGreeks[greek]) {
                    const values = sourceData.greeks[greek].map(d => d.value);
                    minY = Math.min(minY, ...values);
                    maxY = Math.max(maxY, ...values);
                }
            }
        }

        // Add padding
        const yPadding = (maxY - minY) * 0.1 || 0.1;
        return { minX, maxX, minY: minY - yPadding, maxY: maxY + yPadding };
    }, [perSourceData, visibleGreeks]);

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
    const bisectPrice = bisector<{ price: number; value: number }, number>(d => d.price).left;

    // Handle tooltip and crosshair
    const handleTooltip = useCallback(
        (event: React.MouseEvent | React.TouchEvent, xScale: any, yScale: any) => {
            if (perSourceData.length === 0) return;

            const point = localPoint(event);
            if (!point) return;

            const x = point.x - margin.left;
            const y = point.y - margin.top;
            const price = xScale.invert(x);
            const yValue = yScale.invert(y);

            const values: { label: string; value: number; color: string }[] = [];

            for (const sourceData of perSourceData) {
                for (const greek of Object.keys(visibleGreeks) as GreekType[]) {
                    if (visibleGreeks[greek]) {
                        const data = sourceData.greeks[greek];
                        const idx = bisectPrice(data, price, 1);
                        const d0 = data[idx - 1];
                        const d1 = data[idx];
                        const d = d1 && price - d0?.price > d1.price - price ? d1 : d0;
                        if (d) {
                            values.push({
                                label: `${sourceData.source.label} ${greek.charAt(0).toUpperCase() + greek.slice(1)}`,
                                value: d.value,
                                color: greekColors[greek],
                            });
                        }
                    }
                }
            }

            // Get primary value for crosshair label
            const primaryValue = values.length > 0 ? values[0].value : yValue;

            // Update crosshair position
            setCrosshairPos({
                x: Math.max(0, Math.min(innerWidth, x)),
                y: Math.max(0, Math.min(innerHeight, y)),
                price,
                value: primaryValue,
            });

            showTooltip({
                tooltipData: { price, values },
                tooltipLeft: point.x,
                tooltipTop: point.y,
            });
        },
        [perSourceData, visibleGreeks, showTooltip, margin.left, margin.top, innerWidth, innerHeight, bisectPrice]
    );

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
                            style={{
                                backgroundColor: visibleGreeks[greek] ? greekColors[greek] + '40' : 'transparent',
                                borderColor: greekColors[greek],
                            }}
                        >
                            {greek.charAt(0).toUpperCase() + greek.slice(1)}
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
            </div>

            {/* Chart - SVG based for smooth interactions */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 nodrag nowheel nopan"
                style={{ touchAction: 'none', width: '100%', height: '100%', minHeight: '200px' }}
            >
                {innerWidth > 0 && innerHeight > 0 && (
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
                            // Create scales
                            const xScale = scaleLinear({
                                domain: [chartBounds.minX, chartBounds.maxX],
                                range: [0, innerWidth],
                            });

                            const yScale = scaleLinear({
                                domain: [chartBounds.minY, chartBounds.maxY],
                                range: [innerHeight, 0],
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

                                            {/* Greek curves */}
                                            {perSourceData.map((sourceData) => (
                                                <g key={sourceData.source.sourceId}>
                                                    {(Object.keys(greekColors) as GreekType[]).map(greek => {
                                                        if (!visibleGreeks[greek]) return null;
                                                        return (
                                                            <g key={greek}>
                                                                {/* Area fill */}
                                                                <AreaClosed
                                                                    data={sourceData.greeks[greek]}
                                                                    x={d => xScale(d.price)}
                                                                    y={d => yScale(d.value)}
                                                                    yScale={yScale}
                                                                    curve={curveMonotoneX}
                                                                    fill={greekColors[greek]}
                                                                    opacity={0.15}
                                                                />
                                                                {/* Line */}
                                                                <LinePath
                                                                    data={sourceData.greeks[greek]}
                                                                    x={d => xScale(d.price)}
                                                                    y={d => yScale(d.value)}
                                                                    stroke={greekColors[greek]}
                                                                    strokeWidth={2}
                                                                    curve={curveMonotoneX}
                                                                />
                                                            </g>
                                                        );
                                                    })}
                                                </g>
                                            ))}
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
                                            tickFormat={(v) => Number(v).toFixed(2)}
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

                                        {/* Crosshair - follows mouse cursor */}
                                        {crosshairPos && tooltipOpen && (
                                            <g style={{ pointerEvents: 'none' }}>
                                                {/* Vertical line */}
                                                <line
                                                    x1={crosshairPos.x}
                                                    x2={crosshairPos.x}
                                                    y1={0}
                                                    y2={innerHeight}
                                                    stroke="#58a6ff"
                                                    strokeWidth={1}
                                                    strokeDasharray="4,2"
                                                    opacity={0.8}
                                                />
                                                {/* Horizontal line */}
                                                <line
                                                    x1={0}
                                                    x2={innerWidth}
                                                    y1={crosshairPos.y}
                                                    y2={crosshairPos.y}
                                                    stroke="#58a6ff"
                                                    strokeWidth={1}
                                                    strokeDasharray="4,2"
                                                    opacity={0.8}
                                                />
                                                {/* Price label at bottom of vertical line */}
                                                <g transform={`translate(${crosshairPos.x}, ${innerHeight + 5})`}>
                                                    <rect
                                                        x={-35}
                                                        y={0}
                                                        width={70}
                                                        height={18}
                                                        fill="rgba(88, 166, 255, 0.9)"
                                                        rx={3}
                                                    />
                                                    <text
                                                        x={0}
                                                        y={13}
                                                        fill="#fff"
                                                        fontSize={10}
                                                        fontWeight="bold"
                                                        textAnchor="middle"
                                                        fontFamily="monospace"
                                                    >
                                                        ${crosshairPos.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                                    </text>
                                                </g>
                                                {/* Value label at left of horizontal line */}
                                                <g transform={`translate(-5, ${crosshairPos.y})`}>
                                                    <rect
                                                        x={-50}
                                                        y={-9}
                                                        width={50}
                                                        height={18}
                                                        fill="rgba(88, 166, 255, 0.9)"
                                                        rx={3}
                                                    />
                                                    <text
                                                        x={-25}
                                                        y={4}
                                                        fill="#fff"
                                                        fontSize={10}
                                                        fontWeight="bold"
                                                        textAnchor="middle"
                                                        fontFamily="monospace"
                                                    >
                                                        {crosshairPos.value.toFixed(3)}
                                                    </text>
                                                </g>
                                                {/* Crosshair circle at intersection */}
                                                <circle
                                                    cx={crosshairPos.x}
                                                    cy={crosshairPos.y}
                                                    r={4}
                                                    fill="#58a6ff"
                                                    stroke="#fff"
                                                    strokeWidth={1.5}
                                                />
                                            </g>
                                        )}
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
                                <span className="text-white">{v.value.toFixed(4)}</span>
                            </div>
                        ))}
                    </div>
                </TooltipWithBounds>
            )}

            {/* Footer - Greek values at current spot */}
            <div className="px-3 py-2 border-t border-[rgba(48,54,61,0.5)] bg-[rgba(255,255,255,0.02)]">
                <div className="flex items-center gap-4 text-xs">
                    {perSourceData.map(data => (
                        <div key={data.source.sourceId} className="flex items-center gap-3">
                            <span style={{ color: data.source.color }} className="font-medium">{data.source.label}:</span>
                            {(Object.keys(greekColors) as GreekType[]).map(greek => {
                                if (!visibleGreeks[greek]) return null;
                                return (
                                    <span key={greek} className="font-mono" style={{ color: greekColors[greek] }}>
                                        {greek.charAt(0).toUpperCase()}: {data.greeksAtSpot[greek].toFixed(3)}
                                    </span>
                                );
                            })}
                        </div>
                    ))}
                    <div className="ml-auto text-gray-500 text-[10px]">
                        Scroll to zoom • Drag to pan
                    </div>
                </div>
            </div>
        </div>
    );
}
