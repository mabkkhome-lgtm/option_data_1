'use client';

import { memo, useCallback, useState, useEffect } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { Rnd } from 'react-rnd';
import { Grip, X } from 'lucide-react';
import type { WidgetConfig } from '@/types';
import { getWidgetDef } from '@/lib/widgetConfig';

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
    const widgetDef = getWidgetDef(widgetData.type);
    const { deleteElements, updateNode } = useReactFlow();

    const [size, setSize] = useState({
        width: widgetDef.size.width,
        height: widgetDef.size.height,
    });

    // Delete this node
    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        deleteElements({ nodes: [{ id }] });
    }, [deleteElements, id]);

    // Stop all events from bubbling to React Flow
    const stopPropagation = useCallback((e: React.MouseEvent | React.WheelEvent) => {
        e.stopPropagation();
    }, []);

    return (
        <div
            className={`widget-container ${selected ? 'ring-2 ring-cyan-500' : ''}`}
            style={{
                width: size.width,
                height: size.height,
            }}
        >
            {/* Input Socket (Left side) */}
            {widgetDef.hasInput && (
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

            {/* Widget Header - DRAGGABLE */}
            <div className="widget-header">
                <div className="flex items-center gap-2">
                    <Grip size={14} className="text-foreground-muted cursor-grab active:cursor-grabbing" />
                    <span className="widget-title">{widgetData.title}</span>
                    {widgetDef.hasOutput && (
                        <span className="text-xs px-1.5 py-0.5 bg-accent-primary/20 text-accent-primary rounded">
                            OUT
                        </span>
                    )}
                    {widgetDef.hasInput && (
                        <span className="text-xs px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 rounded">
                            IN
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        className="p-1 hover:bg-red-500/20 rounded transition-colors nodrag"
                        onClick={handleDelete}
                        title="Close Widget"
                    >
                        <X size={12} className="text-foreground-muted hover:text-red-400" />
                    </button>
                </div>
            </div>

            {/* Widget Content - Blocks events from bubbling */}
            <div
                className="widget-content nodrag"
                onMouseDown={stopPropagation}
                onWheel={stopPropagation}
                style={{ cursor: 'default' }}
            >
                <WidgetComponent type={widgetData.type} widgetId={id} />
            </div>

            {/* Output Socket (Right side) */}
            {widgetDef.hasOutput && (
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

            {/* Resize Handle - Bottom Right */}
            <div
                className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize nodrag"
                style={{
                    background: 'linear-gradient(135deg, transparent 50%, rgba(88,166,255,0.5) 50%)',
                    borderRadius: '0 0 4px 0',
                }}
                onMouseDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startWidth = size.width;
                    const startHeight = size.height;

                    const handleMouseMove = (moveEvent: MouseEvent) => {
                        const newWidth = Math.max(widgetDef.size.minWidth, startWidth + moveEvent.clientX - startX);
                        const newHeight = Math.max(widgetDef.size.minHeight, startHeight + moveEvent.clientY - startY);
                        setSize({ width: newWidth, height: newHeight });
                        // Dispatch resize event to notify charts
                        window.dispatchEvent(new Event('resize'));
                    };

                    const handleMouseUp = () => {
                        document.removeEventListener('mousemove', handleMouseMove);
                        document.removeEventListener('mouseup', handleMouseUp);
                    };

                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                }}
            />
        </div>
    );
});
