// Centralized env-based config
require('dotenv').config();

const required = (key, def = undefined) => {
  const val = process.env[key] ?? def;
  if (val === undefined || val === '') throw new Error(`Missing required env: ${key}`);
  return val;
};

module.exports = {
  env: process.env.NODE_ENV || 'development',
  tz: process.env.TZ || 'UTC',
  mongodb: {
    uri: required('MONGODB_URI'),
    db: process.env.MONGODB_DB,
  },
  kafka: {
    broker: process.env.KAFKA_BROKER || 'pkc-xxxxx.us-east-1.aws.confluent.cloud:9092',
    topic: process.env.KAFKA_TOPIC || 'app-events',
    key: required('KAFKA_KEY'),
    secret: required('SECRET'),
    groupId: process.env.KAFKA_GROUP_ID || 'rideease-metrics-consumer',
    ssl: true,
    saslMechanism: process.env.KAFKA_SASL_MECH || 'PLAIN',
  },
  metrics: {
    onlineWindowMinutes: parseInt(process.env.ONLINE_METRIC_WINDOW_MIN || '30', 10),
    recSuccessMinutes: parseInt(process.env.REC_SUCCESS_MINUTES || '15', 10),
  },
};
