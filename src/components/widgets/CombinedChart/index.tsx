'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Zap, Activity } from 'lucide-react';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { AxisLeft, AxisBottom } from '@visx/axis';
import { GridRows, GridColumns } from '@visx/grid';
import { Group } from '@visx/group';
import { curveMonotoneX } from '@visx/curve';
import { bisector } from 'd3-array';
import { localPoint } from '@visx/event';
import { useTooltip, TooltipWithBounds } from '@visx/tooltip';

import { useLivePriceStore } from '@/stores/livePrice';
import { useTradesSelectionStore, TradeSource } from '@/stores/tradesSelection';
import { calculateGreeks } from '@/lib/options/blackScholes';

interface CombinedChartProps {
    widgetId: string;
}

interface DataPoint {
    price: number;
    value: number;
}

interface TooltipData {
    price: number;
    payoff: number;
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
    const [crosshairPos, setCrosshairPos] = useState<{ x: number; price: number } | null>(null);

    // Use correct store properties
    const { btcPrice, isConnected } = useLivePriceStore();
    const { getSourcesForTarget } = useTradesSelectionStore();
    const connectedSources = getSourcesForTarget(widgetId);

    const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
        useTooltip<TooltipData>();

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

    // Get trades from connected sources
    const trades = useMemo(() => {
        return connectedSources.flatMap((source: TradeSource) => source.trades);
    }, [connectedSources]);

    const hasData = trades.length > 0;
    const livePrice = btcPrice || 0;
    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const innerWidth = Math.max(0, dimensions.width - margin.left - margin.right);
    const innerHeight = Math.max(0, dimensions.height - margin.top - margin.bottom);

    // Calculate price range
    const priceRange = useMemo(() => {
        if (!hasData || livePrice === 0) {
            return { min: 80000, max: 100000 };
        }
        const range = livePrice * 0.15;
        return { min: livePrice - range, max: livePrice + range };
    }, [hasData, livePrice]);

    // Generate ALL data points - Payoff and Greeks on SAME scale
    const chartData = useMemo(() => {
        if (!hasData) return null;

        const pricePoints: number[] = [];
        for (let i = 0; i <= 100; i++) {
            pricePoints.push(priceRange.min + (priceRange.max - priceRange.min) * (i / 100));
        }

        const payoffExpiry: DataPoint[] = [];
        const payoffNow: DataPoint[] = [];
        const delta: DataPoint[] = [];
        const gamma: DataPoint[] = [];

        const timeToExpiry = daysToExpiry / 365;
        const riskFreeRate = 0.05;
        const iv = trades[0]?.iv ? trades[0].iv / 100 : 0.5;

        for (const price of pricePoints) {
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
                const tradeIV = trade.iv ? trade.iv / 100 : iv;

                // Payoff at expiry (in USD)
                const intrinsic = type === 'call'
                    ? Math.max(0, price - strike)
                    : Math.max(0, strike - price);
                totalPayoffExpiry += (intrinsic * direction - premium) * size;

                // Calculate Greeks using the library
                const greeks = calculateGreeks(price, strike, timeToExpiry, riskFreeRate, tradeIV, type);

                // Payoff now using Black-Scholes option value
                const d1 = (Math.log(price / strike) + (riskFreeRate + tradeIV * tradeIV / 2) * timeToExpiry) / (tradeIV * Math.sqrt(timeToExpiry));
                const d2 = d1 - tradeIV * Math.sqrt(timeToExpiry);
                const nd1 = 0.5 * (1 + erf(d1 / Math.sqrt(2)));
                const nd2 = 0.5 * (1 + erf(d2 / Math.sqrt(2)));
                const nNd1 = 0.5 * (1 + erf(-d1 / Math.sqrt(2)));
                const nNd2 = 0.5 * (1 + erf(-d2 / Math.sqrt(2)));

                let optionValue: number;
                if (type === 'call') {
                    optionValue = price * nd1 - strike * Math.exp(-riskFreeRate * timeToExpiry) * nd2;
                } else {
                    optionValue = strike * Math.exp(-riskFreeRate * timeToExpiry) * nNd2 - price * nNd1;
                }
                totalPayoffNow += (optionValue * direction - premium) * size;

                // Greeks (scale them to be visible with payoff)
                totalDelta += greeks.delta * direction * size * price * 0.01;
                totalGamma += greeks.gamma * Math.abs(size) * price * price * 0.0001;
            }

            payoffExpiry.push({ price, value: totalPayoffExpiry });
            payoffNow.push({ price, value: totalPayoffNow });
            delta.push({ price, value: totalDelta });
            gamma.push({ price, value: totalGamma });
        }

        return { payoffExpiry, payoffNow, delta, gamma };
    }, [hasData, trades, priceRange, daysToExpiry]);

    // X scale (price)
    const xScale = useMemo(() => scaleLinear({
        domain: [priceRange.min, priceRange.max],
        range: [0, innerWidth],
    }), [priceRange, innerWidth]);

    // UNIFIED Y scale - includes ALL visible curves
    const yScale = useMemo(() => {
        if (!chartData) return scaleLinear({ domain: [-1000000, 1000000], range: [innerHeight, 0] });

        const allValues: number[] = [];
        if (visibleCurves.payoffExpiry) allValues.push(...chartData.payoffExpiry.map(d => d.value));
        if (visibleCurves.payoffNow) allValues.push(...chartData.payoffNow.map(d => d.value));
        if (visibleCurves.delta) allValues.push(...chartData.delta.map(d => d.value));
        if (visibleCurves.gamma) allValues.push(...chartData.gamma.map(d => d.value));

        if (allValues.length === 0) return scaleLinear({ domain: [-1000000, 1000000], range: [innerHeight, 0] });

        const minY = Math.min(...allValues);
        const maxY = Math.max(...allValues);
        const padding = Math.max(Math.abs(maxY - minY) * 0.1, 100);

        return scaleLinear({
            domain: [minY - padding, maxY + padding],
            range: [innerHeight, 0],
        });
    }, [chartData, innerHeight, visibleCurves]);

    // Mouse handler
    const handleMouseMove = useCallback((event: React.MouseEvent) => {
        if (!chartData) return;

        const point = localPoint(event);
        if (!point) return;

        const mouseX = point.x - margin.left;
        const price = xScale.invert(mouseX);

        // Find data at this price
        const bisect = bisector<DataPoint, number>(d => d.price).left;
        const idx = Math.min(bisect(chartData.payoffExpiry, price), chartData.payoffExpiry.length - 1);
        const payoff = chartData.payoffExpiry[idx]?.value || 0;
        const payoffNow = chartData.payoffNow[idx]?.value || 0;
        const deltaVal = chartData.delta[idx]?.value || 0;
        const gammaVal = chartData.gamma[idx]?.value || 0;

        setCrosshairPos({ x: mouseX, price });
        showTooltip({
            tooltipData: { price, payoff, payoffNow, delta: deltaVal, gamma: gammaVal },
            tooltipLeft: point.x,
            tooltipTop: point.y,
        });
    }, [chartData, xScale, margin, showTooltip]);

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
            {/* Header with curve toggles like Thales */}
            <div className="px-3 py-2 border-b border-[rgba(48,54,61,0.5)] flex items-center gap-2 bg-[rgba(255,255,255,0.02)]">
                {/* Curve toggles - vertical labels like Thales */}
                <div className="flex flex-col gap-0.5">
                    <button
                        onClick={() => toggleCurve('payoffExpiry')}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${visibleCurves.payoffExpiry ? '' : 'opacity-30'}`}
                        style={{ color: curveColors.payoffExpiry }}
                    >
                        P
                    </button>
                    <button
                        onClick={() => toggleCurve('payoffNow')}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${visibleCurves.payoffNow ? '' : 'opacity-30'}`}
                        style={{ color: curveColors.payoffNow }}
                    >
                        P
                    </button>
                    <button
                        onClick={() => toggleCurve('delta')}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${visibleCurves.delta ? '' : 'opacity-30'}`}
                        style={{ color: curveColors.delta }}
                    >
                        D
                    </button>
                    <button
                        onClick={() => toggleCurve('gamma')}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${visibleCurves.gamma ? '' : 'opacity-30'}`}
                        style={{ color: curveColors.gamma }}
                    >
                        G
                    </button>
                </div>

                <div className="flex-1" />

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

            {/* Single Unified Chart */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 nodrag nowheel nopan"
                style={{ touchAction: 'none', position: 'relative', overflow: 'hidden' }}
            >
                {innerWidth > 0 && innerHeight > 0 && chartData && (
                    <svg
                        width={dimensions.width}
                        height={dimensions.height}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={() => {
                            setCrosshairPos(null);
                            hideTooltip();
                        }}
                    >
                        <Group left={margin.left} top={margin.top}>
                            {/* Grid */}
                            <GridRows scale={yScale} width={innerWidth} stroke="rgba(72, 79, 88, 0.2)" strokeDasharray="2,2" />
                            <GridColumns scale={xScale} height={innerHeight} stroke="rgba(72, 79, 88, 0.2)" strokeDasharray="2,2" />

                            {/* Zero line */}
                            <line
                                x1={0}
                                x2={innerWidth}
                                y1={yScale(0)}
                                y2={yScale(0)}
                                stroke="rgba(255,255,255,0.3)"
                                strokeWidth={1}
                            />

                            {/* Current price vertical line */}
                            <line
                                x1={xScale(livePrice)}
                                x2={xScale(livePrice)}
                                y1={0}
                                y2={innerHeight}
                                stroke="rgba(255,255,255,0.5)"
                                strokeWidth={1}
                                strokeDasharray="4,4"
                            />

                            {/* ALL CURVES ON SAME CHART */}
                            {visibleCurves.payoffExpiry && (
                                <LinePath
                                    data={chartData.payoffExpiry}
                                    x={d => xScale(d.price)}
                                    y={d => yScale(d.value)}
                                    stroke={curveColors.payoffExpiry}
                                    strokeWidth={2}
                                    curve={curveMonotoneX}
                                />
                            )}

                            {visibleCurves.payoffNow && (
                                <LinePath
                                    data={chartData.payoffNow}
                                    x={d => xScale(d.price)}
                                    y={d => yScale(d.value)}
                                    stroke={curveColors.payoffNow}
                                    strokeWidth={2}
                                    curve={curveMonotoneX}
                                />
                            )}

                            {visibleCurves.delta && (
                                <LinePath
                                    data={chartData.delta}
                                    x={d => xScale(d.price)}
                                    y={d => yScale(d.value)}
                                    stroke={curveColors.delta}
                                    strokeWidth={2}
                                    curve={curveMonotoneX}
                                />
                            )}

                            {visibleCurves.gamma && (
                                <LinePath
                                    data={chartData.gamma}
                                    x={d => xScale(d.price)}
                                    y={d => yScale(d.value)}
                                    stroke={curveColors.gamma}
                                    strokeWidth={2}
                                    curve={curveMonotoneX}
                                />
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
                                tickFormat={v => `${(Number(v) / 1000).toFixed(0)},000`}
                                stroke="rgba(125, 133, 144, 0.3)"
                                tickStroke="rgba(125, 133, 144, 0.3)"
                                tickLabelProps={() => ({ fill: '#7d8590', fontSize: 10, textAnchor: 'middle', dy: -4 })}
                                numTicks={6}
                            />
                        </Group>

                        {/* Crosshair */}
                        {crosshairPos && (
                            <line
                                x1={margin.left + crosshairPos.x}
                                x2={margin.left + crosshairPos.x}
                                y1={margin.top}
                                y2={dimensions.height - margin.bottom}
                                stroke="rgba(255,255,255,0.4)"
                                strokeWidth={1}
                                strokeDasharray="4,4"
                                pointerEvents="none"
                            />
                        )}
                    </svg>
                )}

                {/* Tooltip */}
                {tooltipOpen && tooltipData && (
                    <TooltipWithBounds
                        left={tooltipLeft}
                        top={tooltipTop}
                        style={{
                            backgroundColor: 'rgba(13, 17, 23, 0.95)',
                            border: '1px solid rgba(88, 166, 255, 0.3)',
                            borderRadius: 8,
                            padding: '8px 12px',
                            fontSize: 11,
                        }}
                    >
                        <div className="font-mono">
                            <div className="text-white font-bold mb-1">
                                ${tooltipData.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            {visibleCurves.payoffExpiry && (
                                <div style={{ color: curveColors.payoffExpiry }}>
                                    P(exp): ${tooltipData.payoff.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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

// Error function approximation for Black-Scholes
function erf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
}

export default CombinedChartWidget;
