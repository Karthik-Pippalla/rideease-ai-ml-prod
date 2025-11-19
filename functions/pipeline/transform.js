// Transform: construct features from raw events
const { RawEvent } = require('./ingest');

async function buildSessions({ windowMinutes = 60 } = {}) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const events = await RawEvent.find({ ts: { $gte: since } }).lean();
  const byUser = new Map();
  for (const e of events) {
    if (!byUser.has(e.userId)) byUser.set(e.userId, []);
    byUser.get(e.userId).push(e);
  }
  const sessions = [];
  for (const [userId, evts] of byUser) {
    evts.sort((a, b) => new Date(a.ts) - new Date(b.ts));
    sessions.push({ userId, events: evts, start: evts[0]?.ts, end: evts.at(-1)?.ts });
  }
  return sessions;
}

module.exports = { buildSessions };
