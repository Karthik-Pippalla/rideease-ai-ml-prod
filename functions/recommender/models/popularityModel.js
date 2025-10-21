/**
 * Popularity-based Recommendation Model
 * Recommends the most popular items based on user interactions
 */

class PopularityModel {
  constructor() {
    this.itemPopularity = new Map();
    this.itemInteractions = new Map();
    this.totalInteractions = 0;
    this.name = 'Popularity';
    this.version = '1.0';
  }

  /**
   * Train the model on user interaction data
   */
  async train(data) {
    console.log('🎯 Training Popularity Model...');
    const startTime = Date.now();

    // Reset counters
    this.itemPopularity.clear();
    this.itemInteractions.clear();
    this.totalInteractions = 0;

    // Process interaction data
    for (const interaction of data) {
      const itemId = interaction.itemId;
      const weight = this.getInteractionWeight(interaction);

      // Update item popularity
      this.itemInteractions.set(itemId, (this.itemInteractions.get(itemId) || 0) + weight);
      this.totalInteractions += weight;
    }

    // Calculate popularity scores
    for (const [itemId, interactions] of this.itemInteractions) {
      this.itemPopularity.set(itemId, interactions / this.totalInteractions);
    }

    const trainingTime = Date.now() - startTime;
    console.log(`✅ Popularity Model trained in ${trainingTime}ms`);
    
    return {
      trainingTime,
      itemsProcessed: this.itemPopularity.size,
      totalInteractions: this.totalInteractions
    };
  }

  /**
   * Get weight for different types of interactions
   */
  getInteractionWeight(interaction) {
    const weights = {
      'watch': 1,
      'rate': 2,
      'click': 1.5,
      'purchase': 3,
      'share': 2.5
    };
    return weights[interaction.type] || 1;
  }

  /**
   * Generate recommendations for a user
   */
  async recommend(userId, options = {}) {
    const {
      numRecommendations = 10,
      excludeItems = [],
      minPopularity = 0
    } = options;

    const startTime = Date.now();

    // Sort items by popularity
    const sortedItems = Array.from(this.itemPopularity.entries())
      .filter(([itemId, popularity]) => 
        !excludeItems.includes(itemId) && popularity >= minPopularity
      )
      .sort(([, a], [, b]) => b - a)
      .slice(0, numRecommendations);

    const recommendations = sortedItems.map(([itemId, score]) => ({
      itemId,
      score,
      model: this.name,
      version: this.version
    }));

    const latency = Date.now() - startTime;

    return {
      recommendations,
      latency,
      model: this.name,
      version: this.version,
      userId,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get model metadata
   */
  getMetadata() {
    return {
      name: this.name,
      version: this.version,
      itemCount: this.itemPopularity.size,
      totalInteractions: this.totalInteractions,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * Estimate memory usage
   */
  estimateMemoryUsage() {
    // Rough estimate: Map entries + overhead
    const entrySize = 100; // bytes per entry (itemId + score + overhead)
    return this.itemPopularity.size * entrySize;
  }

  /**
   * Save model to file
   */
  async save(filepath) {
    const fs = require('fs').promises;
    const modelData = {
      name: this.name,
      version: this.version,
      itemPopularity: Object.fromEntries(this.itemPopularity),
      itemInteractions: Object.fromEntries(this.itemInteractions),
      totalInteractions: this.totalInteractions,
      savedAt: new Date().toISOString()
    };

    await fs.writeFile(filepath, JSON.stringify(modelData, null, 2));
    console.log(`✅ Popularity model saved to ${filepath}`);
  }

  /**
   * Load model from file
   */
  async load(filepath) {
    const fs = require('fs').promises;
    const modelData = JSON.parse(await fs.readFile(filepath, 'utf8'));

    this.name = modelData.name;
    this.version = modelData.version;
    this.itemPopularity = new Map(Object.entries(modelData.itemPopularity));
    this.itemInteractions = new Map(Object.entries(modelData.itemInteractions));
    this.totalInteractions = modelData.totalInteractions;

    console.log(`✅ Popularity model loaded from ${filepath}`);
  }

  /**
   * Evaluate model performance
   */
  async evaluate(testData) {
    console.log('📊 Evaluating Popularity Model...');
    
    const metrics = {
      hitRate: 0,
      ndcg: 0,
      precision: 0,
      recall: 0
    };

    let totalUsers = 0;
    let totalHits = 0;
    let totalPrecision = 0;
    let totalRecall = 0;
    let totalNDCG = 0;

    // Group test data by user
    const userInteractions = new Map();
    for (const interaction of testData) {
      if (!userInteractions.has(interaction.userId)) {
        userInteractions.set(interaction.userId, []);
      }
      userInteractions.get(interaction.userId).push(interaction);
    }

    // Evaluate for each user
    for (const [userId, interactions] of userInteractions) {
      if (interactions.length < 2) continue; // Need at least 2 interactions for train/test split

      // Split interactions (use last interaction as test)
      const testInteraction = interactions[interactions.length - 1];
      const trainInteractions = interactions.slice(0, -1);

      // Train on user's history
      const tempModel = new PopularityModel();
      await tempModel.train(trainInteractions);

      // Get recommendations
      const result = await tempModel.recommend(userId, { 
        numRecommendations: 10,
        excludeItems: trainInteractions.map(i => i.itemId)
      });

      const recommendedItems = result.recommendations.map(r => r.itemId);
      
      // Calculate metrics
      if (recommendedItems.includes(testInteraction.itemId)) {
        totalHits++;
        metrics.hitRate = totalHits / (totalUsers + 1);
      }

      // Precision and Recall
      const relevantItems = [testInteraction.itemId];
      const truePositives = recommendedItems.filter(item => relevantItems.includes(item)).length;
      totalPrecision += truePositives / recommendedItems.length;
      totalRecall += truePositives / relevantItems.length;

      // NDCG calculation
      const relevanceScores = recommendedItems.map(item => 
        relevantItems.includes(item) ? 1 : 0
      );
      const dcg = this.calculateDCG(relevanceScores);
      const idcg = this.calculateDCG([1]); // Ideal DCG
      totalNDCG += idcg > 0 ? dcg / idcg : 0;

      totalUsers++;
    }

    // Calculate final metrics
    metrics.hitRate = totalHits / totalUsers;
    metrics.precision = totalPrecision / totalUsers;
    metrics.recall = totalRecall / totalUsers;
    metrics.ndcg = totalNDCG / totalUsers;

    console.log('📊 Popularity Model Evaluation Results:');
    console.log(`  Hit Rate: ${metrics.hitRate.toFixed(4)}`);
    console.log(`  Precision: ${metrics.precision.toFixed(4)}`);
    console.log(`  Recall: ${metrics.recall.toFixed(4)}`);
    console.log(`  NDCG: ${metrics.ndcg.toFixed(4)}`);

    return metrics;
  }

  /**
   * Calculate Discounted Cumulative Gain
   */
  calculateDCG(relevanceScores) {
    return relevanceScores.reduce((dcg, score, index) => {
      return dcg + (score / Math.log2(index + 2));
    }, 0);
  }
}

module.exports = PopularityModel;
