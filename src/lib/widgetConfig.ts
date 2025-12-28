/**
 * Centralized Widget Configuration
 * 
 * All widget types, sizes, and settings in one place
 */

export interface WidgetSize {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
}

export interface WidgetDef {
    type: string;
    title: string;
    size: WidgetSize;
    hasInput: boolean;
    hasOutput: boolean;
}

// Widget definitions with proper sizes
export const WIDGET_DEFS: Record<string, WidgetDef> = {
    'market-screener': {
        type: 'market-screener',
        title: 'Market Screener',
        size: { width: 800, height: 500, minWidth: 500, minHeight: 350 },
        hasInput: false,
        hasOutput: true,
    },
    'greeks-viz': {
        type: 'greeks-viz',
        title: 'Greeks Visualizer',
        size: { width: 550, height: 380, minWidth: 400, minHeight: 280 },
        hasInput: true,
        hasOutput: false,
    },
    'payoff-chart': {
        type: 'payoff-chart',
        title: 'Payoff Chart',
        size: { width: 550, height: 380, minWidth: 400, minHeight: 280 },
        hasInput: true,
        hasOutput: false,
    },
    'heatmap': {
        type: 'heatmap',
        title: 'Heatmap',
        size: { width: 600, height: 450, minWidth: 400, minHeight: 300 },
        hasInput: true,
        hasOutput: false,
    },
    'option-chain': {
        type: 'option-chain',
        title: 'Option Chain',
        size: { width: 700, height: 450, minWidth: 500, minHeight: 350 },
        hasInput: false,
        hasOutput: true,
    },
    'strategy-builder': {
        type: 'strategy-builder',
        title: 'Strategy Builder',
        size: { width: 400, height: 320, minWidth: 300, minHeight: 250 },
        hasInput: false,
        hasOutput: false,
    },
    'black-scholes': {
        type: 'black-scholes',
        title: 'Black-Scholes',
        size: { width: 400, height: 450, minWidth: 300, minHeight: 350 },
        hasInput: false,
        hasOutput: false,
    },
    'simulation-control': {
        type: 'simulation-control',
        title: 'Simulation Control',
        size: { width: 350, height: 280, minWidth: 280, minHeight: 200 },
        hasInput: false,
        hasOutput: false,
    },
    'option-filter': {
        type: 'option-filter',
        title: 'Option Filter',
        size: { width: 400, height: 200, minWidth: 300, minHeight: 150 },
        hasInput: false,
        hasOutput: true,
    },
    'position-simulator': {
        type: 'position-simulator',
        title: 'Position Simulator',
        size: { width: 500, height: 400, minWidth: 400, minHeight: 300 },
        hasInput: false,
        hasOutput: true,
    },
    'index-price': {
        type: 'index-price',
        title: 'Index Price',
        size: { width: 300, height: 150, minWidth: 250, minHeight: 120 },
        hasInput: false,
        hasOutput: false,
    },
    'strategy-presets': {
        type: 'strategy-presets',
        title: 'Strategy Presets',
        size: { width: 350, height: 320, minWidth: 280, minHeight: 250 },
        hasInput: false,
        hasOutput: false,
    },
};

// Default size for unknown widgets
export const DEFAULT_WIDGET_SIZE: WidgetSize = {
    width: 400,
    height: 300,
    minWidth: 250,
    minHeight: 200,
};

// Get widget definition
export function getWidgetDef(type: string): WidgetDef {
    return WIDGET_DEFS[type] || {
        type,
        title: type,
        size: DEFAULT_WIDGET_SIZE,
        hasInput: false,
        hasOutput: false,
    };
}
