# RideEase - Intelligent Carpooling Assistant

RideEase is an intelligent ride-sharing system designed to optimize real-time driver–rider matching using AI and event-driven architecture. The system integrates Telegram bots, cloud functions, and machine learning to provide efficient and reliable ride connections while minimizing idle driver time and rider wait time.

**Course**: COT6930 – ML & AI in Production  
**Term**: Fall 2025  
**Team Lead**: Karthik Abhiram Pippalla (FAU)

## 🎯 Project Objectives

- **Automate driver–rider matching** using real-time geolocation and bid scoring
- **Provide dynamic driver availability** with configurable time and radius
- **Ensure end-to-end CI/CD deployment**, monitoring, and MLOps tracking

## 🚀 Key Features

- **Dual Telegram bots**: RiderBot (ride requests) and DriverBot (availability, ride acceptance)
- **Location-based ML matching** using MongoDB geospatial data
- **Real-time event streaming** using Kafka/Pub/Sub
- **Automated monitoring** and model version tracking via Grafana Cloud

### For Riders
- **Easy Registration**: Quick onboarding through Telegram
- **Smart Ride Requests**: Natural language processing for ride booking
- **Real-time Tracking**: Live updates on ride status and driver location
- **Ride History**: View past and active rides
- **Profile Management**: Update personal information and preferences

### For Drivers
- **Driver Dashboard**: Comprehensive profile and availability management
- **Automatic Matching**: Intelligent ride assignment based on location and availability
- **Earnings Tracking**: Monitor ride history and earnings
- **Flexible Availability**: Easy toggle between available/unavailable status
- **Route Optimization**: Distance-based matching for efficient rides

### Core System Features
- **AI-Powered Chat**: OpenAI integration for natural language understanding
- **Real-time Notifications**: Instant updates via Telegram
- **Geolocation Services**: Accurate location matching and distance calculation
- **State Management**: Persistent user sessions and ride tracking
- **Error Handling**: Robust error management and user feedback

## 🏗️ Architecture

### System Diagram
```
                      ┌──────────────────────────┐ 
                      │        Telegram          │ 
                      │ RiderBot / DriverBot UI │ 
                      └────────────┬─────────────┘ 
                                   │  Commands / Natural Input 
                                   ▼ 
                    ┌────────────────────────────────────────┐ 
                    │     FastAPI Gateway / Firebase Funcs    │ 
                    │ REST Endpoints + Model Inference Logic │ 
                    └───────────────┬────────────────────────┘ 
                                    │ Event Streaming 
                   ┌────────────────┴────────────────┐ 
                   ▼                                 ▼ 
          ┌────────────────────┐            ┌────────────────────┐ 
          │ MongoDB / Firestore│            │ Kafka / PubSub Bus │ 
          │ Ride & Driver Data │            │ Event Consumers    │ 
          └──────────┬─────────┘            └──────────┬─────────┘ 
                     │                                │ 
                     ▼                                ▼ 
      ┌───────────────────────────────┐   ┌─────────────────────────────┐ 
      │ ML Matching Engine (Python)   │   │ Monitoring (Prometheus)     │ 
      │ Match scoring: route + bids   │   │ Metrics to Grafana Cloud    │ 
      └───────────────────────────────┘   └─────────────────────────────┘ 
```

### Core Components
1. **RiderBot & DriverBot** – Telegram interfaces for booking and accepting rides
2. **FastAPI Service Layer** – REST endpoints + orchestration of ML logic
3. **ML Matching Engine** – Scoring algorithm using location, distance, and bid
4. **Kafka Event Stream** – Manages live ride/availability events
5. **CI/CD Workflow** – GitHub Actions pipeline for build/test/deploy
6. **Monitoring Layer** – Prometheus + Grafana dashboards

### Technology Stack
- **Backend**: Node.js with Express.js
- **Cloud Platform**: Firebase Functions (Serverless) / Cloud Run
- **Database**: MongoDB Atlas with Mongoose ODM
- **AI Integration**: OpenAI API for natural language processing
- **Bot Framework**: Telegram Bot API
- **Event Streaming**: Kafka/Pub/Sub
- **Monitoring**: Grafana Cloud + Prometheus
- **Geocoding**: Location services integration

### Project Structure
```
├── functions/
│   ├── index.js                 # Main Firebase Functions entry point
│   ├── driverBot.js            # Driver bot with command interface
│   ├── riderBot.js             # Rider bot with command interface
│   ├── webhookSetup.js         # Telegram webhook configuration
│   ├── clearCache.js           # Cache management utilities
│   ├── controllers/            # Business logic controllers
│   │   ├── driversController.js
│   │   ├── ridersController.js
│   │   └── ridesController.js
│   ├── models/                 # Data models
│   │   ├── driver.js
│   │   ├── rider.js
│   │   └── ride.js
│   ├── routes/                 # API routes
│   │   ├── drivers.js
│   │   ├── riders.js
│   │   └── rides.js
│   └── utils/                  # Utility functions
│       ├── database.js         # Database connection
│       ├── distance.js         # Distance calculations
│       ├── errorHandler.js     # Error management
│       ├── geocode.js          # Geocoding services
│       ├── guards.js           # Data validation
│       ├── matching.js         # Ride matching algorithm
│       ├── notifications.js    # Notification system
│       ├── openai.js          # AI integration
│       ├── state.js           # State management
│       └── validation.js      # Input validation
├── firebase.json              # Firebase configuration
└── package.json              # Project dependencies
```

## 🛠️ Setup and Installation

### Prerequisites
- Node.js 22 or higher
- Firebase CLI
- MongoDB instance
- Telegram Bot Token (from @BotFather)
- OpenAI API Key

### Environment Variables
Create a `.env` file in the `functions/` directory:
```env
MONGODB_URI=your_mongodb_connection_string
TELEGRAM_BOT_TOKEN_RIDER=your_rider_bot_token
TELEGRAM_BOT_TOKEN_DRIVER=your_driver_bot_token
OPENAI_API_KEY=your_openai_api_key
FIREBASE_PROJECT_ID=your_firebase_project_id
```

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd rideease-ridease-milestone1
   ```

2. Install dependencies:
   ```bash
   npm install
   cd functions && npm install
   ```

3. Configure Firebase:
   ```bash
   firebase init
   ```

4. Set up Telegram webhooks:
   ```bash
   cd functions
   npm run set-webhook
   ```

## 🚀 Development

### Local Development
Start the Firebase emulator:
```bash
cd functions
npm run dev
```

### Testing
Test individual functions:
```bash
npm run shell
```

### Deployment
Deploy to Firebase:
```bash
npm run deploy
```

## 📱 Bot Commands

### Rider Bot Commands
- `/start` - Welcome message and registration
- `/me` - Show profile information
- `/erase` - Delete account (requires confirmation)
- `/update` - Update profile details
- `/riderequest` - Request a new ride
- `/cancelride` - Cancel active ride request
- `/rides` - View ride history
- `/clearcache` - Clear session cache
- `/help` - Show available commands

### Driver Bot Commands
- `/start` - Welcome message and registration
- `/me` - Show driver profile
- `/erase` - Delete driver account
- `/update` - Update driver details
- `/available` - Start accepting rides
- `/unavailable` - Stop accepting rides
- `/rides` - View active and past rides
- `/help` - Show available commands

## 🤖 MLOps & Model Management

### CI/CD Pipeline
1. **Code Tests** → Run unit/integration tests
2. **Build** → Docker container with pinned dependencies
3. **Push** → Image pushed to GitHub Container Registry
4. **Deploy** → Auto-deploy via Firebase or Cloud Run
5. **Monitor** → Post-deployment status summary in Actions log

### Model Versioning
| Field | Description |
|-------|-------------|
| model_version | e.g., v0.1, v0.2 |
| created_at | Model build timestamp |
| accuracy | Match success rate (A/B test) |
| latency_ms | Average inference time |
| schema_version | JSON schema reference |
| notes | Model update rationale |

### Data Management
- **Sources**: Synthetic rider/driver event data + test rides
- **Storage**: `/snapshots/2025-10-01/` versioned data folders
- **Schema Validation**: JSON schema enforcement pre-ingest
- **Replay Support**: Simulate historical events for testing

## 🤖 AI Integration

The platform uses OpenAI's GPT model for:
- Natural language understanding of ride requests
- Intelligent parsing of location and time preferences
- Contextual responses to user queries
- Dynamic conversation flow management

## � API Contract & SLOs

| Endpoint | Method | Description | SLO (Latency / Availability) |
|----------|--------|-------------|-------------------------------|
| `/register` | POST | Register a driver/rider | <200ms / 99.9% |
| `/ride/request` | POST | Rider posts ride request | <250ms / 99.5% |
| `/ride/accept` | POST | Driver accepts a ride | <250ms / 99.5% |
| `/ride/status/{id}` | GET | Get ride status | <150ms / 99.9% |
| `/availability` | GET | Driver sets availability to accept rides | <100ms / 99.9% |

## �🔧 API Endpoints

### Riders API
- `GET /riders` - List all riders
- `POST /riders` - Create new rider
- `GET /riders/:id` - Get rider details
- `PUT /riders/:id` - Update rider
- `DELETE /riders/:id` - Delete rider

### Drivers API
- `GET /drivers` - List all drivers
- `POST /drivers` - Create new driver
- `GET /drivers/:id` - Get driver details
- `PUT /drivers/:id` - Update driver
- `DELETE /drivers/:id` - Delete driver

### Rides API
- `GET /rides` - List all rides
- `POST /rides` - Create new ride
- `GET /rides/:id` - Get ride details
- `PUT /rides/:id` - Update ride
- `DELETE /rides/:id` - Cancel ride

## 🔒 Security Features

- Input validation and sanitization
- Error handling with user-friendly messages
- Rate limiting and spam protection
- Secure webhook verification
- Data encryption in transit

## 📊 Monitoring and Logging

- **Comprehensive error logging**
- **Performance monitoring** via Prometheus
- **User activity tracking**
- **Firebase Functions analytics**
- **Grafana Cloud dashboards** for ride latency, match rate, API health
- **Real-time metrics** tracking

## ⚠️ Risk Register & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cloud credit exhaustion | Medium | High | Use free Firebase/Grafana tiers |
| Schema drift | Medium | Medium | Weekly schema validation |
| Secret/key exposure | Low | High | Store only in GitHub Secrets |
| CI/CD failure | Medium | Medium | Retry + rollback scripts |
| Latency spike | Medium | Medium | Cache frequent queries + optimize geocoding |

## 🤝 Contributing

### Team Structure
| Role | Primary | Backup |
|------|---------|--------|
| PM / Delivery Lead | Karthik Abhiram Pippalla | N/A |
| ML Lead | Akanksha Midivelli  | N/A |
| Data/Streaming Lead | shreya | N/A |
| DevOps/Cloud Lead | Vasavi Makkena| N/A |

### Communication & Cadence
- **Channel**: Slack + Telegram Dev Group
- **Response SLA**: Routine ≤ 24h; Urgent ≤ 4h
- **Standup**: Fridays, 5 PM (15 min)
- **Sprint Length**: 1 week; biweekly demo

### Definition of Done (DoD)
- Code merged via PR + review
- Tests pass (≥70% coverage)
- Docs updated
- Secrets handled via GitHub Environments
- Deployment successful

### Decision Process & Accountability
- **Normal decisions**: PM finalizes after review
- **Hotfixes**: DevOps Lead initiates rollback
- **Peer evaluation rubric** (1–5): delivery, communication, follow-through

### How to Contribute
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, please contact the development team or create an issue in the repository.

**Repository**: [github.com/Karthik-Pippalla/rideease-ai-ml-prod](https://github.com/Karthik-Pippalla/rideease-ai-ml-prod)  
**CI/CD**: GitHub Actions → Firebase Hosting / Cloud Run  
**Monitoring**: Grafana Cloud (ride latency, match rate, API health)

## 🗓️ Milestone Plan

| Milestone | Focus | Due | Deliverables |
|-----------|-------|-----|--------------|
| M1 | Team Formation & Proposal | Oct 6 | Contract + Proposal PDF |
| M2 | Kafka Wiring & Baseline Deploy | Oct 20 | Event streams + Deploy |
| M3 | Evaluation & CI/CD | Nov 3 | Model registry + pipelines |
| M4 | Monitoring & Retraining | Nov 12 | Grafana + retrain scripts |
| M5 | Fairness, Security & Final Demo | Nov 24 | Recorded demo + report |

## 🚧 Roadmap

- [x] **Milestone 1**: Team Formation & Technical Proposal
- [ ] **Real-time event streaming** with Kafka/Pub/Sub integration
- [ ] **ML matching engine** with bid scoring algorithm
- [ ] **Driver rating system**
- [ ] **Multi-language support**
- [ ] **Advanced analytics dashboard**
- [ ] **Mobile app development**
- [ ] **Fairness and security enhancements**

---

**Prepared by**: Karthik Abhiram Pippalla (RideEase Team)  
**Course**: COT6930 – ML & AI in Production, Fall 2025  
**Date**: October 6, 2025  

Built with ❤️ using Node.js, Firebase, Telegram Bot API, and ML/AI technologies
