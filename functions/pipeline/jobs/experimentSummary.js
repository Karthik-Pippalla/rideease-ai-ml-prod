#!/usr/bin/env node
require('dotenv').config();

const { connect, disconnect } = require('../db');
const { summarizeExperiment } = require('../experimentation');

async function main() {
  const windowHours = parseInt(process.argv[2] || process.env.EXPERIMENT_WINDOW_HOURS || '24', 10);
  await connect();
  const summary = await summarizeExperiment({ windowHours });
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => disconnect())
  .catch((err) => {
    console.error('Experiment summary failed', err);
    disconnect().finally(() => process.exit(1));
  });
