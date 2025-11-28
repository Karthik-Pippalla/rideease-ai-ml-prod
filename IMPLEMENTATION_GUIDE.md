# Implementation Guide - Next Steps

## Quick Start

### 1. Install Dependencies
```bash
cd functions
npm install express-rate-limit winston
```

### 2. Test Fairness Evaluation
```bash
# Start your MongoDB connection
# Then test:
node -e "
const { connect } = require('./pipeline/db');
const { evaluateFairness } = require('./pipeline/fairness');
connect().then(() => evaluateFairness({windowHours: 24}))
  .then(console.log)
  .catch(console.error);
"
```

### 3. Test Feedback Loop Detection
```bash
node -e "
const { connect } = require('./pipeline/db');
const { detectFeedbackLoops } = require('./pipeline/feedbackLoop');
connect().then(() => detectFeedbackLoops({windowHours: 168}))
  .then(console.log)
  .catch(console.error);
"
```

### 4. Start Server with New Endpoints
```bash
npm run pipeline:serve
# Then test:
curl http://localhost:8080/fairness?windowHours=24
curl http://localhost:8080/feedback-loops?windowHours=168
```

## Implementation Status

### ✅ Completed
- [x] Fairness evaluation module (`fairness.js`)
- [x] Feedback loop detection module (`feedbackLoop.js`)
- [x] Telemetry queries module (`telemetry.js`)
- [x] Security utilities (`security.js`)
- [x] Server endpoints (`/fairness`, `/feedback-loops`)
- [x] Documentation skeletons (FAIRNESS.md, FEEDBACK_LOOPS.md, SECURITY.md, REFLECTION.md)
- [x] AdminAuditLog model

### ⏳ Next Steps

#### Phase 1: Testing & Validation
1. **Test fairness evaluation with real data**
   - Generate test events with known patterns
   - Verify exposure shares are computed correctly
   - Check Gini coefficient calculations

2. **Test feedback loop detection**
   - Create test scenarios with known feedback loops
   - Verify cycle time calculations
   - Test amplification detection

3. **Integration testing**
   - Test endpoints with various window sizes
   - Verify error handling
   - Test with empty data sets

#### Phase 2: Monitoring Integration
1. **Add Prometheus metrics for fairness**
   ```javascript
   // In server.js, add:
   const fairnessGiniGauge = new promClient.Gauge({
     name: 'rideease_fairness_gini_coefficient',
     help: 'Gini coefficient for exposure distribution',
     labelNames: ['variant'],
     registers: [registry],
   });
   ```

2. **Add alerts for feedback loops**
   - Alert when short cycles detected
   - Alert when extreme amplification detected

3. **Create Grafana dashboards**
   - Fairness metrics dashboard
   - Feedback loop monitoring dashboard

#### Phase 3: Production Hardening
1. **Add rate limiting** (optional, requires express-rate-limit)
   ```javascript
   // In server.js:
   const { createRateLimiter } = require('./security');
   app.use('/recommendations', createRateLimiter({ windowMs: 60000, max: 100 }));
   ```

2. **Add input validation** (already implemented, just need to use it)
   ```javascript
   // In server.js:
   const { validateRecommendationRequest } = require('./security');
   app.post('/recommendations', validateRecommendationRequest, async (req, res) => {
     // ... existing code
   });
   ```

3. **Add audit logging for admin actions**
   ```javascript
   // In server.js, update admin endpoints:
   const { logAdminAction } = require('./security');
   app.post('/admin/switch-model', adminGuard, async (req, res) => {
     await logAdminAction({
       action: 'switch_model',
       userId: req.headers['x-api-key']?.substring(0, 8),
       details: req.body,
       ip: req.ip,
     });
     // ... existing code
   });
   ```

#### Phase 4: Documentation
1. **Complete documentation**
   - Add examples to FAIRNESS.md
   - Add examples to FEEDBACK_LOOPS.md
   - Add API examples to SECURITY.md
   - Complete REFLECTION.md with actual learnings

2. **Create runbooks**
   - How to investigate fairness issues
   - How to investigate feedback loops
   - How to respond to anomalies

## Testing Checklist

### Fairness Evaluation
- [ ] Test with empty data (no recommendations)
- [ ] Test with single variant
- [ ] Test with both variants
- [ ] Verify Gini coefficient calculation
- [ ] Verify diversity metrics
- [ ] Test with different window sizes

### Feedback Loops
- [ ] Test with no feedback loops
- [ ] Test with known feedback loops
- [ ] Verify cycle time calculation
- [ ] Verify amplification detection
- [ ] Test anomaly detection
- [ ] Test with different window sizes

### Telemetry Queries
- [ ] Test conversion funnel
- [ ] Test item popularity trends
- [ ] Test user engagement patterns
- [ ] Test model version performance
- [ ] Test recommendation diversity

### Security
- [ ] Test input validation
- [ ] Test rate limiting (if enabled)
- [ ] Test audit logging
- [ ] Test admin guard

## Common Issues & Solutions

### Issue: "Cannot find module './fairness'"
**Solution:** Make sure you're running from the correct directory. The modules are in `functions/pipeline/`.

### Issue: "MongoDB connection error"
**Solution:** Ensure `MONGODB_URI` is set in your environment.

### Issue: "No data returned"
**Solution:** Generate test events first using `generateTestEvents.js`.

### Issue: "Gini coefficient is NaN"
**Solution:** This happens when there's no data. Add a check for empty data sets.

## Performance Considerations

### Fairness Evaluation
- **Window size:** Larger windows = more data = slower queries
- **Optimization:** Add indexes on `ts`, `type`, `payload.variant`
- **Caching:** Consider caching results for frequently accessed windows

### Feedback Loop Detection
- **Window size:** 168 hours (1 week) is default, but can be slow
- **Optimization:** Use MongoDB aggregation pipelines for better performance
- **Sampling:** For very large datasets, consider sampling

### Telemetry Queries
- **Indexes:** Ensure proper indexes on frequently queried fields
- **Aggregation:** Use MongoDB aggregation for complex queries
- **Pagination:** Consider pagination for large result sets

## Next Milestone Checklist

Before moving to the next milestone, ensure:

1. ✅ Fairness evaluation is implemented and tested
2. ✅ Feedback loop detection is implemented and tested
3. ✅ Telemetry queries are working
4. ✅ Security measures are in place (or documented as optional)
5. ✅ Documentation is complete
6. ✅ All endpoints are tested
7. ✅ Monitoring/alerting is set up (or documented)
8. ✅ Reflection document is complete

## Questions to Answer

1. **Fairness:** Are your recommendations fair? What does "fair" mean for your use case?
2. **Feedback Loops:** Are you detecting feedback loops? How are you mitigating them?
3. **Security:** What security measures are in place? What threats are you protecting against?
4. **Telemetry:** What queries are you running? What insights are you gaining?
5. **Reflection:** What worked well? What would you do differently?

