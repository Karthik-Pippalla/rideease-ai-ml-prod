const { Kafka } = require('kafkajs');

// Kafka configuration
const kafkaConfig = {
  clientId: 'rideease-app',
  brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 8
  },
  connectionTimeout: 3000,
  requestTimeout: 25000,
};

// Initialize Kafka client
let kafka = null;
let producer = null;
let consumer = null;

/**
 * Initialize Kafka connection
 */
async function initKafka() {
  if (!kafka) {
    kafka = new Kafka(kafkaConfig);
    console.log('✅ Kafka client initialized');
  }
  return kafka;
}

/**
 * Get or create Kafka producer
 */
async function getProducer() {
  if (!producer) {
    const kafkaClient = await initKafka();
    producer = kafkaClient.producer({
      maxInFlightRequests: 1,
      idempotent: true,
      transactionTimeout: 30000,
    });
    await producer.connect();
    console.log('✅ Kafka producer connected');
  }
  return producer;
}

/**
 * Get or create Kafka consumer
 */
async function getConsumer(groupId = 'rideease-group') {
  if (!consumer) {
    const kafkaClient = await initKafka();
    consumer = kafkaClient.consumer({ groupId });
    await consumer.connect();
    console.log(`✅ Kafka consumer connected with groupId: ${groupId}`);
  }
  return consumer;
}

/**
 * Event schemas for type safety
 */
const EventSchemas = {
  RIDE_REQUESTED: {
    type: 'ride-requested',
    schema: {
      rideId: 'string',
      riderId: 'string',
      pickupLocation: 'object',
      dropLocation: 'object',
      bid: 'number',
      timeOfRide: 'string',
      timestamp: 'string'
    }
  },
  RIDE_MATCHED: {
    type: 'ride-matched',
    schema: {
      rideId: 'string',
      driverId: 'string',
      riderId: 'string',
      timestamp: 'string'
    }
  },
  RIDE_ACCEPTED: {
    type: 'ride-accepted',
    schema: {
      rideId: 'string',
      driverId: 'string',
      riderId: 'string',
      timestamp: 'string'
    }
  },
  RIDE_CANCELLED: {
    type: 'ride-cancelled',
    schema: {
      rideId: 'string',
      cancelledBy: 'string', // 'rider' | 'driver' | 'system'
      reason: 'string',
      timestamp: 'string'
    }
  },
  RIDE_COMPLETED: {
    type: 'ride-completed',
    schema: {
      rideId: 'string',
      driverId: 'string',
      riderId: 'string',
      timestamp: 'string'
    }
  },
  DRIVER_AVAILABLE: {
    type: 'driver-available',
    schema: {
      driverId: 'string',
      location: 'object',
      radius: 'number',
      timestamp: 'string'
    }
  },
  DRIVER_UNAVAILABLE: {
    type: 'driver-unavailable',
    schema: {
      driverId: 'string',
      timestamp: 'string'
    }
  },
  NOTIFICATION_SENT: {
    type: 'notification-sent',
    schema: {
      recipientId: 'string',
      recipientType: 'string', // 'rider' | 'driver'
      messageType: 'string',
      success: 'boolean',
      timestamp: 'string'
    }
  }
};

/**
 * Publish event to Kafka topic
 */
async function publishEvent(eventType, data, topic = null) {
  try {
    const producerInstance = await getProducer();
    
    // Validate event schema
    const eventSchema = EventSchemas[eventType];
    if (!eventSchema) {
      throw new Error(`Unknown event type: ${eventType}`);
    }

    // Create event payload
    const event = {
      type: eventSchema.type,
      data: {
        ...data,
        timestamp: new Date().toISOString(),
        eventId: `${eventSchema.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      },
      metadata: {
        version: '1.0',
        source: 'rideease-app',
        timestamp: new Date().toISOString()
      }
    };

    // Determine topic name
    const topicName = topic || `rideease-${eventSchema.type}`;
    
    // Publish to Kafka
    await producerInstance.send({
      topic: topicName,
      messages: [{
        key: event.data.eventId,
        value: JSON.stringify(event),
        partition: 0 // Simple partitioning for now
      }]
    });

    console.log(`✅ Published event ${eventType} to topic ${topicName}:`, event.data.eventId);
    return { success: true, eventId: event.data.eventId };
  } catch (error) {
    console.error(`❌ Failed to publish event ${eventType}:`, error.message);
    throw error;
  }
}

/**
 * Subscribe to Kafka topic
 */
async function subscribeToTopic(topic, handler, groupId = null) {
  try {
    const consumerInstance = await getConsumer(groupId);
    
    await consumerInstance.subscribe({ topic, fromBeginning: false });
    
    await consumerInstance.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          console.log(`📨 Received event from ${topic}:`, event.type);
          
          await handler(event, { topic, partition, offset: message.offset });
        } catch (error) {
          console.error(`❌ Error processing message from ${topic}:`, error.message);
          // In production, you might want to send to a dead letter queue
        }
      },
    });

    console.log(`✅ Subscribed to topic: ${topic}`);
  } catch (error) {
    console.error(`❌ Failed to subscribe to topic ${topic}:`, error.message);
    throw error;
  }
}

/**
 * Create topic if it doesn't exist
 */
async function createTopic(topicName, partitions = 3, replicationFactor = 1) {
  try {
    const kafkaClient = await initKafka();
    const admin = kafkaClient.admin();
    
    await admin.connect();
    
    const existingTopics = await admin.listTopics();
    if (!existingTopics.includes(topicName)) {
      await admin.createTopics({
        topics: [{
          topic: topicName,
          numPartitions: partitions,
          replicationFactor: replicationFactor
        }]
      });
      console.log(`✅ Created topic: ${topicName}`);
    } else {
      console.log(`ℹ️ Topic already exists: ${topicName}`);
    }
    
    await admin.disconnect();
  } catch (error) {
    console.error(`❌ Failed to create topic ${topicName}:`, error.message);
    throw error;
  }
}

/**
 * Initialize all required topics
 */
async function initializeTopics() {
  const topics = [
    // Existing RideEase topics
    'rideease-ride-requested',
    'rideease-ride-matched',
    'rideease-ride-accepted',
    'rideease-ride-cancelled',
    'rideease-ride-completed',
    'rideease-driver-available',
    'rideease-driver-unavailable',
    'rideease-notification-sent',
    
    // Recommendation system topics
    'rideease.watch',
    'rideease.rate',
    'rideease.reco_requests',
    'rideease.reco_responses'
  ];

  for (const topic of topics) {
    await createTopic(topic);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  try {
    if (producer) {
      await producer.disconnect();
      console.log('✅ Kafka producer disconnected');
    }
    if (consumer) {
      await consumer.disconnect();
      console.log('✅ Kafka consumer disconnected');
    }
  } catch (error) {
    console.error('❌ Error during Kafka shutdown:', error.message);
  }
}

// Convenience methods for common events
const rideEvents = {
  requestRide: (rideData) => publishEvent('RIDE_REQUESTED', rideData),
  matchRide: (matchData) => publishEvent('RIDE_MATCHED', matchData),
  acceptRide: (acceptData) => publishEvent('RIDE_ACCEPTED', acceptData),
  cancelRide: (cancelData) => publishEvent('RIDE_CANCELLED', cancelData),
  completeRide: (completeData) => publishEvent('RIDE_COMPLETED', completeData)
};

const driverEvents = {
  markAvailable: (driverData) => publishEvent('DRIVER_AVAILABLE', driverData),
  markUnavailable: (driverData) => publishEvent('DRIVER_UNAVAILABLE', driverData)
};

const notificationEvents = {
  sendNotification: (notificationData) => publishEvent('NOTIFICATION_SENT', notificationData)
};

module.exports = {
  initKafka,
  getProducer,
  getConsumer,
  publishEvent,
  subscribeToTopic,
  createTopic,
  initializeTopics,
  shutdown,
  EventSchemas,
  rideEvents,
  driverEvents,
  notificationEvents
};
