/**
 * Technical Indicators Library
 * Comprehensive calculations for all major technical indicators
 */

export interface OHLCV {
    time: number; // Unix timestamp
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface IndicatorValue {
    time: number;
    value: number;
}

export interface MACDValue {
    time: number;
    macd: number;
    signal: number;
    histogram: number;
}

export interface BollingerBandsValue {
    time: number;
    upper: number;
    middle: number;
    lower: number;
}

export interface StochasticValue {
    time: number;
    k: number;
    d: number;
}

export interface IchimokuValue {
    time: number;
    tenkan: number;
    kijun: number;
    senkouA: number;
    senkouB: number;
    chikou: number;
}

// ============================================================
// MOVING AVERAGES
// ============================================================

/**
 * Simple Moving Average (SMA)
 */
export function calculateSMA(data: OHLCV[], period: number): IndicatorValue[] {
    const result: IndicatorValue[] = [];

    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        result.push({
            time: data[i].time,
            value: sum / period
        });
    }

    return result;
}

/**
 * Exponential Moving Average (EMA)
 */
export function calculateEMA(data: OHLCV[], period: number): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    const multiplier = 2 / (period + 1);

    // Start with SMA for the first value
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i].close;
    }
    let ema = sum / period;
    result.push({ time: data[period - 1].time, value: ema });

    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
        ema = (data[i].close - ema) * multiplier + ema;
        result.push({ time: data[i].time, value: ema });
    }

    return result;
}

/**
 * Weighted Moving Average (WMA)
 */
export function calculateWMA(data: OHLCV[], period: number): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    const denominator = (period * (period + 1)) / 2;

    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close * (period - j);
        }
        result.push({
            time: data[i].time,
            value: sum / denominator
        });
    }

    return result;
}

/**
 * Hull Moving Average (HMA) - Faster and smoother
 */
export function calculateHMA(data: OHLCV[], period: number): IndicatorValue[] {
    const halfPeriod = Math.floor(period / 2);
    const sqrtPeriod = Math.floor(Math.sqrt(period));

    const wmaHalf = calculateWMA(data, halfPeriod);
    const wmaFull = calculateWMA(data, period);

    // Create synthetic data for final WMA
    const diff: OHLCV[] = [];
    const startIdx = period - halfPeriod;

    for (let i = 0; i < wmaFull.length; i++) {
        const halfIdx = i + startIdx;
        if (halfIdx < wmaHalf.length) {
            diff.push({
                time: wmaFull[i].time,
                open: 0,
                high: 0,
                low: 0,
                close: 2 * wmaHalf[halfIdx].value - wmaFull[i].value,
                volume: 0
            });
        }
    }

    return calculateWMA(diff, sqrtPeriod);
}

// ============================================================
// MOMENTUM INDICATORS
// ============================================================

/**
 * Relative Strength Index (RSI)
 */
export function calculateRSI(data: OHLCV[], period: number = 14): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    // Calculate price changes
    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Calculate initial averages
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // First RSI value
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: data[period].time, value: 100 - (100 / (1 + rs)) });

    // Calculate remaining RSI values using smoothed averages
    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push({ time: data[i + 1].time, value: 100 - (100 / (1 + rs)) });
    }

    return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
    data: OHLCV[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
): MACDValue[] {
    const emaFast = calculateEMA(data, fastPeriod);
    const emaSlow = calculateEMA(data, slowPeriod);

    // Calculate MACD line (fast EMA - slow EMA)
    const macdLine: { time: number; close: number }[] = [];
    const offset = slowPeriod - fastPeriod;

    for (let i = 0; i < emaSlow.length; i++) {
        macdLine.push({
            time: emaSlow[i].time,
            close: emaFast[i + offset].value - emaSlow[i].value
        });
    }

    // Calculate signal line (EMA of MACD)
    const signalData: OHLCV[] = macdLine.map(d => ({
        time: d.time,
        open: d.close,
        high: d.close,
        low: d.close,
        close: d.close,
        volume: 0
    }));

    const signalLine = calculateEMA(signalData, signalPeriod);

    // Combine results
    const result: MACDValue[] = [];
    for (let i = 0; i < signalLine.length; i++) {
        const macdIdx = i + signalPeriod - 1;
        result.push({
            time: signalLine[i].time,
            macd: macdLine[macdIdx].close,
            signal: signalLine[i].value,
            histogram: macdLine[macdIdx].close - signalLine[i].value
        });
    }

    return result;
}

/**
 * Stochastic Oscillator
 */
export function calculateStochastic(
    data: OHLCV[],
    kPeriod: number = 14,
    dPeriod: number = 3
): StochasticValue[] {
    const result: StochasticValue[] = [];
    const kValues: number[] = [];

    // Calculate %K
    for (let i = kPeriod - 1; i < data.length; i++) {
        let highestHigh = -Infinity;
        let lowestLow = Infinity;

        for (let j = 0; j < kPeriod; j++) {
            highestHigh = Math.max(highestHigh, data[i - j].high);
            lowestLow = Math.min(lowestLow, data[i - j].low);
        }

        const range = highestHigh - lowestLow;
        const k = range === 0 ? 50 : ((data[i].close - lowestLow) / range) * 100;
        kValues.push(k);
    }

    // Calculate %D (SMA of %K)
    for (let i = dPeriod - 1; i < kValues.length; i++) {
        let sum = 0;
        for (let j = 0; j < dPeriod; j++) {
            sum += kValues[i - j];
        }
        result.push({
            time: data[i + kPeriod - 1].time,
            k: kValues[i],
            d: sum / dPeriod
        });
    }

    return result;
}

/**
 * Commodity Channel Index (CCI)
 */
export function calculateCCI(data: OHLCV[], period: number = 20): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    const constant = 0.015;

    // Calculate Typical Prices
    const typicalPrices = data.map(d => (d.high + d.low + d.close) / 3);

    for (let i = period - 1; i < data.length; i++) {
        // Calculate SMA of typical price
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += typicalPrices[i - j];
        }
        const sma = sum / period;

        // Calculate Mean Deviation
        let meanDev = 0;
        for (let j = 0; j < period; j++) {
            meanDev += Math.abs(typicalPrices[i - j] - sma);
        }
        meanDev /= period;

        const cci = meanDev === 0 ? 0 : (typicalPrices[i] - sma) / (constant * meanDev);
        result.push({ time: data[i].time, value: cci });
    }

    return result;
}

/**
 * Williams %R
 */
export function calculateWilliamsR(data: OHLCV[], period: number = 14): IndicatorValue[] {
    const result: IndicatorValue[] = [];

    for (let i = period - 1; i < data.length; i++) {
        let highestHigh = -Infinity;
        let lowestLow = Infinity;

        for (let j = 0; j < period; j++) {
            highestHigh = Math.max(highestHigh, data[i - j].high);
            lowestLow = Math.min(lowestLow, data[i - j].low);
        }

        const range = highestHigh - lowestLow;
        const willR = range === 0 ? -50 : ((highestHigh - data[i].close) / range) * -100;
        result.push({ time: data[i].time, value: willR });
    }

    return result;
}

/**
 * Rate of Change (ROC)
 */
export function calculateROC(data: OHLCV[], period: number = 12): IndicatorValue[] {
    const result: IndicatorValue[] = [];

    for (let i = period; i < data.length; i++) {
        const roc = ((data[i].close - data[i - period].close) / data[i - period].close) * 100;
        result.push({ time: data[i].time, value: roc });
    }

    return result;
}

/**
 * Momentum
 */
export function calculateMomentum(data: OHLCV[], period: number = 10): IndicatorValue[] {
    const result: IndicatorValue[] = [];

    for (let i = period; i < data.length; i++) {
        result.push({
            time: data[i].time,
            value: data[i].close - data[i - period].close
        });
    }

    return result;
}

// ============================================================
// VOLATILITY INDICATORS
// ============================================================

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(
    data: OHLCV[],
    period: number = 20,
    stdDev: number = 2
): BollingerBandsValue[] {
    const result: BollingerBandsValue[] = [];
    const sma = calculateSMA(data, period);

    for (let i = 0; i < sma.length; i++) {
        const dataIdx = i + period - 1;

        // Calculate standard deviation
        let sumSquares = 0;
        for (let j = 0; j < period; j++) {
            const diff = data[dataIdx - j].close - sma[i].value;
            sumSquares += diff * diff;
        }
        const std = Math.sqrt(sumSquares / period);

        result.push({
            time: sma[i].time,
            upper: sma[i].value + stdDev * std,
            middle: sma[i].value,
            lower: sma[i].value - stdDev * std
        });
    }

    return result;
}

/**
 * Average True Range (ATR)
 */
export function calculateATR(data: OHLCV[], period: number = 14): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    const trueRanges: number[] = [];

    // Calculate True Range
    for (let i = 1; i < data.length; i++) {
        const highLow = data[i].high - data[i].low;
        const highPrevClose = Math.abs(data[i].high - data[i - 1].close);
        const lowPrevClose = Math.abs(data[i].low - data[i - 1].close);
        trueRanges.push(Math.max(highLow, highPrevClose, lowPrevClose));
    }

    // First ATR is simple average
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push({ time: data[period].time, value: atr });

    // Subsequent ATRs use smoothing
    for (let i = period; i < trueRanges.length; i++) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
        result.push({ time: data[i + 1].time, value: atr });
    }

    return result;
}

/**
 * Keltner Channels
 */
export function calculateKeltnerChannels(
    data: OHLCV[],
    emaPeriod: number = 20,
    atrPeriod: number = 10,
    multiplier: number = 2
): BollingerBandsValue[] {
    const ema = calculateEMA(data, emaPeriod);
    const atr = calculateATR(data, atrPeriod);
    const result: BollingerBandsValue[] = [];

    // Align EMA and ATR
    const offset = Math.max(emaPeriod, atrPeriod + 1);

    for (let i = 0; i < Math.min(ema.length, atr.length); i++) {
        const emaIdx = i + (emaPeriod < atrPeriod + 1 ? atrPeriod + 1 - emaPeriod : 0);
        const atrIdx = i + (atrPeriod + 1 < emaPeriod ? emaPeriod - atrPeriod - 1 : 0);

        if (emaIdx < ema.length && atrIdx < atr.length) {
            result.push({
                time: ema[emaIdx].time,
                upper: ema[emaIdx].value + multiplier * atr[atrIdx].value,
                middle: ema[emaIdx].value,
                lower: ema[emaIdx].value - multiplier * atr[atrIdx].value
            });
        }
    }

    return result;
}

/**
 * Donchian Channels
 */
export function calculateDonchianChannels(data: OHLCV[], period: number = 20): BollingerBandsValue[] {
    const result: BollingerBandsValue[] = [];

    for (let i = period - 1; i < data.length; i++) {
        let highestHigh = -Infinity;
        let lowestLow = Infinity;

        for (let j = 0; j < period; j++) {
            highestHigh = Math.max(highestHigh, data[i - j].high);
            lowestLow = Math.min(lowestLow, data[i - j].low);
        }

        result.push({
            time: data[i].time,
            upper: highestHigh,
            middle: (highestHigh + lowestLow) / 2,
            lower: lowestLow
        });
    }

    return result;
}

// ============================================================
// VOLUME INDICATORS
// ============================================================

/**
 * Volume Weighted Average Price (VWAP)
 * Note: VWAP typically resets daily, this calculates cumulative VWAP
 */
export function calculateVWAP(data: OHLCV[]): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    let cumulativeTPV = 0; // Typical Price * Volume
    let cumulativeVolume = 0;

    for (const candle of data) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3;
        cumulativeTPV += typicalPrice * candle.volume;
        cumulativeVolume += candle.volume;

        result.push({
            time: candle.time,
            value: cumulativeVolume === 0 ? typicalPrice : cumulativeTPV / cumulativeVolume
        });
    }

    return result;
}

/**
 * VWAP with Standard Deviation Bands
 */
export function calculateVWAPBands(
    data: OHLCV[],
    stdDevMultiplier: number = 2
): { vwap: IndicatorValue[]; upper: IndicatorValue[]; lower: IndicatorValue[] } {
    const vwap: IndicatorValue[] = [];
    const upper: IndicatorValue[] = [];
    const lower: IndicatorValue[] = [];

    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    let cumulativeTPV2 = 0; // For variance calculation

    for (const candle of data) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3;
        cumulativeTPV += typicalPrice * candle.volume;
        cumulativeTPV2 += typicalPrice * typicalPrice * candle.volume;
        cumulativeVolume += candle.volume;

        const vwapValue = cumulativeVolume === 0 ? typicalPrice : cumulativeTPV / cumulativeVolume;

        // Calculate standard deviation
        const variance = cumulativeVolume === 0 ? 0 :
            (cumulativeTPV2 / cumulativeVolume) - (vwapValue * vwapValue);
        const stdDev = Math.sqrt(Math.max(0, variance));

        vwap.push({ time: candle.time, value: vwapValue });
        upper.push({ time: candle.time, value: vwapValue + stdDevMultiplier * stdDev });
        lower.push({ time: candle.time, value: vwapValue - stdDevMultiplier * stdDev });
    }

    return { vwap, upper, lower };
}

/**
 * On-Balance Volume (OBV)
 */
export function calculateOBV(data: OHLCV[]): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    let obv = 0;

    result.push({ time: data[0].time, value: obv });

    for (let i = 1; i < data.length; i++) {
        if (data[i].close > data[i - 1].close) {
            obv += data[i].volume;
        } else if (data[i].close < data[i - 1].close) {
            obv -= data[i].volume;
        }
        result.push({ time: data[i].time, value: obv });
    }

    return result;
}

/**
 * Accumulation/Distribution Line
 */
export function calculateADL(data: OHLCV[]): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    let adl = 0;

    for (const candle of data) {
        const range = candle.high - candle.low;
        const moneyFlowMultiplier = range === 0 ? 0 :
            ((candle.close - candle.low) - (candle.high - candle.close)) / range;
        const moneyFlowVolume = moneyFlowMultiplier * candle.volume;
        adl += moneyFlowVolume;

        result.push({ time: candle.time, value: adl });
    }

    return result;
}

/**
 * Money Flow Index (MFI) - Volume-weighted RSI
 */
export function calculateMFI(data: OHLCV[], period: number = 14): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    const typicalPrices: number[] = [];
    const rawMoneyFlow: number[] = [];

    // Calculate typical prices and raw money flow
    for (const candle of data) {
        const tp = (candle.high + candle.low + candle.close) / 3;
        typicalPrices.push(tp);
        rawMoneyFlow.push(tp * candle.volume);
    }

    // Calculate MFI
    for (let i = period; i < data.length; i++) {
        let positiveFlow = 0;
        let negativeFlow = 0;

        for (let j = i - period + 1; j <= i; j++) {
            if (typicalPrices[j] > typicalPrices[j - 1]) {
                positiveFlow += rawMoneyFlow[j];
            } else if (typicalPrices[j] < typicalPrices[j - 1]) {
                negativeFlow += rawMoneyFlow[j];
            }
        }

        const mfr = negativeFlow === 0 ? 100 : positiveFlow / negativeFlow;
        const mfi = 100 - (100 / (1 + mfr));

        result.push({ time: data[i].time, value: mfi });
    }

    return result;
}

/**
 * Chaikin Money Flow (CMF)
 */
export function calculateCMF(data: OHLCV[], period: number = 20): IndicatorValue[] {
    const result: IndicatorValue[] = [];

    for (let i = period - 1; i < data.length; i++) {
        let sumMFV = 0;
        let sumVolume = 0;

        for (let j = 0; j < period; j++) {
            const candle = data[i - j];
            const range = candle.high - candle.low;
            const mfm = range === 0 ? 0 :
                ((candle.close - candle.low) - (candle.high - candle.close)) / range;
            sumMFV += mfm * candle.volume;
            sumVolume += candle.volume;
        }

        result.push({
            time: data[i].time,
            value: sumVolume === 0 ? 0 : sumMFV / sumVolume
        });
    }

    return result;
}

// ============================================================
// TREND INDICATORS
// ============================================================

/**
 * Average Directional Index (ADX)
 */
export function calculateADX(data: OHLCV[], period: number = 14): IndicatorValue[] {
    const result: IndicatorValue[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];
    const trueRanges: number[] = [];

    // Calculate +DM, -DM, and TR
    for (let i = 1; i < data.length; i++) {
        const highDiff = data[i].high - data[i - 1].high;
        const lowDiff = data[i - 1].low - data[i].low;

        plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
        minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

        const tr = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - data[i - 1].close),
            Math.abs(data[i].low - data[i - 1].close)
        );
        trueRanges.push(tr);
    }

    // Smooth the values
    let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);

    const dxValues: number[] = [];

    for (let i = period - 1; i < plusDM.length; i++) {
        if (i > period - 1) {
            smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
            smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];
            smoothedTR = smoothedTR - (smoothedTR / period) + trueRanges[i];
        }

        const plusDI = smoothedTR === 0 ? 0 : (smoothedPlusDM / smoothedTR) * 100;
        const minusDI = smoothedTR === 0 ? 0 : (smoothedMinusDM / smoothedTR) * 100;
        const diSum = plusDI + minusDI;
        const dx = diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100;
        dxValues.push(dx);
    }

    // Calculate ADX (smoothed DX)
    let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push({ time: data[2 * period - 1].time, value: adx });

    for (let i = period; i < dxValues.length; i++) {
        adx = ((adx * (period - 1)) + dxValues[i]) / period;
        result.push({ time: data[i + period].time, value: adx });
    }

    return result;
}

/**
 * Parabolic SAR
 */
export function calculateParabolicSAR(
    data: OHLCV[],
    step: number = 0.02,
    max: number = 0.2
): IndicatorValue[] {
    const result: IndicatorValue[] = [];

    if (data.length < 2) return result;

    let isUptrend = data[1].close > data[0].close;
    let sar = isUptrend ? data[0].low : data[0].high;
    let ep = isUptrend ? data[1].high : data[1].low;
    let af = step;

    result.push({ time: data[0].time, value: sar });

    for (let i = 1; i < data.length; i++) {
        // Calculate new SAR
        sar = sar + af * (ep - sar);

        // Adjust SAR if it penetrates price
        if (isUptrend) {
            sar = Math.min(sar, data[i - 1].low);
            if (i > 1) sar = Math.min(sar, data[i - 2].low);

            if (data[i].low < sar) {
                isUptrend = false;
                sar = ep;
                ep = data[i].low;
                af = step;
            } else {
                if (data[i].high > ep) {
                    ep = data[i].high;
                    af = Math.min(af + step, max);
                }
            }
        } else {
            sar = Math.max(sar, data[i - 1].high);
            if (i > 1) sar = Math.max(sar, data[i - 2].high);

            if (data[i].high > sar) {
                isUptrend = true;
                sar = ep;
                ep = data[i].high;
                af = step;
            } else {
                if (data[i].low < ep) {
                    ep = data[i].low;
                    af = Math.min(af + step, max);
                }
            }
        }

        result.push({ time: data[i].time, value: sar });
    }

    return result;
}

/**
 * Ichimoku Cloud
 */
export function calculateIchimoku(
    data: OHLCV[],
    conversionPeriod: number = 9,
    basePeriod: number = 26,
    spanBPeriod: number = 52,
    displacement: number = 26
): IchimokuValue[] {
    const result: IchimokuValue[] = [];

    const getHighLow = (startIdx: number, period: number) => {
        let high = -Infinity;
        let low = Infinity;
        for (let i = 0; i < period && startIdx - i >= 0; i++) {
            high = Math.max(high, data[startIdx - i].high);
            low = Math.min(low, data[startIdx - i].low);
        }
        return { high, low };
    };

    for (let i = Math.max(conversionPeriod, basePeriod, spanBPeriod) - 1; i < data.length; i++) {
        const convHL = getHighLow(i, conversionPeriod);
        const baseHL = getHighLow(i, basePeriod);
        const spanBHL = getHighLow(i, spanBPeriod);

        const tenkan = (convHL.high + convHL.low) / 2;
        const kijun = (baseHL.high + baseHL.low) / 2;
        const senkouA = (tenkan + kijun) / 2;
        const senkouB = (spanBHL.high + spanBHL.low) / 2;
        const chikou = data[i].close; // Displayed 26 periods back

        result.push({
            time: data[i].time,
            tenkan,
            kijun,
            senkouA,
            senkouB,
            chikou
        });
    }

    return result;
}

/**
 * Supertrend
 */
export function calculateSupertrend(
    data: OHLCV[],
    period: number = 10,
    multiplier: number = 3
): IndicatorValue[] {
    const atr = calculateATR(data, period);
    const result: IndicatorValue[] = [];

    if (atr.length === 0) return result;

    let isUptrend = true;
    let upperBand = 0;
    let lowerBand = 0;
    let prevUpperBand = 0;
    let prevLowerBand = 0;

    for (let i = 0; i < atr.length; i++) {
        const dataIdx = i + period;
        const hl2 = (data[dataIdx].high + data[dataIdx].low) / 2;

        const basicUpperBand = hl2 + multiplier * atr[i].value;
        const basicLowerBand = hl2 - multiplier * atr[i].value;

        upperBand = basicUpperBand < prevUpperBand || data[dataIdx - 1].close > prevUpperBand
            ? basicUpperBand
            : prevUpperBand;

        lowerBand = basicLowerBand > prevLowerBand || data[dataIdx - 1].close < prevLowerBand
            ? basicLowerBand
            : prevLowerBand;

        if (i === 0) {
            isUptrend = true;
        } else {
            if (data[dataIdx].close > prevUpperBand) {
                isUptrend = true;
            } else if (data[dataIdx].close < prevLowerBand) {
                isUptrend = false;
            }
        }

        result.push({
            time: atr[i].time,
            value: isUptrend ? lowerBand : upperBand
        });

        prevUpperBand = upperBand;
        prevLowerBand = lowerBand;
    }

    return result;
}

// ============================================================
// PIVOT POINTS
// ============================================================

/**
 * Standard Pivot Points
 */
export function calculatePivotPoints(candle: OHLCV): {
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
} {
    const pivot = (candle.high + candle.low + candle.close) / 3;
    const range = candle.high - candle.low;

    return {
        pivot,
        r1: 2 * pivot - candle.low,
        r2: pivot + range,
        r3: pivot + 2 * range,
        s1: 2 * pivot - candle.high,
        s2: pivot - range,
        s3: pivot - 2 * range
    };
}

// ============================================================
// HELPER TYPES FOR INDICATOR CONFIGURATION
// ============================================================

export type IndicatorType =
    | 'sma'
    | 'ema'
    | 'wma'
    | 'hma'
    | 'rsi'
    | 'macd'
    | 'stochastic'
    | 'cci'
    | 'williamsR'
    | 'roc'
    | 'momentum'
    | 'bb'
    | 'atr'
    | 'keltner'
    | 'donchian'
    | 'vwap'
    | 'obv'
    | 'adl'
    | 'mfi'
    | 'cmf'
    | 'adx'
    | 'psar'
    | 'ichimoku'
    | 'supertrend';

export interface IndicatorConfig {
    type: IndicatorType;
    params: Record<string, number>;
    color?: string;
    visible?: boolean;
    pane?: 'main' | 'sub1' | 'sub2';
}

export const DEFAULT_INDICATOR_CONFIGS: Record<IndicatorType, IndicatorConfig> = {
    sma: { type: 'sma', params: { period: 20 }, color: '#ffd700', pane: 'main' },
    ema: { type: 'ema', params: { period: 20 }, color: '#00bfff', pane: 'main' },
    wma: { type: 'wma', params: { period: 20 }, color: '#ff69b4', pane: 'main' },
    hma: { type: 'hma', params: { period: 20 }, color: '#32cd32', pane: 'main' },
    rsi: { type: 'rsi', params: { period: 14 }, color: '#a855f7', pane: 'sub1' },
    macd: { type: 'macd', params: { fast: 12, slow: 26, signal: 9 }, color: '#22c55e', pane: 'sub2' },
    stochastic: { type: 'stochastic', params: { k: 14, d: 3 }, color: '#f97316', pane: 'sub1' },
    cci: { type: 'cci', params: { period: 20 }, color: '#06b6d4', pane: 'sub1' },
    williamsR: { type: 'williamsR', params: { period: 14 }, color: '#ec4899', pane: 'sub1' },
    roc: { type: 'roc', params: { period: 12 }, color: '#8b5cf6', pane: 'sub1' },
    momentum: { type: 'momentum', params: { period: 10 }, color: '#14b8a6', pane: 'sub1' },
    bb: { type: 'bb', params: { period: 20, stdDev: 2 }, color: '#64748b', pane: 'main' },
    atr: { type: 'atr', params: { period: 14 }, color: '#f59e0b', pane: 'sub1' },
    keltner: { type: 'keltner', params: { ema: 20, atr: 10, mult: 2 }, color: '#84cc16', pane: 'main' },
    donchian: { type: 'donchian', params: { period: 20 }, color: '#0ea5e9', pane: 'main' },
    vwap: { type: 'vwap', params: {}, color: '#e11d48', pane: 'main' },
    obv: { type: 'obv', params: {}, color: '#7c3aed', pane: 'sub2' },
    adl: { type: 'adl', params: {}, color: '#0891b2', pane: 'sub2' },
    mfi: { type: 'mfi', params: { period: 14 }, color: '#c026d3', pane: 'sub1' },
    cmf: { type: 'cmf', params: { period: 20 }, color: '#059669', pane: 'sub1' },
    adx: { type: 'adx', params: { period: 14 }, color: '#dc2626', pane: 'sub1' },
    psar: { type: 'psar', params: { step: 0.02, max: 0.2 }, color: '#fbbf24', pane: 'main' },
    ichimoku: { type: 'ichimoku', params: { conv: 9, base: 26, spanB: 52, disp: 26 }, color: '#3b82f6', pane: 'main' },
    supertrend: { type: 'supertrend', params: { period: 10, mult: 3 }, color: '#10b981', pane: 'main' }
};
