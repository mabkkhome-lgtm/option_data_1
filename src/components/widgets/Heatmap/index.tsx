'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw, Grid3X3 } from 'lucide-react';
import { deribitService } from '@/lib/api/deribit';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

/**
 * Heatmap Widget - Based on Thales MFI Research
 * 
 * Visual market overview showing:
 * - X-axis: Strike prices
 * - Y-axis: Expiry dates
 * - Color intensity: Volume, Open Interest, or IV
 * 
 * Helps identify:
 * - Areas of high activity
 * - Popular strike prices
 * - Concentration of positions
 */

type MetricType = 'volume' | 'oi' | 'iv';

interface HeatmapData {
    strikes: number[];
    expiries: string[];
    values: number[][];
    metric: MetricType;
}

export function HeatmapWidget() {
    const [isMounted, setIsMounted] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currency, setCurrency] = useState('BTC');
    const [metric, setMetric] = useState<MetricType>('volume');
    const [optionType, setOptionType] = useState<'all' | 'call' | 'put'>('all');
    const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Fetch and process data
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            // Get all tickers for the currency
            const tickers = await deribitService.getAllTickers(currency);

            if (!tickers || tickers.length === 0) {
                setError('No data available');
                setIsLoading(false);
                return;
            }

            // Parse and organize data
            const strikeSet = new Set<number>();
            const expirySet = new Set<string>();
            const dataMap = new Map<string, { volume: number; oi: number; iv: number }>();

            for (const ticker of tickers) {
                const parsed = deribitService.parseInstrumentName(ticker.instrument_name);
                if (!parsed) continue;

                // Filter by option type
                if (optionType !== 'all' && parsed.type !== optionType) continue;

                strikeSet.add(parsed.strike);
                expirySet.add(parsed.expiry);

                const key = `${parsed.expiry}-${parsed.strike}`;
                const existing = dataMap.get(key) || { volume: 0, oi: 0, iv: 0 };

                dataMap.set(key, {
                    volume: existing.volume + (ticker.volume_24h || 0),
                    oi: existing.oi + (ticker.open_interest || 0),
                    iv: Math.max(existing.iv, ticker.mark_iv || 0),
                });
            }

            // Sort strikes and expiries
            const strikes = [...strikeSet].sort((a, b) => a - b);
            const expiries = [...expirySet].sort((a, b) => {
                const dateA = parseExpiryDate(a);
                const dateB = parseExpiryDate(b);
                return dateA.getTime() - dateB.getTime();
            });

            // Build 2D values array
            const values: number[][] = expiries.map(expiry =>
                strikes.map(strike => {
                    const key = `${expiry}-${strike}`;
                    const data = dataMap.get(key);
                    if (!data) return 0;
                    return metric === 'volume' ? data.volume
                        : metric === 'oi' ? data.oi
                            : data.iv;
                })
            );

            setHeatmapData({ strikes, expiries, values, metric });
        } catch (err) {
            console.error('[Heatmap] Failed to fetch data:', err);
            setError('Failed to load data');
        }

        setIsLoading(false);
    }, [currency, metric, optionType]);

    useEffect(() => {
        if (isMounted) {
            fetchData();
        }
    }, [isMounted, fetchData]);

    // Format helpers
    const formatStrike = (n: number) => {
        if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
        return n.toString();
    };

    const formatExpiry = (expiry: string): string => {
        const match = expiry.match(/^(\d+)([A-Z]+)(\d+)$/);
        if (!match) return expiry;
        return `${match[1]}${match[2].slice(0, 3)}`;
    };

    const getColorscale = () => {
        if (metric === 'iv') {
            return [
                [0, '#1a1625'],
                [0.25, '#312e81'],
                [0.5, '#7c3aed'],
                [0.75, '#c4b5fd'],
                [1, '#f5f3ff'],
            ];
        }
        return [
            [0, '#1a1625'],
            [0.25, '#14532d'],
            [0.5, '#22c55e'],
            [0.75, '#86efac'],
            [1, '#f0fdf4'],
        ];
    };

    // Empty/Loading states
    if (!isMounted) {
        return (
            <div className="h-full flex items-center justify-center text-foreground-muted">
                Loading...
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-2">
            {/* Controls */}
            <div className="flex items-center gap-2 pb-2 border-b border-border-color mb-2 flex-wrap">
                <select
                    className="bg-background-tertiary text-foreground text-xs px-2 py-1 rounded border border-border-color"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                >
                    <option value="BTC">BTC</option>
                    <option value="ETH">ETH</option>
                    <option value="SOL">SOL</option>
                </select>

                {/* Metric selector */}
                <div className="flex gap-0.5 bg-background-tertiary rounded p-0.5">
                    {(['volume', 'oi', 'iv'] as MetricType[]).map(m => (
                        <button
                            key={m}
                            onClick={() => setMetric(m)}
                            className={`px-2 py-0.5 text-xs rounded transition-all ${metric === m
                                ? 'bg-accent-primary text-black font-bold'
                                : 'text-foreground-muted hover:bg-background-secondary'
                                }`}
                        >
                            {m === 'volume' ? 'Volume' : m === 'oi' ? 'OI' : 'IV'}
                        </button>
                    ))}
                </div>

                {/* Type filter */}
                <div className="flex gap-0.5">
                    {(['all', 'call', 'put'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setOptionType(type)}
                            className={`px-2 py-0.5 text-xs rounded ${optionType === type
                                ? type === 'call' ? 'bg-green-500/20 text-green-400'
                                    : type === 'put' ? 'bg-red-500/20 text-red-400'
                                        : 'bg-background-secondary text-foreground'
                                : 'text-foreground-muted hover:bg-background-secondary'
                                }`}
                        >
                            {type === 'all' ? 'All' : type === 'call' ? 'Calls' : 'Puts'}
                        </button>
                    ))}
                </div>

                <button
                    onClick={fetchData}
                    disabled={isLoading}
                    className="p-1.5 bg-background-secondary hover:bg-background-tertiary rounded disabled:opacity-50"
                    title="Refresh"
                >
                    <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                </button>

                <div className="flex-1" />

                <span className="text-xs text-foreground-muted">
                    {heatmapData ? `${heatmapData.strikes.length} strikes × ${heatmapData.expiries.length} expiries` : ''}
                </span>
            </div>

            {/* Error */}
            {error && (
                <div className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded mb-2">
                    {error}
                </div>
            )}

            {/* Heatmap */}
            <div
                className="flex-1 min-h-0"
                onWheel={(e) => e.stopPropagation()}
            >
                {heatmapData && heatmapData.strikes.length > 0 ? (
                    <Plot
                        data={[{
                            type: 'heatmap',
                            x: heatmapData.strikes.map(formatStrike),
                            y: heatmapData.expiries.map(formatExpiry),
                            z: heatmapData.values,
                            colorscale: getColorscale() as any,
                            showscale: true,
                            colorbar: {
                                title: {
                                    text: metric === 'volume' ? 'Vol (24h)'
                                        : metric === 'oi' ? 'Open Int.'
                                            : 'IV (%)',
                                    side: 'right',
                                    font: { size: 10 },
                                } as any,
                                thickness: 15,
                                len: 0.8,
                                tickfont: { size: 9 },
                            } as any,
                            hovertemplate:
                                'Strike: %{x}<br>' +
                                'Expiry: %{y}<br>' +
                                `${metric === 'volume' ? 'Volume' : metric === 'oi' ? 'OI' : 'IV'}: %{z:.2f}` +
                                '<extra></extra>',
                        }]}
                        layout={{
                            autosize: true,
                            margin: { l: 50, r: 60, t: 10, b: 50 },
                            paper_bgcolor: 'transparent',
                            plot_bgcolor: 'transparent',
                            font: { color: '#e8e6f0', size: 10 },
                            xaxis: {
                                title: { text: 'Strike Price', font: { size: 10 } },
                                tickangle: -45,
                                tickfont: { size: 8 },
                            },
                            yaxis: {
                                title: { text: 'Expiry', font: { size: 10 } },
                                tickfont: { size: 8 },
                            },
                        }}
                        config={{
                            displayModeBar: false,
                            responsive: true,
                        }}
                        style={{ width: '100%', height: '100%' }}
                    />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-foreground-muted">
                        <Grid3X3 size={32} className="opacity-50 mb-2" />
                        <p className="text-sm">No Data</p>
                        <p className="text-xs opacity-75">Click Refresh to load heatmap</p>
                    </div>
                )}
            </div>

            {/* Legend Footer */}
            <div className="pt-2 border-t border-border-color mt-1 text-[10px] text-foreground-muted flex justify-between">
                <span>Low Activity</span>
                <div className="flex items-center gap-1">
                    <div className="w-16 h-2 rounded" style={{
                        background: metric === 'iv'
                            ? 'linear-gradient(to right, #1a1625, #7c3aed, #f5f3ff)'
                            : 'linear-gradient(to right, #1a1625, #22c55e, #f0fdf4)'
                    }} />
                </div>
                <span>High Activity</span>
            </div>
        </div>
    );
}

// Helper to parse expiry date string
function parseExpiryDate(expiry: string): Date {
    const match = expiry.match(/^(\d+)([A-Z]+)(\d+)$/);
    if (!match) return new Date(0);

    const day = parseInt(match[1]);
    const monthStr = match[2];
    const year = 2000 + parseInt(match[3]);

    const months: Record<string, number> = {
        JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
        JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
    };

    return new Date(year, months[monthStr] || 0, day);
}
