// Ingest: read from Kafka (Confluent Cloud) and write raw events to Mongo
const { Kafka } = require('kafkajs');
const mongoose = require('mongoose');
const config = require('./config');

// Simple raw event model
const RawEventSchema = new mongoose.Schema({
  key: String,
  type: { type: String, index: true },
  userId: { type: String, index: true },
  itemId: String,
  ts: { type: Date, index: true },
  payload: Object,
}, { strict: false });

const RawEvent = mongoose.models.RawEvent || mongoose.model('RawEvent', RawEventSchema, 'raw_events');

async function ensureMongo() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(config.mongodb.uri, {
    dbName: config.mongodb.db,
    serverSelectionTimeoutMS: 10_000,
  });
}

function createKafka() {
  return new Kafka({
    clientId: 'rideease-pipeline',
    brokers: [config.kafka.broker],
    ssl: config.kafka.ssl,
    sasl: {
      mechanism: config.kafka.saslMechanism,
      username: config.kafka.key,
      password: config.kafka.secret,
    },
    retry: { initialRetryTime: 300, retries: 5 },
  });
}

async function runConsumer({ onEvent } = {}) {
  await ensureMongo();
  const kafka = createKafka();
  const consumer = kafka.consumer({ groupId: config.kafka.groupId });
  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.topic, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const value = message.value?.toString();
        const evt = JSON.parse(value);
        const doc = {
          key: message.key?.toString(),
          type: evt.type,
          userId: evt.userId,
          itemId: evt.itemId,
          ts: evt.ts ? new Date(evt.ts) : new Date(),
          payload: evt,
        };
        await RawEvent.create(doc);
        if (onEvent) await onEvent(doc);
      } catch (err) {
        console.error('Ingest error', err);
      }
    },
  });

  return { consumer };
}

module.exports = { runConsumer, ensureMongo, RawEvent };
