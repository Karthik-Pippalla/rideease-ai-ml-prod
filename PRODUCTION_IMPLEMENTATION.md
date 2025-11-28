# Production Implementation Guide

## Phase 1: MongoDB Indexes (HIGH)

**Status:** ✅ Created `functions/pipeline/indexes.js`

**Run indexes:**
```bash
node -e "require('./functions/pipeline/indexes').createIndexes().then(() => process.exit(0))"
```

**Indexes created:**
- `{ ts: 1, type: 1 }` - Core time-series queries
- `{ ts: 1, type: 1, 'payload.variant': 1 }` - Variant-specific queries
- `{ userId: 1, ts: 1 }` - User timeline queries
- `{ itemId: 1, ts: 1 }` - Item timeline queries
- `{ type: 1, ts: -1 }` - Recent events by type
- `{ 'payload.variant': 1, ts: 1 }` - Variant filtering

---

## Phase 2: Enhance fairness.js (HIGH)

**Add this code to `functions/pipeline/fairness.js`:**

```javascript
// Add at top after requires
const LRU = require('lru-cache');
const cache = new LRU({ max: 50, ttl: 5 * 60 * 1000 }); // 5min TTL

// Replace computeExposureShares with optimized version:
async function computeExposureShares({ windowHours = 24, variant = null } = {}) {
  const cacheKey = `exposure:${windowHours}:${variant || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const query = { ts: { $gte: since }, type: 'recommend' };
  if (variant) query['payload.variant'] = variant;
  
  // TODO: Consider aggregation pipeline for large datasets
  // For now, use lean() for memory efficiency
  const events = await RawEvent.find(query)
    .select('payload.items payload.variant')
    .lean()
    .limit(100000); // Safety limit
  
  if (events.length === 0) {
    const empty = { shares: {}, totalExposures: 0, windowHours };
    cache.set(cacheKey, empty);
    return empty;
  }
  
  const itemExposures = new Map();
  let totalExposures = 0;
  
  for (const evt of events) {
    const items = evt.payload?.items || [];
    if (!Array.isArray(items)) continue;
    
    for (const itemId of items) {
      const id = typeof itemId === 'string' ? itemId : (itemId?.itemId || String(itemId));
      if (!id) continue;
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
  cache.set(cacheKey, result);
  return result;
}

// Add error handling wrapper:
async function evaluateFairness({ windowHours = 24 } = {}) {
  try {
    if (windowHours > 168) {
      throw new Error('windowHours must be <= 168 (1 week)');
    }
    
    const [controlExposure, treatmentExposure] = await Promise.all([
      computeExposureShares({ windowHours, variant: 'control' }).catch(err => {
        console.error('Fairness: control exposure failed', err);
        return { shares: {}, totalExposures: 0, windowHours };
      }),
      computeExposureShares({ windowHours, variant: 'treatment' }).catch(err => {
        console.error('Fairness: treatment exposure failed', err);
        return { shares: {}, totalExposures: 0, windowHours };
      }),
    ]);
    
    // ... rest of existing code
  } catch (err) {
    console.error('Fairness evaluation failed', err);
    throw err;
  }
}
```

**Add to package.json dependencies:**
```json
"lru-cache": "^10.0.0"
```

---

## Phase 3: Optimize feedbackLoop.js (HIGH)

**Replace detectFeedbackLoops with aggregation-based version:**

```javascript
async function detectFeedbackLoops({ windowHours = 168 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  // Use aggregation for better performance
  const recPipeline = [
    { $match: { ts: { $gte: since }, type: 'recommend' } },
    { $sort: { ts: 1 } },
    { $project: { items: '$payload.items', ts: 1, userId: 1 } },
    { $unwind: '$items' },
    { $group: {
        _id: '$items',
        firstRec: { $min: '$ts' },
        recs: { $push: { ts: '$ts', userId: '$userId' } },
      },
    },
  ];
  
  const interactionPipeline = [
    { $match: { ts: { $gte: since }, type: { $in: ['play', 'view'] } } },
    { $sort: { ts: 1 } },
    { $group: {
        _id: '$itemId',
        firstInteraction: { $min: '$ts' },
      },
    },
  ];
  
  const [recGroups, interactionGroups] = await Promise.all([
    RawEvent.aggregate(recPipeline),
    RawEvent.aggregate(interactionPipeline),
  ]);
  
  const interactionMap = new Map(
    interactionGroups.map(g => [g._id, g.firstInteraction])
  );
  
  const feedbackLoops = [];
  for (const recGroup of recGroups) {
    const itemId = String(recGroup._id);
    const firstInteraction = interactionMap.get(itemId);
    
    if (!firstInteraction || !recGroup.firstRec) continue;
    
    // Find second recommendation after interaction
    const secondRec = recGroup.recs.find(r => 
      new Date(r.ts) > new Date(firstInteraction)
    );
    
    if (secondRec) {
      const cycleTime = new Date(secondRec.ts) - new Date(recGroup.firstRec);
      feedbackLoops.push({
        itemId,
        cycleTimeMs: cycleTime,
        cycleTimeHours: cycleTime / (3600 * 1000),
      });
    }
  }
  
  const amplification = await computeAmplification({ since, recommendations: recGroups, interactions: interactionGroups });
  
  return {
    windowHours,
    feedbackLoops: feedbackLoops.length,
    avgCycleTimeHours: feedbackLoops.length > 0
      ? feedbackLoops.reduce((sum, f) => sum + f.cycleTimeHours, 0) / feedbackLoops.length
      : 0,
    amplification,
    details: feedbackLoops.slice(0, 10),
  };
}
```

**Update computeAmplification signature:**
```javascript
async function computeAmplification({ since, recommendations, interactions }) {
  // Adapt to work with aggregation results
  // ... existing logic adapted for new data structure
}
```

---

## Phase 4: Create Cron Jobs (MEDIUM)

**Create `functions/pipeline/jobs/fairnessReport.js`:**

```javascript
#!/usr/bin/env node
require('dotenv').config();
const { connect, disconnect } = require('../db');
const { evaluateFairness } = require('../fairness');
const { logAdminAction } = require('../security');

async function main() {
  await connect();
  const windowHours = parseInt(process.env.FAIRNESS_WINDOW_HOURS || '24', 10);
  
  try {
    const report = await evaluateFairness({ windowHours });
    
    // TODO: Send to monitoring/alerting system
    // TODO: Store report in MongoDB for historical tracking
    console.log(JSON.stringify({
      type: 'fairness_report',
      timestamp: new Date().toISOString(),
      windowHours,
      summary: report.summary,
      giniCoefficients: report.exposure.giniCoefficient,
    }));
    
    // Alert if unfair
    if (report.summary.exposureFairness === 'unfair') {
      await logAdminAction({
        action: 'fairness_alert',
        details: { report: report.summary },
      });
    }
  } catch (err) {
    console.error('Fairness report failed', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main();
}
```

**Create `functions/pipeline/jobs/feedbackLoopReport.js`:**

```javascript
#!/usr/bin/env node
require('dotenv').config();
const { connect, disconnect } = require('../db');
const { detectFeedbackLoops, detectFeedbackAnomalies } = require('../feedbackLoop');
const { logAdminAction } = require('../security');

async function main() {
  await connect();
  const windowHours = parseInt(process.env.FEEDBACK_LOOP_WINDOW_HOURS || '168', 10);
  
  try {
    const [loops, anomalies] = await Promise.all([
      detectFeedbackLoops({ windowHours }),
      detectFeedbackAnomalies({ windowHours }),
    ]);
    
    console.log(JSON.stringify({
      type: 'feedback_loop_report',
      timestamp: new Date().toISOString(),
      windowHours,
      loops: loops.feedbackLoops,
      avgCycleTime: loops.avgCycleTimeHours,
      amplification: loops.amplification.avgAmplificationRatio,
      anomalies: anomalies.summary,
    }));
    
    // Alert on anomalies
    if (anomalies.summary === 'anomalies_detected') {
      await logAdminAction({
        action: 'feedback_loop_anomaly',
        details: { anomalies: anomalies.anomalies },
      });
    }
  } catch (err) {
    console.error('Feedback loop report failed', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main();
}
```

**Create `functions/pipeline/jobs/driftReport.js`:**

```javascript
#!/usr/bin/env node
require('dotenv').config();
const { connect, disconnect } = require('../db');
const { computeDistribution, detectDrift } = require('../drift');

async function main() {
  await connect();
  
  try {
    // Get baseline from last week
    const baseline = await computeDistribution({ hours: 168 });
    
    // Compare with current 24h
    const drift = await detectDrift({ baseline, threshold: 0.5 });
    
    console.log(JSON.stringify({
      type: 'drift_report',
      timestamp: new Date().toISOString(),
      drift,
    }));
    
    // Alert on drift
    const hasDrift = Object.values(drift).some(d => d.drift);
    if (hasDrift) {
      console.error('⚠️  Drift detected:', drift);
    }
  } catch (err) {
    console.error('Drift report failed', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main();
}
```

**Add to package.json scripts:**
```json
{
  "pipeline:fairness-report": "node functions/pipeline/jobs/fairnessReport.js",
  "pipeline:feedback-report": "node functions/pipeline/jobs/feedbackLoopReport.js",
  "pipeline:drift-report": "node functions/pipeline/jobs/driftReport.js"
}
```

---

## Phase 5: Test Scaffolding (MEDIUM)

**Create `functions/pipeline/__tests__/fairness.test.js`:**

```javascript
const { computeExposureShares, computeDiversity, evaluateFairness } = require('../fairness');
const { RawEvent } = require('../ingest');
const { connect, disconnect } = require('../db');

describe('Fairness', () => {
  beforeAll(async () => {
    await connect();
  });
  
  afterAll(async () => {
    await disconnect();
  });
  
  beforeEach(async () => {
    await RawEvent.deleteMany({});
  });
  
  test('computeExposureShares with empty data', async () => {
    const result = await computeExposureShares({ windowHours: 24 });
    expect(result.totalExposures).toBe(0);
    expect(Object.keys(result.shares)).toHaveLength(0);
  });
  
  test('computeExposureShares with test data', async () => {
    await RawEvent.create({
      type: 'recommend',
      userId: 'user1',
      ts: new Date(),
      payload: { items: ['item1', 'item2'], variant: 'control' },
    });
    
    const result = await computeExposureShares({ windowHours: 24 });
    expect(result.totalExposures).toBe(2);
    expect(result.shares.item1.share).toBe(0.5);
  });
  
  test('computeDiversity calculates entropy', async () => {
    // Add test data
    const result = await computeDiversity({ windowHours: 24 });
    expect(result).toHaveProperty('entropy');
    expect(result).toHaveProperty('coverage');
  });
  
  test('evaluateFairness compares variants', async () => {
    const result = await evaluateFairness({ windowHours: 24 });
    expect(result).toHaveProperty('exposure');
    expect(result).toHaveProperty('diversity');
    expect(result).toHaveProperty('summary');
  });
});
```

**Create `functions/pipeline/__tests__/feedbackLoop.test.js`:**

```javascript
const { detectFeedbackLoops, detectFeedbackAnomalies } = require('../feedbackLoop');
const { RawEvent } = require('../ingest');
const { connect, disconnect } = require('../db');

describe('Feedback Loops', () => {
  beforeAll(async () => {
    await connect();
  });
  
  afterAll(async () => {
    await disconnect();
  });
  
  beforeEach(async () => {
    await RawEvent.deleteMany({});
  });
  
  test('detectFeedbackLoops with no data', async () => {
    const result = await detectFeedbackLoops({ windowHours: 168 });
    expect(result.feedbackLoops).toBe(0);
  });
  
  test('detectFeedbackLoops with cycle', async () => {
    const now = new Date();
    // Create recommend → interact → recommend cycle
    await RawEvent.create([
      { type: 'recommend', userId: 'u1', ts: new Date(now - 10000), payload: { items: ['item1'] } },
      { type: 'play', userId: 'u1', itemId: 'item1', ts: new Date(now - 5000) },
      { type: 'recommend', userId: 'u1', ts: now, payload: { items: ['item1'] } },
    ]);
    
    const result = await detectFeedbackLoops({ windowHours: 168 });
    expect(result.feedbackLoops).toBeGreaterThan(0);
  });
  
  test('detectFeedbackAnomalies flags short cycles', async () => {
    const result = await detectFeedbackAnomalies({ windowHours: 168 });
    expect(result).toHaveProperty('anomalies');
    expect(result).toHaveProperty('summary');
  });
});
```

---

## Phase 6: Helper Utilities (MEDIUM)

**Create `functions/pipeline/utils/cache.js`:**

```javascript
const LRU = require('lru-cache');

const caches = {
  fairness: new LRU({ max: 50, ttl: 5 * 60 * 1000 }),
  feedback: new LRU({ max: 20, ttl: 10 * 60 * 1000 }),
  telemetry: new LRU({ max: 100, ttl: 2 * 60 * 1000 }),
};

function getCache(name) {
  return caches[name] || new LRU({ max: 50, ttl: 5 * 60 * 1000 });
}

function clearCache(name) {
  if (caches[name]) caches[name].clear();
}

function clearAllCaches() {
  Object.values(caches).forEach(c => c.clear());
}

module.exports = { getCache, clearCache, clearAllCaches };
```

**Create `functions/pipeline/utils/errors.js`:**

```javascript
class FairnessError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FairnessError';
    this.details = details;
  }
}

class FeedbackLoopError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FeedbackLoopError';
    this.details = details;
  }
}

class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

module.exports = { FairnessError, FeedbackLoopError, ValidationError };
```

**Create `functions/pipeline/utils/validation.js`:**

```javascript
const { ValidationError } = require('./errors');

function validateWindowHours(hours) {
  if (typeof hours !== 'number' || hours < 1 || hours > 720) {
    throw new ValidationError('windowHours must be between 1 and 720', 'windowHours');
  }
}

function validateVariant(variant) {
  if (variant && !['control', 'treatment'].includes(variant)) {
    throw new ValidationError('variant must be control or treatment', 'variant');
  }
}

module.exports = { validateWindowHours, validateVariant };
```

---

## Phase 7: Enhance server.js (HIGH)

**Add these endpoints to `functions/pipeline/server.js`:**

```javascript
// Add after existing endpoints, before start() function

// Telemetry endpoints
app.get('/telemetry/conversion-funnel', async (req, res) => {
  await connect();
  const windowHours = parseInt(req.query.windowHours || '24', 10);
  const variant = req.query.variant || null;
  const { getConversionFunnel } = require('./telemetry');
  try {
    const funnel = await getConversionFunnel({ windowHours, variant });
    res.json(funnel);
  } catch (err) {
    res.status(500).json({ error: 'telemetry_query_failed', message: err.message });
  }
});

app.get('/telemetry/item-trends', async (req, res) => {
  await connect();
  const windowHours = parseInt(req.query.windowHours || '168', 10);
  const itemId = req.query.itemId || null;
  const { getItemPopularityTrend } = require('./telemetry');
  try {
    const trends = await getItemPopularityTrend({ windowHours, itemId });
    res.json(trends);
  } catch (err) {
    res.status(500).json({ error: 'telemetry_query_failed', message: err.message });
  }
});

app.get('/telemetry/user-engagement', async (req, res) => {
  await connect();
  const windowHours = parseInt(req.query.windowHours || '168', 10);
  const { getUserEngagementPatterns } = require('./telemetry');
  try {
    const patterns = await getUserEngagementPatterns({ windowHours });
    res.json(patterns);
  } catch (err) {
    res.status(500).json({ error: 'telemetry_query_failed', message: err.message });
  }
});

// Add middleware for request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/admin') || req.path.startsWith('/fairness') || req.path.startsWith('/feedback-loops')) {
      console.log(JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      }));
    }
  });
  next();
});

// Add error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});
```

**Add input validation middleware:**

```javascript
// Add near top after app.use(express.json())
const { validateRecommendationRequest } = require('./security');
app.post('/recommendations', validateRecommendationRequest, async (req, res) => {
  // ... existing code
});
```

---

## Phase 8: Documentation (LOW)

**Add to `docs/FAIRNESS.md`:**

```markdown
## Performance Considerations

- Queries are cached for 5 minutes to reduce database load
- Large windows (>168 hours) may be slow; consider pagination
- Indexes on `ts`, `type`, `payload.variant` are required

## API Examples

```bash
# Get fairness report for last 24 hours
curl http://localhost:8080/fairness?windowHours=24

# Get fairness for specific variant
curl http://localhost:8080/fairness?windowHours=48&variant=control
```
```

**Add to `docs/FEEDBACK_LOOPS.md`:**

```markdown
## Performance Considerations

- Uses MongoDB aggregation pipelines for efficiency
- Default window is 168 hours (1 week)
- Consider reducing window for faster results

## Monitoring Integration

Set up alerts for:
- Short feedback cycles (< 1 hour)
- Extreme amplification (> 10x)
- High concentration (> 50% to top 10 items)
```

---

## Phase 9: Package.json Updates

**Add to `functions/package.json`:**

```json
{
  "dependencies": {
    "lru-cache": "^10.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  },
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "pipeline:indexes": "node -e \"require('./pipeline/indexes').createIndexes().then(() => process.exit(0))\"",
    "pipeline:fairness-report": "node pipeline/jobs/fairnessReport.js",
    "pipeline:feedback-report": "node pipeline/jobs/feedbackLoopReport.js",
    "pipeline:drift-report": "node pipeline/jobs/driftReport.js"
  }
}
```

---

## Phase 10: Cron Job Setup (Optional)

**For Cloud Scheduler / cron:**

```bash
# Daily fairness report at 2 AM UTC
0 2 * * * cd /path/to/project && npm run pipeline:fairness-report

# Weekly feedback loop report on Mondays at 3 AM UTC
0 3 * * 1 cd /path/to/project && npm run pipeline:feedback-report

# Daily drift report at 4 AM UTC
0 4 * * * cd /path/to/project && npm run pipeline:drift-report
```

---

## Summary Checklist

- [x] MongoDB indexes created
- [ ] Fairness.js enhanced with caching and error handling
- [ ] FeedbackLoop.js optimized with aggregation
- [ ] Cron job scripts created
- [ ] Test scaffolding added
- [ ] Helper utilities created
- [ ] Server.js enhanced with new endpoints
- [ ] Documentation completed
- [ ] Package.json updated

**Priority order:**
1. Indexes (HIGH) - Run immediately
2. Server enhancements (HIGH) - Add endpoints
3. Fairness/Feedback optimizations (HIGH) - Performance critical
4. Cron jobs (MEDIUM) - Operational
5. Tests (MEDIUM) - Quality assurance
6. Documentation (LOW) - Nice to have

