# ESP32 Configuration Guide for Production

## 🔧 Required Configuration Changes

Before flashing your ESP32 for production deployment, you need to update WiFi credentials in the firmware.

---

## 📝 Step-by-Step Configuration

### 1. Open the Firmware File

Open `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino` in Arduino IDE.

### 2. Update WiFi Credentials (Lines 20-25)

**Find this section:**

```cpp
WiFiConfig wifiConfig = {
  "SSID",           // ← Change this to your WiFi network name
  "Password",       // ← Change this to your WiFi password
  10,
  5000
};
```

**Update to your WiFi:**

```cpp
WiFiConfig wifiConfig = {
  "YourWiFiNetworkName",    // Replace with actual WiFi SSID
  "YourWiFiPassword123",    // Replace with actual WiFi password
  10,
  5000
};
```

**Example:**

```cpp
WiFiConfig wifiConfig = {
  "TagSakayOffice",
  "SecurePass2024!",
  10,
  5000
};
```

### 3. Update Server Configuration (Lines 27-32)

**Current configuration (for testing):**

```cpp
ServerConfig serverConfig = {
  "http://192.168.1.73:8787",  // Old local IP
  "de271a_09e103534510b7bf7700d847994c8c6c3433e4214598912db1773a4108df1852",  // Old API key
  10000,
  "Entrance Gate"
};
```

**✅ For Production: Update API Key ONLY** (URL already configured in Config.h)

```cpp
ServerConfig serverConfig = {
  "http://192.168.1.73:8787",  // This is HTTP fallback - keep as is or use api.tagsakay.com
  "YOUR_NEW_DEVICE_API_KEY",   // ← GET THIS FROM DEVICE REGISTRATION
  10000,
  "Main Gate Scanner"          // ← Descriptive device location name
};
```

**Note:** The primary connection uses WebSocket (configured in `Config.h`), this URL is only for HTTP fallback.

---

## 🔑 How to Get Device API Key

### Option 1: Register Device via CLI (Recommended)

```powershell
cd backend-workers

# Register new device with MAC address
npm run device:register AA:BB:CC:DD:EE:FF "Gate 1 Scanner" "Main Entrance"

# Output will show:
# ✅ Device registered successfully
# API Key: dev_abc123xyz456... (SAVE THIS - can't be retrieved later)
```

**Then update your code:**

```cpp
ServerConfig serverConfig = {
  "http://192.168.1.73:8787",
  "dev_abc123xyz456...",  // ← Paste the API key here
  10000,
  "Main Entrance"
};
```

### Option 2: Configure via Serial Monitor (After First Flash)

1. Flash ESP32 with default/empty API key
2. Open Serial Monitor (115200 baud)
3. Type: `config_apikey YOUR_API_KEY_HERE`
4. Press Enter
5. ESP32 will save to EEPROM and restart

**Advantage:** No need to reflash firmware when changing API keys.

---

## 🌐 Production vs Development URLs

### Production Configuration (Default - Already Set in Config.h)

The firmware is **already configured for production** in `Config.h`:

```cpp
#define WS_HOST "api.tagsakay.com"        // ✅ Production domain
#define WS_PORT 443                        // ✅ HTTPS/WSS port
#define USE_SECURE_WS true                 // ✅ Secure WebSocket
#define API_BASE_URL "https://api.tagsakay.com"  // ✅ Production API
```

**No changes needed in Config.h for production! 🎉**

### Development Configuration (Optional - For Local Testing)

If you need to test with local backend first, uncomment the development section in `Config.h`:

```cpp
// Comment out production config and uncomment these:
#define WS_HOST "192.168.1.100"  // Your local dev machine IP
#define WS_PORT 8787              // Local Cloudflare Workers port
#define USE_SECURE_WS false       // Local uses non-secure WebSocket
#define API_BASE_URL "http://192.168.1.100:8787"
```

---

## 📱 Complete ESP32 Setup Checklist

### Before Flashing:

- [ ] Arduino IDE installed with ESP32 board support
- [ ] All required libraries installed (see firmware README)
- [ ] Board selected: ESP32 Dev Module
- [ ] Partition Scheme: Minimal SPIFFS (1.9MB APP / 190KB SPIFFS)
- [ ] Upload Speed: 921600 (or 115200 if fails)
- [ ] Flash Frequency: 80MHz
- [ ] Flash Mode: QIO

### Configuration Changes:

- [ ] WiFi SSID updated in TagSakay_Fixed_Complete.ino
- [ ] WiFi Password updated in TagSakay_Fixed_Complete.ino
- [ ] Device location name updated ("Main Gate", "Exit Gate", etc.)
- [ ] Device registered in backend and API key obtained
- [ ] API key configured (either hardcoded or via Serial Monitor)

### Compilation & Flash:

- [ ] Click **Sketch → Verify/Compile** (should succeed with ~64% flash usage)
- [ ] Connect ESP32 via USB
- [ ] Select correct COM port in **Tools → Port**
- [ ] Click **Upload** (takes 1-2 minutes)
- [ ] Open **Serial Monitor** (115200 baud)
- [ ] Verify successful boot and WiFi connection

### Post-Flash Verification:

- [ ] Serial Monitor shows "WiFi connected"
- [ ] Serial Monitor shows "Connected to api.tagsakay.com" (WebSocket)
- [ ] Device appears online in admin dashboard (https://app.tagsakay.com)
- [ ] RFID scanner initialized successfully
- [ ] Test scan shows up in real-time on dashboard

---

## 🎯 Quick Configuration Summary

**Minimal required changes before flashing:**

1. **Line ~21:** Update WiFi SSID
2. **Line ~22:** Update WiFi password
3. **Line ~30:** Update device API key (after registering device)
4. **Line ~32:** Update device location name

**Everything else is already configured for production! ✅**

---

## 🔍 Testing After Flash

### Serial Monitor Output (Expected):

```
======================================
  TagSakay RFID Scanner v3.0.0
  Production Ready with WebSocket
======================================

[✓] TFT Display initialized
[✓] LED Matrix communication ready
[✓] RFID reader initialized
[✓] Keypad initialized

Connecting to WiFi: YourWiFiNetworkName
[✓] WiFi connected
[✓] IP Address: 192.168.1.XXX
[✓] Signal Strength: -45 dBm

Connecting to WebSocket: wss://api.tagsakay.com:443/ws/device
[✓] WebSocket connected
[✓] Device authenticated

System Ready - Scan RFID tag
```

### If Connection Fails:

**WiFi Connection Failed:**

- Double-check WiFi credentials (case-sensitive)
- Verify WiFi signal strength (move closer to router)
- Check if WiFi uses 2.4GHz (ESP32 doesn't support 5GHz)

**WebSocket Connection Failed:**

- Verify internet connectivity (ping google.com)
- Check if api.tagsakay.com is deployed and accessible
- Verify API key is correct
- Check Serial Monitor for specific error codes

**Device Authentication Failed:**

- API key is incorrect or not registered
- Device MAC address doesn't match registered device
- Re-register device with correct MAC address

---

## 🆘 Troubleshooting Commands

### Via Serial Monitor (115200 baud):

```
help                    - Show all available commands
status                  - Show current system status
wifi_info               - Show WiFi connection details
config_apikey KEY       - Update API key (saves to EEPROM)
registration            - Toggle registration mode
test                    - Run system diagnostics
reboot                  - Restart device
```

---

## 📚 Additional Resources

- **Full Setup Guide:** `DOMAIN_SETUP.md`
- **Quick Deploy:** `QUICK_DEPLOY.md`
- **Firmware Documentation:** `TagSakay_Fixed_Complete/README.md` (if exists)
- **Backend API Docs:** `backend-workers/docs/device-api.md`

---

**Status:** 🟢 Ready for Configuration
**Last Updated:** November 3, 2025
