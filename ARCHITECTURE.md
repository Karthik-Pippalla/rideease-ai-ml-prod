# RideEase Project Overview

## Purpose
RideEase is a ride matching and recommendation platform leveraging Telegram bots, Firebase Functions, Kafka (planned/partial), and a modular recommender system to connect riders and drivers efficiently.

## Key Components
- functions/ : Firebase Cloud Functions source (Telegram bots, controllers, recommender, utilities)
- functions/riderBot.js : Rider-focused Telegram bot supporting commands and natural language intents
- functions/driverBot.js : Driver-focused bot (similar pattern)
- functions/recommender/ : Modular recommendation system (ingest, train, serve, eval)
- config/ : Environment-specific YAML configuration
- schemas/ : Avro schema definitions for events (ride matched, recommender KPI, etc.)
- scripts/ : Monitoring & probing utilities (driftMonitor.js, probe.py)

## Rider Bot Features
Commands supported:
- /start, /help, /me, /update, /erase
- /riderequest, /cancelride, /rides, /clearcache
Natural language parsing for ride requests, profile updates, cancellations, and help intents via OpenAI.

State handling uses an in-memory state utility (utils/state.js) with phases:
- register_rider
- request_ride
- update_rider
- update_ride

## Data Flow (Ride Request)
1. User issues /riderequest or natural language.
2. OpenAI intent detection extracts structured fields (pickup, dropoff, time, bid).
3. Geocoding resolves addresses to coordinates.
4. DB layer creates an open ride request.
5. Matching module finds nearby drivers (if implemented) and notifications dispatch.

## Error Handling & Resilience
- Centralized sendError helper logs stack and sends user-friendly message.
- Cache clearing via /clearcache to reset session state.
- Defensive checks before CRUD operations (sanitizeCrudPayload, allowed action map).

## Recommendation System (Outline)
- ingest/: Streams & feature ingestion
- train/: Model training pipelines (e.g., collaborative filtering, popularity)
- serve/: Real-time recommendation endpoint
- eval/: Offline model evaluation (offlineEval.js)

## Event & Schema Strategy
Avro schemas define structured events for analytics and model KPI tracking, enabling evolution via schema registry (future Kafka integration).

## Extensibility Notes
Hook points:
- openai.detectIntent: Swap out for internal NLU if desired.
- matching.findDriversForRide: Can integrate geospatial index (e.g., Redis Geo or MongoDB 2dsphere).
- notifications.notifyDriver / notifyRider: Abstracts delivery channel; can add push or SMS.

## Environment & Deployment
- Firebase Functions host bots & APIs.
- Polling used for Telegram in non-production; webhook strategy recommended for prod.
- Configuration via NODE_ENV and YAML files in config/.

## Suggested Next Steps
1. Implement driver availability & live matching queue.
2. Move state handling to Redis for horizontal scaling.
3. Add rate limiting & abuse detection.
4. Expand recommender with real-time feedback loop (accept/reject events).
5. Add webhook-based Telegram deployment for production reliability.

## Security Considerations
- Validate all user input (already partially sanitized) including geocode queries.
- Store secrets (Telegram token, OpenAI key) in environment variables / Firebase config.
- Limit exposure of internal errors; log server-side only.

## Testing
Jest tests present (distance, offline evaluation). Extend with integration tests for CRUD and intent parsing.

## License & Changelog
See existing README.md and CHANGELOG.md for general project information and version history.

---
For deeper architectural changes, create DESIGN_DECISIONS.md documenting rationale behind modules and trade-offs.
