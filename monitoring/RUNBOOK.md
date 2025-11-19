# RideEase Recommender Runbook

## On-call Checklist
1. Confirm alert firing metric in Grafana dashboard `RideEase Recommender SLOs`.
2. `kubectl logs` or `gcloud run jobs executions describe` for the inference service container to gather context.
3. Check `/metrics` and `/healthz` locally through `kubectl port-forward` if needed.
4. Decide to switch model versions or disable treatment traffic using `/admin/switch-model`.

## p95 Latency > 400ms (`RecommenderP95LatencyHigh`)
- Validate upstream Mongo connectivity latency (watch `MongoDB connected` logs).
- Inspect recent deployments or hot swaps that could load large models.
- Mitigation: scale horizontal replicas (Cloud Run min instances) or reduce `limit` parameter defaults; hot swap back to the previous `control` version using the admin API.

## Error rate > 2% (`RecommenderErrorRateHigh`)
- Check logs for stack traces around `/recommendations`.
- Verify Mongo availability and credentials.
- Confirm experiment treatment version is healthy; if not, run `POST /admin/switch-model {"version": "<control-version>", "target": "treatment"}` to disable it.

## Uptime stalled (`RecommenderUptimeStalled`)
- Indicates the container restarted repeatedly.
- Pull Cloud Run job/service events or Kubernetes events for OOM / crash indicators.
- Validate `MODEL_ADMIN_API_KEY`, `MONGODB_URI`, and registry variables are set.

## Automated Retraining Failures
- Inspect GitHub Action `nightly-model-retraining` logs.
- The job emits `model_registry_run/<version>` artifacts; download for forensic analysis.
- Re-run locally: `npm run pipeline:train` with the same env.
- After manual rerun, publish by uploading registry directory to the configured object store.
