# TagSakay ESP32 Firmware v3.1 – HTTP Polling Edition

## 🚀 What Changed

- 🧹 WebSocket stack removed to simplify networking and free ~60 KB of flash.
- 📡 `HTTPPollingModule` now handles admin-issued commands (registration toggles, scan mode).
- 🫀 Heartbeats and command polling timings aligned with Cloudflare Worker defaults.
- 🔒 API client hardens retry/backoff logic for noisy networks.
- 🛠️ Documentation refreshed for REST-first workflow and production deployment.

This update keeps the fast RFID experience while leaning fully on the hardened REST API. No WebSocket dependencies remain.

---

## ⭐ Core Features

- 📡 **Command Polling** – Device polls `GET /api/devices/:deviceId/commands` every `COMMAND_POLL_INTERVAL` (default 5 s) for registration toggles and scan mode updates.
- 🫀 **Heartbeats** – Posts `/api/devices/:deviceId/heartbeat` every `HEARTBEAT_INTERVAL` (default 30 s) to report connectivity, registration mode, and expected tag IDs.
- 📦 **Offline Buffering** – Scans queue locally when the backend is unreachable; they replay automatically once the API responds.
- 🛡️ **Duplicate Prevention** – Durable Object enforcement ensures no tag is processed twice in the active window.
- 🔁 **Auto Recovery** – Network/API retries, watchdog timers, and keypad-driven safe mode keep the device responsive.
- 🖥️ **Rich UI** – TFT dashboard, LED matrix queue display, and keypad shortcuts stay unchanged.

---

## 📚 Required Libraries

Install via Arduino IDE Library Manager unless already bundled with the ESP32 core:

1. **ArduinoJson** (v6+ or v7+) – API payload parsing.
2. **Adafruit PN532** – RFID reader support over HSPI.
3. **TFT_eSPI** – 480×320 ILI9488 display driver (configured via `User_Setup.h`).
4. **Keypad** – 4×4 matrix keypad handling.

The ESP32 core provides WiFi, HTTPClient, SPI, and other standard dependencies.

---

## ⚙️ Key Configuration

Edit `Config.h` to match your environment:

```cpp
#define API_BASE_URL "http://192.168.1.100:8787"  // ← replace with your backend URL
#define API_DEFAULT_KEY ""                    // optional device API key

#define HEARTBEAT_INTERVAL 30000               // 30 seconds (status telemetry)
#define COMMAND_POLL_INTERVAL 5000             // 5 seconds (admin commands)
#define API_TIMEOUT_MS 5000                    // request timeout
#define API_RETRY_ATTEMPTS 3                   // automatic retries per call
```

Device IDs are derived from the ESP32 MAC address, so no extra setup is required. Switch between local development and production by toggling the provided configuration blocks.

---

## 📂 Project Structure

```
TagSakay_Fixed_Complete/
├── TagSakay_Fixed_Complete.ino  // Main application (HTTP polling workflow)
├── Config.h                      // All timing, feature, and API settings
├── HTTPPolling.h/.cpp            // NEW: command polling and state reconciliation
├── ApiModule.h/.cpp              // REST API client and heartbeat logic
├── NetworkModule.h/.cpp          // WiFi connectivity and reconnection helpers
├── RFIDModule.h/.cpp             // PN532 RFID reader
├── DisplayModule.h/.cpp          // TFT UI and status rendering
├── KeypadModule.h/.cpp           // 4×4 keypad handling and menu controls
├── UARTModule.h/.cpp             // LED matrix communication
└── BuzzerModule.h                // Optional error/feedback tones
```

---

## 🔄 Runtime Flow

### Boot Sequence

```
1. ESP32 boots and shows splash screen
2. WiFi connection established (with automatic retries)
3. API client initializes and authenticates (if key provided)
4. HTTP polling module starts and performs an immediate sync
5. Device ready for scans and admin-issued commands
```

### Scan Flow (HTTP)

```
1. RFID tag detected → UID buffered with debounce
2. Device POSTs /api/rfid/scan with tagId, deviceId, and context
3. Backend validates tag, updates queue, returns driver info/status
4. TFT display and LED matrix show results; duplicates blocked upstream
```

### Command & Telemetry Loop

```
Every 5 s: GET /api/devices/{deviceId}/commands
  ↳ Applies registration mode toggles, expected tag lock-ins, and scan mode flags

Every 30 s: POST /api/devices/{deviceId}/heartbeat
  ↳ Shares uptime, registration state, offline/online mode, and firmware version
```

The polling module short-circuits when offline to conserve bandwidth and battery.

---

## 🧪 Expected Serial Output

```
================================
  TagSakay RFID Scanner v3.1
================================

[1/8] Initializing Display...
[2/8] Initializing UART...
[3/8] Initializing Buzzer...
[4/8] Initializing Keypad...
[5/8] Initializing Network...
[NETWORK] Device ID (MAC): 001122334455
[NETWORK] IP: 192.168.1.120
[6/8] Initializing RFID...
[RFID] PN532 Firmware 1.6
[7/8] Initializing API...
[8/8] Preparing HTTP polling...
[POLL] HTTP polling configured (interval 5000 ms)
[POLL] Command polling enabled

[SYSTEM] All modules initialized successfully
[SYSTEM] System ready for operation

[RFID] Scanned: ABC123
[API] Scan queued (online)
✅ Registered: Juan Dela Cruz (driver)
```

If the backend is unreachable you will see `[API] WARNING: Backend not reachable` followed by `offlineMode = true`; the device keeps scanning and buffers requests for replay.

---

## 🔄 Migrating From WebSocket Builds

- Remove the old `WebSocketModule.h/.cpp` (already deleted in this repo).
- Ensure `Config.h` no longer declares `WS_*` macros (they were all removed).
- Flash the new firmware; no changes to wiring, keypad shortcuts, or admin UI are required.
- Clear any custom PlatformIO build flags that referenced the WebSocket client.

---

## 🛠️ Troubleshooting

- **`[POLL] Command poll failed`** – Check WiFi signal, API base URL, and Cloudflare Worker status. Consecutive failures trigger offline mode after `MAX_CONSECUTIVE_FAILURES`.
- **`offlineMode = true`** – Firmware will queue scans locally; restore connectivity to drain the buffer.
- **Registration mode does not toggle** – Confirm the Admin Panel shows the device online and that `COMMAND_POLL_INTERVAL` is not set too high.
- **Heartbeat 401/403** – Provision a valid device API key in the admin portal and place it in `API_DEFAULT_KEY` or via the serial configuration menu.

Run `npm run dev` inside `backend-workers/` to emulate the Cloudflare Worker locally while testing.

---

## 📏 Performance & Footprint

- Flash usage: ~1.24 MB (≈63%) with Minimal SPIFFS partition.
- RAM usage: ~50 KB globals; plenty of headroom for JSON buffers and UI caching.
- Command polling footprint: <1 KB per request, designed for metered LTE hotspots.
- Removing the WebSocket library recovered enough space to keep OTA and TFT features enabled simultaneously.

For further flash savings, see `OPTIMIZATION_GUIDE.md` and `QUICK_OPTIMIZATION.md` (already updated for the HTTP-only stack).

---

## 🎉 Success Criteria

You are good to deploy when:

- Serial monitor shows `[POLL] Command polling enabled` and `offlineMode` remains false during normal operation.
- RFID scans return driver data within 300–500 ms over WiFi.
- Admin dashboard toggles registration mode and the device reflects the change within one polling interval.
- Heartbeat logs appear in the backend audit trail every 30 seconds.

---

## 📝 Version History

- **v3.1.0** – HTTP polling refactor, WebSocket removal, documentation refresh.
- **v3.0.0** – Experimental WebSocket build (deprecated).
- **v2.0.0** – Modular firmware rewrite with REST API integration.
- **v1.0.0** – Initial prototype.

---

**Ready to flash!** Connect your ESP32, select the correct board/port, and upload. Happy scanning! ✨
