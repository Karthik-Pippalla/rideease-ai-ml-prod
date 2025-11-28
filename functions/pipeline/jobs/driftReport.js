#!/usr/bin/env node
// Periodic drift detection report
require('dotenv').config();
const { connect, disconnect } = require('../db');
const { computeDistribution, detectDrift } = require('../drift');

async function main() {
  await connect();
  
  try {
    // Get baseline from last week
    const baseline = await computeDistribution({ hours: 168 });
    
    // Compare with current 24h
    const drift = await detectDrift({ baseline, threshold: 0.5 });
    
    const hasDrift = Object.values(drift).some(d => d.drift);
    
    console.log(JSON.stringify({
      type: 'drift_report',
      timestamp: new Date().toISOString(),
      drift,
      hasDrift,
    }));
    
    // Exit with error code if drift detected (for alerting)
    if (hasDrift) {
      console.error('⚠️  Drift detected:', JSON.stringify(drift));
      process.exit(1);
    }
  } catch (err) {
    console.error('Drift report failed', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

