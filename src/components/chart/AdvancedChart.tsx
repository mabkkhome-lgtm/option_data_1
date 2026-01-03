
'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, CrosshairMode, Time, LineData, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import { Settings, Maximize2, Minimize2, MoreVertical, Plus, Activity, X } from 'lucide-react';
import { IndicatorModal } from './IndicatorModal';
import { DrawingToolbar, DrawingTool } from './DrawingToolbar';
import { AVAILABLE_INDICATORS } from '../../lib/indicators/definitions';

export interface OHLCV {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface LevelHistoryPoint {
    timestamp: number;
    support: number;
    resistance: number;
    gammaHigh: number;
    gammaLow: number;
}

interface AdvancedChartProps {
    symbol?: string;
    interval?: string;
    optionsLevels?: {
        support: number;
        resistance: number;
        gammaHigh: number;
        gammaLow: number;
    };
    levelsHistory?: LevelHistoryPoint[];
    onIntervalChange?: (interval: string) => void;
}

interface ActiveIndicator {
    instanceId: string;
    defId: string;
    color: string;
    settings: Record<string, number>;
}

interface Drawing {
    id: string;
    type: DrawingTool;
    p1: { time: number; price: number };
    p2: { time: number; price: number } | null; // null while dragging
    color: string;
}

const COLORS = ['#2962ff', '#e91e63', '#9c27b0', '#673ab7', '#00bcd4', '#009688', '#ffeb3b', '#ff9800'];

// Helper function to calculate distance from point to line segment
const distanceToLineSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
};

const AdvancedChart: React.FC<AdvancedChartProps> = ({
    symbol = 'BTCUSDT',
    interval = '15m',
    optionsLevels,
    levelsHistory = [],
    onIntervalChange
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartInstancesRef = useRef<{
        mainChart: IChartApi;
        candleSeries: ISeriesApi<"Candlestick">;
        volumeSeries: ISeriesApi<"Histogram">;
        levelSeries: {
            support: ISeriesApi<"Line">;
            resistance: ISeriesApi<"Line">;
            gammaHigh: ISeriesApi<"Line">;
            gammaLow: ISeriesApi<"Line">;
        };
        indicatorSeriesMap: Map<string, ISeriesApi<any>>;
    } | null>(null);

    // Canvas Overlay Refs
    // Canvas Overlay Refs
    const overlayRef = useRef<HTMLCanvasElement>(null);

    const drawingStateRef = useRef<{
        isDrawing: boolean;
        startPoint: { time: number; price: number } | null;
        currentPoint: { time: number; price: number } | null;
    }>({ isDrawing: false, startPoint: null, currentPoint: null });

    const [ohlcvData, setOhlcvData] = useState<OHLCV[]>([]);
    const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([]);
    const [isIndicatorModalOpen, setIsIndicatorModalOpen] = useState(false);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    // Drawing State
    const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
    const [drawings, setDrawings] = useState<Drawing[]>([]);
    const [drawingsVisible, setDrawingsVisible] = useState(true);
    const [drawingsLocked, setDrawingsLocked] = useState(false);
    const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

    // DEBUG STATE (Moved here)
    const [debugInfo, setDebugInfo] = useState<any>(null);
    // Update debug info when data changes
    useEffect(() => {
        if (ohlcvData.length > 0 && levelsHistory.length > 0) {
            // Log the actual structure of first level for debugging
            console.log('[DEBUG] levelsHistory[0] full object:', levelsHistory[0]);
            console.log('[DEBUG] levelsHistory[0] keys:', Object.keys(levelsHistory[0]));

            // Sort only for reading debug info
            const sorted = [...levelsHistory].sort((a: any, b: any) => {
                let tA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp;
                let tB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp;
                if (tA > 1e10) tA = tA / 1000;
                if (tB > 1e10) tB = tB / 1000;
                return tA - tB;
            });
            const first = sorted[0];
            const last = sorted[sorted.length - 1];

            // Normalize for display
            const norm = (t: any) => {
                let v = typeof t === 'string' ? new Date(t).getTime() : t;
                if (v > 1e10) v = v / 1000;
                return Math.floor(v);
            }

            setDebugInfo({
                C_Start: ohlcvData[0].time as number,
                C_End: ohlcvData[ohlcvData.length - 1].time as number,
                L_StartRaw: first.timestamp,
                L_StartNorm: norm(first.timestamp),
                L_EndNorm: norm(last.timestamp),
                S_Val_First: first.support,  // Direct access, no fallback
                S_Val_Last: last.support,
                Count: sorted.length
            });
        }
    }, [ohlcvData, levelsHistory]);

    // 1. Fetch Data
    const fetchData = useCallback(async () => {
        try {
            // Using public Binance API for this demo
            const response = await fetch(
                `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000`
            );
            const data = await response.json();
            const candles: OHLCV[] = data.map((d: any[]) => ({
                time: Math.floor(d[0] / 1000), // Unix timestamp in seconds
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
            setLoading(false);
        }
    }, [symbol, interval]);

    useEffect(() => {
        fetchData();
        const timer = setInterval(fetchData, 60000); // 1 min refresh for candles
        return () => clearInterval(timer);
    }, [fetchData]);

    // Debug State for Error Tracking
    const [debugError, setDebugError] = useState<string | null>(null);

    // 2. Initialize Chart
    useEffect(() => {
        // Skip initialization while still loading data
        if (loading) return;

        if (!chartContainerRef.current) {
            setDebugError("Container ref is null after loading");
            return;
        }

        // Clear any previous errors
        setDebugError(null);

        let mainChart: IChartApi | null = null;
        let resizeObserver: ResizeObserver | null = null;

        try {
            console.log("Initializing Chart...");
            mainChart = createChart(chartContainerRef.current, {
                layout: {
                    background: { type: ColorType.Solid, color: '#131722' },
                    textColor: '#d1d4dc',
                },
                grid: {
                    vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
                    horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
                },
                width: chartContainerRef.current.clientWidth || 800, // Fallback width
                height: chartContainerRef.current.clientHeight || 500, // Fallback height
                crosshair: {
                    mode: CrosshairMode.Normal,
                },
                timeScale: {
                    borderColor: '#485c7b',
                    timeVisible: true,
                },
                rightPriceScale: {
                    borderColor: '#485c7b',
                },
            });

            const candleSeries = mainChart.addSeries(CandlestickSeries, {
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350',
            });

            const volumeSeries = mainChart.addSeries(HistogramSeries, {
                color: '#26a69a',
                priceFormat: { type: 'volume' },
                priceScaleId: '', // Overlay
            });
            volumeSeries.priceScale().applyOptions({
                scaleMargins: { top: 0.8, bottom: 0 },
            });

            // Level Series
            const supportSeries = mainChart.addSeries(LineSeries, { color: '#22c55e', lineWidth: 1, lineStyle: LineStyle.Solid, crosshairMarkerVisible: false, priceLineVisible: false });
            const resistanceSeries = mainChart.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Solid, crosshairMarkerVisible: false, priceLineVisible: false });
            const gammaHighSeries = mainChart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1, lineStyle: LineStyle.Dashed, crosshairMarkerVisible: false, priceLineVisible: false });
            const gammaLowSeries = mainChart.addSeries(LineSeries, { color: '#f97316', lineWidth: 1, lineStyle: LineStyle.Dashed, crosshairMarkerVisible: false, priceLineVisible: false });

            const levels = {
                support: supportSeries,
                resistance: resistanceSeries,
                gammaHigh: gammaHighSeries,
                gammaLow: gammaLowSeries
            };

            chartInstancesRef.current = {
                mainChart,
                candleSeries,
                volumeSeries,
                levelSeries: levels,
                indicatorSeriesMap: new Map(),
            };

            // Resize handler
            const handleResize = () => {
                if (chartContainerRef.current && mainChart) {
                    const width = chartContainerRef.current.clientWidth;
                    const height = chartContainerRef.current.clientHeight;

                    if (width === 0 || height === 0) return;

                    mainChart.applyOptions({ width, height });

                    // Sync canvas size
                    if (overlayRef.current) {
                        overlayRef.current.width = width;
                        overlayRef.current.height = height;
                        requestAnimationFrame(drawOverlay);
                    }
                }
            };

            // Use ResizeObserver for accurate container sizing handling sidebar toggles etc
            resizeObserver = new ResizeObserver(() => {
                requestAnimationFrame(handleResize);
            });

            if (chartContainerRef.current) {
                resizeObserver.observe(chartContainerRef.current);
            }

            // Initial sizing
            handleResize();

        } catch (err: any) {
            console.error("Chart Init Error:", err);
            setDebugError(err.message || "Unknown error");
        }

        return () => {
            if (resizeObserver) resizeObserver.disconnect();
            if (mainChart) mainChart.remove();
        };
    }, [loading]);

    // 2.5 Initialize Canvas Size for Drawing
    useEffect(() => {
        if (!chartContainerRef.current || !overlayRef.current) return;

        const resizeCanvas = () => {
            if (overlayRef.current && chartContainerRef.current) {
                const rect = chartContainerRef.current.getBoundingClientRect();
                overlayRef.current.width = rect.width;
                overlayRef.current.height = rect.height;
                console.log('[CANVAS] Resized to:', rect.width, 'x', rect.height);
            }
        };

        resizeCanvas();

        const observer = new ResizeObserver(resizeCanvas);
        observer.observe(chartContainerRef.current);

        return () => observer.disconnect();
    }, [loading]);

    // 3. Update Candle Data
    useEffect(() => {
        if (!chartInstancesRef.current || ohlcvData.length === 0) return;
        const { candleSeries, volumeSeries } = chartInstancesRef.current;

        candleSeries.setData(ohlcvData.map(d => ({
            time: d.time as Time,
            open: d.open, high: d.high, low: d.low, close: d.close
        })));

        volumeSeries.setData(ohlcvData.map(d => ({
            time: d.time as Time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
        })));
    }, [ohlcvData]);

    // 4. Update Level Lines (S/R)
    useEffect(() => {
        if (!chartInstancesRef.current || ohlcvData.length === 0) return;
        const { levelSeries } = chartInstancesRef.current;

        if (levelsHistory.length > 0) {
            // Sort levels by timestamp
            const sortedLevels = [...levelsHistory].sort((a, b) => a.timestamp - b.timestamp);
            const supportData: LineData[] = [];
            const resistanceData: LineData[] = [];
            const ghData: LineData[] = [];
            const glData: LineData[] = [];

            // Map levels to candle times
            // Map levels to candle times using optimized O(N+M) scan
            if (ohlcvData.length > 0 && sortedLevels.length > 0) {
                console.log('[DEBUG] -----------------');
                console.log('[DEBUG] Candle T Start:', ohlcvData[0].time);
                console.log('[DEBUG] Candle T End:', ohlcvData[ohlcvData.length - 1].time);
                console.log('[DEBUG] Level T Start:', sortedLevels[0].timestamp);
                console.log('[DEBUG] Level T End:', sortedLevels[sortedLevels.length - 1].timestamp);
                console.log('[DEBUG] Level[0]:', sortedLevels[0]);
                console.log('[DEBUG] -----------------');
            }
            let levelIdx = 0;
            // Create a lookup function to find the best matching level for a given timestamp
            const findLevelForTime = (targetTime: number): typeof sortedLevels[0] | null => {
                if (sortedLevels.length === 0) return null;

                // Binary search for the level with timestamp <= targetTime
                let left = 0;
                let right = sortedLevels.length - 1;
                let result = -1;

                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    if (sortedLevels[mid].timestamp <= targetTime) {
                        result = mid;
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                }

                // If no level found <= targetTime, use the first level (extend backwards)
                if (result === -1) {
                    return sortedLevels[0];
                }

                return sortedLevels[result];
            };

            // Map each candle to its corresponding level
            for (const candle of ohlcvData) {
                const level = findLevelForTime(candle.time as number);

                if (level && level.support !== undefined) {
                    supportData.push({ time: candle.time as Time, value: level.support });
                    resistanceData.push({ time: candle.time as Time, value: level.resistance });
                    ghData.push({ time: candle.time as Time, value: level.gammaHigh });
                    glData.push({ time: candle.time as Time, value: level.gammaLow });
                }
            }

            // Debug: Log first and last values to verify variance
            if (supportData.length > 0) {
                console.log('[LEVEL DEBUG] First support:', supportData[0].value, 'Last support:', supportData[supportData.length - 1].value);
                console.log('[LEVEL DEBUG] Variance:', Math.abs(supportData[0].value - supportData[supportData.length - 1].value));
            }

            levelSeries.support.setData(supportData);
            levelSeries.resistance.setData(resistanceData);
            levelSeries.gammaHigh.setData(ghData);
            levelSeries.gammaLow.setData(glData);
        }
    }, [ohlcvData, levelsHistory]);

    // 5. Update Indicators
    useEffect(() => {
        if (!chartInstancesRef.current || ohlcvData.length === 0) return;
        const { mainChart, indicatorSeriesMap } = chartInstancesRef.current;

        // Add new indicators
        activeIndicators.forEach(ind => {
            if (!indicatorSeriesMap.has(ind.instanceId)) {
                // Determine definition
                const def = AVAILABLE_INDICATORS.find(d => d.id === ind.defId);
                if (!def) return;

                // Create series
                let series: ISeriesApi<"Line"> | ISeriesApi<"Histogram">;
                if (def.type === 'histogram') {
                    series = mainChart.addSeries(HistogramSeries, {
                        color: ind.color,
                        priceFormat: { type: 'volume' },
                        priceScaleId: 'indicators', // separate scale
                    });
                } else {
                    series = mainChart.addSeries(LineSeries, {
                        color: ind.color,
                        lineWidth: 2,
                        title: def.name,
                        priceScaleId: (def.category === 'Momentum' || def.category === 'Volume') ? 'indicators' : 'right'
                    });
                }

                // Calculate data
                const calculatedData = def.calculate(ohlcvData, ind.settings);
                series.setData(calculatedData.map(d => ({ time: d.time as Time, value: d.value })));

                indicatorSeriesMap.set(ind.instanceId, series);
            }
        });

        // Remove deleted indicators
        // (Simplified: keeping it add-only for this demo or full re-sync logic would be better)

    }, [activeIndicators, ohlcvData]);

    // 6. Canvas Overlay Drawing Logic
    const drawOverlay = useCallback(() => {
        const canvas = overlayRef.current;
        const chart = chartInstancesRef.current?.mainChart;
        const series = chartInstancesRef.current?.candleSeries;

        if (!canvas || !chart || !series) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Helper to convert time/price to coordinates
        const toCoords = (time: number, price: number) => {
            const x = chart.timeScale().timeToCoordinate(time as Time);
            const y = series.priceToCoordinate(price);
            return { x, y };
        };

        // Draw all saved drawings
        [...drawings, ...(drawingStateRef.current.currentPoint ? [{
            id: 'temp',
            type: activeTool, // Use activeTool directly for temp drawing
            p1: drawingStateRef.current.startPoint!,
            p2: drawingStateRef.current.currentPoint,
            color: '#fff'
        } as Drawing] : [])].forEach(d => {
            if (!d.p1 || !d.p2) return;
            const start = toCoords(d.p1.time, d.p1.price);
            const end = toCoords(d.p2.time, d.p2.price);

            if (start.x === null || start.y === null || end.x === null || end.y === null) return;

            const startX = start.x;
            const startY = start.y;
            const endX = end.x;
            const endY = end.y;

            ctx.beginPath();
            // Highlight selected drawing
            const isSelected = d.id === selectedDrawingId;
            ctx.strokeStyle = isSelected ? '#ff9800' : (d.id === 'temp' ? '#fff' : d.color);
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.fillStyle = d.id === 'temp' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(41, 98, 255, 0.2)';

            switch (d.type) {
                // Lines
                case 'trendline':
                case 'measure': // Measure ruler visualized as line for now
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                    break;
                case 'ray':
                    ctx.moveTo(startX, startY);
                    // Extend to infinity (canvas width * 2)
                    const angle = Math.atan2(endY - startY, endX - startX);
                    ctx.lineTo(startX + Math.cos(angle) * 2000, startY + Math.sin(angle) * 2000);
                    ctx.stroke();
                    break;
                case 'horizontal':
                    ctx.moveTo(0, startY);
                    ctx.lineTo(canvas.width, startY);
                    ctx.stroke();
                    break;
                case 'vertical':
                    ctx.moveTo(startX, 0);
                    ctx.lineTo(startX, canvas.height);
                    ctx.stroke();
                    break;
                case 'arrow':
                    // Line
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                    // Arrowhead
                    const headLen = 10;
                    const angleArrow = Math.atan2(endY - startY, endX - startX);
                    ctx.beginPath();
                    ctx.moveTo(endX, endY);
                    ctx.lineTo(endX - headLen * Math.cos(angleArrow - Math.PI / 6), endY - headLen * Math.sin(angleArrow - Math.PI / 6));
                    ctx.lineTo(endX - headLen * Math.cos(angleArrow + Math.PI / 6), endY - headLen * Math.sin(angleArrow + Math.PI / 6));
                    ctx.fill();
                    break;

                // Shapes
                case 'rectangle':
                    ctx.rect(startX, startY, endX - startX, endY - startY);
                    ctx.stroke();
                    ctx.fill();
                    break;
                case 'circle':
                    const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
                    ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.fill();
                    break;
                case 'triangle':
                    ctx.moveTo(startX, endY); // Bottom Left
                    ctx.lineTo(endX, endY);   // Bottom Right
                    ctx.lineTo((startX + endX) / 2, startY); // Top Middle
                    ctx.closePath();
                    ctx.stroke();
                    ctx.fill();
                    break;

                // Complex
                case 'fib-retracement':
                    const yDiff = endY - startY;
                    const width = Math.max(200, endX - startX + 100);
                    const levels = [0, 0.382, 0.5, 0.618, 1];
                    levels.forEach(l => {
                        const y = startY + yDiff * l;
                        ctx.beginPath();
                        ctx.moveTo(startX, y);
                        ctx.lineTo(startX + width, y);
                        ctx.strokeStyle = `rgba(33, 150, 243, ${1 - l})`;
                        ctx.stroke();
                        ctx.fillStyle = '#fff';
                        ctx.fillText(`${l}`, startX + 5, y - 2);
                    });
                    // Diagonal
                    ctx.beginPath();
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = '#666';
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    break;

                default:
                    // Fallback to Trendline for unknown tools
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                    break;
            }
        });

    }, [drawings, activeTool, ohlcvData, selectedDrawingId]);

    // Auto-redraw when drawings or tool changes
    useEffect(() => {
        requestAnimationFrame(drawOverlay);
    }, [drawings, drawOverlay]); // Removing activeTool/ohlcvData from here might reduce jitter, but keeping them ensures sync

    // Hook up canvas redraw to chart updates
    useEffect(() => {
        const chart = chartInstancesRef.current?.mainChart;
        if (!chart) return;

        const sub = () => requestAnimationFrame(drawOverlay);
        chart.timeScale().subscribeVisibleTimeRangeChange(sub);
        chart.timeScale().subscribeVisibleLogicalRangeChange(sub);

        return () => {
            chart.timeScale().unsubscribeVisibleTimeRangeChange(sub);
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(sub);
        };
    }, [drawOverlay]);

    // Handle container clicks for drawing
    const handleContainerClick = (e: React.MouseEvent) => {
        console.log('[DRAW] Click detected, activeTool:', activeTool);

        const chart = chartInstancesRef.current?.mainChart;
        const series = chartInstancesRef.current?.candleSeries;
        if (!chart || !series || !chartContainerRef.current) {
            console.log('[DRAW] Missing refs');
            return;
        }

        const rect = chartContainerRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // In cursor mode, try to select an existing drawing
        if (activeTool === 'cursor') {
            // Check if click is near any drawing line (within 10 pixels)
            let foundDrawing: string | null = null;

            for (const d of drawings) {
                if (!d.p1 || !d.p2) continue;

                const p1x = chart.timeScale().timeToCoordinate(d.p1.time as any);
                const p1y = series.priceToCoordinate(d.p1.price);
                const p2x = chart.timeScale().timeToCoordinate(d.p2.time as any);
                const p2y = series.priceToCoordinate(d.p2.price);

                if (p1x === null || p1y === null || p2x === null || p2y === null) continue;

                // Calculate distance from click to line segment
                const dist = distanceToLineSegment(clickX, clickY, p1x, p1y, p2x, p2y);
                if (dist < 15) {
                    foundDrawing = d.id;
                    break;
                }
            }

            setSelectedDrawingId(foundDrawing);
            console.log('[DRAW] Selected:', foundDrawing);
            drawOverlay();
            return;
        }

        // For drawing tools, use the coordinates we already captured
        const x = clickX;
        const y = clickY;
        console.log('[DRAW] Click coords:', { x, y, rectWidth: rect.width, rectHeight: rect.height });

        const time = chart.timeScale().coordinateToTime(x) as number;
        const price = series.coordinateToPrice(y);
        console.log('[DRAW] Converted:', { time, price });

        if (!time || price === null) {
            console.log('[DRAW] Invalid time/price, aborting');
            return;
        }

        if (!drawingStateRef.current.isDrawing) {
            // Start Drawing
            console.log('[DRAW] Starting drawing at', { time, price });
            drawingStateRef.current = {
                isDrawing: true,
                startPoint: { time, price },
                currentPoint: { time, price }
            };
        } else {
            // Finish Drawing
            console.log('[DRAW] Finishing drawing at', { time, price });
            const newDrawing: Drawing = {
                id: Date.now().toString(),
                type: activeTool === 'fib-retracement' ? 'fib-retracement' : activeTool as DrawingTool,
                p1: drawingStateRef.current.startPoint!,
                p2: { time, price },
                color: '#2962ff'
            };
            setDrawings(prev => [...prev, newDrawing]);
            drawingStateRef.current = { isDrawing: false, startPoint: null, currentPoint: null };
            setActiveTool('cursor'); // Reset to cursor
        }
        drawOverlay();
    };

    // Keyboard handler for deleting selected drawings
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
                setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId));
                setSelectedDrawingId(null);
                drawOverlay();
            }
            // Escape to deselect
            if (e.key === 'Escape') {
                setSelectedDrawingId(null);
                setActiveTool('cursor');
                drawingStateRef.current = { isDrawing: false, startPoint: null, currentPoint: null };
                drawOverlay();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedDrawingId, drawOverlay]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!drawingStateRef.current.isDrawing) return;

        const chart = chartInstancesRef.current?.mainChart;
        const series = chartInstancesRef.current?.candleSeries;
        if (!chart || !series || !chartContainerRef.current) return;

        const rect = chartContainerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const time = chart.timeScale().coordinateToTime(x) as number;
        const price = series.coordinateToPrice(y);

        if (time && price) {
            drawingStateRef.current.currentPoint = { time, price };
            drawOverlay(); // Redraw preview
        }
    };

    const addIndicator = (defId: string) => {
        setActiveIndicators(prev => [
            ...prev,
            {
                instanceId: Date.now().toString(),
                defId,
                color: COLORS[prev.length % COLORS.length],
                settings: {} // Use defaults
            }
        ]);
        setIsIndicatorModalOpen(false);
    };

    if (loading) return <div className="flex items-center justify-center h-96 text-gray-400">Loading Chart Data...</div>;

    return (
        <div className="relative w-full h-full flex flex-col bg-[#131722] overflow-hidden">
            {/* Top Toolbar */}
            <div className="h-12 border-b border-gray-800 flex items-center px-4 justify-between bg-[#1e222d] z-30">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2a2e39] relative z-40 bg-[#131722]">
                    <div className="text-gray-100 font-bold">{symbol} · {interval}</div>
                    <div className="h-4 w-px bg-gray-700" />
                    <div className="text-xs text-gray-500 font-mono">
                        Tool: {activeTool} | Int: {interval} | Err: {debugError || 'None'}
                    </div>

                    <div className="flex items-center gap-1 ml-4 bg-[#1e222d] rounded p-0.5">
                        {['5m', '15m', '1h', '4h', '1d'].map((tf) => (
                            <button
                                key={tf}
                                onClick={() => onIntervalChange?.(tf)}
                                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${interval === tf
                                    ? 'bg-[#2962ff] text-white'
                                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#2a2e39]'
                                    }`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-1 ml-4">
                        <button
                            onClick={() => setIsIndicatorModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-[#2a2e39] text-gray-300 hover:text-blue-400 transition-colors"
                        >
                            <Activity size={16} />
                            <span className="text-sm">Indicators</span>
                            <Plus size={14} className="ml-1 opacity-50" />
                        </button>
                    </div>

                    {/* Active Indicators Chips */}
                    <div className="flex gap-2 ml-4">
                        {activeIndicators.map(ind => (
                            <div key={ind.instanceId} className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300">
                                <span style={{ color: ind.color }}>●</span>
                                {AVAILABLE_INDICATORS.find(d => d.id === ind.defId)?.name}
                                <X
                                    size={12}
                                    className="cursor-pointer hover:text-red-400 ml-1"
                                    onClick={() => {
                                        setActiveIndicators(prev => prev.filter(p => p.instanceId !== ind.instanceId));
                                        // Also remove from chart
                                        const series = chartInstancesRef.current?.indicatorSeriesMap.get(ind.instanceId);
                                        if (series) {
                                            chartInstancesRef.current?.mainChart.removeSeries(series);
                                            chartInstancesRef.current?.indicatorSeriesMap.delete(ind.instanceId);
                                        }
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsIndicatorModalOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-[#2a2e39] text-gray-300 hover:text-blue-400 transition-colors"
                    >
                        <Activity size={16} />
                        <span className="text-sm">Indicators</span>
                        <Plus size={14} className="ml-1 opacity-50" />
                    </button>
                </div>
            </div>


            {/* Main Area */}
            <div className="flex-1 relative overflow-visible">
                {/* Left Toolbar - absolute positioned within this container */}
                <DrawingToolbar
                    activeTool={activeTool}
                    onSelectTool={setActiveTool}
                    onClearAll={() => { setDrawings([]); drawOverlay(); }}
                    onToggleVisibility={() => {
                        setDrawingsVisible(prev => {
                            const newValue = !prev;
                            // Trigger redraw after state update
                            requestAnimationFrame(drawOverlay);
                            return newValue;
                        });
                    }}
                    onLockDrawings={() => setDrawingsLocked(prev => !prev)}
                    drawingsVisible={drawingsVisible}
                    drawingsLocked={drawingsLocked}
                />

                {/* Chart Container - with left padding for toolbar */}
                <div
                    className="absolute left-12 top-0 right-0 bottom-0"
                    ref={chartContainerRef}
                // Move events to overlay to prevent interference
                >
                    <canvas
                        ref={overlayRef}
                        // Enable pointer events when drawing OR when in cursor mode with drawings
                        className={`absolute top-0 left-0 w-full h-full z-10 ${!drawingsVisible ? 'opacity-0' : ''
                            } ${(activeTool !== 'cursor' || drawings.length > 0) && !drawingsLocked
                                ? (activeTool !== 'cursor' ? 'cursor-crosshair' : 'cursor-pointer')
                                : 'pointer-events-none'
                            }`}
                        style={{ width: '100%', height: '100%' }}
                        onClick={(e) => {
                            if (drawingsLocked) return;
                            handleContainerClick(e);
                        }}
                        onMouseMove={handleMouseMove}
                    />
                </div>
            </div>

            <IndicatorModal
                isOpen={isIndicatorModalOpen}
                onClose={() => setIsIndicatorModalOpen(false)}
                onAddIndicator={addIndicator}
                activeIndicators={activeIndicators.map(i => i.defId)}
            />
        </div>
    );
};

export { AdvancedChart };
export default AdvancedChart;
