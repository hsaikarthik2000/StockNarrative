export const ANOMALY_RULE_VERSION = 'rolling-zscore-v1';

export type MarketBar = {
  time: string;
  close: number;
  volume: number;
  complete?: boolean;
};

export type AnomalyEvent = {
  occurredAt: string;
  direction: 'up' | 'down';
  returnPercent: number;
  zPrice: number | null;
  zVolume: number | null;
  volumeMultiple: number | null;
  baselinePeriods: number;
  triggerReasons: Array<'price_zscore' | 'volume_zscore'>;
  ruleVersion: typeof ANOMALY_RULE_VERSION;
};

export function populationZScore(current: number, baseline: number[]): number | null {
  if (!Number.isFinite(current) || baseline.length === 0 || baseline.some((value) => !Number.isFinite(value))) return null;
  const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  const variance = baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / baseline.length;
  if (variance === 0) return null;
  return (current - mean) / Math.sqrt(variance);
}

export function detectLatestAnomaly(bars: MarketBar[], periods = 30): AnomalyEvent | null {
  if (!Number.isInteger(periods) || periods < 2 || periods > 252) {
    throw new RangeError('periods must be an integer between 2 and 252.');
  }

  const completedBars = bars.filter((bar) => bar.complete !== false);
  if (completedBars.length < periods + 2) return null;

  const currentBar = completedBars[completedBars.length - 1];
  const priorBars = completedBars.slice(-(periods + 2), -1);
  if (priorBars.length !== periods + 1) return null;
  if (
    !currentBar.time ||
    !Number.isFinite(currentBar.close) || currentBar.close <= 0 ||
    !Number.isFinite(currentBar.volume) || currentBar.volume < 0 ||
    priorBars.some((bar) => !Number.isFinite(bar.close) || bar.close <= 0 || !Number.isFinite(bar.volume) || bar.volume < 0)
  ) return null;

  const previousClose = priorBars[priorBars.length - 1].close;
  const currentReturn = currentBar.close / previousClose - 1;
  const priceBaseline = priorBars.slice(1).map((bar, index) => bar.close / priorBars[index].close - 1);
  const volumeBaseline = priorBars.slice(1).map((bar) => bar.volume);
  const zPrice = populationZScore(currentReturn, priceBaseline);
  const zVolume = populationZScore(currentBar.volume, volumeBaseline);
  const averageVolume = volumeBaseline.reduce((sum, value) => sum + value, 0) / volumeBaseline.length;
  const triggerReasons: AnomalyEvent['triggerReasons'] = [];

  if (zPrice !== null && Math.abs(zPrice) >= 2.5) triggerReasons.push('price_zscore');
  if (zVolume !== null && zVolume >= 3) triggerReasons.push('volume_zscore');
  if (triggerReasons.length === 0) return null;

  return {
    occurredAt: currentBar.time,
    direction: currentReturn >= 0 ? 'up' : 'down',
    returnPercent: currentReturn * 100,
    zPrice,
    zVolume,
    volumeMultiple: averageVolume > 0 ? currentBar.volume / averageVolume : null,
    baselinePeriods: periods,
    triggerReasons,
    ruleVersion: ANOMALY_RULE_VERSION,
  };
}