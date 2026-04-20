# ESP32 Device Integration & System Architecture

## System Overview

TagSakay RFID system consists of **3 integrated layers**:

```
┌─────────────────────────────────────────────────────────┐
│         Frontend (Vue.js Dashboard)                      │
│    https://tagsakay-frontend.pages.dev                  │
└────────────────────┬────────────────────────────────────┘
                     │ (HTTPS)
                     │
┌─────────────────────────────────────────────────────────┐
│      Backend API (Cloudflare Workers)                    │
│  https://tagsakay-api-production.maskedmyles.workers.dev│
│  - JWT Authentication                                    │
│  - Rate Limiting (OWASP)                                 │
│  - Database: Neon PostgreSQL                             │
└──────┬──────────────────────────┬────────────────────────┘
       │ (HTTPS + WebSocket)      │ (HTTPS)
       │                          │
    ┌──▼──────────────────┐   ┌──▼──────────────────┐
    │  Main ESP32         │   │ LED Matrix ESP32    │
    │  RFID Scanner       │   │ Queue Display       │
    │  TFT Display        │   │ 64x64 LED Matrix    │
    │  Keypad             │   │ UART: RX/TX         │
    │                     │   │                      │
    │ RFID Reader: PN532  │◄──┤ Communication       │
    │ Display: ILI9341    │   │ (UART 115200)       │
    │ ◄─ UART ──────────► │   │                     │
    └─────────────────────┘   └─────────────────────┘
```

---

## Layer 1: Main ESP32 (RFID Scanner)

### Hardware

- **Processor**: ESP32-WROOM-32D
- **RFID Reader**: PN532 (HSPI SPI interface)
- **Display**: 3.2" ILI9341 TFT LCD (320x240)
- **Input**: 4x4 Membrane Keypad
- **Communication**: WiFi + UART
- **Power**: Micro USB (5V)

### Responsibilities

1. **RFID Scanning**

   - Continuously reads RFID cards via PN532
   - Validates tag format (4-32 alphanumeric)
   - Debounces reads (1500ms)

2. **Queue Management**

   - Assigns queue numbers to scanned tags
   - Displays assignment on TFT screen
   - Tracks queue state

3. **Backend Communication**

   - Primary: WebSocket (secure, real-time)
   - Fallback: HTTPS POST (if WebSocket unavailable)
   - Heartbeat: Every 30 seconds

4. **LED Matrix Control**
   - Sends queue numbers via UART
   - Updates display in cascade mode
   - Communicates scan status

### Data Flow

```
RFID Card
   ↓ (PN532 reads)
Tag ID [ABC123DEF456]
   ↓ (Validation)
API Scan Request
   ↓ (WebSocket/HTTPS)
Backend Processing
   ↓
Queue Assignment [#5]
   ↓ (Response)
Display Update
   ├→ TFT: Show "Queue #5"
   └→ UART: Send "5" to LED Matrix
```

### Configuration (Config.h)

```cpp
// Production Settings
#define DEVICE_API_KEY "device_xxxxx_xxxxx..."
#define DEVICE_LOCATION "Main Gate"
#define DEVICE_ID "AA:BB:CC:DD:EE:FF"  // MAC address

// Network
#define WIFI_SSID "Your_WiFi"
#define WIFI_PASSWORD "Your_Password"

// Backend URLs
#define WS_HOST "tagsakay-api-production.maskedmyles.workers.dev"
#define API_BASE_URL "https://tagsakay-api-production.maskedmyles.workers.dev"

// WebSocket
#define WS_ENABLED true
#define USE_SECURE_WS true
#define WS_PATH "/ws/device"

// Offline Features
#define FEATURE_OFFLINE_MODE true
#define FEATURE_AUTO_RECONNECT true
```

---

## Layer 2: LED Matrix ESP32 (Queue Display)

### Hardware

- **Processor**: ESP32-WROOM-32D
- **Display**: 2× 64x32 P3 LED Matrix Panels (chained = 64x64)
- **Driver**: HUB75 compatible (e.g., MBI5024 or TB6821)
- **Communication**: UART from Main ESP32
- **Power**: Micro USB (5V for ESP32) + 5V/2A for LED panels

### Responsibilities

1. **Receive Queue Numbers**

   - UART message format: `QUEUE,{number}`
   - Cascade layout (8 rows, 5 numbers/row)

2. **Display Rendering**

   - Double buffering for smooth updates
   - Multiple display modes (IDLE, QUEUE, STATUS, ERROR)
   - Brightness control (0-255)

3. **Queue Cascade Display**

   ```
   ┌─────────────────────────────┐
   │  1 | 2 | 3 | 4 | 5          │ Row 1
   │  6 | 7 | 8 | 9 | 10         │ Row 2
   │ 11 | 12| 13| 14| 15         │ Row 3
   │  ...                         │ Rows 4-8
   └─────────────────────────────┘
   ```

4. **Status Indicators**
   - Connection status (green=online, red=offline)
   - Last update timestamp
   - System health

### Data Flow

```
Main ESP32
   ↓ (UART Serial)
"QUEUE,5"
   ↓ (Parse)
Queue Number = 5
   ↓ (Render)
LED Matrix Update
   │
   └→ Display "5" in cascade at position 5
```

### Configuration (Config.h)

```cpp
// Panel Layout
#define PANEL_RES_X 64
#define PANEL_RES_Y 32
#define NUM_ROWS 2           // 2 panels stacked
#define NUM_COLS 1
#define PANEL_CHAIN 2        // Chained vertically

// UART Communication
#define UART_RX 32           // Receives from Main ESP32
#define UART_TX 33           // Sends status back
#define UART_BAUD 115200

// Display Settings
#define DEFAULT_BRIGHTNESS 50
#define MESSAGE_DURATION 5000
#define SCROLL_SPEED 50
```

---

## Layer 3: Backend API (Cloudflare Workers)

### Core Services

#### 1. Authentication (`/api/auth/*`)

```
POST /api/auth/login
  ├─ Email + Password
  └─ Returns JWT token (4-hour expiration)

POST /api/auth/register
  ├─ Create new user
  └─ Email verification
```

#### 2. RFID Scanning (`/api/rfid/scan`)

```
POST /api/rfid/scan
{
  "tagId": "ABC123DEF456",
  "deviceId": "AA:BB:CC:DD:EE:FF",
  "location": "Main Gate",
  "timestamp": "2024-01-15T10:30:00Z"
}

Response:
{
  "success": true,
  "queueNumber": 5,
  "estimatedWait": "15 minutes",
  "status": "queued"
}
```

#### 3. Device Management (`/api/devices/*`)

```
GET /api/devices
  └─ List all registered devices

POST /api/devices/register
  ├─ Register new ESP32 device
  └─ Returns device ID

POST /api/devices/{deviceId}/heartbeat
  ├─ Device status check-in
  └─ Updates last-seen timestamp
```

#### 4. API Key Management (`/api/apiKeys/*`)

```
POST /api/apiKeys
  ├─ Create device API key
  └─ Returns secret key (shown once)

GET /api/apiKeys
  └─ List all API keys (admin only)
```

#### 5. WebSocket Connection (`/ws/device`)

```
Connection: wss://tagsakay-api-production.../ws/device
  ├─ Authenticate with API key
  ├─ Receive real-time updates
  └─ Send device status

Messages:
  ├─ SCAN: {"type":"scan","tagId":"...","queueNumber":5}
  ├─ QUEUE_UPDATE: {"type":"queue_update","queues":[...]}
  └─ DEVICE_OFFLINE: {"type":"device_offline","deviceId":"..."}
```

---

## Communication Protocols

### Main ESP32 → LED Matrix ESP32 (UART)

**Physical Connection:**

```
Main ESP32 (GPIO 17 TX)    → LED Matrix ESP32 (GPIO 32 RX)
Main ESP32 (GPIO 16 RX)    ← LED Matrix ESP32 (GPIO 33 TX)
Main ESP32 (GND)           ← LED Matrix ESP32 (GND)
```

**Serial Protocol:**

- **Baud Rate**: 115200
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None

**Message Format:**

```
Main → LED Matrix:
  ├─ "QUEUE,{number}"      // Display queue number
  ├─ "QUEUE,{csv_list}"    // Multiple queues (cascade)
  ├─ "CLEAR"               // Clear display
  ├─ "STATUS,{text}"       // Status message
  ├─ "BRIGHTNESS,{0-255}"  // Adjust brightness
  └─ "TEST"                // Test pattern

LED Matrix → Main:
  ├─ "ACK"                 // Acknowledge message
  ├─ "ERROR,{desc}"        // Error report
  └─ "STATUS,{msg}"        // Status update
```

### Main ESP32 → Backend API (WebSocket)

**Connection:**

```
Protocol: WSS (Secure WebSocket)
Host: tagsakay-api-production.maskedmyles.workers.dev
Path: /ws/device
Port: 443
```

**Handshake:**

```
GET /ws/device HTTP/1.1
Authorization: Bearer {api_key}
Device-Id: {device_mac_address}
```

**Message Exchange:**

```
Client (Main ESP32):
├─ {"action":"AUTHENTICATE","apiKey":"device_xxxxx"}
├─ {"action":"SCAN","tagId":"ABC123","deviceId":"...","timestamp":"..."}
└─ {"action":"HEARTBEAT","status":"online","battery":95}

Server (Backend):
├─ {"type":"AUTH_SUCCESS","deviceId":"..."}
├─ {"type":"SCAN_RESPONSE","queueNumber":5,"wait":"15min"}
└─ {"type":"QUEUE_UPDATE","queues":[1,2,3,4,5]}
```

### Main ESP32 → Backend API (HTTP Fallback)

Used when WebSocket fails:

```
POST /api/rfid/scan HTTP/1.1
Host: tagsakay-api-production.maskedmyles.workers.dev
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "tagId": "ABC123DEF456",
  "deviceId": "AA:BB:CC:DD:EE:FF",
  "location": "Main Gate"
}

Response:
{
  "success": true,
  "queueNumber": 5,
  "estimatedWait": "15 minutes"
}
```

---

## Device Registration & Initialization

### Step-by-Step Registration Flow

**Step 1: Admin Creates API Key**

```
Frontend: Settings → API Keys → Create New
  ├─ Device Name: "Main RFID Scanner #1"
  ├─ Device Type: "RFID_SCANNER"
  ├─ Location: "Main Gate"
  └─ Permissions: ["RFID_SCAN", "DEVICE_STATUS"]

Generated: device_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

**Step 2: Configure ESP32 with API Key**

- Via Serial Menu or
- Edit Config.h: `#define DEVICE_API_KEY "device_a1b2c3d4e5f6..."`

**Step 3: Power On ESP32**

```
ESP32 Boot Sequence:
├─ [1] Display initializes
├─ [2] UART initializes (connects to LED Matrix)
├─ [3] Keypad initializes
├─ [4] WiFi connects
├─ [5] RFID reader initializes
├─ [6] API client ready
└─ [7] WebSocket connects to backend
```

**Step 4: Verify Registration**

```
Frontend: Device Management
  └─ Status: "Online" ✅
  └─ Last Heartbeat: "Just now"
  └─ Connection: "WebSocket"
```

---

## Data Models

### Device Structure

```typescript
interface Device {
  id: string; // MAC address or unique ID
  name: string; // "Main RFID Scanner"
  location: string; // "Main Gate"
  type: "RFID_SCANNER" | "LED_DISPLAY" | "CONTROLLER";
  status: "online" | "offline";
  lastHeartbeat: timestamp;
  firmwareVersion: string; // "3.0.0"
  connectionType: "websocket" | "http" | "offline";
  apiKeyId: string; // Reference to API key
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

### RFID Scan Structure

```typescript
interface RFIDScan {
  id: number;
  tagId: string; // "ABC123DEF456"
  deviceId: string; // Device that scanned it
  location: string; // "Main Gate"
  queueNumber: number; // 1-100
  status: "queued" | "called" | "completed";
  timestamp: timestamp;
  metadata: {
    signalStrength?: number;
    readCount?: number;
  };
}
```

### Queue State Structure

```typescript
interface QueueState {
  location: string;
  activeQueues: number[]; // [1, 2, 3, 4, 5, ...]
  nextQueueNumber: number; // 6
  averageWaitTime: number; // seconds
  totalActive: number; // 5 (vehicles in queue)
  lastUpdate: timestamp;
}
```

---

## Security & Authentication

### API Key Security

- Generated as SHA256 hash
- Stored with salt and iterations
- Device-specific prefix (`device_`)
- Can be revoked from admin panel
- Expires after 90 days (configurable)

### WebSocket Authentication

```
1. ESP32 connects to /ws/device
2. Sends API key in handshake header
3. Backend validates key signature
4. Returns session token
5. All messages authenticated with session token
```

### JWT Token (For Admin)

- **Expiration**: 4 hours
- **Claims**:
  - `iss` (issuer)
  - `aud` (audience)
  - `sub` (subject - user ID)
  - `role` (SuperAdmin, Admin, Driver)
- **Signed**: HMAC-SHA256

### Rate Limiting (OWASP Compliant)

```
├─ Authentication: 5 requests/minute
├─ API Endpoints: 100 requests/minute
├─ Device Scans: 3 requests/hour
├─ Account Lockout: 5 failed attempts → 15 min lock
└─ Exponential Backoff: Retry-After header
```

---

## Troubleshooting Guide

### Issue: ESP32 Won't Connect to WiFi

**Symptoms:**

```
[NETWORK] Connecting to WiFi...
[NETWORK] WiFi connection failed
[NETWORK] Retrying... (attempt 1/10)
```

**Solutions:**

1. Verify SSID and password in Config.h (case-sensitive)
2. Ensure WiFi is 2.4GHz (ESP32 doesn't support 5GHz)
3. Check router has DHCP enabled
4. Move router closer to ESP32

### Issue: RFID Reader Not Detected

**Symptoms:**

```
[RFID] Failed to find PN532
```

**Solutions:**

1. Verify PN532 SPI connections:
   - CLK → GPIO 14
   - MOSI → GPIO 13
   - MISO → GPIO 12
   - SS → GPIO 27
2. Update PN532 firmware
3. Try different SPI speed (default 1MHz)

### Issue: WebSocket Connection Fails

**Symptoms:**

```
[WEBSOCKET] Connection failed
[WEBSOCKET] Using HTTP fallback
```

**Solutions:**

1. Check backend URL in Config.h
2. Verify firewall allows HTTPS (port 443)
3. Check device API key is valid
4. Verify JWT token hasn't expired

### Issue: LED Matrix Not Updating

**Symptoms:**

```
[UART] Sending queue display command
(LED Matrix shows no change)
```

**Solutions:**

1. Verify UART cable connections:
   - Main TX (GPIO 17) → LED RX (GPIO 32)
   - Main RX (GPIO 16) → LED TX (GPIO 33)
2. Ensure baud rate is 115200 on both devices
3. Check LED Matrix power (separate 5V supply)
4. Verify LED panel configuration (64x32 or 64x64)

### Issue: Device Offline in Dashboard

**Symptoms:**

```
Frontend: Device Status = "Offline"
Last Heartbeat: 30 minutes ago
```

**Solutions:**

1. Check WiFi connection on ESP32
2. Verify device API key is still valid
3. Check backend is responding
4. Monitor Serial output for errors
5. Restart ESP32 device

---

## Production Monitoring

### Key Metrics to Track

**Device Health:**

- WiFi signal strength (-80 to -30 dBm)
- Uptime percentage
- Last successful scan
- Error count (last 24h)
- API latency

**Queue Performance:**

- Average wait time
- Total vehicles queued
- Peak queue time
- Scan rate (scans/hour)
- Failed scans

**Backend Health:**

- API response time (target: <500ms)
- Error rate (target: <0.1%)
- WebSocket connections (should equal active devices)
- Database query time

### Monitoring Dashboard (Frontend)

```
Device Management Panel:
├─ Online Devices: 2/2 ✅
├─ Last Scan: 30 seconds ago
├─ Queue Length: 5 vehicles
├─ Average Wait: 12 minutes
├─ Error Rate: 0.0%
└─ Uptime: 99.8%
```

---

## Next Steps

1. **Verify Hardware Connections**

   - Confirm all pin assignments match Config.h
   - Test power supplies (5V for ESP32, 5V/2A for LED)

2. **Flash Firmware**

   - Upload TagSakay_Fixed_Complete.ino to Main ESP32
   - Upload TagSakay_LED_Matrix.ino to LED Matrix

3. **Configure Network**

   - WiFi SSID and password in Config.h
   - Device API key from admin panel

4. **Test Integration**

   - Scan RFID card
   - Verify queue number displays on both TFT and LED Matrix
   - Check backend logs for successful scan

5. **Deploy to Location**
   - Set device location in Config.h
   - Mount hardware securely
   - Verify WiFi signal strength

---

## Support

- **Full Deployment Guide**: `07_ESP32_PRODUCTION_DEPLOYMENT.md`
- **Quick Reference**: `08_QUICK_REFERENCE.md`
- **API Routes**: `API_ROUTES.md`
- **Troubleshooting**: `06_TROUBLESHOOTING.md`

---

**System Status: ✅ PRODUCTION READY**

All three layers are deployed and ready for integration!
