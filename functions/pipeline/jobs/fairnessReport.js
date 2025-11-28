#!/usr/bin/env node
// Periodic fairness evaluation report
require('dotenv').config();
const { connect, disconnect } = require('../db');
const { evaluateFairness } = require('../fairness');
const { logAdminAction } = require('../security');

async function main() {
  await connect();
  const windowHours = parseInt(process.env.FAIRNESS_WINDOW_HOURS || '24', 10);
  
  try {
    const report = await evaluateFairness({ windowHours });
    
    // Output structured JSON for log aggregation
    console.log(JSON.stringify({
      type: 'fairness_report',
      timestamp: new Date().toISOString(),
      windowHours,
      summary: report.summary,
      giniCoefficients: report.exposure.giniCoefficient,
    }));
    
    // Alert if unfair (Gini difference > 0.1)
    if (report.summary.exposureFairness === 'unfair') {
      await logAdminAction({
        action: 'fairness_alert',
        details: { 
          giniDifference: report.summary.giniDifference,
          report: report.summary 
        },
      }).catch(err => console.error('Failed to log admin action', err));
    }
  } catch (err) {
    console.error('Fairness report failed', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

