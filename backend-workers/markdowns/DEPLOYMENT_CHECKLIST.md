# 🚀 Domain Implementation Deployment Checklist

Use this checklist to track your deployment progress step-by-step.

---

## ✅ Pre-Deployment (Configuration) - COMPLETE

- [x] Backend wrangler.toml configured for api.tagsakay.com
- [x] Backend CORS updated with all subdomains
- [x] Frontend .env.production created
- [x] ESP32 Config.h updated for production URLs
- [x] Documentation created (7 comprehensive guides)

---

## 🌐 Step 1: Cloudflare Account Setup

### Add Domain to Cloudflare

- [ ] Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
- [ ] Click "Add a Site" → Enter `tagsakay.com`
- [ ] Select **Free** plan
- [ ] Wait for DNS scan to complete

### Update Nameservers

- [ ] Copy Cloudflare nameservers (e.g., `ns1.cloudflare.com`, `ns2.cloudflare.com`)
- [ ] Log in to your domain registrar
- [ ] Find DNS/Nameserver settings
- [ ] Replace existing nameservers with Cloudflare's
- [ ] Save changes
- [ ] Wait 5-30 minutes for propagation
- [ ] Verify: Cloudflare shows "Active" status

### Configure DNS Records

- [ ] Go to **DNS > Records** in Cloudflare
- [ ] Add A record:
  - Type: `A`
  - Name: `api`
  - Content: `192.0.2.1` (placeholder IP)
  - Proxy status: **Proxied** (orange cloud)
  - TTL: Auto
  - Click **Save**
- [ ] Add CNAME record:
  - Type: `CNAME`
  - Name: `app`
  - Target: `api.tagsakay.com`
  - Proxy status: **Proxied** (orange cloud)
  - TTL: Auto
  - Click **Save**

### Verify DNS

```powershell
# Check if DNS is resolving
nslookup api.tagsakay.com
nslookup app.tagsakay.com

# Both should return Cloudflare IPs (104.xxx.xxx.xxx range)
```

- [ ] api.tagsakay.com resolves to Cloudflare IP
- [ ] app.tagsakay.com resolves to Cloudflare IP

---

## ⚙️ Step 2: Backend Deployment

### Prepare Secrets

- [ ] Open Neon Console and copy **production** branch DATABASE_URL
- [ ] Have your JWT_SECRET ready (from .dev.vars or generate new)

### Deploy Backend

```powershell
cd backend-workers
```

- [ ] Run: `npm run deploy`
- [ ] Wait for deployment to complete
- [ ] Note the Worker URL (e.g., `tagsakay-api-production.workers.dev`)

### Set Production Secrets

```powershell
# Set DATABASE_URL
npx wrangler secret put DATABASE_URL --env production
# Paste your Neon production connection string when prompted
```

- [ ] DATABASE_URL secret set successfully

```powershell
# Set JWT_SECRET
npx wrangler secret put JWT_SECRET --env production
# Paste your JWT secret when prompted
```

- [ ] JWT_SECRET secret set successfully

### Verify Secrets

```powershell
npx wrangler secret list --env production
```

- [ ] Both secrets show in list

### Configure Custom Domain

- [ ] Go to Cloudflare Dashboard → **Workers & Pages**
- [ ] Click on `tagsakay-api-production`
- [ ] Go to **Settings** → **Domains & Routes**
- [ ] Click **Add Custom Domain**
- [ ] Enter: `api.tagsakay.com`
- [ ] Click **Add Custom Domain**
- [ ] Wait for SSL certificate provisioning (1-2 minutes)
- [ ] Status shows **Active** with green checkmark

### Test Backend

```powershell
# Test health endpoint
curl https://api.tagsakay.com/health

# Expected output:
# {"success":true,"message":"API is healthy"}
```

- [ ] Backend health check returns success
- [ ] No SSL certificate errors
- [ ] Response time < 2 seconds

---

## 🎨 Step 3: Frontend Deployment

### Build Frontend

```powershell
cd frontend
```

- [ ] Verify `.env.production` has: `VITE_API_URL=https://api.tagsakay.com/api`
- [ ] Run: `npm install` (if not already done)
- [ ] Run: `npm run build`
- [ ] Verify `dist` folder created
- [ ] Check for build errors (should be none)

### Deploy to Cloudflare Pages

#### Option A: Dashboard (Recommended for First Deploy)

- [ ] Go to **Workers & Pages** → **Create Application**
- [ ] Click **Pages** → **Connect to Git**
- [ ] Select your GitHub repository
- [ ] Configure build settings:
  - Framework preset: `Vue`
  - Build command: `npm run build`
  - Build output directory: `dist`
  - Root directory: `frontend` (if monorepo)
- [ ] Add environment variable:
  - Key: `VITE_API_URL`
  - Value: `https://api.tagsakay.com/api`
- [ ] Click **Save and Deploy**
- [ ] Wait for build and deployment (2-5 minutes)

#### Option B: CLI (For Subsequent Deploys)

```powershell
npx wrangler pages deploy dist --project-name=tagsakay-frontend
```

- [ ] Deployment completed successfully

### Configure Custom Domain

- [ ] In Cloudflare Pages dashboard, click your project
- [ ] Go to **Custom Domains**
- [ ] Click **Set up a custom domain**
- [ ] Enter: `app.tagsakay.com`
- [ ] Click **Continue**
- [ ] DNS record added automatically
- [ ] Wait for SSL certificate (1-2 minutes)
- [ ] Status shows **Active**

### Test Frontend

```
Browser: https://app.tagsakay.com
```

- [ ] Page loads without errors
- [ ] Login form is visible
- [ ] No CORS errors in browser console (F12)
- [ ] CSS/styling loads correctly
- [ ] Can click elements (not frozen/broken)

### Test Frontend-Backend Connection

- [ ] Attempt login with test credentials
- [ ] Login succeeds (redirects to dashboard)
- [ ] Dashboard loads without errors
- [ ] Check WebSocket status (should show "Connected")
- [ ] No authentication errors in console

---

## 📱 Step 4: ESP32 Device Setup

### Register First Device

```powershell
cd backend-workers

# Get device MAC address first (from Serial Monitor or device label)
# Format: XX:XX:XX:XX:XX:XX

npm run device:register AA:BB:CC:DD:EE:FF "Main Gate Scanner" "Main Entrance"

# IMPORTANT: Copy the API key displayed (starts with "dev_")
# Example output: dev_abc123xyz456def789...
# You CANNOT retrieve this later!
```

- [ ] Device registered successfully
- [ ] API key copied and saved safely
- [ ] Device appears in dashboard: https://app.tagsakay.com/devices

### Configure ESP32 Firmware

Open `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino` in Arduino IDE:

**Lines 21-22: WiFi Credentials**

```cpp
WiFiConfig wifiConfig = {
  "YourWiFiNetworkName",    // ← UPDATE THIS
  "YourWiFiPassword123",    // ← UPDATE THIS
  10,
  5000
};
```

- [ ] WiFi SSID updated
- [ ] WiFi password updated

**Line 30: API Key**

```cpp
ServerConfig serverConfig = {
  "http://192.168.1.73:8787",
  "dev_YOUR_API_KEY_HERE",  // ← PASTE API KEY HERE
  10000,
  "Main Entrance"           // ← UPDATE LOCATION
};
```

- [ ] API key pasted
- [ ] Location name updated

**Verify Config.h (should already be correct):**

```cpp
#define WS_HOST "api.tagsakay.com"       // ✅ Should be set
#define WS_PORT 443                       // ✅ Should be set
#define USE_SECURE_WS true                // ✅ Should be set
#define API_BASE_URL "https://api.tagsakay.com"  // ✅ Should be set
```

- [ ] Config.h has production values (no changes needed)

### Compile Firmware

- [ ] Arduino IDE → Tools → Board: **ESP32 Dev Module**
- [ ] Tools → Partition Scheme: **Minimal SPIFFS (1.9MB APP / 190KB SPIFFS)**
- [ ] Tools → Upload Speed: **921600** (or 115200 if fails)
- [ ] Sketch → Verify/Compile
- [ ] Compilation succeeds
- [ ] Flash usage ~64% (1,261,555 bytes)
- [ ] No errors or warnings

### Flash Device

- [ ] Connect ESP32 via USB
- [ ] Tools → Port: Select correct COM port
- [ ] Sketch → Upload
- [ ] Wait for upload to complete (1-2 minutes)
- [ ] "Done uploading" message appears

### Verify Device Connection

- [ ] Open Serial Monitor (115200 baud)
- [ ] Press ESP32 reset button
- [ ] Watch boot sequence

**Expected Serial Output:**

```
[✓] WiFi connected to YourNetworkName
[✓] IP Address: 192.168.1.XXX
[✓] Connecting to: wss://api.tagsakay.com:443/ws/device
[✓] WebSocket connected
[✓] Device authenticated
[✓] RFID scanner initialized
System Ready - Scan RFID tag
```

- [ ] WiFi connects successfully
- [ ] WebSocket connects to api.tagsakay.com
- [ ] Device authenticates with API key
- [ ] RFID scanner initializes
- [ ] No errors in serial output

### Check Device Status in Dashboard

```
Browser: https://app.tagsakay.com/devices
```

- [ ] Device appears in device list
- [ ] Status shows **Online** (green indicator)
- [ ] Last heartbeat timestamp is recent
- [ ] Device name and location correct

---

## 🧪 Step 5: End-to-End Testing

### Test RFID Scanning

- [ ] Have an RFID tag ready
- [ ] Place tag near ESP32 scanner
- [ ] Serial Monitor shows: "Tag scanned: XXXXX"
- [ ] Tag appears in dashboard live scans (within 2 seconds)
- [ ] Scan shows correct timestamp
- [ ] Scan shows correct device name

### Test Registration Mode (Optional)

- [ ] Press `###` on keypad (within 3 seconds)
- [ ] Display shows "REG MODE ACTIVE"
- [ ] Scan an unregistered tag
- [ ] Serial Monitor shows "Registering tag..."
- [ ] Dashboard shows new registered tag
- [ ] Mode auto-exits after success

### Test Dashboard Features

- [ ] Live Scans updates in real-time
- [ ] Can filter/search scans
- [ ] Device management works
- [ ] User management accessible (if SuperAdmin)
- [ ] WebSocket maintains connection

### Load Testing (Optional)

- [ ] Scan multiple tags rapidly (10-20 scans)
- [ ] All scans appear on dashboard
- [ ] No lag or missed scans
- [ ] Backend remains responsive
- [ ] Database handles load

---

## 🔒 Step 6: Security Verification

### SSL/TLS Configuration

- [ ] Go to Cloudflare → **SSL/TLS**
- [ ] Encryption mode: Set to **Full (strict)**
- [ ] **Always Use HTTPS**: Enabled
- [ ] HTTP Strict Transport Security (HSTS): Enable after confirming everything works
- [ ] Minimum TLS Version: **TLS 1.2** or higher

### Test SSL

```powershell
# Test SSL certificate
curl -I https://api.tagsakay.com

# Should see: "HTTP/2 200" and SSL cert info
```

- [ ] SSL certificate valid
- [ ] HTTPS redirects work
- [ ] No mixed content warnings

### Security Headers

- [ ] Check response headers include:
  - `Strict-Transport-Security`
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Content-Security-Policy`

### Rate Limiting Test

```powershell
# Try logging in 6 times with wrong password
# Should be rate limited after 5th attempt
```

- [ ] Rate limiting activates after 5 failed attempts
- [ ] Returns 429 status code
- [ ] Shows "retryAfter" message

---

## 📊 Step 7: Monitoring Setup

### Cloudflare Analytics

- [ ] Workers → Analytics enabled
- [ ] Pages → Analytics enabled
- [ ] Review default metrics

### Application Monitoring

- [ ] Set up uptime monitoring (optional: UptimeRobot, Pingdom)
- [ ] Monitor URLs:
  - `https://api.tagsakay.com/health`
  - `https://app.tagsakay.com`

### Database Monitoring

- [ ] Neon Console → Check connection pool usage
- [ ] Set up alerts for high CPU/memory (optional)
- [ ] Verify backup schedule

---

## 📝 Step 8: Documentation & Handoff

### Update Repository

- [ ] Commit all configuration changes
- [ ] Push to GitHub
- [ ] Update README.md with production URLs
- [ ] Document any custom configurations

### Create Operations Manual

- [ ] Document device registration process
- [ ] Document user management
- [ ] Document troubleshooting steps
- [ ] Create runbook for common issues

### Backup Critical Information

- [ ] Save production DATABASE_URL (encrypted)
- [ ] Save JWT_SECRET (encrypted)
- [ ] Save device API keys spreadsheet
- [ ] Save Cloudflare account credentials
- [ ] Save domain registrar access

---

## 🎉 Completion Checklist

### All Systems Operational

- [ ] Backend API responds: `https://api.tagsakay.com/health`
- [ ] Frontend loads: `https://app.tagsakay.com`
- [ ] ESP32 devices connect and authenticate
- [ ] RFID scans appear in real-time
- [ ] WebSocket connections stable
- [ ] SSL/TLS certificates valid
- [ ] Rate limiting functional
- [ ] Database performing well

### Documentation Complete

- [ ] All deployment steps documented
- [ ] Troubleshooting guide available
- [ ] Team trained on system usage
- [ ] Backup procedures documented

### Production Ready

- [ ] All tests passing
- [ ] No critical errors in logs
- [ ] Performance acceptable
- [ ] Security verified
- [ ] Monitoring in place
- [ ] Support plan established

---

## 🆘 Troubleshooting Quick Links

**Issue:** Backend 404
→ See `DOMAIN_SETUP.md` Section: "Backend Issues"

**Issue:** Frontend blank page
→ See `DOMAIN_SETUP.md` Section: "Frontend Issues"

**Issue:** ESP32 won't connect
→ See `ESP32_CONFIGURATION.md` Section: "Testing After Flash"

**Issue:** WebSocket disconnects
→ Check device API key, verify network stability

**Issue:** CORS errors
→ Verify frontend domain in backend CORS config

---

## 📞 Support Resources

- **Documentation:** All `.md` files in project root
- **Cloudflare Support:** https://support.cloudflare.com/
- **Neon Support:** https://neon.tech/docs/introduction
- **ESP32 Community:** https://esp32.com/

---

**Deployment Status:** Track progress above  
**Target Completion:** Estimate 2-4 hours for full deployment  
**Last Updated:** November 3, 2025  
**Domain:** tagsakay.com 🚀
