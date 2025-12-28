'use client';

import { useState, useCallback } from 'react';
import { Calculator, RefreshCw } from 'lucide-react';
import { calculateOptionPrice, calculateGreeks } from '@/lib/options/blackScholes';
import type { OptionType } from '@/types';

export function BlackScholesWidget() {
    const [contractType, setContractType] = useState<OptionType>('call');
    const [underlyingPrice, setUnderlyingPrice] = useState(95000);
    const [strike, setStrike] = useState(100000);
    const [daysToExpiry, setDaysToExpiry] = useState(30);
    const [riskFreeRate, setRiskFreeRate] = useState(5);
    const [volatility, setVolatility] = useState(65);
    const [multiplier, setMultiplier] = useState(1);

    // Solve mode: 'price' = calculate price from IV, 'iv' = calculate IV from price
    const [solveMode, setSolveMode] = useState<'price' | 'iv'>('price');
    const [targetPrice, setTargetPrice] = useState(5000);

    const T = daysToExpiry / 365;
    const r = riskFreeRate / 100;
    const sigma = volatility / 100;

    // Calculate option price
    const optionPrice = calculateOptionPrice(
        underlyingPrice,
        strike,
        T,
        r,
        sigma,
        contractType
    );

    // Calculate Greeks
    const greeks = calculateGreeks(
        underlyingPrice,
        strike,
        T,
        r,
        sigma,
        contractType
    );

    // Calculate intrinsic and extrinsic value
    const intrinsicValue = contractType === 'call'
        ? Math.max(0, underlyingPrice - strike)
        : Math.max(0, strike - underlyingPrice);
    const extrinsicValue = optionPrice - intrinsicValue;

    // Total contract value
    const totalValue = optionPrice * multiplier;

    // Implied volatility solver (Newton-Raphson approximation)
    const solveImpliedVolatility = useCallback(() => {
        let iv = 0.5; // Initial guess
        const tolerance = 0.0001;
        const maxIterations = 100;

        for (let i = 0; i < maxIterations; i++) {
            const price = calculateOptionPrice(underlyingPrice, strike, T, r, iv, contractType);
            const vega = calculateGreeks(underlyingPrice, strike, T, r, iv, contractType).vega;

            if (Math.abs(vega) < 0.0001) break;

            const diff = price - targetPrice;
            if (Math.abs(diff) < tolerance) break;

            iv = iv - diff / (vega * 100);
            if (iv < 0.01) iv = 0.01;
            if (iv > 5) iv = 5;
        }

        setVolatility(Math.round(iv * 10000) / 100);
    }, [underlyingPrice, strike, T, r, contractType, targetPrice]);

    return (
        <div className="h-full flex flex-col text-sm overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border-color mb-3">
                <div className="flex items-center gap-2">
                    <Calculator size={14} className="text-accent-primary" />
                    <span className="text-xs font-semibold text-foreground">BLACK-SCHOLES</span>
                </div>
            </div>

            {/* Contract Type Toggle */}
            <div className="mb-3">
                <label className="text-xs text-foreground-muted block mb-1.5">Contract Type</label>
                <div className="flex gap-1">
                    {(['call', 'put'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => setContractType(type)}
                            className={`flex-1 py-1.5 px-2 text-xs rounded transition-colors ${contractType === type
                                    ? type === 'call'
                                        ? 'bg-bullish/20 text-bullish border border-bullish'
                                        : 'bg-bearish/20 text-bearish border border-bearish'
                                    : 'bg-background-secondary text-foreground-muted border border-transparent hover:border-border-color'
                                }`}
                        >
                            {type.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Inputs Grid */}
            <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                    <label className="text-xs text-foreground-muted block mb-1">Underlying ($)</label>
                    <input
                        type="number"
                        value={underlyingPrice}
                        onChange={(e) => setUnderlyingPrice(Number(e.target.value))}
                        className="input-field text-xs py-1.5 w-full font-mono"
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
                <div>
                    <label className="text-xs text-foreground-muted block mb-1">Days to Expiry</label>
                    <input
                        type="number"
                        value={daysToExpiry}
                        onChange={(e) => setDaysToExpiry(Number(e.target.value))}
                        className="input-field text-xs py-1.5 w-full font-mono"
                        min={1}
                    />
                </div>
                <div>
                    <label className="text-xs text-foreground-muted block mb-1">Multiplier</label>
                    <input
                        type="number"
                        value={multiplier}
                        onChange={(e) => setMultiplier(Number(e.target.value))}
                        className="input-field text-xs py-1.5 w-full font-mono"
                        min={1}
                    />
                </div>
                <div>
                    <label className="text-xs text-foreground-muted block mb-1">Risk-Free Rate (%)</label>
                    <input
                        type="number"
                        value={riskFreeRate}
                        onChange={(e) => setRiskFreeRate(Number(e.target.value))}
                        className="input-field text-xs py-1.5 w-full font-mono"
                        step={0.5}
                    />
                </div>
                <div>
                    <label className="text-xs text-foreground-muted block mb-1">Volatility (%)</label>
                    <input
                        type="number"
                        value={volatility}
                        onChange={(e) => setVolatility(Number(e.target.value))}
                        className="input-field text-xs py-1.5 w-full font-mono"
                        step={1}
                    />
                </div>
            </div>

            {/* Solve Mode Toggle */}
            <div className="mb-3 p-2 bg-background-secondary rounded-lg">
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-foreground-muted">Solve Mode</label>
                    <div className="flex gap-1">
                        <button
                            onClick={() => setSolveMode('price')}
                            className={`px-2 py-1 text-xs rounded ${solveMode === 'price' ? 'bg-accent-primary text-white' : 'bg-background-tertiary text-foreground-muted'
                                }`}
                        >
                            Price
                        </button>
                        <button
                            onClick={() => setSolveMode('iv')}
                            className={`px-2 py-1 text-xs rounded ${solveMode === 'iv' ? 'bg-accent-primary text-white' : 'bg-background-tertiary text-foreground-muted'
                                }`}
                        >
                            IV
                        </button>
                    </div>
                </div>

                {solveMode === 'iv' && (
                    <div className="flex gap-2 items-end">
                        <div className="flex-1">
                            <label className="text-xs text-foreground-muted block mb-1">Target Price ($)</label>
                            <input
                                type="number"
                                value={targetPrice}
                                onChange={(e) => setTargetPrice(Number(e.target.value))}
                                className="input-field text-xs py-1.5 w-full font-mono"
                            />
                        </div>
                        <button
                            onClick={solveImpliedVolatility}
                            className="btn-primary p-1.5"
                            title="Solve for IV"
                        >
                            <RefreshCw size={14} />
                        </button>
                    </div>
                )}
            </div>

            {/* Results */}
            <div className="space-y-2">
                {/* Option Value */}
                <div className="p-2 bg-gradient-to-r from-accent-primary/20 to-transparent rounded-lg border border-accent-primary/30">
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-foreground-muted">Option Price</span>
                        <span className="text-lg font-bold font-mono text-accent-primary">
                            ${optionPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                    <div className="flex justify-between text-xs text-foreground-muted mt-1">
                        <span>Total Value (×{multiplier})</span>
                        <span className="font-mono">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                </div>

                {/* Intrinsic/Extrinsic */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-background-secondary rounded-lg text-center">
                        <div className="text-xs text-foreground-muted">Intrinsic</div>
                        <div className="font-mono text-sm">${intrinsicValue.toLocaleString()}</div>
                    </div>
                    <div className="p-2 bg-background-secondary rounded-lg text-center">
                        <div className="text-xs text-foreground-muted">Extrinsic</div>
                        <div className="font-mono text-sm">${extrinsicValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                </div>

                {/* Greeks */}
                <div className="grid grid-cols-5 gap-1">
                    {[
                        { label: 'Δ', value: greeks.delta.toFixed(4), color: 'text-blue-400' },
                        { label: 'Γ', value: greeks.gamma.toFixed(6), color: 'text-green-400' },
                        { label: 'Θ', value: greeks.theta.toFixed(2), color: 'text-red-400' },
                        { label: 'V', value: greeks.vega.toFixed(2), color: 'text-purple-400' },
                        { label: 'ρ', value: (greeks.rho || 0).toFixed(2), color: 'text-yellow-400' },
                    ].map((g) => (
                        <div key={g.label} className="p-1.5 bg-background-secondary rounded text-center">
                            <div className={`text-xs ${g.color}`}>{g.label}</div>
                            <div className="font-mono text-xs">{g.value}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
