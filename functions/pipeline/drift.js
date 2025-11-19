// Drift detection on user/item interaction distributions
const { RawEvent } = require('./ingest');

async function computeDistribution({ hours = 24 } = {}) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const events = await RawEvent.find({ ts: { $gte: since } }).lean();
  const userCounts = new Map();
  const itemCounts = new Map();
  for (const e of events) {
    if (e.type === 'play' || e.type === 'view') {
      userCounts.set(e.userId, (userCounts.get(e.userId) || 0) + 1);
      itemCounts.set(e.itemId, (itemCounts.get(e.itemId) || 0) + 1);
    }
  }
  const totalUsers = Array.from(userCounts.values()).reduce((a,b)=>a+b,0) || 1;
  const totalItems = Array.from(itemCounts.values()).reduce((a,b)=>a+b,0) || 1;
  const userDist = Array.from(userCounts.values()).map(v => v/totalUsers);
  const itemDist = Array.from(itemCounts.values()).map(v => v/totalItems);
  return { userDist, itemDist };
}

function kl(p, q) { // p, q arrays of probabilities
  let s = 0;
  for (let i=0;i<p.length;i++) {
    const pi = p[i];
    const qi = q[i] ?? 1e-12;
    if (pi > 0 && qi > 0) s += pi * Math.log(pi/qi);
  }
  return s;
}

function populationStats(dist) {
  const mean = dist.reduce((a,b)=>a+b,0)/dist.length;
  const varc = dist.reduce((a,b)=>a+(b-mean)**2,0)/dist.length;
  return { mean, var: varc };
}

async function detectDrift({ baseline, threshold = 0.5 } = {}) {
  const current = await computeDistribution({ hours: 24 });
  const res = {};
  for (const kind of ['userDist','itemDist']) {
    const cur = current[kind];
    const base = baseline[kind];
    const minLen = Math.min(cur.length, base.length);
    const klVal = kl(cur.slice(0,minLen), base.slice(0,minLen));
    const statsCur = populationStats(cur);
    const statsBase = populationStats(base);
    res[kind] = { kl: klVal, statsCur, statsBase, drift: klVal > threshold };
  }
  return res;
}

module.exports = { computeDistribution, detectDrift };
