require('dotenv').config();

const express = require('express');
const promClient = require('prom-client');
const { v4: uuidv4 } = require('uuid');

const { connect } = require('./db');
const { recommendTopN } = require('./serve');
const { assignVariant, summarizeExperiment } = require('./experimentation');
const { logPredictionTrace, fetchTrace } = require('./provenance');
const { listModels, setServingVersion, getServingState } = require('./modelRegistry');
const { RawEvent } = require('./ingest');

const app = express();
app.use(express.json({ limit: '1mb' }));

const registry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: registry, prefix: 'rideease_' });

const latencyHistogram = new promClient.Histogram({
  name: 'rideease_prediction_latency_ms',
  help: 'Latency of /recommendations endpoint in ms',
  labelNames: ['variant'],
  buckets: [5, 10, 20, 50, 100, 250, 500, 1000],
  registers: [registry],
});

const requestCounter = new promClient.Counter({
  name: 'rideease_prediction_requests_total',
  help: 'Total prediction requests',
  labelNames: ['variant', 'status'],
  registers: [registry],
});

const errorCounter = new promClient.Counter({
  name: 'rideease_prediction_errors_total',
  help: 'Total errors during predictions',
  labelNames: ['stage'],
  registers: [registry],
});

const uptimeGauge = new promClient.Gauge({
  name: 'rideease_service_uptime_seconds',
  help: 'Uptime of the inference service',
  registers: [registry],
});

setInterval(() => uptimeGauge.set(process.uptime()), 5000).unref();

app.get('/', (req, res) => {
  res.json({
    service: 'RideEase MLOps Pipeline',
    version: '1.0.0',
    endpoints: {
      health: 'GET /healthz',
      metrics: 'GET /metrics',
      recommendations: 'POST /recommendations',
      experiments: 'GET /experiments/:experimentId/summary',
      fairness: 'GET /fairness?windowHours=24',
      feedbackLoops: 'GET /feedback-loops?windowHours=168',
      telemetry: {
        conversionFunnel: 'GET /telemetry/conversion-funnel?windowHours=24',
        itemTrends: 'GET /telemetry/item-trends?windowHours=168',
        userEngagement: 'GET /telemetry/user-engagement?windowHours=168',
      },
      traces: 'GET /traces/:requestId',
      admin: {
        models: 'GET /admin/models',
        switchModel: 'POST /admin/switch-model',
      },
    },
    docs: 'See docs/ folder for detailed API documentation',
  });
});

app.get('/healthz', async (req, res) => {
  try {
    await connect();
    res.json({ status: 'ok', uptimeSeconds: process.uptime(), time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

function adminGuard(req, res, next) {
  const expected = process.env.MODEL_ADMIN_API_KEY;
  if (!expected) return res.status(500).json({ error: 'admin_api_key_not_set' });
  if (req.headers['x-api-key'] !== expected) return res.status(401).json({ error: 'unauthorized' });
  return next();
}

app.get('/admin/models', adminGuard, async (req, res) => {
  await connect();
  const models = await listModels();
  const state = await getServingState();
  res.json({ models, serving: state });
});

app.post('/admin/switch-model', adminGuard, async (req, res) => {
  const { version, target = 'all' } = req.body || {};
  if (!version) return res.status(400).json({ error: 'version_required' });
  await connect();
  try {
    const state = await setServingVersion({ version, target });
    res.json({ ok: true, state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/traces/:requestId', async (req, res) => {
  await connect();
  const trace = await fetchTrace(req.params.requestId);
  if (!trace) return res.status(404).json({ error: 'trace_not_found' });
  res.json(trace);
});

app.post('/recommendations', async (req, res) => {
  const start = process.hrtime.bigint();
  const requestId = req.headers['x-request-id'] || uuidv4();
  const { userId, limit = 5 } = req.body || {};
  if (!userId) {
    errorCounter.labels('validation').inc();
    requestCounter.labels('unknown', 'error').inc();
    return res.status(400).json({ error: 'userId_required' });
  }

  const variant = assignVariant(userId);
  try {
    await connect();
    const { recommendations, model } = await recommendTopN({ n: limit, variant });
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    latencyHistogram.labels(variant).observe(latencyMs);
    requestCounter.labels(variant, 'success').inc();
    await logPredictionTrace({
      requestId,
      userId,
      variant,
      modelVersion: model?.metadata?.version,
      dataSnapshotId: model?.metadata?.dataSnapshotId || 'unknown',
      pipelineGitSha: model?.metadata?.pipelineGitSha || process.env.PIPELINE_GIT_SHA || 'unknown',
      containerImageDigest: process.env.CONTAINER_IMAGE_DIGEST || model?.metadata?.containerImageDigest || 'unknown',
      recommendations,
      latencyMs,
      metadata: { limit },
    });

    // Log 'recommend' event for A/B testing
    try {
      const itemIds = recommendations.map(r => r.itemId || r.rideId || String(r)).filter(Boolean);
      await RawEvent.create({
        type: 'recommend',
        userId: String(userId),
        ts: new Date(),
        payload: {
          items: itemIds,
          requestId,
          variant,
          modelVersion: model?.metadata?.version,
          limit,
        },
      });
    } catch (eventErr) {
      // Log but don't fail the request if event logging fails
      console.error('Failed to log recommend event:', eventErr.message);
    }

    res.json({
      requestId,
      variant,
      modelVersion: model?.metadata?.version,
      dataSnapshotId: model?.metadata?.dataSnapshotId,
      recommendations,
    });
  } catch (err) {
    errorCounter.labels('prediction').inc();
    requestCounter.labels(variant, 'error').inc();
    res.status(500).json({ error: 'prediction_failed', message: err.message, requestId });
  }
});

app.get('/experiments/:experimentId/summary', async (req, res) => {
  if (req.params.experimentId !== 'rec-engine') {
    return res.status(404).json({ error: 'experiment_not_found' });
  }
  await connect();
  const windowHours = parseInt(req.query.windowHours || '24', 10);
  const summary = await summarizeExperiment({ windowHours });
  res.json(summary);
});

app.get('/fairness', async (req, res) => {
  try {
    await connect();
    const windowHours = parseInt(req.query.windowHours || '24', 10);
    const { evaluateFairness } = require('./fairness');
    const report = await evaluateFairness({ windowHours });
    res.json(report);
  } catch (err) {
    console.error('Fairness endpoint error:', err);
    res.status(500).json({ error: 'fairness_evaluation_failed', message: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }
});

app.get('/feedback-loops', async (req, res) => {
  try {
    await connect();
    const windowHours = parseInt(req.query.windowHours || '168', 10);
    const { detectFeedbackLoops, detectFeedbackAnomalies } = require('./feedbackLoop');
    const [loops, anomalies] = await Promise.all([
      detectFeedbackLoops({ windowHours }),
      detectFeedbackAnomalies({ windowHours }),
    ]);
    res.json({ loops, anomalies });
  } catch (err) {
    console.error('Feedback loops endpoint error:', err);
    res.status(500).json({ error: 'feedback_loop_detection_failed', message: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }
});

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

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  errorCounter.labels('unhandled').inc();
  res.status(500).json({ error: 'internal_error', message: err.message });
});

function start({ port = process.env.PORT || 8080 } = {}) {
  return connect().then(() => new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`🚀 Inference service listening on ${port}`);
      resolve(server);
    });
  }));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start inference service', err);
    process.exit(1);
  });
}

module.exports = { app, start };
