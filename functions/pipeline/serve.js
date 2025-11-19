// Serve: simple recommend function using serialized model
const { getCurrentModel } = require('./serialize');

async function recommendTopN({ n = 5, variant = 'control', modelOverride } = {}) {
  const model = modelOverride || await getCurrentModel({ variant });
  const entries = Object.entries(model.counts || {});
  entries.sort((a, b) => b[1] - a[1]);
  const recommendations = entries.slice(0, n).map(([itemId, score]) => ({ itemId, score }));
  return { recommendations, model };
}

module.exports = { recommendTopN };
