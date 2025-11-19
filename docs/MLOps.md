# RideEase MLOps Blueprint

## 1. Containerized services
- **Inference** (`Dockerfile.app`): multi-stage Node 22 image that only copies the `functions` workspace and production node_modules. Healthcheck calls `/healthz`. Deploy on Cloud Run, GKE, ACA, etc.
- **Training job** (`Dockerfile.train`): multi-stage container for the scheduled trainer (`pipeline/jobs/trainAndPublish.js`). Mount `/artifacts` to publish registry files.
- Build/push locally:
  ```bash
  docker build -f Dockerfile.app -t ghcr.io/<org>/reco-app:$(git rev-parse --short HEAD) .
  docker build -f Dockerfile.train -t ghcr.io/<org>/reco-train:$(git rev-parse --short HEAD) .
  ```

## 2. Automated retraining & registry publication
- GitHub Action `.github/workflows/model-retraining.yml` runs every day at 07:00 UTC and exposes a manual trigger. Set repo secrets `MONGODB_URI`, `MONGODB_DB`, `MODEL_REGISTRY_URI` (e.g. `gs://rideease-models`), and optionally `CONTAINER_IMAGE_DIGEST`.
- The workflow:
  1. Builds the trainer image.
  2. Runs it with the above env vars, mounting `model_registry_run/`.
  3. Uploads the generated `model_registry_run/vX.Y/` artifact for traceability.
- Alternative: deploy the same trainer image as a Cloud Run Job / ACA Job and schedule it via Cloud Scheduler or Logic Apps. Example command:
  ```bash
  gcloud run jobs create reco-trainer \
    --image=ghcr.io/<org>/reco-train:<tag> \
    --set-env-vars=MONGODB_URI=... --set-env-vars=MODEL_REGISTRY_URI=gs://rideease-models
  gcloud scheduler jobs create http reco-trainer --schedule="0 7 * * *" --uri="https://<job-endpoint>" --http-method=POST --oauth-service-account-email=<svc>@project.iam.gserviceaccount.com
  ```
- Artifacts land in `model_registry/vX.Y/` with `model.json` and `metadata.json` referencing the remote URI for downstream consumers.

## 3. Safe model switching & registry API
- Every training run registers metadata in Mongo (`models` collection) plus a filesystem/object-store copy under `model_registry/vX.Y`.
- Serving state lives in `model_serving_state` and maps `control`/`treatment` to versions.
- Use the inference admin API (requires `MODEL_ADMIN_API_KEY` header):
  - `GET /admin/models` – enumerate versions + serving state.
  - `POST /admin/switch-model` body `{ "version": "v1.3.0", "target": "control" }` or `target: "treatment"` for staged rollouts, or `target: "all"` for full hot swaps.
- Backwards-compatible fallback: if the `treatment` bucket misbehaves, set it back to the `control` version instantly.

## 4. Monitoring, dashboard, and alerts
- `/metrics` exports Prometheus metrics with custom names (`rideease_prediction_latency_ms`, `rideease_prediction_requests_total`, `rideease_prediction_errors_total`, `rideease_service_uptime_seconds`).
- `monitoring/grafana-dashboard.json` imports directly into Grafana to chart p95 latency, error rate, uptime, and variant traffic split.
- Alert rules live in `monitoring/alerts-policy.yaml`; wire them into Alertmanager or Cloud Monitoring. Each rule links to `monitoring/RUNBOOK.md` for remediation steps.
- The runbook documents how to inspect logs, toggle variants, and restart the service safely.

## 5. Experimentation & decisioning
- `assignVariant()` deterministically shards on SHA1(userId) ⇒ control/treatment.
- `/recommendations` automatically logs the variant and writes provenance data.
- `/experiments/rec-engine/summary?windowHours=24` (or `npm run pipeline:experiments`) pulls the last N hours of user events, computes conversion lifts, and performs a two-proportion z-test.
- Responses include conversion rate deltas, 95% CI, `pValue`, and a decision of `ship`, `rollback`, or `keep-running` to make A/B decisions explicit.

## 6. Provenance & traceability
- Every prediction logs to `prediction_traces` with `requestId`, `userId`, `variant`, `modelVersion`, `dataSnapshotId`, `pipelineGitSha`, and `containerImageDigest` plus latency and payload metadata.
- Retrieve any request via `GET /traces/<requestId>` to trace lineage end-to-end (useful for audits and RCA).
- Training artifacts also capture `dataSnapshotId`, `pipelineGitSha`, and `containerImageDigest` inside `model_registry/vX.Y/metadata.json`.

## 7. Local operations
- Start the inference service locally: `npm run pipeline:serve` (requires `MONGODB_URI` and `MODEL_ADMIN_API_KEY`).
- Trigger manual training: `npm run pipeline:train` (ensure registry paths exist or mount a volume).
- Examine active experiment stats: `npm run pipeline:experiments 48` to compute a 48-hour window.
