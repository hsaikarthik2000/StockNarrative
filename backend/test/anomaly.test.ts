import { describe, expect, it } from 'vitest';
import { detectLatestAnomaly, populationZScore, type MarketBar } from '../src/services/anomaly';

function baselineWithSpike(): MarketBar[] {
  const bars: MarketBar[] = [];
  let close = 100;
  for (let index = 0; index < 31; index += 1) {
    if (index > 0) close *= index % 2 === 0 ? 1.01 : 1.012;
    bars.push({ time: `2026-08-${String(index + 1).padStart(2, '0')}`, close, volume: index % 2 === 0 ? 1000 : 1100 });
  }
  bars.push({ time: '2026-09-01T20:00:00Z', close: close * 1.1, volume: 5000 });
  return bars;
}

describe('rolling anomaly detection', () => {
  it('uses the population z-score and flags price and volume spikes', () => {
    expect(populationZScore(5, [1, 2, 3])).toBeCloseTo(3.6742346);
    const event = detectLatestAnomaly(baselineWithSpike());
    expect(event?.occurredAt).toBe('2026-09-01T20:00:00Z');
    expect(event?.direction).toBe('up');
    expect(event?.triggerReasons).toEqual(['price_zscore', 'volume_zscore']);
    expect(event?.volumeMultiple).toBeGreaterThan(4);
  });

  it('ignores an incomplete latest bar', () => {
    const bars = baselineWithSpike();
    const completeEvent = detectLatestAnomaly(bars);
    bars.push({ time: '2026-09-02T20:00:00Z', close: 500, volume: 50000, complete: false });
    expect(detectLatestAnomaly(bars)).toEqual(completeEvent);
  });

  it('returns no event while warming up or when the baseline has zero variance', () => {
    expect(detectLatestAnomaly(baselineWithSpike().slice(0, 20))).toBeNull();
    const flatBars = Array.from({ length: 32 }, (_, index) => ({ time: `2026-${String(index + 1).padStart(2, '0')}-01`, close: 100, volume: 1000 }));
    flatBars[31] = { ...flatBars[31], close: 130, volume: 9000 };
    expect(detectLatestAnomaly(flatBars)).toBeNull();
  });

  it('rejects invalid period counts', () => {
    expect(() => detectLatestAnomaly([], 1)).toThrow(RangeError);
  });
});