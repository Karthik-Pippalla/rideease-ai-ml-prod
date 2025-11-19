#!/usr/bin/env node
// Train the recommender, evaluate it, and publish metadata to the model registry directory
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { connect, disconnect } = require('../db');
const { RawEvent } = require('../ingest');
const { trainPopularity } = require('../train');
const { runOfflineEval } = require('../eval_offline');
const { computeNextVersion } = require('../modelRegistry');

async function main() {
  await connect();
  const lookbackDays = parseInt(process.env.TRAINING_LOOKBACK_DAYS || '30', 10);
  const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
  const events = await RawEvent.find({ ts: { $gte: since } }).lean();

  const version = process.env.MODEL_VERSION || await computeNextVersion();
  const dataSnapshotId = process.env.DATA_SNAPSHOT_ID || `raw-${Date.now()}`;
  const pipelineGitSha = process.env.GIT_SHA || process.env.PIPELINE_GIT_SHA || 'dev-local';
  const containerImageDigest = process.env.CONTAINER_IMAGE_DIGEST || 'dev-local';

  const offlineEval = await runOfflineEval();
  const registryRoot = process.env.MODEL_REGISTRY_ROOT || path.join(process.cwd(), 'model_registry');
  const registryUri = process.env.MODEL_REGISTRY_URI || `file://${registryRoot}`;
  const artifactUri = `${registryUri.replace(/\/$/, '')}/${version}/model.json`;

  const modelDoc = await trainPopularity(events, {
    version,
    dataSnapshotId,
    pipelineGitSha,
    containerImageDigest,
    artifactUri,
    metrics: {
      offline: offlineEval.metrics,
      evalCutoff: offlineEval.cutoff,
      lookbackDays,
    },
  });

  persistToRegistry({
    registryRoot,
    version,
    counts: modelDoc.counts || {},
    metadata: {
      version,
      dataSnapshotId,
      pipelineGitSha,
      containerImageDigest,
      artifactUri,
      metrics: modelDoc.metrics,
      trainedAt: modelDoc.trainedAt,
    },
  });

  console.log('✅ Trained model', version, 'using', events.length, 'events');
  console.log('📦 Artifact written to', artifactUri);
}

function persistToRegistry({ registryRoot, version, counts, metadata }) {
  const dir = path.join(registryRoot, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify({ counts }, null, 2));
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
}

main()
  .then(() => disconnect())
  .catch((err) => {
    console.error('❌ Training pipeline failed', err);
    disconnect().finally(() => process.exit(1));
  });
