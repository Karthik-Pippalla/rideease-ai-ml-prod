const { loadConfig } = require('../recommender/config');
const fs = require('fs');
const path = require('path');

function psi(expected, observed) {
  let score = 0;
  for (const bin of Object.keys(expected)) {
    const e = expected[bin] || 1e-6;
    const o = observed[bin] || 1e-6;
    score += (o - e) * Math.log(o / e);
  }
  return score;
}

function bucketCoord(coord) {
  return coord.map(v => Math.round(v * 100) / 100).join(':');
}

function distribution(events, field) {
  const counts = {};
  for (const ev of events) {
    const key = field === 'location' ? bucketCoord(ev.location.coordinates) : ev[field];
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a,b) => a+b,0) || 1;
  for (const k of Object.keys(counts)) counts[k] /= total;
  return counts;
}

async function runDriftMonitor({ baselineEvents, currentEvents, outDir }) {
  const cfg = loadConfig();
  const locBaseline = distribution(baselineEvents, 'location');
  const locCurrent = distribution(currentEvents, 'location');
  const psiLocation = psi(locBaseline, locCurrent);

  const accBaseline = distribution(baselineEvents, 'accepted');
  const accCurrent = distribution(currentEvents, 'accepted');
  const psiAccepted = psi(accBaseline, accCurrent);

  const report = { psiLocation, psiAccepted, timestamp: new Date().toISOString() };
  if (outDir) {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `drift_${Date.now()}.json`), JSON.stringify(report, null, 2));
  }
  console.log('Drift report', report);
  return report;
}

module.exports = { runDriftMonitor };
