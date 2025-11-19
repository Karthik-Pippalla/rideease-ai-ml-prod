const mongoose = require('mongoose');

const ModelSchema = new mongoose.Schema({
  modelName: { type: String, default: 'rideease-recommender' },
  version: { type: String, required: true, unique: true },
  status: { type: String, enum: ['staging', 'active', 'shadow', 'archived'], default: 'staging', index: true },
  trainedAt: Date,
  metrics: Object,
  counts: { type: Object, default: {} },
  dataSnapshotId: String,
  pipelineGitSha: String,
  containerImageDigest: String,
  artifactUri: String,
}, { timestamps: true });

const PredictionTraceSchema = new mongoose.Schema({
  requestId: { type: String, unique: true, index: true },
  userId: { type: String, index: true },
  variant: { type: String, index: true },
  modelVersion: String,
  dataSnapshotId: String,
  pipelineGitSha: String,
  containerImageDigest: String,
  recommendations: Array,
  latencyMs: Number,
  metadata: Object,
  createdAt: { type: Date, default: Date.now, index: true },
}, { collection: 'prediction_traces' });

const ServingStateSchema = new mongoose.Schema({
  _id: { type: String, default: 'model-serving-state' },
  defaultVersion: String,
  variants: {
    control: String,
    treatment: String,
  },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'model_serving_state' });

const Model = mongoose.models.Model || mongoose.model('Model', ModelSchema, 'models');
const PredictionTrace = mongoose.models.PredictionTrace || mongoose.model('PredictionTrace', PredictionTraceSchema);
const ModelServingState = mongoose.models.ModelServingState || mongoose.model('ModelServingState', ServingStateSchema);

module.exports = { Model, PredictionTrace, ModelServingState };
