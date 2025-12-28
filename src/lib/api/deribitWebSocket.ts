'use client';

/**
 * Deribit WebSocket Client
 * 
 * Real-time streaming for:
 * - Live trades (BTC/ETH options)
 * - Price updates (perpetuals for spot price)
 */

export interface DeribitTrade {
    tradeId: string;
    instrumentName: string;
    direction: 'buy' | 'sell';
    price: number;
    amount: number;
    iv: number;
    indexPrice: number;
    timestamp: number;
}

export interface PriceUpdate {
    instrument: string;
    lastPrice: number;
    indexPrice: number;
    timestamp: number;
}

type TradeCallback = (trade: DeribitTrade) => void;
type PriceCallback = (price: PriceUpdate) => void;
type StatusCallback = (connected: boolean) => void;

class DeribitWebSocket {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 1000;
    private subscriptions: string[] = [];
    private messageId = 0;
    private pendingRequests: Map<number, (result: any) => void> = new Map();

    // Callbacks
    private onTradeCallbacks: TradeCallback[] = [];
    private onPriceCallbacks: PriceCallback[] = [];
    private onStatusCallbacks: StatusCallback[] = [];

    private url = 'wss://www.deribit.com/ws/api/v2';

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    console.log('[WS] Connected to Deribit');
                    this.reconnectAttempts = 0;
                    this.notifyStatus(true);

                    // Resubscribe if we had subscriptions
                    if (this.subscriptions.length > 0) {
                        this.subscribe(this.subscriptions);
                    }

                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.ws.onerror = (error) => {
                    console.error('[WS] Error:', error);
                };

                this.ws.onclose = () => {
                    console.log('[WS] Disconnected');
                    this.notifyStatus(false);
                    this.attemptReconnect();
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    private attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WS] Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.connect().catch(console.error);
        }, delay);
    }

    private sendRequest(method: string, params: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const id = ++this.messageId;
            const msg = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            this.pendingRequests.set(id, resolve);
            this.ws.send(JSON.stringify(msg));
        });
    }

    async subscribe(channels: string[]) {
        this.subscriptions = [...new Set([...this.subscriptions, ...channels])];

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('[WS] Will subscribe when connected');
            return;
        }

        try {
            await this.sendRequest('public/subscribe', { channels });
            console.log('[WS] Subscribed to:', channels);
        } catch (error) {
            console.error('[WS] Subscribe error:', error);
        }
    }

    async unsubscribe(channels: string[]) {
        this.subscriptions = this.subscriptions.filter(s => !channels.includes(s));

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            await this.sendRequest('public/unsubscribe', { channels });
        } catch (error) {
            console.error('[WS] Unsubscribe error:', error);
        }
    }

    // Subscribe to option trades
    async subscribeToTrades(currency: 'BTC' | 'ETH') {
        const channel = `trades.option.${currency}.any.any`;
        await this.subscribe([channel]);
    }

    // Subscribe to price updates
    async subscribeToPrice(currency: 'BTC' | 'ETH') {
        const channel = `ticker.${currency}-PERPETUAL.100ms`;
        await this.subscribe([channel]);
    }

    private handleMessage(data: string) {
        try {
            const msg = JSON.parse(data);

            // Handle RPC response
            if (msg.id && this.pendingRequests.has(msg.id)) {
                const resolve = this.pendingRequests.get(msg.id)!;
                this.pendingRequests.delete(msg.id);
                resolve(msg.result);
                return;
            }

            // Handle subscription data
            if (msg.method === 'subscription') {
                const channel = msg.params?.channel || '';
                const data = msg.params?.data;

                if (channel.startsWith('trades.option.')) {
                    this.handleTradeData(data);
                } else if (channel.startsWith('ticker.')) {
                    this.handleTickerData(data);
                }
            }
        } catch (error) {
            console.error('[WS] Parse error:', error);
        }
    }

    private handleTradeData(trades: any[]) {
        if (!Array.isArray(trades)) return;

        for (const t of trades) {
            const trade: DeribitTrade = {
                tradeId: t.trade_id,
                instrumentName: t.instrument_name,
                direction: t.direction,
                price: t.price,
                amount: t.amount,
                iv: t.iv || 0,
                indexPrice: t.index_price,
                timestamp: t.timestamp,
            };

            this.onTradeCallbacks.forEach(cb => cb(trade));
        }
    }

    private handleTickerData(data: any) {
        const update: PriceUpdate = {
            instrument: data.instrument_name,
            lastPrice: data.last_price,
            indexPrice: data.index_price,
            timestamp: data.timestamp,
        };

        this.onPriceCallbacks.forEach(cb => cb(update));
    }

    // Event handlers
    onTrade(callback: TradeCallback) {
        this.onTradeCallbacks.push(callback);
        return () => {
            this.onTradeCallbacks = this.onTradeCallbacks.filter(cb => cb !== callback);
        };
    }

    onPrice(callback: PriceCallback) {
        this.onPriceCallbacks.push(callback);
        return () => {
            this.onPriceCallbacks = this.onPriceCallbacks.filter(cb => cb !== callback);
        };
    }

    onConnectionStatus(callback: StatusCallback) {
        this.onStatusCallbacks.push(callback);
        return () => {
            this.onStatusCallbacks = this.onStatusCallbacks.filter(cb => cb !== callback);
        };
    }

    private notifyStatus(connected: boolean) {
        this.onStatusCallbacks.forEach(cb => cb(connected));
    }

    get isConnected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
let wsInstance: DeribitWebSocket | null = null;

export function getDeribitWebSocket(): DeribitWebSocket {
    if (!wsInstance) {
        wsInstance = new DeribitWebSocket();
    }
    return wsInstance;
}

export { DeribitWebSocket };
