'use client';

import { useState } from 'react';
import { Calendar, Clock, Play, Pause, RotateCcw, Settings } from 'lucide-react';
import { useSimulationStore } from '@/stores/simulation';

export function SimulationControlWidget() {
    const {
        startDate,
        endDate,
        currentDate,
        isPlaying,
        playbackSpeed,
        setStartDate,
        setEndDate,
        setCurrentDate,
        setIsPlaying,
        setPlaybackSpeed,
        resetSimulation,
    } = useSimulationStore();

    const [showAdvanced, setShowAdvanced] = useState(false);

    const formatDate = (date: Date) => {
        return date.toISOString().split('T')[0];
    };

    const formatDateTime = (date: Date) => {
        return date.toISOString().slice(0, 16);
    };

    const handleStartDateChange = (value: string) => {
        setStartDate(new Date(value));
    };

    const handleEndDateChange = (value: string) => {
        setEndDate(new Date(value));
    };

    const handleCurrentDateChange = (value: string) => {
        setCurrentDate(new Date(value));
    };

    // Calculate progress percentage
    const totalMs = endDate.getTime() - startDate.getTime();
    const currentMs = currentDate.getTime() - startDate.getTime();
    const progress = totalMs > 0 ? (currentMs / totalMs) * 100 : 0;

    return (
        <div className="h-full flex flex-col text-sm">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border-color mb-3">
                <div className="flex items-center gap-2">
                    <Clock size={14} className="text-accent-primary" />
                    <span className="text-xs font-semibold text-foreground">SIMULATION</span>
                </div>
                <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="p-1 hover:bg-background-tertiary rounded transition-colors"
                    title="Advanced Settings"
                >
                    <Settings size={14} className="text-foreground-muted" />
                </button>
            </div>

            {/* Date Range Selection */}
            <div className="space-y-3 mb-3">
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-xs text-foreground-muted flex items-center gap-1 mb-1">
                            <Calendar size={10} /> From Date
                        </label>
                        <input
                            type="datetime-local"
                            value={formatDateTime(startDate)}
                            onChange={(e) => handleStartDateChange(e.target.value)}
                            className="input-field text-xs py-1.5 w-full"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground-muted flex items-center gap-1 mb-1">
                            <Calendar size={10} /> To Date
                        </label>
                        <input
                            type="datetime-local"
                            value={formatDateTime(endDate)}
                            onChange={(e) => handleEndDateChange(e.target.value)}
                            className="input-field text-xs py-1.5 w-full"
                        />
                    </div>
                </div>

                {/* Current Simulation Time */}
                <div>
                    <label className="text-xs text-foreground-muted mb-1 block">
                        Current Time: <span className="text-accent-primary font-mono">{currentDate.toLocaleString()}</span>
                    </label>
                    <input
                        type="range"
                        min={startDate.getTime()}
                        max={endDate.getTime()}
                        value={currentDate.getTime()}
                        onChange={(e) => setCurrentDate(new Date(Number(e.target.value)))}
                        className="w-full h-2 bg-background-secondary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                    />
                    <div className="flex justify-between text-xs text-foreground-muted mt-1">
                        <span>{formatDate(startDate)}</span>
                        <span className="text-accent-primary">{progress.toFixed(1)}%</span>
                        <span>{formatDate(endDate)}</span>
                    </div>
                </div>
            </div>

            {/* Playback Controls */}
            <div className="flex items-center justify-center gap-2 py-2 border-y border-border-color mb-3">
                <button
                    onClick={resetSimulation}
                    className="p-2 hover:bg-background-tertiary rounded-lg transition-colors"
                    title="Reset"
                >
                    <RotateCcw size={16} className="text-foreground-muted" />
                </button>
                <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`p-3 rounded-lg transition-colors ${isPlaying
                            ? 'bg-accent-primary text-white'
                            : 'bg-background-tertiary hover:bg-accent-primary/20'
                        }`}
                    title={isPlaying ? 'Pause' : 'Play'}
                >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <select
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    className="input-field text-xs py-1 px-2 w-16"
                >
                    <option value={0.5}>0.5x</option>
                    <option value={1}>1x</option>
                    <option value={2}>2x</option>
                    <option value={5}>5x</option>
                    <option value={10}>10x</option>
                </select>
            </div>

            {/* Advanced Settings */}
            {showAdvanced && (
                <div className="space-y-2 p-2 bg-background-secondary rounded-lg text-xs">
                    <div className="text-foreground-muted font-semibold mb-2">Advanced Settings</div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-foreground-muted block mb-1">Time Step</label>
                            <select className="input-field text-xs py-1 w-full">
                                <option value="1m">1 Minute</option>
                                <option value="5m">5 Minutes</option>
                                <option value="15m">15 Minutes</option>
                                <option value="1h">1 Hour</option>
                                <option value="1d">1 Day</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-foreground-muted block mb-1">Data Source</label>
                            <select className="input-field text-xs py-1 w-full">
                                <option value="deribit">Deribit</option>
                                <option value="historical">Historical</option>
                                <option value="simulated">Simulated</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Status */}
            <div className="mt-auto pt-2 border-t border-border-color">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground-muted">Status:</span>
                    <span className={`flex items-center gap-1 ${isPlaying ? 'text-bullish' : 'text-foreground-muted'}`}>
                        <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-bullish animate-pulse' : 'bg-foreground-muted'}`}></span>
                        {isPlaying ? 'Running' : 'Paused'}
                    </span>
                </div>
            </div>
        </div>
    );
}
