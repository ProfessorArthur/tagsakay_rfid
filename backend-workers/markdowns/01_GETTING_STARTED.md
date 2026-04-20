# 🚀 Getting Started with TagSakay

Complete setup and quick start guide for the TagSakay RFID system.

---

## 📋 Installation Checklist

### Prerequisites

- Node.js 18+ installed
- Git installed
- Wrangler CLI: `npm install -g wrangler`
- Neon database account (free tier available)

### Phase 1: Environment Setup

#### 1. Clone and Install Dependencies

```bash
# Navigate to backend
cd backend-workers

# Install dependencies
npm install

# Verify installation
npm run --version
wrangler --version
```

#### 2. Database Setup

```bash
# Create Neon project at: https://console.neon.tech
# Get connection string and add to .dev.vars

# Create .dev.vars file
cp .env.example .dev.vars

# Edit .dev.vars with your values:
DATABASE_URL=postgresql://username:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require
JWT_SECRET=your-super-secret-jwt-key-here-generate-a-new-one
NODE_ENV=development
```

#### 3. Database Migrations

```bash
# Generate and run migrations
npm run db:generate
npm run db:migrate

# Seed test data
npm run seed
```

#### 4. Development Server

```bash
# Start development server
npm run dev

# Expected output:
# ⛅️ wrangler 3.x.x
# --local flag is deprecated
# Your worker is ready at http://localhost:8787
```

### Phase 2: Verification

#### Test API Health

```bash
curl http://localhost:8787/health
# Expected: {"success":true,"message":"API is healthy"}
```

#### Test Authentication

```bash
# Test login with seed user
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tagsakay.local","password":"Admin123!@#"}'

# Expected: JWT token response
```

#### Test Database Connection

```bash
# Test users endpoint
curl http://localhost:8787/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected: List of users
```

---

## 🎯 Quick Start (15 Minutes)

### For Experienced Developers

```bash
# 1. Setup (5 min)
cd backend-workers && npm install
cp .env.example .dev.vars
# Edit .dev.vars with your Neon credentials

# 2. Database (3 min)
npm run db:migrate && npm run seed

# 3. Test (2 min)
npm run dev &
curl http://localhost:8787/health

# 4. Frontend (5 min)
cd ../frontend && npm install
npm run dev
# Open http://localhost:5173
```

### Test Credentials

```
Admin User:
Email: admin@tagsakay.local
Password: Admin123!@#

Regular User:
Email: driver@tagsakay.local
Password: Driver123!@#
```

---

## 🏗️ Project Structure

```
tagsakay_rfid/
├── backend-workers/          # Cloudflare Workers backend
│   ├── src/
│   │   ├── index.ts         # Main app entry
│   │   ├── db/              # Database schema & utils
│   │   ├── routes/          # API endpoints
│   │   ├── middleware/      # Auth, rate limiting
│   │   └── lib/             # Utilities
│   ├── drizzle/             # Database migrations
│   ├── tests/               # API tests
│   └── .dev.vars            # Environment secrets
│
├── frontend/                 # Vue.js admin interface
│   ├── src/
│   │   ├── views/           # Page components
│   │   ├── components/      # Reusable components
│   │   ├── composables/     # Vue composables
│   │   └── services/        # API clients
│   └── .env                 # Frontend config
│
└── TagSakay_Fixed_Complete/ # ESP32 firmware
    ├── *.ino               # Arduino sketch
    ├── *.cpp/.h            # Module files
    └── Config.h            # Hardware config
```

---

## 🔧 Environment Configuration

### Backend (.dev.vars)

```bash
# Database (Required)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Security (Required)
JWT_SECRET=generate-a-random-256-bit-key-here

# Environment
NODE_ENV=development

# Optional
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60000
```

### Frontend (.env)

```bash
# API URL for development
VITE_API_URL=http://localhost:8787/api

# For production
VITE_API_URL=https://api.tagsakay.com/api
```

### ESP32 (Config.h)

```cpp
// WiFi Configuration
#define WIFI_SSID "YourNetworkName"
#define WIFI_PASSWORD "YourWiFiPassword"

// Server Configuration
#define WS_HOST "localhost"           // Development
// #define WS_HOST "api.tagsakay.com" // Production
#define WS_PORT 8787                  // Development
// #define WS_PORT 443                // Production
#define API_BASE_URL "http://localhost:8787/api"
```

---

## 🚨 Troubleshooting

### Common Issues

#### 1. Database Connection Fails

```bash
Error: connection terminated
```

**Solution:**

- Check Neon database is running
- Verify DATABASE_URL format
- Ensure IP is whitelisted in Neon console

#### 2. Migration Fails

```bash
Error: relation already exists
```

**Solution:**

```bash
# Reset database
npm run db:drop
npm run db:migrate
npm run seed
```

#### 3. JWT Token Invalid

```bash
Error: Invalid token
```

**Solution:**

- Check JWT_SECRET is set in .dev.vars
- Verify token isn't expired (4 hour default)
- Re-login to get fresh token

#### 4. CORS Issues in Frontend

```bash
Access to fetch blocked by CORS policy
```

**Solution:**

- Ensure VITE_API_URL matches backend URL
- Check backend CORS configuration in src/index.ts
- Verify both frontend and backend are running

#### 5. ESP32 Can't Connect

```
WebSocket connection failed
```

**Solution:**

- Check WiFi credentials in Config.h
- Verify backend WebSocket endpoint is accessible
- Check device registration and API key

### Debug Commands

```bash
# Check environment
npm run env:check

# Verify database schema
npm run db:studio

# Test all routes
npm run test:api

# Check WebSocket
npm run test:websocket

# View logs
npm run logs
```

---

## 📚 Next Steps

After setup is complete:

1. **Explore the Admin Interface**

   - Open http://localhost:5173
   - Login with test credentials
   - Explore device registration, RFID management

2. **Configure ESP32 Device**

   - Update Config.h with your WiFi
   - Register device via admin interface
   - Flash firmware and test scanning

3. **Review Documentation**

   - See `02_ARCHITECTURE.md` for system design
   - See `03_DEVELOPMENT.md` for coding patterns
   - See `04_DEPLOYMENT.md` for production setup

4. **Start Development**
   - Check `05_PROGRESS.md` for completed features
   - See `06_TROUBLESHOOTING.md` for common issues

---

## ✅ Success Criteria

You've successfully set up TagSakay when:

- [x] Backend health check returns success
- [x] Database migrations completed without errors
- [x] Frontend loads and login works
- [x] API authentication works with test users
- [x] WebSocket connection shows "Connected"
- [x] Test RFID scan appears in dashboard

**Time Investment:** 15-30 minutes for complete setup

---

## 🎯 Quick Reference

### Most Used Commands

```bash
# Development
npm run dev              # Start backend
npm run db:studio        # Open database UI
npm run test:api         # Test all endpoints

# Database
npm run db:migrate       # Run migrations
npm run db:generate      # Generate new migration
npm run seed             # Add test data

# Deployment
npm run deploy           # Deploy to production
npm run test:production  # Test production deploy
```

### Key URLs

- Backend API: http://localhost:8787
- Frontend UI: http://localhost:5173
- Database UI: npm run db:studio
- API Docs: http://localhost:8787/docs

---

**Last Updated:** November 4, 2025  
**Status:** ✅ Complete and tested  
**Next:** See `02_ARCHITECTURE.md` for system design
