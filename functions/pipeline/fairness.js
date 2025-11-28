// Fairness evaluation: exposure shares, diversity metrics, variant comparison
const { RawEvent } = require('./ingest');

// Simple in-memory cache (TODO: Replace with Redis for production)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Compute exposure shares: what % of recommendations each item receives
 */
async function computeExposureShares({ windowHours = 24, variant = null } = {}) {
  // Input validation
  if (windowHours > 720) {
    throw new Error('windowHours must be <= 720 (30 days)');
  }
  
  // Cache check
  const cacheKey = `exposure:${windowHours}:${variant || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const query = { ts: { $gte: since }, type: 'recommend' };
  if (variant) query['payload.variant'] = variant;
  
  // TODO: For very large datasets, use aggregation pipeline instead
  // Safety limit to prevent memory issues
  const events = await RawEvent.find(query)
    .select('payload.items payload.variant')
    .lean()
    .limit(100000);
  const itemExposures = new Map();
  let totalExposures = 0;
  
  for (const evt of events) {
    const items = evt.payload?.items || [];
    for (const itemId of items) {
      const id = typeof itemId === 'string' ? itemId : (itemId?.itemId || String(itemId));
      itemExposures.set(id, (itemExposures.get(id) || 0) + 1);
      totalExposures++;
    }
  }
  
  const shares = {};
  for (const [itemId, count] of itemExposures) {
    shares[itemId] = {
      exposures: count,
      share: totalExposures > 0 ? count / totalExposures : 0,
    };
  }
  
  const result = { shares, totalExposures, windowHours };
  
  // Cache result
  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  
  return result;
}

/**
 * Compute diversity: how diverse are recommendation sets?
 * Metrics: intra-list diversity, coverage, entropy
 */
async function computeDiversity({ windowHours = 24, variant = null } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const query = { ts: { $gte: since }, type: 'recommend' };
  if (variant) query['payload.variant'] = variant;
  
  const events = await RawEvent.find(query).lean();
  const allItems = new Set();
  const intraListDiversities = [];
  
  for (const evt of events) {
    const items = (evt.payload?.items || []).map(id => 
      typeof id === 'string' ? id : (id?.itemId || String(id))
    );
    items.forEach(id => allItems.add(id));
    
    // Intra-list diversity: Jaccard-based measure
    if (items.length > 1) {
      const uniqueItems = new Set(items);
      const diversity = uniqueItems.size / items.length; // Simple diversity ratio
      intraListDiversities.push(diversity);
    } else if (items.length === 1) {
      intraListDiversities.push(0); // No diversity for single-item lists
    }
  }
  
  const avgIntraListDiversity = intraListDiversities.length > 0
    ? intraListDiversities.reduce((a, b) => a + b, 0) / intraListDiversities.length
    : 0;
  
  const coverage = allItems.size; // Unique items recommended
  const entropy = computeEntropy(events);
  
  return {
    avgIntraListDiversity,
    coverage,
    entropy,
    totalRecommendations: events.length,
  };
}

function computeEntropy(events) {
  const itemCounts = new Map();
  let total = 0;
  
  for (const evt of events) {
    const items = (evt.payload?.items || []).map(id => 
      typeof id === 'string' ? id : (id?.itemId || String(id))
    );
    items.forEach(id => {
      itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
      total++;
    });
  }
  
  if (total === 0) return 0;
  
  let entropy = 0;
  for (const count of itemCounts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  
  return entropy;
}

/**
 * Compute Gini coefficient for exposure distribution (lower = more fair)
 */
function computeGiniCoefficient(shares) {
  const values = Object.values(shares)
    .map(s => s.share)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  
  const n = values.length;
  if (n === 0) return 0;
  
  let numerator = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      numerator += Math.abs(values[i] - values[j]);
    }
  }
  
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  
  return numerator / (2 * n * n * mean);
}

/**
 * Fairness evaluation: compare exposure shares across variants
 */
async function evaluateFairness({ windowHours = 24 } = {}) {
  if (windowHours > 168) {
    throw new Error('windowHours must be <= 168 (1 week) for fairness evaluation');
  }
  
  const [controlExposure, treatmentExposure] = await Promise.all([
    computeExposureShares({ windowHours, variant: 'control' }).catch(err => {
      console.error('Fairness: control exposure failed', err.message);
      return { shares: {}, totalExposures: 0, windowHours };
    }),
    computeExposureShares({ windowHours, variant: 'treatment' }).catch(err => {
      console.error('Fairness: treatment exposure failed', err.message);
      return { shares: {}, totalExposures: 0, windowHours };
    }),
  ]);
  
  const [controlDiversity, treatmentDiversity] = await Promise.all([
    computeDiversity({ windowHours, variant: 'control' }),
    computeDiversity({ windowHours, variant: 'treatment' }),
  ]);
  
  // Compute Gini coefficient for exposure distribution (lower = more fair)
  const controlGini = computeGiniCoefficient(controlExposure.shares);
  const treatmentGini = computeGiniCoefficient(treatmentExposure.shares);
  
  // Determine fairness status
  const giniDiff = Math.abs(controlGini - treatmentGini);
  const exposureFairness = giniDiff < 0.1 ? 'fair' : 'unfair';
  
  const diversityDiff = Math.abs(controlDiversity.avgIntraListDiversity - treatmentDiversity.avgIntraListDiversity);
  const diversityComparison = diversityDiff < 0.1 ? 'similar' : 'different';
  
  return {
    windowHours,
    exposure: {
      control: controlExposure,
      treatment: treatmentExposure,
      giniCoefficient: { control: controlGini, treatment: treatmentGini },
    },
    diversity: {
      control: controlDiversity,
      treatment: treatmentDiversity,
    },
    summary: {
      exposureFairness,
      diversityComparison,
      giniDifference: giniDiff,
      diversityDifference: diversityDiff,
    },
  };
}

module.exports = {
  computeExposureShares,
  computeDiversity,
  evaluateFairness,
  computeGiniCoefficient,
};

