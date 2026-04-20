# 🎯 TagSakay Domain Implementation - Visual Guide

## 📊 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      tagsakay.com Domain                         │
└─────────────────────────────────────────────────────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
                ▼                ▼                ▼
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │ api.tagsakay │  │ app.tagsakay │  │  tagsakay    │
        │    .com      │  │    .com      │  │    .com      │
        └──────────────┘  └──────────────┘  └──────────────┘
        Backend API       Admin Dashboard   Landing Page
        (Workers)         (Pages)           (Future)
             │                   │
             │                   │
        ┌────▼───────────────────▼────┐
        │    Cloudflare Network       │
        │  • SSL/TLS Automatic        │
        │  • DDoS Protection          │
        │  • Global CDN               │
        └─────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   ESP32 Devices  Web Browsers  Mobile
   (WebSocket)    (HTTPS)       (Future)
```

---

## 🔄 Data Flow

### 1. RFID Scan Flow

```
ESP32 Scanner
     │
     │ (1) WebSocket (WSS)
     │     wss://api.tagsakay.com:443/ws/device
     ▼
Cloudflare Workers (Backend)
     │
     │ (2) Process & Store
     │
     ▼
Neon PostgreSQL Database
     │
     │ (3) Real-time Update
     │
     ▼
Admin Dashboard (Vue.js)
     │
     │ (4) Display to Admin
     │
     ▼
Admin sees scan in real-time
```

### 2. Authentication Flow

```
Admin Login
     │
     │ (1) POST https://api.tagsakay.com/api/auth/login
     │     { email, password }
     ▼
Backend API
     │
     │ (2) Verify credentials (PBKDF2)
     │     Check against database
     ▼
Generate JWT Token
     │
     │ (3) Return token (4-hour expiry)
     │
     ▼
Frontend stores token
     │
     │ (4) Include in all API requests
     │     Authorization: Bearer <token>
     ▼
Access protected resources
```

### 3. Device Registration Flow

```
Admin runs CLI command
     │
     │ npm run device:register MAC "Name" "Location"
     │
     ▼
Backend API
     │
     │ (1) Generate API key
     │     Format: dev_abc123...
     │     Hash: SHA256 for storage
     ▼
Store in Database
     │
     │ (2) Return plain API key to admin
     │     (Last time it's visible)
     ▼
Admin configures ESP32
     │
     │ (3) Via Serial Monitor:
     │     config_apikey dev_abc123...
     │     OR hardcode in firmware
     ▼
ESP32 saves to EEPROM
     │
     │ (4) WebSocket authentication
     │     Send API key on connect
     ▼
Backend validates & authorizes device
```

---

## 📁 File Structure & Configuration

```
tagsakay_rfid/
│
├── 📱 ESP32 Firmware (Hardware Layer)
│   └── TagSakay_Fixed_Complete/
│       ├── Config.h ✅ UPDATED
│       │   └── Production URLs configured
│       │       • WS_HOST = "api.tagsakay.com"
│       │       • API_BASE_URL = "https://api.tagsakay.com"
│       │       • USE_SECURE_WS = true
│       │
│       └── TagSakay_Fixed_Complete.ino ⚠️ NEEDS WIFI
│           └── Update WiFi credentials (lines 21-22)
│           └── Update API key after device registration (line 30)
│
├── ⚙️ Backend (API Layer)
│   └── backend-workers/
│       ├── wrangler.toml ✅ UPDATED
│       │   └── Production: api.tagsakay.com
│       │   └── Development: localhost:8787
│       │
│       ├── src/index.ts ✅ UPDATED
│       │   └── CORS: app.tagsakay.com allowed
│       │
│       ├── .dev.vars 🔒 LOCAL SECRETS
│       │   └── Development DATABASE_URL
│       │   └── Development JWT_SECRET
│       │
│       └── 🚀 Deploy: npm run deploy
│           └── Production secrets via Wrangler CLI
│
├── 🎨 Frontend (UI Layer)
│   └── frontend/
│       ├── .env ✅ UPDATED
│       │   └── Development: localhost:8787
│       │
│       ├── .env.production ✅ NEW
│       │   └── Production: https://api.tagsakay.com/api
│       │
│       └── 🚀 Deploy: npm run build
│           └── Upload to Cloudflare Pages
│
└── 📚 Documentation
    ├── DOMAIN_SETUP.md         - Complete deployment guide
    ├── QUICK_DEPLOY.md         - 5-minute deployment
    ├── ESP32_CONFIGURATION.md  - WiFi & API key setup
    ├── DOMAIN_CONFIGURED.md    - Summary & checklist
    └── IMPLEMENTATION_SUMMARY.md - This overview
```

---

## 🎨 Configuration Visual Map

### ESP32 Config.h

```cpp
PRODUCTION (Default - Current) ✅
┌────────────────────────────────────┐
│ WS_HOST: api.tagsakay.com          │
│ WS_PORT: 443                       │
│ USE_SECURE_WS: true                │
│ API_BASE_URL: https://api.tagsakay │
└────────────────────────────────────┘

DEVELOPMENT (Commented Out)
┌────────────────────────────────────┐
│ WS_HOST: 192.168.1.100             │
│ WS_PORT: 8787                      │
│ USE_SECURE_WS: false               │
│ API_BASE_URL: http://192.168.1.100 │
└────────────────────────────────────┘
```

### Wrangler.toml

```toml
[env.production] ✅
┌────────────────────────────────────┐
│ name: tagsakay-api-production      │
│ route: api.tagsakay.com/*          │
│ secrets: via Wrangler CLI          │
└────────────────────────────────────┘

[env.development]
┌────────────────────────────────────┐
│ name: tagsakay-api-development     │
│ local: .dev.vars                   │
│ port: 8787                         │
└────────────────────────────────────┘
```

### Frontend .env

```properties
Development (.env) 🔧
┌────────────────────────────────────┐
│ VITE_API_URL=                      │
│   http://localhost:8787/api        │
└────────────────────────────────────┘

Production (.env.production) 🚀
┌────────────────────────────────────┐
│ VITE_API_URL=                      │
│   https://api.tagsakay.com/api     │
└────────────────────────────────────┘
```

---

## 🔐 Security Configuration

### SSL/TLS (Automatic via Cloudflare)

```
api.tagsakay.com  → ✅ HTTPS/WSS (Port 443)
app.tagsakay.com  → ✅ HTTPS (Auto-redirect)
tagsakay.com      → ✅ HTTPS (Future)

Certificate: Cloudflare Universal SSL
Renewal: Automatic
Encryption Mode: Full (Strict) ← Recommended
HSTS: Enable after testing
```

### CORS Configuration

```typescript
Allowed Origins:
✅ http://localhost:5173      (Dev: Vue)
✅ http://localhost:8787      (Dev: Workers)
✅ https://api.tagsakay.com   (Prod: API)
✅ https://app.tagsakay.com   (Prod: Frontend)
✅ https://tagsakay.com       (Prod: Main)
✅ https://www.tagsakay.com   (Prod: WWW)
```

### Rate Limiting (OWASP Compliant)

```
Authentication Endpoints:
├── 5 requests / minute (per IP)
├── 5 failed attempts → 15 min lockout
└── Account-based tracking

API Endpoints:
├── 100 requests / minute (per JWT)
└── Exponential backoff

Device Registration:
└── 3 requests / hour (per device)
```

---

## 🧪 Testing Checklist

### 1. Backend Verification

```powershell
# Health check
curl https://api.tagsakay.com/health
# Expected: {"success":true,"message":"API is healthy"}

# WebSocket test (via ESP32 or wscat)
wscat -c wss://api.tagsakay.com:443/ws/device
# Expected: Connection successful + authentication prompt
```

### 2. Frontend Verification

```
Browser: https://app.tagsakay.com
├── ✅ Page loads without errors
├── ✅ Login form visible
├── ✅ Can authenticate with test account
├── ✅ Dashboard displays after login
├── ✅ WebSocket shows "Connected" status
└── ✅ No CORS errors in console
```

### 3. ESP32 Verification

```
Serial Monitor (115200 baud):
├── ✅ WiFi connected
├── ✅ IP address assigned
├── ✅ WebSocket connected to api.tagsakay.com
├── ✅ Device authenticated
├── ✅ RFID scanner initialized
├── ✅ Scan test: Tag appears on dashboard
└── ✅ No SSL/TLS errors
```

---

## 📊 Deployment Progress Tracker

### Phase 1: Configuration ✅ COMPLETE

- [x] Backend wrangler.toml updated
- [x] Backend CORS configured
- [x] Frontend .env files created
- [x] ESP32 Config.h updated
- [x] Documentation created

### Phase 2: Cloudflare Setup ⏳ PENDING

- [ ] Domain added to Cloudflare
- [ ] Nameservers updated at registrar
- [ ] DNS records configured
- [ ] DNS propagation verified

### Phase 3: Backend Deployment ⏳ PENDING

- [ ] npm run deploy executed
- [ ] Custom domain added (api.tagsakay.com)
- [ ] DATABASE_URL secret set
- [ ] JWT_SECRET secret set
- [ ] Health endpoint verified

### Phase 4: Frontend Deployment ⏳ PENDING

- [ ] npm run build completed
- [ ] Deployed to Cloudflare Pages
- [ ] Custom domain added (app.tagsakay.com)
- [ ] Can access login page
- [ ] API connection verified

### Phase 5: ESP32 Deployment ⏳ PENDING

- [ ] WiFi credentials updated
- [ ] Device registered (API key obtained)
- [ ] API key configured in firmware
- [ ] Firmware compiled successfully
- [ ] Firmware flashed to device
- [ ] Device connects to production
- [ ] Scans appear on dashboard

---

## 🎉 Success Indicators

When fully deployed, you should see:

### Backend

```bash
$ curl https://api.tagsakay.com/health
{"success":true,"message":"API is healthy","timestamp":"2025-11-03T..."}
```

### Frontend

```
✅ https://app.tagsakay.com loads
✅ Login works
✅ Dashboard shows "WebSocket: Connected"
✅ No console errors
```

### ESP32

```
Serial Monitor:
[✓] WiFi connected to YourNetworkName
[✓] IP: 192.168.1.XXX
[✓] Connecting to: wss://api.tagsakay.com:443/ws/device
[✓] WebSocket connected
[✓] Device authenticated
[✓] RFID scanner ready
System Ready - Waiting for scans
```

### End-to-End

```
1. Scan RFID tag on ESP32
   → Serial Monitor: "Tag scanned: ABC123"

2. Check frontend dashboard
   → New scan appears in Live Scans section
   → Shows: Tag ID, timestamp, device name

3. Duration: < 2 seconds (real-time) ✅
```

---

**Status:** ✅ Configuration Complete  
**Ready for:** Cloudflare setup and deployment  
**Documentation:** Complete with troubleshooting  
**Last Updated:** November 3, 2025  
**Domain:** tagsakay.com 🎉
