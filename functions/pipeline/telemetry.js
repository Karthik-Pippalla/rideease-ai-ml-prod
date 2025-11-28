// Telemetry queries: MongoDB aggregations for analysis
const { RawEvent } = require('./ingest');
const { PredictionTrace } = require('./models');

/**
 * MongoDB aggregation: Get recommendation → interaction conversion funnel
 */
async function getConversionFunnel({ windowHours = 24, variant = null } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const matchStage = {
    ts: { $gte: since },
  };
  if (variant) {
    matchStage['payload.variant'] = variant;
  }
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' },
      },
    },
    {
      $project: {
        type: '$_id',
        count: 1,
        uniqueUsers: { $size: '$uniqueUsers' },
      },
    },
  ];
  
  const results = await RawEvent.aggregate(pipeline);
  return results;
}

/**
 * MongoDB aggregation: Item popularity over time (detect trending items)
 */
async function getItemPopularityTrend({ windowHours = 168, itemId = null } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const matchStage = {
    ts: { $gte: since },
    type: { $in: ['play', 'view'] },
  };
  if (itemId) matchStage.itemId = itemId;
  
  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: {
          itemId: '$itemId',
          hour: { $dateTrunc: { date: '$ts', unit: 'hour' } },
        },
        interactions: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.itemId',
        hourlyInteractions: {
          $push: {
            hour: '$_id.hour',
            count: '$interactions',
          },
        },
        totalInteractions: { $sum: '$interactions' },
      },
    },
    { $sort: { totalInteractions: -1 } },
    { $limit: 20 },
  ];
  
  return await RawEvent.aggregate(pipeline);
}

/**
 * MongoDB aggregation: User engagement patterns (detect power users vs casual)
 */
async function getUserEngagementPatterns({ windowHours = 168 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const pipeline = [
    {
      $match: {
        ts: { $gte: since },
        type: { $in: ['play', 'view'] },
      },
    },
    {
      $group: {
        _id: '$userId',
        interactionCount: { $sum: 1 },
        uniqueItems: { $addToSet: '$itemId' },
        firstInteraction: { $min: '$ts' },
        lastInteraction: { $max: '$ts' },
      },
    },
    {
      $project: {
        userId: '$_id',
        interactionCount: 1,
        uniqueItemsCount: { $size: '$uniqueItems' },
        sessionSpanHours: {
          $divide: [
            { $subtract: ['$lastInteraction', '$firstInteraction'] },
            3600000,
          ],
        },
        category: {
          $cond: {
            if: { $gte: ['$interactionCount', 10] },
            then: 'power_user',
            else: {
              $cond: {
                if: { $gte: ['$interactionCount', 3] },
                then: 'regular_user',
                else: 'casual_user',
              },
            },
          },
        },
      },
    },
    { $sort: { interactionCount: -1 } },
  ];
  
  return await RawEvent.aggregate(pipeline);
}

/**
 * MongoDB aggregation: Model version performance comparison
 */
async function getModelVersionPerformance({ windowHours = 24 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const pipeline = [
    {
      $match: {
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: '$modelVersion',
        requestCount: { $sum: 1 },
        avgLatency: { $avg: '$latencyMs' },
        uniqueUsers: { $addToSet: '$userId' },
        latencies: { $push: '$latencyMs' },
      },
    },
    {
      $project: {
        modelVersion: '$_id',
        requestCount: 1,
        avgLatency: { $round: ['$avgLatency', 2] },
        uniqueUsers: { $size: '$uniqueUsers' },
        latencies: 1,
      },
    },
  ];
  
  const results = await PredictionTrace.aggregate(pipeline);
  
  // Compute p95 latency manually (MongoDB percentile requires MongoDB 5.0+)
  for (const result of results) {
    if (result.latencies && result.latencies.length > 0) {
      const sorted = result.latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      result.p95Latency = sorted[p95Index] || 0;
    } else {
      result.p95Latency = 0;
    }
    delete result.latencies;
  }
  
  return results;
}

/**
 * MongoDB aggregation: Detect recommendation diversity per user
 */
async function getUserRecommendationDiversity({ windowHours = 24 } = {}) {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  
  const pipeline = [
    {
      $match: {
        ts: { $gte: since },
        type: 'recommend',
      },
    },
    {
      $group: {
        _id: '$userId',
        recommendationCount: { $sum: 1 },
        allItems: { $push: '$payload.items' },
        variants: { $addToSet: '$payload.variant' },
      },
    },
    {
      $project: {
        userId: '$_id',
        recommendationCount: 1,
        uniqueItemsCount: {
          $size: {
            $reduce: {
              input: '$allItems',
              initialValue: [],
              in: { $setUnion: ['$$value', { $ifNull: ['$$this', []] }] },
            },
          },
        },
        variants: 1,
      },
    },
    {
      $project: {
        userId: 1,
        recommendationCount: 1,
        uniqueItemsCount: 1,
        diversityRatio: {
          $cond: {
            if: { $gt: ['$recommendationCount', 0] },
            then: {
              $divide: ['$uniqueItemsCount', '$recommendationCount'],
            },
            else: 0,
          },
        },
        variants: 1,
      },
    },
    { $sort: { recommendationCount: -1 } },
  ];
  
  return await RawEvent.aggregate(pipeline);
}

module.exports = {
  getConversionFunnel,
  getItemPopularityTrend,
  getUserEngagementPatterns,
  getModelVersionPerformance,
  getUserRecommendationDiversity,
};

