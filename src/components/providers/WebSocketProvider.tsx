'use client';

import { useEffect, useRef } from 'react';
import { getDeribitWebSocket } from '@/lib/api/deribitWebSocket';
import { useLivePriceStore } from '@/stores/livePrice';

/**
 * WebSocket Provider
 * 
 * Initializes WebSocket connection and updates stores.
 * Should be placed near the root of the app.
 */
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
    const initialized = useRef(false);
    const { setBtcPrice, setEthPrice, setConnected } = useLivePriceStore();

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        const ws = getDeribitWebSocket();

        // Set up callbacks
        ws.onConnectionStatus((connected) => {
            setConnected(connected);
            console.log('[WSProvider] Connection status:', connected);
        });

        ws.onPrice((update) => {
            if (update.instrument.startsWith('BTC')) {
                setBtcPrice(update.indexPrice);
            } else if (update.instrument.startsWith('ETH')) {
                setEthPrice(update.indexPrice);
            }
        });

        // Connect and subscribe
        ws.connect()
            .then(async () => {
                await ws.subscribeToPrice('BTC');
                await ws.subscribeToPrice('ETH');
                console.log('[WSProvider] Subscribed to price feeds');
            })
            .catch(console.error);

        // Cleanup
        return () => {
            // Don't disconnect on unmount - keep connection alive
        };
    }, [setBtcPrice, setEthPrice, setConnected]);

    return <>{children}</>;
}
