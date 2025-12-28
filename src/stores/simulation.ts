// Simulation Store for time-based backtesting and scenario analysis
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SimulationState {
    // Time range for simulation/backtesting
    startDate: Date;
    endDate: Date;
    currentDate: Date;

    // Playback state
    isPlaying: boolean;
    playbackSpeed: number; // 1x, 2x, 5x, etc.

    // Option filters
    selectedExpiries: string[];
    optionType: 'all' | 'call' | 'put';
    side: 'all' | 'buy' | 'sell';
    minSize: number;
    maxSize: number;

    // Price range filter
    minStrike: number | null;
    maxStrike: number | null;

    // IV filter
    minIV: number | null;
    maxIV: number | null;

    // Actions
    setStartDate: (date: Date) => void;
    setEndDate: (date: Date) => void;
    setCurrentDate: (date: Date) => void;
    setIsPlaying: (playing: boolean) => void;
    setPlaybackSpeed: (speed: number) => void;
    setSelectedExpiries: (expiries: string[]) => void;
    setOptionType: (type: 'all' | 'call' | 'put') => void;
    setSide: (side: 'all' | 'buy' | 'sell') => void;
    setMinSize: (size: number) => void;
    setMaxSize: (size: number) => void;
    setStrikeRange: (min: number | null, max: number | null) => void;
    setIVRange: (min: number | null, max: number | null) => void;
    resetSimulation: () => void;
    resetFilters: () => void;
}

const now = new Date();
const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

const initialState = {
    startDate: oneMonthAgo,
    endDate: now,
    currentDate: now,
    isPlaying: false,
    playbackSpeed: 1,
    selectedExpiries: [],
    optionType: 'all' as const,
    side: 'all' as const,
    minSize: 0,
    maxSize: 100,
    minStrike: null,
    maxStrike: null,
    minIV: null,
    maxIV: null,
};

export const useSimulationStore = create<SimulationState>()(
    persist(
        (set) => ({
            ...initialState,

            setStartDate: (date) => set({ startDate: date }),
            setEndDate: (date) => set({ endDate: date }),
            setCurrentDate: (date) => set({ currentDate: date }),
            setIsPlaying: (playing) => set({ isPlaying: playing }),
            setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
            setSelectedExpiries: (expiries) => set({ selectedExpiries: expiries }),
            setOptionType: (type) => set({ optionType: type }),
            setSide: (side) => set({ side }),
            setMinSize: (size) => set({ minSize: size }),
            setMaxSize: (size) => set({ maxSize: size }),
            setStrikeRange: (min, max) => set({ minStrike: min, maxStrike: max }),
            setIVRange: (min, max) => set({ minIV: min, maxIV: max }),

            resetSimulation: () => set({
                currentDate: initialState.startDate,
                isPlaying: false,
            }),

            resetFilters: () => set({
                selectedExpiries: [],
                optionType: 'all',
                side: 'all',
                minSize: 0,
                maxSize: 100,
                minStrike: null,
                maxStrike: null,
                minIV: null,
                maxIV: null,
            }),
        }),
        {
            name: 'oss-simulation',
            // Custom serialization for Date objects
            storage: {
                getItem: (name) => {
                    const str = localStorage.getItem(name);
                    if (!str) return null;
                    const parsed = JSON.parse(str);
                    return {
                        ...parsed,
                        state: {
                            ...parsed.state,
                            startDate: new Date(parsed.state.startDate),
                            endDate: new Date(parsed.state.endDate),
                            currentDate: new Date(parsed.state.currentDate),
                        }
                    };
                },
                setItem: (name, value) => {
                    localStorage.setItem(name, JSON.stringify(value));
                },
                removeItem: (name) => localStorage.removeItem(name),
            }
        }
    )
);
