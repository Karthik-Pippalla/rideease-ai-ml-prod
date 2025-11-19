# RideEase Firebase Deployment Guide

## 🚀 Quick Deploy

Run the deployment script:
```bash
./deploy-website.sh
```

Or deploy manually:
```bash
# Build the website
cd website/client
npm run build
cd ../..

# Deploy to Firebase
firebase deploy --only hosting
```

## 🌐 Your Website URLs

After deployment, your website will be available at:
- **Primary URL**: https://ride-bot-762c5.web.app
- **Secondary URL**: https://ride-bot-762c5.firebaseapp.com

## ⚙️ Firebase Configuration

The website is configured with:
- **Static hosting** for React build files
- **SPA routing** (all routes go to index.html)
- **Caching headers** for performance
- **Service worker** support

## 🔧 Development vs Production

### Development (Local)
```bash
cd website/client
npm start
# Runs on http://localhost:3000
```

### Production (Firebase)
```bash
firebase serve --only hosting
# Test locally on http://localhost:5000
```

## 📁 File Structure

```
rideease/
├── firebase.json          # Firebase configuration
├── .firebaserc            # Firebase project settings
├── deploy-website.sh      # Deployment script
├── functions/             # Your existing bot functions
└── website/
    ├── client/
    │   ├── build/         # Production build (auto-generated)
    │   ├── src/           # React source code
    │   └── package.json   # Frontend dependencies
    └── server.js          # Development server (not used in Firebase)
```

## 🚦 Deployment Steps

1. **Build the React app**:
   ```bash
   cd website/client
   npm run build
   ```

2. **Deploy to Firebase**:
   ```bash
   firebase deploy --only hosting
   ```

3. **Verify deployment**:
   - Visit your website URL
   - Check all pages load correctly
   - Test responsive design

## 🔄 Continuous Deployment

### Option 1: GitHub Actions (Recommended)

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Firebase
on:
  push:
    branches: [ main ]
    paths: [ 'website/**' ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install and Build
        run: |
          cd website/client
          npm ci
          npm run build
      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          projectId: ride-bot-762c5
```

### Option 2: Firebase CLI Deployment

Set up automatic deployment:
```bash
firebase init hosting:github
```

## 🎯 Custom Domain (Optional)

1. Go to Firebase Console > Hosting
2. Click "Add custom domain"
3. Follow the DNS setup instructions
4. Examples:
   - `rideease.com`
   - `www.rideease.com`

## 📊 Analytics & Monitoring

Add Google Analytics to track website performance:

1. **Enable Analytics** in Firebase Console
2. **Add tracking code** to `public/index.html`:
   ```html
   <!-- Google Analytics -->
   <script async src="https://www.googletagmanager.com/gtag/js?id=GA_TRACKING_ID"></script>
   ```

## 🔒 Security Headers

Firebase hosting automatically includes:
- HTTPS enforcement
- HSTS headers
- Content security policies
- CORS handling

## ⚡ Performance Optimization

The configuration includes:
- **Static asset caching** (1 year for JS/CSS)
- **Service worker caching** (no-cache)
- **Gzip compression** (automatic)
- **CDN distribution** (global)

## 🐛 Troubleshooting

### Build Issues
```bash
# Clear cache and reinstall
cd website/client
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Routing Issues
- Ensure `rewrites` in `firebase.json` is configured
- All routes should redirect to `/index.html` for SPA

### Deployment Failures
```bash
# Check Firebase CLI version
firebase --version

# Login again if needed
firebase login

# Force deploy
firebase deploy --only hosting --force
```

## 📞 Support

- **Firebase Console**: https://console.firebase.google.com
- **Firebase Documentation**: https://firebase.google.com/docs/hosting
- **Project Issues**: Use GitHub issues in your repository
