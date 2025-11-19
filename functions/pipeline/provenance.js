const { PredictionTrace } = require('./models');

async function logPredictionTrace(entry) {
  if (!entry?.requestId) throw new Error('requestId required for provenance logging');
  const payload = Object.assign({ createdAt: new Date() }, entry);
  await PredictionTrace.findOneAndUpdate(
    { requestId: entry.requestId },
    { $set: payload },
    { upsert: true, new: true }
  );
  return entry.requestId;
}

async function fetchTrace(requestId) {
  return PredictionTrace.findOne({ requestId }).lean();
}

module.exports = { logPredictionTrace, fetchTrace };
