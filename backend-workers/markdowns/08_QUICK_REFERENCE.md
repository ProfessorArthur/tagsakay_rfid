# ESP32 Quick Reference Card

## 🚀 Quick Start Checklist

### Before Flashing

- [ ] Create device API key in admin panel
- [ ] Get WiFi SSID and password
- [ ] Arduino IDE + ESP32 board support installed
- [ ] PN532 library installed (for Main ESP32)
- [ ] TFT_eSPI library installed (for Main ESP32)

### Main ESP32 (RFID Scanner)

**Config.h Settings:**

```cpp
#define WIFI_SSID "Your_Network"
#define WIFI_PASSWORD "Your_Password"
#define DEVICE_API_KEY "device_xxxxx..."
#define DEVICE_LOCATION "Main Gate"
```

**Upload:**

1. Select Board: ESP32-WROOM-DA Module
2. Select Port: COM#
3. Upload Speed: 921600
4. Press Upload

**Verify:**

- Serial Monitor (115200 baud)
- Look for "WiFi connected!" message
- Place RFID card near reader

### LED Matrix ESP32 (Display)

**Config.h Settings:**

```cpp
#define UART_RX 32
#define UART_TX 33
#define UART_BAUD 115200
#define BRIGHTNESS 50
```

**Upload:**

1. Select Board: ESP32-WROOM-DA Module
2. Select Port: COM#
3. Upload Speed: 921600
4. Press Upload

**Verify:**

- Connect UART to Main ESP32
- Watch for display patterns

---

## 📡 Network Configuration

### WiFi Connection (Main ESP32)

```
Baud: 115200
Max Retries: 10
Retry Delay: 5 seconds
Expected Time to Connect: 15-30 seconds
```

### UART Configuration (Between Devices)

```
Main ESP32 TX (GPIO 17) → LED Matrix RX (GPIO 32)
Main ESP32 RX (GPIO 16) → LED Matrix TX (GPIO 33)
GND → GND
Baud: 115200
```

---

## 🔑 API Key Setup

### Via Serial Menu (Recommended)

1. Press keypad button → Menu
2. Select Settings
3. Enter API key
4. Confirm (persists in memory)

### Via Config.h (Before Flashing)

```cpp
#define DEVICE_API_KEY "device_xxxxx..."
```

### Get API Key

1. Login: https://tagsakay-frontend.pages.dev
2. Navigate: Settings → API Keys
3. Create New
4. Copy key (shown once only)

---

## 🧪 Testing Steps

### Test 1: WiFi Connection

```
Expected Serial Output:
[NETWORK] WiFi connected! IP: 192.168.x.x
```

### Test 2: RFID Reader

```
Expected Serial Output:
[RFID] RFID reader initialized
[RFID] Tag detected: ABC123DEF456
```

### Test 3: WebSocket Connection

```
Expected Serial Output:
[WEBSOCKET] Connected to wss://...
[WEBSOCKET] Authenticated as device: ...
```

### Test 4: LED Matrix

```
Expected: Queue number appears on display
Serial Output: [UART] Sending queue display command
```

### Test 5: Backend Sync

```
Frontend URL: https://tagsakay-frontend.pages.dev
Navigate: Live Scans
Place card on scanner
Verify: Scan appears within 1 second
```

---

## 🔧 Troubleshooting

| Problem               | Solution                                            |
| --------------------- | --------------------------------------------------- |
| WiFi won't connect    | Check SSID/password, move closer to router          |
| RFID reader not found | Verify PN532 SPI connections (14,12,13,27)          |
| WebSocket fails       | Automatic HTTP fallback, check backend is online    |
| LED Matrix blank      | Check UART cable (TX→RX, RX→TX), verify baud 115200 |
| Device offline        | Check WiFi → Check API key → Check backend          |

---

## 📍 Pin Reference

### Main ESP32

```
RFID (SPI):     CLK=14, MISO=12, MOSI=13, SS=27
Display (TFT):  DC=2, CS=15, RST=4, LED=32
Keypad:         Rows: 26,25,33,32  Cols: 17,16,4,2
UART:           TX=17, RX=16, Baud=115200
```

### LED Matrix ESP32

```
LED Control:    R1=14, G1=13, B1=12, R2=23, G2=19, B2=18
Row Address:    A=27, B=26, C=25, D=33, E=32
Signals:        LAT=4, OE=15, CLK=22
UART:           RX=32, TX=33, Baud=115200
```

---

## 🌐 API Endpoints (Main ESP32 Uses)

### Scan Registration

```
POST /api/rfid/scan
Content-Type: application/json

{
  "tagId": "ABC123DEF456",
  "deviceId": "AA:BB:CC:DD:EE:FF",
  "scanTime": "2024-01-15T10:30:00Z"
}

Response: {
  "success": true,
  "queueNumber": 5,
  "estimatedWait": "15 minutes"
}
```

### Device Heartbeat

```
POST /api/devices/{deviceId}/heartbeat
Authorization: Bearer {api_key}

Response: {
  "success": true,
  "status": "online"
}
```

### WebSocket Connection

```
wss://tagsakay-api-production.maskedmyles.workers.dev/ws/device
Path: /ws/device
Auth: API key in handshake
```

---

## 📊 Production Deployment URLs

| Service           | URL                                                     |
| ----------------- | ------------------------------------------------------- |
| **Backend API**   | https://tagsakay-api-production.maskedmyles.workers.dev |
| **Frontend**      | https://tagsakay-frontend.pages.dev                     |
| **Custom Domain** | api.tagsakay.com (when configured)                      |

---

## 💾 Files to Remember

| File                          | Purpose                        |
| ----------------------------- | ------------------------------ |
| `TagSakay_Fixed_Complete.ino` | Main ESP32 firmware            |
| `TagSakay_LED_Matrix.ino`     | LED Matrix firmware            |
| `Config.h` (Main)             | WiFi, API key, server settings |
| `Config.h` (LED)              | UART, display settings         |
| `.dev.vars`                   | Local development secrets      |
| `wrangler.toml`               | Cloudflare configuration       |

---

## 📞 Support Resources

- **API Documentation**: `backend-workers/markdowns/API_ROUTES.md`
- **Full Deployment Guide**: `backend-workers/markdowns/07_ESP32_PRODUCTION_DEPLOYMENT.md`
- **Architecture**: `backend-workers/markdowns/02_ARCHITECTURE.md`
- **Troubleshooting**: `backend-workers/markdowns/06_TROUBLESHOOTING.md`

---

## ✅ Pre-Production Checklist

- [ ] Both devices flashed with latest firmware
- [ ] WiFi configured and connected
- [ ] API keys created and configured
- [ ] RFID reader responds to cards
- [ ] LED Matrix displays queue numbers
- [ ] WebSocket shows connected status
- [ ] Frontend shows device as online
- [ ] Scan appears in frontend within 1 second
- [ ] No errors in Serial Monitor
- [ ] Device heartbeat working (30 second interval)

---

**Status: ✅ PRODUCTION READY**

Both ESP32 devices are configured for production deployment!
