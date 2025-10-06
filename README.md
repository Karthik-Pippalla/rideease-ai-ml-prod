# RideEase - Telegram Ride Sharing Platform

RideEase is a comprehensive ride-sharing platform built as a Telegram bot application, connecting riders and drivers through an intelligent matching system powered by AI and real-time notifications.

## 🚀 Features

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

### Technology Stack
- **Backend**: Node.js with Express.js
- **Cloud Platform**: Firebase Functions (Serverless)
- **Database**: MongoDB with Mongoose ODM
- **AI Integration**: OpenAI API for natural language processing
- **Bot Framework**: Telegram Bot API
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

## 🤖 AI Integration

The platform uses OpenAI's GPT model for:
- Natural language understanding of ride requests
- Intelligent parsing of location and time preferences
- Contextual responses to user queries
- Dynamic conversation flow management

## 🔧 API Endpoints

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

- Comprehensive error logging
- Performance monitoring
- User activity tracking
- Firebase Functions analytics

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, please contact the development team or create an issue in the repository.

## 🚧 Roadmap

- [ ] Real-time ride tracking
- [ ] Payment integration
- [ ] Driver rating system
- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Mobile app development

---

Built with ❤️ using Node.js, Firebase, and Telegram Bot API
