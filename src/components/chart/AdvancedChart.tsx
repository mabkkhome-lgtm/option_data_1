'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    CandlestickData,
    LineData,
    HistogramData,
    ColorType,
    CrosshairMode,
    Time,
    CandlestickSeries,
    LineSeries,
    HistogramSeries
} from 'lightweight-charts';
import {
    OHLCV,
    calculateSMA,
    calculateEMA,
    calculateRSI,
    calculateMACD,
    calculateBollingerBands,
    calculateVWAPBands,
    calculateATR,
    calculateStochastic,
    calculateParabolicSAR,
    calculateSupertrend,
    IndicatorType,
    DEFAULT_INDICATOR_CONFIGS
} from '@/lib/indicators/technicalIndicators';
import {
    Plus,
    X,
    ChevronDown,
    RefreshCw
} from 'lucide-react';

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
    'Moving Averages': ['sma', 'ema', 'wma', 'hma'] as IndicatorType[],
    'Momentum': ['rsi', 'macd', 'stochastic', 'cci', 'williamsR', 'roc', 'momentum', 'mfi'] as IndicatorType[],
    'Volatility': ['bb', 'atr', 'keltner', 'donchian'] as IndicatorType[],
    'Volume': ['vwap', 'obv', 'adl', 'cmf'] as IndicatorType[],
    'Trend': ['adx', 'psar', 'supertrend', 'ichimoku'] as IndicatorType[],
};

const INDICATOR_LABELS: Record<IndicatorType, string> = {
    sma: 'SMA',
    ema: 'EMA',
    wma: 'WMA',
    hma: 'Hull MA',
    rsi: 'RSI',
    macd: 'MACD',
    stochastic: 'Stochastic',
    cci: 'CCI',
    williamsR: 'Williams %R',
    roc: 'Rate of Change',
    momentum: 'Momentum',
    bb: 'Bollinger Bands',
    atr: 'ATR',
    keltner: 'Keltner Channels',
    donchian: 'Donchian Channels',
    vwap: 'VWAP',
    obv: 'On-Balance Volume',
    adl: 'A/D Line',
    mfi: 'Money Flow Index',
    cmf: 'Chaikin MF',
    adx: 'ADX',
    psar: 'Parabolic SAR',
    ichimoku: 'Ichimoku Cloud',
    supertrend: 'Supertrend'
};

export function AdvancedChart({
    symbol = 'BTCUSDT',
    interval: initialInterval = '15m',
    height = 600,
    optionsLevels
}: AdvancedChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const subChartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const subChartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'> | ISeriesApi<'Line'>[] | ISeriesApi<'Histogram'>>>(new Map());

    const [interval, setIntervalState] = useState(initialInterval);
    const [ohlcvData, setOhlcvData] = useState<OHLCV[]>([]);
    const [loading, setLoading] = useState(true);
    const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
    const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);

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

    // Initialize main chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0d1117' },
                textColor: '#9ca3af',
            },
            grid: {
                vertLines: { color: 'rgba(48, 54, 61, 0.5)' },
                horzLines: { color: 'rgba(48, 54, 61, 0.5)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
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

        // Candlestick series - using v5 API with SeriesDefinition
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderUpColor: '#22c55e',
            borderDownColor: '#ef4444',
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
        });

        // Volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
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
            if (chartContainerRef.current) {
                chart.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: height * 0.7,
                });
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [height]);

    // Initialize sub-chart for oscillators
    useEffect(() => {
        if (!subChartContainerRef.current) return;

        const subChart = createChart(subChartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#0d1117' },
                textColor: '#9ca3af',
            },
            grid: {
                vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
                horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
            },
            crosshair: { mode: CrosshairMode.Normal },
            rightPriceScale: {
                borderColor: '#30363d',
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                visible: false,
            },
        });

        subChartRef.current = subChart;

        const handleResize = () => {
            if (subChartContainerRef.current) {
                subChart.applyOptions({
                    width: subChartContainerRef.current.clientWidth,
                    height: height * 0.25,
                });
            }
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        // Sync time scales
        if (chartRef.current) {
            chartRef.current.timeScale().subscribeVisibleTimeRangeChange(() => {
                if (chartRef.current && subChartRef.current) {
                    const timeRange = chartRef.current.timeScale().getVisibleRange();
                    if (timeRange) {
                        subChartRef.current.timeScale().setVisibleRange(timeRange);
                    }
                }
            });
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            subChart.remove();
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
        if (!candleSeriesRef.current || !volumeSeriesRef.current || ohlcvData.length === 0) return;

        const candleData: CandlestickData<Time>[] = ohlcvData.map(d => ({
            time: d.time as Time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        }));

        const volumeData: HistogramData<Time>[] = ohlcvData.map(d => ({
            time: d.time as Time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        }));

        candleSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        // Add options levels as price lines
        if (optionsLevels && candleSeriesRef.current) {
            const series = candleSeriesRef.current;

            if (optionsLevels.support) {
                series.createPriceLine({
                    price: optionsLevels.support,
                    color: '#22c55e',
                    lineWidth: 2,
                    lineStyle: 0,
                    axisLabelVisible: true,
                    title: 'Support',
                });
            }
            if (optionsLevels.resistance) {
                series.createPriceLine({
                    price: optionsLevels.resistance,
                    color: '#ef4444',
                    lineWidth: 2,
                    lineStyle: 0,
                    axisLabelVisible: true,
                    title: 'Resistance',
                });
            }
            if (optionsLevels.gammaHigh) {
                series.createPriceLine({
                    price: optionsLevels.gammaHigh,
                    color: '#a855f7',
                    lineWidth: 1,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: 'Γ High',
                });
            }
            if (optionsLevels.gammaLow) {
                series.createPriceLine({
                    price: optionsLevels.gammaLow,
                    color: '#f97316',
                    lineWidth: 1,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: 'Γ Low',
                });
            }
        }
    }, [ohlcvData, optionsLevels]);

    // Update indicators when data or indicators change
    useEffect(() => {
        if (!chartRef.current || !subChartRef.current || ohlcvData.length === 0) return;

        activeIndicators.forEach(indicator => {
            if (!indicator.visible) return;

            // Check if series already exists
            const existingSeries = indicatorSeriesRef.current.get(indicator.id);

            try {
                switch (indicator.type) {
                    case 'sma': {
                        const smaData = calculateSMA(ohlcvData, indicator.params.period || 20);
                        const lineData: LineData<Time>[] = smaData.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));

                        if (!existingSeries) {
                            const series = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            series.setData(lineData);
                            indicatorSeriesRef.current.set(indicator.id, series);
                        } else {
                            (existingSeries as ISeriesApi<'Line'>).setData(lineData);
                        }
                        break;
                    }

                    case 'ema': {
                        const emaData = calculateEMA(ohlcvData, indicator.params.period || 20);
                        const lineData: LineData<Time>[] = emaData.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));

                        if (!existingSeries) {
                            const series = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            series.setData(lineData);
                            indicatorSeriesRef.current.set(indicator.id, series);
                        } else {
                            (existingSeries as ISeriesApi<'Line'>).setData(lineData);
                        }
                        break;
                    }

                    case 'rsi': {
                        const rsiData = calculateRSI(ohlcvData, indicator.params.period || 14);
                        const lineData: LineData<Time>[] = rsiData.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));

                        if (!existingSeries) {
                            const series = subChartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            series.setData(lineData);

                            // Add overbought/oversold lines
                            series.createPriceLine({ price: 70, color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
                            series.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });

                            indicatorSeriesRef.current.set(indicator.id, series);
                        } else {
                            (existingSeries as ISeriesApi<'Line'>).setData(lineData);
                        }
                        break;
                    }

                    case 'macd': {
                        const macdData = calculateMACD(
                            ohlcvData,
                            indicator.params.fast || 12,
                            indicator.params.slow || 26,
                            indicator.params.signal || 9
                        );

                        const macdLine: LineData<Time>[] = macdData.map(d => ({
                            time: d.time as Time,
                            value: d.macd,
                        }));
                        const signalLine: LineData<Time>[] = macdData.map(d => ({
                            time: d.time as Time,
                            value: d.signal,
                        }));
                        const histogram: HistogramData<Time>[] = macdData.map(d => ({
                            time: d.time as Time,
                            value: d.histogram,
                            color: d.histogram >= 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)',
                        }));

                        if (!existingSeries) {
                            const histSeries = subChartRef.current!.addSeries(HistogramSeries, {
                                priceLineVisible: false,
                            });
                            histSeries.setData(histogram);

                            const macdSeries = subChartRef.current!.addSeries(LineSeries, {
                                color: '#00bfff',
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            macdSeries.setData(macdLine);

                            const sigSeries = subChartRef.current!.addSeries(LineSeries, {
                                color: '#ff6b6b',
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            sigSeries.setData(signalLine);

                            indicatorSeriesRef.current.set(indicator.id, [histSeries, macdSeries, sigSeries] as any);
                        }
                        break;
                    }

                    case 'bb': {
                        const bbData = calculateBollingerBands(
                            ohlcvData,
                            indicator.params.period || 20,
                            indicator.params.stdDev || 2
                        );

                        const upperLine: LineData<Time>[] = bbData.map(d => ({
                            time: d.time as Time,
                            value: d.upper,
                        }));
                        const middleLine: LineData<Time>[] = bbData.map(d => ({
                            time: d.time as Time,
                            value: d.middle,
                        }));
                        const lowerLine: LineData<Time>[] = bbData.map(d => ({
                            time: d.time as Time,
                            value: d.lower,
                        }));

                        if (!existingSeries) {
                            const upperSeries = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 1,
                                priceLineVisible: false,
                            });
                            upperSeries.setData(upperLine);

                            const middleSeries = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 1,
                                lineStyle: 2,
                                priceLineVisible: false,
                            });
                            middleSeries.setData(middleLine);

                            const lowerSeries = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 1,
                                priceLineVisible: false,
                            });
                            lowerSeries.setData(lowerLine);

                            indicatorSeriesRef.current.set(indicator.id, [upperSeries, middleSeries, lowerSeries] as any);
                        }
                        break;
                    }

                    case 'vwap': {
                        const vwapResult = calculateVWAPBands(ohlcvData, 2);
                        const vwapLine: LineData<Time>[] = vwapResult.vwap.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));
                        const upperLine: LineData<Time>[] = vwapResult.upper.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));
                        const lowerLine: LineData<Time>[] = vwapResult.lower.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));

                        if (!existingSeries) {
                            const vwapSeries = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            vwapSeries.setData(vwapLine);

                            const upperSeries = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 1,
                                lineStyle: 2,
                                priceLineVisible: false,
                            });
                            upperSeries.setData(upperLine);

                            const lowerSeries = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 1,
                                lineStyle: 2,
                                priceLineVisible: false,
                            });
                            lowerSeries.setData(lowerLine);

                            indicatorSeriesRef.current.set(indicator.id, [vwapSeries, upperSeries, lowerSeries] as any);
                        }
                        break;
                    }

                    case 'atr': {
                        const atrData = calculateATR(ohlcvData, indicator.params.period || 14);
                        const lineData: LineData<Time>[] = atrData.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));

                        if (!existingSeries) {
                            const series = subChartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            series.setData(lineData);
                            indicatorSeriesRef.current.set(indicator.id, series);
                        } else {
                            (existingSeries as ISeriesApi<'Line'>).setData(lineData);
                        }
                        break;
                    }

                    case 'supertrend': {
                        const stData = calculateSupertrend(
                            ohlcvData,
                            indicator.params.period || 10,
                            indicator.params.mult || 3
                        );
                        const lineData: LineData<Time>[] = stData.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));

                        if (!existingSeries) {
                            const series = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            series.setData(lineData);
                            indicatorSeriesRef.current.set(indicator.id, series);
                        } else {
                            (existingSeries as ISeriesApi<'Line'>).setData(lineData);
                        }
                        break;
                    }

                    case 'psar': {
                        const psarData = calculateParabolicSAR(
                            ohlcvData,
                            indicator.params.step || 0.02,
                            indicator.params.max || 0.2
                        );
                        const lineData: LineData<Time>[] = psarData.map(d => ({
                            time: d.time as Time,
                            value: d.value,
                        }));

                        if (!existingSeries) {
                            const series = chartRef.current!.addSeries(LineSeries, {
                                color: indicator.color,
                                lineWidth: 1,
                                lineVisible: false,
                                pointMarkersVisible: true,
                                pointMarkersRadius: 2,
                                priceLineVisible: false,
                            });
                            series.setData(lineData);
                            indicatorSeriesRef.current.set(indicator.id, series);
                        } else {
                            (existingSeries as ISeriesApi<'Line'>).setData(lineData);
                        }
                        break;
                    }

                    case 'stochastic': {
                        const stochData = calculateStochastic(
                            ohlcvData,
                            indicator.params.k || 14,
                            indicator.params.d || 3
                        );
                        const kLine: LineData<Time>[] = stochData.map(d => ({
                            time: d.time as Time,
                            value: d.k,
                        }));
                        const dLine: LineData<Time>[] = stochData.map(d => ({
                            time: d.time as Time,
                            value: d.d,
                        }));

                        if (!existingSeries) {
                            const kSeries = subChartRef.current!.addSeries(LineSeries, {
                                color: '#00bfff',
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            kSeries.setData(kLine);

                            const dSeries = subChartRef.current!.addSeries(LineSeries, {
                                color: '#ff6b6b',
                                lineWidth: 2,
                                priceLineVisible: false,
                            });
                            dSeries.setData(dLine);

                            // Add overbought/oversold lines
                            kSeries.createPriceLine({ price: 80, color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
                            kSeries.createPriceLine({ price: 20, color: '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });

                            indicatorSeriesRef.current.set(indicator.id, [kSeries, dSeries] as any);
                        }
                        break;
                    }
                }
            } catch (error) {
                console.error(`Error calculating ${indicator.type}:`, error);
            }
        });
    }, [activeIndicators, ohlcvData]);

    // Add indicator
    const addIndicator = useCallback((type: IndicatorType) => {
        const config = DEFAULT_INDICATOR_CONFIGS[type];
        const newIndicator: ActiveIndicator = {
            id: `${type}-${Date.now()}`,
            type,
            params: config.params,
            color: config.color || '#ffffff',
            visible: true,
        };
        setActiveIndicators(prev => [...prev, newIndicator]);
        setShowIndicatorMenu(false);
    }, []);

    // Remove indicator
    const removeIndicator = useCallback((id: string) => {
        const series = indicatorSeriesRef.current.get(id);
        if (series) {
            if (Array.isArray(series)) {
                series.forEach((s: any) => {
                    try {
                        chartRef.current?.removeSeries(s);
                    } catch {
                        try {
                            subChartRef.current?.removeSeries(s);
                        } catch { }
                    }
                });
            } else {
                try {
                    chartRef.current?.removeSeries(series as any);
                } catch {
                    try {
                        subChartRef.current?.removeSeries(series as any);
                    } catch { }
                }
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
