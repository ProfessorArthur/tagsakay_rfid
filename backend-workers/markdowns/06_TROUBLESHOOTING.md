# 🛠️ TagSakay Troubleshooting & Support Guide

Complete troubleshooting guide, common issues, debugging procedures, and support resources for the TagSakay RFID system.

---

## 🚨 Quick Issue Resolution

### Emergency Checklist

**System Down?**

1. Check [status page](https://status.yourdomain.com)
2. Verify [health endpoints](#health-check-endpoints)
3. Check [Cloudflare status](https://cloudflarestatus.com)
4. Review [monitoring dashboards](#monitoring-tools)

**Can't Login?**

1. Clear browser cache/cookies
2. Check if account is locked (rate limiting)
3. Verify credentials with password reset
4. Check [authentication status](#authentication-issues)

**ESP32 Not Connecting?**

1. Check WiFi credentials and signal strength
2. Verify device registration in system
3. Check WebSocket endpoint availability
4. Review [device logs](#esp32-debugging)

---

## 🔍 Diagnostic Tools

### Health Check Endpoints

```bash
# API Health Check
curl https://api.yourdomain.com/health
# Expected: {"success":true,"status":"healthy","timestamp":"..."}

# Database Connectivity
curl https://api.yourdomain.com/health/db
# Expected: {"success":true,"database":"connected","latency":"<50ms"}

# Frontend Health
curl https://yourdomain.com
# Expected: HTTP 200 with HTML content

# WebSocket Health
curl -I https://api.yourdomain.com/ws/device
# Expected: HTTP 426 (Upgrade Required - normal for WebSocket)
```

### System Status Checks

```bash
# Backend Status Check Script
#!/bin/bash
echo "🔍 TagSakay System Status Check"
echo "================================"

# Check API
api_status=$(curl -s -o /dev/null -w "%{http_code}" "https://api.yourdomain.com/health")
echo "API Status: $api_status"

# Check Database
db_response=$(curl -s "https://api.yourdomain.com/health/db")
echo "Database: $db_response"

# Check Frontend
frontend_status=$(curl -s -o /dev/null -w "%{http_code}" "https://yourdomain.com")
echo "Frontend Status: $frontend_status"

# Check SSL Certificate
ssl_info=$(openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null | openssl x509 -noout -dates 2>/dev/null)
echo "SSL Certificate: $ssl_info"
```

### Monitoring Tools

**Cloudflare Analytics:**

- Workers Analytics: https://dash.cloudflare.com/analytics/workers
- Security Events: https://dash.cloudflare.com/security/events
- Performance Metrics: Response times, error rates

**Database Monitoring:**

- Neon Console: https://console.neon.tech
- Connection pool status
- Query performance metrics

---

## 🔐 Authentication Issues

### Common Authentication Problems

#### 1. Login Failures

**Symptoms:**

- "Invalid credentials" error
- Account locked message
- Rate limiting warnings

**Diagnosis:**

```bash
# Check account status
curl -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Check rate limiting
curl -I https://api.yourdomain.com/api/auth/login
# Look for X-RateLimit-* headers
```

**Solutions:**

1. **Account Lockout (429 Too Many Requests):**

   ```bash
   # Wait for lockout period (15 minutes)
   # Or reset account lockout (admin only):
   curl -X POST https://api.yourdomain.com/api/admin/unlock-account \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"email":"user@example.com"}'
   ```

2. **Invalid Password:**

   ```bash
   # Reset password (if email system configured)
   curl -X POST https://api.yourdomain.com/api/auth/forgot-password \
     -d '{"email":"user@example.com"}'
   ```

3. **Account Disabled:**
   ```bash
   # Reactivate account (admin only)
   curl -X PUT https://api.yourdomain.com/api/users/{userId} \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"isActive":true}'
   ```

#### 2. JWT Token Issues

**Symptoms:**

- "Token expired" errors
- "Invalid token" messages
- Automatic logout after short time

**Diagnosis:**

```bash
# Decode JWT token (use jwt.io or)
echo "YOUR_JWT_TOKEN" | cut -d. -f2 | base64 -d | jq .

# Check token expiration
node -e "
const token = 'YOUR_JWT_TOKEN';
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64'));
console.log('Expires:', new Date(payload.exp * 1000));
console.log('Is Expired:', Date.now() > payload.exp * 1000);
"
```

**Solutions:**

1. **Token Expired:**

   - Frontend should automatically refresh
   - Manual refresh: `POST /api/auth/refresh`

2. **Invalid Token:**

   - Clear local storage/cookies
   - Re-authenticate user

3. **Token Refresh Failing:**
   ```typescript
   // Check refresh token implementation
   const refreshToken = async () => {
     try {
       const response = await fetch("/api/auth/refresh", {
         method: "POST",
         credentials: "include", // Important for cookies
       });
       return await response.json();
     } catch (error) {
       // Redirect to login
       window.location.href = "/login";
     }
   };
   ```

---

## 🌐 API & Network Issues

### API Response Problems

#### 1. 500 Internal Server Error

**Diagnosis:**

```bash
# Check Cloudflare Workers logs
npx wrangler tail --env production

# Check specific endpoint
curl -v https://api.yourdomain.com/api/endpoint
```

**Common Causes & Solutions:**

1. **Database Connection Issues:**

   ```typescript
   // Check database connection
   const db = c.get("db");
   try {
     await db.select().from(users).limit(1);
   } catch (error) {
     console.error("Database connection failed:", error);
     return c.json({ success: false, message: "Database unavailable" }, 503);
   }
   ```

2. **Environment Variables Missing:**

   ```bash
   # List all worker secrets
   npx wrangler secret list --env production

   # Add missing secrets
   npx wrangler secret put DATABASE_URL --env production
   npx wrangler secret put JWT_SECRET --env production
   ```

3. **Code Errors:**

   ```bash
   # Deploy with error handling
   npx wrangler deploy --env production --minify

   # Check deployment logs
   npx wrangler tail --format pretty
   ```

#### 2. 429 Rate Limiting

**Diagnosis:**

```bash
# Check rate limit headers
curl -I https://api.yourdomain.com/api/endpoint
# Look for: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

**Solutions:**

1. **Increase Rate Limits (if needed):**

   ```typescript
   // src/middleware/rateLimit.ts
   export const createRateLimit = (
     key: string,
     limit: number,
     window: number
   ) => {
     // Adjust limits based on requirements
     const limits = {
       auth: { requests: 10, window: 60000 }, // Increased from 5
       api: { requests: 200, window: 60000 }, // Increased from 100
       device: { requests: 5, window: 3600000 }, // Device registration
     };
   };
   ```

2. **Implement Client-Side Rate Limiting:**

   ```typescript
   // Frontend rate limit handling
   const apiClient = {
     async request(url: string, options: RequestInit) {
       try {
         const response = await fetch(url, options);

         if (response.status === 429) {
           const retryAfter = response.headers.get("Retry-After");
           const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;

           // Show user-friendly message
           toast.warning(
             `Too many requests. Please wait ${Math.ceil(
               waitTime / 1000
             )} seconds.`
           );

           // Wait and retry
           await new Promise((resolve) => setTimeout(resolve, waitTime));
           return this.request(url, options);
         }

         return response;
       } catch (error) {
         console.error("API request failed:", error);
         throw error;
       }
     },
   };
   ```

#### 3. CORS Issues

**Symptoms:**

- "CORS policy" errors in browser console
- "Access-Control-Allow-Origin" missing

**Diagnosis:**

```bash
# Test CORS with preflight
curl -X OPTIONS https://api.yourdomain.com/api/endpoint \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type"
```

**Solutions:**

```typescript
// src/middleware/cors.ts
export const corsMiddleware = (c: Context, next: Next) => {
  const origin = c.req.header("Origin");
  const allowedOrigins = [
    "https://yourdomain.com",
    "https://www.yourdomain.com",
    "http://localhost:5173", // Development
  ];

  if (allowedOrigins.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
  }

  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.header("Access-Control-Allow-Credentials", "true");

  if (c.req.method === "OPTIONS") {
    return c.text("", 200);
  }

  return next();
};
```

---

## 📱 ESP32 Device Issues

### ESP32 Debugging

#### Serial Monitor Debugging

```cpp
// Enable debug mode in Config.h
#define DEBUG_MODE true
#define SERIAL_BAUD 115200

// In main code
void debugLog(String message) {
  if (DEBUG_MODE) {
    Serial.println("[" + String(millis()) + "] " + message);
  }
}

// Usage
debugLog("WiFi connecting to: " + String(WIFI_SSID));
debugLog("WebSocket status: " + String(isConnected ? "connected" : "disconnected"));
debugLog("Free heap: " + String(ESP.getFreeHeap()));
```

#### Common ESP32 Issues

#### 1. WiFi Connection Problems

**Symptoms:**

- Device not connecting to WiFi
- Frequent disconnections
- "WiFi connection failed" in serial

**Diagnosis:**

```cpp
// Add to WiFi connection code
void diagnoseWiFi() {
  Serial.println("=== WiFi Diagnosis ===");
  Serial.println("SSID: " + String(WIFI_SSID));
  Serial.println("Signal Strength: " + String(WiFi.RSSI()) + " dBm");
  Serial.println("MAC Address: " + WiFi.macAddress());
  Serial.println("Local IP: " + WiFi.localIP().toString());
  Serial.println("Gateway IP: " + WiFi.gatewayIP().toString());
  Serial.println("DNS IP: " + WiFi.dnsIP().toString());
  Serial.println("Status: " + String(WiFi.status()));
}
```

**Solutions:**

1. **Weak Signal:**

   ```cpp
   // Check signal strength
   int signalStrength = WiFi.RSSI();
   if (signalStrength < -70) {
     Serial.println("⚠️ Weak WiFi signal: " + String(signalStrength) + " dBm");
     // Consider relocating device or using WiFi extender
   }
   ```

2. **Wrong Credentials:**

   ```cpp
   // Verify credentials in Config.h
   #define WIFI_SSID "YourNetworkName"      // Check exact name (case-sensitive)
   #define WIFI_PASSWORD "YourPassword"     // Check exact password

   // Test with WiFiScan
   void scanNetworks() {
     int n = WiFi.scanNetworks();
     for (int i = 0; i < n; ++i) {
       Serial.println(String(i) + ": " + WiFi.SSID(i) + " (" + WiFi.RSSI(i) + ")");
     }
   }
   ```

3. **Connection Timeout:**

   ```cpp
   // Increase timeout and add retry logic
   bool connectWiFi() {
     WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

     int attempts = 0;
     while (WiFi.status() != WL_CONNECTED && attempts < 30) { // 30 seconds
       delay(1000);
       Serial.print(".");
       attempts++;
     }

     if (WiFi.status() == WL_CONNECTED) {
       Serial.println("\n✅ WiFi connected");
       return true;
     } else {
       Serial.println("\n❌ WiFi connection failed");
       return false;
     }
   }
   ```

#### 2. WebSocket Connection Issues

**Symptoms:**

- "WebSocket connection failed"
- Frequent disconnections
- Authentication timeouts

**Diagnosis:**

```cpp
void diagnoseWebSocket() {
  Serial.println("=== WebSocket Diagnosis ===");
  Serial.println("Host: " + String(WS_HOST));
  Serial.println("Port: " + String(WS_PORT));
  Serial.println("Use SSL: " + String(USE_SECURE_WS ? "Yes" : "No"));
  Serial.println("Connection State: " + String(client.available()));
  Serial.println("Last Heartbeat: " + String(millis() - lastHeartbeat) + "ms ago");
}
```

**Solutions:**

1. **SSL Certificate Issues:**

   ```cpp
   // For secure connections, add certificate validation
   #include <WiFiClientSecure.h>

   WiFiClientSecure secureClient;

   void setupSecureConnection() {
     // For production, use proper certificate validation
     secureClient.setInsecure(); // Only for testing!

     // For production, use:
     // secureClient.setCACert(root_ca);
   }
   ```

2. **Authentication Problems:**

   ```cpp
   // Verify API key format and registration
   void verifyAuthentication() {
     String deviceId = WiFi.macAddress();
     Serial.println("Device ID: " + deviceId);
     Serial.println("API Key Length: " + String(API_KEY.length()));

     // API key should be 64 characters (SHA256 hash)
     if (API_KEY.length() != 64) {
       Serial.println("❌ Invalid API key format");
     }
   }
   ```

3. **Connection Timeout:**

   ```cpp
   // Implement exponential backoff
   class ConnectionManager {
     private:
       int reconnectAttempts = 0;
       unsigned long lastReconnectAttempt = 0;

     public:
       bool shouldReconnect() {
         unsigned long backoffTime = min(30000, 1000 * pow(2, reconnectAttempts));
         return millis() - lastReconnectAttempt > backoffTime;
       }

       void recordReconnectAttempt() {
         lastReconnectAttempt = millis();
         reconnectAttempts++;
       }

       void resetReconnectAttempts() {
         reconnectAttempts = 0;
       }
   };
   ```

#### 3. WebSocket Connection Issues

**Symptoms:**

- "WebSocket connection failed"
- Frequent disconnections
- Authentication timeouts

**Diagnosis:**

```cpp
void diagnoseWebSocket() {
  Serial.println("=== WebSocket Diagnosis ===");
  Serial.println("Host: " + String(WS_HOST));
  Serial.println("Port: " + String(WS_PORT));
  Serial.println("Use SSL: " + String(USE_SECURE_WS ? "Yes" : "No"));
  Serial.println("Connection State: " + String(client.available()));
  Serial.println("Last Heartbeat: " + String(millis() - lastHeartbeat) + "ms ago");
}
```

**Solutions:**

1. **SSL Certificate Issues:**

   ```cpp
   // For secure connections, add certificate validation
   #include <WiFiClientSecure.h>

   WiFiClientSecure secureClient;

   void setupSecureConnection() {
     // For production, use proper certificate validation
     secureClient.setInsecure(); // Only for testing!

     // For production, use:
     // secureClient.setCACert(root_ca);
   }
   ```

2. **Authentication Problems:**

   ```cpp
   // Verify API key format and registration
   void verifyAuthentication() {
     String deviceId = WiFi.macAddress();
     Serial.println("Device ID: " + deviceId);
     Serial.println("API Key Length: " + String(API_KEY.length()));

     // API key should be 64 characters (SHA256 hash)
     if (API_KEY.length() != 64) {
       Serial.println("❌ Invalid API key format");
     }
   }
   ```

3. **Connection Timeout:**
   ```cpp
   // Implement exponential backoff
   class ConnectionManager {
     private:
       int reconnectAttempts = 0;
       unsigned long lastReconnectAttempt = 0;

     public:
       bool shouldReconnect() {
         unsigned long backoffTime = min(30000, 1000 * pow(2, reconnectAttempts));
         return millis() - lastReconnectAttempt > backoffTime;
       }

       void recordReconnectAttempt() {
         lastReconnectAttempt = millis();
         reconnectAttempts++;
       }

       void resetReconnectAttempts() {
         reconnectAttempts = 0;
       }
   };
   ```

### WebSocket Testing & Debugging

#### Local WebSocket Testing

```bash
# Install WebSocket testing tool
npm install -g wscat

# Test local connection
wscat -c "ws://localhost:8787/ws/device?deviceId=TEST001"

# Send test scan
{"action":"scan","tagId":"TEST123","location":"Main Gate"}

# Send heartbeat
{"action":"heartbeat","timestamp":1699000000}

# Update configuration
{"action":"config","registrationMode":true}
```

#### WebSocket Performance Testing

```javascript
// Create latency-test.js
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8787/ws/device?deviceId=LATENCY");

ws.on("open", () => {
  const start = Date.now();

  ws.send(
    JSON.stringify({
      action: "scan",
      tagId: "LATENCY_TEST",
    })
  );

  ws.on("message", () => {
    const latency = Date.now() - start;
    console.log(`⚡ Latency: ${latency}ms`);
    ws.close();
  });
});
```

**Expected Performance:**

- Local: 10-50ms
- Production (Cloudflare): 50-150ms
- HTTP (comparison): 200-500ms

#### Common WebSocket Issues

1. **"Connection refused":**

   - Check backend is running (`npm run dev`)
   - Verify port 8787 is correct
   - Check firewall settings

2. **"Device already connected (409)":**

   - Close existing connection first
   - Each device can only have one WebSocket
   - Check if another terminal/ESP32 is connected

3. **"JSON parse error":**

   - Validate JSON syntax
   - Use online JSON validator
   - Check for trailing commas

4. **Duplicate Scan Prevention:**

   ```bash
   # First scan
   > {"action":"scan","tagId":"TEST123"}
   < {"success":true,...}

   # Immediate second scan (< 1 second)
   > {"action":"scan","tagId":"TEST123"}
   < {"success":false,"error":"Duplicate scan - please wait 1 second between scans"}
   ```

#### 4. RFID Scanning Issues

**Symptoms:**

- Tags not detected
- Inconsistent readings
- "RFID module not detected"

**Diagnosis:**

```cpp
void diagnoseRFID() {
  Serial.println("=== RFID Diagnosis ===");

  // Check SPI connection
  byte version = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
  Serial.println("RFID Version: 0x" + String(version, HEX));

  // Check antenna gain
  byte gain = mfrc522.PCD_ReadRegister(mfrc522.RFCfgReg);
  Serial.println("Antenna Gain: 0x" + String(gain, HEX));

  // Test self-test
  bool selfTestResult = mfrc522.PCD_PerformSelfTest();
  Serial.println("Self Test: " + String(selfTestResult ? "PASS" : "FAIL"));
}
```

**Solutions:**

1. **Hardware Connection:**

   ```cpp
   // Verify pin connections in Config.h
   #define RFID_SS_PIN 21    // Slave Select pin
   #define RFID_RST_PIN 22   // Reset pin

   // Check connections:
   // ESP32 -> MFRC522
   // 3.3V -> 3.3V
   // GND  -> GND
   // D21  -> SDA/SS
   // D22  -> RST
   // D23  -> MOSI
   // D19  -> MISO
   // D18  -> SCK
   ```

2. **Power Issues:**

   ```cpp
   // Check power supply
   void checkPowerSupply() {
     float voltage = analogRead(A0) * (3.3 / 4095.0) * 2; // Voltage divider
     Serial.println("Supply Voltage: " + String(voltage) + "V");

     if (voltage < 3.0) {
       Serial.println("⚠️ Low voltage detected");
     }
   }
   ```

3. **Antenna Tuning:**

   ```cpp
   // Optimize antenna gain
   void optimizeAntenna() {
     // Set maximum gain
     mfrc522.PCD_SetAntennaGain(mfrc522.RxGain_max);

     // Enable antenna
     byte antennaGain = mfrc522.PCD_ReadRegister(mfrc522.RFCfgReg);
     if ((antennaGain & (0x03 << 4)) == 0) {
       mfrc522.PCD_WriteRegister(mfrc522.RFCfgReg, antennaGain | (0x03 << 4));
     }
   }
   ```

---

## 🖥️ Frontend Issues

### Common Frontend Problems

#### 1. White Screen / App Not Loading

**Diagnosis:**

```bash
# Check browser console for errors
# Open DevTools -> Console

# Check network requests
# Open DevTools -> Network

# Check if bundles are loading
curl -I https://yourdomain.com/assets/index.js
```

**Solutions:**

1. **Build Issues:**

   ```bash
   # Clear cache and rebuild
   cd frontend
   rm -rf node_modules package-lock.json
   npm install
   npm run build
   ```

2. **Environment Variables:**

   ```bash
   # Check environment variables
   echo $VITE_API_URL

   # Create .env.production file
   VITE_API_URL=https://api.yourdomain.com
   ```

3. **Routing Issues:**
   ```typescript
   // Check Vue Router configuration
   const router = createRouter({
     history: createWebHistory(),
     routes: [
       { path: "/", component: Dashboard },
       { path: "/login", component: Login },
       { path: "/:pathMatch(.*)*", component: NotFound }, // Catch-all
     ],
   });
   ```

#### 2. API Integration Issues

**Symptoms:**

- "Network Error" messages
- API calls failing
- CORS errors

**Diagnosis:**

```typescript
// Add API debugging
const apiClient = {
  async request(url: string, options: RequestInit = {}) {
    console.log("API Request:", { url, options });

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      console.log("API Response:", {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      });

      return response;
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  },
};
```

**Solutions:**

1. **Base URL Configuration:**

   ```typescript
   // services/api.ts
   const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

   // Ensure no trailing slash
   const baseURL = API_BASE_URL.replace(/\/$/, "");
   ```

2. **Token Management:**

   ```typescript
   // Check token storage and retrieval
   const getAuthToken = (): string | null => {
     const token = localStorage.getItem("auth_token");

     if (!token) {
       console.warn("No auth token found");
       return null;
     }

     // Check if token is expired
     try {
       const payload = JSON.parse(atob(token.split(".")[1]));
       if (Date.now() >= payload.exp * 1000) {
         console.warn("Auth token expired");
         localStorage.removeItem("auth_token");
         return null;
       }
       return token;
     } catch (error) {
       console.error("Invalid token format:", error);
       localStorage.removeItem("auth_token");
       return null;
     }
   };
   ```

#### 3. Performance Issues

**Symptoms:**

- Slow loading times
- Laggy interactions
- High memory usage

**Diagnosis:**

```bash
# Run Lighthouse audit
npx lighthouse https://yourdomain.com --view

# Check bundle size
npm run build
npm run analyze  # If analyzer is configured
```

**Solutions:**

1. **Code Splitting:**

   ```typescript
   // Lazy load components
   const Dashboard = defineAsyncComponent(
     () => import("./views/Dashboard.vue")
   );
   const UserManagement = defineAsyncComponent(
     () => import("./views/UserManagement.vue")
   );

   // Route-based code splitting
   const routes = [
     {
       path: "/dashboard",
       component: () => import("./views/Dashboard.vue"),
     },
   ];
   ```

2. **Image Optimization:**

   ```bash
   # Install image optimization plugin
   npm install vite-plugin-imagemin --save-dev

   # Configure in vite.config.ts
   import { defineConfig } from 'vite';
   import { ViteImageOptimize } from 'vite-plugin-imagemin';

   export default defineConfig({
     plugins: [
       ViteImageOptimize({
         gifsicle: { optimizationLevel: 7 },
         mozjpeg: { quality: 80 },
         pngquant: { quality: [0.65, 0.8] }
       })
     ]
   });
   ```

---

## 📊 Database Issues

### Common Database Problems

#### 1. Connection Pool Exhaustion

**Symptoms:**

- "Connection pool timeout" errors
- Slow database queries
- 500 errors under load

**Diagnosis:**

```typescript
// Check connection pool status
const pool = drizzle(sql, {
  logger: true, // Enable query logging
});

// Monitor connections
const checkConnectionHealth = async () => {
  try {
    const result = await pool.select().from(users).limit(1);
    console.log("Database connection: OK");
  } catch (error) {
    console.error("Database connection failed:", error);
  }
};
```

**Solutions:**

1. **Optimize Connection Pool:**

   ```typescript
   // Configure Neon connection
   import { neon } from "@neondatabase/serverless";

   const sql = neon(DATABASE_URL, {
     poolQueryViaFetch: true,
     fetchConnectionCache: true,
   });
   ```

2. **Query Optimization:**
   ```typescript
   // Use indexes and limit results
   const getRecentScans = async () => {
     return await db
       .select()
       .from(scanHistory)
       .where(gte(scanHistory.scannedAt, new Date(Date.now() - 86400000))) // Last 24h
       .orderBy(desc(scanHistory.scannedAt))
       .limit(100); // Always limit results
   };
   ```

#### 2. Migration Issues

**Symptoms:**

- Migration failures
- Schema inconsistencies
- "Table does not exist" errors

**Diagnosis:**

```bash
# Check migration status
npm run db:check

# View current schema
npm run db:studio

# Check migration files
ls -la drizzle/
```

**Solutions:**

1. **Manual Migration Recovery:**

   ```bash
   # Reset migrations (development only)
   npm run db:drop
   npm run db:generate
   npm run db:migrate

   # Production migration fix
   npm run db:migrate -- --force
   ```

2. **Schema Validation:**
   ```typescript
   // Add schema validation
   const validateSchema = async () => {
     try {
       // Test each table
       await db.select().from(users).limit(1);
       await db.select().from(rfidTags).limit(1);
       await db.select().from(devices).limit(1);
       console.log("✅ All tables accessible");
     } catch (error) {
       console.error("❌ Schema validation failed:", error);
     }
   };
   ```

---

## 🔧 System Maintenance

### Regular Maintenance Tasks

#### Daily Checks

```bash
#!/bin/bash
# daily-check.sh

echo "🔍 Daily TagSakay Health Check - $(date)"

# Check system health
curl -s https://api.yourdomain.com/health | jq .

# Check error rates
curl -s "https://api.yourdomain.com/api/monitoring/errors?hours=24" | jq .

# Check active devices
curl -s "https://api.yourdomain.com/api/devices/status" | jq .

# Check database performance
curl -s "https://api.yourdomain.com/health/db" | jq .
```

#### Weekly Maintenance

```bash
#!/bin/bash
# weekly-maintenance.sh

echo "🔧 Weekly TagSakay Maintenance - $(date)"

# Database cleanup
echo "Cleaning old scan records..."
curl -X POST "https://api.yourdomain.com/api/admin/cleanup" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Security audit
echo "Running security audit..."
npm audit --audit-level=high

# Performance report
echo "Generating performance report..."
curl -s "https://api.yourdomain.com/api/reports/performance?days=7" | jq .

# Backup verification
echo "Verifying backups..."
curl -s "https://api.yourdomain.com/api/admin/backup-status" | jq .
```

### Log Analysis

#### Error Pattern Detection

```bash
# Search for common error patterns
grep -E "(ERROR|FATAL|CRITICAL)" /var/log/tagsakay.log | tail -20

# Check rate limiting events
grep "429" /var/log/tagsakay.log | wc -l

# Check authentication failures
grep "auth.*failed" /var/log/tagsakay.log | tail -10

# Check database connection issues
grep "database.*connection" /var/log/tagsakay.log | tail -10
```

#### Performance Monitoring

```bash
# Monitor response times
awk '/response_time/ {sum+=$NF; count++} END {print "Average response time:", sum/count "ms"}' /var/log/tagsakay.log

# Check memory usage
grep "memory_usage" /var/log/tagsakay.log | tail -10

# Monitor WebSocket connections
grep "websocket.*connected" /var/log/tagsakay.log | wc -l
```

---

## 📞 Support & Contact Information

### Emergency Contacts

**Development Team:**

- Lead Developer: developer@yourdomain.com
- DevOps Engineer: devops@yourdomain.com
- Emergency Hotline: +1-XXX-XXX-XXXX

**System Status:**

- Status Page: https://status.yourdomain.com
- Monitoring: https://monitoring.yourdomain.com
- Logs: https://logs.yourdomain.com

### Support Channels

**For Users:**

- Help Desk: support@yourdomain.com
- User Manual: https://docs.yourdomain.com/user-guide
- Video Tutorials: https://help.yourdomain.com/videos

**For Developers:**

- Technical Documentation: https://docs.yourdomain.com/technical
- API Documentation: https://api.yourdomain.com/docs
- GitHub Issues: https://github.com/yourorg/tagsakay/issues

### Escalation Procedures

#### Level 1: User Issues

- Response Time: 4 hours
- Resolution Time: 24 hours
- Contact: support@yourdomain.com

#### Level 2: System Issues

- Response Time: 1 hour
- Resolution Time: 4 hours
- Contact: devops@yourdomain.com

#### Level 3: Critical Outages

- Response Time: 15 minutes
- Resolution Time: 1 hour
- Contact: Emergency hotline + All hands

---

## 📚 Additional Resources

### Documentation Links

- **Getting Started:** [01_GETTING_STARTED.md](./01_GETTING_STARTED.md)
- **Architecture:** [02_ARCHITECTURE.md](./02_ARCHITECTURE.md)
- **Development:** [03_DEVELOPMENT.md](./03_DEVELOPMENT.md)
- **Deployment:** [04_DEPLOYMENT.md](./04_DEPLOYMENT.md)
- **Progress:** [05_PROGRESS.md](./05_PROGRESS.md)

### External Resources

- **Cloudflare Workers:** https://developers.cloudflare.com/workers/
- **Vue.js Documentation:** https://vuejs.org/guide/
- **ESP32 Arduino Core:** https://docs.espressif.com/projects/arduino-esp32/
- **MFRC522 Library:** https://github.com/miguelbalboa/rfid
- **Drizzle ORM:** https://orm.drizzle.team/

### Community Support

- **GitHub Discussions:** https://github.com/yourorg/tagsakay/discussions
- **Discord Server:** https://discord.gg/tagsakay
- **Stack Overflow:** Tag questions with `tagsakay`

---

**Last Updated:** November 4, 2025  
**Support Level:** Enterprise  
**Response Time:** See escalation procedures above
