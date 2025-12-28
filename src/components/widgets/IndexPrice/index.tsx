'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface PriceData {
    symbol: string;
    price: number;
    change24h: number;
    changePercent24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    lastUpdate: Date;
}

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'];

export function IndexPriceWidget() {
    const [selectedSymbol, setSelectedSymbol] = useState('BTC');
    const [priceData, setPriceData] = useState<PriceData | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const fetchPrice = async () => {
        setIsLoading(true);
        try {
            // Using CoinGecko API for live prices
            const response = await fetch(
                `https://api.coingecko.com/api/v3/simple/price?ids=${getCoingeckoId(selectedSymbol)}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_high_24h=true&include_low_24h=true`
            );

            if (response.ok) {
                const data = await response.json();
                const id = getCoingeckoId(selectedSymbol);
                const coinData = data[id];

                if (coinData) {
                    setPriceData({
                        symbol: selectedSymbol,
                        price: coinData.usd,
                        change24h: coinData.usd * (coinData.usd_24h_change / 100),
                        changePercent24h: coinData.usd_24h_change || 0,
                        high24h: coinData.usd_high_24h || coinData.usd * 1.02,
                        low24h: coinData.usd_low_24h || coinData.usd * 0.98,
                        volume24h: coinData.usd_24h_vol || 0,
                        lastUpdate: new Date(),
                    });
                    setIsConnected(true);
                }
            } else {
                // Fallback to mock data
                useMockData();
            }
        } catch {
            // Fallback to mock data on error
            useMockData();
        }
        setIsLoading(false);
    };

    const useMockData = () => {
        const mockPrices: Record<string, number> = {
            BTC: 95000 + (Math.random() - 0.5) * 2000,
            ETH: 3400 + (Math.random() - 0.5) * 100,
            SOL: 185 + (Math.random() - 0.5) * 10,
            XRP: 2.1 + (Math.random() - 0.5) * 0.1,
            BNB: 680 + (Math.random() - 0.5) * 20,
        };

        const price = mockPrices[selectedSymbol];
        const change = (Math.random() - 0.5) * 0.04 * price;

        setPriceData({
            symbol: selectedSymbol,
            price,
            change24h: change,
            changePercent24h: (change / price) * 100,
            high24h: price * 1.02,
            low24h: price * 0.98,
            volume24h: Math.random() * 10000000000,
            lastUpdate: new Date(),
        });
        setIsConnected(false);
    };

    const getCoingeckoId = (symbol: string) => {
        const mapping: Record<string, string> = {
            BTC: 'bitcoin',
            ETH: 'ethereum',
            SOL: 'solana',
            XRP: 'ripple',
            BNB: 'binancecoin',
        };
        return mapping[symbol] || symbol.toLowerCase();
    };

    useEffect(() => {
        fetchPrice();

        if (autoRefresh) {
            const interval = setInterval(fetchPrice, 30000); // Refresh every 30 seconds
            return () => clearInterval(interval);
        }
    }, [selectedSymbol, autoRefresh]);

    const formatVolume = (vol: number) => {
        if (vol >= 1e9) return `$${(vol / 1e9).toFixed(2)}B`;
        if (vol >= 1e6) return `$${(vol / 1e6).toFixed(2)}M`;
        return `$${vol.toLocaleString()}`;
    };

    return (
        <div className="h-full flex flex-col text-sm">
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-border-color mb-3">
                <div className="flex items-center gap-2">
                    {isConnected ? (
                        <Wifi size={14} className="text-bullish" />
                    ) : (
                        <WifiOff size={14} className="text-foreground-muted" />
                    )}
                    <span className="text-xs font-semibold text-foreground">INDEX PRICE</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`p-1 rounded transition-colors ${autoRefresh ? 'text-bullish' : 'text-foreground-muted'}`}
                        title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                    >
                        <RefreshCw size={12} className={autoRefresh ? 'animate-spin' : ''} style={{ animationDuration: '3s' }} />
                    </button>
                    <button
                        onClick={fetchPrice}
                        className="p-1 hover:bg-background-tertiary rounded transition-colors"
                        disabled={isLoading}
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Symbol Selector */}
            <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
                {CRYPTO_SYMBOLS.map((symbol) => (
                    <button
                        key={symbol}
                        onClick={() => setSelectedSymbol(symbol)}
                        className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors ${selectedSymbol === symbol
                                ? 'bg-accent-primary text-white'
                                : 'bg-background-secondary text-foreground-muted hover:bg-background-tertiary'
                            }`}
                    >
                        {symbol}
                    </button>
                ))}
            </div>

            {priceData && (
                <>
                    {/* Main Price Display */}
                    <div className="text-center py-4">
                        <div className="text-xs text-foreground-muted mb-1">{priceData.symbol}/USD</div>
                        <div className="text-3xl font-bold font-mono text-foreground">
                            ${priceData.price.toLocaleString(undefined, {
                                minimumFractionDigits: priceData.price < 10 ? 4 : 2,
                                maximumFractionDigits: priceData.price < 10 ? 4 : 2
                            })}
                        </div>
                        <div className={`flex items-center justify-center gap-1 mt-1 ${priceData.changePercent24h >= 0 ? 'text-bullish' : 'text-bearish'
                            }`}>
                            {priceData.changePercent24h >= 0 ? (
                                <TrendingUp size={14} />
                            ) : (
                                <TrendingDown size={14} />
                            )}
                            <span className="font-mono">
                                {priceData.changePercent24h >= 0 ? '+' : ''}
                                {priceData.changePercent24h.toFixed(2)}%
                            </span>
                            <span className="text-xs opacity-75">
                                ({priceData.change24h >= 0 ? '+' : ''}${priceData.change24h.toFixed(2)})
                            </span>
                        </div>
                    </div>

                    {/* 24h Stats */}
                    <div className="grid grid-cols-3 gap-2 mt-auto">
                        <div className="p-2 bg-background-secondary rounded-lg text-center">
                            <div className="text-xs text-foreground-muted">24h High</div>
                            <div className="font-mono text-sm text-bullish">
                                ${priceData.high24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                        </div>
                        <div className="p-2 bg-background-secondary rounded-lg text-center">
                            <div className="text-xs text-foreground-muted">24h Low</div>
                            <div className="font-mono text-sm text-bearish">
                                ${priceData.low24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                        </div>
                        <div className="p-2 bg-background-secondary rounded-lg text-center">
                            <div className="text-xs text-foreground-muted">Volume</div>
                            <div className="font-mono text-sm">{formatVolume(priceData.volume24h)}</div>
                        </div>
                    </div>

                    {/* Last Update */}
                    <div className="text-xs text-foreground-muted text-center mt-2">
                        Updated: {priceData.lastUpdate.toLocaleTimeString()}
                    </div>
                </>
            )}
        </div>
    );
}
