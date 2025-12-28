'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { Grip, X, Maximize2, Minimize2 } from 'lucide-react';
import type { WidgetConfig } from '@/types';

import { OptionChainWidget } from '../widgets/OptionChain';
import { StrategyBuilderWidget } from '../widgets/StrategyBuilder';
import { PayoffChartWidget } from '../widgets/PayoffChart';
import { GreeksVizWidget } from '../widgets/GreeksViz';
import { SimulationControlWidget } from '../widgets/SimulationControl';
import { OptionFilterWidget } from '../widgets/OptionFilter';
import { BlackScholesWidget } from '../widgets/BlackScholes';
import { PositionSimulatorWidget } from '../widgets/PositionSimulator';
import { IndexPriceWidget } from '../widgets/IndexPrice';
import { StrategyPresetsWidget } from '../widgets/StrategyPresets';
import { MarketScreenerWidget } from '../widgets/MarketScreener';
import { HeatmapWidget } from '../widgets/Heatmap';

interface WidgetNodeData extends WidgetConfig {
    expanded?: boolean;
}

const WidgetComponent = memo(function WidgetComponent({ type, widgetId }: { type: string; widgetId: string }) {
    switch (type) {
        case 'option-chain':
            return <OptionChainWidget />;
        case 'strategy-builder':
            return <StrategyBuilderWidget />;
        case 'payoff-chart':
            return <PayoffChartWidget widgetId={widgetId} />;
        case 'greeks-viz':
            return <GreeksVizWidget widgetId={widgetId} />;
        case 'simulation-control':
            return <SimulationControlWidget />;
        case 'option-filter':
            return <OptionFilterWidget />;
        case 'black-scholes':
            return <BlackScholesWidget />;
        case 'position-simulator':
            return <PositionSimulatorWidget />;
        case 'index-price':
            return <IndexPriceWidget />;
        case 'strategy-presets':
            return <StrategyPresetsWidget />;
        case 'market-screener':
            return <MarketScreenerWidget widgetId={widgetId} />;
        case 'heatmap':
            return <HeatmapWidget />;
        default:
            return (
                <div className="text-foreground-muted text-sm p-4 text-center">
                    Widget: {type}
                </div>
            );
    }
});

// Default widget sizes
const defaultWidgetSizes: Record<string, { width: number; height: number; minWidth: number; minHeight: number }> = {
    'option-chain': { width: 600, height: 400, minWidth: 400, minHeight: 300 },
    'strategy-builder': { width: 420, height: 450, minWidth: 350, minHeight: 350 },
    'payoff-chart': { width: 600, height: 450, minWidth: 400, minHeight: 350 },
    'greeks-viz': { width: 600, height: 450, minWidth: 400, minHeight: 350 },
    'simulation-control': { width: 380, height: 380, minWidth: 300, minHeight: 300 },
    'option-filter': { width: 320, height: 480, minWidth: 280, minHeight: 300 },
    'black-scholes': { width: 380, height: 520, minWidth: 320, minHeight: 400 },
    'position-simulator': { width: 400, height: 520, minWidth: 320, minHeight: 400 },
    'index-price': { width: 320, height: 320, minWidth: 250, minHeight: 250 },
    'strategy-presets': { width: 360, height: 500, minWidth: 300, minHeight: 350 },
    'market-screener': { width: 900, height: 550, minWidth: 600, minHeight: 400 },
    'heatmap': { width: 550, height: 450, minWidth: 400, minHeight: 350 },
    default: { width: 400, height: 350, minWidth: 300, minHeight: 250 },
};

// Define which widgets have output/input sockets
const widgetWithOutputSocket = ['market-screener', 'option-chain', 'strategy-builder'];
const widgetWithInputSocket = ['payoff-chart', 'greeks-viz'];

// Socket styles
const outputSocketStyle = {
    width: 12,
    height: 12,
    background: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
    border: '2px solid #1a1625',
    boxShadow: '0 0 10px rgba(139, 92, 246, 0.5)',
};

const inputSocketStyle = {
    width: 12,
    height: 12,
    background: 'linear-gradient(135deg, #06b6d4, #22d3ee)',
    border: '2px solid #1a1625',
    boxShadow: '0 0 10px rgba(6, 182, 212, 0.5)',
};

export const WidgetNode = memo(function WidgetNode({ data, id }: NodeProps) {
    const widgetData = data as WidgetNodeData;
    const defaultSize = defaultWidgetSizes[widgetData.type] || defaultWidgetSizes.default;
    const { deleteElements } = useReactFlow();

    const [width, setWidth] = useState(defaultSize.width);
    const [height, setHeight] = useState(defaultSize.height);
    const [isResizing, setIsResizing] = useState(false);

    const hasOutput = widgetWithOutputSocket.includes(widgetData.type);
    const hasInput = widgetWithInputSocket.includes(widgetData.type);

    // Ref for the widget container
    const containerRef = useRef<HTMLDivElement>(null);

    // Note: We no longer block wheel events here - let charts handle their own zoom
    // React Flow canvas zoom is controlled separately via the Canvas component

    // Handle resize
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);

        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = width;
        const startHeight = height;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(defaultSize.minWidth, startWidth + (moveEvent.clientX - startX));
            const newHeight = Math.max(defaultSize.minHeight, startHeight + (moveEvent.clientY - startY));
            setWidth(newWidth);
            setHeight(newHeight);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [width, height, defaultSize.minWidth, defaultSize.minHeight]);

    // Reset size
    const resetSize = () => {
        setWidth(defaultSize.width);
        setHeight(defaultSize.height);
    };

    // Maximize
    const maximize = () => {
        setWidth(defaultSize.width * 1.5);
        setHeight(defaultSize.height * 1.5);
    };

    // Delete this node
    const handleDelete = useCallback(() => {
        deleteElements({ nodes: [{ id }] });
    }, [deleteElements, id]);

    return (
        <div
            ref={containerRef}
            className={`widget-container relative ${isResizing ? 'select-none' : ''}`}
            style={{
                width,
                height,
            }}
        >
            {/* Input Socket (Left side) */}
            {hasInput && (
                <Handle
                    type="target"
                    position={Position.Left}
                    id="input"
                    style={{
                        ...inputSocketStyle,
                        top: '50%',
                        transform: 'translateY(-50%)',
                    }}
                    className="input-socket"
                    isConnectable={true}
                />
            )}

            {/* Widget Header */}
            <div className="widget-header">
                <div className="flex items-center gap-2">
                    <Grip size={14} className="text-foreground-muted cursor-grab active:cursor-grabbing" />
                    <span className="widget-title">{widgetData.title}</span>
                    {hasOutput && (
                        <span className="text-xs px-1.5 py-0.5 bg-accent-primary/20 text-accent-primary rounded">
                            OUT
                        </span>
                    )}
                    {hasInput && (
                        <span className="text-xs px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 rounded">
                            IN
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        className="p-1 hover:bg-background-secondary rounded transition-colors"
                        onClick={resetSize}
                        title="Reset Size"
                    >
                        <Minimize2 size={12} className="text-foreground-muted" />
                    </button>
                    <button
                        className="p-1 hover:bg-background-secondary rounded transition-colors"
                        onClick={maximize}
                        title="Maximize"
                    >
                        <Maximize2 size={12} className="text-foreground-muted" />
                    </button>
                    <button
                        className="p-1 hover:bg-red-500/20 rounded transition-colors"
                        onClick={handleDelete}
                        title="Close Widget"
                    >
                        <X size={12} className="text-foreground-muted hover:text-red-400" />
                    </button>
                </div>
            </div>

            {/* Widget Content */}
            <div className="widget-content">
                <WidgetComponent type={widgetData.type} widgetId={id} />
            </div>

            {/* Output Socket (Right side) */}
            {hasOutput && (
                <Handle
                    type="source"
                    position={Position.Right}
                    id="output"
                    style={{
                        ...outputSocketStyle,
                        top: '50%',
                        transform: 'translateY(-50%)',
                    }}
                    className="output-socket"
                    isConnectable={true}
                />
            )}

            {/* RESIZE HANDLE - Bottom Right Corner - Made bigger and more visible */}
            <div
                className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-50 group
                           hover:bg-accent-primary/20 rounded-tl-lg transition-colors"
                onMouseDown={handleResizeStart}
            >
                <svg
                    className="w-4 h-4 absolute bottom-1 right-1 text-gray-500/50 group-hover:text-cyan-400 transition-colors"
                    viewBox="0 0 10 10"
                    fill="currentColor"
                >
                    <path d="M9 0v9H0" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M9 4v5H4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
            </div>

            {/* Additional resize handles on edges for easier resizing */}
            {/* Right edge */}
            <div
                className="absolute top-0 right-0 w-2 h-full cursor-ew-resize z-40 hover:bg-cyan-400/20"
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startWidth = width;
                    const handleMove = (moveE: MouseEvent) => {
                        setWidth(Math.max(defaultSize.minWidth, startWidth + (moveE.clientX - startX)));
                    };
                    const handleUp = () => {
                        document.removeEventListener('mousemove', handleMove);
                        document.removeEventListener('mouseup', handleUp);
                    };
                    document.addEventListener('mousemove', handleMove);
                    document.addEventListener('mouseup', handleUp);
                }}
            />

            {/* Bottom edge */}
            <div
                className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize z-40 hover:bg-cyan-400/20"
                onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const startY = e.clientY;
                    const startHeight = height;
                    const handleMove = (moveE: MouseEvent) => {
                        setHeight(Math.max(defaultSize.minHeight, startHeight + (moveE.clientY - startY)));
                    };
                    const handleUp = () => {
                        document.removeEventListener('mousemove', handleMove);
                        document.removeEventListener('mouseup', handleUp);
                    };
                    document.addEventListener('mousemove', handleMove);
                    document.addEventListener('mouseup', handleUp);
                }}
            />

            {/* Size indicator while resizing */}
            {isResizing && (
                <div className="absolute bottom-1 left-1 text-[10px] bg-background-secondary/90 px-1.5 py-0.5 rounded text-foreground-muted font-mono">
                    {Math.round(width)} × {Math.round(height)}
                </div>
            )}
        </div>
    );
});
