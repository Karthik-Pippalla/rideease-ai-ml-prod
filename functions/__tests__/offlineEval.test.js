const { runOfflineEval } = require('../recommender/eval/offlineEval');

describe('offline eval', () => {
  it('computes metrics and writes report', async () => {
    const now = Date.now();
    const events = [];
    // simple synthetic: two users, two items
    for (let i = 0; i < 10; i++) {
      events.push({ userId: 'u1', itemId: 'i1', type: 'watch', timestamp: new Date(now - (1000*60*(60-i))).toISOString(), city: 'A', userAccountCreatedAt: new Date(now - 10*24*3600*1000).toISOString() });
    }
    events.push({ userId: 'u1', itemId: 'i2', type: 'watch', timestamp: new Date(now - 1000).toISOString(), city: 'A', userAccountCreatedAt: new Date(now - 10*24*3600*1000).toISOString() });
    const report = await runOfflineEval({ events, itemCatalog: ['i1','i2'], itemToGeo: { i1: { coordinates: [0,0] }, i2: { coordinates: [0.1,0.1] } }, reportDir: 'functions/reports' });
    expect(report).toBeTruthy();
    expect(report.models).toBeTruthy();
  });
});
