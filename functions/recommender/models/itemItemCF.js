/**
 * Item-Item Collaborative Filtering Model
 * Recommends items based on similarity to items the user has interacted with
 */

class ItemItemCF {
  constructor() {
    this.itemSimilarities = new Map();
    this.userItemMatrix = new Map();
    this.itemUsers = new Map();
    this.name = 'Item-Item CF';
    this.version = '1.0';
  }

  /**
   * Train the model on user interaction data
   */
  async train(data) {
    console.log('🎯 Training Item-Item CF Model...');
    const startTime = Date.now();

    // Reset data structures
    this.itemSimilarities.clear();
    this.userItemMatrix.clear();
    this.itemUsers.clear();

    // Build user-item matrix and item-users mapping
    for (const interaction of data) {
      const { userId, itemId, rating } = interaction;
      
      // Build user-item matrix
      if (!this.userItemMatrix.has(userId)) {
        this.userItemMatrix.set(userId, new Map());
      }
      this.userItemMatrix.get(userId).set(itemId, rating || 1);

      // Build item-users mapping
      if (!this.itemUsers.has(itemId)) {
        this.itemUsers.set(itemId, new Set());
      }
      this.itemUsers.get(itemId).add(userId);
    }

    // Calculate item-item similarities
    await this.calculateItemSimilarities();

    const trainingTime = Date.now() - startTime;
    console.log(`✅ Item-Item CF Model trained in ${trainingTime}ms`);
    
    return {
      trainingTime,
      itemsProcessed: this.itemSimilarities.size,
      usersProcessed: this.userItemMatrix.size
    };
  }

  /**
   * Calculate similarities between all pairs of items
   */
  async calculateItemSimilarities() {
    const items = Array.from(this.itemUsers.keys());
    
    for (let i = 0; i < items.length; i++) {
      const item1 = items[i];
      if (!this.itemSimilarities.has(item1)) {
        this.itemSimilarities.set(item1, new Map());
      }

      for (let j = i + 1; j < items.length; j++) {
        const item2 = items[j];
        const similarity = this.calculateCosineSimilarity(item1, item2);
        
        if (similarity > 0) {
          this.itemSimilarities.get(item1).set(item2, similarity);
          
          if (!this.itemSimilarities.has(item2)) {
            this.itemSimilarities.set(item2, new Map());
          }
          this.itemSimilarities.get(item2).set(item1, similarity);
        }
      }
    }
  }

  /**
   * Calculate cosine similarity between two items
   */
  calculateCosineSimilarity(item1, item2) {
    const users1 = this.itemUsers.get(item1);
    const users2 = this.itemUsers.get(item2);
    
    if (!users1 || !users2) return 0;

    // Find common users
    const commonUsers = new Set([...users1].filter(user => users2.has(user)));
    
    if (commonUsers.size === 0) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const user of commonUsers) {
      const rating1 = this.userItemMatrix.get(user).get(item1);
      const rating2 = this.userItemMatrix.get(user).get(item2);
      
      dotProduct += rating1 * rating2;
      norm1 += rating1 * rating1;
      norm2 += rating2 * rating2;
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Generate recommendations for a user
   */
  async recommend(userId, options = {}) {
    const {
      numRecommendations = 10,
      excludeItems = [],
      minSimilarity = 0.1
    } = options;

    const startTime = Date.now();

    const userItems = this.userItemMatrix.get(userId);
    if (!userItems || userItems.size === 0) {
      return {
        recommendations: [],
        latency: Date.now() - startTime,
        model: this.name,
        version: this.version,
        userId,
        timestamp: new Date().toISOString()
      };
    }

    // Calculate recommendation scores
    const itemScores = new Map();

    for (const [userItem, userRating] of userItems) {
      const similarities = this.itemSimilarities.get(userItem);
      if (!similarities) continue;

      for (const [similarItem, similarity] of similarities) {
        if (excludeItems.includes(similarItem) || userItems.has(similarItem)) {
          continue;
        }

        if (similarity < minSimilarity) continue;

        const weightedScore = userRating * similarity;
        itemScores.set(similarItem, (itemScores.get(similarItem) || 0) + weightedScore);
      }
    }

    // Sort by score and return top recommendations
    const sortedItems = Array.from(itemScores.entries())
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
      itemCount: this.itemSimilarities.size,
      userCount: this.userItemMatrix.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * Estimate memory usage
   */
  estimateMemoryUsage() {
    let memory = 0;
    
    // User-item matrix memory
    for (const [, items] of this.userItemMatrix) {
      memory += items.size * 50; // Rough estimate per entry
    }
    
    // Item similarities memory
    for (const [, similarities] of this.itemSimilarities) {
      memory += similarities.size * 40; // Rough estimate per similarity
    }
    
    return memory;
  }

  /**
   * Save model to file
   */
  async save(filepath) {
    const fs = require('fs').promises;
    
    // Convert Maps to plain objects for JSON serialization
    const userItemMatrixObj = {};
    for (const [userId, items] of this.userItemMatrix) {
      userItemMatrixObj[userId] = Object.fromEntries(items);
    }

    const itemSimilaritiesObj = {};
    for (const [itemId, similarities] of this.itemSimilarities) {
      itemSimilaritiesObj[itemId] = Object.fromEntries(similarities);
    }

    const itemUsersObj = {};
    for (const [itemId, users] of this.itemUsers) {
      itemUsersObj[itemId] = Array.from(users);
    }

    const modelData = {
      name: this.name,
      version: this.version,
      userItemMatrix: userItemMatrixObj,
      itemSimilarities: itemSimilaritiesObj,
      itemUsers: itemUsersObj,
      savedAt: new Date().toISOString()
    };

    await fs.writeFile(filepath, JSON.stringify(modelData, null, 2));
    console.log(`✅ Item-Item CF model saved to ${filepath}`);
  }

  /**
   * Load model from file
   */
  async load(filepath) {
    const fs = require('fs').promises;
    const modelData = JSON.parse(await fs.readFile(filepath, 'utf8'));

    this.name = modelData.name;
    this.version = modelData.version;

    // Reconstruct user-item matrix
    this.userItemMatrix.clear();
    for (const [userId, items] of Object.entries(modelData.userItemMatrix)) {
      this.userItemMatrix.set(userId, new Map(Object.entries(items)));
    }

    // Reconstruct item similarities
    this.itemSimilarities.clear();
    for (const [itemId, similarities] of Object.entries(modelData.itemSimilarities)) {
      this.itemSimilarities.set(itemId, new Map(Object.entries(similarities)));
    }

    // Reconstruct item-users mapping
    this.itemUsers.clear();
    for (const [itemId, users] of Object.entries(modelData.itemUsers)) {
      this.itemUsers.set(itemId, new Set(users));
    }

    console.log(`✅ Item-Item CF model loaded from ${filepath}`);
  }

  /**
   * Evaluate model performance
   */
  async evaluate(testData) {
    console.log('📊 Evaluating Item-Item CF Model...');
    
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
      if (interactions.length < 2) continue;

      // Split interactions
      const testInteraction = interactions[interactions.length - 1];
      const trainInteractions = interactions.slice(0, -1);

      // Train on user's history
      const tempModel = new ItemItemCF();
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
      const idcg = this.calculateDCG([1]);
      totalNDCG += idcg > 0 ? dcg / idcg : 0;

      totalUsers++;
    }

    // Calculate final metrics
    metrics.hitRate = totalHits / totalUsers;
    metrics.precision = totalPrecision / totalUsers;
    metrics.recall = totalRecall / totalUsers;
    metrics.ndcg = totalNDCG / totalUsers;

    console.log('📊 Item-Item CF Model Evaluation Results:');
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

module.exports = ItemItemCF;
