#!/usr/bin/env node
/**
 * Telegram Cache Clearing Utility
 * Clears various types of cache used by the RideEase Telegram bots
 */

const db = require('./utils/database');
const state = require('./utils/state');

// Load environment variables
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

class TelegramCacheCleaner {
  constructor() {
    this.riderBotToken = process.env.TELEGRAM_BOT_TOKEN;
    this.driverBotToken = process.env.TELEGRAM_BOT_TOKEN_DRIVER;
  }

  /**
   * Clear application state cache
   */
  async clearStateCache() {
    console.log('🧹 Clearing application state cache...');
    try {
      const result = await db.clearAllCache();
      if (result.success) {
        console.log(`✅ Cleared ${result.clearedCount} state entries`);
      } else {
        console.error('❌ Failed to clear state cache:', result.error);
      }
      return result.success;
    } catch (error) {
      console.error('❌ Error clearing state cache:', error.message);
      return false;
    }
  }

  /**
   * Clear user-specific cache
   */
  async clearUserCache(telegramId) {
    console.log(`🧹 Clearing cache for user ${telegramId}...`);
    try {
      const result = await db.clearUserCache(telegramId);
      if (result.success) {
        console.log(`✅ Cleared cache for user ${telegramId}`);
      } else {
        console.error(`❌ Failed to clear cache for user ${telegramId}:`, result.error);
      }
      return result.success;
    } catch (error) {
      console.error('❌ Error clearing user cache:', error.message);
      return false;
    }
  }

  /**
   * Clear Telegram webhook pending updates
   */
  async clearWebhookUpdates(botToken, botName) {
    console.log(`🧹 Clearing pending updates for ${botName}...`);
    try {
      const bot = new TelegramBot(botToken);
      
      // Delete and re-set webhook to clear pending updates
      await bot.deleteWebHook({ drop_pending_updates: true });
      console.log(`✅ Cleared pending updates for ${botName}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Error clearing ${botName} pending updates:`, error.message);
      return false;
    }
  }

  /**
   * Get bot information and webhook status
   */
  async getBotInfo(botToken, botName) {
    try {
      const bot = new TelegramBot(botToken);
      
      const [me, webhookInfo] = await Promise.all([
        bot.getMe(),
        bot.getWebHookInfo()
      ]);
      
      console.log(`\n📊 ${botName} Information:`);
      console.log(`   Bot: @${me.username} (${me.first_name})`);
      console.log(`   Webhook URL: ${webhookInfo.url || 'Not set'}`);
      console.log(`   Pending Updates: ${webhookInfo.pending_update_count || 0}`);
      console.log(`   Last Error: ${webhookInfo.last_error_message || 'None'}`);
      
      return {
        bot: me,
        webhook: webhookInfo
      };
    } catch (error) {
      console.error(`❌ Error getting ${botName} info:`, error.message);
      return null;
    }
  }

  /**
   * Clear all bot-related caches
   */
  async clearAllBotCache() {
    console.log('🧹 Starting comprehensive cache clearing...\n');
    
    let success = true;
    
    // Clear application state
    success = await this.clearStateCache() && success;
    
    // Clear Telegram webhook caches
    if (this.riderBotToken) {
      success = await this.clearWebhookUpdates(this.riderBotToken, 'Rider Bot') && success;
    }
    
    if (this.driverBotToken) {
      success = await this.clearWebhookUpdates(this.driverBotToken, 'Driver Bot') && success;
    }
    
    console.log('\n🔍 Bot Status After Clearing:');
    
    // Show bot info
    if (this.riderBotToken) {
      await this.getBotInfo(this.riderBotToken, 'Rider Bot');
    }
    
    if (this.driverBotToken) {
      await this.getBotInfo(this.driverBotToken, 'Driver Bot');
    }
    
    console.log(`\n${success ? '✅ All caches cleared successfully!' : '⚠️ Some cache clearing operations failed.'}`);
    return success;
  }

  /**
   * Show current cache status
   */
  async showCacheStatus() {
    console.log('📊 Current Cache Status:\n');
    
    // State cache info
    console.log(`🗄️ Application State:`);
    console.log(`   Active state entries: ${state.getSize()}`);
    const keys = state.getAllKeys();
    if (keys.length > 0) {
      console.log(`   User IDs with state: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`);
    }
    
    // Bot webhook info
    if (this.riderBotToken) {
      await this.getBotInfo(this.riderBotToken, 'Rider Bot');
    }
    
    if (this.driverBotToken) {
      await this.getBotInfo(this.driverBotToken, 'Driver Bot');
    }
  }
}

// CLI Interface
async function main() {
  const cleaner = new TelegramCacheCleaner();
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('🚗 RideEase Telegram Cache Cleaner');
  console.log('==================================');
  
  switch (command) {
    case 'clear':
      await cleaner.clearAllBotCache();
      break;
      
    case 'clear-state':
      await cleaner.clearStateCache();
      break;
      
    case 'clear-user':
      const telegramId = args[1];
      if (!telegramId) {
        console.log('❌ Please provide telegram ID: node clearCache.js clear-user <telegram_id>');
        process.exit(1);
      }
      await cleaner.clearUserCache(telegramId);
      break;
      
    case 'clear-webhooks':
      if (cleaner.riderBotToken) {
        await cleaner.clearWebhookUpdates(cleaner.riderBotToken, 'Rider Bot');
      }
      if (cleaner.driverBotToken) {
        await cleaner.clearWebhookUpdates(cleaner.driverBotToken, 'Driver Bot');
      }
      break;
      
    case 'status':
      await cleaner.showCacheStatus();
      break;
      
    default:
      console.log('\n📖 Usage:');
      console.log('  node clearCache.js clear           - Clear all caches');
      console.log('  node clearCache.js clear-state     - Clear only application state');
      console.log('  node clearCache.js clear-user <id> - Clear cache for specific user');
      console.log('  node clearCache.js clear-webhooks  - Clear only webhook caches');
      console.log('  node clearCache.js status          - Show current cache status');
      console.log('\n💡 Examples:');
      console.log('  node clearCache.js clear');
      console.log('  node clearCache.js clear-user 123456789');
      console.log('  node clearCache.js status');
      break;
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = TelegramCacheCleaner;
