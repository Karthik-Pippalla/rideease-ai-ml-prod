const { haversineMiles } = require('../../utils/distance');
const PopularityModel = require('../models/popularityModel');
const ItemItemCF = require('../models/itemItemCF');
const { loadConfig } = require('../config');
const fs = require('fs');
const path = require('path');

// Helper: chronological split
function chronologicalSplit(events, cutoffTs, valDeltaMs, testDeltaMs) {
  const train = events.filter(e => new Date(e.timestamp) < cutoffTs);
  const valStart = cutoffTs;
  const valEnd = new Date(valStart.getTime() + valDeltaMs);
  const testEnd = new Date(valEnd.getTime() + testDeltaMs);
  const validation = events.filter(e => new Date(e.timestamp) >= valStart && new Date(e.timestamp) < valEnd);
  const test = events.filter(e => new Date(e.timestamp) >= valEnd && new Date(e.timestamp) < testEnd);
  return { train, validation, test, windows: { valStart, valEnd, testEnd } };
}

// Metrics
function precisionAtK(recommended, relevant, k) {
  if (k === 0) return 0;
  const recK = recommended.slice(0, k);
  const tp = recK.filter(x => relevant.has(x)).length;
  return tp / k;
}
function recallAtK(recommended, relevant, k) {
  if (relevant.size === 0) return 0;
  const recK = recommended.slice(0, k);
  const tp = recK.filter(x => relevant.has(x)).length;
  return tp / relevant.size;
}
function dcg(scores) {
  return scores.reduce((acc, rel, i) => acc + (rel / Math.log2(i + 2)), 0);
}
function ndcgAtK(recommended, relevant, k) {
  const recK = recommended.slice(0, k);
  const gains = recK.map(id => (relevant.has(id) ? 1 : 0));
  const ideal = Array(Math.min(k, relevant.size)).fill(1);
  const idcg = dcg(ideal);
  if (idcg === 0) return 0;
  return dcg(gains) / idcg;
}
function coverageAtK(allRecs, catalogSize) {
  const unique = new Set(allRecs.flat());
  return catalogSize === 0 ? 0 : unique.size / catalogSize;
}
function diversityIntraList(items, itemToGeo) {
  if (items.length <= 1) return 0;
  let pairs = 0;
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = itemToGeo[items[i]]; const b = itemToGeo[items[j]];
      if (!a || !b) continue;
      sum += haversineMiles(a, b);
      pairs++;
    }
  }
  return pairs ? sum / pairs : 0;
}

// Build relevant set per user from a window of interactions
function buildRelevant(testInteractions) {
  const byUser = new Map();
  for (const ev of testInteractions) {
    if (!byUser.has(ev.userId)) byUser.set(ev.userId, new Set());
    byUser.get(ev.userId).add(ev.itemId);
  }
  return byUser;
}

function bucketTimeOfDay(ts) {
  const h = new Date(ts).getHours();
  if (h < 6) return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function tenureBucket(accountCreatedAt, ts) {
  if (!accountCreatedAt) return 'unknown';
  const days = (new Date(ts) - new Date(accountCreatedAt)) / (24*3600*1000);
  if (days < 7) return 'new';
  if (days < 30) return 'recent';
  return 'established';
}

function groupBySlices(validation, test) {
  // Expect optional fields on events: city, userAccountCreatedAt
  return {
    city: {
      val: group(validation, e => e.city || 'unknown'),
      test: group(test, e => e.city || 'unknown')
    },
    timeOfDay: {
      val: group(validation, e => bucketTimeOfDay(e.timestamp)),
      test: group(test, e => bucketTimeOfDay(e.timestamp))
    },
    tenure: {
      val: group(validation, e => tenureBucket(e.userAccountCreatedAt, e.timestamp)),
      test: group(test, e => tenureBucket(e.userAccountCreatedAt, e.timestamp))
    }
  };
}

function group(events, keyFn) {
  const m = new Map();
  for (const ev of events) {
    const k = keyFn(ev);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(ev);
  }
  return m;
}

// main offline eval
async function runOfflineEval({ events, itemCatalog = [], itemToGeo = {}, reportDir }) {
  const cfg = loadConfig();
  const k = cfg.recommender?.offline?.k || 10;

  // sort by time
  const eventsChrono = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const lastTs = eventsChrono.length ? new Date(eventsChrono[eventsChrono.length - 1].timestamp) : new Date();

  const cutoffDays = cfg.recommender?.offline?.cutoffDays || 30;
  const valDays = cfg.recommender?.offline?.validationDays || 7;
  const testDays = cfg.recommender?.offline?.testDays || 7;

  const cutoffTs = new Date(lastTs.getTime() - (valDays + testDays) * 24 * 3600 * 1000);
  const { train, validation, test, windows } = chronologicalSplit(
    eventsChrono,
    cutoffTs,
    valDays * 24 * 3600 * 1000,
    testDays * 24 * 3600 * 1000
  );

  // Train models on train window only to avoid leakage
  const pop = new PopularityModel();
  await pop.train(train.map(e => ({ userId: e.userId, itemId: e.itemId, type: e.type })));

  const iicf = new ItemItemCF();
  await iicf.train(train.map(e => ({ userId: e.userId, itemId: e.itemId, rating: 1 })));

  const byUserHistory = new Map();
  for (const e of train) {
    if (!byUserHistory.has(e.userId)) byUserHistory.set(e.userId, new Set());
    byUserHistory.get(e.userId).add(e.itemId);
  }

  const relevantVal = buildRelevant(validation);
  const relevantTest = buildRelevant(test);

  function evalModelOnWindow(model, relevant, label) {
    const users = Array.from(relevant.keys());
    const perUser = [];
    const allRecs = [];
    for (const u of users) {
      const exclude = Array.from(byUserHistory.get(u) || []);
      // recommend
      const res = model.recommend ? model.recommend(u, { numRecommendations: k, excludeItems: exclude }) : { recommendations: [] };
      const recs = (res.recommendations || []).map(r => r.itemId);
      allRecs.push(recs);
      const rel = relevant.get(u);
      perUser.push({
        precision: precisionAtK(recs, rel, k),
        recall: recallAtK(recs, rel, k),
        ndcg: ndcgAtK(recs, rel, k),
        diversity: diversityIntraList(recs, itemToGeo)
      });
    }
    const avg = (arr, key) => arr.length ? arr.reduce((a, x) => a + x[key], 0) / arr.length : 0;
    return {
      label,
      users: users.length,
      precision: avg(perUser, 'precision'),
      recall: avg(perUser, 'recall'),
      ndcg: avg(perUser, 'ndcg'),
      diversity: avg(perUser, 'diversity'),
      coverage: coverageAtK(allRecs, itemCatalog.length)
    };
  }

  const popVal = evalModelOnWindow(pop, relevantVal, 'validation');
  const iicfVal = evalModelOnWindow(iicf, relevantVal, 'validation');
  const popTest = evalModelOnWindow(pop, relevantTest, 'test');
  const iicfTest = evalModelOnWindow(iicf, relevantTest, 'test');

  // Subpopulation slicing
  const slices = groupBySlices(validation, test);
  const sliceReports = {};
  for (const [sliceName, { val: valMap, test: testMap }] of Object.entries(slices)) {
    sliceReports[sliceName] = { validation: {}, test: {} };
    for (const [key, valEvents] of valMap.entries()) {
      const rel = buildRelevant(valEvents);
      sliceReports[sliceName].validation[key] = evalModelOnWindow(pop, rel, 'validation');
    }
    for (const [key, testEvents] of testMap.entries()) {
      const rel = buildRelevant(testEvents);
      sliceReports[sliceName].test[key] = evalModelOnWindow(pop, rel, 'test');
    }
  }

  const report = {
    windows,
    k,
    models: {
      popularity: { validation: popVal, test: popTest },
      itemItemCF: { validation: iicfVal, test: iicfTest }
    },
    slices: sliceReports
  };

  if (reportDir) {
    const outDir = path.resolve(reportDir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `offline_eval_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
  }

  return report;
}

module.exports = { runOfflineEval };
