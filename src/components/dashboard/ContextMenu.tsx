'use client';

import { useEffect, useRef } from 'react';
import {
    Grid,
    LineChart,
    TrendingUp,
    Activity,
    Table,
    Calculator,
    Clock,
    Filter,
    DollarSign,
    Layers,
    Search,
} from 'lucide-react';
import type { WidgetType } from '@/types';

interface ContextMenuProps {
    x: number;
    y: number;
    onAddWidget: (type: WidgetType, title: string) => void;
    onClose: () => void;
}

const menuItems: { category: string; items: { type: WidgetType; title: string; icon: React.ReactNode }[] }[] = [
    {
        category: 'Simulation',
        items: [
            { type: 'simulation-control', title: 'Time Control', icon: <Clock size={16} /> },
            { type: 'option-filter', title: 'Option Filters', icon: <Filter size={16} /> },
        ],
    },
    {
        category: 'Market Data',
        items: [
            { type: 'market-screener', title: 'Market Screener', icon: <Search size={16} /> },
            { type: 'option-chain', title: 'Option Chain', icon: <Table size={16} /> },
            { type: 'index-price', title: 'Index Price', icon: <TrendingUp size={16} /> },
        ],
    },
    {
        category: 'Options Analysis',
        items: [
            { type: 'strategy-builder', title: 'Strategy Builder', icon: <Calculator size={16} /> },
            { type: 'strategy-presets', title: 'Strategy Presets', icon: <Layers size={16} /> },
            { type: 'payoff-chart', title: 'Payoff Chart', icon: <Activity size={16} /> },
            { type: 'greeks-viz', title: 'Greeks Visualizer', icon: <Grid size={16} /> },
        ],
    },
    {
        category: 'Calculators',
        items: [
            { type: 'black-scholes', title: 'Black-Scholes', icon: <Calculator size={16} /> },
            { type: 'position-simulator', title: 'Position Simulator', icon: <DollarSign size={16} /> },
        ],
    },
];

export function ContextMenu({ x, y, onAddWidget, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="fixed z-50 bg-background-widget border border-border-color rounded-lg shadow-widget overflow-hidden min-w-[220px] max-h-[80vh] overflow-y-auto"
            style={{
                left: x,
                top: y,
            }}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-2 text-xs font-semibold text-foreground-muted uppercase tracking-wider border-b border-border-color sticky top-0 bg-background-widget">
                Add Widget
            </div>

            {menuItems.map((category) => (
                <div key={category.category}>
                    <div className="px-3 py-2 text-xs text-foreground-muted uppercase tracking-wider bg-background-tertiary">
                        {category.category}
                    </div>
                    {category.items.map((item) => (
                        <button
                            key={item.type}
                            className="w-full px-3 py-2 flex items-center gap-3 hover:bg-accent-primary/20 transition-colors text-left"
                            onClick={() => onAddWidget(item.type, item.title)}
                        >
                            <span className="text-accent-primary">{item.icon}</span>
                            <span className="text-sm text-foreground">{item.title}</span>
                        </button>
                    ))}
                </div>
            ))}
        </div>
    );
}
