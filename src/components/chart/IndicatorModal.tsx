
import React, { useState, useMemo } from 'react';
import { Search, X, TrendingUp, Activity, BarChart2, Layers } from 'lucide-react';
import { AVAILABLE_INDICATORS, IndicatorDef } from '../../lib/indicators/definitions';

interface IndicatorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddIndicator: (indicatorId: string) => void;
    activeIndicators: string[];
}

export const IndicatorModal: React.FC<IndicatorModalProps> = ({ isOpen, onClose, onAddIndicator, activeIndicators }) => {
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<string>('All');

    const filteredIndicators = useMemo(() => {
        return AVAILABLE_INDICATORS.filter(ind => {
            const matchesSearch = ind.name.toLowerCase().includes(search.toLowerCase());
            const matchesCategory = category === 'All' || ind.category === category;
            return matchesSearch && matchesCategory;
        });
    }, [search, category]);

    const categories = ['All', 'Trend', 'Momentum', 'Volatility', 'Volume'];

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#1e222d] border border-gray-700 rounded-lg shadow-2xl w-[600px] h-[700px] flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
                        <Activity className="text-blue-500" /> Indicators & Strategies
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                {/* Search & Filter */}
                <div className="p-4 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-3 text-gray-500" size={18} />
                        <input
                            type="text"
                            placeholder="Search indicators..."
                            className="w-full bg-[#2a2e39] text-gray-100 pl-10 pr-4 py-2 rounded border border-gray-700 focus:outline-none focus:border-blue-500"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setCategory(cat)}
                                className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${category === cat
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-4 pt-0">
                    <div className="grid gap-2">
                        {filteredIndicators.map(ind => (
                            <div
                                key={ind.id}
                                className="flex justify-between items-center p-3 rounded bg-[#2a2e39] hover:bg-[#363a45] transition-colors group cursor-pointer"
                                onClick={() => onAddIndicator(ind.id)}
                            >
                                <div className="flex flex-col">
                                    <span className="text-gray-100 font-medium">{ind.name}</span>
                                    <span className="text-xs text-gray-500">{ind.category}</span>
                                </div>
                                <button className="opacity-0 group-hover:opacity-100 bg-blue-600 text-white px-3 py-1 rounded text-sm">
                                    Add
                                </button>
                            </div>
                        ))}

                        {filteredIndicators.length === 0 && (
                            <div className="text-center text-gray-500 mt-10">
                                No indicators found matching "{search}"
                            </div>
                        )}

                        <div className="text-center text-xs text-gray-600 mt-8 mb-4">
                            Showing {filteredIndicators.length} of {AVAILABLE_INDICATORS.length} available indicators.
                            <br />(100+ supported via definitions)
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
