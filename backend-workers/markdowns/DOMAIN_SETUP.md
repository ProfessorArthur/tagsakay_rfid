# TagSakay Domain Implementation Guide

## 🌐 Domain Structure

- **api.tagsakay.com** - Backend API (Cloudflare Workers)
- **app.tagsakay.com** - Frontend Admin Dashboard (Vue.js)
- **tagsakay.com** - Main landing page (future)

---

## 📋 Implementation Checklist

### Part 1: Cloudflare Setup (DNS & Workers)

#### Step 1: Add Domain to Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click **Add a Site**
3. Enter `tagsakay.com`
4. Select the **Free** plan
5. Cloudflare will scan your DNS records
6. Update your domain registrar's nameservers to Cloudflare's (provided after adding site)
7. Wait for DNS propagation (usually 5-30 minutes)

#### Step 2: Configure DNS Records

Go to **DNS > Records** and add:

| Type  | Name | Content          | Proxy Status           | TTL  |
| ----- | ---- | ---------------- | ---------------------- | ---- |
| A     | api  | 192.0.2.1        | Proxied (orange cloud) | Auto |
| CNAME | app  | api.tagsakay.com | Proxied (orange cloud) | Auto |

**Note:** The actual IP doesn't matter when proxied - Cloudflare handles routing to Workers.

#### Step 3: Deploy Backend to Cloudflare Workers

```powershell
# Navigate to backend directory
cd backend-workers

# Deploy to production (this will deploy to api.tagsakay.com)
npm run deploy

# Verify deployment
# You should see: "Published tagsakay-api-production"
# URL: https://api.tagsakay.com
```

#### Step 4: Configure Cloudflare Workers Custom Domain

1. Go to **Workers & Pages** in Cloudflare Dashboard
2. Click on `tagsakay-api-production`
3. Go to **Settings** → **Domains & Routes**
4. Click **Add Custom Domain**
5. Enter: `api.tagsakay.com`
6. Click **Add Custom Domain**
7. Cloudflare will automatically configure SSL/TLS

**Verify Backend:**

```powershell
# Test API endpoint
curl https://api.tagsakay.com/api/health
# Expected: {"success":true,"message":"API is healthy"}
```

#### Step 5: Configure Production Secrets

```powershell
cd backend-workers

# Set production DATABASE_URL (use your Neon production branch)
npx wrangler secret put DATABASE_URL --env production
# Paste your Neon production connection string when prompted

# Set production JWT_SECRET
npx wrangler secret put JWT_SECRET --env production
# Paste your JWT secret when prompted

# Verify secrets are set
npx wrangler secret list --env production
```

---

### Part 2: Frontend Deployment (Cloudflare Pages)

#### Step 1: Build Frontend for Production

```powershell
cd frontend

# Install dependencies (if not already done)
npm install

# Build for production (uses .env.production with api.tagsakay.com)
npm run build

# Verify build output
# You should see a 'dist' folder with built files
```

#### Step 2: Deploy to Cloudflare Pages

**Option A: Cloudflare Pages Dashboard (Recommended for first deployment)**

1. Go to **Workers & Pages** → **Create Application** → **Pages**
2. Click **Connect to Git** (or **Direct Upload** for manual)
3. If using Git:
   - Select your GitHub repository
   - Configure build settings:
     - **Framework preset:** Vue
     - **Build command:** `npm run build`
     - **Build output directory:** `dist`
     - **Root directory:** `frontend`
   - Add environment variable:
     - `VITE_API_URL` = `https://api.tagsakay.com/api`
4. Click **Save and Deploy**
5. After deployment, go to **Custom Domains**
6. Click **Set up a custom domain**
7. Enter: `app.tagsakay.com`
8. Cloudflare will configure DNS automatically

**Option B: Wrangler CLI (For subsequent deployments)**

```powershell
cd frontend

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=tagsakay-frontend

# Set custom domain (first time only)
# Go to dashboard and add app.tagsakay.com as shown above
```

**Verify Frontend:**

- Open browser: https://app.tagsakay.com
- You should see the TagSakay login page
- Try logging in to verify API connection

---

### Part 3: ESP32 Device Configuration

#### Step 1: Update ESP32 Firmware

The ESP32 firmware is already configured for production in `Config.h`:

- `WS_HOST` = `api.tagsakay.com`
- `API_BASE_URL` = `https://api.tagsakay.com`
- `USE_SECURE_WS` = `true` (enables WSS)

**For Development/Testing:** If you need to test locally first, uncomment the development section in `Config.h`:

```cpp
// Comment out production configuration and uncomment these:
#define WS_HOST "192.168.1.100"  // Your local dev machine IP
#define WS_PORT 8787
#define USE_SECURE_WS false
#define API_BASE_URL "http://192.168.1.100:8787"
```

#### Step 2: Compile and Flash ESP32

```
1. Open Arduino IDE
2. Open TagSakay_Fixed_Complete.ino
3. Verify Config.h has production settings
4. Click Sketch → Verify/Compile
5. Connect ESP32 via USB
6. Select correct COM port
7. Click Upload
8. Open Serial Monitor (115200 baud)
9. Watch for successful connection to api.tagsakay.com
```

#### Step 3: Register Device in Backend

```powershell
# From backend-workers directory
npm run device:register <MAC_ADDRESS> "Device Name" "Location"

# Example:
npm run device:register AA:BB:CC:DD:EE:FF "Gate 1 Scanner" "Main Entrance"

# This will output an API key - note it down (can't be retrieved later)
```

#### Step 4: Configure Device API Key

**Option A: Via Serial Monitor**

```
1. Open Serial Monitor
2. Type: config_apikey YOUR_API_KEY_HERE
3. Press Enter
4. ESP32 will save to EEPROM and restart
```

**Option B: Hardcode in Config.h (not recommended for production)**

```cpp
#define API_KEY "dev_YOUR_API_KEY_HERE"
```

---

### Part 4: SSL/TLS Configuration (Automatic)

Cloudflare automatically provides SSL certificates for:

- ✅ api.tagsakay.com
- ✅ app.tagsakay.com
- ✅ tagsakay.com

**Verify SSL Settings:**

1. Go to **SSL/TLS** in Cloudflare Dashboard
2. Set encryption mode to: **Full (strict)** ← Recommended
3. Enable **Always Use HTTPS**
4. Enable **HTTP Strict Transport Security (HSTS)** (optional but recommended)

**Test SSL:**

```powershell
# Test HTTPS endpoint
curl https://api.tagsakay.com/api/health

# Test WebSocket Secure connection
# Your ESP32 will automatically connect via WSS
```

---

## 🧪 Testing & Verification

### Backend API Tests

```powershell
cd backend-workers

# Test health endpoint
npm run test:api

# Test authentication
npm run test:api login

# Test device endpoints
npm run test:api scanRfid '{"tagId":"TEST123","deviceId":"AABBCCDDEEFF"}'
```

### Frontend Tests

1. Open https://app.tagsakay.com
2. Login with admin credentials
3. Navigate to Dashboard
4. Check Live Scans section
5. Verify WebSocket connection status (should show "Connected")

### ESP32 Tests

1. Power on ESP32 device
2. Watch Serial Monitor output
3. Verify:
   - ✅ WiFi connected
   - ✅ WebSocket connected to api.tagsakay.com
   - ✅ Device authenticated
   - ✅ RFID scanner initialized
4. Scan an RFID tag
5. Check frontend dashboard - scan should appear in real-time

---

## 🔧 Troubleshooting

### Backend Issues

**Problem: 404 Not Found on api.tagsakay.com**

- Check DNS propagation: `nslookup api.tagsakay.com`
- Verify custom domain in Workers dashboard
- Wait 5-10 minutes for DNS changes

**Problem: 500 Internal Server Error**

- Check production secrets are set: `npx wrangler secret list --env production`
- Check Worker logs: Cloudflare Dashboard → Workers → Logs
- Verify DATABASE_URL is correct (Neon production branch)

**Problem: CORS errors from frontend**

- Check `src/index.ts` CORS configuration
- Verify `app.tagsakay.com` is in allowed origins

### Frontend Issues

**Problem: Cannot connect to API**

- Check `.env.production` has correct URL: `https://api.tagsakay.com/api`
- Rebuild frontend: `npm run build`
- Redeploy to Cloudflare Pages
- Check browser console for errors

**Problem: Blank page after deployment**

- Check build output in Cloudflare Pages logs
- Verify build command and output directory are correct
- Check browser console for JavaScript errors

### ESP32 Issues

**Problem: Cannot connect to WebSocket**

- Verify `Config.h` has correct domain: `api.tagsakay.com`
- Verify `USE_SECURE_WS` is `true`
- Check Serial Monitor for connection errors
- Verify device has internet access
- Check if firewall blocks port 443

**Problem: HTTPS certificate verification failed**

- ESP32 needs root CA certificate for SSL
- Add this to your code before WiFiClientSecure connection:

```cpp
client.setInsecure(); // For testing only - skips certificate validation
// OR properly implement certificate pinning for production
```

**Problem: Device not authenticated**

- Verify API key is correctly configured
- Check device is registered in backend: `npm run device:list`
- Verify API key format starts with `dev_` or `prod_`

---

## 📊 Monitoring & Maintenance

### Cloudflare Analytics

- **Workers Analytics:** Dashboard → Workers → Analytics

  - Monitor request count, error rate, response time
  - Check for 4xx/5xx errors

- **Pages Analytics:** Dashboard → Pages → Analytics
  - Monitor page views, bandwidth usage
  - Check build/deployment history

### Database Monitoring

- **Neon Console:** https://console.neon.tech/
  - Monitor connection count
  - Check query performance
  - Review storage usage
  - Set up alerts for high usage

### Application Health

```powershell
# Check backend health
curl https://api.tagsakay.com/api/health

# Check database connectivity
curl https://api.tagsakay.com/api/devices -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Monitor ESP32 devices
# Frontend dashboard → Devices → Status (green = online, red = offline)
```

---

## 🔐 Security Best Practices

1. **Keep Secrets Secret:**

   - Never commit `.dev.vars` or `.env.production` to git
   - Rotate JWT_SECRET regularly (every 90 days)
   - Use unique API keys per device

2. **Rate Limiting:**

   - Backend has built-in OWASP-compliant rate limiting
   - Authentication: 5 requests/minute
   - API: 100 requests/minute
   - Device registration: 3 requests/hour

3. **SSL/TLS:**

   - Always use HTTPS in production
   - Enable HSTS in Cloudflare
   - Keep encryption mode on "Full (strict)"

4. **Database Security:**

   - Use Neon's connection pooling
   - Enable IP allowlist in Neon (optional)
   - Regular backups (Neon does this automatically)

5. **Device Security:**
   - API keys are hashed (SHA256) in database
   - Implement certificate pinning for ESP32 in production
   - Monitor device activity for anomalies

---

## 📚 Additional Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Neon Database Docs](https://neon.tech/docs/introduction)
- [Vue.js Deployment Guide](https://vuejs.org/guide/best-practices/production-deployment.html)
- [ESP32 HTTPS Guide](https://randomnerdtutorials.com/esp32-https-requests/)

---

## 🎉 Success Criteria

You'll know everything is working when:

- ✅ https://api.tagsakay.com/api/health returns `{"success":true}`
- ✅ https://app.tagsakay.com loads the admin dashboard
- ✅ ESP32 connects via WSS to api.tagsakay.com
- ✅ RFID scans appear in real-time on frontend dashboard
- ✅ No errors in Serial Monitor, browser console, or Worker logs
- ✅ Device registration and tag scanning work end-to-end

---

**Last Updated:** November 3, 2025
**Domain:** tagsakay.com
**Status:** Ready for Production Deployment 🚀
