// Online evaluation: compute KPI from Kafka logs
// Proxy success: user watched any recommended title within N minutes of recommendation event
const { runConsumer } = require('./ingest');
const config = require('./config');

// Maintain in-memory recommendation windows keyed by userId
const recWindows = new Map(); // userId -> { items:Set<string>, expires:number }

function onEventHandler(evt) {
  const now = Date.now();
  if (evt.type === 'recommend') {
    const items = new Set((evt.payload?.items || []).map(x => x.itemId || x));
    const expires = now + config.metrics.recSuccessMinutes * 60 * 1000;
    recWindows.set(evt.userId, { items, expires });
  }
  if (evt.type === 'play' || evt.type === 'view') {
    const w = recWindows.get(evt.userId);
    if (w && w.expires >= now) {
      if (w.items.has(evt.itemId)) {
        // success event
        console.log(JSON.stringify({ kind: 'online-kpi', metric: 'rec_success', userId: evt.userId, itemId: evt.itemId, ts: new Date().toISOString() }));
      }
    }
  }
  // GC expired windows
  for (const [u, w] of recWindows) if (w.expires < now) recWindows.delete(u);
}

async function runOnlineMetrics() {
  await runConsumer({ onEvent: onEventHandler });
}

module.exports = { runOnlineMetrics, onEventHandler };
