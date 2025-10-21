# Kafka Integration for RideEase

This document describes the Kafka integration implemented in the RideEase ride-sharing application.

## Overview

Kafka has been integrated to provide real-time event streaming for:
- Ride lifecycle events (requested, matched, accepted, cancelled, completed)
- Driver availability events (available, unavailable)
- Notification events (sent, failed)
- Analytics and monitoring data

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Controllers   │───▶│  Kafka Events   │───▶│   Consumers     │
│                 │    │                 │    │                 │
│ - Ride Request  │    │ - Ride Events   │    │ - Notifications │
│ - Driver Avail  │    │ - Driver Events │    │ - Analytics     │
│ - Ride Actions  │    │ - Notifications │    │ - Monitoring    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Event Types

### Ride Events
- **ride-requested**: When a rider requests a ride
- **ride-matched**: When a driver accepts a ride
- **ride-accepted**: When ride matching is finalized
- **ride-cancelled**: When a ride is cancelled (by rider/driver/system)
- **ride-completed**: When a ride is completed

### Driver Events
- **driver-available**: When a driver becomes available
- **driver-unavailable**: When a driver goes offline

### Notification Events
- **notification-sent**: When notifications are sent to users

## Topics

All topics follow the naming convention: `rideease-{event-type}`

- `rideease-ride-requested`
- `rideease-ride-matched`
- `rideease-ride-accepted`
- `rideease-ride-cancelled`
- `rideease-ride-completed`
- `rideease-driver-available`
- `rideease-driver-unavailable`
- `rideease-notification-sent`

## Setup Instructions

### 1. Environment Configuration

Add Kafka configuration to your environment variables:

```bash
# Local development
export KAFKA_BROKERS=localhost:9092

# Production (multiple brokers)
export KAFKA_BROKERS=kafka1:9092,kafka2:9092,kafka3:9092
```

### 2. Install Dependencies

```bash
cd functions
npm install
```

### 3. Initialize Kafka Topics

```bash
# Setup topics
node kafka-setup.js setup

# Test integration
node kafka-setup.js test
```

### 4. Deploy Firebase Functions

```bash
firebase deploy --only functions
```

## Usage Examples

### Publishing Events

```javascript
const { rideEvents, driverEvents } = require('./utils/kafkaEvents');

// Publish ride request event
await rideEvents.requestRide({
  rideId: 'ride-123',
  riderId: 'rider-456',
  pickupLocation: { name: 'Central Park', coordinates: [-73.9654, 40.7829] },
  dropLocation: { name: 'Times Square', coordinates: [-73.9857, 40.7589] },
  bid: 25.00,
  timeOfRide: '2024-01-15T10:30:00Z'
});

// Publish driver availability event
await driverEvents.markAvailable({
  driverId: 'driver-789',
  location: { coordinates: [-73.9654, 40.7829], type: 'Point' },
  radius: 10
});
```

### Consuming Events

```javascript
const { subscribeToTopic } = require('./utils/kafka');

// Subscribe to ride events
await subscribeToTopic('rideease-ride-requested', async (event, metadata) => {
  console.log('New ride request:', event.data);
  // Process the event...
});
```

## Integration Points

### Controllers Integration

The following controllers have been enhanced with Kafka events:

- **RidesController**: Publishes ride acceptance, completion, and cancellation events
- **RidersController**: Publishes ride request and cancellation events
- **DriversController**: Publishes driver availability events

### Matching System Integration

The matching system (`utils/matching.js`) can be enhanced to use Kafka events for:
- Triggering driver notifications when rides are requested
- Updating ride status when matches are found
- Coordinating between multiple matching algorithms

### Notification System Integration

The notification system (`utils/notifications.js`) can publish events for:
- Tracking notification delivery success/failure
- Analytics on notification patterns
- Retry logic for failed notifications

## Benefits

### Scalability
- Decoupled event processing
- Horizontal scaling of event consumers
- Better handling of high-volume ride requests

### Reliability
- Event persistence and replay capability
- Fault tolerance through consumer groups
- Dead letter queues for failed events

### Monitoring & Analytics
- Real-time event streaming
- Event sourcing for audit trails
- Performance metrics and monitoring

### Microservices Ready
- Event-driven architecture
- Service decoupling
- Easy integration with external systems

## Configuration Options

### Kafka Client Configuration

```javascript
const kafkaConfig = {
  clientId: 'rideease-app',
  brokers: process.env.KAFKA_BROKERS.split(','),
  retry: {
    initialRetryTime: 100,
    retries: 8
  },
  connectionTimeout: 3000,
  requestTimeout: 25000
};
```

### Producer Configuration

```javascript
const producer = kafkaClient.producer({
  maxInFlightRequests: 1,
  idempotent: true,
  transactionTimeout: 30000
});
```

### Consumer Configuration

```javascript
const consumer = kafkaClient.consumer({
  groupId: 'rideease-group'
});
```

## Error Handling

The integration includes comprehensive error handling:

- **Non-blocking**: Kafka failures don't break the main application flow
- **Retry logic**: Automatic retries for transient failures
- **Graceful degradation**: Application continues to work without Kafka
- **Logging**: Detailed error logging for debugging

## Monitoring

### Event Metrics
- Events published per second
- Consumer lag monitoring
- Error rates and retry counts

### Application Metrics
- Ride request processing time
- Driver matching efficiency
- Notification delivery rates

## Future Enhancements

### Planned Features
1. **Event Sourcing**: Complete audit trail of all ride events
2. **CQRS**: Separate read/write models for better performance
3. **Saga Pattern**: Distributed transaction management
4. **Real-time Analytics**: Live dashboards and metrics
5. **ML Integration**: Event-driven machine learning pipelines

### Integration Opportunities
- **Payment Processing**: Event-driven payment workflows
- **Route Optimization**: Real-time traffic and route events
- **Driver Behavior Analysis**: Event-based driver scoring
- **Demand Forecasting**: Historical event analysis

## Troubleshooting

### Common Issues

1. **Kafka Connection Failed**
   - Check KAFKA_BROKERS environment variable
   - Verify Kafka cluster is running
   - Check network connectivity

2. **Topics Not Created**
   - Run `node kafka-setup.js setup`
   - Check Kafka broker permissions
   - Verify topic naming conventions

3. **Events Not Consumed**
   - Check consumer group configuration
   - Verify topic subscriptions
   - Monitor consumer lag

### Debug Commands

```bash
# Check Kafka topics
kafka-topics.sh --list --bootstrap-server localhost:9092

# Monitor consumer lag
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group rideease-group --describe

# View topic messages
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic rideease-ride-requested --from-beginning
```

## Support

For issues or questions regarding the Kafka integration:
1. Check the application logs for error messages
2. Verify Kafka cluster health
3. Test with the provided setup scripts
4. Review the event schemas and data formats
