// Zustand Store for Options Strategy Builder
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Strategy, OptionLeg, Workspace, DashboardNode, DashboardEdge } from '@/types';

// Strategy Store
interface StrategyState {
    strategies: Strategy[];
    activeStrategy: Strategy | null;
    underlyingPrice: number;

    // Actions
    setUnderlyingPrice: (price: number) => void;
    createStrategy: (name: string, underlying: string) => Strategy;
    setActiveStrategy: (id: string | null) => void;
    addLeg: (strategyId: string, leg: Omit<OptionLeg, 'id'>) => void;
    updateLeg: (strategyId: string, legId: string, updates: Partial<OptionLeg>) => void;
    removeLeg: (strategyId: string, legId: string) => void;
    deleteStrategy: (id: string) => void;
}

export const useStrategyStore = create<StrategyState>()(
    persist(
        (set, get) => ({
            strategies: [],
            activeStrategy: null,
            underlyingPrice: 100000, // Default BTC price

            setUnderlyingPrice: (price) => {
                set({ underlyingPrice: price });
                // Update active strategy's underlying price
                const { activeStrategy, strategies } = get();
                if (activeStrategy) {
                    const updated = strategies.map(s =>
                        s.id === activeStrategy.id ? { ...s, underlyingPrice: price } : s
                    );
                    set({
                        strategies: updated,
                        activeStrategy: { ...activeStrategy, underlyingPrice: price }
                    });
                }
            },

            createStrategy: (name, underlying) => {
                const newStrategy: Strategy = {
                    id: crypto.randomUUID(),
                    name,
                    underlying,
                    underlyingPrice: get().underlyingPrice,
                    legs: [],
                    createdAt: new Date(),
                };
                set(state => ({
                    strategies: [...state.strategies, newStrategy],
                    activeStrategy: newStrategy,
                }));
                return newStrategy;
            },

            setActiveStrategy: (id) => {
                if (!id) {
                    set({ activeStrategy: null });
                    return;
                }
                const strategy = get().strategies.find(s => s.id === id);
                set({ activeStrategy: strategy || null });
            },

            addLeg: (strategyId, leg) => {
                const newLeg: OptionLeg = { ...leg, id: crypto.randomUUID() };
                set(state => {
                    const updated = state.strategies.map(s =>
                        s.id === strategyId ? { ...s, legs: [...s.legs, newLeg] } : s
                    );
                    const activeUpdated = state.activeStrategy?.id === strategyId
                        ? { ...state.activeStrategy, legs: [...state.activeStrategy.legs, newLeg] }
                        : state.activeStrategy;
                    return { strategies: updated, activeStrategy: activeUpdated };
                });
            },

            updateLeg: (strategyId, legId, updates) => {
                set(state => {
                    const updated = state.strategies.map(s =>
                        s.id === strategyId
                            ? { ...s, legs: s.legs.map(l => l.id === legId ? { ...l, ...updates } : l) }
                            : s
                    );
                    const strategy = updated.find(s => s.id === strategyId);
                    return {
                        strategies: updated,
                        activeStrategy: state.activeStrategy?.id === strategyId ? strategy! : state.activeStrategy
                    };
                });
            },

            removeLeg: (strategyId, legId) => {
                set(state => {
                    const updated = state.strategies.map(s =>
                        s.id === strategyId
                            ? { ...s, legs: s.legs.filter(l => l.id !== legId) }
                            : s
                    );
                    const strategy = updated.find(s => s.id === strategyId);
                    return {
                        strategies: updated,
                        activeStrategy: state.activeStrategy?.id === strategyId ? strategy! : state.activeStrategy
                    };
                });
            },

            deleteStrategy: (id) => {
                set(state => ({
                    strategies: state.strategies.filter(s => s.id !== id),
                    activeStrategy: state.activeStrategy?.id === id ? null : state.activeStrategy,
                }));
            },
        }),
        { name: 'oss-strategies' }
    )
);

// Workspace/Dashboard Store
interface WorkspaceState {
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
    nodes: DashboardNode[];
    edges: DashboardEdge[];

    // Actions
    createWorkspace: (name: string) => Workspace;
    setActiveWorkspace: (id: string) => void;
    saveWorkspace: () => void;
    deleteWorkspace: (id: string) => void;
    setNodes: (nodes: DashboardNode[]) => void;
    setEdges: (edges: DashboardEdge[]) => void;
    addNode: (node: DashboardNode) => void;
    removeNode: (nodeId: string) => void;
    updateNodeData: (nodeId: string, data: Partial<DashboardNode['data']>) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
    persist(
        (set, get) => ({
            workspaces: [],
            activeWorkspaceId: null,
            nodes: [],
            edges: [],

            createWorkspace: (name) => {
                const newWorkspace: Workspace = {
                    id: crypto.randomUUID(),
                    name,
                    nodes: [],
                    edges: [],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                set(state => ({
                    workspaces: [...state.workspaces, newWorkspace],
                    activeWorkspaceId: newWorkspace.id,
                    nodes: [],
                    edges: [],
                }));
                return newWorkspace;
            },

            setActiveWorkspace: (id) => {
                const workspace = get().workspaces.find(w => w.id === id);
                if (workspace) {
                    set({
                        activeWorkspaceId: id,
                        nodes: workspace.nodes,
                        edges: workspace.edges,
                    });
                }
            },

            saveWorkspace: () => {
                const { activeWorkspaceId, nodes, edges, workspaces } = get();
                if (!activeWorkspaceId) return;

                const updated = workspaces.map(w =>
                    w.id === activeWorkspaceId
                        ? { ...w, nodes, edges, updatedAt: new Date() }
                        : w
                );
                set({ workspaces: updated });
            },

            deleteWorkspace: (id) => {
                set(state => ({
                    workspaces: state.workspaces.filter(w => w.id !== id),
                    activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
                    nodes: state.activeWorkspaceId === id ? [] : state.nodes,
                    edges: state.activeWorkspaceId === id ? [] : state.edges,
                }));
            },

            setNodes: (nodes) => set({ nodes }),
            setEdges: (edges) => set({ edges }),

            addNode: (node) => set(state => ({ nodes: [...state.nodes, node] })),

            removeNode: (nodeId) => set(state => ({
                nodes: state.nodes.filter(n => n.id !== nodeId),
                edges: state.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
            })),

            updateNodeData: (nodeId, data) => set(state => ({
                nodes: state.nodes.map(n =>
                    n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
                ),
            })),
        }),
        { name: 'oss-workspaces' }
    )
);

// Market Data Store (for real-time updates)
interface MarketState {
    prices: Record<string, number>;
    optionChains: Record<string, unknown>;
    isConnected: boolean;

    setPrice: (symbol: string, price: number) => void;
    setOptionChain: (key: string, chain: unknown) => void;
    setConnected: (connected: boolean) => void;
}

export const useMarketStore = create<MarketState>()((set) => ({
    prices: {},
    optionChains: {},
    isConnected: false,

    setPrice: (symbol, price) => set(state => ({
        prices: { ...state.prices, [symbol]: price }
    })),

    setOptionChain: (key, chain) => set(state => ({
        optionChains: { ...state.optionChains, [key]: chain }
    })),

    setConnected: (connected) => set({ isConnected: connected }),
}));
