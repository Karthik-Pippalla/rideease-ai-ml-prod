// MongoDB index creation script
// Run: node -e "require('./indexes').createIndexes().then(() => process.exit(0))"
const { connect } = require('./db');
const { RawEvent } = require('./ingest');
const { PredictionTrace, AdminAuditLog } = require('./models');

async function createIndexes() {
  await connect();
  
  // RawEvent indexes for fairness, feedback loops, telemetry
  await RawEvent.collection.createIndex({ ts: 1, type: 1 });
  await RawEvent.collection.createIndex({ ts: 1, type: 1, 'payload.variant': 1 });
  await RawEvent.collection.createIndex({ userId: 1, ts: 1 });
  await RawEvent.collection.createIndex({ itemId: 1, ts: 1 });
  await RawEvent.collection.createIndex({ type: 1, ts: -1 });
  await RawEvent.collection.createIndex({ 'payload.variant': 1, ts: 1 });
  
  // PredictionTrace indexes for telemetry
  await PredictionTrace.collection.createIndex({ createdAt: 1, modelVersion: 1 });
  await PredictionTrace.collection.createIndex({ userId: 1, createdAt: -1 });
  await PredictionTrace.collection.createIndex({ variant: 1, createdAt: -1 });
  await PredictionTrace.collection.createIndex({ modelVersion: 1, createdAt: -1 });
  
  // AdminAuditLog indexes
  await AdminAuditLog.collection.createIndex({ timestamp: -1 });
  await AdminAuditLog.collection.createIndex({ action: 1, timestamp: -1 });
  
  console.log('✅ Indexes created');
}

async function dropIndexes() {
  await connect();
  await RawEvent.collection.dropIndexes();
  await PredictionTrace.collection.dropIndexes();
  await AdminAuditLog.collection.dropIndexes();
  console.log('✅ Indexes dropped');
}

module.exports = { createIndexes, dropIndexes };

