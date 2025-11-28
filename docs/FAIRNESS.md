# Fairness Evaluation

## Overview

Fairness evaluation ensures that our recommendation system treats items and users equitably. This document describes the fairness metrics, evaluation methods, and monitoring practices.

## Metrics

### 1. Exposure Shares

**Definition:** The percentage of total recommendations each item receives.

**Computation:**
- Count all `recommend` events in a time window
- For each item, count how many times it appears in recommendations
- Compute share: `item_exposures / total_exposures`

**Fairness Criteria:**
- Items should receive exposure proportional to their popularity (not over-amplified)
- Gini coefficient < 0.5 indicates relatively fair distribution

### 2. Diversity Metrics

**Intra-List Diversity:**
- Measures how diverse individual recommendation sets are
- Higher diversity = more variety in recommendations per user

**Coverage:**
- Number of unique items recommended across all users
- Higher coverage = more items get exposure

**Entropy:**
- Information-theoretic measure of distribution uniformity
- Higher entropy = more uniform distribution

### 3. Variant Comparison

**Fairness Across A/B Variants:**
- Compare exposure shares between control and treatment
- Compare diversity metrics between variants
- Flag if variants show significantly different fairness characteristics

## API Endpoint

```
GET /fairness?windowHours=24
```

**Response:**
```json
{
  "windowHours": 24,
  "exposure": {
    "control": {
      "shares": {
        "item1": { "exposures": 100, "share": 0.25 },
        "item2": { "exposures": 80, "share": 0.20 }
      },
      "totalExposures": 400
    },
    "treatment": { ... },
    "giniCoefficient": {
      "control": 0.35,
      "treatment": 0.42
    }
  },
  "diversity": {
    "control": {
      "avgIntraListDiversity": 0.65,
      "coverage": 150,
      "entropy": 6.2
    },
    "treatment": { ... }
  },
  "summary": {
    "exposureFairness": "fair",
    "diversityComparison": "similar"
  }
}
```

## Monitoring

### Alerts
- Gini coefficient > 0.7 (highly unfair distribution)
- Exposure share difference between variants > 20%
- Diversity metrics differ significantly between variants

### Dashboards
- Exposure share distribution (histogram)
- Diversity metrics over time
- Variant comparison charts

## Implementation

See `functions/pipeline/fairness.js` for implementation details.

## Future Work

- Demographic parity (if user segments available)
- Long-tail item promotion
- Fairness-aware training objectives

