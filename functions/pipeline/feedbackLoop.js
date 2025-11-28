// Feedback loop detection: identify recommendation → interaction → recommendation cycles
const { RawEvent } = require('./ingest');

/**
 * Detect feedback loops: items recommended → interacted → retrained → recommended again
 */
async function detectFeedbackLoops({ windowHours = 168 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  // Get all recommendations in window
  const recommendations = await RawEvent.find({
    ts: { $gte: since },
    type: 'recommend',
  }).sort({ ts: 1 }).lean();
  
  // Get all interactions in window
  const interactions = await RawEvent.find({
    ts: { $gte: since },
    type: { $in: ['play', 'view'] },
  }).sort({ ts: 1 }).lean();
  
  // Track item lifecycle: recommended → interacted → recommended again
  const itemLifecycle = new Map(); // itemId -> { firstRecommended, firstInteracted, secondRecommended }
  
  for (const rec of recommendations) {
    const items = (rec.payload?.items || []).map(id => 
      typeof id === 'string' ? id : (id?.itemId || String(id))
    );
    const recTime = new Date(rec.ts).getTime();
    
    for (const itemId of items) {
      if (!itemLifecycle.has(itemId)) {
        itemLifecycle.set(itemId, { firstRecommended: recTime });
      } else {
        const lifecycle = itemLifecycle.get(itemId);
        if (!lifecycle.firstInteracted && !lifecycle.secondRecommended) {
          lifecycle.secondRecommended = recTime;
        } else if (lifecycle.firstInteracted && !lifecycle.secondRecommended) {
          lifecycle.secondRecommended = recTime;
        }
      }
    }
  }
  
  for (const interaction of interactions) {
    const itemId = interaction.itemId;
    if (itemId && itemLifecycle.has(itemId)) {
      const lifecycle = itemLifecycle.get(itemId);
      if (!lifecycle.firstInteracted) {
        lifecycle.firstInteracted = new Date(interaction.ts).getTime();
      }
    }
  }
  
  // Identify feedback loops: recommended → interacted → recommended again
  const feedbackLoops = [];
  for (const [itemId, lifecycle] of itemLifecycle) {
    if (lifecycle.firstRecommended && lifecycle.firstInteracted && lifecycle.secondRecommended) {
      const cycleTime = lifecycle.secondRecommended - lifecycle.firstRecommended;
      feedbackLoops.push({
        itemId,
        cycleTimeMs: cycleTime,
        cycleTimeHours: cycleTime / (3600 * 1000),
      });
    }
  }
  
  // Compute amplification: items that got more popular after being recommended
  const amplification = await computeAmplification({ since, recommendations, interactions });
  
  return {
    windowHours,
    feedbackLoops: feedbackLoops.length,
    avgCycleTimeHours: feedbackLoops.length > 0
      ? feedbackLoops.reduce((sum, f) => sum + f.cycleTimeHours, 0) / feedbackLoops.length
      : 0,
    amplification,
    details: feedbackLoops.slice(0, 10), // Top 10 examples
  };
}

/**
 * Compute amplification: items that became more popular after being recommended
 */
async function computeAmplification({ since, recommendations, interactions }) {
  const itemRecommendationCounts = new Map();
  const itemInteractionCountsBefore = new Map();
  const itemInteractionCountsAfter = new Map();
  const itemFirstRecommendationTime = new Map();
  
  // Count recommendations per item and track first recommendation time
  for (const rec of recommendations) {
    const items = (rec.payload?.items || []).map(id => 
      typeof id === 'string' ? id : (id?.itemId || String(id))
    );
    const recTime = new Date(rec.ts).getTime();
    
    for (const itemId of items) {
      itemRecommendationCounts.set(itemId, (itemRecommendationCounts.get(itemId) || 0) + 1);
      
      if (!itemFirstRecommendationTime.has(itemId)) {
        itemFirstRecommendationTime.set(itemId, recTime);
        itemInteractionCountsBefore.set(itemId, 0);
        itemInteractionCountsAfter.set(itemId, 0);
      }
    }
  }
  
  // Count interactions before/after first recommendation
  for (const interaction of interactions) {
    const itemId = interaction.itemId;
    if (!itemId || !itemFirstRecommendationTime.has(itemId)) continue;
    
    const interactionTime = new Date(interaction.ts).getTime();
    const firstRecTime = itemFirstRecommendationTime.get(itemId);
    
    if (interactionTime < firstRecTime) {
      itemInteractionCountsBefore.set(itemId, (itemInteractionCountsBefore.get(itemId) || 0) + 1);
    } else {
      itemInteractionCountsAfter.set(itemId, (itemInteractionCountsAfter.get(itemId) || 0) + 1);
    }
  }
  
  // Compute amplification ratio
  const amplificationRatios = [];
  for (const [itemId, recCount] of itemRecommendationCounts) {
    const before = itemInteractionCountsBefore.get(itemId) || 0;
    const after = itemInteractionCountsAfter.get(itemId) || 0;
    const ratio = before > 0 ? after / before : (after > 0 ? Infinity : 0);
    amplificationRatios.push({ itemId, recCount, before, after, ratio });
  }
  
  amplificationRatios.sort((a, b) => {
    const aRatio = isFinite(a.ratio) ? a.ratio : 0;
    const bRatio = isFinite(b.ratio) ? b.ratio : 0;
    return bRatio - aRatio;
  });
  
  const finiteRatios = amplificationRatios.filter(r => isFinite(r.ratio));
  const avgAmplificationRatio = finiteRatios.length > 0
    ? finiteRatios.reduce((sum, r) => sum + r.ratio, 0) / finiteRatios.length
    : 0;
  
  return {
    avgAmplificationRatio,
    topAmplified: amplificationRatios.slice(0, 10),
  };
}

/**
 * Detect anomalies in feedback loops (e.g., very short cycles, extreme amplification)
 */
async function detectFeedbackAnomalies({ windowHours = 168 } = {}) {
  const loops = await detectFeedbackLoops({ windowHours });
  
  const anomalies = [];
  
  // Anomaly: very short feedback cycles (< 1 hour)
  const shortCycles = loops.details.filter(f => f.cycleTimeHours < 1);
  if (shortCycles.length > 0) {
    anomalies.push({
      type: 'short_feedback_cycle',
      severity: 'high',
      count: shortCycles.length,
      description: `${shortCycles.length} items have feedback cycles < 1 hour`,
      examples: shortCycles.slice(0, 5),
    });
  }
  
  // Anomaly: extreme amplification (> 10x)
  const extremeAmplification = loops.amplification.topAmplified.filter(a => 
    a.ratio > 10 && isFinite(a.ratio)
  );
  if (extremeAmplification.length > 0) {
    anomalies.push({
      type: 'extreme_amplification',
      severity: 'medium',
      count: extremeAmplification.length,
      description: `${extremeAmplification.length} items show >10x amplification`,
      examples: extremeAmplification.slice(0, 5),
    });
  }
  
  // Anomaly: high concentration (top 10 items get > 50% of recommendations)
  const totalRecs = loops.amplification.topAmplified.reduce((sum, a) => sum + a.recCount, 0);
  const top10Recs = loops.amplification.topAmplified.slice(0, 10).reduce((sum, a) => sum + a.recCount, 0);
  const concentration = totalRecs > 0 ? top10Recs / totalRecs : 0;
  
  if (concentration > 0.5) {
    anomalies.push({
      type: 'high_concentration',
      severity: 'medium',
      count: 10,
      description: `Top 10 items receive ${(concentration * 100).toFixed(1)}% of recommendations`,
      concentration,
    });
  }
  
  return {
    windowHours,
    anomalies,
    summary: anomalies.length > 0 ? 'anomalies_detected' : 'no_anomalies',
  };
}

module.exports = {
  detectFeedbackLoops,
  computeAmplification,
  detectFeedbackAnomalies,
};

