// Backpressure handling example for Kafka consumer using pause/resume
const pLimit = require('p-limit');

function createBackpressureController({ concurrency = 50 } = {}) {
  const limit = pLimit(concurrency);
  let paused = false;
  let queued = 0;
  const thresholdPause = concurrency * 5;
  const thresholdResume = concurrency * 2;

  function track(fn) {
    queued++;
    if (!paused && queued > thresholdPause && consumer?.pause) {
      consumer.pause(topics);
      paused = true;
      console.warn('Paused consumer due to backpressure');
    }
    return limit(() => fn().finally(() => {
      queued--;
      if (paused && queued < thresholdResume && consumer?.resume) {
        consumer.resume(topics);
        paused = false;
        console.info('Resumed consumer');
      }
    }));
  }

  // consumer and topics get set by the runner
  let consumer = null;
  let topics = [];
  function bind(kConsumer, kTopics) { consumer = kConsumer; topics = kTopics; }

  return { track, bind };
}

module.exports = { createBackpressureController };
