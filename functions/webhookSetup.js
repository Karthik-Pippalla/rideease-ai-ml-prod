/*
  webhookSetup.js - Setup script to configure Telegram webhooks for both bots
  
  This script configures the webhook URLs for both the driver and rider bots.
  Run this after deploying your Firebase functions to set up the webhooks.
  
  Usage:
  node webhookSetup.js <base_url>
  
  Example:
  node webhookSetup.js https://your-project-default-rtdb.firebaseio.com/api
*/

const https = require('https');
const http = require('http');
require('dotenv').config();

// Bot tokens from environment
const DRIVER_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_DRIVER;
const RIDER_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!DRIVER_BOT_TOKEN || !RIDER_BOT_TOKEN) {
  console.error('❌ Error: Missing bot tokens in .env file');
  console.error('Please set TELEGRAM_BOT_TOKEN_DRIVER and TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function setWebhook(botToken, webhookUrl, botName) {
  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
  
  try {
    console.log(`🔄 Setting webhook for ${botName}...`);
    console.log(`   URL: ${webhookUrl}`);
    
    const response = await makeRequest(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true
      })
    });
    
    if (response.ok) {
      console.log(`✅ ${botName} webhook set successfully!`);
      console.log(`   Description: ${response.description || 'Success'}`);
    } else {
      console.error(`❌ Failed to set ${botName} webhook:`);
      console.error(`   Error: ${response.description || response.body || 'Unknown error'}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Error setting ${botName} webhook:`, error.message);
    return false;
  }
}

async function getWebhookInfo(botToken, botName) {
  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
  
  try {
    const response = await makeRequest(telegramApiUrl);
    
    if (response.ok) {
      const info = response.result;
      console.log(`ℹ️  ${botName} webhook info:`);
      console.log(`   URL: ${info.url || 'Not set'}`);
      console.log(`   Pending updates: ${info.pending_update_count || 0}`);
      console.log(`   Max connections: ${info.max_connections || 'Default'}`);
      if (info.last_error_date) {
        console.log(`   Last error: ${new Date(info.last_error_date * 1000).toISOString()}`);
        console.log(`   Error message: ${info.last_error_message || 'Unknown'}`);
      }
    } else {
      console.error(`❌ Failed to get ${botName} webhook info:`, response.description || response.body);
    }
  } catch (error) {
    console.error(`❌ Error getting ${botName} webhook info:`, error.message);
  }
}

async function deleteWebhook(botToken, botName) {
  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`;
  
  try {
    console.log(`🔄 Deleting webhook for ${botName}...`);
    
    const response = await makeRequest(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        drop_pending_updates: true
      })
    });
    
    if (response.ok) {
      console.log(`✅ ${botName} webhook deleted successfully!`);
    } else {
      console.error(`❌ Failed to delete ${botName} webhook:`, response.description || response.body);
    }
  } catch (error) {
    console.error(`❌ Error deleting ${botName} webhook:`, error.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const baseUrl = args[1];
  
  console.log('🚗 RideEase Telegram Bot Webhook Setup');
  console.log('=====================================');
  
  if (command === 'info') {
    console.log('\n📋 Getting webhook information...\n');
    await getWebhookInfo(DRIVER_BOT_TOKEN, 'Driver Bot');
    console.log('');
    await getWebhookInfo(RIDER_BOT_TOKEN, 'Rider Bot');
    return;
  }
  
  if (command === 'delete') {
    console.log('\n🗑️  Deleting webhooks...\n');
    await deleteWebhook(DRIVER_BOT_TOKEN, 'Driver Bot');
    await deleteWebhook(RIDER_BOT_TOKEN, 'Rider Bot');
    return;
  }
  
  if (command === 'set' && baseUrl) {
    // For Firebase Functions v2, each function has its own URL
    let driverWebhookUrl, riderWebhookUrl;
    
    if (baseUrl === 'firebase-functions-v2' || baseUrl.includes('driverbotwebhook') || baseUrl.includes('riderbotwebhook')) {
      // Use the specific Firebase Functions v2 URLs from your deployment
      driverWebhookUrl = 'https://driverbotwebhook-jtaxf6hktq-uc.a.run.app';
      riderWebhookUrl = 'https://riderbotwebhook-jtaxf6hktq-uc.a.run.app';
    } else {
      // Legacy base URL format
      driverWebhookUrl = `${baseUrl}/driverBotWebhook`;
      riderWebhookUrl = `${baseUrl}/riderBotWebhook`;
    }
    
    console.log('\n🔧 Setting up webhooks...\n');
    
    const driverSuccess = await setWebhook(DRIVER_BOT_TOKEN, driverWebhookUrl, 'Driver Bot');
    console.log('');
    const riderSuccess = await setWebhook(RIDER_BOT_TOKEN, riderWebhookUrl, 'Rider Bot');
    
    console.log('\n📊 Summary:');
    console.log(`Driver Bot: ${driverSuccess ? '✅ Success' : '❌ Failed'}`);
    console.log(`Rider Bot: ${riderSuccess ? '✅ Success' : '❌ Failed'}`);
    
    if (driverSuccess && riderSuccess) {
      console.log('\n🎉 All webhooks configured successfully!');
      console.log('\n📱 Bot URLs:');
      console.log(`Driver Bot: https://t.me/${process.env.DRIVER_BOT_USERNAME || 'your_driver_bot'}`);
      console.log(`Rider Bot: https://t.me/${process.env.RIDER_BOT_USERNAME || 'your_rider_bot'}`);
    }
    
    return;
  }
  
  // Show usage
  console.log('\nUsage:');
  console.log('  node webhookSetup.js set <base_url>     - Set webhooks');
  console.log('  node webhookSetup.js info               - Get webhook info');
  console.log('  node webhookSetup.js delete             - Delete webhooks');
  console.log('\nExamples:');
  console.log('  node webhookSetup.js set firebase-functions-v2');
  console.log('  node webhookSetup.js set https://your-project.cloudfunctions.net/api');
  console.log('  node webhookSetup.js info');
  console.log('  node webhookSetup.js delete');
  console.log('\nFor Firebase Functions v2 (current deployment):');
  console.log('  node webhookSetup.js set firebase-functions-v2');
  console.log('\nNote: Make sure your .env file contains:');
  console.log('  TELEGRAM_BOT_TOKEN=<rider_bot_token>');
  console.log('  TELEGRAM_BOT_TOKEN_DRIVER=<driver_bot_token>');
}

main().catch(console.error);

module.exports = { setWebhook, getWebhookInfo, deleteWebhook };
