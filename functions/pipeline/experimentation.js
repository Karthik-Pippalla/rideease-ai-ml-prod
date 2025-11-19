const crypto = require('crypto');
const { RawEvent } = require('./ingest');
const config = require('./config');
const { getServingVersion } = require('./modelRegistry');

function assignVariant(userId) {
  if (!userId) return 'control';
  const hash = crypto.createHash('sha1').update(String(userId)).digest();
  return hash[0] % 2 === 0 ? 'control' : 'treatment';
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function erf(x) {
  // Abramowitz and Stegun approximation
  const sign = Math.sign(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absx = Math.abs(x);
  const t = 1 / (1 + p * absx);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absx * absx);
  return sign * y;
}

function twoProportionZTest({ controlSuccess, controlTotal, treatmentSuccess, treatmentTotal, alpha = 0.05 }) {
  if (!controlTotal || !treatmentTotal) {
    return {
      decision: 'insufficient-data',
      reason: 'Need events in both buckets',
    };
  }
  const p1 = controlSuccess / controlTotal;
  const p2 = treatmentSuccess / treatmentTotal;
  const pooled = (controlSuccess + treatmentSuccess) / (controlTotal + treatmentTotal);
  const se = Math.sqrt(pooled * (1 - pooled) * ((1 / controlTotal) + (1 / treatmentTotal)));
  if (!isFinite(se) || se === 0) {
    return {
      decision: 'insufficient-data',
      reason: 'Standard error is zero',
    };
  }
  const z = (p2 - p1) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const delta = p2 - p1;
  const seDelta = Math.sqrt((p1 * (1 - p1)) / controlTotal + (p2 * (1 - p2)) / treatmentTotal);
  const margin = 1.96 * seDelta;
  const ci = { lower: delta - margin, upper: delta + margin };
  let decision = 'keep-running';
  if (pValue < alpha) {
    decision = delta > 0 ? 'ship' : 'rollback';
  }
  return { z, pValue, delta, ci, decision, seDelta };
}

async function summarizeExperiment({ windowHours = 24 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const events = await RawEvent.find({ ts: { $gte: since }, type: { $in: ['recommend', 'play', 'view'] } })
    .sort({ ts: 1 })
    .lean();

  const recWindows = new Map();
  const exposures = { control: 0, treatment: 0 };
  const successes = { control: 0, treatment: 0 };
  const recSuccessMs = config.metrics.recSuccessMinutes * 60 * 1000;

  for (const evt of events) {
    if (!evt.userId) continue;
    const variant = assignVariant(evt.userId);
    const nowTs = +new Date(evt.ts);
    if (evt.type === 'recommend') {
      exposures[variant] += 1;
      const candidates = new Set();
      const payloadItems = evt.payload?.items || [];
      for (const item of payloadItems) {
        if (typeof item === 'string') candidates.add(item);
        if (item?.itemId) candidates.add(item.itemId);
      }
      if (evt.itemId) candidates.add(evt.itemId);
      recWindows.set(evt.userId, { items: candidates, expires: nowTs + recSuccessMs, variant });
    }

    if ((evt.type === 'play' || evt.type === 'view') && recWindows.has(evt.userId)) {
      const window = recWindows.get(evt.userId);
      if (window.expires >= nowTs) {
        if (window.items.size === 0 || window.items.has(evt.itemId)) {
          successes[window.variant] += 1;
          recWindows.delete(evt.userId);
        }
      } else {
        recWindows.delete(evt.userId);
      }
    }
  }

  const stats = twoProportionZTest({
    controlSuccess: successes.control,
    controlTotal: exposures.control,
    treatmentSuccess: successes.treatment,
    treatmentTotal: exposures.treatment,
  });

  const versions = {
    control: await getServingVersion('control'),
    treatment: await getServingVersion('treatment'),
  };

  const buildBucket = (bucket) => ({
    version: versions[bucket],
    exposures: exposures[bucket],
    successes: successes[bucket],
    conversionRate: exposures[bucket] ? successes[bucket] / exposures[bucket] : 0,
  });

  return {
    windowHours,
    variants: {
      control: buildBucket('control'),
      treatment: buildBucket('treatment'),
    },
    stats,
  };
}

module.exports = { assignVariant, twoProportionZTest, summarizeExperiment };
