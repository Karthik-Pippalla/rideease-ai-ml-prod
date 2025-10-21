#!/usr/bin/env node

/**
 * Comprehensive Test Suite for Recommendation System
 * Tests all components: Kafka, models, API, and evaluation
 */

const { Kafka } = require('kafkajs');
const PopularityModel = require('./models/popularityModel');
const ItemItemCF = require('./models/itemItemCF');
const RecommenderAPI = require('./recommenderAPI');
const StreamIngestor = require('./streamIngestor');
const ModelEvaluator = require('./modelEvaluator');

class RecommendationSystemTester {
  constructor(config = {}) {
    this.kafka = new Kafka({
      clientId: 'rideease-tester',
      brokers: config.kafkaBrokers || process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092']
    });
    
    this.apiUrl = config.apiUrl || 'http://localhost:3000';
    this.testResults = {};
  }

  /**
   * Generate synthetic test data
   */
  generateTestData(userCount = 1000, itemCount = 500, interactionsPerUser = 10) {
    console.log('🎲 Generating synthetic test data...');
    
    const users = Array.from({ length: userCount }, (_, i) => `user_${i}`);
    const items = Array.from({ length: itemCount }, (_, i) => `ride_${i}`);
    
    const interactions = [];
    const now = Date.now();
    
    for (const user of users) {
      const userItems = new Set();
      const numInteractions = Math.floor(Math.random() * interactionsPerUser) + 1;
      
      for (let i = 0; i < numInteractions; i++) {
        let item;
        do {
          item = items[Math.floor(Math.random() * items.length)];
        } while (userItems.has(item));
        
        userItems.add(item);
        
        // Generate different types of interactions
        const interactionTypes = ['watch', 'rate'];
        const type = interactionTypes[Math.floor(Math.random() * interactionTypes.length)];
        
        const interaction = {
          userId: user,
          itemId: item,
          type: type,
          timestamp: new Date(now - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(), // Last 30 days
          rating: type === 'rate' ? Math.floor(Math.random() * 5) + 1 : undefined,
          metadata: {
            source: 'test_data',
            location: ['NYC', 'SF', 'LA', 'Chicago'][Math.floor(Math.random() * 4)]
          }
        };
        
        interactions.push(interaction);
      }
    }
    
    console.log(`✅ Generated ${interactions.length} interactions for ${users.length} users and ${items.length} items`);
    return { users, items, interactions };
  }

  /**
   * Test Kafka topics and connectivity
   */
  async testKafkaTopics() {
    console.log('\n🔍 Testing Kafka topics...');
    
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      
      const topics = await admin.listTopics();
      const requiredTopics = [
        'rideease.watch',
        'rideease.rate', 
        'rideease.reco_requests',
        'rideease.reco_responses'
      ];
      
      const missingTopics = requiredTopics.filter(topic => !topics.includes(topic));
      
      if (missingTopics.length > 0) {
        console.log(`❌ Missing topics: ${missingTopics.join(', ')}`);
        return { success: false, missingTopics };
      }
      
      console.log('✅ All required topics exist');
      
      // Test publishing messages
      const producer = this.kafka.producer();
      await producer.connect();
      
      const testMessage = {
        userId: 'test_user',
        itemId: 'test_item',
        timestamp: new Date().toISOString(),
        type: 'test'
      };
      
      await producer.send({
        topic: 'rideease.watch',
        messages: [{
          key: 'test_key',
          value: JSON.stringify(testMessage)
        }]
      });
      
      await producer.disconnect();
      await admin.disconnect();
      
      console.log('✅ Kafka connectivity test passed');
      return { success: true };
      
    } catch (error) {
      console.error('❌ Kafka test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Test recommendation models
   */
  async testModels(testData) {
    console.log('\n🤖 Testing recommendation models...');
    
    const models = {
      'Popularity': new PopularityModel(),
      'ItemItemCF': new ItemItemCF()
    };
    
    const modelResults = {};
    
    for (const [modelName, model] of Object.entries(models)) {
      console.log(`\n📊 Testing ${modelName} model...`);
      
      try {
        // Train model
        const trainStart = Date.now();
        await model.train(testData.interactions);
        const trainTime = Date.now() - trainStart;
        
        // Test recommendations
        const testUsers = testData.users.slice(0, 10);
        const recommendationResults = [];
        
        for (const userId of testUsers) {
          const recStart = Date.now();
          const recommendations = await model.recommend(userId, { numRecommendations: 5 });
          const recTime = Date.now() - recStart;
          
          recommendationResults.push({
            userId,
            recommendations: recommendations.recommendations.length,
            latency: recTime,
            success: recommendations.recommendations.length > 0
          });
        }
        
        const avgLatency = recommendationResults.reduce((sum, r) => sum + r.latency, 0) / recommendationResults.length;
        const successRate = recommendationResults.filter(r => r.success).length / recommendationResults.length;
        
        modelResults[modelName] = {
          trainingTime: trainTime,
          avgLatency,
          successRate,
          recommendations: recommendationResults
        };
        
        console.log(`✅ ${modelName} - Training: ${trainTime}ms, Latency: ${avgLatency.toFixed(2)}ms, Success: ${(successRate * 100).toFixed(1)}%`);
        
      } catch (error) {
        console.error(`❌ ${modelName} test failed:`, error.message);
        modelResults[modelName] = { error: error.message };
      }
    }
    
    return modelResults;
  }

  /**
   * Test recommendation API
   */
  async testAPI() {
    console.log('\n🌐 Testing recommendation API...');
    
    try {
      const axios = require('axios');
      
      // Test health endpoint
      const healthResponse = await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      console.log('✅ Health check passed');
      
      // Test recommendation endpoint
      const recommendationResponse = await axios.post(`${this.apiUrl}/recommend`, {
        userId: 'test_user',
        options: { numRecommendations: 5 }
      }, { timeout: 10000 });
      
      console.log('✅ Recommendation endpoint working');
      
      // Test model comparison
      const comparisonResponse = await axios.post(`${this.apiUrl}/models/compare`, {
        userId: 'test_user',
        options: { numRecommendations: 5 }
      }, { timeout: 15000 });
      
      console.log('✅ Model comparison endpoint working');
      
      return {
        health: healthResponse.data,
        recommendation: recommendationResponse.data,
        comparison: comparisonResponse.data
      };
      
    } catch (error) {
      console.error('❌ API test failed:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Test stream ingestor
   */
  async testStreamIngestor() {
    console.log('\n📥 Testing stream ingestor...');
    
    try {
      const ingestor = new StreamIngestor({
        kafkaBrokers: ['localhost:9092'],
        snapshotsDir: './test_snapshots'
      });
      
      // Start ingestor
      await ingestor.start();
      
      // Generate and publish test events
      const producer = this.kafka.producer();
      await producer.connect();
      
      const testEvents = ingestor.generateSampleData('rideease.watch', 5);
      
      for (const event of testEvents) {
        await producer.send({
          topic: 'rideease.watch',
          messages: [{
            key: event.userId,
            value: JSON.stringify(event)
          }]
        });
      }
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      await producer.disconnect();
      await ingestor.stop();
      
      console.log('✅ Stream ingestor test passed');
      return { success: true };
      
    } catch (error) {
      console.error('❌ Stream ingestor test failed:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Run comprehensive evaluation
   */
  async runEvaluation(testData) {
    console.log('\n📊 Running comprehensive model evaluation...');
    
    try {
      const models = {
        'Popularity': new PopularityModel(),
        'ItemItemCF': new ItemItemCF()
      };
      
      const evaluator = new ModelEvaluator(models);
      
      // Split data for training and testing
      const trainSize = Math.floor(testData.interactions.length * 0.8);
      const trainData = testData.interactions.slice(0, trainSize);
      const testData_eval = testData.interactions.slice(trainSize);
      
      // Train models
      for (const [modelName, model] of Object.entries(models)) {
        console.log(`Training ${modelName}...`);
        await model.train(trainData);
      }
      
      // Evaluate models
      const evaluationResults = await evaluator.evaluateAll(testData_eval, { trainingData: trainData });
      
      // Generate benchmark report
      const benchmarkReport = evaluator.generateBenchmarkReport();
      
      console.log('\n📋 Evaluation Summary:');
      for (const [modelName, results] of Object.entries(evaluationResults)) {
        console.log(`${modelName}:`);
        console.log(`  Hit Rate: ${results.metrics.hitRate.toFixed(4)}`);
        console.log(`  NDCG: ${results.metrics.ndcg.toFixed(4)}`);
        console.log(`  Avg Latency: ${results.inferenceMetrics.avgLatency.toFixed(2)}ms`);
        console.log(`  Model Size: ${(results.modelSize / 1024).toFixed(2)}KB`);
      }
      
      return { evaluationResults, benchmarkReport };
      
    } catch (error) {
      console.error('❌ Evaluation failed:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting comprehensive recommendation system test...\n');
    
    const startTime = Date.now();
    
    // Generate test data
    const testData = this.generateTestData(500, 200, 8);
    
    // Run all tests
    const results = {
      timestamp: new Date().toISOString(),
      testData: {
        users: testData.users.length,
        items: testData.items.length,
        interactions: testData.interactions.length
      },
      kafka: await this.testKafkaTopics(),
      models: await this.testModels(testData),
      api: await this.testAPI(),
      ingestor: await this.testStreamIngestor(),
      evaluation: await this.runEvaluation(testData)
    };
    
    const totalTime = Date.now() - startTime;
    results.totalTime = totalTime;
    
    // Save results
    const fs = require('fs').promises;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `test_results_${timestamp}.json`;
    
    await fs.writeFile(filename, JSON.stringify(results, null, 2));
    
    console.log(`\n🎉 All tests completed in ${totalTime}ms`);
    console.log(`📄 Results saved to ${filename}`);
    
    // Print summary
    this.printSummary(results);
    
    return results;
  }

  /**
   * Print test summary
   */
  printSummary(results) {
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`📊 Test Data: ${results.testData.users} users, ${results.testData.items} items, ${results.testData.interactions} interactions`);
    
    console.log(`🔍 Kafka: ${results.kafka.success ? '✅ PASS' : '❌ FAIL'}`);
    
    console.log('🤖 Models:');
    for (const [modelName, result] of Object.entries(results.models)) {
      if (result.error) {
        console.log(`  ${modelName}: ❌ FAIL (${result.error})`);
      } else {
        console.log(`  ${modelName}: ✅ PASS (${result.avgLatency.toFixed(2)}ms avg latency)`);
      }
    }
    
    console.log(`🌐 API: ${results.api.error ? '❌ FAIL' : '✅ PASS'}`);
    console.log(`📥 Ingestor: ${results.ingestor.error ? '❌ FAIL' : '✅ PASS'}`);
    console.log(`📊 Evaluation: ${results.evaluation.error ? '❌ FAIL' : '✅ PASS'}`);
    
    console.log(`⏱️  Total Time: ${results.totalTime}ms`);
    console.log('='.repeat(60));
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const tester = new RecommendationSystemTester();
  tester.runAllTests().catch(console.error);
}

module.exports = RecommendationSystemTester;
