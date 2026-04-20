#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// =======================
// Phase 1 Optimizations
// =======================
// Disable assertion strings to save flash (~7 KB)
#define NDEBUG  // Disable assert() completely

// =======================
// ESP32 Pin Assignments
// =======================

// PN532 HSPI pins (TFT uses VSPI)
#define PN532_SCK 14
#define PN532_MISO 12
#define PN532_MOSI 13
#define PN532_SS 27

// UART Communication to LED Matrix ESP32 (one-way transmit)
#define UART_TX 17
#define UART_RX -1  // RX intentionally detached; frees GPIO16 for other peripherals
#define UART_BAUD 115200

// Active buzzer configuration (uses freed GPIO16)
#define BUZZER_PIN 16
#define BUZZER_ACTIVE_LEVEL HIGH
#define BUZZER_IDLE_LEVEL LOW

// 4x4 Keypad Matrix Pins
#define KEYPAD_ROWS 4
#define KEYPAD_COLS 4

// =======================
// TFT Color Definitions
// =======================

#define TFT_ORANGE 0xFD20
#define TFT_DARKGREEN 0x03E0
#define TFT_NAVY 0x000F
#define TFT_DARKGREY 0x7BEF
#define TFT_LIGHTGREY 0xC618
#define TFT_PURPLE 0x780F

// =======================
// Display Layout Constants
// =======================

#define SCREEN_WIDTH 480
#define SCREEN_HEIGHT 320

#define HEADER_HEIGHT 48
#define STATUS_SECTION_Y 56
#define STATUS_SECTION_HEIGHT 104
#define SCAN_SECTION_Y 170
#define SCAN_SECTION_HEIGHT 120
#define FOOTER_Y 290
#define FOOTER_HEIGHT 30

#define LEFT_MARGIN 12
#define RIGHT_MARGIN (SCREEN_WIDTH - 12)
#define CENTER_X (SCREEN_WIDTH / 2)

// =======================
// Timing Constants
// =======================

#define HEARTBEAT_INTERVAL 60000  // 60 seconds
#define COMMAND_POLL_INTERVAL 5000 // 5 seconds - poll server commands
#define REGISTRATION_MODE_TIMEOUT 120000  // 2 minutes
#define KEY_INPUT_TIMEOUT 5000  // 5 seconds
#define TEST_MODE_TIMEOUT 10000  // 10 seconds
#define RFID_DEBOUNCE_MS 1500  // 1.5 seconds
#define KEYPAD_DEBOUNCE_MS 300  // 300ms
// Legacy alias (kept for backward compatibility). Use HEARTBEAT_INTERVAL.
#define HEARTBEAT_INTERVAL_MS HEARTBEAT_INTERVAL
#define MENU_REMINDER_INTERVAL 30000  // 30 seconds

// =======================
// API Configuration
// =======================

// ⚠️  CHOOSE ONE: Comment/Uncomment the section you need
// LOCAL: For development with computer running "npm run dev"
// PRODUCTION: For live deployment to api.tagsakay.com

// ============================================================================
// 🔧 LOCAL DEVELOPMENT CONFIGURATION (UNCOMMENT THIS FOR LOCAL DEMO)
// ============================================================================
// Instructions:
// 1. Find your computer IP: Run "ipconfig" in command prompt
// 2. Replace "192.168.1.100" below with your actual IP (e.g., 192.168.1.50)
// 3. Make sure backend is running: cd backend-workers && npm run dev
// 4. Uncomment all lines in this section (delete //)
// 5. Comment out PRODUCTION section below
//
#define API_BASE_URL "http://192.168.1.100:8787"  // ← CHANGE TO YOUR IP + PORT
#define API_DEFAULT_KEY ""                   // No key needed for local dev
//
// ============================================================================

// ============================================================================
// 🚀 PRODUCTION CONFIGURATION (UNCOMMENT THIS FOR DEPLOYMENT)
// ============================================================================
// Instructions:
// 1. Obtain API key from admin panel: https://tagsakay-frontend.pages.dev
// 2. Uncomment all lines in this section (delete //)
// 3. Comment out LOCAL section above
// 4. Set API_DEFAULT_KEY to your actual device API key
// 5. Flash to ESP32 for production deployment
//
// #define API_BASE_URL "https://api.tagsakay.com"  // Production HTTP API
// #define API_DEFAULT_KEY ""                  // Set your device API key here
//
// ============================================================================

// Common API configuration (both local & production)
#define API_TIMEOUT_MS 5000
#define API_RETRY_ATTEMPTS 3
#define MAX_CONSECUTIVE_FAILURES 5

// =======================
// Network Configuration
// =======================

#define WIFI_RECONNECT_INTERVAL 30000  // 30 seconds
#define MAX_WIFI_RECONNECT_ATTEMPTS 10

// =======================
// RFID Configuration
// =======================

#define RFID_RETRY_ATTEMPTS 3
#define RFID_SCAN_TIMEOUT 50  // milliseconds

// =======================
// Error Codes
// =======================

#define ERROR_RFID_INIT_FAILED -1
#define ERROR_NETWORK_FAILED -2
#define ERROR_API_FAILED -3
#define ERROR_DISPLAY_FAILED -4

// =======================
// Test Mode Configuration
// =======================

// Alternative pin configuration for testing
#define ALT_KEYPAD_ROW_PINS {5, 19, 21, 22}
#define ALT_KEYPAD_COL_PINS {25, 26, 32, 33}

// =======================
// Device Configuration
// =======================

#define DEVICE_NAME "TagSakay Scanner"
#define DEVICE_VERSION "2.0"
#define FIRMWARE_VERSION "2.0.0"

// Production Device API Key Setup:
// 1. Login to admin panel at: https://tagsakay-frontend.pages.dev
// 2. Navigate to: Settings → API Keys Management
// 3. Click: "Create New API Key"
// 4. Provide:
//    - Name: "Gate Scanner #1" (or similar)
//    - Device ID: (auto-filled with MAC address when device registers)
//    - Permissions: ["scan", "register"]
// 5. Copy the API Key (shown only once!)
// 6. Set below in API_DEFAULT_KEY or configure via Serial menu

// =======================
// Memory & Performance
// =======================

#define LOW_MEMORY_THRESHOLD 10000  // bytes
#define MAX_SCAN_QUEUE_SIZE 100  // offline scan buffer
#define STATUS_REPORT_INTERVAL 300000  // 5 minutes
#define WATCHDOG_TIMEOUT 30000  // 30 seconds

// =======================
// LED Matrix Configuration
// =======================

#define LED_BRIGHTNESS_DEFAULT 100
#define LED_DISPLAY_DURATION 3000  // 3 seconds
#define LED_SCROLL_SPEED 50  // milliseconds per frame

// =======================
// TFT Display Configuration
// =======================

#define DISPLAY_TIMEOUT 300000  // 5 minutes (0 = never)
#define DISPLAY_BRIGHTNESS 255  // 0-255
#define SCREEN_SAVER_ENABLE false

// =======================
// Scan Configuration
// =======================

#define MIN_SCAN_INTERVAL 1000  // minimum 1 second between scans
#define MAX_TAG_ID_LENGTH 16
#define DUPLICATE_SCAN_WINDOW 3000  // 3 seconds

// =======================
// Queue System Configuration
// =======================

#define MAX_QUEUE_NUMBER 999
#define QUEUE_NUMBER_TIMEOUT 86400000  // 24 hours

// =======================
// Logging Configuration
// =======================

#define SERIAL_BAUD_RATE 115200
#define LOG_LEVEL_DEBUG 0
#define LOG_LEVEL_INFO 1
#define LOG_LEVEL_WARNING 2
#define LOG_LEVEL_ERROR 3
// Phase 1 Optimization: Reduced from LOG_LEVEL_INFO to LOG_LEVEL_ERROR (saves ~25 KB)
#define CURRENT_LOG_LEVEL LOG_LEVEL_ERROR

// =======================
// Feature Flags
// =======================

#define FEATURE_OFFLINE_MODE true
#define FEATURE_AUTO_RECONNECT true
#define FEATURE_LOCAL_STORAGE false  // SPIFFS/LittleFS not implemented yet
#define FEATURE_OTA_UPDATE false  // OTA not implemented yet
#define FEATURE_KEYPAD_MENU true
#define FEATURE_TEST_MODE true
#define FEATURE_LED_MATRIX true

// =======================
// Configuration Structures
// =======================

struct WiFiConfig {
  const char* ssid;
  const char* password;
  int maxRetries;
  unsigned long retryDelay;
};

struct ServerConfig {
  const char* baseUrl;
  const char* apiKey;
  int timeout;
  const char* deviceLocation;
};

struct NTPConfig {
  const char* ntpServer;
  long gmtOffset_sec;
  int daylightOffset_sec;
};

struct DeviceConfig {
  String name;
  String location;
  String version;
  bool registrationMode;
  bool scanMode;
  int ledBrightness;
  unsigned long scanInterval;
};

struct SystemStatus {
  bool wifiConnected;
  bool rfidInitialized;
  bool apiConnected;
  bool offlineMode;
  unsigned long uptime;
  uint32_t freeHeap;
  int scanCount;
  int errorCount;
  unsigned long lastHeartbeat;
};

// =======================
// Global Configuration Instances
// =======================

extern WiFiConfig wifiConfig;
extern ServerConfig serverConfig;
extern NTPConfig ntpConfig;
extern DeviceConfig deviceConfig;
extern SystemStatus systemStatus;

// =======================
// Global State Variables
// =======================

extern String deviceId;
extern String lastScannedTag;
extern bool registrationMode;
extern String expectedRegistrationTagId;
extern unsigned long lastRegistrationCheck;
extern unsigned long registrationModeStartTime;
extern unsigned long lastHeartbeat;
extern unsigned long lastScanTime;
extern bool offlineMode;

// =======================
// Utility Macros
// =======================

// Logging macros
#define LOG_DEBUG(msg) if(CURRENT_LOG_LEVEL <= LOG_LEVEL_DEBUG) { Serial.print("[DEBUG] "); Serial.println(msg); }
#define LOG_INFO(msg) if(CURRENT_LOG_LEVEL <= LOG_LEVEL_INFO) { Serial.print("[INFO] "); Serial.println(msg); }
#define LOG_WARNING(msg) if(CURRENT_LOG_LEVEL <= LOG_LEVEL_WARNING) { Serial.print("[WARNING] "); Serial.println(msg); }
#define LOG_ERROR(msg) if(CURRENT_LOG_LEVEL <= LOG_LEVEL_ERROR) { Serial.print("[ERROR] "); Serial.println(msg); }

// Memory check macro
#define CHECK_MEMORY() (ESP.getFreeHeap() > LOW_MEMORY_THRESHOLD)

// Timing helpers
#define MILLIS_OVERFLOW_SAFE(current, previous) ((current >= previous) ? (current - previous) : (ULONG_MAX - previous + current))

// Feature check macros
#define IS_FEATURE_ENABLED(feature) (feature == true)

// Validation macros
#define IS_VALID_QUEUE_NUMBER(num) ((num > 0) && (num <= MAX_QUEUE_NUMBER))
#define IS_VALID_TAG_ID(id) ((id.length() > 0) && (id.length() <= MAX_TAG_ID_LENGTH))

#endif // CONFIG_H