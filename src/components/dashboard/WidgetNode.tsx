'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
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
    'option-chain': { width: 750, height: 500, minWidth: 500, minHeight: 350 },
    'strategy-builder': { width: 450, height: 400, minWidth: 350, minHeight: 300 },
    'payoff-chart': { width: 550, height: 400, minWidth: 400, minHeight: 300 },
    'greeks-viz': { width: 550, height: 400, minWidth: 400, minHeight: 300 },
    'simulation-control': { width: 350, height: 300, minWidth: 280, minHeight: 200 },
    'option-filter': { width: 400, height: 200, minWidth: 300, minHeight: 150 },
    'black-scholes': { width: 450, height: 500, minWidth: 350, minHeight: 400 },
    'position-simulator': { width: 500, height: 450, minWidth: 400, minHeight: 350 },
    'index-price': { width: 300, height: 180, minWidth: 250, minHeight: 150 },
    'strategy-presets': { width: 350, height: 350, minWidth: 280, minHeight: 250 },
    'market-screener': { width: 800, height: 600, minWidth: 600, minHeight: 400 },
    'heatmap': { width: 600, height: 500, minWidth: 450, minHeight: 350 },
    'default': { width: 400, height: 300, minWidth: 250, minHeight: 200 },
};

// Widgets that have output sockets (sources of data)
const widgetWithOutputSocket = ['option-chain', 'option-filter', 'market-screener', 'position-simulator'];
// Widgets that have input sockets (receive data)
const widgetWithInputSocket = ['payoff-chart', 'greeks-viz', 'heatmap'];

// Socket styles
const inputSocketStyle: React.CSSProperties = {
    background: '#22d3ee',
    width: 12,
    height: 12,
    border: '2px solid #0f1318',
};

const outputSocketStyle: React.CSSProperties = {
    background: '#a855f7',
    width: 12,
    height: 12,
    border: '2px solid #0f1318',
};

export const WidgetNode = memo(function WidgetNode({ id, data, selected }: NodeProps) {
    const widgetData = data as WidgetNodeData;
    const defaultSize = defaultWidgetSizes[widgetData.type] || defaultWidgetSizes.default;
    const { deleteElements } = useReactFlow();

    const hasOutput = widgetWithOutputSocket.includes(widgetData.type);
    const hasInput = widgetWithInputSocket.includes(widgetData.type);

    // Reset size
    const resetSize = () => {
        // Could emit an event to resize, but for now just a placeholder
    };

    // Maximize (handled by NodeResizer now)
    const maximize = () => {
        // Could emit an event to resize, but for now just a placeholder
    };

    // Delete this node
    const handleDelete = useCallback(() => {
        deleteElements({ nodes: [{ id }] });
    }, [deleteElements, id]);

    return (
        <>
            {/* Official React Flow NodeResizer */}
            <NodeResizer
                minWidth={defaultSize.minWidth}
                minHeight={defaultSize.minHeight}
                isVisible={selected}
                lineClassName="!border-cyan-500"
                handleClassName="!w-3 !h-3 !bg-cyan-500 !border-2 !border-gray-900 !rounded-sm"
            />

            <div
                className="widget-container"
                style={{
                    width: '100%',
                    height: '100%',
                    minWidth: defaultSize.minWidth,
                    minHeight: defaultSize.minHeight,
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

                {/* Widget Header - This is DRAGGABLE */}
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

                {/* Widget Content - NODRAG to allow chart interaction */}
                <div
                    className="widget-content nodrag nowheel"
                    style={{ cursor: 'default' }}
                >
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
            </div>
        </>
    );
});
