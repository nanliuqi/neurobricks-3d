import { describe, expect, it } from 'vitest';
import {
  clopperPearsonInterval,
  combinePredicateVerdicts,
  seededBootstrapInterval,
  verdictForInterval,
  wilsonInterval,
} from '@/utils/statistics';

describe('trusted statistical adjudication', () => {
  it('keeps 34/36 recall inconclusive around a 95% threshold', () => {
    const [lower, upper] = wilsonInterval(34, 36, 0.95);
    expect(lower).toBeGreaterThan(0.8);
    expect(upper).toBeGreaterThan(0.95);
    expect(verdictForInterval('gte', 0.95, lower, upper)).toBe('inconclusive');
  });

  it('Clopper-Pearson is conservative and bounded at all-success edge cases', () => {
    const [lower, upper] = clopperPearsonInterval(10, 10, 0.95);
    expect(lower).toBeCloseTo(0.6915, 3);
    expect(upper).toBe(1);
  });

  it('seeded bootstrap is deterministic', () => {
    const values = [1, 2, 3, 4, 5];
    const mean = (sample: number[]) => sample.reduce((sum, value) => sum + value, 0) / sample.length;
    expect(seededBootstrapInterval(values, mean, 0.95, 500, 7))
      .toEqual(seededBootstrapInterval(values, mean, 0.95, 500, 7));
  });

  it('combines AND predicates with three-valued logic', () => {
    const result = (verdict: 'pass' | 'fail' | 'inconclusive') => ({
      predicateId: verdict,
      pointEstimate: 0,
      lowerBound: 0,
      upperBound: 1,
      effectiveSampleSize: 10,
      verdict,
    });
    expect(combinePredicateVerdicts([result('pass'), result('pass')])).toBe('pass');
    expect(combinePredicateVerdicts([result('pass'), result('inconclusive')])).toBe('inconclusive');
    expect(combinePredicateVerdicts([result('inconclusive'), result('fail')])).toBe('fail');
  });
});

