'use client';

import React, { useState } from 'react';
import {
    MousePointer2,
    TrendingUp,
    Minus,
    ArrowRight,
    Circle,
    Square,
    Triangle,
    Percent,
    Hash,
    Type,
    Eraser,
    Crosshair,
    MoveHorizontal,
    MoveVertical,
    GitBranch,
    Waves,
    Target,
    Ruler,
    Clock,
    ArrowUpRight,
    PenLine,
    Spline,
    ChevronDown,
    Scissors,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    Trash2,
    Settings,
    MoreHorizontal
} from 'lucide-react';

// TradingView-style drawing tools organized by category
export type DrawingTool =
    // Cursor/Selection
    | 'cursor' | 'crosshair'
    // Lines
    | 'trendline' | 'ray' | 'extended' | 'horizontal' | 'vertical' | 'parallel' | 'arrow'
    // Fibonacci
    | 'fib-retracement' | 'fib-extension' | 'fib-channel' | 'fib-circles' | 'fib-spiral' | 'fib-timezone'
    // Gann & Pitchfork
    | 'pitchfork' | 'gann-fan' | 'gann-square'
    // Shapes
    | 'rectangle' | 'circle' | 'ellipse' | 'triangle' | 'arc'
    // Patterns
    | 'head-shoulders' | 'abcd' | 'xabcd' | 'three-drives' | 'elliott-wave'
    // Annotations
    | 'text' | 'callout' | 'price-label' | 'arrow-marker' | 'price-range' | 'date-range'
    // Measurements
    | 'measure' | 'long-position' | 'short-position'
    // Brushes
    | 'brush' | 'highlighter';

interface ToolCategory {
    id: string;
    name: string;
    icon: React.ReactNode;
    tools: { id: DrawingTool; name: string; icon: React.ReactNode }[];
}

const TOOL_CATEGORIES: ToolCategory[] = [
    {
        id: 'cursor',
        name: 'Cursor',
        icon: <MousePointer2 size={18} />,
        tools: [
            { id: 'cursor', name: 'Cursor', icon: <MousePointer2 size={16} /> },
            { id: 'crosshair', name: 'Crosshair', icon: <Crosshair size={16} /> },
        ]
    },
    {
        id: 'lines',
        name: 'Trend Lines',
        icon: <TrendingUp size={18} />,
        tools: [
            { id: 'trendline', name: 'Trend Line', icon: <TrendingUp size={16} /> },
            { id: 'ray', name: 'Ray', icon: <ArrowRight size={16} /> },
            { id: 'extended', name: 'Extended Line', icon: <Minus size={16} /> },
            { id: 'horizontal', name: 'Horizontal Line', icon: <MoveHorizontal size={16} /> },
            { id: 'vertical', name: 'Vertical Line', icon: <MoveVertical size={16} /> },
            { id: 'parallel', name: 'Parallel Channel', icon: <GitBranch size={16} /> },
            { id: 'arrow', name: 'Arrow', icon: <ArrowUpRight size={16} /> },
        ]
    },
    {
        id: 'fibonacci',
        name: 'Fibonacci',
        icon: <Percent size={18} />,
        tools: [
            { id: 'fib-retracement', name: 'Fib Retracement', icon: <Percent size={16} /> },
            { id: 'fib-extension', name: 'Fib Extension', icon: <ArrowUpRight size={16} /> },
            { id: 'fib-channel', name: 'Fib Channel', icon: <GitBranch size={16} /> },
            { id: 'fib-circles', name: 'Fib Circles', icon: <Circle size={16} /> },
            { id: 'fib-timezone', name: 'Fib Time Zone', icon: <Clock size={16} /> },
        ]
    },
    {
        id: 'gann',
        name: 'Gann & Pitchfork',
        icon: <Waves size={18} />,
        tools: [
            { id: 'pitchfork', name: 'Pitchfork', icon: <GitBranch size={16} /> },
            { id: 'gann-fan', name: 'Gann Fan', icon: <Waves size={16} /> },
            { id: 'gann-square', name: 'Gann Square', icon: <Square size={16} /> },
        ]
    },
    {
        id: 'shapes',
        name: 'Shapes',
        icon: <Square size={18} />,
        tools: [
            { id: 'rectangle', name: 'Rectangle', icon: <Square size={16} /> },
            { id: 'circle', name: 'Circle', icon: <Circle size={16} /> },
            { id: 'ellipse', name: 'Ellipse', icon: <Circle size={16} /> },
            { id: 'triangle', name: 'Triangle', icon: <Triangle size={16} /> },
            { id: 'arc', name: 'Arc', icon: <Spline size={16} /> },
        ]
    },
    {
        id: 'patterns',
        name: 'Patterns',
        icon: <Hash size={18} />,
        tools: [
            { id: 'head-shoulders', name: 'Head & Shoulders', icon: <Waves size={16} /> },
            { id: 'abcd', name: 'ABCD Pattern', icon: <Hash size={16} /> },
            { id: 'xabcd', name: 'XABCD Pattern', icon: <Hash size={16} /> },
            { id: 'three-drives', name: 'Three Drives', icon: <Hash size={16} /> },
            { id: 'elliott-wave', name: 'Elliott Wave', icon: <Waves size={16} /> },
        ]
    },
    {
        id: 'annotations',
        name: 'Text & Annotations',
        icon: <Type size={18} />,
        tools: [
            { id: 'text', name: 'Text', icon: <Type size={16} /> },
            { id: 'callout', name: 'Callout', icon: <Type size={16} /> },
            { id: 'price-label', name: 'Price Label', icon: <Target size={16} /> },
            { id: 'arrow-marker', name: 'Arrow Marker', icon: <ArrowUpRight size={16} /> },
            { id: 'price-range', name: 'Price Range', icon: <MoveVertical size={16} /> },
            { id: 'date-range', name: 'Date Range', icon: <MoveHorizontal size={16} /> },
        ]
    },
    {
        id: 'measure',
        name: 'Measure',
        icon: <Ruler size={18} />,
        tools: [
            { id: 'measure', name: 'Measure', icon: <Ruler size={16} /> },
            { id: 'long-position', name: 'Long Position', icon: <TrendingUp size={16} /> },
            { id: 'short-position', name: 'Short Position', icon: <TrendingUp size={16} style={{ transform: 'scaleY(-1)' }} /> },
        ]
    },
    {
        id: 'brushes',
        name: 'Brushes',
        icon: <PenLine size={18} />,
        tools: [
            { id: 'brush', name: 'Brush', icon: <PenLine size={16} /> },
            { id: 'highlighter', name: 'Highlighter', icon: <PenLine size={16} /> },
        ]
    },
];

interface DrawingToolbarProps {
    activeTool: DrawingTool;
    onSelectTool: (tool: DrawingTool) => void;
    onClearAll: () => void;
    onToggleVisibility?: () => void;
    onLockDrawings?: () => void;
    drawingsVisible?: boolean;
    drawingsLocked?: boolean;
}

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
    activeTool,
    onSelectTool,
    onClearAll,
    onToggleVisibility,
    onLockDrawings,
    drawingsVisible = true,
    drawingsLocked = false
}) => {
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<DrawingTool[]>(['trendline', 'fib-retracement', 'rectangle', 'text']);

    // Find the active tool's category and info
    const getActiveToolInfo = () => {
        for (const cat of TOOL_CATEGORIES) {
            const tool = cat.tools.find(t => t.id === activeTool);
            if (tool) return { category: cat, tool };
        }
        return null;
    };

    const activeInfo = getActiveToolInfo();

    const handleCategoryClick = (categoryId: string) => {
        if (expandedCategory === categoryId) {
            setExpandedCategory(null);
        } else {
            setExpandedCategory(categoryId);
        }
    };

    const handleToolSelect = (tool: DrawingTool) => {
        console.log('[TOOLBAR] Tool selected:', tool);
        onSelectTool(tool);
        setExpandedCategory(null);
    };

    return (
        <div className="absolute left-0 top-0 h-full w-12 bg-[#1e222d] border-r border-gray-800 flex flex-col z-30 overflow-visible">
            {/* Main Tool Categories */}
            <div className="flex-1 py-2 overflow-visible">
                {TOOL_CATEGORIES.map((category) => {
                    const isActive = category.tools.some(t => t.id === activeTool);
                    const isExpanded = expandedCategory === category.id;

                    return (
                        <div key={category.id} className="relative">
                            <button
                                onClick={() => handleCategoryClick(category.id)}
                                className={`w-full p-3 flex items-center justify-center relative group transition-all ${isActive
                                    ? 'bg-blue-600 text-white'
                                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                                    }`}
                                title={category.name}
                            >
                                {category.icon}

                                {/* Expansion Arrow */}
                                <ChevronDown
                                    size={10}
                                    className={`absolute right-1 bottom-1 opacity-50 transition-transform ${isExpanded ? 'rotate-180' : ''
                                        }`}
                                />

                                {/* Tooltip */}
                                <div className="absolute left-full ml-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50">
                                    {category.name}
                                </div>
                            </button>

                            {/* Expanded Submenu - positioned to the RIGHT of toolbar */}
                            {isExpanded && (
                                <div
                                    className="fixed bg-[#1e222d] border border-gray-500 rounded-lg shadow-2xl min-w-64 z-[9999] py-2"
                                    style={{
                                        left: '60px',
                                        top: 'auto',
                                        boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
                                        marginTop: '-10px'
                                    }}
                                >
                                    <div className="px-4 py-2 text-sm text-gray-400 font-semibold uppercase border-b border-gray-700 mb-1">
                                        {category.name}
                                    </div>
                                    {category.tools.map((tool) => (
                                        <button
                                            key={tool.id}
                                            onClick={() => handleToolSelect(tool.id)}
                                            className={`w-full px-4 py-3 flex items-center gap-3 text-sm transition-colors ${activeTool === tool.id
                                                ? 'bg-blue-600 text-white'
                                                : 'text-gray-200 hover:bg-gray-700/80'
                                                }`}
                                        >
                                            <span className="text-lg">{tool.icon}</span>
                                            <span className="font-medium">{tool.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-700 mx-2" />

            {/* Bottom Actions */}
            <div className="py-2 flex flex-col items-center gap-1">
                {/* Toggle Visibility */}
                <button
                    onClick={onToggleVisibility}
                    className={`p-2.5 rounded transition-colors group relative ${drawingsVisible
                        ? 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                        : 'text-yellow-500 bg-yellow-500/10'
                        }`}
                    title={drawingsVisible ? 'Hide Drawings' : 'Show Drawings'}
                >
                    {drawingsVisible ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>

                {/* Lock Drawings */}
                <button
                    onClick={onLockDrawings}
                    className={`p-2.5 rounded transition-colors group relative ${drawingsLocked
                        ? 'text-blue-400 bg-blue-500/10'
                        : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                        }`}
                    title={drawingsLocked ? 'Unlock Drawings' : 'Lock Drawings'}
                >
                    {drawingsLocked ? <Lock size={18} /> : <Unlock size={18} />}
                </button>

                {/* Clear All */}
                <button
                    onClick={onClearAll}
                    className="p-2.5 rounded text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors group relative"
                    title="Delete All Drawings"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );
};
