'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, X, ChevronDown, RefreshCw } from 'lucide-react';

// Types for OHLCV data
interface OHLCV {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// Indicator types
type IndicatorType = 'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'vwap' | 'atr' | 'stochastic' | 'psar' | 'supertrend';

interface AdvancedChartProps {
    symbol?: string;
    interval?: string;
    height?: number;
    optionsLevels?: {
        support?: number;
        resistance?: number;
        gammaHigh?: number;
        gammaLow?: number;
    };
}

interface ActiveIndicator {
    id: string;
    type: IndicatorType;
    params: Record<string, number>;
    color: string;
    visible: boolean;
}

const INTERVALS = [
    { value: '1m', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
    { value: '1w', label: '1W' },
];

const INDICATOR_CATEGORIES = {
    'Moving Averages': ['sma', 'ema'] as IndicatorType[],
    'Momentum': ['rsi', 'macd', 'stochastic'] as IndicatorType[],
    'Volatility': ['bb', 'atr'] as IndicatorType[],
    'Volume': ['vwap'] as IndicatorType[],
    'Trend': ['psar', 'supertrend'] as IndicatorType[],
};

const INDICATOR_LABELS: Record<IndicatorType, string> = {
    sma: 'SMA',
    ema: 'EMA',
    rsi: 'RSI',
    macd: 'MACD',
    stochastic: 'Stochastic',
    bb: 'Bollinger Bands',
    atr: 'ATR',
    vwap: 'VWAP',
    psar: 'Parabolic SAR',
    supertrend: 'Supertrend'
};

const DEFAULT_COLORS: Record<IndicatorType, string> = {
    sma: '#2962ff',
    ema: '#ff6b6b',
    rsi: '#9c27b0',
    macd: '#00bfff',
    stochastic: '#ff9800',
    bb: '#e91e63',
    atr: '#4caf50',
    vwap: '#00bcd4',
    psar: '#ffeb3b',
    supertrend: '#26a69a'
};

export function AdvancedChart({
    symbol = 'BTCUSDT',
    interval: initialInterval = '15m',
    height = 600,
    optionsLevels
}: AdvancedChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const subChartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const subChartRef = useRef<any>(null);
    const candleSeriesRef = useRef<any>(null);
    const volumeSeriesRef = useRef<any>(null);
    const indicatorSeriesRef = useRef<Map<string, any>>(new Map());
    const priceLineRefs = useRef<any[]>([]);

    const [interval, setIntervalState] = useState(initialInterval);
    const [ohlcvData, setOhlcvData] = useState<OHLCV[]>([]);
    const [loading, setLoading] = useState(true);
    const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
    const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [chartLoaded, setChartLoaded] = useState(false);

    // Fetch candlestick data from Binance
    const fetchCandles = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(
                `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`
            );
            const data = await response.json();

            const candles: OHLCV[] = data.map((d: any[]) => ({
                time: Math.floor(d[0] / 1000),
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4]),
                volume: parseFloat(d[5])
            }));

            setOhlcvData(candles);
            if (candles.length > 0) {
                setCurrentPrice(candles[candles.length - 1].close);
            }
        } catch (error) {
            console.error('Failed to fetch candles:', error);
        }
        setLoading(false);
    }, [symbol, interval]);

    // Initialize charts with dynamic import
    useEffect(() => {
        if (!chartContainerRef.current) return;

        let isMounted = true;

        const initChart = async () => {
            try {
                // Dynamic import of lightweight-charts
                const lc = await import('lightweight-charts');

                if (!isMounted || !chartContainerRef.current) return;

                const chart = lc.createChart(chartContainerRef.current, {
                    layout: {
                        background: { type: lc.ColorType.Solid, color: '#0d1117' },
                        textColor: '#9ca3af',
                    },
                    grid: {
                        vertLines: { color: 'rgba(48, 54, 61, 0.5)' },
                        horzLines: { color: 'rgba(48, 54, 61, 0.5)' },
                    },
                    crosshair: {
                        mode: lc.CrosshairMode.Normal,
                        vertLine: {
                            color: 'rgba(88, 166, 255, 0.5)',
                            width: 1,
                            style: 2,
                            labelBackgroundColor: '#58a6ff',
                        },
                        horzLine: {
                            color: 'rgba(88, 166, 255, 0.5)',
                            width: 1,
                            style: 2,
                            labelBackgroundColor: '#58a6ff',
                        },
                    },
                    rightPriceScale: {
                        borderColor: '#30363d',
                        scaleMargins: { top: 0.1, bottom: 0.2 },
                    },
                    timeScale: {
                        borderColor: '#30363d',
                        timeVisible: true,
                        secondsVisible: false,
                    },
                });

                // Candlestick series
                const candleSeries = chart.addSeries(lc.CandlestickSeries, {
                    upColor: '#22c55e',
                    downColor: '#ef4444',
                    borderUpColor: '#22c55e',
                    borderDownColor: '#ef4444',
                    wickUpColor: '#22c55e',
                    wickDownColor: '#ef4444',
                });

                // Volume series
                const volumeSeries = chart.addSeries(lc.HistogramSeries, {
                    color: '#26a69a',
                    priceFormat: { type: 'volume' },
                    priceScaleId: 'volume',
                });

                chart.priceScale('volume').applyOptions({
                    scaleMargins: { top: 0.85, bottom: 0 },
                });

                chartRef.current = chart;
                candleSeriesRef.current = candleSeries;
                volumeSeriesRef.current = volumeSeries;

                // Handle resize
                const handleResize = () => {
                    if (chartContainerRef.current && chart) {
                        chart.applyOptions({
                            width: chartContainerRef.current.clientWidth,
                            height: height * 0.7,
                        });
                    }
                };

                window.addEventListener('resize', handleResize);
                handleResize();

                // Initialize sub-chart for oscillators
                if (subChartContainerRef.current) {
                    const subChart = lc.createChart(subChartContainerRef.current, {
                        layout: {
                            background: { type: lc.ColorType.Solid, color: '#0d1117' },
                            textColor: '#9ca3af',
                        },
                        grid: {
                            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
                            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
                        },
                        crosshair: { mode: lc.CrosshairMode.Normal },
                        rightPriceScale: {
                            borderColor: '#30363d',
                            scaleMargins: { top: 0.1, bottom: 0.1 },
                        },
                        timeScale: {
                            visible: false,
                        },
                    });

                    subChartRef.current = subChart;

                    const handleSubResize = () => {
                        if (subChartContainerRef.current && subChart) {
                            subChart.applyOptions({
                                width: subChartContainerRef.current.clientWidth,
                                height: height * 0.25,
                            });
                        }
                    };

                    window.addEventListener('resize', handleSubResize);
                    handleSubResize();

                    // Sync time scales
                    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
                        if (chart && subChart) {
                            const timeRange = chart.timeScale().getVisibleRange();
                            if (timeRange) {
                                subChart.timeScale().setVisibleRange(timeRange);
                            }
                        }
                    });
                }

                setChartLoaded(true);

            } catch (error) {
                console.error('Failed to initialize chart:', error);
            }
        };

        initChart();

        return () => {
            isMounted = false;
            if (chartRef.current) {
                chartRef.current.remove();
            }
            if (subChartRef.current) {
                subChartRef.current.remove();
            }
        };
    }, [height]);

    // Fetch data on mount and interval change
    useEffect(() => {
        fetchCandles();
        const pollInterval = window.setInterval(fetchCandles, 10000);
        return () => window.clearInterval(pollInterval);
    }, [fetchCandles]);

    // Update chart with data
    useEffect(() => {
        if (!candleSeriesRef.current || !volumeSeriesRef.current || ohlcvData.length === 0 || !chartLoaded) return;

        const candleData = ohlcvData.map(d => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        }));

        const volumeData = ohlcvData.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        }));

        candleSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        // Clear previous price lines
        priceLineRefs.current.forEach(line => {
            try {
                candleSeriesRef.current?.removePriceLine(line);
            } catch (e) { }
        });
        priceLineRefs.current = [];

        // Add options levels as price lines
        if (optionsLevels && candleSeriesRef.current) {
            const series = candleSeriesRef.current;

            if (optionsLevels.support) {
                const line = series.createPriceLine({
                    price: optionsLevels.support,
                    color: '#22c55e',
                    lineWidth: 2,
                    lineStyle: 0,
                    axisLabelVisible: true,
                    title: 'Support',
                });
                priceLineRefs.current.push(line);
            }
            if (optionsLevels.resistance) {
                const line = series.createPriceLine({
                    price: optionsLevels.resistance,
                    color: '#ef4444',
                    lineWidth: 2,
                    lineStyle: 0,
                    axisLabelVisible: true,
                    title: 'Resistance',
                });
                priceLineRefs.current.push(line);
            }
            if (optionsLevels.gammaHigh) {
                const line = series.createPriceLine({
                    price: optionsLevels.gammaHigh,
                    color: '#a855f7',
                    lineWidth: 1,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: 'Γ High',
                });
                priceLineRefs.current.push(line);
            }
            if (optionsLevels.gammaLow) {
                const line = series.createPriceLine({
                    price: optionsLevels.gammaLow,
                    color: '#f97316',
                    lineWidth: 1,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: 'Γ Low',
                });
                priceLineRefs.current.push(line);
            }
        }
    }, [ohlcvData, optionsLevels, chartLoaded]);

    // Calculate SMA
    const calculateSMA = (data: OHLCV[], period: number) => {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].close;
            }
            result.push({ time: data[i].time, value: sum / period });
        }
        return result;
    };

    // Calculate EMA
    const calculateEMA = (data: OHLCV[], period: number) => {
        const result = [];
        const multiplier = 2 / (period + 1);
        let ema = data[0].close;

        for (let i = 0; i < data.length; i++) {
            ema = (data[i].close - ema) * multiplier + ema;
            if (i >= period - 1) {
                result.push({ time: data[i].time, value: ema });
            }
        }
        return result;
    };

    // Calculate RSI
    const calculateRSI = (data: OHLCV[], period: number = 14) => {
        const result = [];
        const gains = [];
        const losses = [];

        for (let i = 1; i < data.length; i++) {
            const change = data[i].close - data[i - 1].close;
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? -change : 0);
        }

        let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < gains.length; i++) {
            avgGain = (avgGain * (period - 1) + gains[i]) / period;
            avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
            const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            const rsi = 100 - (100 / (1 + rs));
            result.push({ time: data[i + 1].time, value: rsi });
        }
        return result;
    };

    // Calculate VWAP
    const calculateVWAP = (data: OHLCV[]) => {
        const result = [];
        let cumVolume = 0;
        let cumVwap = 0;

        for (let i = 0; i < data.length; i++) {
            const typical = (data[i].high + data[i].low + data[i].close) / 3;
            cumVolume += data[i].volume;
            cumVwap += typical * data[i].volume;
            result.push({ time: data[i].time, value: cumVwap / cumVolume });
        }
        return result;
    };

    // Update indicators
    useEffect(() => {
        if (!chartRef.current || !chartLoaded || ohlcvData.length === 0) return;

        const updateIndicators = async () => {
            const lc = await import('lightweight-charts');

            activeIndicators.forEach(indicator => {
                if (!indicator.visible) return;

                const existingSeries = indicatorSeriesRef.current.get(indicator.id);

                try {
                    switch (indicator.type) {
                        case 'sma': {
                            const data = calculateSMA(ohlcvData, indicator.params.period || 20);
                            if (!existingSeries) {
                                const series = chartRef.current.addSeries(lc.LineSeries, {
                                    color: indicator.color,
                                    lineWidth: 2,
                                    priceLineVisible: false,
                                });
                                series.setData(data);
                                indicatorSeriesRef.current.set(indicator.id, series);
                            } else {
                                existingSeries.setData(data);
                            }
                            break;
                        }
                        case 'ema': {
                            const data = calculateEMA(ohlcvData, indicator.params.period || 20);
                            if (!existingSeries) {
                                const series = chartRef.current.addSeries(lc.LineSeries, {
                                    color: indicator.color,
                                    lineWidth: 2,
                                    priceLineVisible: false,
                                });
                                series.setData(data);
                                indicatorSeriesRef.current.set(indicator.id, series);
                            } else {
                                existingSeries.setData(data);
                            }
                            break;
                        }
                        case 'vwap': {
                            const data = calculateVWAP(ohlcvData);
                            if (!existingSeries) {
                                const series = chartRef.current.addSeries(lc.LineSeries, {
                                    color: indicator.color,
                                    lineWidth: 2,
                                    priceLineVisible: false,
                                });
                                series.setData(data);
                                indicatorSeriesRef.current.set(indicator.id, series);
                            } else {
                                existingSeries.setData(data);
                            }
                            break;
                        }
                        case 'rsi': {
                            if (!subChartRef.current) return;
                            const data = calculateRSI(ohlcvData, indicator.params.period || 14);
                            if (!existingSeries) {
                                const series = subChartRef.current.addSeries(lc.LineSeries, {
                                    color: indicator.color,
                                    lineWidth: 2,
                                    priceLineVisible: false,
                                });
                                series.setData(data);
                                series.createPriceLine({ price: 70, color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
                                series.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
                                indicatorSeriesRef.current.set(indicator.id, series);
                            } else {
                                existingSeries.setData(data);
                            }
                            break;
                        }
                    }
                } catch (error) {
                    console.error(`Error adding indicator ${indicator.type}:`, error);
                }
            });
        };

        updateIndicators();
    }, [activeIndicators, ohlcvData, chartLoaded]);

    // Add indicator
    const addIndicator = useCallback((type: IndicatorType) => {
        const newIndicator: ActiveIndicator = {
            id: `${type}-${Date.now()}`,
            type,
            params: { period: type === 'sma' || type === 'ema' ? 20 : 14 },
            color: DEFAULT_COLORS[type] || '#ffffff',
            visible: true,
        };
        setActiveIndicators(prev => [...prev, newIndicator]);
        setShowIndicatorMenu(false);
    }, []);

    // Remove indicator
    const removeIndicator = useCallback((id: string) => {
        const series = indicatorSeriesRef.current.get(id);
        if (series) {
            try {
                chartRef.current?.removeSeries(series);
            } catch {
                try {
                    subChartRef.current?.removeSeries(series);
                } catch { }
            }
            indicatorSeriesRef.current.delete(id);
        }
        setActiveIndicators(prev => prev.filter(i => i.id !== id));
    }, []);

    return (
        <div className="flex flex-col h-full bg-[#0d1117] rounded-lg overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
                {/* Symbol */}
                <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{symbol}</span>
                    {currentPrice && (
                        <span className="text-cyan-400 font-mono">
                            ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                    )}
                </div>

                <div className="w-px h-6 bg-[#30363d]" />

                {/* Interval Selector */}
                <div className="flex gap-1">
                    {INTERVALS.map(int => (
                        <button
                            key={int.value}
                            onClick={() => setIntervalState(int.value)}
                            className={`px-2 py-1 text-xs rounded transition-colors ${interval === int.value
                                    ? 'bg-cyan-500/20 text-cyan-400'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {int.label}
                        </button>
                    ))}
                </div>

                <div className="w-px h-6 bg-[#30363d]" />

                {/* Indicators Button */}
                <div className="relative">
                    <button
                        onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 hover:text-white bg-[#21262d] hover:bg-[#30363d] rounded transition-colors"
                    >
                        <Plus size={14} />
                        <span>Indicators</span>
                        <ChevronDown size={12} />
                    </button>

                    {/* Indicator Menu */}
                    {showIndicatorMenu && (
                        <div className="absolute top-full left-0 mt-1 w-64 max-h-96 overflow-y-auto bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl z-50">
                            {Object.entries(INDICATOR_CATEGORIES).map(([category, indicators]) => (
                                <div key={category}>
                                    <button
                                        onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
                                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-300 hover:bg-[#21262d] border-b border-[#30363d]"
                                    >
                                        <span>{category}</span>
                                        <ChevronDown
                                            size={14}
                                            className={`transition-transform ${expandedCategory === category ? 'rotate-180' : ''}`}
                                        />
                                    </button>
                                    {expandedCategory === category && (
                                        <div className="bg-[#0d1117]">
                                            {indicators.map(ind => (
                                                <button
                                                    key={ind}
                                                    onClick={() => addIndicator(ind)}
                                                    className="w-full text-left px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-[#21262d] transition-colors"
                                                >
                                                    {INDICATOR_LABELS[ind]}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-1" />

                {/* Active Indicators */}
                <div className="flex items-center gap-1 flex-wrap">
                    {activeIndicators.map(ind => (
                        <div
                            key={ind.id}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full"
                            style={{ backgroundColor: `${ind.color}20`, borderColor: ind.color, borderWidth: 1 }}
                        >
                            <span style={{ color: ind.color }}>{INDICATOR_LABELS[ind.type]}</span>
                            <button
                                onClick={() => removeIndicator(ind.id)}
                                className="hover:text-white transition-colors"
                                style={{ color: ind.color }}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Refresh */}
                <button
                    onClick={fetchCandles}
                    className={`p-1.5 text-gray-400 hover:text-white rounded transition-colors ${loading ? 'animate-spin' : ''}`}
                >
                    <RefreshCw size={16} />
                </button>
            </div>

            {/* Main Chart */}
            <div className="flex-1 relative">
                {loading && ohlcvData.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] z-10">
                        <RefreshCw size={32} className="text-cyan-400 animate-spin" />
                    </div>
                )}
                <div ref={chartContainerRef} className="w-full" style={{ height: height * 0.7 }} />
            </div>

            {/* Sub Chart (for oscillators) */}
            <div className="border-t border-[#30363d]">
                <div ref={subChartContainerRef} className="w-full" style={{ height: height * 0.25 }} />
            </div>
        </div>
    );
}
