// Fairness evaluation tests
const { computeExposureShares, computeDiversity, evaluateFairness, computeGiniCoefficient } = require('../fairness');
const { RawEvent } = require('../ingest');
const { connect, disconnect } = require('../db');

describe('Fairness', () => {
  beforeAll(async () => {
    await connect();
  });
  
  afterAll(async () => {
    await disconnect();
  });
  
  beforeEach(async () => {
    await RawEvent.deleteMany({});
  });
  
  test('computeExposureShares with empty data', async () => {
    const result = await computeExposureShares({ windowHours: 24 });
    expect(result.totalExposures).toBe(0);
    expect(Object.keys(result.shares)).toHaveLength(0);
  });
  
  test('computeExposureShares with test data', async () => {
    await RawEvent.create({
      type: 'recommend',
      userId: 'user1',
      ts: new Date(),
      payload: { items: ['item1', 'item2'], variant: 'control' },
    });
    
    const result = await computeExposureShares({ windowHours: 24 });
    expect(result.totalExposures).toBe(2);
    expect(result.shares.item1.share).toBe(0.5);
    expect(result.shares.item2.share).toBe(0.5);
  });
  
  test('computeDiversity calculates metrics', async () => {
    await RawEvent.create([
      { type: 'recommend', userId: 'u1', ts: new Date(), payload: { items: ['item1', 'item2'] } },
      { type: 'recommend', userId: 'u2', ts: new Date(), payload: { items: ['item2', 'item3'] } },
    ]);
    
    const result = await computeDiversity({ windowHours: 24 });
    expect(result).toHaveProperty('entropy');
    expect(result).toHaveProperty('coverage');
    expect(result).toHaveProperty('avgIntraListDiversity');
    expect(result.coverage).toBe(3); // item1, item2, item3
  });
  
  test('computeGiniCoefficient with uniform distribution', () => {
    const shares = {
      item1: { share: 0.25 },
      item2: { share: 0.25 },
      item3: { share: 0.25 },
      item4: { share: 0.25 },
    };
    const gini = computeGiniCoefficient(shares);
    expect(gini).toBe(0); // Perfect equality
  });
  
  test('computeGiniCoefficient with unequal distribution', () => {
    const shares = {
      item1: { share: 0.9 },
      item2: { share: 0.1 },
    };
    const gini = computeGiniCoefficient(shares);
    expect(gini).toBeGreaterThan(0);
  });
  
  test('evaluateFairness compares variants', async () => {
    await RawEvent.create([
      { type: 'recommend', userId: 'u1', ts: new Date(), payload: { items: ['item1'], variant: 'control' } },
      { type: 'recommend', userId: 'u2', ts: new Date(), payload: { items: ['item2'], variant: 'treatment' } },
    ]);
    
    const result = await evaluateFairness({ windowHours: 24 });
    expect(result).toHaveProperty('exposure');
    expect(result).toHaveProperty('diversity');
    expect(result).toHaveProperty('summary');
    expect(result.exposure).toHaveProperty('control');
    expect(result.exposure).toHaveProperty('treatment');
  });
  
  test('computeExposureShares validates windowHours', async () => {
    await expect(computeExposureShares({ windowHours: 1000 })).rejects.toThrow();
  });
});

