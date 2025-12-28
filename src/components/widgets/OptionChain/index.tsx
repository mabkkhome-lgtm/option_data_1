'use client';

import { useState, useMemo } from 'react';
import { useStrategyStore } from '@/stores';
import type { OptionChainRow } from '@/types';

// Mock option chain data (would come from Deribit API in production)
function generateMockOptionChain(spotPrice: number): OptionChainRow[] {
    const strikes = [];
    const baseStrike = Math.round(spotPrice / 1000) * 1000;

    for (let i = -10; i <= 10; i++) {
        const strike = baseStrike + i * 1000;
        const moneyness = strike / spotPrice;
        const atmVol = 0.65; // 65% base IV

        // Volatility smile - higher IV for OTM options
        const distFromATM = Math.abs(1 - moneyness);
        const iv = atmVol + distFromATM * 0.3;

        // Simple pricing approximation
        const callIntrinsic = Math.max(0, spotPrice - strike);
        const putIntrinsic = Math.max(0, strike - spotPrice);
        const timeValue = spotPrice * iv * 0.1;

        const callPrice = callIntrinsic + timeValue * (strike < spotPrice ? 0.3 : 1);
        const putPrice = putIntrinsic + timeValue * (strike > spotPrice ? 0.3 : 1);

        strikes.push({
            strike,
            callBid: Math.max(10, callPrice * 0.98),
            callAsk: callPrice * 1.02,
            callMark: callPrice,
            callVolume: Math.floor(Math.random() * 500),
            callOI: Math.floor(Math.random() * 2000),
            callIV: iv * 100,
            callDelta: strike < spotPrice ? 0.9 - distFromATM : 0.5 - distFromATM * 2,
            putBid: Math.max(10, putPrice * 0.98),
            putAsk: putPrice * 1.02,
            putMark: putPrice,
            putVolume: Math.floor(Math.random() * 500),
            putOI: Math.floor(Math.random() * 2000),
            putIV: iv * 100,
            putDelta: strike > spotPrice ? -0.9 + distFromATM : -0.5 + distFromATM * 2,
        });
    }

    return strikes;
}

export function OptionChainWidget() {
    const { underlyingPrice, activeStrategy, addLeg } = useStrategyStore();
    const [selectedExpiry, setSelectedExpiry] = useState('2024-01-26');

    // Mock expiry dates
    const expiryDates = ['2024-01-26', '2024-02-02', '2024-02-09', '2024-02-23'];

    // Generate mock chain based on underlying price
    const chainData = useMemo(
        () => generateMockOptionChain(underlyingPrice),
        [underlyingPrice]
    );

    const handleAddLeg = (
        strike: number,
        type: 'call' | 'put',
        direction: 'long' | 'short',
        premium: number,
        iv: number
    ) => {
        if (!activeStrategy) {
            alert('Please create a strategy first in the Strategy Builder');
            return;
        }

        addLeg(activeStrategy.id, {
            type,
            direction,
            strike,
            expiry: selectedExpiry,
            quantity: 1,
            premium,
            iv: iv / 100,
        });
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header Controls */}
            <div className="flex items-center justify-between pb-2 border-b border-border-color mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground-muted">BTC-USD</span>
                    <span className="text-sm font-mono font-bold text-foreground">
                        ${underlyingPrice.toLocaleString()}
                    </span>
                </div>
                <select
                    value={selectedExpiry}
                    onChange={(e) => setSelectedExpiry(e.target.value)}
                    className="input-field text-xs py-1 px-2 w-auto"
                >
                    {expiryDates.map((date) => (
                        <option key={date} value={date}>
                            {date}
                        </option>
                    ))}
                </select>
            </div>

            {/* Option Chain Table */}
            <div className="flex-1 overflow-auto">
                <table className="data-table text-xs">
                    <thead className="sticky top-0 z-10">
                        <tr>
                            <th colSpan={4} className="text-center text-bullish bg-bullish/10">
                                CALLS
                            </th>
                            <th className="bg-accent-primary/20">Strike</th>
                            <th colSpan={4} className="text-center text-bearish bg-bearish/10">
                                PUTS
                            </th>
                        </tr>
                        <tr>
                            <th>Bid</th>
                            <th>Ask</th>
                            <th>IV%</th>
                            <th>Δ</th>
                            <th className="bg-accent-primary/10"></th>
                            <th>Δ</th>
                            <th>IV%</th>
                            <th>Bid</th>
                            <th>Ask</th>
                        </tr>
                    </thead>
                    <tbody>
                        {chainData.map((row) => {
                            const isATM = Math.abs(row.strike - underlyingPrice) < 500;
                            const isITMCall = row.strike < underlyingPrice;
                            const isITMPut = row.strike > underlyingPrice;

                            return (
                                <tr
                                    key={row.strike}
                                    className={`
                    ${isATM ? 'bg-accent-primary/10 font-semibold' : ''}
                    hover:bg-background-tertiary cursor-pointer
                  `}
                                >
                                    {/* Call Side */}
                                    <td
                                        className={`hover:bg-bullish/20 ${isITMCall ? 'bg-bullish/5' : ''}`}
                                        onClick={() => handleAddLeg(row.strike, 'call', 'long', row.callMark, row.callIV)}
                                        title="Click to buy Call"
                                    >
                                        <span className="positive">{row.callBid.toFixed(0)}</span>
                                    </td>
                                    <td
                                        className={`hover:bg-bearish/20 ${isITMCall ? 'bg-bullish/5' : ''}`}
                                        onClick={() => handleAddLeg(row.strike, 'call', 'short', row.callMark, row.callIV)}
                                        title="Click to sell Call"
                                    >
                                        <span className="negative">{row.callAsk.toFixed(0)}</span>
                                    </td>
                                    <td className={isITMCall ? 'bg-bullish/5' : ''}>
                                        {row.callIV.toFixed(1)}
                                    </td>
                                    <td className={isITMCall ? 'bg-bullish/5' : ''}>
                                        {row.callDelta.toFixed(2)}
                                    </td>

                                    {/* Strike */}
                                    <td className="font-mono font-bold text-center bg-accent-primary/10 text-accent-primary">
                                        {row.strike.toLocaleString()}
                                    </td>

                                    {/* Put Side */}
                                    <td className={isITMPut ? 'bg-bearish/5' : ''}>
                                        {row.putDelta.toFixed(2)}
                                    </td>
                                    <td className={isITMPut ? 'bg-bearish/5' : ''}>
                                        {row.putIV.toFixed(1)}
                                    </td>
                                    <td
                                        className={`hover:bg-bullish/20 ${isITMPut ? 'bg-bearish/5' : ''}`}
                                        onClick={() => handleAddLeg(row.strike, 'put', 'long', row.putMark, row.putIV)}
                                        title="Click to buy Put"
                                    >
                                        <span className="positive">{row.putBid.toFixed(0)}</span>
                                    </td>
                                    <td
                                        className={`hover:bg-bearish/20 ${isITMPut ? 'bg-bearish/5' : ''}`}
                                        onClick={() => handleAddLeg(row.strike, 'put', 'short', row.putMark, row.putIV)}
                                        title="Click to sell Put"
                                    >
                                        <span className="negative">{row.putAsk.toFixed(0)}</span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
