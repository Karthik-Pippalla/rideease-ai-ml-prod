const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function loadYaml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function resolveExtends(obj, baseDir) {
  if (obj.extends) {
    const parentPath = path.join(baseDir, `${obj.extends}.yaml`);
    const parent = loadYaml(parentPath);
    const { extends: _omit, ...rest } = obj;
    return deepMerge(resolveExtends(parent, baseDir), rest);
  }
  return obj;
}

function loadConfig() {
  const baseDir = path.resolve(__dirname, '../../config');
  const env = process.env.NODE_ENV || 'default';
  const file = env === 'default' ? 'default.yaml' : `${env}.yaml`;
  const raw = loadYaml(path.join(baseDir, file));
  const resolved = resolveExtends(raw, baseDir);
  // ENV overrides
  const overrides = {
    kafka: {
      brokers: process.env.KAFKA_BROKERS
        ? process.env.KAFKA_BROKERS.split(',')
        : undefined,
      metricsTopic: process.env.KAFKA_METRICS_TOPIC || undefined,
    },
  };
  return deepMerge(resolved, JSON.parse(JSON.stringify(overrides)));
}

module.exports = { loadConfig };
