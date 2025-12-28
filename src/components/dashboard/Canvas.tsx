'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    addEdge,
    useNodesState,
    useEdgesState,
    type OnConnect,
    type Node,
    type Edge,
    BackgroundVariant,
    Panel,
    ConnectionLineType,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { WidgetNode } from './WidgetNode';
import { ContextMenu } from './ContextMenu';
import type { WidgetType, WidgetConfig } from '@/types';
import { useTradesSelectionStore } from '@/stores/tradesSelection';
import { getWidgetDef } from '@/lib/widgetConfig';

// Custom node types
const nodeTypes = {
    widget: WidgetNode,
};

// Initial default nodes for demo
const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

// Custom edge styles for Thales-like appearance
const connectionLineStyle = {
    stroke: '#8b5cf6',
    strokeWidth: 3,
};

const defaultEdgeOptions = {
    style: {
        stroke: '#8b5cf6',
        strokeWidth: 3,
    },
    type: 'smoothstep', // Curved Bézier-like lines
    animated: true,
    markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 15,
        color: '#8b5cf6',
    },
};

interface DashboardCanvasProps {
    onNodeAdd?: (node: Node) => void;
}
const STORAGE_KEY = 'option-simulator-layout';

// Load initial state from localStorage
function loadSavedLayout(): { nodes: Node[]; edges: Edge[]; connections: { source: string; target: string }[] } {
    if (typeof window === 'undefined') return { nodes: [], edges: [], connections: [] };
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            return {
                nodes: data.nodes || [],
                edges: data.edges || [],
                connections: data.connections || [],
            };
        }
    } catch (e) {
        console.error('[Canvas] Failed to load saved layout:', e);
    }
    return { nodes: [], edges: [], connections: [] };
}

export function DashboardCanvas({ onNodeAdd }: DashboardCanvasProps) {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        flowX: number;
        flowY: number;
    } | null>(null);

    // Get store functions for connection management
    const { addConnection, removeConnection } = useTradesSelectionStore();

    // Track active connections for data flow
    const [connections, setConnections] = useState<{ source: string; target: string }[]>([]);

    // Load saved layout on mount
    useEffect(() => {
        const saved = loadSavedLayout();
        if (saved.nodes.length > 0) {
            setNodes(saved.nodes);
            setEdges(saved.edges);
            setConnections(saved.connections);
            // Re-register connections in store
            saved.connections.forEach(conn => {
                addConnection(conn.source, conn.target);
            });
        }
        setIsInitialized(true);
    }, []);

    // Save layout to localStorage whenever it changes
    useEffect(() => {
        if (!isInitialized) return;
        try {
            const layout = { nodes, edges, connections };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
        } catch (e) {
            console.error('[Canvas] Failed to save layout:', e);
        }
    }, [nodes, edges, connections, isInitialized]);


    // Handle edge connections - Thales style with data flow
    const onConnect: OnConnect = useCallback(
        (params) => {
            console.log('[Canvas] New connection:', params);

            // Add the visual edge
            setEdges((eds) => addEdge({
                ...params,
                ...defaultEdgeOptions,
                id: `edge-${params.source}-${params.target}`,
            }, eds));

            // Track the connection for data routing (local state for UI)
            if (params.source && params.target) {
                setConnections(prev => [...prev, {
                    source: params.source!,
                    target: params.target!,
                }]);

                // Register in the store so visualizers can query connected sources
                addConnection(params.source!, params.target!);
            }
        },
        [setEdges, addConnection]
    );

    // Handle edge deletion
    const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
        deletedEdges.forEach(edge => {
            setConnections(prev =>
                prev.filter(c => !(c.source === edge.source && c.target === edge.target))
            );
            // Also remove from store
            if (edge.source && edge.target) {
                removeConnection(edge.source, edge.target);
            }
        });
    }, [removeConnection]);

    // Handle right-click to show context menu
    const onPaneContextMenu = useCallback(
        (event: MouseEvent | React.MouseEvent) => {
            event.preventDefault();
            const bounds = reactFlowWrapper.current?.getBoundingClientRect();
            if (bounds) {
                setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    flowX: event.clientX - bounds.left,
                    flowY: event.clientY - bounds.top,
                });
            }
        },
        []
    );

    // Close context menu
    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    // Add widget from context menu
    const addWidget = useCallback(
        (type: WidgetType, title: string) => {
            if (!contextMenu) return;

            // Use centralized widget config
            const widgetDef = getWidgetDef(type);

            const widgetConfig: WidgetConfig = {
                id: crypto.randomUUID(),
                type,
                title,
            };

            const newNode: Node = {
                id: widgetConfig.id,
                type: 'widget',
                position: { x: contextMenu.flowX - 150, y: contextMenu.flowY - 100 },
                data: widgetConfig,
                style: { width: widgetDef.size.width, height: widgetDef.size.height },
            };

            setNodes((nds) => [...nds, newNode]);
            onNodeAdd?.(newNode);
            closeContextMenu();
        },
        [contextMenu, setNodes, onNodeAdd, closeContextMenu]
    );

    return (
        <div
            ref={reactFlowWrapper}
            className="w-full h-full"
            onClick={closeContextMenu}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgesDelete={onEdgesDelete}
                onPaneContextMenu={onPaneContextMenu}
                nodeTypes={nodeTypes}
                fitView
                snapToGrid
                snapGrid={[20, 20]}
                minZoom={0.1}
                maxZoom={2}
                zoomOnScroll={false}
                zoomActivationKeyCode="Control"
                panOnScroll={true}
                defaultEdgeOptions={defaultEdgeOptions}
                connectionLineType={ConnectionLineType.SmoothStep}
                connectionLineStyle={connectionLineStyle}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color="rgba(139, 92, 246, 0.15)"
                />
                <Controls
                    showZoom
                    showFitView
                    showInteractive
                    position="bottom-left"
                />
                <MiniMap
                    nodeColor={() => '#8b5cf6'}
                    maskColor="rgba(13, 11, 26, 0.8)"
                    position="bottom-right"
                />

                {/* Quick Add Panel */}
                <Panel position="top-left" className="flex gap-2">
                    <button
                        onClick={() => {
                            const id = crypto.randomUUID();
                            setNodes((nds) => [
                                ...nds,
                                {
                                    id,
                                    type: 'widget',
                                    position: { x: 50 + nodes.length * 50, y: 50 + nodes.length * 50 },
                                    data: { id, type: 'option-chain', title: 'Option Chain' },
                                },
                            ]);
                        }}
                        className="btn-primary text-sm flex items-center gap-2"
                    >
                        + Option Chain
                    </button>
                    <button
                        onClick={() => {
                            const id = crypto.randomUUID();
                            setNodes((nds) => [
                                ...nds,
                                {
                                    id,
                                    type: 'widget',
                                    position: { x: 400 + nodes.length * 50, y: 50 + nodes.length * 50 },
                                    data: { id, type: 'strategy-builder', title: 'Strategy Builder' },
                                },
                            ]);
                        }}
                        className="btn-primary text-sm flex items-center gap-2"
                    >
                        + Strategy
                    </button>
                    <button
                        onClick={() => {
                            const id = crypto.randomUUID();
                            setNodes((nds) => [
                                ...nds,
                                {
                                    id,
                                    type: 'widget',
                                    position: { x: 750 + nodes.length * 50, y: 50 + nodes.length * 50 },
                                    data: { id, type: 'payoff-chart', title: 'Payoff Chart' },
                                },
                            ]);
                        }}
                        className="btn-primary text-sm flex items-center gap-2"
                    >
                        + Payoff
                    </button>
                    <button
                        onClick={() => {
                            const id = crypto.randomUUID();
                            setNodes((nds) => [
                                ...nds,
                                {
                                    id,
                                    type: 'widget',
                                    position: { x: 1050 + nodes.length * 50, y: 50 + nodes.length * 50 },
                                    data: { id, type: 'greeks-viz', title: 'Greeks' },
                                },
                            ]);
                        }}
                        className="btn-primary text-sm flex items-center gap-2"
                    >
                        + Greeks
                    </button>
                    <button
                        onClick={() => {
                            const id = crypto.randomUUID();
                            setNodes((nds) => [
                                ...nds,
                                {
                                    id,
                                    type: 'widget',
                                    position: { x: 50 + nodes.length * 50, y: 400 + nodes.length * 50 },
                                    data: { id, type: 'market-screener', title: 'Market Screener' },
                                },
                            ]);
                        }}
                        className="btn-secondary text-sm flex items-center gap-2"
                    >
                        + Screener
                    </button>
                    <button
                        onClick={() => {
                            const id = crypto.randomUUID();
                            setNodes((nds) => [
                                ...nds,
                                {
                                    id,
                                    type: 'widget',
                                    position: { x: 400 + nodes.length * 50, y: 400 + nodes.length * 50 },
                                    data: { id, type: 'heatmap', title: 'Heatmap' },
                                },
                            ]);
                        }}
                        className="btn-secondary text-sm flex items-center gap-2"
                    >
                        + Heatmap
                    </button>
                </Panel>

                {/* Connection Info Panel */}
                {connections.length > 0 && (
                    <Panel position="top-right" className="bg-background-secondary/80 p-2 rounded text-xs">
                        <div className="text-foreground-muted mb-1">Active Connections:</div>
                        {connections.map((conn, i) => (
                            <div key={i} className="flex items-center gap-1">
                                <span className="text-accent-primary">●</span>
                                <span>{conn.source.slice(0, 8)}...</span>
                                <span className="text-foreground-muted">→</span>
                                <span>{conn.target.slice(0, 8)}...</span>
                            </div>
                        ))}
                    </Panel>
                )}
            </ReactFlow>

            {/* Context Menu */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onAddWidget={addWidget}
                    onClose={closeContextMenu}
                />
            )}
        </div>
    );
}
