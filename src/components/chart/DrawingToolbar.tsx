
import React from 'react';
import { MousePointer2, TrendingUp, Percent, X, Eraser, PenTool } from 'lucide-react';

export type DrawingTool = 'cursor' | 'trendline' | 'fib' | 'brush';

interface DrawingToolbarProps {
    activeTool: DrawingTool;
    onSelectTool: (tool: DrawingTool) => void;
    onClearAll: () => void;
}

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({ activeTool, onSelectTool, onClearAll }) => {
    const tools = [
        { id: 'cursor', icon: <MousePointer2 size={20} />, label: 'Cursor' },
        { id: 'trendline', icon: <TrendingUp size={20} />, label: 'Trend Line' },
        { id: 'fib', icon: <Percent size={20} />, label: 'Fib Retracement' },
        // { id: 'brush', icon: <PenTool size={20} />, label: 'Brush' }, // Brush is hard without advanced canvas
    ];

    return (
        <div className="absolute left-4 top-20 flex flex-col gap-2 z-20 bg-[#1e222d] p-1 rounded-lg border border-gray-700 shadow-xl">
            {tools.map((tool) => (
                <button
                    key={tool.id}
                    onClick={() => onSelectTool(tool.id as DrawingTool)}
                    className={`p-2 rounded transition-colors group relative ${activeTool === tool.id
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                        }`}
                    title={tool.label}
                >
                    {tool.icon}
                    {/* Tooltip */}
                    <div className="absolute left-full ml-2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                        {tool.label}
                    </div>
                </button>
            ))}

            <div className="h-px bg-gray-700 my-1" />

            <button
                onClick={onClearAll}
                className="p-2 rounded text-red-400 hover:bg-gray-700 hover:text-red-300 group relative"
                title="Clear All Drawings"
            >
                <Eraser size={20} />
            </button>
        </div>
    );
};
