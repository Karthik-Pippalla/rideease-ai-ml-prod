const semver = require('semver');
const { Model, ModelServingState } = require('./models');

async function listModels() {
  return Model.find().sort({ createdAt: -1 }).lean();
}

async function getServingState() {
  return ModelServingState.findById('model-serving-state').lean();
}

async function getServingVersion(variant = 'control') {
  const state = await getServingState();
  if (state?.variants?.[variant]) return state.variants[variant];
  if (state?.defaultVersion) return state.defaultVersion;
  const latest = await Model.findOne({ status: 'active' }).sort({ createdAt: -1 }).lean();
  if (latest) return latest.version;
  const newest = await Model.findOne().sort({ createdAt: -1 }).lean();
  return newest?.version;
}

async function getServingModel({ variant = 'control' } = {}) {
  const version = await getServingVersion(variant);
  if (!version) return null;
  const doc = await Model.findOne({ version }).lean();
  if (doc) return doc;
  return Model.findOne().sort({ createdAt: -1 }).lean();
}

async function setServingVersion({ version, target = 'all' }) {
  const allowed = ['all', 'control', 'treatment'];
  if (!allowed.includes(target)) throw new Error(`target must be one of ${allowed.join(', ')}`);
  const model = await Model.findOne({ version });
  if (!model) throw new Error(`Model ${version} not found`);

  const now = new Date();
  const existingState = await getServingState();
  const variants = Object.assign({ control: existingState?.variants?.control || existingState?.defaultVersion, treatment: existingState?.variants?.treatment || existingState?.defaultVersion }, existingState?.variants);
  const update = { updatedAt: now };

  if (target === 'all' || target === 'control') {
    await Model.updateMany({ status: 'active' }, { $set: { status: 'archived' } });
    await Model.findOneAndUpdate({ version }, { status: 'active' });
    update.defaultVersion = version;
    variants.control = version;
    if (target === 'all') variants.treatment = version;
    if (target === 'all') {
      await Model.updateMany({ status: 'shadow' }, { $set: { status: 'archived' } });
    }
  }

  if (target === 'treatment') {
    await Model.findOneAndUpdate({ version }, { status: 'shadow' });
    variants.treatment = version;
  }

  update.variants = variants;

  await ModelServingState.findByIdAndUpdate(
    'model-serving-state',
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return ModelServingState.findById('model-serving-state').lean();
}

async function computeNextVersion(bump = 'minor') {
  const latest = await Model.findOne().sort({ createdAt: -1 }).lean();
  const raw = latest?.version ? latest.version.replace(/^v/, '') : '0.0.0';
  const next = semver.inc(raw, bump) || '0.0.1';
  return `v${next}`;
}

module.exports = {
  listModels,
  getServingModel,
  getServingVersion,
  setServingVersion,
  computeNextVersion,
  getServingState,
};
