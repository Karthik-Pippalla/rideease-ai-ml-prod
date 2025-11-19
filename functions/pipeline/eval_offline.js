// Offline evaluation: chronological split, ranking metrics, subpop analysis, leakage checks
const { RawEvent } = require('./ingest');

function chronologicalSplit(events, cutoffTs) {
  const train = [], test = [];
  for (const e of events) (new Date(e.ts) <= cutoffTs ? train : test).push(e);
  return { train, test };
}

function dcg(scores) {
  return scores.reduce((acc, rel, i) => acc + (rel / Math.log2(i + 2)), 0);
}

function ndcgAtK(recs, groundTruth, k = 10) {
  const gt = new Set(groundTruth);
  const relevances = recs.slice(0, k).map(r => gt.has(r.itemId) ? 1 : 0);
  const idcg = dcg(relevances.slice().sort((a,b)=>b-a));
  const real = dcg(relevances);
  return idcg === 0 ? 0 : real / idcg;
}

function hitRateAtK(recs, groundTruth, k = 10) {
  const gt = new Set(groundTruth);
  return recs.slice(0, k).some(r => gt.has(r.itemId)) ? 1 : 0;
}

function assertNoLeakage(train, test) {
  const testMin = Math.min(...test.map(e => +new Date(e.ts)));
  for (const e of train) {
    if (+new Date(e.ts) >= testMin) throw new Error('Temporal leakage detected');
  }
}

async function runOfflineEval({ cutoffHours = 24, k = 10 } = {}) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const events = await RawEvent.find({ ts: { $gte: since } }).lean();
  const cutoff = new Date(Date.now() - cutoffHours * 3600 * 1000);
  const { train, test } = chronologicalSplit(events, cutoff);

  assertNoLeakage(train, test);

  // Ground truth by user: items interacted in test window
  const gtByUser = new Map();
  for (const e of test) {
    if (!gtByUser.has(e.userId)) gtByUser.set(e.userId, new Set());
    if (e.type === 'play' || e.type === 'view') gtByUser.get(e.userId).add(e.itemId);
  }

  // Simple popularity baseline from train
  const counts = {};
  for (const e of train) if (e.type === 'play' || e.type === 'view') counts[e.itemId] = (counts[e.itemId] || 0) + 1;
  const pop = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([itemId, score]) => ({ itemId, score }));

  // Subpopulation analysis: by activity level (low/high)
  const eventsByUser = new Map();
  for (const e of events) {
    if (!eventsByUser.has(e.userId)) eventsByUser.set(e.userId, 0);
    eventsByUser.set(e.userId, eventsByUser.get(e.userId) + 1);
  }

  let metrics = { users: 0, avgNDCG: 0, avgHitRate: 0, low: { ndcg:0, hit:0, n:0 }, high: { ndcg:0, hit:0, n:0 } };
  for (const [userId, gtSet] of gtByUser) {
    const recs = pop; // same for everyone in baseline
    const nd = ndcgAtK(recs, Array.from(gtSet), k);
    const hit = hitRateAtK(recs, Array.from(gtSet), k);
    metrics.users++;
    metrics.avgNDCG += nd;
    metrics.avgHitRate += hit;
    const activity = (eventsByUser.get(userId) || 0);
    const bucket = activity < 5 ? 'low' : 'high';
    metrics[bucket].ndcg += nd;
    metrics[bucket].hit += hit;
    metrics[bucket].n++;
  }
  if (metrics.users) {
    metrics.avgNDCG /= metrics.users;
    metrics.avgHitRate /= metrics.users;
  }
  if (metrics.low.n) { metrics.low.ndcg /= metrics.low.n; metrics.low.hit /= metrics.low.n; }
  if (metrics.high.n) { metrics.high.ndcg /= metrics.high.n; metrics.high.hit /= metrics.high.n; }

  return { cutoff, metrics };
}

module.exports = { runOfflineEval, ndcgAtK, hitRateAtK, chronologicalSplit };
