/**
 * Strategy Detection Engine
 * Based on Thales MFI research - detects multi-leg options strategies from trade flow
 * 
 * Detects: Straddles, Strangles, Vertical Spreads, Iron Condors, Butterflies
 */

export interface TradeForDetection {
    id: string;
    timestamp: number;
    type: 'call' | 'put';
    strike: number;
    expiry: string;
    direction: 'buy' | 'sell';
    size: number;
    price: number;
    underlying?: number;
}

export interface DetectedStrategy {
    name: string;
    type: StrategyType;
    legs: TradeForDetection[];
    confidence: number; // 0-1, how confident we are in the detection
    netPremium: number; // Positive = credit, Negative = debit
    maxProfit?: number;
    maxLoss?: number;
    breakevens?: number[];
}

export type StrategyType =
    | 'straddle'
    | 'strangle'
    | 'bull_call_spread'
    | 'bear_call_spread'
    | 'bull_put_spread'
    | 'bear_put_spread'
    | 'iron_condor'
    | 'butterfly'
    | 'calendar_spread'
    | 'single_leg'
    | 'unknown';

// Configuration
const TIME_WINDOW_MS = 5000; // 5 seconds to group trades
const MIN_CONFIDENCE = 0.6; // Minimum confidence to report a strategy

/**
 * Detect multi-leg strategies from a list of trades
 * Groups trades by time window and matches against known patterns
 */
export function detectStrategies(trades: TradeForDetection[]): DetectedStrategy[] {
    const detected: DetectedStrategy[] = [];
    const used = new Set<string>();

    // Sort by timestamp
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < sorted.length; i++) {
        const trade = sorted[i];
        if (used.has(trade.id)) continue;

        // Find trades within time window with same expiry
        const group = sorted.filter(t =>
            !used.has(t.id) &&
            Math.abs(t.timestamp - trade.timestamp) <= TIME_WINDOW_MS &&
            t.expiry === trade.expiry
        );

        if (group.length < 2) continue;

        // Try to match strategy patterns (most complex first)
        const strategy =
            tryMatchIronCondor(group) ||
            tryMatchButterfly(group) ||
            tryMatchStraddle(group) ||
            tryMatchStrangle(group) ||
            tryMatchVerticalSpread(group);

        if (strategy && strategy.confidence >= MIN_CONFIDENCE) {
            detected.push(strategy);
            strategy.legs.forEach(l => used.add(l.id));
        }
    }

    return detected;
}

/**
 * Try to match Iron Condor pattern
 * 4 legs: Short OTM put, Long lower put, Short OTM call, Long higher call
 */
function tryMatchIronCondor(trades: TradeForDetection[]): DetectedStrategy | null {
    if (trades.length < 4) return null;

    const calls = trades.filter(t => t.type === 'call');
    const puts = trades.filter(t => t.type === 'put');

    if (calls.length < 2 || puts.length < 2) return null;

    // Sort by strike
    calls.sort((a, b) => a.strike - b.strike);
    puts.sort((a, b) => a.strike - b.strike);

    // Check for short call spread + short put spread pattern
    const shortCall = calls.find(c => c.direction === 'sell');
    const longCall = calls.find(c => c.direction === 'buy' && c.strike > (shortCall?.strike || 0));
    const shortPut = puts.find(p => p.direction === 'sell');
    const longPut = puts.find(p => p.direction === 'buy' && p.strike < (shortPut?.strike || Infinity));

    if (!shortCall || !longCall || !shortPut || !longPut) return null;

    // Verify proper structure: long put < short put < short call < long call
    if (!(longPut.strike < shortPut.strike && shortPut.strike < shortCall.strike && shortCall.strike < longCall.strike)) {
        return null;
    }

    const legs = [longPut, shortPut, shortCall, longCall];
    const netPremium = calculateNetPremium(legs);

    const shortPutWidth = shortPut.strike - longPut.strike;
    const shortCallWidth = longCall.strike - shortCall.strike;
    const maxLoss = Math.max(shortPutWidth, shortCallWidth) - netPremium;

    return {
        name: 'Iron Condor',
        type: 'iron_condor',
        legs,
        confidence: 0.9,
        netPremium,
        maxProfit: netPremium,
        maxLoss: -maxLoss,
        breakevens: [shortPut.strike - netPremium, shortCall.strike + netPremium],
    };
}

/**
 * Try to match Butterfly pattern
 * 3 strikes: Buy 1 lower, Sell 2 middle, Buy 1 higher (all same type)
 */
function tryMatchButterfly(trades: TradeForDetection[]): DetectedStrategy | null {
    if (trades.length < 3) return null;

    // Check for all same type
    const calls = trades.filter(t => t.type === 'call');
    const puts = trades.filter(t => t.type === 'put');

    const typeGroup = calls.length >= 3 ? calls : (puts.length >= 3 ? puts : null);
    if (!typeGroup) return null;

    // Sort by strike
    const sorted = [...typeGroup].sort((a, b) => a.strike - b.strike);
    const strikes = [...new Set(sorted.map(t => t.strike))];

    if (strikes.length !== 3) return null;

    const lowStrike = strikes[0];
    const midStrike = strikes[1];
    const highStrike = strikes[2];

    // Find legs at each strike
    const lowLeg = sorted.find(t => t.strike === lowStrike && t.direction === 'buy');
    const midLegs = sorted.filter(t => t.strike === midStrike && t.direction === 'sell');
    const highLeg = sorted.find(t => t.strike === highStrike && t.direction === 'buy');

    if (!lowLeg || midLegs.length < 2 || !highLeg) return null;

    // Verify equal wing widths
    if (midStrike - lowStrike !== highStrike - midStrike) return null;

    const legs = [lowLeg, ...midLegs.slice(0, 2), highLeg];
    const netPremium = calculateNetPremium(legs);

    return {
        name: `${typeGroup[0].type === 'call' ? 'Call' : 'Put'} Butterfly`,
        type: 'butterfly',
        legs,
        confidence: 0.85,
        netPremium,
        maxProfit: (midStrike - lowStrike) + netPremium,
        maxLoss: netPremium,
        breakevens: [lowStrike - netPremium, highStrike + netPremium],
    };
}

/**
 * Try to match Straddle pattern
 * Same strike, same expiry, one call + one put, same direction
 */
function tryMatchStraddle(trades: TradeForDetection[]): DetectedStrategy | null {
    for (const trade1 of trades) {
        for (const trade2 of trades) {
            if (trade1.id === trade2.id) continue;

            // Must be call + put, same strike, same direction
            if (trade1.type === trade2.type) continue;
            if (trade1.strike !== trade2.strike) continue;
            if (trade1.direction !== trade2.direction) continue;

            // Check sizes are similar (within 20%)
            const sizeRatio = Math.min(trade1.size, trade2.size) / Math.max(trade1.size, trade2.size);
            if (sizeRatio < 0.8) continue;

            const legs = [trade1, trade2];
            const netPremium = calculateNetPremium(legs);
            const totalPremium = Math.abs(trade1.price * trade1.size) + Math.abs(trade2.price * trade2.size);

            const isLong = trade1.direction === 'buy';

            return {
                name: `${isLong ? 'Long' : 'Short'} Straddle`,
                type: 'straddle',
                legs,
                confidence: 0.95,
                netPremium,
                maxProfit: isLong ? Infinity : totalPremium,
                maxLoss: isLong ? -totalPremium : -Infinity,
                breakevens: [trade1.strike - totalPremium, trade1.strike + totalPremium],
            };
        }
    }

    return null;
}

/**
 * Try to match Strangle pattern
 * Different strikes, same expiry, one call + one put, same direction
 * Call strike > Put strike (OTM options)
 */
function tryMatchStrangle(trades: TradeForDetection[]): DetectedStrategy | null {
    for (const call of trades.filter(t => t.type === 'call')) {
        for (const put of trades.filter(t => t.type === 'put')) {
            if (call.direction !== put.direction) continue;
            if (call.strike <= put.strike) continue; // Call must be higher strike (OTM)

            // Check sizes are similar (within 20%)
            const sizeRatio = Math.min(call.size, put.size) / Math.max(call.size, put.size);
            if (sizeRatio < 0.8) continue;

            const legs = [put, call];
            const netPremium = calculateNetPremium(legs);
            const totalPremium = Math.abs(call.price * call.size) + Math.abs(put.price * put.size);

            const isLong = call.direction === 'buy';

            return {
                name: `${isLong ? 'Long' : 'Short'} Strangle`,
                type: 'strangle',
                legs,
                confidence: 0.9,
                netPremium,
                maxProfit: isLong ? Infinity : totalPremium,
                maxLoss: isLong ? -totalPremium : -Infinity,
                breakevens: [put.strike - totalPremium, call.strike + totalPremium],
            };
        }
    }

    return null;
}

/**
 * Try to match Vertical Spread pattern
 * Same type, same expiry, different strikes, opposite directions
 */
function tryMatchVerticalSpread(trades: TradeForDetection[]): DetectedStrategy | null {
    for (const trade1 of trades) {
        for (const trade2 of trades) {
            if (trade1.id === trade2.id) continue;

            // Must be same type, different strikes, opposite directions
            if (trade1.type !== trade2.type) continue;
            if (trade1.strike === trade2.strike) continue;
            if (trade1.direction === trade2.direction) continue;

            // Check sizes are similar
            const sizeRatio = Math.min(trade1.size, trade2.size) / Math.max(trade1.size, trade2.size);
            if (sizeRatio < 0.8) continue;

            const isCall = trade1.type === 'call';
            const buyLeg = trade1.direction === 'buy' ? trade1 : trade2;
            const sellLeg = trade1.direction === 'sell' ? trade1 : trade2;

            const legs = [buyLeg, sellLeg];
            const netPremium = calculateNetPremium(legs);
            const spreadWidth = Math.abs(buyLeg.strike - sellLeg.strike);

            let name: string;
            let type: StrategyType;

            if (isCall) {
                if (buyLeg.strike < sellLeg.strike) {
                    name = 'Bull Call Spread';
                    type = 'bull_call_spread';
                } else {
                    name = 'Bear Call Spread';
                    type = 'bear_call_spread';
                }
            } else {
                if (buyLeg.strike > sellLeg.strike) {
                    name = 'Bull Put Spread';
                    type = 'bull_put_spread';
                } else {
                    name = 'Bear Put Spread';
                    type = 'bear_put_spread';
                }
            }

            return {
                name,
                type,
                legs,
                confidence: 0.85,
                netPremium,
                maxProfit: netPremium > 0 ? netPremium : spreadWidth + netPremium,
                maxLoss: netPremium > 0 ? -(spreadWidth - netPremium) : netPremium,
            };
        }
    }

    return null;
}

/**
 * Calculate net premium for a set of legs
 * Positive = net credit (received), Negative = net debit (paid)
 */
function calculateNetPremium(legs: TradeForDetection[]): number {
    return legs.reduce((sum, leg) => {
        const amount = leg.price * leg.size;
        return sum + (leg.direction === 'sell' ? amount : -amount);
    }, 0);
}

/**
 * Check if a trade is a block trade (large size)
 */
export function isBlockTrade(trade: TradeForDetection, threshold: number = 10): boolean {
    return trade.size >= threshold;
}

/**
 * Analyze unusual options activity
 * Returns activity score and flags
 */
export interface UnusualActivityResult {
    isUnusual: boolean;
    score: number; // 0-100
    flags: string[];
}

export function analyzeUnusualActivity(
    trade: TradeForDetection,
    openInterest: number,
    avgVolume: number,
    currentIV: number,
    avgIV: number
): UnusualActivityResult {
    const flags: string[] = [];
    let score = 0;

    // Volume vs OI ratio
    if (openInterest > 0) {
        const volumeOIRatio = trade.size / openInterest;
        if (volumeOIRatio > 2) {
            flags.push(`Volume ${(volumeOIRatio * 100).toFixed(0)}% of OI`);
            score += 30;
        } else if (volumeOIRatio > 1) {
            flags.push(`High volume relative to OI`);
            score += 15;
        }
    }

    // Volume vs average
    if (avgVolume > 0) {
        const volumeRatio = trade.size / avgVolume;
        if (volumeRatio > 5) {
            flags.push(`Volume ${volumeRatio.toFixed(1)}x average`);
            score += 25;
        } else if (volumeRatio > 2) {
            flags.push(`Elevated volume`);
            score += 10;
        }
    }

    // IV deviation
    if (avgIV > 0) {
        const ivDeviation = (currentIV - avgIV) / avgIV;
        if (Math.abs(ivDeviation) > 0.3) {
            flags.push(`IV ${(ivDeviation * 100).toFixed(0)}% from avg`);
            score += 20;
        }
    }

    // Block trade
    if (isBlockTrade(trade)) {
        flags.push('Block trade');
        score += 25;
    }

    return {
        isUnusual: score >= 40,
        score: Math.min(100, score),
        flags,
    };
}

/**
 * Get strategy color for UI
 */
export function getStrategyColor(type: StrategyType): string {
    switch (type) {
        case 'straddle':
            return '#8b5cf6'; // Purple
        case 'strangle':
            return '#a78bfa'; // Light purple
        case 'bull_call_spread':
        case 'bull_put_spread':
            return '#22c55e'; // Green
        case 'bear_call_spread':
        case 'bear_put_spread':
            return '#ef4444'; // Red
        case 'iron_condor':
            return '#f59e0b'; // Orange
        case 'butterfly':
            return '#06b6d4'; // Cyan
        default:
            return '#64748b'; // Gray
    }
}

/**
 * Get human-readable strategy description
 */
export function getStrategyDescription(type: StrategyType): string {
    switch (type) {
        case 'straddle':
            return 'Betting on large move in either direction';
        case 'strangle':
            return 'Betting on large move, lower cost than straddle';
        case 'bull_call_spread':
            return 'Bullish with limited risk and reward';
        case 'bear_call_spread':
            return 'Bearish credit spread';
        case 'bull_put_spread':
            return 'Bullish credit spread';
        case 'bear_put_spread':
            return 'Bearish with limited risk and reward';
        case 'iron_condor':
            return 'Betting on low volatility, range-bound';
        case 'butterfly':
            return 'Betting on price staying near strike';
        default:
            return 'Unknown strategy';
    }
}
