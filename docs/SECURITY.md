# Security Design

## Overview

This document describes the security architecture, authentication, authorization, and best practices for the RideEase MLOps pipeline.

## Architecture

### Components
1. **Inference Service** (`/recommendations`) - Public endpoint
2. **Admin API** (`/admin/*`) - Protected endpoint
3. **Model Registry** - Internal service
4. **Training Pipeline** - Scheduled jobs

## Authentication & Authorization

### Admin API
- **Method:** API Key authentication
- **Header:** `X-API-Key: <MODEL_ADMIN_API_KEY>`
- **Endpoints:**
  - `GET /admin/models` - List models and serving state
  - `POST /admin/switch-model` - Switch model versions

### Public Endpoints
- **Method:** No authentication (public API)
- **Protection:** Rate limiting
- **Endpoints:**
  - `POST /recommendations` - Get recommendations
  - `GET /healthz` - Health check
  - `GET /metrics` - Prometheus metrics

## Input Validation

### Recommendation Requests
- `userId`: Required, string, max 256 characters
- `limit`: Optional, integer, 1-100

### Event Validation
- Type validation (recommend, play, view, skip)
- Timestamp validation
- Required fields check

## Rate Limiting

### Public Endpoints
- **Limit:** 100 requests per minute per IP
- **Window:** 60 seconds
- **Response:** 429 Too Many Requests

### Admin Endpoints
- **Limit:** 10 requests per minute per API key
- **Window:** 60 seconds

## Audit Logging

### Admin Actions
All admin operations are logged:
- Model version switches
- Configuration changes
- Access attempts

**Log Fields:**
- Action type
- User/API key identifier
- Timestamp
- IP address
- Request details

## Data Protection

### Sensitive Data
- User IDs: Stored as-is (no PII in IDs)
- Model artifacts: Stored in secure object storage
- API keys: Stored as environment variables

### Encryption
- TLS/HTTPS for all API endpoints
- Encrypted connections to MongoDB
- Encrypted connections to Kafka

## Security Best Practices

### 1. Environment Variables
- Never commit secrets to version control
- Use secret management (e.g., Google Secret Manager, AWS Secrets Manager)
- Rotate API keys regularly

### 2. Container Security
- Use minimal base images
- Scan images for vulnerabilities
- Run containers as non-root user

### 3. Network Security
- Use private networks for internal services
- Implement network policies
- Use VPN for admin access

### 4. Monitoring
- Monitor for suspicious activity
- Alert on failed authentication attempts
- Track rate limit violations

## Threat Model

### Threats
1. **Unauthorized model switching** - Mitigated by API key auth
2. **DDoS attacks** - Mitigated by rate limiting
3. **Data injection** - Mitigated by input validation
4. **Model poisoning** - Mitigated by model validation and provenance tracking

### Mitigations
- Authentication for admin operations
- Rate limiting for public endpoints
- Input validation and sanitization
- Audit logging for compliance

## Compliance

### GDPR Considerations
- User data anonymization
- Right to deletion (if applicable)
- Data retention policies

### Audit Requirements
- All admin actions logged
- Model version changes tracked
- Provenance tracking for predictions

## Implementation

See `functions/pipeline/security.js` for implementation details.

## Future Work

- OAuth2 integration
- Role-based access control (RBAC)
- API key rotation automation
- Security scanning in CI/CD

