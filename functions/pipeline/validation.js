// Schema validation using Avro via @ovotech/avro-stream or schematic check; here a light validator
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, 'schemas', 'RawEvent.avsc');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

function validateRawEvent(evt) {
  const errors = [];
  const fields = new Map(schema.fields.map(f => [f.name, f]));
  const req = ['type','userId','ts'];
  for (const k of req) if (evt[k] === undefined || evt[k] === null) errors.push(`${k} is required`);
  if (evt.ts && isNaN(+new Date(evt.ts))) errors.push('ts must be a valid date or timestamp');
  if (evt.payload && typeof evt.payload !== 'object') errors.push('payload must be object');
  return { valid: errors.length === 0, errors };
}

module.exports = { validateRawEvent };
