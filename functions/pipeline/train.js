// Train: placeholder recommender model trainer
// In this milestone, we simulate training and persist simple popularity counts.
const { Model } = require('./models');

function buildCounts(events) {
  const counts = {};
  for (const e of events) {
    if (e.type === 'view' || e.type === 'play') {
      counts[e.itemId] = (counts[e.itemId] || 0) + 1;
    }
  }
  return counts;
}

async function trainPopularity(events, metadata = {}) {
  if (!metadata.version) throw new Error('version is required to register a model artifact');

  const counts = buildCounts(events);
  const interactions = Object.values(counts).reduce((acc, v) => acc + v, 0);
  const uniqueItems = Object.keys(counts).length;

  const doc = await Model.create({
    modelName: metadata.modelName || 'rideease-recommender',
    version: metadata.version,
    status: metadata.status || 'staging',
    trainedAt: new Date(),
    metrics: metadata.metrics || {
      interactions,
      uniqueItems,
    },
    counts,
    dataSnapshotId: metadata.dataSnapshotId,
    pipelineGitSha: metadata.pipelineGitSha,
    containerImageDigest: metadata.containerImageDigest,
    artifactUri: metadata.artifactUri,
  });

  return doc;
}

module.exports = { Model, trainPopularity, buildCounts };
