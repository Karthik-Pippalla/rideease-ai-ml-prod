const express = require('express');
const cors = require('cors');
const { publishEvent } = require('../utils/kafka');

/**
 * Recommendation API Server
 * Provides REST endpoints for recommendation services
 */

class RecommenderAPI {
  constructor(models = {}) {
    this.app = express();
    this.models = models;
    this.activeModel = Object.keys(models)[0]; // Default to first model
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        models: Object.keys(this.models),
        activeModel: this.activeModel
      });
    });

    // Get recommendations
    this.app.post('/recommend', async (req, res) => {
      try {
        const { userId, options = {} } = req.body;
        
        if (!userId) {
          return res.status(400).json({ error: 'userId is required' });
        }

        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();

        // Publish recommendation request event
        await this.publishRecommendationRequest(userId, requestId, options);

        // Get recommendations from active model
        const model = this.models[this.activeModel];
        if (!model) {
          return res.status(500).json({ error: 'No active model available' });
        }

        const recommendations = await model.recommend(userId, options);
        const totalLatency = Date.now() - startTime;

        // Add request metadata
        recommendations.requestId = requestId;
        recommendations.totalLatency = totalLatency;

        // Publish recommendation response event
        await this.publishRecommendationResponse(userId, requestId, recommendations);

        res.json(recommendations);

      } catch (error) {
        console.error('Recommendation error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get model information
    this.app.get('/models', (req, res) => {
      const modelInfo = {};
      for (const [name, model] of Object.entries(this.models)) {
        modelInfo[name] = {
          name: model.name,
          version: model.version,
          isActive: name === this.activeModel,
          metadata: model.getMetadata ? model.getMetadata() : {}
        };
      }
      res.json(modelInfo);
    });

    // Switch active model
    this.app.post('/models/:modelName/activate', (req, res) => {
      const { modelName } = req.params;
      
      if (!this.models[modelName]) {
        return res.status(404).json({ error: 'Model not found' });
      }

      this.activeModel = modelName;
      res.json({ 
        message: `Switched to model: ${modelName}`,
        activeModel: this.activeModel
      });
    });

    // Compare models
    this.app.post('/models/compare', async (req, res) => {
      try {
        const { userId, options = {} } = req.body;
        
        if (!userId) {
          return res.status(400).json({ error: 'userId is required' });
        }

        const comparison = {};
        const startTime = Date.now();

        for (const [modelName, model] of Object.entries(this.models)) {
          const modelStartTime = Date.now();
          const recommendations = await model.recommend(userId, options);
          const modelLatency = Date.now() - modelStartTime;

          comparison[modelName] = {
            recommendations: recommendations.recommendations.slice(0, 5), // Top 5 for comparison
            latency: modelLatency,
            metadata: model.getMetadata ? model.getMetadata() : {}
          };
        }

        const totalTime = Date.now() - startTime;

        res.json({
          userId,
          comparison,
          totalComparisonTime: totalTime,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('Model comparison error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Track user interactions
    this.app.post('/track', async (req, res) => {
      try {
        const { userId, itemId, interactionType = 'view', metadata = {} } = req.body;
        
        if (!userId || !itemId) {
          return res.status(400).json({ error: 'userId and itemId are required' });
        }

        const interaction = {
          userId,
          itemId,
          type: interactionType,
          timestamp: new Date().toISOString(),
          metadata
        };

        // Publish interaction event to appropriate topic
        await this.publishInteraction(interaction);

        res.json({ 
          message: 'Interaction tracked successfully',
          interaction
        });

      } catch (error) {
        console.error('Tracking error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get user profile
    this.app.get('/users/:userId/profile', (req, res) => {
      const { userId } = req.params;
      
      // This would typically query a user service or database
      // For now, return a mock profile
      res.json({
        userId,
        profile: {
          preferences: {},
          history: [],
          recommendations: []
        },
        timestamp: new Date().toISOString()
      });
    });
  }

  async publishRecommendationRequest(userId, requestId, options) {
    try {
      const event = {
        userId,
        requestId,
        timestamp: new Date().toISOString(),
        context: options.context || {},
        modelVersion: this.models[this.activeModel]?.version || 'unknown'
      };

      await publishEvent('RIDEEASE_RECO_REQUESTS', event, 'rideease.reco_requests');
    } catch (error) {
      console.error('Failed to publish recommendation request:', error.message);
    }
  }

  async publishRecommendationResponse(userId, requestId, recommendations) {
    try {
      const event = {
        userId,
        requestId,
        recommendations: recommendations.recommendations,
        timestamp: new Date().toISOString(),
        modelVersion: recommendations.model,
        latency: recommendations.latency
      };

      await publishEvent('RIDEEASE_RECO_RESPONSES', event, 'rideease.reco_responses');
    } catch (error) {
      console.error('Failed to publish recommendation response:', error.message);
    }
  }

  async publishInteraction(interaction) {
    try {
      const topic = interaction.type === 'rate' ? 'rideease.rate' : 'rideease.watch';
      await publishEvent('RIDEEASE_INTERACTION', interaction, topic);
    } catch (error) {
      console.error('Failed to publish interaction:', error.message);
    }
  }

  start(port = 3000) {
    this.server = this.app.listen(port, () => {
      console.log(`🚀 Recommendation API server running on port ${port}`);
      console.log(`📊 Available models: ${Object.keys(this.models).join(', ')}`);
      console.log(`🎯 Active model: ${this.activeModel}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('✅ Recommendation API server stopped');
    }
  }
}

module.exports = RecommenderAPI;
