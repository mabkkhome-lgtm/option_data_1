'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { calculateOptionPrice } from '@/lib/options/blackScholes';
import type { OptionType, PositionDirection } from '@/types';

export function PositionSimulatorWidget() {
    const [contractType, setContractType] = useState<OptionType>('call');
    const [direction, setDirection] = useState<PositionDirection>('long');
    const [size, setSize] = useState(1);

    // Entry details
    const [entryPrice, setEntryPrice] = useState(5000);
    const [entryUnderlying, setEntryUnderlying] = useState(95000);
    const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);

    // Exit/Current details
    const [exitPrice, setExitPrice] = useState(6500);
    const [exitUnderlying, setExitUnderlying] = useState(98000);
    const [strike, setStrike] = useState(100000);

    // Days to expiry at entry
    const [dteAtEntry, setDteAtEntry] = useState(30);

    // Calculate P&L
    const entryValue = entryPrice * size;
    const exitValue = exitPrice * size;
    const multiplier = direction === 'long' ? 1 : -1;

    // For long: profit = exit - entry
    // For short: profit = entry - exit
    const unrealizedPnL = multiplier * (exitValue - entryValue);
    const unrealizedPnLPercent = entryValue > 0 ? (unrealizedPnL / entryValue) * 100 : 0;

    // P&L at expiry calculation
    const intrinsicAtExpiry = contractType === 'call'
        ? Math.max(0, exitUnderlying - strike)
        : Math.max(0, strike - exitUnderlying);

    const pnlAtExpiry = direction === 'long'
        ? (intrinsicAtExpiry - entryPrice) * size
        : (entryPrice - intrinsicAtExpiry) * size;

    // Cash flow
    const cashFlowAtEntry = direction === 'long' ? -entryValue : entryValue;
    const cashFlowAtExit = direction === 'long' ? exitValue : -exitValue;
    const netCashFlow = cashFlowAtEntry + cashFlowAtExit;

    // Breakeven
    const breakeven = contractType === 'call'
        ? strike + (direction === 'long' ? entryPrice : -entryPrice)
        : strike - (direction === 'long' ? entryPrice : -entryPrice);

    return (
        <div className="h-full flex flex-col text-sm overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border-color mb-3">
                <div className="flex items-center gap-2">
                    <DollarSign size={14} className="text-accent-primary" />
                    <span className="text-xs font-semibold text-foreground">POSITION SIMULATOR</span>
                </div>
            </div>

            {/* Position Setup */}
            <div className="grid grid-cols-2 gap-2 mb-3">
                {/* Direction */}
                <div>
                    <label className="text-xs text-foreground-muted block mb-1.5">Direction</label>
                    <div className="flex gap-1">
                        {(['long', 'short'] as const).map((dir) => (
                            <button
                                key={dir}
                                onClick={() => setDirection(dir)}
                                className={`flex-1 py-1.5 flex items-center justify-center gap-1 text-xs rounded transition-colors ${direction === dir
                                        ? dir === 'long'
                                            ? 'bg-bullish/20 text-bullish border border-bullish'
                                            : 'bg-bearish/20 text-bearish border border-bearish'
                                        : 'bg-background-secondary text-foreground-muted border border-transparent'
                                    }`}
                            >
                                {dir === 'long' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                {dir.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Type */}
                <div>
                    <label className="text-xs text-foreground-muted block mb-1.5">Type</label>
                    <div className="flex gap-1">
                        {(['call', 'put'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => setContractType(type)}
                                className={`flex-1 py-1.5 text-xs rounded transition-colors ${contractType === type
                                        ? type === 'call'
                                            ? 'bg-bullish/20 text-bullish border border-bullish'
                                            : 'bg-bearish/20 text-bearish border border-bearish'
                                        : 'bg-background-secondary text-foreground-muted border border-transparent'
                                    }`}
                            >
                                {type.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Size & Strike */}
            <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                    <label className="text-xs text-foreground-muted block mb-1">Size (Contracts)</label>
                    <input
                        type="number"
                        value={size}
                        onChange={(e) => setSize(Number(e.target.value))}
                        className="input-field text-xs py-1.5 w-full font-mono"
                        min={1}
                    />
                </div>
                <div>
                    <label className="text-xs text-foreground-muted block mb-1">Strike ($)</label>
                    <input
                        type="number"
                        value={strike}
                        onChange={(e) => setStrike(Number(e.target.value))}
                        className="input-field text-xs py-1.5 w-full font-mono"
                    />
                </div>
            </div>

            {/* Entry Section */}
            <div className="p-2 bg-background-secondary rounded-lg mb-2">
                <div className="text-xs text-foreground-muted font-semibold mb-2 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-accent-primary"></span>
                    Entry
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="text-xs text-foreground-muted block mb-1">Date</label>
                        <input
                            type="date"
                            value={entryDate}
                            onChange={(e) => setEntryDate(e.target.value)}
                            className="input-field text-xs py-1 w-full"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground-muted block mb-1">Price ($)</label>
                        <input
                            type="number"
                            value={entryPrice}
                            onChange={(e) => setEntryPrice(Number(e.target.value))}
                            className="input-field text-xs py-1 w-full font-mono"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground-muted block mb-1">Underlying</label>
                        <input
                            type="number"
                            value={entryUnderlying}
                            onChange={(e) => setEntryUnderlying(Number(e.target.value))}
                            className="input-field text-xs py-1 w-full font-mono"
                        />
                    </div>
                </div>
            </div>

            {/* Exit/Current Section */}
            <div className="p-2 bg-background-secondary rounded-lg mb-3">
                <div className="text-xs text-foreground-muted font-semibold mb-2 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-accent-secondary"></span>
                    Current / Exit
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-foreground-muted block mb-1">Price ($)</label>
                        <input
                            type="number"
                            value={exitPrice}
                            onChange={(e) => setExitPrice(Number(e.target.value))}
                            className="input-field text-xs py-1 w-full font-mono"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground-muted block mb-1">Underlying</label>
                        <input
                            type="number"
                            value={exitUnderlying}
                            onChange={(e) => setExitUnderlying(Number(e.target.value))}
                            className="input-field text-xs py-1 w-full font-mono"
                        />
                    </div>
                </div>
            </div>

            {/* Results */}
            <div className="space-y-2 mt-auto">
                {/* Unrealized P&L */}
                <div className={`p-2 rounded-lg border ${unrealizedPnL >= 0
                        ? 'bg-bullish/10 border-bullish/30'
                        : 'bg-bearish/10 border-bearish/30'
                    }`}>
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-foreground-muted">Unrealized P&L</span>
                        <div className="text-right">
                            <span className={`text-lg font-bold font-mono ${unrealizedPnL >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                                {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toLocaleString()}
                            </span>
                            <span className={`text-xs ml-2 ${unrealizedPnL >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                                ({unrealizedPnLPercent >= 0 ? '+' : ''}{unrealizedPnLPercent.toFixed(1)}%)
                            </span>
                        </div>
                    </div>
                </div>

                {/* P&L at Expiry */}
                <div className={`p-2 rounded-lg border ${pnlAtExpiry >= 0
                        ? 'bg-bullish/10 border-bullish/30'
                        : 'bg-bearish/10 border-bearish/30'
                    }`}>
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-foreground-muted">P&L at Expiry</span>
                        <span className={`font-bold font-mono ${pnlAtExpiry >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                            {pnlAtExpiry >= 0 ? '+' : ''}${pnlAtExpiry.toLocaleString()}
                        </span>
                    </div>
                </div>

                {/* Cash Flow & Breakeven */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-background-secondary rounded-lg text-center">
                        <div className="text-xs text-foreground-muted">Net Cash Flow</div>
                        <div className={`font-mono text-sm ${netCashFlow >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                            ${netCashFlow.toLocaleString()}
                        </div>
                    </div>
                    <div className="p-2 bg-background-secondary rounded-lg text-center">
                        <div className="text-xs text-foreground-muted">Breakeven</div>
                        <div className="font-mono text-sm text-accent-primary">${breakeven.toLocaleString()}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
