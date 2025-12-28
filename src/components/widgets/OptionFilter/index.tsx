'use client';

import { Filter, RotateCcw } from 'lucide-react';
import { useSimulationStore } from '@/stores/simulation';

// Available expiry dates (in real app, would come from API)
const AVAILABLE_EXPIRIES = [
    '2024-01-26',
    '2024-02-02',
    '2024-02-09',
    '2024-02-23',
    '2024-03-01',
    '2024-03-29',
    '2024-06-28',
    '2024-09-27',
];

export function OptionFilterWidget() {
    const {
        selectedExpiries,
        optionType,
        side,
        minSize,
        maxSize,
        minStrike,
        maxStrike,
        minIV,
        maxIV,
        setSelectedExpiries,
        setOptionType,
        setSide,
        setMinSize,
        setMaxSize,
        setStrikeRange,
        setIVRange,
        resetFilters,
    } = useSimulationStore();

    const handleExpiryToggle = (expiry: string) => {
        if (selectedExpiries.includes(expiry)) {
            setSelectedExpiries(selectedExpiries.filter((e) => e !== expiry));
        } else {
            setSelectedExpiries([...selectedExpiries, expiry]);
        }
    };

    const selectAllExpiries = () => {
        setSelectedExpiries([...AVAILABLE_EXPIRIES]);
    };

    const clearAllExpiries = () => {
        setSelectedExpiries([]);
    };

    return (
        <div className="h-full flex flex-col text-sm overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border-color mb-3">
                <div className="flex items-center gap-2">
                    <Filter size={14} className="text-accent-primary" />
                    <span className="text-xs font-semibold text-foreground">OPTION FILTERS</span>
                </div>
                <button
                    onClick={resetFilters}
                    className="p-1 hover:bg-background-tertiary rounded transition-colors text-foreground-muted hover:text-foreground"
                    title="Reset Filters"
                >
                    <RotateCcw size={14} />
                </button>
            </div>

            {/* Option Type: Call/Put */}
            <div className="mb-3">
                <label className="text-xs text-foreground-muted block mb-1.5">Option Type</label>
                <div className="flex gap-1">
                    {(['all', 'call', 'put'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => setOptionType(type)}
                            className={`flex-1 py-1.5 px-2 text-xs rounded transition-colors ${optionType === type
                                    ? type === 'call'
                                        ? 'bg-bullish/20 text-bullish border border-bullish'
                                        : type === 'put'
                                            ? 'bg-bearish/20 text-bearish border border-bearish'
                                            : 'bg-accent-primary/20 text-accent-primary border border-accent-primary'
                                    : 'bg-background-secondary text-foreground-muted border border-transparent hover:border-border-color'
                                }`}
                        >
                            {type.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Side: Buy/Sell */}
            <div className="mb-3">
                <label className="text-xs text-foreground-muted block mb-1.5">Side (Direction)</label>
                <div className="flex gap-1">
                    {(['all', 'buy', 'sell'] as const).map((s) => (
                        <button
                            key={s}
                            onClick={() => setSide(s)}
                            className={`flex-1 py-1.5 px-2 text-xs rounded transition-colors ${side === s
                                    ? s === 'buy'
                                        ? 'bg-bullish/20 text-bullish border border-bullish'
                                        : s === 'sell'
                                            ? 'bg-bearish/20 text-bearish border border-bearish'
                                            : 'bg-accent-primary/20 text-accent-primary border border-accent-primary'
                                    : 'bg-background-secondary text-foreground-muted border border-transparent hover:border-border-color'
                                }`}
                        >
                            {s.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>

            {/* Size Range */}
            <div className="mb-3">
                <label className="text-xs text-foreground-muted block mb-1.5">Position Size (Contracts)</label>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-foreground-muted">Min</label>
                        <input
                            type="number"
                            value={minSize}
                            onChange={(e) => setMinSize(Number(e.target.value))}
                            className="input-field text-xs py-1.5 w-full font-mono"
                            min={1}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground-muted">Max</label>
                        <input
                            type="number"
                            value={maxSize}
                            onChange={(e) => setMaxSize(Number(e.target.value))}
                            className="input-field text-xs py-1.5 w-full font-mono"
                            min={1}
                        />
                    </div>
                </div>
            </div>

            {/* Strike Range */}
            <div className="mb-3">
                <label className="text-xs text-foreground-muted block mb-1.5">Strike Range ($)</label>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-foreground-muted">Min</label>
                        <input
                            type="number"
                            value={minStrike ?? ''}
                            onChange={(e) => setStrikeRange(e.target.value ? Number(e.target.value) : null, maxStrike)}
                            className="input-field text-xs py-1.5 w-full font-mono"
                            placeholder="Any"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground-muted">Max</label>
                        <input
                            type="number"
                            value={maxStrike ?? ''}
                            onChange={(e) => setStrikeRange(minStrike, e.target.value ? Number(e.target.value) : null)}
                            className="input-field text-xs py-1.5 w-full font-mono"
                            placeholder="Any"
                        />
                    </div>
                </div>
            </div>

            {/* IV Range */}
            <div className="mb-3">
                <label className="text-xs text-foreground-muted block mb-1.5">Implied Volatility (%)</label>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-foreground-muted">Min</label>
                        <input
                            type="number"
                            value={minIV ?? ''}
                            onChange={(e) => setIVRange(e.target.value ? Number(e.target.value) : null, maxIV)}
                            className="input-field text-xs py-1.5 w-full font-mono"
                            placeholder="Any"
                            step={5}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground-muted">Max</label>
                        <input
                            type="number"
                            value={maxIV ?? ''}
                            onChange={(e) => setIVRange(minIV, e.target.value ? Number(e.target.value) : null)}
                            className="input-field text-xs py-1.5 w-full font-mono"
                            placeholder="Any"
                            step={5}
                        />
                    </div>
                </div>
            </div>

            {/* Expiry Selection */}
            <div className="flex-1">
                <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-foreground-muted">Expiry Dates</label>
                    <div className="flex gap-1">
                        <button
                            onClick={selectAllExpiries}
                            className="text-xs text-accent-primary hover:underline"
                        >
                            All
                        </button>
                        <span className="text-foreground-muted">/</span>
                        <button
                            onClick={clearAllExpiries}
                            className="text-xs text-accent-primary hover:underline"
                        >
                            None
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-1 max-h-32 overflow-auto">
                    {AVAILABLE_EXPIRIES.map((expiry) => (
                        <label
                            key={expiry}
                            className={`flex items-center gap-1.5 p-1.5 rounded cursor-pointer text-xs transition-colors ${selectedExpiries.includes(expiry)
                                    ? 'bg-accent-primary/20 text-accent-primary'
                                    : 'bg-background-secondary text-foreground-muted hover:bg-background-tertiary'
                                }`}
                        >
                            <input
                                type="checkbox"
                                checked={selectedExpiries.includes(expiry)}
                                onChange={() => handleExpiryToggle(expiry)}
                                className="accent-accent-primary w-3 h-3"
                            />
                            <span className="font-mono">{expiry}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Active Filters Summary */}
            <div className="mt-2 pt-2 border-t border-border-color">
                <div className="text-xs text-foreground-muted">
                    Active Filters:{' '}
                    <span className="text-accent-primary font-mono">
                        {[
                            optionType !== 'all' && optionType.toUpperCase(),
                            side !== 'all' && side.toUpperCase(),
                            selectedExpiries.length > 0 && `${selectedExpiries.length} expiries`,
                            (minStrike || maxStrike) && 'Strike',
                            (minIV || maxIV) && 'IV',
                        ]
                            .filter(Boolean)
                            .join(', ') || 'None'}
                    </span>
                </div>
            </div>
        </div>
    );
}
