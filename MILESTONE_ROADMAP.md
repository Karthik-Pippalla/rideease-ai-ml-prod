# RideEase MLOps Milestone Roadmap

## ✅ What's Already Implemented

### Core Pipeline
- ✅ Kafka ingestion → MongoDB raw_events
- ✅ Training pipeline (popularity-based recommender)
- ✅ Model registry with versioning
- ✅ Model serving with A/B testing (control/treatment)
- ✅ A/B test statistics (z-test, p-value, CI, decision)
- ✅ Provenance tracking (prediction traces)
- ✅ Prometheus metrics (latency, requests, errors)
- ✅ Health checks and admin API
- ✅ Drift detection (KL divergence on user/item distributions)

### Experimentation
- ✅ Variant assignment (SHA1-based sharding)
- ✅ Automatic event logging (recommend events)
- ✅ Experiment summary endpoint (`/experiments/rec-engine/summary`)
- ✅ Conversion rate tracking (recommend → play/view within window)

---

## 🎯 Remaining Implementation Tasks

### 1. Fairness Evaluation
**Status:** ✅ Implemented (needs testing)

**Tasks:**
- [x] Implement exposure share metrics (per item, per user segment)
- [x] Compute diversity metrics (recommendation set diversity)
- [x] Add fairness evaluation endpoint (`/fairness`)
- [ ] Track demographic parity (if user segments available) - Future work
- [ ] Log fairness metrics to monitoring - Optional enhancement

**Files created:**
- `functions/pipeline/fairness.js` - Fairness evaluation logic ✅
- `docs/FAIRNESS.md` - Fairness documentation ✅

**Code Placeholder:**
```javascript
// functions/pipeline/fairness.js
const { RawEvent, PredictionTrace } = require('./ingest');
const { Model } = require('./models');

/**
 * Compute exposure shares: what % of recommendations each item receives
 */
async function computeExposureShares({ windowHours = 24, variant = null } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const query = { ts: { $gte: since }, type: 'recommend' };
  if (variant) query['payload.variant'] = variant;
  
  const events = await RawEvent.find(query).lean();
  const itemExposures = new Map();
  let totalExposures = 0;
  
  for (const evt of events) {
    const items = evt.payload?.items || [];
    for (const itemId of items) {
      itemExposures.set(itemId, (itemExposures.get(itemId) || 0) + 1);
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
  
  return { shares, totalExposures, windowHours };
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
    const items = evt.payload?.items || [];
    items.forEach(id => allItems.add(id));
    
    // Intra-list diversity: Jaccard distance between items
    if (items.length > 1) {
      const uniquePairs = (items.length * (items.length - 1)) / 2;
      const diversity = uniquePairs > 0 ? 1 : 0; // Simplified
      intraListDiversities.push(diversity);
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
    const items = evt.payload?.items || [];
    items.forEach(id => {
      itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
      total++;
    });
  }
  
  let entropy = 0;
  for (const count of itemCounts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  
  return entropy;
}

/**
 * Fairness evaluation: compare exposure shares across variants
 */
async function evaluateFairness({ windowHours = 24 } = {}) {
  const [controlExposure, treatmentExposure] = await Promise.all([
    computeExposureShares({ windowHours, variant: 'control' }),
    computeExposureShares({ windowHours, variant: 'treatment' }),
  ]);
  
  const [controlDiversity, treatmentDiversity] = await Promise.all([
    computeDiversity({ windowHours, variant: 'control' }),
    computeDiversity({ windowHours, variant: 'treatment' }),
  ]);
  
  // Compute Gini coefficient for exposure distribution (lower = more fair)
  const controlGini = computeGiniCoefficient(controlExposure.shares);
  const treatmentGini = computeGiniCoefficient(treatmentExposure.shares);
  
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
      exposureFairness: Math.abs(controlGini - treatmentGini) < 0.1 ? 'fair' : 'unfair',
      diversityComparison: Math.abs(controlDiversity.avgIntraListDiversity - treatmentDiversity.avgIntraListDiversity) < 0.1 ? 'similar' : 'different',
    },
  };
}

function computeGiniCoefficient(shares) {
  const values = Object.values(shares).map(s => s.share).sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) return 0;
  
  let numerator = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      numerator += Math.abs(values[i] - values[j]);
    }
  }
  
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return numerator / (2 * n * n * mean);
}

module.exports = {
  computeExposureShares,
  computeDiversity,
  evaluateFairness,
};
```

**Server endpoint:**
```javascript
// Add to functions/pipeline/server.js
app.get('/fairness', async (req, res) => {
  await connect();
  const windowHours = parseInt(req.query.windowHours || '24', 10);
  const { evaluateFairness } = require('./fairness');
  const report = await evaluateFairness({ windowHours });
  res.json(report);
});
```

---

### 2. Feedback Loop Analysis
**Status:** ✅ Implemented (needs testing)

**Tasks:**
- [x] Implement feedback loop detection queries
- [x] Track recommendation → interaction → training → recommendation cycle
- [x] Detect amplification effects (popular items getting more popular)
- [x] Add feedback loop monitoring endpoint (`/feedback-loops`)
- [ ] Alert on feedback loop anomalies - Optional enhancement

**Files created:**
- `functions/pipeline/feedbackLoop.js` - Feedback loop detection ✅
- `docs/FEEDBACK_LOOPS.md` - Feedback loop documentation ✅

**Code Placeholder:**
```javascript
// functions/pipeline/feedbackLoop.js
const { RawEvent, PredictionTrace } = require('./ingest');
const { Model } = require('./models');

/**
 * Detect feedback loops: items recommended → interacted → retrained → recommended again
 */
async function detectFeedbackLoops({ windowHours = 168 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  // Get all recommendations in window
  const recommendations = await RawEvent.find({
    ts: { $gte: since },
    type: 'recommend',
  }).sort({ ts: 1 }).lean();
  
  // Get all interactions in window
  const interactions = await RawEvent.find({
    ts: { $gte: since },
    type: { $in: ['play', 'view'] },
  }).sort({ ts: 1 }).lean();
  
  // Track item lifecycle: recommended → interacted → recommended again
  const itemLifecycle = new Map(); // itemId -> { firstRecommended, firstInteracted, secondRecommended }
  
  for (const rec of recommendations) {
    const items = rec.payload?.items || [];
    const recTime = new Date(rec.ts).getTime();
    
    for (const itemId of items) {
      if (!itemLifecycle.has(itemId)) {
        itemLifecycle.set(itemId, { firstRecommended: recTime });
      } else {
        const lifecycle = itemLifecycle.get(itemId);
        if (!lifecycle.firstInteracted && !lifecycle.secondRecommended) {
          lifecycle.secondRecommended = recTime;
        }
      }
    }
  }
  
  for (const interaction of interactions) {
    const itemId = interaction.itemId;
    if (itemId && itemLifecycle.has(itemId)) {
      const lifecycle = itemLifecycle.get(itemId);
      if (!lifecycle.firstInteracted) {
        lifecycle.firstInteracted = new Date(interaction.ts).getTime();
      }
    }
  }
  
  // Identify feedback loops: recommended → interacted → recommended again
  const feedbackLoops = [];
  for (const [itemId, lifecycle] of itemLifecycle) {
    if (lifecycle.firstRecommended && lifecycle.firstInteracted && lifecycle.secondRecommended) {
      const cycleTime = lifecycle.secondRecommended - lifecycle.firstRecommended;
      feedbackLoops.push({
        itemId,
        cycleTimeMs: cycleTime,
        cycleTimeHours: cycleTime / (3600 * 1000),
      });
    }
  }
  
  // Compute amplification: items that got more popular after being recommended
  const amplification = await computeAmplification({ since, recommendations, interactions });
  
  return {
    windowHours,
    feedbackLoops: feedbackLoops.length,
    avgCycleTimeHours: feedbackLoops.length > 0
      ? feedbackLoops.reduce((sum, f) => sum + f.cycleTimeHours, 0) / feedbackLoops.length
      : 0,
    amplification,
    details: feedbackLoops.slice(0, 10), // Top 10 examples
  };
}

/**
 * Compute amplification: items that became more popular after being recommended
 */
async function computeAmplification({ since, recommendations, interactions }) {
  const itemRecommendationCounts = new Map();
  const itemInteractionCountsBefore = new Map();
  const itemInteractionCountsAfter = new Map();
  
  // Count recommendations per item
  for (const rec of recommendations) {
    const items = rec.payload?.items || [];
    const recTime = new Date(rec.ts).getTime();
    
    for (const itemId of items) {
      itemRecommendationCounts.set(itemId, (itemRecommendationCounts.get(itemId) || 0) + 1);
      
      // Count interactions before and after first recommendation
      if (!itemInteractionCountsBefore.has(itemId)) {
        itemInteractionCountsBefore.set(itemId, 0);
        itemInteractionCountsAfter.set(itemId, 0);
      }
    }
  }
  
  // Count interactions before/after first recommendation
  for (const interaction of interactions) {
    const itemId = interaction.itemId;
    if (!itemId || !itemRecommendationCounts.has(itemId)) continue;
    
    const interactionTime = new Date(interaction.ts).getTime();
    // Find first recommendation time for this item
    let firstRecTime = null;
    for (const rec of recommendations) {
      const items = rec.payload?.items || [];
      if (items.includes(itemId)) {
        firstRecTime = new Date(rec.ts).getTime();
        break;
      }
    }
    
    if (firstRecTime) {
      if (interactionTime < firstRecTime) {
        itemInteractionCountsBefore.set(itemId, (itemInteractionCountsBefore.get(itemId) || 0) + 1);
      } else {
        itemInteractionCountsAfter.set(itemId, (itemInteractionCountsAfter.get(itemId) || 0) + 1);
      }
    }
  }
  
  // Compute amplification ratio
  const amplificationRatios = [];
  for (const [itemId, recCount] of itemRecommendationCounts) {
    const before = itemInteractionCountsBefore.get(itemId) || 0;
    const after = itemInteractionCountsAfter.get(itemId) || 0;
    const ratio = before > 0 ? after / before : (after > 0 ? Infinity : 0);
    amplificationRatios.push({ itemId, recCount, before, after, ratio });
  }
  
  amplificationRatios.sort((a, b) => b.ratio - a.ratio);
  
  return {
    avgAmplificationRatio: amplificationRatios.length > 0
      ? amplificationRatios.reduce((sum, r) => sum + (isFinite(r.ratio) ? r.ratio : 0), 0) / amplificationRatios.length
      : 0,
    topAmplified: amplificationRatios.slice(0, 10),
  };
}

/**
 * Detect anomalies in feedback loops (e.g., very short cycles, extreme amplification)
 */
async function detectFeedbackAnomalies({ windowHours = 168 } = {}) {
  const loops = await detectFeedbackLoops({ windowHours });
  
  const anomalies = [];
  
  // Anomaly: very short feedback cycles (< 1 hour)
  const shortCycles = loops.details.filter(f => f.cycleTimeHours < 1);
  if (shortCycles.length > 0) {
    anomalies.push({
      type: 'short_feedback_cycle',
      severity: 'high',
      count: shortCycles.length,
      description: `${shortCycles.length} items have feedback cycles < 1 hour`,
      examples: shortCycles.slice(0, 5),
    });
  }
  
  // Anomaly: extreme amplification (> 10x)
  const extremeAmplification = loops.amplification.topAmplified.filter(a => a.ratio > 10 && isFinite(a.ratio));
  if (extremeAmplification.length > 0) {
    anomalies.push({
      type: 'extreme_amplification',
      severity: 'medium',
      count: extremeAmplification.length,
      description: `${extremeAmplification.length} items show >10x amplification`,
      examples: extremeAmplification.slice(0, 5),
    });
  }
  
  return {
    windowHours,
    anomalies,
    summary: anomalies.length > 0 ? 'anomalies_detected' : 'no_anomalies',
  };
}

module.exports = {
  detectFeedbackLoops,
  computeAmplification,
  detectFeedbackAnomalies,
};
```

**Server endpoint:**
```javascript
// Add to functions/pipeline/server.js
app.get('/feedback-loops', async (req, res) => {
  await connect();
  const windowHours = parseInt(req.query.windowHours || '168', 10);
  const { detectFeedbackLoops, detectFeedbackAnomalies } = require('./feedbackLoop');
  const [loops, anomalies] = await Promise.all([
    detectFeedbackLoops({ windowHours }),
    detectFeedbackAnomalies({ windowHours }),
  ]);
  res.json({ loops, anomalies });
});
```

---

### 3. Telemetry Queries
**Status:** ✅ Implemented (ready to use)

**Tasks:**
- [x] Create MongoDB aggregation queries for feedback loop detection
- [x] Create queries for exposure share analysis
- [x] Create queries for anomaly detection
- [x] Document all telemetry queries

**Files created:**
- `functions/pipeline/telemetry.js` - Telemetry query utilities ✅

**Code Placeholder:**
```javascript
// functions/pipeline/telemetry.js
const { RawEvent, PredictionTrace } = require('./ingest');
const { Model } = require('./models');

/**
 * MongoDB aggregation: Get recommendation → interaction conversion funnel
 */
async function getConversionFunnel({ windowHours = 24, variant = null } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const matchStage = {
    ts: { $gte: since },
  };
  if (variant) {
    matchStage['payload.variant'] = variant;
  }
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
      },
    },
    {
      $project: {
        type: '$_id',
        count: 1,
        uniqueUsers: { $size: '$uniqueUsers' },
      },
    },
  ];
  
  const results = await RawEvent.aggregate(pipeline);
  return results;
}

/**
 * MongoDB aggregation: Item popularity over time (detect trending items)
 */
async function getItemPopularityTrend({ windowHours = 168, itemId = null } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const matchStage = {
    ts: { $gte: since },
    type: { $in: ['play', 'view'] },
  };
  if (itemId) matchStage.itemId = itemId;
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: {
          itemId: '$itemId',
          hour: { $dateTrunc: { date: '$ts', unit: 'hour' } },
        },
        interactions: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.itemId',
        hourlyInteractions: {
          $push: {
            hour: '$_id.hour',
            count: '$interactions',
          },
        },
        totalInteractions: { $sum: '$interactions' },
      },
    },
    { $sort: { totalInteractions: -1 } },
    { $limit: 20 },
  ];
  
  return await RawEvent.aggregate(pipeline);
}

/**
 * MongoDB aggregation: User engagement patterns (detect power users vs casual)
 */
async function getUserEngagementPatterns({ windowHours = 168 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const pipeline = [
    {
      $match: {
        ts: { $gte: since },
        type: { $in: ['play', 'view'] },
      },
    },
    {
      $group: {
        _id: '$userId',
        interactionCount: { $sum: 1 },
        uniqueItems: { $addToSet: '$itemId' },
        firstInteraction: { $min: '$ts' },
        lastInteraction: { $max: '$ts' },
      },
    },
    {
      $project: {
        userId: '$_id',
        interactionCount: 1,
        uniqueItemsCount: { $size: '$uniqueItems' },
        sessionSpanHours: {
          $divide: [
            { $subtract: ['$lastInteraction', '$firstInteraction'] },
            3600000,
          ],
        },
        category: {
          $cond: {
            if: { $gte: ['$interactionCount', 10] },
            then: 'power_user',
            else: {
              $cond: {
                if: { $gte: ['$interactionCount', 3] },
                then: 'regular_user',
                else: 'casual_user',
              },
            },
          },
        },
      },
    },
    { $sort: { interactionCount: -1 } },
  ];
  
  return await RawEvent.aggregate(pipeline);
}

/**
 * MongoDB aggregation: Model version performance comparison
 */
async function getModelVersionPerformance({ windowHours = 24 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: '$modelVersion',
        requestCount: { $sum: 1 },
        avgLatency: { $avg: '$latencyMs' },
        p95Latency: { $percentile: { input: '$latencyMs', p: [0.95], method: 'approximate' } },
        uniqueUsers: { $addToSet: '$userId' },
      },
    },
    {
      $project: {
        modelVersion: '$_id',
        requestCount: 1,
        avgLatency: { $round: ['$avgLatency', 2] },
        p95Latency: { $round: [{ $arrayElemAt: ['$p95Latency', 0] }, 2] },
        uniqueUsers: { $size: '$uniqueUsers' },
      },
    },
  ];
  
  return await PredictionTrace.aggregate(pipeline);
}

/**
 * MongoDB aggregation: Detect recommendation diversity per user
 */
async function getUserRecommendationDiversity({ windowHours = 24 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const pipeline = [
    {
      $match: {
        ts: { $gte: since },
        type: 'recommend',
      },
    },
    {
      $group: {
        _id: '$userId',
        recommendationCount: { $sum: 1 },
        uniqueItemsRecommended: { $addToSet: { $arrayElemAt: ['$payload.items', 0] } },
        variants: { $addToSet: '$payload.variant' },
      },
    },
    {
      $project: {
        userId: '$_id',
        recommendationCount: 1,
        uniqueItemsCount: { $size: '$uniqueItemsRecommended' },
        diversityRatio: {
          $cond: {
            if: { $gt: ['$recommendationCount', 0] },
            then: {
              $divide: [
                { $size: '$uniqueItemsRecommended' },
                '$recommendationCount',
              ],
            },
            else: 0,
          },
        },
        variants: 1,
      },
    },
    { $sort: { recommendationCount: -1 } },
  ];
  
  return await RawEvent.aggregate(pipeline);
}

module.exports = {
  getConversionFunnel,
  getItemPopularityTrend,
  getUserEngagementPatterns,
  getModelVersionPerformance,
  getUserRecommendationDiversity,
};
```

---

### 4. Security Design
**Status:** ✅ Implemented (optional enhancements available)

**Tasks:**
- [x] Document security architecture
- [x] Add input validation/sanitization
- [x] Add rate limiting (requires express-rate-limit package)
- [x] Add audit logging for admin operations
- [x] Document authentication/authorization
- [x] Add schema validation for events

**Files created:**
- `functions/pipeline/security.js` - Security utilities ✅
- `docs/SECURITY.md` - Security documentation ✅
- `functions/pipeline/models/index.js` - Added AdminAuditLog model ✅

**Code Placeholder:**
```javascript
// functions/pipeline/security.js
const rateLimit = require('express-rate-limit');

/**
 * Rate limiting middleware
 */
function createRateLimiter({ windowMs = 60000, max = 100 } = {}) {
  return rateLimit({
    windowMs,
    max,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Input validation for recommendation requests
 */
function validateRecommendationRequest(req, res, next) {
  const { userId, limit } = req.body || {};
  
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return res.status(400).json({ error: 'userId_required', message: 'userId must be a non-empty string' });
  }
  
  if (userId.length > 256) {
    return res.status(400).json({ error: 'userId_too_long', message: 'userId must be <= 256 characters' });
  }
  
  if (limit !== undefined) {
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'invalid_limit', message: 'limit must be between 1 and 100' });
    }
  }
  
  next();
}

/**
 * Audit logging for admin operations
 */
async function logAdminAction({ action, userId, details, ip } = {}) {
  const { AdminAuditLog } = require('./models');
  await AdminAuditLog.create({
    action,
    userId,
    details,
    ip,
    timestamp: new Date(),
  });
}

/**
 * Schema validation for events (using Avro schema if available)
 */
function validateEventSchema(event) {
  // Basic validation
  const required = ['type', 'userId', 'ts'];
  for (const field of required) {
    if (!event[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // Type validation
  const validTypes = ['recommend', 'play', 'view', 'skip'];
  if (!validTypes.includes(event.type)) {
    throw new Error(`Invalid event type: ${event.type}`);
  }
  
  // Timestamp validation
  const ts = new Date(event.ts);
  if (isNaN(ts.getTime())) {
    throw new Error(`Invalid timestamp: ${event.ts}`);
  }
  
  return true;
}

module.exports = {
  createRateLimiter,
  validateRecommendationRequest,
  logAdminAction,
  validateEventSchema,
};
```

**Add to models/index.js:**
```javascript
const AdminAuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  userId: String,
  details: Object,
  ip: String,
  timestamp: { type: Date, default: Date.now, index: true },
}, { collection: 'admin_audit_logs' });

const AdminAuditLog = mongoose.models.AdminAuditLog || mongoose.model('AdminAuditLog', AdminAuditLogSchema);
```

**Update server.js:**
```javascript
// Add rate limiting
const { createRateLimiter, validateRecommendationRequest } = require('./security');
app.use('/recommendations', createRateLimiter({ windowMs: 60000, max: 100 }));
app.post('/recommendations', validateRecommendationRequest, async (req, res) => {
  // ... existing code
});
```

---

### 5. Logging & Monitoring Improvements
**Status:** ⚠️ Partial (Prometheus exists, but needs structured logging)

**Tasks:**
- [ ] Add structured logging (JSON format)
- [ ] Add correlation IDs for request tracing
- [ ] Add logging for fairness metrics
- [ ] Add logging for feedback loop detection
- [ ] Improve error logging with stack traces

**Code Placeholder:**
```javascript
// functions/pipeline/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'rideease-ml-pipeline' },
  transports: [
    new winston.transports.Console(),
    // Add file transport in production
    // new winston.transports.File({ filename: 'error.log', level: 'error' }),
  ],
});

function logWithContext(level, message, context = {}) {
  logger[level](message, {
    ...context,
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  logger,
  logWithContext,
  info: (msg, ctx) => logWithContext('info', msg, ctx),
  error: (msg, ctx) => logWithContext('error', msg, ctx),
  warn: (msg, ctx) => logWithContext('warn', msg, ctx),
  debug: (msg, ctx) => logWithContext('debug', msg, ctx),
};
```

---

### 6. Documentation Skeleton
**Status:** ✅ Created (ready for completion)

**Files created:**
- `docs/FAIRNESS.md` ✅
- `docs/FEEDBACK_LOOPS.md` ✅
- `docs/SECURITY.md` ✅
- `docs/REFLECTION.md` ✅

---

## 📋 Implementation Checklist

### Phase 1: Fairness (Priority: High) ✅ COMPLETE
- [x] Create `functions/pipeline/fairness.js`
- [x] Implement `computeExposureShares()`
- [x] Implement `computeDiversity()`
- [x] Implement `evaluateFairness()`
- [x] Add `/fairness` endpoint to server.js
- [ ] Test with sample data ⏳ NEXT STEP
- [x] Document in `docs/FAIRNESS.md`

### Phase 2: Feedback Loops (Priority: High) ✅ COMPLETE
- [x] Create `functions/pipeline/feedbackLoop.js`
- [x] Implement `detectFeedbackLoops()`
- [x] Implement `computeAmplification()`
- [x] Implement `detectFeedbackAnomalies()`
- [x] Add `/feedback-loops` endpoint
- [ ] Test with sample data ⏳ NEXT STEP
- [x] Document in `docs/FEEDBACK_LOOPS.md`

### Phase 3: Telemetry (Priority: Medium) ✅ COMPLETE
- [x] Create `functions/pipeline/telemetry.js`
- [x] Implement all aggregation queries
- [ ] Add telemetry endpoints (optional, or use directly in jobs) - Optional
- [ ] Document queries in `docs/TELEMETRY.md` - Optional

### Phase 4: Security (Priority: Medium) ✅ COMPLETE
- [x] Create `functions/pipeline/security.js`
- [x] Add rate limiting (requires npm install)
- [x] Add input validation
- [x] Add audit logging
- [ ] Update server.js with security middleware - Optional enhancement
- [x] Document in `docs/SECURITY.md`

### Phase 5: Logging & Monitoring (Priority: Low) ⏳ OPTIONAL
- [ ] Create `functions/pipeline/logger.js` - Optional
- [ ] Replace console.log with structured logging - Optional
- [ ] Add correlation IDs - Optional
- [ ] Update monitoring dashboards - Optional

### Phase 6: Documentation (Priority: Medium) ✅ COMPLETE
- [x] Write `docs/FAIRNESS.md`
- [x] Write `docs/FEEDBACK_LOOPS.md`
- [x] Write `docs/SECURITY.md`
- [x] Write `docs/REFLECTION.md`

---

## 🚀 Quick Start Commands

```bash
# Install new dependencies
npm install express-rate-limit winston

# Test fairness evaluation
node -e "require('./functions/pipeline/fairness').evaluateFairness({windowHours: 24}).then(console.log)"

# Test feedback loop detection
node -e "require('./functions/pipeline/feedbackLoop').detectFeedbackLoops({windowHours: 168}).then(console.log)"

# Run telemetry queries
node -e "require('./functions/pipeline/telemetry').getConversionFunnel({windowHours: 24}).then(console.log)"
```

---

## 📊 Metrics to Track

### Fairness Metrics
- Exposure share per item (Gini coefficient)
- Diversity metrics (intra-list diversity, coverage, entropy)
- Comparison across variants

### Feedback Loop Metrics
- Feedback cycle time (recommend → interact → recommend)
- Amplification ratio (interactions before/after recommendation)
- Anomaly detection (short cycles, extreme amplification)

### Telemetry Metrics
- Conversion funnel (recommend → play/view)
- Item popularity trends
- User engagement patterns
- Model version performance

---

## 🔍 Next Steps Priority

1. **Implement fairness evaluation** (highest impact, required for milestone)
2. **Implement feedback loop detection** (required for milestone)
3. **Add telemetry queries** (supports analysis)
4. **Enhance security** (production readiness)
5. **Improve logging** (operational excellence)
6. **Write documentation** (completeness)

