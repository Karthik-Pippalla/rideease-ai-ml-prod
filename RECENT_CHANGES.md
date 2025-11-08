# Recent Changes (2025-11-07)

## Infrastructure & Config
- Added YAML env-based configuration (`config/*.yaml`) and loader (`functions/recommender/config.js`).
- Introduced modular pipeline directories: ingest/, transform/, train/, serialize/, serve/, eval/.

## Recommendation System
- Implemented offline evaluation module (`offlineEval.js`) with chronological split, metrics (Precision@K, Recall@K, NDCG@K, Coverage, Diversity) and leakage prevention.
- Added subpopulation slicing (city, time-of-day, tenure) and JSON report emission.
- Added drift monitor script (`functions/scripts/driftMonitor.js`) computing PSI for location & acceptance distributions.

## Models
- Existing models (`popularityModel.js`, `itemItemCF.js`) integrated into offline eval.

## Streaming & Kafka
- Extended Kafka utilities with metrics topic publishing and Avro integration (`functions/utils/kafka.js`, `functions/utils/avro.js`).
- Added Avro schemas: recommendation_served, rider_action, ride_matched, recommender_kpi (`schemas/*.avsc`).
- Implemented KPI consumer (`kpiConsumer.js`) with success window logic (engagement/conversion within N minutes) and basic backpressure pause/resume.

## Evaluation & Monitoring
- Nightly workflow invoking offline eval & drift monitor (`.github/workflows/nightly_eval.yml`).

## CI/CD
- Tests & lint workflow (`tests_lint.yml`) with Jest coverage threshold (≥70%).
- Build & push Docker image workflow (`build_push.yml`).
- Deploy workflow skeleton (`deploy.yml`) with placeholders for Cloud Run / ECS / ACA.

## Testing
- Added Jest configuration (`functions/jest.config.js`).
- Added unit tests for distance util and offline eval (`functions/__tests__`).

## Metrics & Reporting
- KPI events published as Avro to metrics topic (engagementRate, conversionRate, served counts).

## Misc
- Added caching for schema registry subjects.
- Added coverage collection for recommender modules.

---
Next potential enhancements:
1. Full Avro decoding in consumers for all topics.
2. Additional slice dimensions (surge periods, rider segment).
3. Integration tests using embedded Kafka (Testcontainers).
4. Automatic artifact versioning on model serialization.
5. Alerting workflow on drift threshold breaches.
