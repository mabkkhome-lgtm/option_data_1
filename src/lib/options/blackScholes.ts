// Black-Scholes & Merton Options Pricing Engine
// Based on Thales MFI research - includes Newton-Raphson IV solver
// Provides pricing, Greeks calculations, and payoff simulations

import type { OptionLeg, Greeks, PayoffPoint, Strategy } from '@/types';

// ============================================================================
// MATHEMATICAL FOUNDATIONS
// ============================================================================

/**
 * Cumulative Normal Distribution Function (CDF)
 * Uses Abramowitz and Stegun approximation (error < 7.5e-8)
 */
function cdf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return 0.5 * (1.0 + sign * y);
}

/**
 * Standard Normal Probability Density Function (PDF)
 */
function pdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Calculate d1 and d2 for Black-Scholes/Merton model
 * @param q - Continuous dividend yield (0 for crypto)
 */
function d1d2(
    S: number,
    K: number,
    T: number,
    r: number,
    sigma: number,
    q: number = 0
): { d1: number; d2: number } {
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    return { d1, d2 };
}

// ============================================================================
// OPTION PRICING - Merton Model (supports dividends)
// ============================================================================

/**
 * Merton Model Option Pricing (Black-Scholes extended for dividends)
 * For crypto (no dividends), set q = 0 and this reduces to standard Black-Scholes
 * 
 * @param S - Current spot/underlying price
 * @param K - Strike price
 * @param T - Time to expiry in years
 * @param r - Risk-free interest rate (e.g., 0.05 for 5%)
 * @param sigma - Implied volatility as decimal (e.g., 0.60 for 60%)
 * @param type - 'call' or 'put'
 * @param q - Continuous dividend yield (default 0 for crypto)
 * @returns Option price in same units as S (e.g., USD)
 */
export function calculateOptionPrice(
    S: number,
    K: number,
    T: number,
    r: number,
    sigma: number,
    type: 'call' | 'put',
    q: number = 0
): number {
    // Handle edge cases
    if (T <= 0) {
        // At expiration - intrinsic value only
        return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    }

    if (sigma <= 0 || S <= 0 || K <= 0) {
        return 0;
    }

    const { d1, d2 } = d1d2(S, K, T, r, sigma, q);

    if (type === 'call') {
        // C = S * e^(-q*T) * N(d1) - K * e^(-r*T) * N(d2)
        return S * Math.exp(-q * T) * cdf(d1) - K * Math.exp(-r * T) * cdf(d2);
    } else {
        // P = K * e^(-r*T) * N(-d2) - S * e^(-q*T) * N(-d1)
        return K * Math.exp(-r * T) * cdf(-d2) - S * Math.exp(-q * T) * cdf(-d1);
    }
}

// ============================================================================
// GREEKS CALCULATIONS
// ============================================================================

/**
 * Calculate Vega for a single option
 * Returns Vega per 1% change in IV (not per 1 point)
 */
export function calculateVega(
    S: number,
    K: number,
    T: number,
    r: number,
    sigma: number,
    q: number = 0
): number {
    if (T <= 0 || sigma <= 0) return 0;

    const { d1 } = d1d2(S, K, T, r, sigma, q);
    // Vega is same for calls and puts
    // Raw vega is per 1 point of IV, divide by 100 for per 1%
    return S * Math.exp(-q * T) * pdf(d1) * Math.sqrt(T) / 100;
}

/**
 * Calculate all Greeks for a single option
 * 
 * @returns Greeks object with:
 *   - delta: Change in option price per $1 change in underlying
 *   - gamma: Change in delta per $1 change in underlying
 *   - theta: Daily time decay in $ (negative for long options)
 *   - vega: Change in option price per 1% change in IV
 */
export function calculateGreeks(
    S: number,
    K: number,
    T: number,
    r: number,
    sigma: number,
    type: 'call' | 'put',
    q: number = 0
): Greeks {
    // Handle expiration edge case
    if (T <= 0) {
        // At expiration: binary delta, all other Greeks = 0
        let delta = 0;
        if (type === 'call') {
            delta = S > K ? 1 : (S === K ? 0.5 : 0);
        } else {
            delta = S < K ? -1 : (S === K ? -0.5 : 0);
        }
        return { delta, gamma: 0, theta: 0, vega: 0 };
    }

    if (sigma <= 0 || S <= 0 || K <= 0) {
        return { delta: 0, gamma: 0, theta: 0, vega: 0 };
    }

    const { d1, d2 } = d1d2(S, K, T, r, sigma, q);
    const sqrtT = Math.sqrt(T);
    const expQT = Math.exp(-q * T);
    const expRT = Math.exp(-r * T);
    const pdfD1 = pdf(d1);

    // DELTA
    let delta: number;
    if (type === 'call') {
        delta = expQT * cdf(d1);
    } else {
        delta = expQT * (cdf(d1) - 1);
    }

    // GAMMA (same for calls and puts)
    const gamma = expQT * pdfD1 / (S * sigma * sqrtT);

    // THETA (annualized, then divided by 365 for daily)
    let theta: number;
    const term1 = -(S * sigma * expQT * pdfD1) / (2 * sqrtT);

    if (type === 'call') {
        const term2 = -r * K * expRT * cdf(d2);
        const term3 = q * S * expQT * cdf(d1);
        theta = (term1 + term2 + term3) / 365;
    } else {
        const term2 = r * K * expRT * cdf(-d2);
        const term3 = -q * S * expQT * cdf(-d1);
        theta = (term1 + term2 + term3) / 365;
    }

    // VEGA (per 1% IV change, same for calls and puts)
    const vega = S * expQT * pdfD1 * sqrtT / 100;

    return { delta, gamma, theta, vega };
}

// ============================================================================
// IMPLIED VOLATILITY SOLVER - Newton-Raphson Method
// ============================================================================

/**
 * Calculate Implied Volatility using Newton-Raphson iteration
 * Finds the volatility that makes model price = market price
 * 
 * @param marketPrice - Observed market price of the option
 * @param S - Current spot/underlying price  
 * @param K - Strike price
 * @param T - Time to expiry in years
 * @param r - Risk-free rate
 * @param type - 'call' or 'put'
 * @param q - Dividend yield (default 0)
 * @param initialGuess - Starting IV guess (default 0.5 = 50%)
 * @param maxIterations - Max iterations before giving up
 * @param tolerance - Convergence tolerance
 * @returns Implied volatility as decimal (e.g., 0.60 for 60%)
 */
export function calculateImpliedVolatility(
    marketPrice: number,
    S: number,
    K: number,
    T: number,
    r: number,
    type: 'call' | 'put',
    q: number = 0,
    initialGuess: number = 0.5,
    maxIterations: number = 100,
    tolerance: number = 1e-6
): number {
    // Edge cases
    if (T <= 0 || marketPrice <= 0 || S <= 0 || K <= 0) {
        return initialGuess;
    }

    // Intrinsic value check
    const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
    if (marketPrice < intrinsic) {
        // Price below intrinsic is impossible, return low IV
        return 0.01;
    }

    let sigma = initialGuess;

    for (let i = 0; i < maxIterations; i++) {
        const modelPrice = calculateOptionPrice(S, K, T, r, sigma, type, q);
        const diff = modelPrice - marketPrice;

        // Check convergence
        if (Math.abs(diff) < tolerance) {
            return sigma;
        }

        // Calculate Vega (derivative of price w.r.t. sigma)
        const vega = calculateVega(S, K, T, r, sigma, q);

        // Avoid division by near-zero vega
        if (Math.abs(vega) < 1e-10) {
            // Vega too small, adjust sigma and continue
            sigma = diff > 0 ? sigma * 0.9 : sigma * 1.1;
            continue;
        }

        // Newton-Raphson update
        // Note: vega is per 1%, so we multiply by 100 to get raw vega
        sigma = sigma - diff / (vega * 100);

        // Keep sigma in reasonable bounds
        sigma = Math.max(0.001, Math.min(5.0, sigma));
    }

    // Return last estimate if not converged
    return sigma;
}

// ============================================================================
// STRATEGY & PAYOFF CALCULATIONS
// ============================================================================

/**
 * Calculate payoff for a single option leg at various underlying prices
 */
export function calculateLegPayoff(
    leg: OptionLeg,
    priceRange: number[],
    currentPrice: number,
    riskFreeRate: number = 0.05,
    daysToExpiry?: number
): PayoffPoint[] {
    const T = daysToExpiry !== undefined ? daysToExpiry / 365 : 0;
    const multiplier = leg.direction === 'long' ? 1 : -1;
    const contractSize = leg.quantity * 100; // Standard options = 100 shares

    return priceRange.map(price => {
        // Expiration payoff (intrinsic - premium)
        const intrinsicValue = leg.type === 'call'
            ? Math.max(0, price - leg.strike)
            : Math.max(0, leg.strike - price);
        const payoff = (intrinsicValue - leg.premium) * multiplier * contractSize;

        // T+0 (current) value using BS pricing
        let t0Value = payoff;
        if (T > 0 && leg.iv > 0) {
            const currentOptionValue = calculateOptionPrice(
                price,
                leg.strike,
                T,
                riskFreeRate,
                leg.iv,
                leg.type
            );
            t0Value = (currentOptionValue - leg.premium) * multiplier * contractSize;
        }

        return { price, payoff, t0Value };
    });
}

/**
 * Calculate combined payoff for a multi-leg strategy
 */
export function calculateStrategyPayoff(
    strategy: Strategy,
    priceRange?: number[],
    daysToExpiry?: number,
    riskFreeRate: number = 0.05
): PayoffPoint[] {
    const currentPrice = strategy.underlyingPrice;

    // Default price range: ±30% from current price
    const range = priceRange || generatePriceRange(currentPrice, 0.3, 100);

    // Calculate payoff for each leg
    const legPayoffs = strategy.legs.map(leg =>
        calculateLegPayoff(leg, range, currentPrice, riskFreeRate, daysToExpiry)
    );

    // Combine payoffs (aggregate for multi-leg strategies)
    return range.map((price, i) => {
        const payoff = legPayoffs.reduce((sum, legPts) => sum + legPts[i].payoff, 0);
        const t0Value = legPayoffs.reduce((sum, legPts) => sum + legPts[i].t0Value, 0);
        return { price, payoff, t0Value };
    });
}

/**
 * Calculate aggregate Greeks for a strategy (holistic calculation)
 * Per Thales research: "The position's overall risk profile is the sum of 
 * the Greeks of each leg. Long positions contribute positively, 
 * while short positions contribute negatively."
 */
export function calculateStrategyGreeks(
    strategy: Strategy,
    daysToExpiry: number = 30,
    riskFreeRate: number = 0.05
): Greeks {
    const T = daysToExpiry / 365;
    const S = strategy.underlyingPrice;

    let totalDelta = 0;
    let totalGamma = 0;
    let totalTheta = 0;
    let totalVega = 0;

    for (const leg of strategy.legs) {
        const greeks = calculateGreeks(S, leg.strike, T, riskFreeRate, leg.iv, leg.type);
        const multiplier = leg.direction === 'long' ? 1 : -1;
        const contractSize = leg.quantity * 100;

        // Aggregate with correct signs
        totalDelta += greeks.delta * multiplier * contractSize;
        totalGamma += greeks.gamma * multiplier * contractSize;
        totalTheta += greeks.theta * multiplier * contractSize;
        totalVega += greeks.vega * multiplier * contractSize;
    }

    return {
        delta: totalDelta,
        gamma: totalGamma,
        theta: totalTheta,
        vega: totalVega,
    };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate price range array for payoff calculations
 */
export function generatePriceRange(
    centerPrice: number,
    rangePercent: number = 0.3,
    points: number = 100
): number[] {
    const min = centerPrice * (1 - rangePercent);
    const max = centerPrice * (1 + rangePercent);
    const step = (max - min) / (points - 1);

    return Array.from({ length: points }, (_, i) => min + i * step);
}

/**
 * Calculate breakeven points for a strategy
 */
export function calculateBreakevens(payoffCurve: PayoffPoint[]): number[] {
    const breakevens: number[] = [];

    for (let i = 1; i < payoffCurve.length; i++) {
        const prev = payoffCurve[i - 1];
        const curr = payoffCurve[i];

        // Check if payoff crosses zero
        if ((prev.payoff <= 0 && curr.payoff >= 0) || (prev.payoff >= 0 && curr.payoff <= 0)) {
            // Linear interpolation to find exact breakeven
            const ratio = Math.abs(prev.payoff) / (Math.abs(prev.payoff) + Math.abs(curr.payoff));
            const breakeven = prev.price + ratio * (curr.price - prev.price);
            breakevens.push(Number(breakeven.toFixed(2)));
        }
    }

    return breakevens;
}

/**
 * Calculate max profit and max loss for a strategy
 */
export function calculateMaxProfitLoss(payoffCurve: PayoffPoint[]): { maxProfit: number; maxLoss: number } {
    const payoffs = payoffCurve.map(p => p.payoff);
    return {
        maxProfit: Math.max(...payoffs),
        maxLoss: Math.min(...payoffs),
    };
}

/**
 * Calculate time to expiry with high precision
 * @param expiryTimestamp - Expiry time in milliseconds
 * @returns Time to expiry in years
 */
export function calculateTimeToExpiry(expiryTimestamp: number): number {
    const now = Date.now();
    const msToExpiry = expiryTimestamp - now;
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    return Math.max(0, msToExpiry / msPerYear);
}
