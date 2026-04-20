# ESP32 Firmware Optimization Guide

**Current Status:** 1,263,215 bytes (96%) - CRITICAL ⚠️  
**Target:** Reduce to <90% (1,179,648 bytes) for safe operation

---

## Quick Wins (Implement First)

### 1. ✅ Reduce Logging (Expected: ~20-30 KB savings)

**In `Config.h`, change line ~278:**

```cpp
// BEFORE (Debug mode - verbose)
#define CURRENT_LOG_LEVEL LOG_LEVEL_DEBUG

// AFTER (Production mode - errors only)
#define CURRENT_LOG_LEVEL LOG_LEVEL_ERROR
```

Or for maximum savings:

```cpp
#define CURRENT_LOG_LEVEL LOG_LEVEL_NONE
```

This removes all Serial.println debug statements from compilation.

---

### 2. ✅ Silent Assertions (Expected: ~5-10 KB savings)

**Add to `Config.h` (near top, after includes):**

```cpp
// Disable assertion strings to save flash
#define CONFIG_COMPILER_OPTIMIZATION_ASSERTION_LEVEL 2  // Silent
#define NDEBUG  // Disable assert() completely
```

---

### 3. ✅ Use PROGMEM for Constant Strings (Expected: ~10-20 KB savings)

**Add to `Config.h` after includes:**

```cpp
// Store strings in flash memory (PROGMEM) instead of RAM
#define F(string_literal) (reinterpret_cast<const __FlashStringHelper *>(PSTR(string_literal)))
```

**Then replace ALL Serial.println() string literals:**

```cpp
// BEFORE
Serial.println("[WIFI] Connecting...");

// AFTER
Serial.println(F("[WIFI] Connecting..."));
```

**Tool to help:** Search and replace in all .cpp/.ino files:

- Find: `Serial.println("`
- Replace: `Serial.println(F("`
- Find: `Serial.print("`
- Replace: `Serial.print(F("`

---

### 4. ✅ Remove Unused Display Features (Expected: ~15-25 KB savings)

**If not using certain TFT features, comment out in DisplayModule.cpp:**

```cpp
// Comment out complex graphics functions you don't use
// void showKeypadMenu() { ... }
// void displayKeypadPrompt() { ... }
// void indicateRegistrationTagDetected() { ... }
```

---

## Medium Impact Optimizations

### 5. ⚙️ Conditional Debug Code (Expected: ~10-15 KB savings)

**Wrap all debug-only code:**

```cpp
#define ENABLE_DEBUG_FEATURES 0  // Add to Config.h

#if ENABLE_DEBUG_FEATURES
  // Debug code here
  Serial.println(F("[DEBUG] ..."));
  printMemoryStats();
#endif
```

---

### 6. ⚙️ Reduce JSON Buffer Sizes (Expected: ~5-10 KB savings)

**In ApiModule.cpp, reduce buffer sizes:**

```cpp
// BEFORE
DynamicJsonDocument doc(2048);

// AFTER (if you know max size)
DynamicJsonDocument doc(512);  // or StaticJsonDocument<512>
```

Use `StaticJsonDocument` instead of `DynamicJsonDocument` where possible.

---

### 7. ⚙️ Disable Offline Scan Queue (Expected: ~10-15 KB savings)

**If the backend is always available (stable WiFi + Cloudflare Worker), you can remove the offline buffer:**

```cpp
// In Config.h
#define FEATURE_OFFLINE_MODE false
#define MAX_SCAN_QUEUE_SIZE 0
```

Then prune the queue handling code paths in `ApiModule.cpp` and `TagSakay_Fixed_Complete.ino` (search for `offlineMode` and `scanQueue`).

---

## Advanced Optimizations

### 8. 🔧 Compiler Optimization Flags

**Arduino IDE:**

1. Create `platform.local.txt` in:  
   `C:\Users\{YourName}\AppData\Local\Arduino15\packages\esp32\hardware\esp32\{version}\`

2. Add:

```ini
compiler.c.extra_flags=-Os -ffunction-sections -fdata-sections
compiler.cpp.extra_flags=-Os -ffunction-sections -fdata-sections
compiler.c.elf.extra_flags=-Wl,--gc-sections
```

**Expected savings: ~20-30 KB**

---

### 9. 🔧 Remove Error Strings (Expected: ~5-10 KB savings)

```cpp
// In Config.h, disable ESP error string lookup
#define CONFIG_ESP_ERR_TO_NAME_LOOKUP 0
```

---

### 10. 🔧 Optimize WiFi (Expected: ~10-15 KB savings)

**If not using these features:**

```cpp
// In Config.h or before WiFi.begin()
#define CONFIG_ESP_WIFI_ENABLE_WPA3_SAE false
#define CONFIG_ESP_WIFI_SOFTAP_SUPPORT false  // If not using AP mode
```

---

## Nuclear Options (Last Resort)

### 11. 💣 Remove TFT Display Support (Expected: ~80-100 KB savings)

If you can use only serial debugging:

```cpp
// In Config.h
#define ENABLE_TFT_DISPLAY 0

// Wrap all TFT code in #if ENABLE_TFT_DISPLAY
```

---

### 12. 💣 Simplify RFID Module (Expected: ~20-30 KB savings)

Remove unused PN532 features in `RFIDModule.cpp`:

- SAM configuration options
- Mifare authentication code (if only reading UIDs)
- Peer-to-peer mode

---

### 13. 💣 Use Minimal ArduinoJson (Expected: ~10-15 KB savings)

Add to platformio.ini or before ArduinoJson include:

```cpp
#define ARDUINOJSON_ENABLE_STD_STRING 0
#define ARDUINOJSON_ENABLE_STD_STREAM 0
#define ARDUINOJSON_USE_LONG_LONG 0
```

---

## Implementation Priority

### Phase 1: Safe Changes (No Feature Loss)

1. ✅ Reduce logging level → ~25 KB saved
2. ✅ Silent assertions → ~7 KB saved
3. ✅ Compiler flags → ~25 KB saved
   **Total: ~57 KB saved (Target: <90%)**

### Phase 2: If Still Need More

4. ⚙️ PROGMEM strings → ~15 KB saved
5. ⚙️ JSON buffer optimization → ~8 KB saved
6. ⚙️ Remove unused display functions → ~20 KB saved
   **Total: ~100 KB saved (Safe zone)**

### Phase 3: Emergency Only

7. 💣 Consider removing LED matrix or TFT display modules

---

## Verification Commands

After each change, compile and check:

```
Sketch uses XXXXX bytes (XX%) of program storage space.
```

Target: Get below **1,180,000 bytes (90%)**

---

## Current File Sizes (Estimated)

| Component       | Size    | Can Reduce?               |
| --------------- | ------- | ------------------------- |
| Core ESP32 libs | ~200 KB | ❌ No                     |
| WiFi/HTTP stack | ~260 KB | ⚙️ Maybe (tune polling)   |
| TFT Display     | ~100 KB | ⚠️ Yes (simplify/remove)  |
| ArduinoJson     | ~50 KB  | ✅ Yes (optimize)         |
| RFID (PN532)    | ~80 KB  | ⚠️ Yes (simplify)         |
| Your code       | ~533 KB | ✅ Yes (logging, strings) |

---

## Notes

- **PROGMEM** moves strings from RAM to Flash, reducing RAM usage but not flash usage initially. However, it allows more aggressive compiler optimization.
- **-Os flag** is the most important single change (size optimization)
- Test thoroughly after each optimization
- Keep a backup before making changes

---

## ESP32 Partition Scheme

If optimizations aren't enough, consider changing partition scheme in Arduino IDE:

**Tools → Partition Scheme:**

- Default: 1.2 MB app
- **Minimal SPIFFS:** 1.9 MB app ⭐ Use this!
- **No OTA:** 2 MB app (if no over-the-air updates)

This gives you more flash space for your application.
