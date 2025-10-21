const fs = require('fs').promises;
const path = require('path');

/**
 * Model Evaluator for Recommendation Systems
 * Compares models across multiple metrics and dimensions
 */

class ModelEvaluator {
  constructor(models = {}) {
    this.models = models;
    this.results = {};
  }

  /**
   * Evaluate all models and generate comparison report
   */
  async evaluateAll(testData, options = {}) {
    console.log('🔬 Starting comprehensive model evaluation...');
    
    const evaluationResults = {};
    
    for (const [modelName, model] of Object.entries(this.models)) {
      console.log(`\n📊 Evaluating ${modelName}...`);
      
      const startTime = Date.now();
      
      // Evaluate model performance
      const metrics = await model.evaluate(testData);
      
      // Measure training cost (if model has training data)
      const trainingCost = await this.measureTrainingCost(model, options.trainingData);
      
      // Measure inference performance
      const inferenceMetrics = await this.measureInferencePerformance(model, testData);
      
      // Calculate model size
      const modelSize = this.calculateModelSize(model);
      
      evaluationResults[modelName] = {
        metrics,
        trainingCost,
        inferenceMetrics,
        modelSize,
        evaluationTime: Date.now() - startTime
      };
    }
    
    this.results = evaluationResults;
    
    // Generate comparison report
    const comparisonReport = this.generateComparisonReport(evaluationResults);
    
    console.log('\n📋 Model Comparison Summary:');
    console.log(comparisonReport);
    
    return evaluationResults;
  }

  /**
   * Measure training cost for a model
   */
  async measureTrainingCost(model, trainingData) {
    if (!trainingData) {
      return {
        time: 0,
        cpuUsage: 'N/A',
        cost: 'N/A',
        memoryPeak: 'N/A'
      };
    }

    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    try {
      await model.train(trainingData);
      const endTime = Date.now();
      const endMemory = process.memoryUsage();
      
      return {
        time: endTime - startTime,
        cpuUsage: 'N/A', // Would need external monitoring
        cost: this.estimateTrainingCost(endTime - startTime),
        memoryPeak: endMemory.heapUsed - startMemory.heapUsed
      };
    } catch (error) {
      console.error(`Training cost measurement failed for ${model.name}:`, error.message);
      return {
        time: -1,
        cpuUsage: 'Error',
        cost: 'Error',
        memoryPeak: 'Error'
      };
    }
  }

  /**
   * Measure inference performance
   */
  async measureInferencePerformance(model, testData) {
    const testUsers = this.extractTestUsers(testData);
    const numTests = Math.min(testUsers.length, 100); // Limit to 100 tests for performance
    
    const latencies = [];
    const throughputs = [];
    
    for (let i = 0; i < numTests; i++) {
      const userId = testUsers[i];
      const startTime = Date.now();
      
      try {
        await model.recommend(userId, { numRecommendations: 10 });
        const latency = Date.now() - startTime;
        latencies.push(latency);
        throughputs.push(1000 / latency); // requests per second
      } catch (error) {
        console.error(`Inference test failed for user ${userId}:`, error.message);
      }
    }
    
    return {
      avgLatency: this.calculateAverage(latencies),
      p95Latency: this.calculatePercentile(latencies, 95),
      p99Latency: this.calculatePercentile(latencies, 99),
      avgThroughput: this.calculateAverage(throughputs),
      maxThroughput: Math.max(...throughputs),
      testCount: latencies.length
    };
  }

  /**
   * Calculate model size in bytes
   */
  calculateModelSize(model) {
    if (model.getMetadata && model.getMetadata().memoryUsage) {
      return model.getMetadata().memoryUsage;
    }
    
    // Fallback estimation
    return this.estimateModelSize(model);
  }

  /**
   * Estimate model size based on model type
   */
  estimateModelSize(model) {
    // This is a rough estimation - actual implementation would depend on model internals
    const baseSize = 1024; // 1KB base
    let additionalSize = 0;
    
    if (model.name === 'Popularity') {
      additionalSize = (model.itemPopularity?.size || 0) * 100; // 100 bytes per item
    } else if (model.name === 'Item-Item CF') {
      additionalSize = (model.itemSimilarities?.size || 0) * 200; // 200 bytes per similarity
    }
    
    return baseSize + additionalSize;
  }

  /**
   * Generate comparison report
   */
  generateComparisonReport(results) {
    let report = '\n' + '='.repeat(80) + '\n';
    report += 'MODEL COMPARISON REPORT\n';
    report += '='.repeat(80) + '\n\n';

    // Performance Metrics Table
    report += 'PERFORMANCE METRICS:\n';
    report += '-'.repeat(80) + '\n';
    report += 'Model Name'.padEnd(20) + 'Hit Rate'.padEnd(12) + 'NDCG'.padEnd(12) + 
              'Precision'.padEnd(12) + 'Recall'.padEnd(12) + '\n';
    report += '-'.repeat(80) + '\n';
    
    for (const [modelName, result] of Object.entries(results)) {
      const metrics = result.metrics;
      report += modelName.padEnd(20) + 
                metrics.hitRate.toFixed(4).padEnd(12) +
                metrics.ndcg.toFixed(4).padEnd(12) +
                metrics.precision.toFixed(4).padEnd(12) +
                metrics.recall.toFixed(4).padEnd(12) + '\n';
    }

    // Training Cost Table
    report += '\nTRAINING COST:\n';
    report += '-'.repeat(80) + '\n';
    report += 'Model Name'.padEnd(20) + 'Time (ms)'.padEnd(12) + 'Memory (MB)'.padEnd(15) + 
              'Est. Cost'.padEnd(12) + '\n';
    report += '-'.repeat(80) + '\n';
    
    for (const [modelName, result] of Object.entries(results)) {
      const cost = result.trainingCost;
      report += modelName.padEnd(20) + 
                cost.time.toString().padEnd(12) +
                (cost.memoryPeak / 1024 / 1024).toFixed(2).padEnd(15) +
                cost.cost.padEnd(12) + '\n';
    }

    // Inference Performance Table
    report += '\nINFERENCE PERFORMANCE:\n';
    report += '-'.repeat(80) + '\n';
    report += 'Model Name'.padEnd(20) + 'Avg Latency'.padEnd(15) + 'P95 Latency'.padEnd(15) + 
              'Throughput'.padEnd(12) + 'Tests'.padEnd(8) + '\n';
    report += '-'.repeat(80) + '\n';
    
    for (const [modelName, result] of Object.entries(results)) {
      const inference = result.inferenceMetrics;
      report += modelName.padEnd(20) + 
                inference.avgLatency.toFixed(2).padEnd(15) +
                inference.p95Latency.toFixed(2).padEnd(15) +
                inference.avgThroughput.toFixed(2).padEnd(12) +
                inference.testCount.toString().padEnd(8) + '\n';
    }

    // Model Size Table
    report += '\nMODEL SIZE:\n';
    report += '-'.repeat(80) + '\n';
    report += 'Model Name'.padEnd(20) + 'Size (KB)'.padEnd(12) + 'Items'.padEnd(12) + 
              'Users'.padEnd(12) + '\n';
    report += '-'.repeat(80) + '\n';
    
    for (const [modelName, result] of Object.entries(results)) {
      const metadata = result.modelSize;
      const model = this.models[modelName];
      const modelMetadata = model.getMetadata ? model.getMetadata() : {};
      
      report += modelName.padEnd(20) + 
                (metadata / 1024).toFixed(2).padEnd(12) +
                (modelMetadata.itemCount || 'N/A').toString().padEnd(12) +
                (modelMetadata.userCount || 'N/A').toString().padEnd(12) + '\n';
    }

    report += '\n' + '='.repeat(80) + '\n';
    return report;
  }

  /**
   * Helper methods
   */
  extractTestUsers(testData) {
    const users = new Set();
    for (const interaction of testData) {
      users.add(interaction.userId);
    }
    return Array.from(users);
  }

  calculateAverage(numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  calculatePercentile(numbers, percentile) {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  estimateTrainingCost(trainingTimeMs) {
    // Rough estimation based on AWS pricing
    const hourlyRate = 0.10; // $0.10 per hour for compute
    const cost = (trainingTimeMs / 1000 / 3600) * hourlyRate;
    return `$${cost.toFixed(6)}`;
  }

  /**
   * Save evaluation results to file
   */
  async saveResults(filepath) {
    const report = {
      timestamp: new Date().toISOString(),
      models: this.results,
      summary: this.generateComparisonReport(this.results)
    };

    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    console.log(`📊 Evaluation results saved to ${filepath}`);
  }

  /**
   * Generate performance benchmark report
   */
  generateBenchmarkReport() {
    const report = {
      timestamp: new Date().toISOString(),
      models: {},
      recommendations: {}
    };

    for (const [modelName, result] of Object.entries(this.results)) {
      report.models[modelName] = {
        performance: {
          hitRate: result.metrics.hitRate,
          ndcg: result.metrics.ndcg,
          precision: result.metrics.precision,
          recall: result.metrics.recall
        },
        efficiency: {
          trainingTime: result.trainingCost.time,
          avgLatency: result.inferenceMetrics.avgLatency,
          throughput: result.inferenceMetrics.avgThroughput,
          modelSize: result.modelSize
        },
        cost: {
          trainingCost: result.trainingCost.cost,
          memoryUsage: result.trainingCost.memoryPeak
        }
      };
    }

    // Generate recommendations
    report.recommendations = this.generateRecommendations();

    return report;
  }

  /**
   * Generate recommendations based on evaluation results
   */
  generateRecommendations() {
    const recommendations = {
      bestOverall: null,
      fastestInference: null,
      smallestModel: null,
      bestAccuracy: null,
      mostCostEffective: null
    };

    let bestScore = -1;
    let fastestLatency = Infinity;
    let smallestSize = Infinity;
    let bestAccuracy = -1;
    let bestCostEfficiency = -1;

    for (const [modelName, result] of Object.entries(this.results)) {
      // Best overall (weighted score)
      const overallScore = result.metrics.hitRate * 0.4 + 
                          result.metrics.ndcg * 0.3 + 
                          result.metrics.precision * 0.2 + 
                          result.metrics.recall * 0.1;
      
      if (overallScore > bestScore) {
        bestScore = overallScore;
        recommendations.bestOverall = modelName;
      }

      // Fastest inference
      if (result.inferenceMetrics.avgLatency < fastestLatency) {
        fastestLatency = result.inferenceMetrics.avgLatency;
        recommendations.fastestInference = modelName;
      }

      // Smallest model
      if (result.modelSize < smallestSize) {
        smallestSize = result.modelSize;
        recommendations.smallestModel = modelName;
      }

      // Best accuracy (NDCG)
      if (result.metrics.ndcg > bestAccuracy) {
        bestAccuracy = result.metrics.ndcg;
        recommendations.bestAccuracy = modelName;
      }

      // Most cost effective (accuracy per training time)
      const costEfficiency = result.metrics.hitRate / Math.max(result.trainingCost.time, 1);
      if (costEfficiency > bestCostEfficiency) {
        bestCostEfficiency = costEfficiency;
        recommendations.mostCostEffective = modelName;
      }
    }

    return recommendations;
  }
}

module.exports = ModelEvaluator;
