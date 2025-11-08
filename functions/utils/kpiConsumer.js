const { initKafka, publishKPI } = require('./kafka');
const { loadConfig } = require('../recommender/config');

// KPI consumer aggregates engagement & conversion metrics with success window logic
async function startKPIConsumer() {
  const cfg = loadConfig();
  const kafka = await initKafka();
  const consumer = kafka.consumer({ groupId: 'recommender-metrics' });
  await consumer.connect();
  await consumer.subscribe({ topic: 'rideease-recommendation_served', fromBeginning: false });
  await consumer.subscribe({ topic: 'rideease-rider_action', fromBeginning: false });
  await consumer.subscribe({ topic: 'rideease-ride_matched', fromBeginning: false });

  const windows = cfg.metrics.windows;
  const successWindowMs = (cfg.metrics.successWindowMinutes || 15) * 60 * 1000;
  const windowMs = { '5m': 5*60*1000, '1h': 60*60*1000, '24h': 24*60*60*1000 };
  const state = {}; for (const w of windows) state[w] = { served: [], actions: [], matched: [] };

  function prune(now) { for (const w of windows) { const cutoff = now - windowMs[w]; ['served','actions','matched'].forEach(list => { state[w][list] = state[w][list].filter(ev => ev.ts >= cutoff); }); } }

  function compute(now) {
    const out = {};
    for (const w of windows) {
      const s = state[w];
      const served = s.served.length;
      // Engagement within success window
      const engagedCorrelationIds = new Set();
      const servedMap = new Map();
      for (const ev of s.served) servedMap.set(ev.correlation_id, ev.ts);
      for (const a of s.actions) {
        const tsServed = servedMap.get(a.correlation_id);
        if (tsServed && (a.ts - tsServed) <= successWindowMs) engagedCorrelationIds.add(a.correlation_id);
      }
      const matchedCorrelationIds = new Set();
      for (const m of s.matched) {
        const tsServed = servedMap.get(m.correlation_id);
        if (tsServed && (m.ts - tsServed) <= successWindowMs) matchedCorrelationIds.add(m.correlation_id);
      }
      out[w] = {
        served,
        engagementRate: served ? engagedCorrelationIds.size / served : 0,
        conversionRate: served ? matchedCorrelationIds.size / served : 0,
        window: w,
        timestamp: new Date(now).toISOString()
      };
    }
    return out;
  }

  // Backpressure: monitor lag and pause if high
  async function monitorLag() {
    try {
      const admin = kafka.admin();
      await admin.connect();
      const groups = await admin.listGroups();
      // simplistic approach; real implementation would fetch offsets per partition
      await admin.disconnect();
    } catch (e) { console.warn('Lag monitor error', e.message); }
  }

  let processing = 0;
  const MAX_INFLIGHT = 100; // arbitrary backpressure threshold

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (processing >= MAX_INFLIGHT) {
        console.log('⏸ Pausing consumer due to backpressure');
        await consumer.pause([{ topic }]);
        setTimeout(async () => { console.log('▶️ Resuming consumer'); await consumer.resume([{ topic }]); }, 2000);
      }
      processing++;
      try {
        const now = Date.now();
        const raw = JSON.parse(message.value.toString());
        const payload = raw.data || raw;
        for (const w of windows) {
          if (topic.includes('recommendation_served')) state[w].served.push({ ts: now, correlation_id: payload.correlation_id });
          else if (topic.includes('rider_action')) state[w].actions.push({ ts: now, correlation_id: payload.correlation_id });
          else if (topic.includes('ride_matched')) state[w].matched.push({ ts: now, correlation_id: payload.correlation_id });
        }
        prune(now);
        const kpis = compute(now);
        for (const [w, data] of Object.entries(kpis)) { await publishKPI({ window: w, ...data }); }
      } catch (e) { console.error('KPI consumer error', e.message); } finally { processing--; }
    }
  });

  setInterval(monitorLag, 30000);
}

module.exports = { startKPIConsumer };
