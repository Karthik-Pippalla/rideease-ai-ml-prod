#!/bin/bash

# RideEase Website Deployment Script
# This script builds and deploys the website to Firebase Hosting

echo "🚗 RideEase Website Deployment Starting..."

# Navigate to the website directory
cd "$(dirname "$0")/website/client"

echo "📦 Installing dependencies..."
npm ci

echo "🔨 Building production build..."
npm run build

# Navigate back to root
cd ../..

echo "🚀 Deploying to Firebase Hosting..."
firebase deploy --only hosting

echo "✅ Deployment complete!"
echo "🌐 Your website should be available at:"
echo "   https://ride-bot-762c5.web.app"
echo "   https://ride-bot-762c5.firebaseapp.com"
