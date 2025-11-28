# 🚗 RideEase API: Working Flow & Functionalities

## Overview
RideEase is a production-ready MLOps API for real-time ride recommendations, model registry, provenance tracking, and monitoring. The API is publicly accessible and containerized for scalable deployment.

---

## 🛠️ System Architecture & Flow

1. **User Request**
   - User sends a ride request via the `/recommendations` endpoint.
   - Request includes user ID, pickup/dropoff locations, and timestamp.

2. **API Gateway (ngrok Tunnel)**
   - Public requests are routed to the local server via ngrok.
   - Ensures secure, temporary public access.

3. **Server (Node.js)**
   - Handles REST endpoints for health, metrics, recommendations, model registry, provenance, and experiments.
   - Uses Express.js for routing and middleware.

4. **Model Registry**
   - `/admin/models` endpoint returns all deployed model versions and metadata.
   - Models are stored in `functions/model_registry/` with versioned folders.

5. **Recommendation Engine**
   - Receives POST requests at `/recommendations`.
   - Loads latest model from registry.
   - Computes ride recommendations using user and location data.
   - Tracks provenance for each prediction.

6. **Provenance Tracking**
   - `/traces/{requestId}` returns the full lineage for a prediction.
   - Provenance includes model version, input features, timestamp, and decision path.

7. **A/B Experimentation**
   - `/experiments/{experimentId}/summary` provides statistical test results for experiments.
   - Supports 50/50 split testing between model versions.

8. **Monitoring & Metrics**
   - `/metrics` endpoint exposes Prometheus metrics (latency, requests, errors, uptime).
   - Metrics are collected for all API calls and model predictions.

9. **Health Check**
   - `/healthz` endpoint returns server status and uptime.

10. **Persistence**
    - MongoDB is used for storing user, ride, and model data.
    - Logs and metrics are saved in the `evidence/logs/` and `metrics/` folders.

---

## 🔗 Endpoints & Functionalities

| Endpoint                                 | Method | Functionality                                      |
|------------------------------------------|--------|---------------------------------------------------|
| `/healthz`                               | GET    | Server health and uptime                          |
| `/metrics`                               | GET    | Prometheus metrics for monitoring                 |
| `/admin/models`                          | GET    | List all model versions and metadata              |
| `/recommendations`                       | POST   | Get ride recommendations with provenance          |
| `/traces/{requestId}`                    | GET    | Get provenance trace for a prediction             |
| `/experiments/{experimentId}/summary`    | GET    | Get A/B experiment summary and test results       |

---

## 🧩 Key Functional Modules

- **Model Registry**: Versioned models, metadata, retraining automation
- **Recommendation Engine**: Real-time inference, provenance tracking
- **Experimentation**: A/B testing, statistical analysis
- **Monitoring**: Prometheus metrics, health checks
- **Persistence**: MongoDB, logs, metrics
- **Deployment**: Docker, CI/CD, ngrok, Render.com (optional permanent URL)

---

## 📝 Example Workflow

1. **User requests a ride recommendation**
   - POST `/recommendations` with user/location data
   - API returns recommended rides and provenance trace
2. **Professor checks model registry**
   - GET `/admin/models` to view all deployed models
3. **Monitor API health and metrics**
   - GET `/healthz` and `/metrics` for status and performance
4. **Analyze experiment results**
   - GET `/experiments/{experimentId}/summary` for A/B test stats
5. **Trace prediction lineage**
   - GET `/traces/{requestId}` for full provenance

---

## 🛡️ Deployment & Reliability
- **Dockerized** for reproducible builds
- **CI/CD** via GitHub Actions
- **ngrok** for public access (temporary URL)
- **Render.com** for permanent deployment
- **High availability**: 95%+ uptime

---

## 📦 Folder Structure Highlights
- `functions/` — API source code
- `functions/model_registry/` — Model versions & metadata
- `evidence/logs/` — Server, ngrok, training logs
- `metrics/` — Prometheus metrics, experiment summaries

---

## 🎉 Summary
RideEase API delivers:
- Real-time ride recommendations
- Automated model retraining
- Provenance tracking
- A/B experimentation
- Production-grade monitoring
- Scalable, containerized deployment

---

*Generated: November 28, 2025*
