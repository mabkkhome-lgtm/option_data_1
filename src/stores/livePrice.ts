import { create } from 'zustand';

/**
 * Live Price Store
 * 
 * Stores real-time prices from WebSocket.
 * Used by visualizers to show current price.
 */

interface LivePriceState {
    // Current prices
    btcPrice: number;
    ethPrice: number;

    // Last update timestamps
    btcUpdatedAt: number;
    ethUpdatedAt: number;

    // WebSocket status
    isConnected: boolean;

    // Actions
    setBtcPrice: (price: number) => void;
    setEthPrice: (price: number) => void;
    setConnected: (connected: boolean) => void;
}

export const useLivePriceStore = create<LivePriceState>((set) => ({
    btcPrice: 0,
    ethPrice: 0,
    btcUpdatedAt: 0,
    ethUpdatedAt: 0,
    isConnected: false,

    setBtcPrice: (price) => set({
        btcPrice: price,
        btcUpdatedAt: Date.now(),
    }),

    setEthPrice: (price) => set({
        ethPrice: price,
        ethUpdatedAt: Date.now(),
    }),

    setConnected: (connected) => set({ isConnected: connected }),
}));
