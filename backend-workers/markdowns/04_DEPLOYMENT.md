# 🚀 TagSakay Deployment Guide

Complete deployment instructions and production configuration for the TagSakay RFID system.

---

## 🌐 Production Deployment Overview

### Infrastructure Architecture

```
Internet
   ↓
Cloudflare CDN/Proxy
   ↓
Cloudflare Workers (Backend API)
   ↓
Neon PostgreSQL Database
   ↑
ESP32 Devices (WebSocket connections)
```

### Deployment Components

- **Frontend**: Static hosting (Cloudflare Pages/Vercel/Netlify)
- **Backend**: Cloudflare Workers (serverless)
- **Database**: Neon PostgreSQL (serverless)
- **Domain**: Custom domain with SSL
- **ESP32**: Wi-Fi connected devices with WebSocket

---

## 🔧 Pre-Deployment Checklist

### 1. Environment Preparation

```bash
# Verify all components are ready
npm run build:check        # Frontend build test
npm run test:api           # Backend API tests
npm run db:migrate         # Database migrations
npm run security:audit     # Security validation
```

> ⚙️ **Migration Reminder:** Before running `npm run db:migrate` against staging or production, confirm every new SQL file is registered in `drizzle/meta/_journal.json` (or run `npm run db:sync-migrations` to generate the entry). Only journaled tags are applied, so keep the journal in sync first.

### 2. Configuration Validation

**Backend Configuration:**

- [ ] `DATABASE_URL` configured
- [ ] `JWT_SECRET` set (32+ characters)
- [ ] `JWT_ISSUER` configured
- [ ] Rate limiting settings reviewed
- [ ] CORS origins configured
- [ ] Security headers enabled

**Frontend Configuration:**

- [ ] `VITE_API_URL` points to production
- [ ] Build optimization enabled
- [ ] Asset paths configured
- [ ] Error tracking setup

**ESP32 Configuration:**

- [ ] Production Wi-Fi credentials
- [ ] Production WebSocket endpoint
- [ ] SSL certificates (if needed)
- [ ] Device API keys generated

### 3. Security Review

```bash
# Run security audit
npm run security:scan
npm run test:security
npm run owasp:check
```

**Security Checklist:**

- [ ] All secrets in environment variables
- [ ] No hardcoded credentials
- [ ] HTTPS enforced
- [ ] Rate limiting active
- [ ] Input validation comprehensive
- [ ] Security headers configured
- [ ] Authentication tested
- [ ] Authorization roles verified

---

## 🏗️ Backend Deployment (Cloudflare Workers)

### 1. Cloudflare Account Setup

```bash
# Login to Cloudflare
npx wrangler login

# Verify account
npx wrangler whoami
```

### 2. Database Setup (Neon)

```bash
# Create production database
# Visit: https://console.neon.tech
# Create new project: "tagsakay-production"
# Get connection string
```

**Database Configuration:**

```bash
# Set production DATABASE_URL
npx wrangler secret put DATABASE_URL
# Enter: postgresql://user:pass@host/db?sslmode=require

# Set JWT secret
npx wrangler secret put JWT_SECRET
# Enter: your-secure-jwt-secret-32-characters-min

# Set JWT issuer
npx wrangler secret put JWT_ISSUER
# Enter: tagsakay-production
```

### 3. Configure Production Settings

**Update `wrangler.toml`:**

```toml
name = "tagsakay-api"
main = "src/index.ts"
compatibility_date = "2024-10-01"
minify = true

[env.production]
name = "tagsakay-api-prod"
route = { pattern = "api.yourdomain.com/*", zone_name = "yourdomain.com" }

[vars]
ENVIRONMENT = "production"
CORS_ORIGINS = "https://yourdomain.com,https://www.yourdomain.com"
RATE_LIMIT_ENABLED = "true"
SECURITY_HEADERS_ENABLED = "true"

[[env.production.r2_buckets]]
binding = "LOGS"
bucket_name = "tagsakay-logs"

[[env.production.durable_objects]]
name = "DEVICE_CONNECTION"
class_name = "DeviceConnection"

[[env.production.migrations]]
tag = "v1"
new_classes = ["DeviceConnection"]
```

### 4. Deploy Backend

```bash
cd backend-workers

# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Deploy to production
npm run deploy:prod

# Verify deployment
curl https://api.yourdomain.com/health

# Test WebSocket endpoint
npm install -g wscat
wscat -c "wss://api.yourdomain.com/ws/device?deviceId=TEST001"
```

### 5. Custom Domain Setup

```bash
# Add custom domain in Cloudflare Dashboard
# DNS Settings > Records
# Add CNAME: api.yourdomain.com → your-worker.workers.dev

# Or use Wrangler
npx wrangler domains add api.yourdomain.com
```

**Domain Configuration:**

1. Go to Cloudflare Dashboard
2. Select your domain
3. DNS > Records
4. Add CNAME record:
   - Name: `api`
   - Target: `tagsakay-api-prod.workers.dev`
   - Proxy status: Proxied (orange cloud)

---

## 🌐 Frontend Deployment

### Option 1: Cloudflare Pages

```bash
cd frontend

# Build for production
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=tagsakay-frontend

# Configure custom domain
npx wrangler pages domain add yourdomain.com --project-name=tagsakay-frontend
```

**Cloudflare Pages Configuration:**

```json
{
  "build": {
    "command": "npm run build",
    "outputDirectory": "dist"
  },
  "env": {
    "VITE_API_URL": "https://api.yourdomain.com"
  }
}
```

### Option 2: Vercel Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to Vercel
cd frontend
vercel --prod

# Configure environment variables
vercel env add VITE_API_URL production
# Enter: https://api.yourdomain.com
```

**`vercel.json` Configuration:**

```json
{
  "build": {
    "env": {
      "VITE_API_URL": "https://api.yourdomain.com"
    }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    }
  ]
}
```

### Option 3: Netlify Deployment

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy to Netlify
cd frontend
netlify deploy --prod --dir=dist

# Configure environment variables
netlify env:set VITE_API_URL https://api.yourdomain.com
```

**`netlify.toml` Configuration:**

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  VITE_API_URL = "https://api.yourdomain.com"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

---

## 🌍 Domain & SSL Configuration

### 1. Domain Setup

**DNS Configuration:**

```
Type: CNAME
Name: api
Target: tagsakay-api-prod.workers.dev
Proxy: Enabled (orange cloud)

Type: CNAME
Name: www
Target: yourdomain.com
Proxy: Enabled (orange cloud)

Type: A
Name: @
Target: 192.0.2.1 (or your hosting IP)
Proxy: Enabled (orange cloud)
```

### 2. SSL Certificate

**Cloudflare SSL:**

1. SSL/TLS > Overview
2. Choose "Full (strict)" mode
3. Edge Certificates > Always Use HTTPS: On
4. Minimum TLS Version: 1.2
5. HTTP Strict Transport Security (HSTS): Enable

**Let's Encrypt (Alternative):**

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Generate certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### 3. Verify SSL Configuration

```bash
# Check SSL setup
curl -I https://yourdomain.com
curl -I https://api.yourdomain.com

# SSL Labs test
# Visit: https://www.ssllabs.com/ssltest/
# Enter: yourdomain.com
```

---

## 📱 ESP32 Production Configuration

### 1. Firmware Configuration

**Update `Config.h` for production:**

```cpp
// Production Configuration
#define WS_HOST "api.yourdomain.com"
#define WS_PORT 443
#define USE_SECURE_WS true
#define API_BASE_URL "https://api.yourdomain.com/api"

// WiFi Configuration (set per device)
#define WIFI_SSID "YourProductionSSID"
#define WIFI_PASSWORD "YourProductionPassword"

// Device Configuration
#define DEVICE_NAME "Gate Scanner 1"
#define DEVICE_LOCATION "Main Entrance"

// Timing Configuration
#define WIFI_TIMEOUT 30000
#define WS_RECONNECT_INTERVAL 10000
#define HEARTBEAT_INTERVAL 60000
```

### 2. Device Registration

```bash
# Register production devices
cd backend-workers

# Gate Scanner 1
npm run device:register "AA:BB:CC:DD:EE:01" "Gate Scanner 1" "Main Entrance"

# Gate Scanner 2
npm run device:register "AA:BB:CC:DD:EE:02" "Gate Scanner 2" "Exit Gate"

# Queue Management Scanner
npm run device:register "AA:BB:CC:DD:EE:03" "Queue Scanner" "Waiting Area"
```

### 3. Firmware Flashing

```bash
# Compile and flash firmware
cd TagSakay_Fixed_Complete

# Update device-specific configuration
# Edit Config.h with device MAC address and location

# Flash firmware
pio run --target upload

# Monitor serial output
pio device monitor
```

### 4. Device Deployment

**Pre-deployment Checklist:**

- [ ] WiFi credentials configured
- [ ] Device registered in system
- [ ] WebSocket connection tested
- [ ] RFID scanning verified
- [ ] Power supply adequate
- [ ] Physical mounting secure

**Deployment Steps:**

1. Power on device
2. Verify WiFi connection (LED indicator)
3. Check WebSocket connection (serial monitor)
4. Test RFID scanning
5. Verify data appears in dashboard
6. Document device location and MAC address

---

## 🔍 Monitoring & Logging

### 1. Application Monitoring

**Cloudflare Analytics:**

- Workers Analytics (requests, errors, duration)
- Security Events (blocked requests)
- Performance Metrics (P95, P99 latency)

**Custom Logging Setup:**

```typescript
// backend-workers/src/lib/logger.ts
export class ProductionLogger {
  static async log(level: string, message: string, metadata?: any) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
      environment: "production",
    };

    // Send to external logging service
    await fetch("https://logs.yourdomain.com/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logEntry),
    });
  }
}
```

### 2. Health Monitoring

**Health Check Endpoints:**

```bash
# API health
curl https://api.yourdomain.com/health

# Frontend health
curl https://yourdomain.com

# Database connectivity
curl https://api.yourdomain.com/health/db
```

**Monitoring Script:**

```bash
#!/bin/bash
# scripts/health-check.sh

endpoints=(
  "https://yourdomain.com"
  "https://api.yourdomain.com/health"
  "https://api.yourdomain.com/health/db"
)

for endpoint in "${endpoints[@]}"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$endpoint")
  if [ "$status" -eq 200 ]; then
    echo "✅ $endpoint: OK"
  else
    echo "❌ $endpoint: FAILED ($status)"
  fi
done
```

### 3. Uptime Monitoring

**UptimeRobot Configuration:**

```
Monitor 1: yourdomain.com (HTTP/HTTPS)
Monitor 2: api.yourdomain.com/health (HTTP/HTTPS)
Monitor 3: Keyword monitoring for "success":true in API responses

Intervals: 5 minutes
Alerts: Email, SMS, Slack
```

---

## 🔒 Security Hardening

### 1. Cloudflare Security

**WAF Rules:**

```bash
# Block common attacks
(http.request.uri.path contains "/admin" and not ip.src in {your.admin.ip})
(http.request.method eq "POST" and rate(5m) > 100)
(http.user_agent contains "bot" and not cf.verified_bot_category in {"search_engine"})
```

**Rate Limiting:**

```json
{
  "rules": [
    {
      "name": "API Rate Limit",
      "expression": "(http.request.uri.path contains \"/api/\")",
      "action": "challenge",
      "characteristics": ["ip.src"],
      "period": 60,
      "requests_per_period": 100
    },
    {
      "name": "Auth Rate Limit",
      "expression": "(http.request.uri.path contains \"/api/auth/\")",
      "action": "block",
      "characteristics": ["ip.src"],
      "period": 300,
      "requests_per_period": 5
    }
  ]
}
```

### 2. Security Headers

**Cloudflare Page Rules:**

```
yourdomain.com/*
- Security Level: High
- Browser Integrity Check: On
- Always Use HTTPS: On

api.yourdomain.com/*
- Security Level: High
- Browser Integrity Check: On
- Always Use HTTPS: On
```

### 3. Database Security

**Neon Security:**

- [ ] Connection pooling enabled
- [ ] SSL required for all connections
- [ ] IP allowlist configured (if needed)
- [ ] Database user with minimal permissions
- [ ] Regular backups enabled
- [ ] Query logging enabled

---

## 📊 Performance Optimization

### 1. Cloudflare Optimization

**Performance Settings:**

- Caching Level: Standard
- Browser Cache TTL: 4 hours
- Minification: HTML, CSS, JS enabled
- Brotli compression enabled
- HTTP/2 enabled
- HTTP/3 enabled

### 2. Database Optimization

**Neon Configuration:**

```sql
-- Add database indexes
CREATE INDEX idx_rfid_tags_tag_id ON rfid_tags(tag_id);
CREATE INDEX idx_rfid_tags_user_id ON rfid_tags(user_id);
CREATE INDEX idx_scan_history_device_id ON scan_history(device_id);
CREATE INDEX idx_scan_history_scanned_at ON scan_history(scanned_at);

-- Add composite indexes
CREATE INDEX idx_scan_history_device_date ON scan_history(device_id, scanned_at);
CREATE INDEX idx_rfid_tags_status_active ON rfid_tags(status, last_seen) WHERE status = 'active';
```

### 3. Frontend Optimization

**Build Optimization:**

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    minify: "terser",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["vue", "vue-router"],
          ui: ["@headlessui/vue", "heroicons"],
        },
      },
    },
  },
  esbuild: {
    drop: ["console", "debugger"],
  },
});
```

---

## 🔄 Deployment Automation

### 1. GitHub Actions

**`.github/workflows/deploy.yml`:**

```yaml
name: Deploy TagSakay

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test

      - name: Security audit
        run: npm audit --audit-level=high

  deploy-backend:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: backend-workers
          command: deploy --env production

  deploy-frontend:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"
          cache: "npm"

      - name: Install and build
        run: |
          cd frontend
          npm ci
          npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: tagsakay-frontend
          directory: frontend/dist
```

### 2. Deployment Scripts

**`scripts/deploy.sh`:**

```bash
#!/bin/bash
set -e

echo "🚀 Starting TagSakay deployment..."

# Build frontend
echo "📦 Building frontend..."
cd frontend
npm ci
npm run build
cd ..

# Deploy backend
echo "☁️ Deploying backend to Cloudflare Workers..."
cd backend-workers
npm ci
npm run db:migrate
npm run deploy:prod
cd ..

# Deploy frontend
echo "🌐 Deploying frontend to Cloudflare Pages..."
cd frontend
npx wrangler pages deploy dist --project-name=tagsakay-frontend
cd ..

echo "✅ Deployment complete!"
echo "🌐 Frontend: https://yourdomain.com"
echo "🔗 API: https://api.yourdomain.com"
```

---

## 🧪 Production Testing

### 1. Post-Deployment Tests

```bash
#!/bin/bash
# scripts/production-test.sh

BASE_URL="https://api.yourdomain.com"
FRONTEND_URL="https://yourdomain.com"

echo "🧪 Testing production deployment..."

# Test frontend
echo "1. Testing frontend..."
status=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
if [ "$status" -eq 200 ]; then
  echo "✅ Frontend accessible"
else
  echo "❌ Frontend failed ($status)"
  exit 1
fi

# Test API health
echo "2. Testing API health..."
health=$(curl -s "$BASE_URL/health")
if echo "$health" | grep -q '"success":true'; then
  echo "✅ API health check passed"
else
  echo "❌ API health check failed"
  exit 1
fi

# Test authentication
echo "3. Testing authentication..."
auth_response=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tagsakay.local","password":"Admin123!@#"}')

if echo "$auth_response" | grep -q '"success":true'; then
  echo "✅ Authentication working"
else
  echo "❌ Authentication failed"
  exit 1
fi

# Test WebSocket endpoint
echo "4. Testing WebSocket endpoint..."
ws_status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/ws/device")
if [ "$ws_status" -eq 426 ]; then
  echo "✅ WebSocket endpoint responding"
else
  echo "❌ WebSocket endpoint failed ($ws_status)"
  exit 1
fi

echo "✅ All production tests passed!"
```

### 2. Load Testing

```bash
# Install artillery
npm install -g artillery

# Load test configuration
cat > load-test.yml << EOF
config:
  target: 'https://api.yourdomain.com'
  phases:
    - duration: 60
      arrivalRate: 5
    - duration: 120
      arrivalRate: 10
    - duration: 60
      arrivalRate: 20

scenarios:
  - name: 'API Load Test'
    weight: 70
    flow:
      - get:
          url: '/health'
      - post:
          url: '/api/auth/login'
          json:
            email: 'admin@tagsakay.local'
            password: 'Admin123!@#'

  - name: 'Frontend Load Test'
    weight: 30
    flow:
      - get:
          url: 'https://yourdomain.com'
EOF

# Run load test
artillery run load-test.yml
```

---

## 📋 Post-Deployment Checklist

### Immediate Verification (0-1 hour)

- [ ] Frontend loads correctly
- [ ] API health check passes
- [ ] Database connections working
- [ ] Authentication functional
- [ ] WebSocket connections stable
- [ ] SSL certificates valid
- [ ] ESP32 devices connecting
- [ ] RFID scanning operational

### 24 Hour Verification

- [ ] No error spikes in logs
- [ ] Performance metrics normal
- [ ] ESP32 devices stable
- [ ] Database performance good
- [ ] No security alerts
- [ ] Uptime monitoring active
- [ ] Backup systems working

### Weekly Verification

- [ ] Security audit passed
- [ ] Performance optimization review
- [ ] Cost monitoring review
- [ ] User feedback analysis
- [ ] System scaling review
- [ ] Documentation updated

---

## 🆘 Rollback Procedures

### Quick Rollback

```bash
# Rollback backend
cd backend-workers
npx wrangler rollback --env production

# Rollback frontend
cd frontend
npx wrangler pages deployment list --project-name=tagsakay-frontend
npx wrangler pages deployment promote <PREVIOUS_DEPLOYMENT_ID>
```

### Database Rollback

```bash
# Rollback database migration
cd backend-workers
npm run db:rollback

# Restore from backup (if needed)
pg_restore --host=your-neon-host --username=your-user \
  --dbname=your-database backup_file.sql
```

### Emergency Contacts

```
Development Team Lead: your-email@domain.com
Infrastructure Team: infra@domain.com
Emergency Hotline: +1-XXX-XXX-XXXX
Status Page: https://status.yourdomain.com
```

---

**Last Updated:** November 4, 2025  
**Status:** ✅ Complete deployment guide  
**Production Ready:** ✅ All systems configured
