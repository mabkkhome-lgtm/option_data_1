'use client';

import { useEffect, useRef } from 'react';
import { getDeribitWebSocket } from '@/lib/api/deribitWebSocket';
import { useLivePriceStore } from '@/stores/livePrice';
import { insertTrade, wsTradeToDbTrade } from '@/lib/supabase/trades';
import { isSupabaseConfigured } from '@/lib/supabase/client';

/**
 * WebSocket Provider
 * 
 * Initializes WebSocket connection and:
 * - Updates live price stores
 * - Stores trades to Supabase database
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

        // Store trades to database
        ws.onTrade((trade) => {
            if (isSupabaseConfigured) {
                const currency = trade.instrumentName.startsWith('BTC') ? 'BTC' : 'ETH';
                const dbTrade = wsTradeToDbTrade(trade, currency);
                insertTrade(dbTrade);
            }
        });

        // Connect and subscribe
        ws.connect()
            .then(async () => {
                // Subscribe to price feeds
                await ws.subscribeToPrice('BTC');
                await ws.subscribeToPrice('ETH');
                console.log('[WSProvider] Subscribed to price feeds');

                // Subscribe to option trades for database storage
                if (isSupabaseConfigured) {
                    await ws.subscribeToTrades('BTC');
                    await ws.subscribeToTrades('ETH');
                    console.log('[WSProvider] Subscribed to trade feeds (storing to DB)');
                } else {
                    console.log('[WSProvider] Supabase not configured - trades not stored');
                }
            })
            .catch(console.error);

        // Cleanup
        return () => {
            // Don't disconnect on unmount - keep connection alive
        };
    }, [setBtcPrice, setEthPrice, setConnected]);

    return <>{children}</>;
}
