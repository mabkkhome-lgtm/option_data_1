import { create } from 'zustand';
import type { ScreenerRow } from '@/components/widgets/MarketScreener';

/**
 * Connection-aware trades selection store
 * 
 * Supports the Thales pattern where multiple screeners can feed
 * into a single visualizer through visual connections.
 * 
 * Data flow:
 * 1. MarketScreener registers its trades with a sourceId
 * 2. When a connection is made (Canvas), it links sourceId to targetId
 * 3. Visualizers get trades only from connected sources
 */

export interface TradeSource {
    sourceId: string;
    label: string;          // e.g., "Long", "Short", "Buyers", "Sellers"
    trades: ScreenerRow[];
    color?: string;         // Optional color for visualization
}

interface Connection {
    sourceId: string;   // Widget ID of the source (Market Screener)
    targetId: string;   // Widget ID of the target (Payoff/Greeks)
}

interface TradesSelectionState {
    // All sources (screeners) and their data
    sources: Map<string, TradeSource>;

    // Active connections between widgets
    connections: Connection[];

    // Combined trades from all sources (for backward compatibility)
    selectedTrades: ScreenerRow[];

    // Source actions
    setSourceTrades: (sourceId: string, label: string, trades: ScreenerRow[], color?: string) => void;
    removeSource: (sourceId: string) => void;

    // Connection actions
    addConnection: (sourceId: string, targetId: string) => void;
    removeConnection: (sourceId: string, targetId: string) => void;
    clearConnections: () => void;

    // Get trades for a specific target (visualizer)
    getTradesForTarget: (targetId: string) => ScreenerRow[];
    getSourcesForTarget: (targetId: string) => TradeSource[];

    // Legacy actions (for backward compatibility)
    setSelectedTrades: (trades: ScreenerRow[]) => void;
    addTrades: (trades: ScreenerRow[]) => void;
    removeTrades: (tradeIds: string[]) => void;
    clearSelection: () => void;
    clearAllSources: () => void;
}

export const useTradesSelectionStore = create<TradesSelectionState>((set, get) => ({
    sources: new Map(),
    connections: [],
    selectedTrades: [],

    // Set trades from a specific source with label
    setSourceTrades: (sourceId, label, trades, color) => set((state) => {
        const newSources = new Map(state.sources);
        newSources.set(sourceId, { sourceId, label, trades, color });

        // Combine all sources into selectedTrades (backward compat)
        const allTrades: ScreenerRow[] = [];
        newSources.forEach(source => {
            allTrades.push(...source.trades);
        });

        const uniqueTrades = allTrades.filter((trade, index, self) =>
            index === self.findIndex(t => t.id === trade.id)
        );

        return {
            sources: newSources,
            selectedTrades: uniqueTrades
        };
    }),

    // Remove a source
    removeSource: (sourceId) => set((state) => {
        const newSources = new Map(state.sources);
        newSources.delete(sourceId);

        // Also remove connections from this source
        const newConnections = state.connections.filter(c => c.sourceId !== sourceId);

        const allTrades: ScreenerRow[] = [];
        newSources.forEach(source => {
            allTrades.push(...source.trades);
        });

        const uniqueTrades = allTrades.filter((trade, index, self) =>
            index === self.findIndex(t => t.id === trade.id)
        );

        return {
            sources: newSources,
            connections: newConnections,
            selectedTrades: uniqueTrades
        };
    }),

    // Add a connection between source and target
    addConnection: (sourceId, targetId) => set((state) => {
        // Avoid duplicates
        const exists = state.connections.some(
            c => c.sourceId === sourceId && c.targetId === targetId
        );
        if (exists) return state;

        console.log('[Store] Adding connection:', sourceId, '->', targetId);
        return {
            connections: [...state.connections, { sourceId, targetId }]
        };
    }),

    // Remove a connection
    removeConnection: (sourceId, targetId) => set((state) => ({
        connections: state.connections.filter(
            c => !(c.sourceId === sourceId && c.targetId === targetId)
        )
    })),

    // Clear all connections
    clearConnections: () => set({ connections: [] }),

    // Get trades for a specific target (visualizer)
    getTradesForTarget: (targetId) => {
        const state = get();
        const connectedSources = state.connections
            .filter(c => c.targetId === targetId)
            .map(c => c.sourceId);

        // If no connections, return all trades (backward compat)
        if (connectedSources.length === 0) {
            return state.selectedTrades;
        }

        // Otherwise, return only trades from connected sources
        const trades: ScreenerRow[] = [];
        connectedSources.forEach(sid => {
            const source = state.sources.get(sid);
            if (source) {
                trades.push(...source.trades);
            }
        });

        // Deduplicate
        return trades.filter((trade, index, self) =>
            index === self.findIndex(t => t.id === trade.id)
        );
    },

    // Get sources for a specific target (for showing labels/colors)
    getSourcesForTarget: (targetId) => {
        const state = get();
        const connectedSources = state.connections
            .filter(c => c.targetId === targetId)
            .map(c => c.sourceId);

        // If no connections, return all sources
        if (connectedSources.length === 0) {
            return Array.from(state.sources.values());
        }

        return connectedSources
            .map(sid => state.sources.get(sid))
            .filter((s): s is TradeSource => s !== undefined);
    },

    // Legacy actions
    clearAllSources: () => set({ sources: new Map(), selectedTrades: [], connections: [] }),

    setSelectedTrades: (trades) => set((state) => {
        const newSources = new Map(state.sources);
        newSources.set('default', { sourceId: 'default', label: 'Default', trades });
        return {
            sources: newSources,
            selectedTrades: trades
        };
    }),

    addTrades: (trades) => set((state) => ({
        selectedTrades: [...state.selectedTrades, ...trades.filter(
            t => !state.selectedTrades.some(st => st.id === t.id)
        )]
    })),

    removeTrades: (tradeIds) => set((state) => ({
        selectedTrades: state.selectedTrades.filter(t => !tradeIds.includes(t.id))
    })),

    clearSelection: () => set({ selectedTrades: [], sources: new Map(), connections: [] }),
}));
