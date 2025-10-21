const { Kafka } = require('kafkajs');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Transform } = require('stream');

/**
 * Stream Ingestor for Recommendation System
 * Consumes Kafka topics, validates schemas, and writes snapshots to object storage
 */

class StreamIngestor {
  constructor(config = {}) {
    this.kafka = new Kafka({
      clientId: 'rideease-ingestor',
      brokers: config.kafkaBrokers || process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092']
    });
    
    this.consumer = this.kafka.consumer({ groupId: 'rideease-ingestor-group' });
    this.topics = ['rideease.watch', 'rideease.rate', 'rideease.reco_requests', 'rideease.reco_responses'];
    this.snapshotsDir = config.snapshotsDir || './data/snapshots';
    this.redis = config.redis;
    
    // Ensure snapshots directory exists
    this.ensureSnapshotsDir();
    
    // Schema definitions
    this.schemas = {
      'rideease.watch': {
        userId: 'string',
        itemId: 'string',
        timestamp: 'string',
        sessionId: 'string',
        metadata: 'object'
      },
      'rideease.rate': {
        userId: 'string',
        itemId: 'string',
        rating: 'number',
        timestamp: 'string',
        context: 'object'
      },
      'rideease.reco_requests': {
        userId: 'string',
        requestId: 'string',
        timestamp: 'string',
        context: 'object',
        modelVersion: 'string'
      },
      'rideease.reco_responses': {
        userId: 'string',
        requestId: 'string',
        recommendations: 'array',
        timestamp: 'string',
        modelVersion: 'string',
        latency: 'number'
      }
    };
  }

  ensureSnapshotsDir() {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  async validateSchema(event, topic) {
    const schema = this.schemas[topic];
    if (!schema) {
      throw new Error(`Unknown schema for topic: ${topic}`);
    }

    const errors = [];
    for (const [field, expectedType] of Object.entries(schema)) {
      if (!(field in event)) {
        errors.push(`Missing required field: ${field}`);
        continue;
      }

      const actualType = typeof event[field];
      if (expectedType === 'array' && !Array.isArray(event[field])) {
        errors.push(`Field ${field} should be array, got ${actualType}`);
      } else if (expectedType !== 'array' && actualType !== expectedType) {
        errors.push(`Field ${field} should be ${expectedType}, got ${actualType}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Schema validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  async writeSnapshot(topic, data, timestamp = new Date()) {
    const dateStr = timestamp.toISOString().split('T')[0];
    const hour = timestamp.getHours();
    
    // Create directory structure: snapshots/topic/YYYY-MM-DD/
    const topicDir = path.join(this.snapshotsDir, topic, dateStr);
    if (!fs.existsSync(topicDir)) {
      fs.mkdirSync(topicDir, { recursive: true });
    }

    // Write hourly snapshots
    const filename = `snapshot_${hour.toString().padStart(2, '0')}.json`;
    const filepath = path.join(topicDir, filename);

    // Append to existing file or create new one
    const existingData = fs.existsSync(filepath) ? JSON.parse(fs.readFileSync(filepath, 'utf8')) : [];
    existingData.push(data);

    fs.writeFileSync(filepath, JSON.stringify(existingData, null, 2));
    
    // Also write to CSV for easier analysis
    await this.writeCSVSnapshot(topic, data, timestamp);
    
    console.log(`✅ Snapshot written: ${filepath}`);
  }

  async writeCSVSnapshot(topic, data, timestamp) {
    const dateStr = timestamp.toISOString().split('T')[0];
    const hour = timestamp.getHours();
    
    const topicDir = path.join(this.snapshotsDir, topic, dateStr);
    const csvFilename = `snapshot_${hour.toString().padStart(2, '0')}.csv`;
    const csvFilepath = path.join(topicDir, csvFilename);

    // Convert nested objects to flattened CSV format
    const flattenedData = this.flattenObject(data);
    const csvHeader = Object.keys(flattenedData).join(',');
    const csvRow = Object.values(flattenedData).map(val => 
      typeof val === 'string' ? `"${val}"` : val
    ).join(',');

    // Check if file exists to determine if we need headers
    const needsHeader = !fs.existsSync(csvFilepath);
    
    fs.appendFileSync(csvFilepath, 
      (needsHeader ? csvHeader + '\n' : '') + csvRow + '\n'
    );
  }

  flattenObject(obj, prefix = '') {
    const flattened = {};
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        Object.assign(flattened, this.flattenObject(obj[key], prefix + key + '_'));
      } else {
        flattened[prefix + key] = obj[key];
      }
    }
    return flattened;
  }

  async cacheToRedis(topic, data) {
    if (!this.redis) return;

    try {
      const key = `rideease:${topic}:${data.userId || 'anonymous'}`;
      await this.redis.setex(key, 3600, JSON.stringify(data)); // Cache for 1 hour
    } catch (error) {
      console.error('Redis cache error:', error.message);
    }
  }

  async processMessage(topic, message) {
    try {
      const event = JSON.parse(message.value.toString());
      const timestamp = new Date();

      // Validate schema
      await this.validateSchema(event, topic);

      // Add processing timestamp
      event._processedAt = timestamp.toISOString();

      // Write snapshot
      await this.writeSnapshot(topic, event, timestamp);

      // Cache to Redis if available
      await this.cacheToRedis(topic, event);

      console.log(`✅ Processed ${topic}: ${JSON.stringify(event).substring(0, 100)}...`);

    } catch (error) {
      console.error(`❌ Error processing ${topic}:`, error.message);
      
      // Write to dead letter queue
      await this.writeDeadLetter(topic, message, error.message);
    }
  }

  async writeDeadLetter(topic, message, error) {
    const deadLetterDir = path.join(this.snapshotsDir, 'dead_letters');
    if (!fs.existsSync(deadLetterDir)) {
      fs.mkdirSync(deadLetterDir, { recursive: true });
    }

    const filename = `dead_letter_${Date.now()}.json`;
    const filepath = path.join(deadLetterDir, filename);

    const deadLetterRecord = {
      topic,
      message: message.value.toString(),
      error: error,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(filepath, JSON.stringify(deadLetterRecord, null, 2));
    console.log(`📝 Dead letter written: ${filepath}`);
  }

  async start() {
    try {
      console.log('🚀 Starting Stream Ingestor...');
      
      await this.consumer.connect();
      console.log('✅ Consumer connected');

      // Subscribe to topics
      await this.consumer.subscribe({ topics: this.topics });
      console.log(`✅ Subscribed to topics: ${this.topics.join(', ')}`);

      // Start consuming
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          await this.processMessage(topic, message);
        }
      });

      console.log('✅ Stream Ingestor started successfully');

    } catch (error) {
      console.error('❌ Stream Ingestor failed to start:', error.message);
      throw error;
    }
  }

  async stop() {
    try {
      await this.consumer.disconnect();
      console.log('✅ Stream Ingestor stopped');
    } catch (error) {
      console.error('❌ Error stopping Stream Ingestor:', error.message);
    }
  }

  // Utility method to generate sample data for testing
  generateSampleData(topic, count = 10) {
    const samples = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const baseData = {
        userId: `user_${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date(now + i * 1000).toISOString()
      };

      switch (topic) {
        case 'rideease.watch':
          samples.push({
            ...baseData,
            itemId: `ride_${Math.floor(Math.random() * 500)}`,
            sessionId: `session_${Math.floor(Math.random() * 100)}`,
            metadata: { source: 'mobile_app', duration: Math.random() * 60 }
          });
          break;

        case 'rideease.rate':
          samples.push({
            ...baseData,
            itemId: `ride_${Math.floor(Math.random() * 500)}`,
            rating: Math.floor(Math.random() * 5) + 1,
            context: { location: 'NYC', timeOfDay: 'morning' }
          });
          break;

        case 'rideease.reco_requests':
          samples.push({
            ...baseData,
            requestId: `req_${Math.floor(Math.random() * 10000)}`,
            context: { location: 'NYC', timeOfDay: 'morning' },
            modelVersion: 'v1.0'
          });
          break;

        case 'rideease.reco_responses':
          samples.push({
            ...baseData,
            requestId: `req_${Math.floor(Math.random() * 10000)}`,
            recommendations: [
              { itemId: `ride_${Math.floor(Math.random() * 500)}`, score: Math.random() },
              { itemId: `ride_${Math.floor(Math.random() * 500)}`, score: Math.random() },
              { itemId: `ride_${Math.floor(Math.random() * 500)}`, score: Math.random() }
            ],
            modelVersion: 'v1.0',
            latency: Math.random() * 100
          });
          break;
      }
    }

    return samples;
  }
}

module.exports = StreamIngestor;
