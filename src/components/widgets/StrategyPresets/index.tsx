'use client';

import { Layers, Plus, Info } from 'lucide-react';
import { useStrategyStore } from '@/stores';

interface StrategyPreset {
    id: string;
    name: string;
    description: string;
    legs: {
        type: 'call' | 'put';
        direction: 'long' | 'short';
        strikeOffset: number; // Offset from ATM (e.g., -5000, 0, +5000)
        quantity: number;
    }[];
    category: 'bullish' | 'bearish' | 'neutral' | 'volatility';
}

const STRATEGY_PRESETS: StrategyPreset[] = [
    // Bullish
    {
        id: 'long-call',
        name: 'Long Call',
        description: 'Profit from price increase with limited downside',
        category: 'bullish',
        legs: [{ type: 'call', direction: 'long', strikeOffset: 0, quantity: 1 }],
    },
    {
        id: 'bull-call-spread',
        name: 'Bull Call Spread',
        description: 'Limited risk bullish strategy',
        category: 'bullish',
        legs: [
            { type: 'call', direction: 'long', strikeOffset: 0, quantity: 1 },
            { type: 'call', direction: 'short', strikeOffset: 5000, quantity: 1 },
        ],
    },
    {
        id: 'covered-call',
        name: 'Covered Call',
        description: 'Generate income on held position',
        category: 'bullish',
        legs: [{ type: 'call', direction: 'short', strikeOffset: 5000, quantity: 1 }],
    },
    // Bearish
    {
        id: 'long-put',
        name: 'Long Put',
        description: 'Profit from price decrease with limited downside',
        category: 'bearish',
        legs: [{ type: 'put', direction: 'long', strikeOffset: 0, quantity: 1 }],
    },
    {
        id: 'bear-put-spread',
        name: 'Bear Put Spread',
        description: 'Limited risk bearish strategy',
        category: 'bearish',
        legs: [
            { type: 'put', direction: 'long', strikeOffset: 0, quantity: 1 },
            { type: 'put', direction: 'short', strikeOffset: -5000, quantity: 1 },
        ],
    },
    // Neutral
    {
        id: 'iron-condor',
        name: 'Iron Condor',
        description: 'Profit from low volatility, range-bound price',
        category: 'neutral',
        legs: [
            { type: 'put', direction: 'short', strikeOffset: -5000, quantity: 1 },
            { type: 'put', direction: 'long', strikeOffset: -10000, quantity: 1 },
            { type: 'call', direction: 'short', strikeOffset: 5000, quantity: 1 },
            { type: 'call', direction: 'long', strikeOffset: 10000, quantity: 1 },
        ],
    },
    {
        id: 'butterfly',
        name: 'Butterfly',
        description: 'Profit from price staying near strike',
        category: 'neutral',
        legs: [
            { type: 'call', direction: 'long', strikeOffset: -5000, quantity: 1 },
            { type: 'call', direction: 'short', strikeOffset: 0, quantity: 2 },
            { type: 'call', direction: 'long', strikeOffset: 5000, quantity: 1 },
        ],
    },
    {
        id: 'iron-butterfly',
        name: 'Iron Butterfly',
        description: 'Neutral strategy with defined risk',
        category: 'neutral',
        legs: [
            { type: 'put', direction: 'long', strikeOffset: -5000, quantity: 1 },
            { type: 'put', direction: 'short', strikeOffset: 0, quantity: 1 },
            { type: 'call', direction: 'short', strikeOffset: 0, quantity: 1 },
            { type: 'call', direction: 'long', strikeOffset: 5000, quantity: 1 },
        ],
    },
    // Volatility
    {
        id: 'straddle',
        name: 'Long Straddle',
        description: 'Profit from large price movement in either direction',
        category: 'volatility',
        legs: [
            { type: 'call', direction: 'long', strikeOffset: 0, quantity: 1 },
            { type: 'put', direction: 'long', strikeOffset: 0, quantity: 1 },
        ],
    },
    {
        id: 'strangle',
        name: 'Long Strangle',
        description: 'Cheaper alternative to straddle',
        category: 'volatility',
        legs: [
            { type: 'call', direction: 'long', strikeOffset: 5000, quantity: 1 },
            { type: 'put', direction: 'long', strikeOffset: -5000, quantity: 1 },
        ],
    },
    {
        id: 'short-straddle',
        name: 'Short Straddle',
        description: 'Profit from low volatility',
        category: 'volatility',
        legs: [
            { type: 'call', direction: 'short', strikeOffset: 0, quantity: 1 },
            { type: 'put', direction: 'short', strikeOffset: 0, quantity: 1 },
        ],
    },
];

const CATEGORY_COLORS = {
    bullish: 'bg-bullish/20 text-bullish border-bullish',
    bearish: 'bg-bearish/20 text-bearish border-bearish',
    neutral: 'bg-blue-500/20 text-blue-400 border-blue-500',
    volatility: 'bg-purple-500/20 text-purple-400 border-purple-500',
};

const CATEGORY_LABELS = {
    bullish: '↑ Bullish',
    bearish: '↓ Bearish',
    neutral: '↔ Neutral',
    volatility: '⚡ Volatility',
};

export function StrategyPresetsWidget() {
    const { createStrategy, addLeg, underlyingPrice, setActiveStrategy } = useStrategyStore();

    const applyPreset = (preset: StrategyPreset) => {
        // Create new strategy with preset name
        const strategy = createStrategy(`${preset.name} Strategy`, 'BTC-USD');

        // Add all legs with calculated strikes
        preset.legs.forEach((legTemplate) => {
            addLeg(strategy.id, {
                type: legTemplate.type,
                direction: legTemplate.direction,
                strike: underlyingPrice + legTemplate.strikeOffset,
                expiry: getDefaultExpiry(),
                quantity: legTemplate.quantity,
                premium: estimatePremium(legTemplate, underlyingPrice),
                iv: 0.65,
            });
        });

        // Set as active
        setActiveStrategy(strategy.id);
    };

    const getDefaultExpiry = () => {
        const date = new Date();
        date.setDate(date.getDate() + 30);
        return date.toISOString().split('T')[0];
    };

    const estimatePremium = (leg: StrategyPreset['legs'][0], underlying: number) => {
        // Rough premium estimate based on moneyness
        const strike = underlying + leg.strikeOffset;
        const moneyness = leg.type === 'call'
            ? underlying / strike
            : strike / underlying;

        // Base premium as % of underlying
        const basePercent = 0.05;
        const premium = underlying * basePercent * Math.max(0.3, moneyness);

        return Math.round(premium);
    };

    return (
        <div className="h-full flex flex-col text-sm overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border-color mb-3">
                <div className="flex items-center gap-2">
                    <Layers size={14} className="text-accent-primary" />
                    <span className="text-xs font-semibold text-foreground">STRATEGY PRESETS</span>
                </div>
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 p-2 bg-accent-primary/10 rounded-lg mb-3 text-xs">
                <Info size={14} className="text-accent-primary mt-0.5 shrink-0" />
                <p className="text-foreground-muted">
                    Click a preset to create a new strategy with pre-configured legs.
                    Strikes are based on current underlying price (${underlyingPrice.toLocaleString()}).
                </p>
            </div>

            {/* Categories */}
            <div className="space-y-3">
                {(['bullish', 'bearish', 'neutral', 'volatility'] as const).map((category) => (
                    <div key={category}>
                        <div className={`text-xs font-semibold px-2 py-1 rounded mb-2 ${CATEGORY_COLORS[category]}`}>
                            {CATEGORY_LABELS[category]}
                        </div>
                        <div className="space-y-1">
                            {STRATEGY_PRESETS.filter((p) => p.category === category).map((preset) => (
                                <button
                                    key={preset.id}
                                    onClick={() => applyPreset(preset)}
                                    className="w-full p-2 bg-background-secondary hover:bg-background-tertiary rounded-lg transition-colors text-left group"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium text-foreground">{preset.name}</span>
                                        <Plus size={14} className="text-foreground-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                    <div className="text-xs text-foreground-muted mt-0.5">{preset.description}</div>
                                    <div className="flex gap-1 mt-1.5 flex-wrap">
                                        {preset.legs.map((leg, i) => (
                                            <span
                                                key={i}
                                                className={`text-xs px-1.5 py-0.5 rounded ${leg.direction === 'long'
                                                    ? leg.type === 'call'
                                                        ? 'bg-bullish/20 text-bullish'
                                                        : 'bg-bearish/20 text-bearish'
                                                    : 'bg-foreground-muted/20 text-foreground-muted'
                                                    }`}
                                            >
                                                {leg.direction === 'short' ? '-' : '+'}
                                                {leg.quantity} {leg.type.charAt(0).toUpperCase()}
                                                {leg.strikeOffset !== 0 && ` ${leg.strikeOffset > 0 ? '+' : ''}${leg.strikeOffset / 1000}k`}
                                            </span>
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
