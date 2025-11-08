const fs = require('fs');
const path = require('path');
const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');

let registry;
const subjectCache = new Map();

function getRegistry() {
  if (!registry) {
    const host = process.env.SCHEMA_REGISTRY_HOST || 'http://localhost:8081';
    registry = new SchemaRegistry({ host });
  }
  return registry;
}

async function registerSchemaFromFile(subject, file) {
  if (subjectCache.has(subject)) return subjectCache.get(subject);
  const schemaPath = path.resolve(__dirname, '../../..', 'schemas', file);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const id = await getRegistry().register({ type: 'AVRO', schema: JSON.stringify(schema) }, { subject });
  subjectCache.set(subject, id.id || id);
  return id.id || id;
}

async function getSchemaId(subject) {
  if (subjectCache.has(subject)) return subjectCache.get(subject);
  const latest = await getRegistry().getLatestSchema(subject);
  subjectCache.set(subject, latest.id);
  return latest.id;
}

async function encodeMessage(subject, payload, schemaFile) {
  const reg = getRegistry();
  const id = await (schemaFile ? registerSchemaFromFile(subject, schemaFile) : getSchemaId(subject));
  return reg.encode(id, payload);
}

async function decodeMessage(buffer) { return getRegistry().decode(buffer); }

module.exports = { getRegistry, registerSchemaFromFile, getSchemaId, encodeMessage, decodeMessage };
