# ESP32 Production Deployment Guide

## Overview

TagSakay uses two ESP32 devices working together:

- **Main ESP32** (TagSakay_Fixed_Complete): RFID scanner + TFT display + queue management
- **LED Matrix ESP32** (TagSakay_LED_Matrix): 64x64 LED display showing queue numbers

Both devices are **production-ready** and deploy to:

- **Backend**: https://tagsakay-api-production.maskedmyles.workers.dev (Cloudflare Workers)
- **Frontend**: https://tagsakay-frontend.pages.dev (Cloudflare Pages)

---

## Phase 1: Pre-Deployment Setup

### 1.1 Create Device API Keys

Before deploying any ESP32 device, you must create API keys in the admin panel:

1. **Login to TagSakay Frontend**

   - URL: https://tagsakay-frontend.pages.dev
   - Role: SuperAdmin or Admin

2. **Navigate to Settings → API Keys**

   - Click "Create New API Key"
   - Name: `Main RFID Scanner` or `LED Display Matrix`
   - Device ID:
     - Main ESP32: Use MAC address (e.g., `AA:BB:CC:DD:EE:FF`)
     - LED Matrix: Use a unique identifier (e.g., `LL:MM:AA:TT:RX:XX`)
   - Permissions: Select `RFID_SCAN`, `DEVICE_STATUS`

3. **Copy the Generated Key**
   - Example format: `device_xxxxxxxx_xxxxxxxx...`
   - **Store securely** (this is the only time it's displayed)

### 1.2 Prepare Hardware

#### Main ESP32 (RFID Scanner)

- **ESP32-WROOM-32D** (or compatible)
- **PN532 RFID Reader** (HSPI connection)
- **3.2" TFT Display** (ILI9341)
- **4x4 Membrane Keypad**
- **UART to TTL Converter** (for LED Matrix communication)
- **Micro USB Cable** (for programming)

**Pin Assignments (Already configured in Config.h):**

```
SPI/RFID:
  - CLK: GPIO 14
  - MISO: GPIO 12
  - MOSI: GPIO 13
  - SS: GPIO 27

TFT Display:
  - DC: GPIO 2
  - CS: GPIO 15
  - RESET: GPIO 4
  - LED (Backlight): GPIO 32

Keypad:
  - Row Pins: GPIO 26, 25, 33, 32 (R1-R4)
  - Col Pins: GPIO 17, 16, 4, 2 (C1-C4)

UART (to LED Matrix):
  - TX: GPIO 17
  - RX: GPIO 16
  - Baud: 115200
```

#### LED Matrix ESP32 (Queue Display)

- **ESP32-WROOM-32D** (or compatible)
- **64x32 P3 LED Matrix** (2 panels chained vertically = 64x64)
- **HUB75 Driver Board**
- **UART to TTL Converter** (receives from Main ESP32)
- **Micro USB Cable** (for programming)

**Pin Assignments (Already configured in Config.h):**

```
LED Matrix Control:
  - R1: GPIO 14, G1: GPIO 13, B1: GPIO 12
  - R2: GPIO 23, G2: GPIO 19, B2: GPIO 18
  - Row Addr A/B/C/D/E: GPIO 27/26/25/33/32
  - LAT: GPIO 4
  - OE: GPIO 15
  - CLK: GPIO 22

UART (from Main ESP32):
  - RX: GPIO 32
  - TX: GPIO 33
  - Baud: 115200
```

---

## Phase 2: Firmware Flashing

### 2.1 Install Arduino IDE and Drivers

1. **Download Arduino IDE**

   - https://www.arduino.cc/en/software
   - Latest version (2.x+) recommended

2. **Install ESP32 Board Support**

   - Open Arduino IDE → Preferences
   - Board Manager URLs: Add `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Tools → Board Manager → Search "ESP32" → Install by Espressif

3. **Install Required Libraries**

   ```
   - PN532 by Adafruit (RFID reader)
   - TFT_eSPI (Display driver)
   - ArduinoJSON (JSON parsing)
   - WebSockets (WebSocket client)
   - MD5 (Password hashing)
   ```

   - Install via Sketch → Include Library → Manage Libraries

4. **Install CH340 Driver** (if using clone boards)
   - Download from: https://www.wch.cn/products/CH340.html

### 2.2 Flash Main ESP32 (RFID Scanner)

1. **Open Firmware Project**

   ```
   File → Open
   → TagSakay_Fixed_Complete.ino
   ```

2. **Configure for Production**

   - Edit `Config.h`:

     ```cpp
     // WiFi Configuration
     #define WIFI_SSID "Your_WiFi_Network"
     #define WIFI_PASSWORD "Your_WiFi_Password"

     // Device Configuration
     #define DEVICE_API_KEY "device_xxxxx_xxxxx..." // From Step 1.1
     #define DEVICE_LOCATION "Main Gate"

     // Server Configuration
     #define WS_HOST "tagsakay-api-production.maskedmyles.workers.dev"
     #define API_BASE_URL "https://tagsakay-api-production.maskedmyles.workers.dev"

     // Production Settings
     #define LOG_LEVEL LOG_ERROR  // Minimal logging for production
     ```

3. **Select Board and Port**

   - Tools → Board: "ESP32 → ESP32-WROOM-DA Module"
   - Tools → Port: Select your COM port
   - Tools → Upload Speed: 921600 (or 460800 if errors)

4. **Upload Firmware**
   - Sketch → Upload (or Ctrl+U)
   - Wait for "Hash of data verified" message
   - Device will restart automatically

### 2.3 Flash LED Matrix ESP32 (Display)

1. **Open Firmware Project**

   ```
   File → Open
   → TagSakay_LED_Matrix.ino
   ```

2. **Configure for Production**

   - Edit `Config.h`:

     ```cpp
     // UART Configuration
     #define UART_RX 32  // Receives from Main ESP32
     #define UART_TX 33  // Transmits to Main ESP32
     #define UART_BAUD 115200

     // Display Settings
     #define BRIGHTNESS 50  // 0-255
     #define MESSAGE_DURATION 5000  // 5 seconds
     ```

3. **Upload Firmware**
   - Tools → Board: "ESP32 → ESP32-WROOM-DA Module"
   - Tools → Port: Select your COM port
   - Sketch → Upload
   - Wait for success message

---

## Phase 3: WiFi and Network Configuration

### 3.1 Initial WiFi Setup (Main ESP32)

1. **Connect Serial Monitor**

   - Tools → Serial Monitor (115200 baud)
   - Device will show boot messages

2. **Boot Sequence Messages**

   ```
   [MAIN] System starting...
   [DISPLAY] Initializing TFT display...
   [UART] Initializing UART for LED Matrix...
   [KEYPAD] Initializing 4x4 keypad...
   [NETWORK] Connecting to WiFi: "Your_WiFi_Network"...
   [NETWORK] WiFi connected! IP: 192.168.x.x
   [RFID] RFID reader initialized
   [API] API client ready
   [WEBSOCKET] WebSocket initialized
   ```

3. **Press Keypad to Access Menu**
   - Main menu will appear on TFT display
   - Options: Scan RFID, Registration Mode, Device Status, Settings

### 3.2 Verify LED Matrix Connection

1. **Connect UART Cable**

   ```
   Main ESP32          LED Matrix ESP32
   TX (GPIO 17)   -->  RX (GPIO 32)
   RX (GPIO 16)   -->  TX (GPIO 33)
   GND            -->  GND
   ```

2. **Power On LED Matrix**

   - Device should show startup animation
   - Watch Serial Monitor on Main ESP32 for UART communication logs

3. **Test Display**
   - Main ESP32 will send test patterns to LED Matrix
   - You should see:
     - Startup animation (welcome message)
     - Queue number display (cascade mode)
     - Status indicators

---

## Phase 4: API Key Configuration

### 4.1 Set Device API Key on Main ESP32

**Option A: Via Serial Menu (Recommended)**

1. Press keypad button to access menu
2. Navigate to "Settings"
3. Select "API Key"
4. Enter your device API key from Step 1.1
5. Device stores in non-volatile memory (persists after restart)

**Option B: Direct Configuration in Code**

Edit `Config.h` before flashing:

```cpp
#define DEVICE_API_KEY "device_xxxxx_xxxxx..."
```

### 4.2 Verify API Key is Working

1. **Open Serial Monitor** (115200 baud)
2. **Trigger a Test Scan**

   - Place RFID card near reader
   - Serial Monitor should show:
     ```
     [RFID] Tag detected: ABC123DEF456
     [API] Sending scan to backend...
     [API] Response: HTTP 200 OK
     [DISPLAY] Scan processed - Queue #5
     ```

3. **Check LED Matrix**
   - Should update with queue number
   - Should show scan confirmation on display

---

## Phase 5: Testing and Verification

### 5.1 RFID Scanning Test

```
Test Case: Scan a registered RFID card

Expected Results:
✓ Serial shows "Tag detected: [TAG_ID]"
✓ API responds with queue assignment
✓ TFT displays queue number
✓ LED Matrix displays queue number
✓ Backend receives scan via API
```

**Test Command (via Frontend):**

1. Login to https://tagsakay-frontend.pages.dev
2. Navigate to "Live Scans"
3. Place RFID card on scanner
4. Verify scan appears in real-time feed

### 5.2 WebSocket Connection Test

**Check WebSocket Status:**

```
Serial Monitor should show:
[WEBSOCKET] Attempting connection...
[WEBSOCKET] Connected to wss://tagsakay-api-production.maskedmyles.workers.dev/ws/device
[WEBSOCKET] Authenticated as device: [DEVICE_ID]
```

**If WebSocket fails, HTTP fallback kicks in automatically:**

```
[WEBSOCKET] Connection failed, using HTTP fallback
[API] Using HTTP POST for scans
```

### 5.3 LED Matrix Communication Test

**Verify UART Communication:**

```
Main ESP32 Serial Monitor should show:
[UART] Sending queue display command: QUEUE,5
[UART] LED Matrix acknowledged

LED Matrix should update to show queue number 5
```

### 5.4 Device Status Check

**Via Frontend:**

1. Navigate to Device Management
2. Should see:
   - Device ID: [Your Device MAC]
   - Status: Online
   - Last Heartbeat: Just now
   - Firmware Version: 3.0.0
   - Connection: WebSocket (or HTTP Fallback)

---

## Phase 6: Production Deployment Checklist

### Pre-Deployment

- [ ] Device API keys created in admin panel
- [ ] WiFi credentials configured in Config.h
- [ ] Device API keys set on both ESP32 devices
- [ ] Production API URLs verified:
  - `https://tagsakay-api-production.maskedmyles.workers.dev`
- [ ] Both devices flashed with latest firmware
- [ ] Serial Monitor shows successful boot

### Initial Deployment

- [ ] Main ESP32 connects to WiFi
- [ ] LED Matrix connects to Main ESP32 via UART
- [ ] WebSocket connection established to backend
- [ ] RFID reader detects cards successfully
- [ ] TFT display shows queue numbers
- [ ] LED Matrix displays queue cascade

### Production Verification

- [ ] Scan test card → appears in backend within 1 second
- [ ] Frontend shows scan in real-time
- [ ] Device status shows "Online"
- [ ] No errors in Serial Monitor
- [ ] LED Matrix updates with queue number
- [ ] Multiple scans work reliably

### Post-Deployment

- [ ] Monitor device for 24 hours
- [ ] Check WebSocket connection stability
- [ ] Verify API key hasn't expired
- [ ] Confirm backend logs show device activity
- [ ] Set up monitoring alerts (if using observability platform)

---

## Troubleshooting

### Issue: "WiFi Connection Failed"

**Solution:**

1. Verify WiFi SSID and password in Config.h
2. Check WiFi network is 2.4GHz (ESP32 doesn't support 5GHz)
3. Move router closer to device
4. Check firewall allows UDP 67/68 (DHCP)

### Issue: "RFID Reader Not Found"

**Solution:**

1. Verify PN532 is connected on HSPI pins (14, 12, 13, 27)
2. Check SPI communication: Serial Monitor should show "PN532 initialized"
3. Verify PN532 firmware is up to date

### Issue: "WebSocket Connection Failed"

**Solution:**

1. Device will automatically fall back to HTTP
2. Check backend is running: https://tagsakay-api-production.maskedmyles.workers.dev
3. Verify device API key is valid
4. Check firewall allows HTTPS (port 443)

### Issue: "LED Matrix Not Displaying"

**Solution:**

1. Verify UART cable connections (TX→RX, RX→TX)
2. Check baud rate is 115200 on both devices
3. Watch Main ESP32 Serial Monitor for UART errors
4. LED Matrix should show boot animation on power

### Issue: "Device Offline in Dashboard"

**Solution:**

1. Check WiFi connection: Serial Monitor should show IP address
2. Verify device API key in Config.h matches admin panel
3. Check backend API is responding
4. Device sends heartbeat every 30 seconds

---

## Custom Domain Configuration (When Available)

When you set up custom domain `api.tagsakay.com`:

1. **Update Config.h in Main ESP32:**

   ```cpp
   #define WS_HOST "api.tagsakay.com"
   #define API_BASE_URL "https://api.tagsakay.com"
   ```

2. **Reflash Main ESP32** with updated configuration

3. **Verify Connection:**
   - Serial Monitor should show WebSocket connecting to `api.tagsakay.com`
   - No other changes needed on LED Matrix

---

## Production Monitoring

### Check Device Status (Via Frontend)

1. **Device Management Page**

   - Shows all registered devices
   - Last heartbeat timestamp
   - Connection status (Online/Offline)
   - Firmware version

2. **Live Scans Feed**
   - Real-time RFID scan stream
   - Queue assignments
   - Timestamp and device source
   - Error indicators

### API Health Check

**Test Backend Connectivity:**

```bash
# From your terminal
curl https://tagsakay-api-production.maskedmyles.workers.dev/health

# Expected response
{"status":"ok","timestamp":"2024-01-15T10:30:00Z"}
```

---

## Support and Logs

### Access Device Logs

1. **Serial Monitor (Real-time)**

   - Connect USB to Main ESP32
   - Open Arduino IDE → Tools → Serial Monitor
   - Baud Rate: 115200
   - Watch for [RFID], [API], [WEBSOCKET], [UART] tags

2. **Backend Logs**

   - Cloudflare Dashboard → Workers → Logs
   - Shows all API requests from devices
   - Check for error status codes

3. **Frontend Admin Panel**
   - Device Management → Select Device
   - View device-specific activity
   - Check connection history

---

## Summary

Your ESP32 system is now production-ready! 🚀

**What's Running:**

- ✅ Main ESP32: RFID Scanner + TFT Display + Queue Management
- ✅ LED Matrix ESP32: 64x64 Queue Display (cascade mode)
- ✅ Backend API: Cloudflare Workers (tagsakay-api-production)
- ✅ Frontend: Vue.js Admin Dashboard (Cloudflare Pages)

**All devices communicate securely with:**

- JWT authentication
- API key validation
- HTTPS/WSS encryption
- Device-level rate limiting

**Ready for production deployment!**
