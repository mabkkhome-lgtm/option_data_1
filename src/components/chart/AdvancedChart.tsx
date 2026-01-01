'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, X, ChevronDown, RefreshCw } from 'lucide-react';

// Types
interface OHLCV {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

type IndicatorType = 'sma' | 'ema' | 'vwap' | 'rsi';

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

const INTERVALS = [
    { value: '1m', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
];

const INDICATOR_OPTIONS: { type: IndicatorType; label: string; color: string }[] = [
    { type: 'sma', label: 'SMA (20)', color: '#2962ff' },
    { type: 'ema', label: 'EMA (20)', color: '#ff6b6b' },
    { type: 'vwap', label: 'VWAP', color: '#00bcd4' },
    { type: 'rsi', label: 'RSI (14)', color: '#9c27b0' },
];

export function AdvancedChart({
    symbol = 'BTCUSDT',
    interval: initialInterval = '15m',
    height = 600,
    optionsLevels
}: AdvancedChartProps) {
    const mainChartRef = useRef<HTMLDivElement>(null);
    const subChartRef = useRef<HTMLDivElement>(null);
    const chartsInitialized = useRef(false);
    const chartInstancesRef = useRef<{
        mainChart: any;
        subChart: any;
        candleSeries: any;
        volumeSeries: any;
        indicatorSeries: Map<string, any>;
    } | null>(null);

    const [interval, setInterval] = useState(initialInterval);
    const [ohlcvData, setOhlcvData] = useState<OHLCV[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeIndicators, setActiveIndicators] = useState<IndicatorType[]>([]);
    const [showMenu, setShowMenu] = useState(false);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Fetch data
    const fetchData = useCallback(async () => {
        try {
            const response = await fetch(
                `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`
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
            setLoading(false);
        } catch (err) {
            console.error('Fetch error:', err);
            setError('Failed to fetch data');
            setLoading(false);
        }
    }, [symbol, interval]);

    // Initialize chart
    useEffect(() => {
        if (!mainChartRef.current || chartsInitialized.current) return;

        const initCharts = async () => {
            try {
                // Dynamically import lightweight-charts
                const { createChart, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries, LineSeries } = await import('lightweight-charts');

                if (!mainChartRef.current) return;

                // Create main chart
                const mainChart = createChart(mainChartRef.current, {
                    width: mainChartRef.current.clientWidth,
                    height: Math.floor(height * 0.65),
                    layout: {
                        background: { type: ColorType.Solid, color: '#0d1117' },
                        textColor: '#9ca3af',
                    },
                    grid: {
                        vertLines: { color: 'rgba(48, 54, 61, 0.5)' },
                        horzLines: { color: 'rgba(48, 54, 61, 0.5)' },
                    },
                    crosshair: { mode: CrosshairMode.Normal },
                    rightPriceScale: { borderColor: '#30363d' },
                    timeScale: { borderColor: '#30363d', timeVisible: true },
                });

                const candleSeries = mainChart.addSeries(CandlestickSeries, {
                    upColor: '#22c55e',
                    downColor: '#ef4444',
                    borderUpColor: '#22c55e',
                    borderDownColor: '#ef4444',
                    wickUpColor: '#22c55e',
                    wickDownColor: '#ef4444',
                });

                const volumeSeries = mainChart.addSeries(HistogramSeries, {
                    color: '#26a69a',
                    priceFormat: { type: 'volume' },
                    priceScaleId: 'volume',
                });
                mainChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

                // Create sub chart for oscillators
                let subChart = null;
                if (subChartRef.current) {
                    subChart = createChart(subChartRef.current, {
                        width: subChartRef.current.clientWidth,
                        height: Math.floor(height * 0.2),
                        layout: {
                            background: { type: ColorType.Solid, color: '#0d1117' },
                            textColor: '#9ca3af',
                        },
                        grid: {
                            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
                            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
                        },
                        crosshair: { mode: CrosshairMode.Normal },
                        rightPriceScale: { borderColor: '#30363d' },
                        timeScale: { visible: false },
                    });
                }

                chartInstancesRef.current = {
                    mainChart,
                    subChart,
                    candleSeries,
                    volumeSeries,
                    indicatorSeries: new Map(),
                };

                chartsInitialized.current = true;

                // Resize handler
                const handleResize = () => {
                    if (mainChartRef.current && chartInstancesRef.current) {
                        chartInstancesRef.current.mainChart.applyOptions({ width: mainChartRef.current.clientWidth });
                    }
                    if (subChartRef.current && chartInstancesRef.current?.subChart) {
                        chartInstancesRef.current.subChart.applyOptions({ width: subChartRef.current.clientWidth });
                    }
                };
                window.addEventListener('resize', handleResize);

                return () => {
                    window.removeEventListener('resize', handleResize);
                    mainChart.remove();
                    subChart?.remove();
                };
            } catch (err) {
                console.error('Chart init error:', err);
                setError('Failed to initialize chart');
            }
        };

        initCharts();
    }, [height]);

    // Fetch data on mount
    useEffect(() => {
        fetchData();
        const timer = window.setInterval(fetchData, 15000);
        return () => window.clearInterval(timer);
    }, [fetchData]);

    // Update chart with data
    useEffect(() => {
        if (!chartInstancesRef.current || ohlcvData.length === 0) return;

        const { candleSeries, volumeSeries } = chartInstancesRef.current;

        candleSeries.setData(ohlcvData.map(d => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        })));

        volumeSeries.setData(ohlcvData.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        })));

        // Add price lines for options levels
        if (optionsLevels) {
            if (optionsLevels.support) {
                candleSeries.createPriceLine({ price: optionsLevels.support, color: '#22c55e', lineWidth: 2, title: 'S' });
            }
            if (optionsLevels.resistance) {
                candleSeries.createPriceLine({ price: optionsLevels.resistance, color: '#ef4444', lineWidth: 2, title: 'R' });
            }
        }
    }, [ohlcvData, optionsLevels]);

    // Calculate and update indicators
    useEffect(() => {
        if (!chartInstancesRef.current || ohlcvData.length === 0) return;

        const updateIndicators = async () => {
            const { LineSeries } = await import('lightweight-charts');
            const { mainChart, subChart, indicatorSeries } = chartInstancesRef.current!;

            // Clear old indicators
            indicatorSeries.forEach((series) => {
                try { mainChart.removeSeries(series); } catch { }
                try { subChart?.removeSeries(series); } catch { }
            });
            indicatorSeries.clear();

            activeIndicators.forEach(type => {
                const config = INDICATOR_OPTIONS.find(o => o.type === type);
                if (!config) return;

                let data: { time: number; value: number }[] = [];

                if (type === 'sma') {
                    const period = 20;
                    for (let i = period - 1; i < ohlcvData.length; i++) {
                        let sum = 0;
                        for (let j = 0; j < period; j++) sum += ohlcvData[i - j].close;
                        data.push({ time: ohlcvData[i].time, value: sum / period });
                    }
                    const series = mainChart.addSeries(LineSeries, { color: config.color, lineWidth: 2, priceLineVisible: false });
                    series.setData(data);
                    indicatorSeries.set(type, series);
                }

                if (type === 'ema') {
                    const period = 20;
                    const multiplier = 2 / (period + 1);
                    let ema = ohlcvData[0].close;
                    for (let i = 0; i < ohlcvData.length; i++) {
                        ema = (ohlcvData[i].close - ema) * multiplier + ema;
                        if (i >= period - 1) data.push({ time: ohlcvData[i].time, value: ema });
                    }
                    const series = mainChart.addSeries(LineSeries, { color: config.color, lineWidth: 2, priceLineVisible: false });
                    series.setData(data);
                    indicatorSeries.set(type, series);
                }

                if (type === 'vwap') {
                    let cumVolume = 0, cumVwap = 0;
                    for (let i = 0; i < ohlcvData.length; i++) {
                        const typical = (ohlcvData[i].high + ohlcvData[i].low + ohlcvData[i].close) / 3;
                        cumVolume += ohlcvData[i].volume;
                        cumVwap += typical * ohlcvData[i].volume;
                        data.push({ time: ohlcvData[i].time, value: cumVwap / cumVolume });
                    }
                    const series = mainChart.addSeries(LineSeries, { color: config.color, lineWidth: 2, priceLineVisible: false });
                    series.setData(data);
                    indicatorSeries.set(type, series);
                }

                if (type === 'rsi' && subChart) {
                    const period = 14;
                    const gains: number[] = [], losses: number[] = [];
                    for (let i = 1; i < ohlcvData.length; i++) {
                        const change = ohlcvData[i].close - ohlcvData[i - 1].close;
                        gains.push(change > 0 ? change : 0);
                        losses.push(change < 0 ? -change : 0);
                    }
                    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
                    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
                    for (let i = period; i < gains.length; i++) {
                        avgGain = (avgGain * (period - 1) + gains[i]) / period;
                        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
                        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                        data.push({ time: ohlcvData[i + 1].time, value: 100 - (100 / (1 + rs)) });
                    }
                    const series = subChart.addSeries(LineSeries, { color: config.color, lineWidth: 2, priceLineVisible: false });
                    series.setData(data);
                    series.createPriceLine({ price: 70, color: '#ef4444', lineWidth: 1, lineStyle: 2 });
                    series.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: 2 });
                    indicatorSeries.set(type, series);
                }
            });
        };

        updateIndicators();
    }, [activeIndicators, ohlcvData]);

    const toggleIndicator = (type: IndicatorType) => {
        setActiveIndicators(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
        setShowMenu(false);
    };

    if (error) {
        return (
            <div className="flex items-center justify-center h-full bg-[#0d1117] text-red-400">
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0d1117] rounded-lg overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#161b22]">
                <span className="text-white font-bold">{symbol}</span>
                {currentPrice && <span className="text-cyan-400 font-mono">${currentPrice.toLocaleString()}</span>}

                <div className="w-px h-6 bg-[#30363d]" />

                <div className="flex gap-1">
                    {INTERVALS.map(i => (
                        <button
                            key={i.value}
                            onClick={() => setInterval(i.value)}
                            className={`px-2 py-1 text-xs rounded ${interval === i.value ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                        >
                            {i.label}
                        </button>
                    ))}
                </div>

                <div className="w-px h-6 bg-[#30363d]" />

                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 bg-[#21262d] rounded hover:bg-[#30363d]"
                    >
                        <Plus size={14} /> Indicators <ChevronDown size={12} />
                    </button>
                    {showMenu && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl z-50">
                            {INDICATOR_OPTIONS.map(opt => (
                                <button
                                    key={opt.type}
                                    onClick={() => toggleIndicator(opt.type)}
                                    className={`w-full text-left px-3 py-2 text-sm ${activeIndicators.includes(opt.type) ? 'text-cyan-400 bg-cyan-500/10' : 'text-gray-400 hover:text-white hover:bg-[#21262d]'}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-1" />

                {activeIndicators.map(type => (
                    <div key={type} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-cyan-500/20 text-cyan-400">
                        {INDICATOR_OPTIONS.find(o => o.type === type)?.label}
                        <button onClick={() => toggleIndicator(type)}><X size={12} /></button>
                    </div>
                ))}

                <button onClick={fetchData} className={`p-1 text-gray-400 hover:text-white ${loading ? 'animate-spin' : ''}`}>
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
                <div ref={mainChartRef} style={{ height: height * 0.65 }} />
            </div>

            {/* Sub Chart */}
            <div className="border-t border-[#30363d]">
                <div ref={subChartRef} style={{ height: height * 0.2 }} />
            </div>
        </div>
    );
}
