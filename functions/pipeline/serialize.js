// Serialize: materialize model artifact for serving
const { Model } = require('./models');
const { getServingModel } = require('./modelRegistry');

async function getCurrentModel({ variant = 'control' } = {}) {
  const doc = await getServingModel({ variant });
  if (doc) return { counts: doc.counts || {}, metadata: doc };
  const fallback = await Model.findOne().sort({ createdAt: -1 }).lean();
  if (fallback) return { counts: fallback.counts || {}, metadata: fallback };
  return { counts: {} };
}

module.exports = { getCurrentModel };
