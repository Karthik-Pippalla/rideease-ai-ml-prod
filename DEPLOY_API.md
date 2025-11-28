# 🚀 Deploy RideEase API to Firebase Functions

## Current Status
- ✅ **Local API**: Running at `http://localhost:8080`
- ❌ **Public API**: Not yet deployed
- ✅ **Firebase Project**: `hoteladmindashboard` (configured)

## Why Deploy?
Your professor needs a **live, publicly accessible API** to verify your MLOps implementation.

---

## 🎯 Quick Deploy (5 minutes)

```bash
# 1. Deploy the inference API to Firebase Functions
cd /Users/karthikpippalla/Downloads/rideease-ridease-milestone1
firebase deploy --only functions

# 2. Your API will be live at:
# https://us-central1-hoteladmindashboard.cloudfunctions.net/api
```

---

## 📝 What Gets Deployed

Your `functions/index.js` already exports Firebase Functions:
- `riderBot` - Telegram bot for riders
- `driverBot` - Telegram bot for drivers
- **We need to add**: `api` - Your MLOps inference service

---

## 🔧 Step-by-Step Deployment

### Step 1: Update functions/index.js

Add your inference API as a Firebase Function:

```javascript
// At the bottom of functions/index.js
const server = require('./pipeline/server');
exports.api = functions.https.onRequest(server.app);
```

### Step 2: Update functions/pipeline/server.js

Modify to export the Express app:

```javascript
// At the bottom of server.js, change from:
// app.listen(PORT, () => {...});

// To:
if (require.main === module) {
  // Only listen if run directly (local dev)
  app.listen(PORT, () => {
    console.log(`🚀 Inference service listening on ${PORT}`);
  });
}

// Export for Firebase Functions
module.exports = { app };
```

### Step 3: Set Environment Variables

```bash
# Set MongoDB connection string
firebase functions:config:set \
  mongodb.uri="your-mongodb-uri-here"

# Set other environment variables
firebase functions:config:set \
  openai.key="your-openai-key" \
  telegram.rider_token="your-rider-token" \
  telegram.driver_token="your-driver-token"
```

### Step 4: Deploy

```bash
firebase deploy --only functions
```

### Step 5: Test Your Live API

```bash
# Health check
curl https://us-central1-hoteladmindashboard.cloudfunctions.net/api/healthz

# Metrics
curl https://us-central1-hoteladmindashboard.cloudfunctions.net/api/metrics

# Recommendations
curl -X POST https://us-central1-hoteladmindashboard.cloudfunctions.net/api/recommendations \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "pickupLocation": {"lat": 40.7580, "lon": -73.9855},
    "dropoffLocation": {"lat": 40.7489, "lon": -73.9680},
    "requestTime": "2025-11-20T03:35:00Z"
  }'
```

---

## 🌐 Alternative: Deploy to Render (Easier)

If Firebase Functions is complicated, use Render.com (free tier):

### Option A: Render.com (Recommended - Simplest)

1. **Sign up**: https://render.com
2. **Create New Web Service**
3. **Connect GitHub**: Select your repository
4. **Configure**:
   - Build Command: `cd functions && npm install`
   - Start Command: `cd functions && node pipeline/server.js`
   - Environment: Add your MongoDB URI and other secrets
5. **Deploy**: Render gives you a public URL like `https://rideease-api.onrender.com`

### Option B: Railway.app

1. **Sign up**: https://railway.app
2. **New Project from GitHub**
3. **Select** your repository
4. **Configure**:
   - Root Directory: `functions`
   - Start Command: `node pipeline/server.js`
   - Add environment variables
5. **Deploy**: Get URL like `https://rideease-api-production.up.railway.app`

### Option C: Fly.io

1. **Install Fly CLI**: `brew install flyctl`
2. **Login**: `flyctl auth login`
3. **Create app**:
   ```bash
   cd functions
   flyctl launch --name rideease-api
   ```
4. **Set secrets**:
   ```bash
   flyctl secrets set MONGODB_URI="your-mongodb-uri"
   ```
5. **Deploy**: `flyctl deploy`

---

## ⚡ Fastest Option: ngrok (Temporary Public URL)

For immediate access (perfect for professor demo):

```bash
# 1. Install ngrok
brew install ngrok

# 2. Make your local server public
ngrok http 8080

# 3. Copy the public URL (e.g., https://abc123.ngrok.io)
# 4. Share with professor
```

**Pros**: 
- Works in 30 seconds
- No code changes needed
- Free tier available

**Cons**: 
- Temporary URL (changes each restart)
- Limited to 20 connections/minute (free tier)
- Not suitable for production

---

## 🎓 What to Tell Your Professor

### If Using ngrok (Quick Demo):
> "My API is live at: **https://[YOUR-NGROK-URL].ngrok.io**
> 
> Endpoints:
> - Health: https://[YOUR-NGROK-URL].ngrok.io/healthz
> - Metrics: https://[YOUR-NGROK-URL].ngrok.io/metrics
> - Recommendations: POST https://[YOUR-NGROK-URL].ngrok.io/recommendations"

### If Using Render/Railway (Permanent):
> "My API is deployed at: **https://rideease-api.onrender.com**
>
> It's running 24/7 with:
> - Docker containers
> - MongoDB persistence
> - Prometheus monitoring
> - A/B experimentation
> - Full provenance tracking"

---

## 📊 What Your Professor Will See

When they visit your API:

1. **GET /healthz** → `{"status":"ok","uptimeSeconds":12345}`
2. **GET /metrics** → Prometheus metrics (uptime, latency, requests)
3. **GET /admin/models** → Model registry (v1.0.0, v1.1.0, v1.2.0)
4. **POST /recommendations** → Real predictions with trace IDs
5. **GET /traces/:requestId** → Full provenance

---

## 🚨 Quick Decision Guide

| Method | Time | Permanent | Best For |
|--------|------|-----------|----------|
| **ngrok** | 30 sec | ❌ | Quick demo TODAY |
| **Render** | 10 min | ✅ | Easiest permanent solution |
| **Railway** | 10 min | ✅ | Developer-friendly |
| **Firebase** | 30 min | ✅ | Already configured |
| **Fly.io** | 15 min | ✅ | Best performance |

---

## 🎯 Recommended Action Plan

**For submission TODAY:**
1. Use **ngrok** (30 seconds)
2. Get public URL
3. Test endpoints
4. Add URL to PDF report

**For permanent deployment (tonight):**
1. Sign up for **Render.com**
2. Deploy your API (10 minutes)
3. Update PDF with permanent URL
4. Sleep well knowing it's live 24/7

---

## 🔗 URLs for Your PDF

Add this section to your PDF:

### Live API Endpoints
- **Base URL**: `https://[YOUR-URL-HERE]`
- **Health Check**: `GET /healthz`
- **Prometheus Metrics**: `GET /metrics`
- **Model Registry**: `GET /admin/models`
- **Recommendations**: `POST /recommendations`
- **Provenance Trace**: `GET /traces/{requestId}`
- **A/B Experiment**: `GET /experiments/{id}/summary`

---

**Need help with deployment? Let me know which method you want to use!**
