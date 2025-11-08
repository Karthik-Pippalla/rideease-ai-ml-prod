#!/usr/bin/env node

/**
 * Main Entry Point for RideEase Recommendation System
 * Orchestrates all components: Kafka, models, API, and evaluation
 */

const PopularityModel = require('./models/popularityModel');
const ItemItemCF = require('./models/itemItemCF');
const RecommenderAPI = require('./recommenderAPI');
const StreamIngestor = require('./streamIngestor');
const ModelEvaluator = require('./modelEvaluator');
const { initializeTopics, initKafka } = require('../utils/kafka');

class RecommendationSystem {
  constructor(config = {}) {
    this.config = {
      kafkaBrokers: config.kafkaBrokers || process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
      apiPort: config.apiPort || process.env.PORT || 3000,
      snapshotsDir: config.snapshotsDir || './data/snapshots',
      modelsDir: config.modelsDir || './data/models',
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      ...config
    };
    
    this.models = {};
    this.api = null;
    this.ingestor = null;
    this.evaluator = null;
    this.isRunning = false;
  }

  /**
   * Initialize the recommendation system
   */
  async initialize() {
    console.log('🚀 Initializing RideEase Recommendation System...');
    
    try {
      // Initialize Kafka
      console.log('📡 Initializing Kafka...');
      await initKafka();
      if (process.env.KAFKA_KEY && process.env.SECRET) {
        console.log('🔐 Recommendation System using SASL/SSL secure Kafka connection');
      }
      await initializeTopics();
      console.log('✅ Kafka initialized');

      // Initialize models
      console.log('🤖 Initializing models...');
      this.models = {
        'Popularity': new PopularityModel(),
        'ItemItemCF': new ItemItemCF()
      };
      console.log('✅ Models initialized');

      // Initialize evaluator
      this.evaluator = new ModelEvaluator(this.models);
      console.log('✅ Evaluator initialized');

      // Initialize stream ingestor
      console.log('📥 Initializing stream ingestor...');
      this.ingestor = new StreamIngestor({
        kafkaBrokers: this.config.kafkaBrokers,
        snapshotsDir: this.config.snapshotsDir,
        redis: this.config.redisUrl ? require('redis').createClient({ url: this.config.redisUrl }) : null
      });
      console.log('✅ Stream ingestor initialized');

      // Initialize API
      console.log('🌐 Initializing API...');
      this.api = new RecommenderAPI(this.models);
      console.log('✅ API initialized');

      console.log('🎉 Recommendation system initialized successfully!');
      
    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Train models with sample data
   */
  async trainModels() {
    console.log('🎯 Training models with sample data...');
    
    try {
      // Generate sample training data
      const trainingData = this.generateTrainingData();
      
      // Train all models
      for (const [modelName, model] of Object.entries(this.models)) {
        console.log(`Training ${modelName}...`);
        const startTime = Date.now();
        
        await model.train(trainingData);
        
        const trainingTime = Date.now() - startTime;
        console.log(`✅ ${modelName} trained in ${trainingTime}ms`);
        
        // Save model
        const modelPath = `${this.config.modelsDir}/${modelName.toLowerCase().replace(' ', '_')}_model.json`;
        await model.save(modelPath);
      }
      
      console.log('🎉 All models trained successfully!');
      
    } catch (error) {
      console.error('❌ Model training failed:', error.message);
      throw error;
    }
  }

  /**
   * Generate sample training data
   */
  generateTrainingData() {
    const interactions = [];
    const users = Array.from({ length: 100 }, (_, i) => `user_${i}`);
    const items = Array.from({ length: 50 }, (_, i) => `ride_${i}`);
    
    // Generate interactions
    for (const user of users) {
      const numInteractions = Math.floor(Math.random() * 10) + 1;
      const userItems = new Set();
      
      for (let i = 0; i < numInteractions; i++) {
        let item;
        do {
          item = items[Math.floor(Math.random() * items.length)];
        } while (userItems.has(item));
        
        userItems.add(item);
        
        const interaction = {
          userId: user,
          itemId: item,
          type: Math.random() > 0.5 ? 'watch' : 'rate',
          rating: Math.floor(Math.random() * 5) + 1,
          timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString()
        };
        
        interactions.push(interaction);
      }
    }
    
    return interactions;
  }

  /**
   * Start the recommendation system
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ System is already running');
      return;
    }

    try {
      console.log('🚀 Starting recommendation system...');
      
      // Start stream ingestor
      await this.ingestor.start();
      
      // Start API server
      this.api.start(this.config.apiPort);
      
      this.isRunning = true;
      
      console.log(`🎉 Recommendation system started successfully!`);
      console.log(`📊 API available at: http://localhost:${this.config.apiPort}`);
      console.log(`🔍 Health check: http://localhost:${this.config.apiPort}/health`);
      console.log(`📈 Models: ${Object.keys(this.models).join(', ')}`);
      
      // Setup graceful shutdown
      process.on('SIGINT', () => this.stop());
      process.on('SIGTERM', () => this.stop());
      
    } catch (error) {
      console.error('❌ Failed to start system:', error.message);
      throw error;
    }
  }

  /**
   * Stop the recommendation system
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ System is not running');
      return;
    }

    console.log('🛑 Stopping recommendation system...');
    
    try {
      // Stop API server
      if (this.api) {
        this.api.stop();
      }
      
      // Stop stream ingestor
      if (this.ingestor) {
        await this.ingestor.stop();
      }
      
      this.isRunning = false;
      console.log('✅ Recommendation system stopped');
      
    } catch (error) {
      console.error('❌ Error stopping system:', error.message);
    }
  }

  /**
   * Run evaluation and comparison
   */
  async runEvaluation() {
    console.log('📊 Running model evaluation...');
    
    try {
      // Generate test data
      const testData = this.generateTrainingData();
      
      // Run evaluation
      const results = await this.evaluator.evaluateAll(testData, { trainingData: testData });
      
      // Save results
      const fs = require('fs').promises;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${this.config.modelsDir}/evaluation_${timestamp}.json`;
      
      await fs.writeFile(filename, JSON.stringify(results, null, 2));
      
      console.log(`📄 Evaluation results saved to ${filename}`);
      
      return results;
      
    } catch (error) {
      console.error('❌ Evaluation failed:', error.message);
      throw error;
    }
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      models: Object.keys(this.models),
      config: this.config,
      timestamp: new Date().toISOString()
    };
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const config = {
    kafkaBrokers: process.env.KAFKA_BROKERS?.split(','),
    apiPort: process.env.PORT,
    snapshotsDir: process.env.SNAPSHOTS_DIR,
    modelsDir: process.env.MODELS_DIR,
    redisUrl: process.env.REDIS_URL
  };
  
  const system = new RecommendationSystem(config);
  
  try {
    switch (command) {
      case 'init':
        await system.initialize();
        break;
        
      case 'train':
        await system.initialize();
        await system.trainModels();
        break;
        
      case 'start':
        await system.initialize();
        await system.trainModels();
        await system.start();
        break;
        
      case 'evaluate':
        await system.initialize();
        await system.trainModels();
        await system.runEvaluation();
        break;
        
      case 'test':
        const RecommendationSystemTester = require('./testRecommendationSystem');
        const tester = new RecommendationSystemTester(config);
        await tester.runAllTests();
        break;
        
      default:
        console.log('Usage: node index.js [init|train|start|evaluate|test]');
        console.log('');
        console.log('Commands:');
        console.log('  init     - Initialize the system');
        console.log('  train    - Train models with sample data');
        console.log('  start    - Start the complete system');
        console.log('  evaluate - Run model evaluation');
        console.log('  test     - Run comprehensive tests');
        break;
    }
  } catch (error) {
    console.error('❌ Command failed:', error.message);
    process.exit(1);
  }
}

// Run CLI if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = RecommendationSystem;
