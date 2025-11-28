// Feedback loop detection tests
const { detectFeedbackLoops, detectFeedbackAnomalies, computeAmplification } = require('../feedbackLoop');
const { RawEvent } = require('../ingest');
const { connect, disconnect } = require('../db');

describe('Feedback Loops', () => {
  beforeAll(async () => {
    await connect();
  });
  
  afterAll(async () => {
    await disconnect();
  });
  
  beforeEach(async () => {
    await RawEvent.deleteMany({});
  });
  
  test('detectFeedbackLoops with no data', async () => {
    const result = await detectFeedbackLoops({ windowHours: 168 });
    expect(result.feedbackLoops).toBe(0);
    expect(result.avgCycleTimeHours).toBe(0);
  });
  
  test('detectFeedbackLoops with cycle', async () => {
    const now = new Date();
    // Create recommend → interact → recommend cycle
    await RawEvent.create([
      { type: 'recommend', userId: 'u1', ts: new Date(now - 10000), payload: { items: ['item1'] } },
      { type: 'play', userId: 'u1', itemId: 'item1', ts: new Date(now - 5000) },
      { type: 'recommend', userId: 'u1', ts: now, payload: { items: ['item1'] } },
    ]);
    
    const result = await detectFeedbackLoops({ windowHours: 168 });
    expect(result.feedbackLoops).toBeGreaterThan(0);
    expect(result.avgCycleTimeHours).toBeGreaterThan(0);
  });
  
  test('detectFeedbackAnomalies flags short cycles', async () => {
    const now = new Date();
    // Create very short cycle (< 1 hour)
    await RawEvent.create([
      { type: 'recommend', userId: 'u1', ts: new Date(now - 3600000), payload: { items: ['item1'] } },
      { type: 'play', userId: 'u1', itemId: 'item1', ts: new Date(now - 1800000) },
      { type: 'recommend', userId: 'u1', ts: now, payload: { items: ['item1'] } },
    ]);
    
    const result = await detectFeedbackAnomalies({ windowHours: 168 });
    expect(result).toHaveProperty('anomalies');
    expect(result).toHaveProperty('summary');
  });
  
  test('computeAmplification detects amplification', async () => {
    const now = new Date();
    const since = new Date(now - 100000);
    
    const recommendations = [
      { ts: new Date(now - 50000), payload: { items: ['item1'] } },
    ];
    
    const interactions = [
      { itemId: 'item1', ts: new Date(now - 60000) }, // Before
      { itemId: 'item1', ts: new Date(now - 40000) }, // After
      { itemId: 'item1', ts: new Date(now - 30000) }, // After
    ];
    
    const amplification = await computeAmplification({ since, recommendations, interactions });
    expect(amplification).toHaveProperty('avgAmplificationRatio');
    expect(amplification).toHaveProperty('topAmplified');
  });
});

