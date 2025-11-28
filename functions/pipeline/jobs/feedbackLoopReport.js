#!/usr/bin/env node
// Periodic feedback loop detection report
require('dotenv').config();
const { connect, disconnect } = require('../db');
const { detectFeedbackLoops, detectFeedbackAnomalies } = require('../feedbackLoop');
const { logAdminAction } = require('../security');

async function main() {
  await connect();
  const windowHours = parseInt(process.env.FEEDBACK_LOOP_WINDOW_HOURS || '168', 10);
  
  try {
    const [loops, anomalies] = await Promise.all([
      detectFeedbackLoops({ windowHours }),
      detectFeedbackAnomalies({ windowHours }),
    ]);
    
    console.log(JSON.stringify({
      type: 'feedback_loop_report',
      timestamp: new Date().toISOString(),
      windowHours,
      loops: loops.feedbackLoops,
      avgCycleTime: loops.avgCycleTimeHours,
      amplification: loops.amplification.avgAmplificationRatio,
      anomalies: anomalies.summary,
      anomalyCount: anomalies.anomalies.length,
    }));
    
    // Alert on anomalies
    if (anomalies.summary === 'anomalies_detected') {
      await logAdminAction({
        action: 'feedback_loop_anomaly',
        details: { 
          anomalyCount: anomalies.anomalies.length,
          anomalies: anomalies.anomalies.map(a => ({ type: a.type, severity: a.severity }))
        },
      }).catch(err => console.error('Failed to log admin action', err));
    }
  } catch (err) {
    console.error('Feedback loop report failed', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

