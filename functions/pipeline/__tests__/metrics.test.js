const { ndcgAtK, hitRateAtK } = require('../eval_offline');
const { assignVariant, twoProportionZTest } = require('../experimentation');

describe('ranking metrics', () => {
  test('ndcg basic', () => {
    const recs = [ { itemId: 'a' }, { itemId: 'b' }, { itemId: 'c' } ];
    const gt = ['b'];
    const v = ndcgAtK(recs, gt, 3);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  });
  test('hit rate', () => {
    const recs = [ { itemId: 'a' }, { itemId: 'b' } ];
    const gt = ['c'];
    expect(hitRateAtK(recs, gt, 2)).toBe(0);
    expect(hitRateAtK(recs, ['b'], 2)).toBe(1);
  });
});

describe('experimentation helpers', () => {
  test('assignVariant is deterministic', () => {
    expect(assignVariant('user-1')).toBe(assignVariant('user-1'));
    expect(['control', 'treatment']).toContain(assignVariant('user-99'));
  });

  test('two proportion z test with deltas', () => {
    const outcome = twoProportionZTest({ controlSuccess: 50, controlTotal: 100, treatmentSuccess: 70, treatmentTotal: 100 });
    expect(outcome.decision).toBeDefined();
    expect(outcome.ci.lower).toBeLessThan(outcome.ci.upper);
  });
});
