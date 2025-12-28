'use client';

import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useStrategyStore } from '@/stores';
import { calculateStrategyGreeks } from '@/lib/options/blackScholes';
import type { OptionType, PositionDirection } from '@/types';

export function StrategyBuilderWidget() {
    const {
        strategies,
        activeStrategy,
        underlyingPrice,
        createStrategy,
        setActiveStrategy,
        addLeg,
        updateLeg,
        removeLeg,
        setUnderlyingPrice,
    } = useStrategyStore();

    const [newStrategyName, setNewStrategyName] = useState('');
    const [showNewForm, setShowNewForm] = useState(false);

    // Calculate aggregate Greeks for active strategy
    const strategyGreeks = activeStrategy
        ? calculateStrategyGreeks(activeStrategy, 30)
        : null;

    const handleCreateStrategy = () => {
        if (!newStrategyName.trim()) return;
        createStrategy(newStrategyName, 'BTC-USD');
        setNewStrategyName('');
        setShowNewForm(false);
    };

    const handleAddEmptyLeg = () => {
        if (!activeStrategy) return;
        addLeg(activeStrategy.id, {
            type: 'call',
            direction: 'long',
            strike: underlyingPrice,
            expiry: '2024-01-26',
            quantity: 1,
            premium: 1000,
            iv: 0.65,
        });
    };

    return (
        <div className="h-full flex flex-col text-sm">
            {/* Strategy Selector */}
            <div className="flex items-center gap-2 pb-2 border-b border-border-color mb-2">
                <select
                    value={activeStrategy?.id || ''}
                    onChange={(e) => setActiveStrategy(e.target.value || null)}
                    className="input-field text-xs py-1 flex-1"
                >
                    <option value="">-- Select Strategy --</option>
                    {strategies.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.name}
                        </option>
                    ))}
                </select>
                <button
                    onClick={() => setShowNewForm(!showNewForm)}
                    className="btn-primary p-1"
                    title="New Strategy"
                >
                    <Plus size={14} />
                </button>
            </div>

            {/* New Strategy Form */}
            {showNewForm && (
                <div className="flex gap-2 pb-2 border-b border-border-color mb-2">
                    <input
                        type="text"
                        placeholder="Strategy name..."
                        value={newStrategyName}
                        onChange={(e) => setNewStrategyName(e.target.value)}
                        className="input-field text-xs py-1 flex-1"
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateStrategy()}
                    />
                    <button onClick={handleCreateStrategy} className="btn-primary text-xs px-2">
                        Create
                    </button>
                </div>
            )}

            {/* Underlying Price */}
            <div className="flex items-center gap-2 pb-2 border-b border-border-color mb-2">
                <span className="text-xs text-foreground-muted">Underlying:</span>
                <input
                    type="number"
                    value={underlyingPrice}
                    onChange={(e) => setUnderlyingPrice(Number(e.target.value))}
                    className="input-field text-xs py-1 w-24 font-mono"
                />
            </div>

            {/* Strategy Legs */}
            <div className="flex-1 overflow-auto">
                {!activeStrategy ? (
                    <div className="text-center text-foreground-muted text-xs py-4">
                        Create or select a strategy to begin
                    </div>
                ) : activeStrategy.legs.length === 0 ? (
                    <div className="text-center text-foreground-muted text-xs py-4">
                        <p className="mb-2">No legs yet</p>
                        <p className="text-xs opacity-75">
                            Click on the Option Chain to add legs,<br />or click the button below
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {activeStrategy.legs.map((leg, index) => (
                            <div
                                key={leg.id}
                                className="bg-background-secondary rounded-lg p-2 border border-border-color"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <span
                                            className={`text-xs font-bold ${leg.direction === 'long' ? 'text-bullish' : 'text-bearish'
                                                }`}
                                        >
                                            {leg.direction === 'long' ? (
                                                <ArrowUp size={12} className="inline" />
                                            ) : (
                                                <ArrowDown size={12} className="inline" />
                                            )}
                                            {leg.direction.toUpperCase()}
                                        </span>
                                        <span
                                            className={`text-xs px-1 rounded ${leg.type === 'call'
                                                    ? 'bg-bullish/20 text-bullish'
                                                    : 'bg-bearish/20 text-bearish'
                                                }`}
                                        >
                                            {leg.type.toUpperCase()}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => removeLeg(activeStrategy.id, leg.id)}
                                        className="text-foreground-muted hover:text-bearish transition-colors"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>

                                <div className="grid grid-cols-3 gap-1 text-xs">
                                    <div>
                                        <label className="text-foreground-muted">Strike</label>
                                        <input
                                            type="number"
                                            value={leg.strike}
                                            onChange={(e) =>
                                                updateLeg(activeStrategy.id, leg.id, {
                                                    strike: Number(e.target.value),
                                                })
                                            }
                                            className="input-field py-0.5 text-xs font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-foreground-muted">Qty</label>
                                        <input
                                            type="number"
                                            value={leg.quantity}
                                            onChange={(e) =>
                                                updateLeg(activeStrategy.id, leg.id, {
                                                    quantity: Number(e.target.value),
                                                })
                                            }
                                            className="input-field py-0.5 text-xs font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-foreground-muted">Premium</label>
                                        <input
                                            type="number"
                                            value={leg.premium.toFixed(0)}
                                            onChange={(e) =>
                                                updateLeg(activeStrategy.id, leg.id, {
                                                    premium: Number(e.target.value),
                                                })
                                            }
                                            className="input-field py-0.5 text-xs font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-2 mt-1">
                                    <select
                                        value={leg.direction}
                                        onChange={(e) =>
                                            updateLeg(activeStrategy.id, leg.id, {
                                                direction: e.target.value as PositionDirection,
                                            })
                                        }
                                        className="input-field py-0.5 text-xs flex-1"
                                    >
                                        <option value="long">Long</option>
                                        <option value="short">Short</option>
                                    </select>
                                    <select
                                        value={leg.type}
                                        onChange={(e) =>
                                            updateLeg(activeStrategy.id, leg.id, {
                                                type: e.target.value as OptionType,
                                            })
                                        }
                                        className="input-field py-0.5 text-xs flex-1"
                                    >
                                        <option value="call">Call</option>
                                        <option value="put">Put</option>
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Add Leg Button */}
            {activeStrategy && (
                <button
                    onClick={handleAddEmptyLeg}
                    className="btn-primary text-xs mt-2 w-full flex items-center justify-center gap-1"
                >
                    <Plus size={12} /> Add Leg
                </button>
            )}

            {/* Aggregate Greeks */}
            {strategyGreeks && activeStrategy && activeStrategy.legs.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border-color">
                    <div className="text-xs text-foreground-muted mb-1">Position Greeks</div>
                    <div className="grid grid-cols-4 gap-1 text-xs">
                        <div className="bg-background-secondary rounded p-1 text-center">
                            <div className="text-foreground-muted">Δ</div>
                            <div className="font-mono">{strategyGreeks.delta.toFixed(2)}</div>
                        </div>
                        <div className="bg-background-secondary rounded p-1 text-center">
                            <div className="text-foreground-muted">Γ</div>
                            <div className="font-mono">{strategyGreeks.gamma.toFixed(4)}</div>
                        </div>
                        <div className="bg-background-secondary rounded p-1 text-center">
                            <div className="text-foreground-muted">Θ</div>
                            <div className="font-mono">{strategyGreeks.theta.toFixed(2)}</div>
                        </div>
                        <div className="bg-background-secondary rounded p-1 text-center">
                            <div className="text-foreground-muted">V</div>
                            <div className="font-mono">{strategyGreeks.vega.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
