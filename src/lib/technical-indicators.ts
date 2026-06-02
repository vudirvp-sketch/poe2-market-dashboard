// ============================================================================
// Technical Indicators — P3-1: SMA, EMA, RSI Calculations
//
// Pure functions for computing technical indicators from price series.
// These are used by the forecast chart overlay and the candlestick component.
// ============================================================================

/**
 * Simple Moving Average (SMA).
 * Returns an array of the same length as `prices`, with `null` for positions
 * where not enough data points are available.
 */
export function computeSMA(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += prices[j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Exponential Moving Average (EMA).
 * Uses the standard EMA formula:
 *   EMA[t] = price[t] * multiplier + EMA[t-1] * (1 - multiplier)
 *   multiplier = 2 / (period + 1)
 * Seeds with SMA for the first `period` data points.
 */
export function computeEMA(prices: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  // Seed with SMA
  if (prices.length < period) {
    return prices.map(() => null);
  }

  // First value: SMA of first `period` prices
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
    if (i < period - 1) {
      result.push(null);
    }
  }
  result.push(sum / period);

  // Subsequent values: EMA formula
  for (let i = period; i < prices.length; i++) {
    const prevEMA = result[i - 1]!;
    const ema = prices[i] * multiplier + prevEMA * (1 - multiplier);
    result.push(ema);
  }

  return result;
}

/**
 * Relative Strength Index (RSI).
 * Uses the Wilder smoothing method (exponential).
 *
 * @param prices - Array of closing prices
 * @param period - RSI period (typically 14)
 * @returns Array of RSI values (0-100), null for insufficient data
 */
export function computeRSI(prices: number[], period: number = 14): (number | null)[] {
  if (prices.length < period + 1) {
    return prices.map(() => null);
  }

  const result: (number | null)[] = [];

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Initial average gain/loss (simple average)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value (at index = period)
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - 100 / (1 + rs));

  // Subsequent RSI values (Wilder smoothing)
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(avgLoss === 0 && avgGain === 0 ? 50 : 100 - 100 / (1 + rs));
  }

  return result;
}

/**
 * Bollinger Bands.
 * Returns upper, middle (SMA), and lower bands.
 */
export function computeBollingerBands(
  prices: number[],
  period: number = 20,
  stdMultiplier: number = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = computeSMA(prices, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
    } else {
      // Calculate standard deviation for the window
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += (prices[j] - middle[i]!) ** 2;
      }
      const std = Math.sqrt(sumSq / period);
      upper.push(middle[i]! + stdMultiplier * std);
      lower.push(middle[i]! - stdMultiplier * std);
    }
  }

  return { upper, middle, lower };
}

/**
 * MACD (Moving Average Convergence Divergence).
 * @returns { macdLine, signalLine, histogram }
 */
export function computeMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const fastEMA = computeEMA(prices, fastPeriod);
  const slowEMA = computeEMA(prices, slowPeriod);

  // MACD Line = Fast EMA - Slow EMA
  const macdLine: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdLine.push(fastEMA[i]! - slowEMA[i]!);
    } else {
      macdLine.push(null);
    }
  }

  // Signal Line = EMA of MACD Line
  const validMacd = macdLine.filter((v) => v !== null) as number[];
  const signalEMA = computeEMA(validMacd, signalPeriod);

  // Map signal back to original indices
  const signalLine: (number | null)[] = [];
  let macdIdx = 0;
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] !== null) {
      signalLine.push(signalEMA[macdIdx] ?? null);
      macdIdx++;
    } else {
      signalLine.push(null);
    }
  }

  // Histogram = MACD Line - Signal Line
  const histogram: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram.push(macdLine[i]! - signalLine[i]!);
    } else {
      histogram.push(null);
    }
  }

  return { macdLine, signalLine, histogram };
}
