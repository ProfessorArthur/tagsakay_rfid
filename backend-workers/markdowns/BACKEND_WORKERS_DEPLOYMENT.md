# 🚀 Cloudflare Workers Backend Deployment Guide

Complete guide to deploying TagSakay backend (Hono + Drizzle) to Cloudflare Workers.

---

## 📋 Deployment Summary

**Status:** ✅ **DEPLOYED**

### Production Deployment Details

| Component      | URL                                                     | Status       |
| -------------- | ------------------------------------------------------- | ------------ |
| Backend        | https://tagsakay-api-production.maskedmyles.workers.dev | ✅ Active    |
| Database       | Neon PostgreSQL (ap-southeast-1)                        | ✅ Connected |
| Authentication | JWT (PBKDF2-SHA256)                                     | ✅ Active    |
| Rate Limiting  | Tiered system (5/min, 100/min, 3/hr)                    | ✅ Active    |

---

## 🛠️ Architecture

### Backend Stack

- **Framework:** Hono 4.10.4 (lightweight, fast)
- **Database:** Neon PostgreSQL (serverless)
- **ORM:** Drizzle 0.44.7 (TypeScript-first)
- **Authentication:** JWT with Jose library
- **Hosting:** Cloudflare Workers
- **Runtime:** Node.js compatible

### Database Connection

```
Provider: Neon
Region: ap-southeast-1 (Singapore)
Connection Pool: Built-in
SSL: Enabled (sslmode=require)
Channel Binding: Enabled
```

---

## 📝 Pre-Deployment Requirements

### 1. Cloudflare Account

- Free or paid tier (Durable Objects require paid tier)
- Wrangler CLI installed globally

### 2. Neon PostgreSQL Account

- Database created and configured
- Connection string available

### 3. Environment Configuration

- `.dev.vars` file with secrets (development)
- `wrangler.toml` configured
- Secrets pushed to Cloudflare (production)

---

## 🚀 Deployment Steps

### Step 1: Install Dependencies

```bash
cd backend-workers
npm install
```

### Step 2: Configure Environment Variables

**Development (.dev.vars):**

```bash
DATABASE_URL=postgresql://user:password@endpoint.neon.tech/database?sslmode=require&channel_binding=require
JWT_SECRET=your-secret-key
NODE_ENV=development
```

**Production (Secrets):**

```bash
# Set secrets using Wrangler CLI
wrangler secret put DATABASE_URL --env production
# Paste: postgresql://user:password@endpoint.neon.tech/database?...

wrangler secret put JWT_SECRET --env production
# Paste: your-production-secret-key
```

### Step 3: Run Database Migrations

```bash
# This runs schema migrations against your Neon database
npm run db:migrate

# Seed data (optional)
npm run seed
```

**Note:** Schema is idempotent - safe to run multiple times. Already-existing tables will be skipped.

### Step 4: Test Locally

```bash
# Start development server (port 8787)
npm run dev

# In browser or terminal:
curl http://localhost:8787/api/health
```

### Step 5: Deploy to Production

```bash
# Deploy to Cloudflare Workers (production environment)
npm run deploy -- --env production

# Or explicitly:
wrangler deploy --env production
```

**Expected Output:**

```
Uploaded tagsakay-api-production
https://tagsakay-api-production.maskedmyles.workers.dev
Current Version ID: [VERSION_ID]
```

---

## 🔐 Security Configuration

### JWT Secrets

**Generate secure JWT secret:**

```bash
# PowerShell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

# Or use OpenSSL
openssl rand -base64 32
```

**Set in production:**

```bash
wrangler secret put JWT_SECRET --env production
```

### Database Security

- ✅ SSL/TLS enabled (sslmode=require)
- ✅ Channel binding enabled (additional protection)
- ✅ Connection pooling via Neon
- ✅ Credentials stored as Wrangler secrets (never in code)

### API Security Headers

Backend includes:

- ✅ CORS configured
- ✅ Rate limiting (5 req/min auth, 100 req/min API, 3 req/hr device)
- ✅ Password hashing (PBKDF2-SHA256, 600k iterations)
- ✅ Account lockout (5 failed attempts → 15 min lock)
- ✅ Security logging (15 event types, 4 severity levels)

---

## 📊 API Endpoints (Production)

Base URL: `https://tagsakay-api-production.maskedmyles.workers.dev`

### Authentication

```
POST   /api/auth/register           - Register new user
POST   /api/auth/login              - Login (returns JWT)
POST   /api/auth/refresh            - Refresh token (if implemented)
POST   /api/auth/logout             - Logout (optional)
```

### Users

```
GET    /api/users                   - List all users (admin)
GET    /api/users/:id               - Get user details
POST   /api/users                   - Create user (admin)
PUT    /api/users/:id               - Update user (admin)
DELETE /api/users/:id               - Delete user (admin)
```

### RFID Tags

```
GET    /api/rfid                    - List all RFID cards
GET    /api/rfid/:id                - Get RFID card details
POST   /api/rfid/register           - Register new tag
PUT    /api/rfid/:id/status         - Update tag status
POST   /api/rfid/scans              - Log scan event
GET    /api/rfid/scans/unregistered - Get unregistered scans
```

### Devices

```
GET    /api/devices                 - List all devices
POST   /api/devices/register        - Register new device
PUT    /api/devices/:id/status      - Update device status
POST   /api/devices/:id/heartbeat   - Device heartbeat
```

### API Keys

```
GET    /api/keys                    - List API keys
POST   /api/keys                    - Create API key
PUT    /api/keys/:id                - Update API key
DELETE /api/keys/:id                - Delete API key
```

---

## 🧪 Testing Production Deployment

### Test Authentication

```bash
# Register user
curl -X POST https://tagsakay-api-production.maskedmyles.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "SecurePass123!@#"
  }'

# Login
curl -X POST https://tagsakay-api-production.maskedmyles.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!@#"
  }'

# Response: { "success": true, "data": { "token": "eyJ..." } }
```

### Test RFID Registration

```bash
# Register RFID tag
curl -X POST https://tagsakay-api-production.maskedmyles.workers.dev/api/rfid/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "tagId": "ABC12345",
    "userId": 1
  }'
```

### Check Rate Limiting

```bash
# Rapid requests to trigger rate limiting
for i in {1..10}; do
  curl -X POST https://tagsakay-api-production.maskedmyles.workers.dev/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done

# After 5 failed attempts: 429 Too Many Requests
```

---

## 🔄 Continuous Deployment

### GitHub Actions Integration (Optional)

**File: `.github/workflows/deploy-backend.yml`**

```yaml
name: Deploy Backend to Cloudflare Workers

on:
  push:
    branches:
      - main
    paths:
      - "backend-workers/**"
      - ".github/workflows/deploy-backend.yml"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"
          cache: "npm"
          cache-dependency-path: backend-workers/package-lock.json

      - name: Install dependencies
        working-directory: backend-workers
        run: npm ci

      - name: Build
        working-directory: backend-workers
        run: npm run build || true

      - name: Deploy
        working-directory: backend-workers
        run: wrangler deploy --env production
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### Setup Secrets in GitHub

1. Go to Repository → Settings → Secrets and variables → Actions
2. Add:
   - `CLOUDFLARE_API_TOKEN` (from https://dash.cloudflare.com/profile/api-tokens)
   - `CLOUDFLARE_ACCOUNT_ID` (from Cloudflare dashboard)

---

## 🚨 Troubleshooting

### Issue: "Durable Objects require paid plan"

**Cause:** Using free tier account with Durable Objects enabled

**Solution:**

- Remove Durable Objects from production config (already done)
- Use alternative WebSocket approach
- Upgrade to Cloudflare Workers paid plan if needed

### Issue: "Route not found" on health check

**Cause:** No `/api/health` endpoint implemented

**Solution:** Test with actual endpoints like `/api/auth/login` or `/api/users`

### Issue: "Invalid email or password" on login

**Cause:** Test credentials not registered in database

**Solution:**

1. First register a user
2. Then login with those credentials
3. Or seed test data: `npm run seed`

### Issue: Database connection timeout

**Cause:** Neon connection string incorrect or database offline

**Solution:**

1. Verify connection string in `.dev.vars` (development) or Wrangler secrets (production)
2. Check Neon dashboard for database status
3. Ensure IP whitelisting not blocking connection

### Issue: "Cannot find module" errors

**Cause:** Dependencies not installed

**Solution:**

```bash
cd backend-workers
npm install
npm run dev
```

### Issue: TypeScript compilation errors

**Cause:** Version mismatch or missing types

**Solution:**

```bash
npm install --save-dev @types/node @cloudflare/workers-types
npm run build
```

---

## 📈 Monitoring & Logs

### View Deployment Logs

```bash
# Real-time logs
wrangler tail --env production

# View deployment history
wrangler deployments list --env production

# Get deployment details
wrangler deployments info [VERSION_ID] --env production
```

### Health Checks

```bash
# Check if worker is responding
curl -I https://tagsakay-api-production.maskedmyles.workers.dev/

# Check status code
curl -o /dev/null -s -w "%{http_code}\n" \
  https://tagsakay-api-production.maskedmyles.workers.dev/api/auth/login
```

### Performance Metrics

Monitor via Cloudflare Dashboard:

- Workers → tagsakay-api-production → Analytics
- View CPU time, request count, error rates

---

## 🔄 Updates & Rollback

### Deploy Updates

```bash
# Make code changes
# Update version in package.json if needed

# Deploy to production
npm run deploy -- --env production
```

### Rollback to Previous Version

```bash
# View deployments
wrangler deployments list --env production

# Rollback to specific version
wrangler rollback [VERSION_ID] --env production
```

---

## 🌐 Custom Domain Setup

### Connect api.tagsakay.com

1. **In Cloudflare Dashboard:**

   - Go to Workers → tagsakay-api-production
   - Settings → Custom domains
   - Click "Add custom domain"
   - Enter: `api.tagsakay.com`

2. **DNS Configuration:**

   - Cloudflare automatically manages DNS
   - Points to tagsakay-api-production.maskedmyles.workers.dev

3. **SSL/TLS:**
   - Automatic SSL certificate issued
   - Available within minutes

### Update Frontend API URL

```bash
# .env.production
VITE_API_URL=https://api.tagsakay.com

# Or use workers.dev during development
VITE_API_URL=https://tagsakay-api-production.maskedmyles.workers.dev
```

---

## 📚 Useful Commands

```bash
# Development
npm run dev              # Start local server (port 8787)
npm run build            # Build TypeScript
npm run type-check       # Check TypeScript types

# Database
npm run db:generate      # Generate migrations from schema
npm run db:migrate       # Run migrations
npm run db:push          # Push schema directly (dev only)
npm run db:studio        # Open Drizzle Studio

# Testing & Validation
npm run test:api         # Test API endpoints
npm run test:auth        # Test authentication
npm run test:rate-limit  # Test rate limiting

# Deployment
npm run deploy           # Deploy to production (default env)
npm run deploy -- --env production  # Explicit production
npm run deploy -- --env staging     # Deploy to staging

# Wrangler (direct CLI)
wrangler dev             # Dev server
wrangler deploy          # Deploy
wrangler secret list     # List secrets
wrangler deployments list  # View deployment history
wrangler tail            # Stream logs
```

---

## 🎯 Production Checklist

- [x] Database connected and schema migrated
- [x] Environment variables set in Wrangler secrets
- [x] JWT secret configured
- [x] Rate limiting enabled
- [x] Password hashing configured (PBKDF2)
- [x] Security headers configured
- [x] Backend deployed to production
- [x] API endpoints responding correctly
- [x] Authentication working
- [x] Database queries working
- [ ] Custom domain configured (api.tagsakay.com)
- [ ] Frontend connected to production API
- [ ] Health checks and monitoring setup
- [ ] Error tracking configured
- [ ] Logs monitoring enabled

---

## 🔗 Useful Links

- **Cloudflare Workers Docs:** https://developers.cloudflare.com/workers/
- **Hono Framework:** https://hono.dev/
- **Drizzle ORM:** https://orm.drizzle.team/
- **Neon Database:** https://neon.tech/
- **Wrangler CLI:** https://developers.cloudflare.com/workers/wrangler/install-and-update/

---

## 📞 Support & Debugging

### Enable Debug Logging

```bash
# Verbose logging
wrangler dev --log-level debug

# Check environment variables are set
wrangler secret list --env production
```

### Common Issues Checklist

- [ ] Is Neon database accessible from Cloudflare Workers?
- [ ] Are DATABASE_URL and JWT_SECRET set in production?
- [ ] Is the schema migrated to the database?
- [ ] Are rate limit configurations correct?
- [ ] Are CORS headers properly configured?
- [ ] Is the frontend using correct API URL?

---

## ✅ Deployment Complete!

Your TagSakay backend is now live and production-ready:

✨ **Production URL:** https://tagsakay-api-production.maskedmyles.workers.dev
🗄️ **Database:** Neon PostgreSQL (ap-southeast-1)
🔐 **Security:** PBKDF2-SHA256 + JWT + Rate Limiting
⚡ **Performance:** Cloudflare global CDN
📊 **Monitoring:** Real-time logs via Wrangler

Next steps:

1. Connect custom domain (optional)
2. Update frontend API URL to production
3. Set up monitoring and alerting
4. Create monitoring dashboard

Happy deploying! 🚀
