/*
 * TagSakay RFID Scanner - Production Ready Version (HTTP Polling)
 * 
 * Modular architecture with comprehensive error handling,
 * state management, automatic recovery, and command polling over HTTP.
 * 
 * Version: 3.1.0
 * Features: REST-first workflow with periodic command polling.
 */

#include "Config.h"
#include "DisplayModule.h"
#include "NetworkModule.h"
#include "RFIDModule.h"
#include "KeypadModule.h"
#include "UARTModule.h"
#include "BuzzerModule.h"
#include "ApiModule.h"
#include "HTTPPolling.h"
#include <map>
#include <cstring>
#include <SPIFFS.h>
#include <FS.h>

namespace {
  const char* EXPECTED_DEVICE_ID = "80F3DA4C46A4";
  bool deviceIdOverrideLogged = false;

  String resolveDeviceId() {
    String detected = getDeviceMacAddress();
    String normalized = detected;
    normalized.toUpperCase();

    if (!normalized.equals(EXPECTED_DEVICE_ID)) {
      if (!deviceIdOverrideLogged) {
        Serial.print("[SYSTEM] Detected MAC ");
        Serial.print(normalized);
        Serial.print(" - overriding with expected device ID ");
        Serial.println(EXPECTED_DEVICE_ID);
        deviceIdOverrideLogged = true;
      }
      return String(EXPECTED_DEVICE_ID);
    }

    return normalized;
  }
  }

// Configuration instances (definitions)
WiFiConfig wifiConfig = {
  "SSID",           // Replace with your WiFi SSID
  "Password",       // Replace with your WiFi password
  10,               // Max reconnection attempts
  5000              // Retry delay (ms)
};

ServerConfig serverConfig = {
  "https://tagsakay-api-production.maskedmyles.workers.dev",  // Production backend URL
  "",  // Device API key (set in Config.h or via Serial menu)
  10000,  // HTTP timeout (ms)
  "Entrance Gate"  // Device location (configurable)
};

NTPConfig ntpConfig = {
  "pool.ntp.org",
  8 * 3600,
  0
};

// Device configuration
DeviceConfig deviceConfig = {
  DEVICE_NAME,
  "Entrance Gate",  // Will be set based on serverConfig
  FIRMWARE_VERSION,
  false,  // registrationMode
  false,  // scanMode
  LED_BRIGHTNESS_DEFAULT,
  MIN_SCAN_INTERVAL
};

// System status tracking
SystemStatus systemStatus = {
  false,  // wifiConnected
  false,  // rfidInitialized
  false,  // apiConnected
  false,  // offlineMode
  0,      // uptime
  0,      // freeHeap
  0,      // scanCount
  0,      // errorCount
  0       // lastHeartbeat
};

// Global state variables (definitions)
String deviceId = "";
String lastScannedTag = "";
bool registrationMode = false;
bool operationMode = false; // New Operation Mode flag
bool queuePanelVisible = false; // Queue panel display state
std::map<String, int> queueStates; // Queue state tracking
std::map<String, String> queueIdentifiers; // Map tagId -> Unit Number/Identifier
#define MAX_QUEUE_SLOTS 40
String queueSlots[MAX_QUEUE_SLOTS]; // Fixed slots for queue display
int nextQueueSlot = 0; // Next slot to insert into
String expectedRegistrationTagId = "";
unsigned long lastRegistrationCheck = 0;
unsigned long registrationModeStartTime = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastScanTime = 0;
unsigned long lastNetworkCheck = 0;
unsigned long scanCooldownUntil = 0;
unsigned long heartbeatFlashUntil = 0;
const unsigned long NETWORK_CHECK_INTERVAL = 2000; // Check network every 2 seconds
const unsigned long QUEUE_TRANSITION_FLASH_MS = 150; // Visual delay for WAITING -> ONGOING -> CLEAR
const unsigned long SCAN_POST_COOLDOWN_MS = 200;
const unsigned long HEARTBEAT_FLASH_MS = 100;

// Registration mode keypad buffer (renamed to avoid conflict with KeypadModule.cpp)
String registrationKeypadBuffer = "";
unsigned long lastRegistrationKeypadInput = 0;
#define KEYPAD_BUFFER_TIMEOUT 3000  // Clear buffer after 3 seconds of no input

struct RfidDetailState {
  bool detailsAvailable = false;
  bool lookupInProgress = false;
  bool lookupFailed = false;
  bool tagActive = false;
  bool userAssigned = false;
  bool userActive = false;
  int lastHttpCode = 0;
  String tagId = "";
  String unitNumber = "";
  String userName = "";
  String error = "";
};

RfidDetailState lastRfidDetails;

struct RfidDisplayStatus {
  String label;
  uint16_t color;
  String secondary;
};

// Module instances (using enhanced classes)
NetworkModule networkModule;
RFIDModule rfidModule;
ApiModule apiModule;
HTTPPollingModule pollingModule;

// System state
bool systemReady = false;
bool offlineMode = true;
bool servicesActivated = false;
bool activationInProgress = false;

// Function declarations
bool initializeSystem();
void handleSystemError(const char* component, const char* error);
void handleRFIDScanning();
void sendPeriodicHeartbeat();
void checkNetworkConnection();
void checkSerialCommands();
void resetRfidDetailState();
void updateRfidDetailState(const RfidDetailResult& result);
struct RfidDisplayStatus;
RfidDisplayStatus determineRfidDisplayStatus(const RfidDetailState& state);
RfidDisplayStatus lookupRfidDetails(const String& tagId);
void renderRfidDetailsForStatus(const RfidDisplayStatus& status, const String& fallbackTagId = "");
void renderRfidDetailsForStatus(const String& label, uint16_t color, const String& secondary, const String& fallbackTagId = "");
void updateStatusSectionFromDetail(const RfidDisplayStatus& status);
bool activateOnlineServices(bool showFeedback = true);
String handleQueueScan(const String& tagId);
// Forward declarations for queue override helpers (defined later in this file)
bool overrideQueueUnitByIdentifier(const String& oldIdentifier, const String& newIdentifier, bool firstOnly = true);
void setQueueUnitOverrideColor(const String& identifier, const String& overrideType);
bool overrideQueueUnitAtSlot(int slotIndex, const String& expectedOld, const String& newIdentifier);
bool overrideQueueUnit(const String& oldIdentifier, const String& newIdentifier, bool firstOnly = true);
bool isOverrideActive();

// SPIFFS functions for offline tag data storage
void saveTagData(const String& tagId, const String& unitNumber, const String& userName);
bool loadTagData(const String& tagId, String& unitNumber, String& userName);

void setup(void) {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n================================");
  Serial.println("  TagSakay RFID Scanner v2.0");
  Serial.println("================================\n");

  // Initialize system with comprehensive error handling
  if (!initializeSystem()) {
    Serial.println("\n[SYSTEM] FATAL: Initialization failed!");
    Serial.println("[SYSTEM] Entering safe mode - limited functionality");
    
    updateStatusSection("INIT FAILED", TFT_RED);
    updateFooter("System in safe mode");
    
    // Don't halt - allow manual recovery
    systemReady = false;
    offlineMode = true;
  } else {
    Serial.println("\n[SYSTEM] All modules initialized successfully");
    Serial.println("[SYSTEM] System ready for operation");
    Serial.println("[SYSTEM] Press 'A' on keypad for menu\n");
    Serial.println("[SYSTEM] Manual activation required before network activity\n");
    
    systemReady = true;
    indicateReady();  // Now clears scan section internally
    updateStatusSection("WAITING ACTIVATION", TFT_CYAN);
    updateFooter("Press A to open menu");
    sendToLEDMatrix("STATUS", "WAITING", "");
  }

  resetRfidDetailState();
}

bool initializeSystem() {
  bool allSuccess = true;

  LOG_INFO("System initialization started");

  // 1. Initialize Display (first for visual feedback)
  Serial.println("[1/6] Initializing Display...");
  initializeTFT();
  delay(500);

  // 2. Initialize UART
  Serial.println("[2/6] Initializing UART...");
  initializeUART();
  updateStatusSection("UART: OK", TFT_GREEN);
  delay(500);

  // 3. Initialize Buzzer (optional hardware add-on)
  Serial.println("[3/6] Initializing Buzzer...");
  if (initializeBuzzer()) {
    updateStatusSection("Buzzer: OK", TFT_GREEN);
    Serial.println("[BUZZER] Active buzzer ready on GPIO" + String(BUZZER_PIN));
  } else {
    updateStatusSection("Buzzer: Disabled", TFT_ORANGE);
    Serial.println("[BUZZER] Skipping buzzer initialization (pin disabled)");
  }
  delay(300);

  // 4. Initialize Keypad
  Serial.println("[4/6] Initializing Keypad...");
  initializeKeypad();
  updateStatusSection("Keypad: OK", TFT_GREEN);
  delay(500);

  // 5. Prepare standby state and identify device
  Serial.println("[5/6] Preparing standby state...");
  deviceId = resolveDeviceId();
  systemStatus.wifiConnected = false;
  systemStatus.apiConnected = false;
  systemStatus.offlineMode = true;

  String deviceDisplay = deviceId;
  updateConnectionStatus("Inactive", "Manual", deviceDisplay);
  updateStatusSection("AWAIT ACTIVATION", TFT_CYAN);
  delay(300);

  // 6. Initialize RFID (critical component)
  Serial.println("[6/7] Initializing RFID...");
  updateStatusSection("Init RFID...", TFT_YELLOW);

  if (!rfidModule.initialize()) {
    handleSystemError("RFID", "PN532 not found");
    allSuccess = false;
    systemStatus.rfidInitialized = false;
  } else {
    updateStatusSection("RFID: OK", TFT_GREEN);
    Serial.println("[RFID] " + rfidModule.getFirmwareVersion());
    systemStatus.rfidInitialized = true;
  }
  delay(500);

  systemStatus.uptime = millis();
  systemStatus.freeHeap = ESP.getFreeHeap();

  LOG_INFO("Base system initialization completed");
  LOG_INFO("Free heap: " + String(systemStatus.freeHeap) + " bytes");

  // Initialize SPIFFS for offline tag data storage
  Serial.println("[7/7] Initializing SPIFFS...");
  if (!SPIFFS.begin(true)) {
    Serial.println("[SPIFFS] Failed to mount filesystem");
    updateStatusSection("SPIFFS FAIL", TFT_ORANGE);
  } else {
    Serial.println("[SPIFFS] Filesystem mounted successfully");
    updateStatusSection("SPIFFS OK", TFT_GREEN);
  }
  delay(500);

  return rfidModule.isInitialized() && allSuccess;
}

bool activateOnlineServices(bool showFeedback) {
  if (activationInProgress) {
    if (showFeedback) {
      updateFooter("Activation already running");
    }
    return false;
  }

  if (servicesActivated && !offlineMode && networkModule.isConnected() && apiModule.isInitialized()) {
    if (showFeedback) {
      updateFooter("Services already active");
    }
    return true;
  }

  activationInProgress = true;

  Serial.println("\n[ACTIVATION] Manual activation started");
  updateStatusSection("ACTIVATING...", TFT_YELLOW);
  if (showFeedback) {
    updateFooter("Connecting services...");
  }

  if (deviceId.length() == 0) {
    deviceId = resolveDeviceId();
  }
  String deviceDisplay = deviceId;

  bool wifiOk = false;
  bool apiInit = false;
  bool pollReady = false;

  WiFi.mode(WIFI_STA);

  Serial.println("[ACTIVATION] Connecting WiFi...");
  if (!networkModule.initialize(wifiConfig.ssid, wifiConfig.password)) {
    handleSystemError("NETWORK", "WiFi connection failed");
    updateConnectionStatus("Failed", "Manual", deviceDisplay);
    systemStatus.wifiConnected = false;
    wifiOk = false;
  } else {
    wifiOk = true;
    systemStatus.wifiConnected = true;
    updateStatusSection("WiFi: OK", TFT_GREEN);
    updateConnectionStatus("Connected", "Syncing...", deviceDisplay);
    Serial.print("[NETWORK] IP: ");
    Serial.println(networkModule.getIpAddress());
  }

  Serial.println("[ACTIVATION] Initializing API module...");
  if (wifiOk && apiModule.initialize(serverConfig.baseUrl, serverConfig.apiKey, deviceId)) {
    apiInit = true;
    systemStatus.apiConnected = true;
    updateStatusSection("API: OK", TFT_GREEN);
  } else {
    apiInit = false;
    systemStatus.apiConnected = false;
    if (wifiOk) {
      updateStatusSection("API INVALID", TFT_ORANGE);
      Serial.println("[API] Initialization failed. Check base URL/API key");
    }
  }

  pollingModule.begin(&networkModule, &apiModule, COMMAND_POLL_INTERVAL);

  if (wifiOk && apiModule.isInitialized() && pollingModule.isReady()) {
    pollReady = true;
    updateStatusSection("POLL READY", TFT_GREEN);
    Serial.println("[POLL] Command polling enabled");
    pollingModule.pollImmediate();
  } else if (!wifiOk) {
    updateStatusSection("POLL OFFLINE", TFT_ORANGE);
    Serial.println("[POLL] Polling unavailable - WiFi offline");
  } else {
    updateStatusSection("POLL DISABLED", TFT_ORANGE);
    Serial.println("[POLL] Polling unavailable - API offline");
  }

  if (wifiOk && apiModule.isInitialized()) {
    ApiResponse connCheck = apiModule.checkConnection();
    if (connCheck.result == API_SUCCESS) {
      offlineMode = false;
      systemStatus.apiConnected = true;
      updateStatusSection("API ONLINE", TFT_GREEN);
    } else {
      offlineMode = true;
      systemStatus.apiConnected = false;
      updateStatusSection("API OFFLINE", TFT_ORANGE);
      Serial.println("[API] Backend not reachable: " + connCheck.error);
    }
  } else {
    offlineMode = true;
  }

  if (wifiOk) {
    if (!offlineMode) {
      updateStatusSection("Syncing time...", TFT_YELLOW);
      if (!initializeTime()) {
        Serial.println("[TIME] Sync failed - continuing");
        updateConnectionStatus("Connected", "No sync", deviceDisplay);
      } else {
        updateConnectionStatus("Connected", "Synced", deviceDisplay);
      }
    } else {
      updateConnectionStatus("Connected", "Manual", deviceDisplay);
    }
  }

  servicesActivated = true;
  systemStatus.offlineMode = offlineMode;
  activationInProgress = false;

  bool success = wifiOk && !offlineMode;
  if (showFeedback) {
    if (success) {
      updateFooter("Services activated successfully");
    } else if (wifiOk && offlineMode) {
      updateFooter("API offline - operating in offline mode");
    } else {
      updateFooter("Activation failed - check WiFi/API");
    }
  }

  Serial.println("[ACTIVATION] Manual activation complete");
  Serial.print("[ACTIVATION] WiFi: ");
  Serial.println(wifiOk ? "OK" : "FAILED");
  Serial.print("[ACTIVATION] API: ");
  Serial.println(apiInit ? "OK" : "FAILED");
  Serial.print("[ACTIVATION] Polling: ");
  Serial.println(pollReady ? "READY" : "DISABLED");

  return success;
}

void handleSystemError(const char* component, const char* error) {
  Serial.print("[ERROR] ");
  Serial.print(component);
  Serial.print(": ");
  Serial.println(error);
  
  updateStatusSection(String(component) + " ERR", TFT_RED);
  updateFooter(String(error));
  sendToLEDMatrix("ERROR", String(component), "");
  buzzerErrorTone();
  
  delay(2000);
}

void loop(void) {
  if (!systemReady) {
    // Safe mode - minimal functionality
    handleKeypadInput();
    checkSerialCommands();
    delay(100);
    return;
  }

  // Check network connection and attempt reconnection when services are active
  if (servicesActivated && (millis() - lastNetworkCheck >= NETWORK_CHECK_INTERVAL)) {
    lastNetworkCheck = millis();
    checkNetworkConnection();
  }
  
  // Handle RFID scanning
  handleRFIDScanning();

  // Handle keypad input
  handleKeypadInput();
  
  // Check serial commands
  checkSerialCommands();

  unsigned long currentMillis = millis();

  if (heartbeatFlashUntil > 0 && currentMillis >= heartbeatFlashUntil) {
    showHeartbeat(false);
    heartbeatFlashUntil = 0;
  }
  
  // Check registration mode periodically (only if online)
  // Note: Registration mode is now controlled via HTTP command polling
  // TODO: Implement checkRegistrationModeFromServer() if polling is needed
  // if (!offlineMode && currentMillis - lastRegistrationCheck > 5000) {
  //   lastRegistrationCheck = currentMillis;
  //   checkRegistrationModeFromServer();
  // }
  
  // Send heartbeat and poll commands only after manual activation
  if (servicesActivated) {
    sendPeriodicHeartbeat();
    pollingModule.loop();
  }
  
  // Clear registration keypad buffer if timeout reached (prevents accidental commands)
  if (registrationKeypadBuffer.length() > 0 && (currentMillis - lastRegistrationKeypadInput > KEYPAD_BUFFER_TIMEOUT)) {
    registrationKeypadBuffer = "";
  }
  
  // Handle keypad timeout (skip if override is active)
  if (!isOverrideActive() && checkKeypadTimeout(currentMillis)) {
    Serial.println("[KEYPAD] Input timeout");
    clearKeypadInput();
    indicateReady();
  }

  // Check registration timeout
  if (registrationMode && (currentMillis - registrationModeStartTime > REGISTRATION_MODE_TIMEOUT)) {
    Serial.println("[REGISTRATION] Timeout reached");
    registrationMode = false;
    expectedRegistrationTagId = "";
    
    if (!offlineMode) {
      reportDeviceStatus("registration_timeout");
    }
    
    blinkError(3);
    updateStatusSection("REG TIMEOUT", TFT_RED);
    updateFooter("Registration mode timed out");
  }

  delay(5);
}

void resetRfidDetailState() {
  lastRfidDetails.detailsAvailable = false;
  lastRfidDetails.lookupInProgress = false;
  lastRfidDetails.lookupFailed = false;
  lastRfidDetails.tagActive = false;
  lastRfidDetails.userAssigned = false;
  lastRfidDetails.userActive = false;
  lastRfidDetails.lastHttpCode = 0;
  lastRfidDetails.tagId = "";
  lastRfidDetails.unitNumber = "";
  lastRfidDetails.userName = "";
  lastRfidDetails.error = "";
}

// SPIFFS functions for offline tag data storage
void saveTagData(const String& tagId, const String& unitNumber, const String& userName) {
  String filename = "/tag_" + tagId + ".txt";
  fs::File file = SPIFFS.open(filename, "w");
  if (file) {
    file.println(unitNumber);
    file.println(userName);
    file.close();
    Serial.println("[SPIFFS] Saved tag data: " + tagId + " -> " + unitNumber + " (" + userName + ")");
  } else {
    Serial.println("[SPIFFS] Failed to save tag data: " + tagId);
  }
}

bool loadTagData(const String& tagId, String& unitNumber, String& userName) {
  String filename = "/tag_" + tagId + ".txt";
  if (SPIFFS.exists(filename)) {
    fs::File file = SPIFFS.open(filename, "r");
    if (file) {
      unitNumber = file.readStringUntil('\n');
      unitNumber.trim();
      userName = file.readStringUntil('\n');
      userName.trim();
      file.close();
      Serial.println("[SPIFFS] Loaded tag data: " + tagId + " -> " + unitNumber + " (" + userName + ")");
      return true;
    }
  }
  return false;
}

void updateRfidDetailState(const RfidDetailResult& result) {
  lastRfidDetails.lookupInProgress = false;
  lastRfidDetails.lastHttpCode = result.httpCode;
  lastRfidDetails.error = result.error;
  lastRfidDetails.tagId = result.tagId;
  lastRfidDetails.detailsAvailable = result.success && result.detailsAvailable;
  lastRfidDetails.lookupFailed = !result.success;
  lastRfidDetails.tagActive = result.tagActive;
  lastRfidDetails.userAssigned = result.userAssigned;
  lastRfidDetails.userActive = result.userActive;
  lastRfidDetails.unitNumber = result.unitNumber;
  lastRfidDetails.userName = result.userName;
}

RfidDisplayStatus determineRfidDisplayStatus(const RfidDetailState& state) {
  RfidDisplayStatus status;
  status.label = "Tag detected";
  status.color = TFT_CYAN;
  status.secondary = "";

  if (state.lookupInProgress) {
    status.label = "Fetching details...";
    status.color = TFT_YELLOW;
    return status;
  }

  if (state.lookupFailed) {
    status.label = "Details unavailable";
    status.color = (state.lastHttpCode >= 500 || state.lastHttpCode == 0) ? TFT_RED : TFT_ORANGE;
    status.secondary = state.error.length() > 0 ? state.error : String("Try again");
    return status;
  }

  if (!state.detailsAvailable) {
    status.label = "Not registered";
    status.color = TFT_ORANGE;
    status.secondary = state.error.length() > 0 ? state.error : String("Ready for registration");
    return status;
  }

  // Details available
  if (!state.tagActive) {
    status.label = "Tag inactive";
    status.color = TFT_RED;
    status.secondary = state.error.length() > 0 ? state.error : String("Contact administrator");
    return status;
  }

  if (!state.userAssigned) {
    status.label = "Unassigned tag";
    status.color = TFT_ORANGE;
    status.secondary = String("Assign driver to tag");
    return status;
  }

  if (!state.userActive) {
    status.label = "Driver inactive";
    status.color = TFT_ORANGE;
    status.secondary = state.userName.length() > 0 ? state.userName : String("Contact administrator");
    return status;
  }

  status.label = "Driver active";
  status.color = TFT_GREEN;
  status.secondary = String("Access allowed");
  return status;
}

void renderRfidDetailsForStatus(const RfidDisplayStatus& status, const String& fallbackTagId) {
  if (lastRfidDetails.tagId.length() == 0 && fallbackTagId.length() > 0) {
    lastRfidDetails.tagId = fallbackTagId;
  }

  String displayTag = lastRfidDetails.tagId.length() > 0 ? lastRfidDetails.tagId : fallbackTagId;

  // In operation mode, don't overwrite the queue matrix display
  if (!operationMode) {
    updateRfidScanDetails(
      displayTag,
      lastRfidDetails.unitNumber,
      lastRfidDetails.userName,
      lastRfidDetails.tagActive,
      lastRfidDetails.userAssigned,
      lastRfidDetails.userActive,
      status.label,
      status.color,
      status.secondary
    );
  }
}

void renderRfidDetailsForStatus(const String& label, uint16_t color, const String& secondary, const String& fallbackTagId) {
  RfidDisplayStatus status;
  status.label = label;
  status.color = color;
  status.secondary = secondary;
  renderRfidDetailsForStatus(status, fallbackTagId);
}

void updateStatusSectionFromDetail(const RfidDisplayStatus& status) {
  String banner = status.label.length() > 0 ? status.label : String("TAG DETECTED");
  banner.toUpperCase();
  updateStatusSection(banner, status.color);
}

RfidDisplayStatus lookupRfidDetails(const String& tagId) {
  if (!offlineMode && apiModule.isInitialized()) {
    RfidDetailResult detailResult = apiModule.getRfidDetails(tagId);
    if (detailResult.tagId.length() == 0) {
      detailResult.tagId = tagId;
    }
    updateRfidDetailState(detailResult);

    // If successful, save to SPIFFS for offline use
    if (detailResult.success && detailResult.detailsAvailable && detailResult.tagActive) {
      saveTagData(tagId, detailResult.unitNumber, detailResult.userName);
    }
  } else {
    // Offline mode - try to load from SPIFFS cache
    String unitNumber, userName;
    if (loadTagData(tagId, unitNumber, userName)) {
      // Create successful result from cached data
      RfidDetailResult offlineResult;
      offlineResult.tagId = tagId;
      offlineResult.unitNumber = unitNumber;
      offlineResult.userName = userName;
      offlineResult.success = true;
      offlineResult.detailsAvailable = true;
      offlineResult.tagActive = true;
      offlineResult.userAssigned = true;
      offlineResult.userActive = true;
      offlineResult.error = "Loaded from cache";
      offlineResult.httpCode = 0;
      updateRfidDetailState(offlineResult);
    } else {
      // No cached data available
      RfidDetailResult offlineResult;
      offlineResult.tagId = tagId;
      offlineResult.error = offlineMode ? String("Offline mode - no cached data") : String("API unavailable");
      offlineResult.success = false;
      offlineResult.detailsAvailable = false;
      offlineResult.httpCode = 0;
      updateRfidDetailState(offlineResult);
    }
  }

  if (lastRfidDetails.tagId.length() == 0) {
    lastRfidDetails.tagId = tagId;
  }

  return determineRfidDisplayStatus(lastRfidDetails);
}

bool triggerNetworkReconnect(const char* reasonLabel, bool allowOfflineFallback) {
  if (!servicesActivated) {
    Serial.println("[NETWORK] Reconnect skipped - services inactive");
    return false;
  }

  if (reasonLabel && strlen(reasonLabel) > 0) {
    Serial.print("[NETWORK] ");
    Serial.print(reasonLabel);
    Serial.println(" - attempting reconnect...");
  } else {
    Serial.println("[NETWORK] Attempting reconnect...");
  }

  updateStatusSection("RECONNECTING", TFT_ORANGE);

  bool reconnected = networkModule.reconnect();
  if (reconnected) {
    Serial.println("[NETWORK] Reconnected successfully");
    updateStatusSection("RECONNECTED", TFT_GREEN);
    offlineMode = false;
    apiModule.resetFailureCount();
    
    String deviceDisplay = deviceId.length() >= 4 ? deviceId.substring(deviceId.length() - 4) : deviceId;
    updateConnectionStatus("Connected", "Synced", deviceDisplay);
    return true;
  }

  Serial.println("[NETWORK] Reconnection failed");

  if (allowOfflineFallback) {
    offlineMode = true;
    updateStatusSection("OFFLINE MODE", TFT_ORANGE);
  } else {
    updateStatusSection("RECONNECT FAIL", TFT_RED);
  }

  return false;
}

void checkNetworkConnection() {
  if (!servicesActivated) {
    return;
  }

  networkModule.updateConnectionStatus();
  
  if (!networkModule.isConnected() && !offlineMode) {
    triggerNetworkReconnect("Connection lost", true);
  }
}

void handleRFIDScanning() {
  if (!rfidModule.isInitialized()) {
    return;
  }

  const unsigned long now = millis();
  if (scanCooldownUntil > 0 && now < scanCooldownUntil) {
    return;
  }
  
  String tagId;
  if (rfidModule.scanWithDebounce(tagId, RFID_DEBOUNCE_MS)) {
    // Validate tag ID
    if (!IS_VALID_TAG_ID(tagId)) {
      LOG_ERROR("Invalid tag ID: " + tagId);
      return;
    }
    
    resetRfidDetailState();
    lastRfidDetails.lookupInProgress = true;
    lastRfidDetails.tagId = tagId;

    systemStatus.scanCount++;
    
    // Audio feedback for scan
    buzzerShortBeep();
    
    LOG_INFO("RFID Scanned: " + tagId);
    Serial.print("[RFID] Total scans: ");
    Serial.println(systemStatus.scanCount);
    
    // Update display
    updateStatusSection("TAG DETECTED", TFT_CYAN);
    updateRfidScanDetails(tagId, "", "", false, false, false, "Fetching details...", TFT_YELLOW);

    // Send to LED matrix
    sendToLEDMatrix("SCAN", tagId.substring(0, 8), "");

    RfidDisplayStatus detailStatus = lookupRfidDetails(tagId);
    renderRfidDetailsForStatus(detailStatus, tagId);
    updateStatusSectionFromDetail(detailStatus);

    // Sync tag data to LED Matrix SD card if we have valid details
    if (lastRfidDetails.detailsAvailable && lastRfidDetails.tagActive) {
      String unitNumber = lastRfidDetails.unitNumber.length() > 0 ? lastRfidDetails.unitNumber : tagId;
      String userName = lastRfidDetails.userName.length() > 0 ? lastRfidDetails.userName : "";
      
      // Send tag data to LED Matrix for SD card storage
      // Format: SYNC_DB|tagId|unitNumber,userName
      String syncData = unitNumber + "," + userName;
      sendToLEDMatrix("SYNC_DB", tagId, syncData);
      
      Serial.println("[SD SYNC] Sent tag data to LED Matrix: " + tagId + " -> " + unitNumber + " (" + userName + ")");
    }

    String queueEventType = "";
    if (operationMode) {
      queueEventType = handleQueueScan(tagId);
    }
    
    if (registrationMode) {
      // Handle registration mode scanning
      Serial.println();
      Serial.println("═══════════════════════════════════════");
      Serial.println("  REGISTRATION MODE - TAG DETECTED");
      Serial.println("  Tag ID: " + tagId);
      Serial.println("═══════════════════════════════════════");
      Serial.println();
      
      updateStatusSection("REGISTERING TAG", TFT_ORANGE);
      renderRfidDetailsForStatus("Registering tag...", TFT_YELLOW, "Please wait...", tagId);
      sendToLEDMatrix("REG", tagId.substring(0, 8), "WAIT");
      
      // Send registration request to backend via HTTP
      if (!offlineMode && apiModule.isInitialized()) {
        Serial.println("[HTTP] Sending registration request");
  ApiResponse response = apiModule.sendScan(tagId, deviceConfig.location);
        
        if (response.result == API_SUCCESS) {
          Serial.println("[✓] Tag registered successfully!");
          updateStatusSection("REGISTERED", TFT_GREEN);
          renderRfidDetailsForStatus("Registration complete", TFT_GREEN, "Scan next tag", tagId);
          sendToLEDMatrix("REG", "SUCCESS", "");
          indicateSuccess();
          apiModule.resetFailureCount();
          
          // Registration mode stays enabled for multiple registrations
          delay(2000);

          if (!offlineMode && apiModule.isInitialized()) {
            detailStatus = lookupRfidDetails(tagId);
            renderRfidDetailsForStatus(detailStatus, tagId);
            updateStatusSectionFromDetail(detailStatus);
          }
        } else {
          Serial.println("[✗] Registration failed: " + response.error);
          updateStatusSection("REG FAILED", TFT_RED);
          renderRfidDetailsForStatus("Registration failed", TFT_RED, response.error, tagId);
          sendToLEDMatrix("REG", "FAILED", "");
          indicateError();
        }
      } else {
        Serial.println("[✗] Cannot register - offline mode");
        updateStatusSection("OFFLINE", TFT_RED);
        renderRfidDetailsForStatus("Cannot register", TFT_RED, "Offline mode", tagId);
        indicateError();
      }
    } else {
      // Normal scanning mode (HTTP only)
      if (!offlineMode && apiModule.isInitialized()) {
        Serial.println("[HTTP] Sending scan via REST endpoint");
        // Send to backend via HTTP
        ApiResponse response = apiModule.sendScan(
          tagId,
          deviceConfig.location,
          queueEventType
        );
        if (response.result == API_SUCCESS) {
          Serial.println("[API] Scan sent successfully");
          // Parse and handle response - for now just show success
          updateStatusSection("SCAN OK", TFT_GREEN);
          String successSecondary = detailStatus.secondary.length() > 0 ? detailStatus.secondary : String("Scan sent via HTTP");
          
          // Override display if in operation mode
          if (operationMode) {
             String queueDisplayEvent = queueEventType;
             if (queueDisplayEvent.length() == 0) {
               auto stateIt = queueStates.find(tagId);
               int fallbackState = (stateIt != queueStates.end()) ? stateIt->second : 0;
               queueDisplayEvent = (fallbackState == 2) ? "ongoing" : "ongoing";
             }

             uint16_t color = (queueDisplayEvent == "ongoing") ? TFT_GREEN : TFT_ORANGE;

             String stateStr = queueDisplayEvent;
             stateStr.toUpperCase();
             renderRfidDetailsForStatus("QUEUE: " + stateStr, color, successSecondary, tagId);
          } else {
             renderRfidDetailsForStatus(detailStatus.label, detailStatus.color, successSecondary, tagId);
          }
          apiModule.resetFailureCount();
        } else {
          Serial.println("[API] Failed to send scan");
          updateStatusSection("SCAN FAILED", TFT_RED);
          renderRfidDetailsForStatus("Scan not sent", TFT_ORANGE, response.error, tagId);
          
          systemStatus.errorCount++;
          
          if (apiModule.getConsecutiveFailures() >= MAX_CONSECUTIVE_FAILURES) {
            LOG_ERROR("Multiple API failures - switching to offline mode");
            offlineMode = true;
            systemStatus.offlineMode = true;
            systemStatus.apiConnected = false;
            updateFooter("Too many failures - offline mode");
          }
        }
      } else {
        // Offline mode - just display
        Serial.println("[OFFLINE] Scan recorded locally");
        updateStatusSection("OFFLINE SCAN", TFT_ORANGE);
        renderRfidDetailsForStatus(detailStatus.label, detailStatus.color, "Backend unavailable", tagId);
        updateFooter("Offline scan: " + tagId.substring(0, 8));
        
        // Send OFFLINE_SCAN command to Matrix
        // The Matrix will check its SD card database and handle the queue logic if found
        sendToLEDMatrix("OFFLINE_SCAN", tagId, "");
      }
    }
    
    scanCooldownUntil = millis() + SCAN_POST_COOLDOWN_MS;
  }
}

void sendPeriodicHeartbeat() {
  if (!servicesActivated || isOverrideActive()) {
    return;
  }

  unsigned long currentMillis = millis();
  
  if (currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = currentMillis;
    
    if (!offlineMode && networkModule.isConnected()) {
      ApiResponse response = apiModule.sendHeartbeat(true);
      if (response.result == API_SUCCESS) {
        Serial.println("[HEARTBEAT] Sent successfully");
        showHeartbeat(true);
        heartbeatFlashUntil = millis() + HEARTBEAT_FLASH_MS;
      } else {
        Serial.println("[HEARTBEAT] Failed");
        // Note: incrementFailureCount() doesn't exist, using resetFailureCount() instead
        // or just log the error
      }
    } else {
      Serial.println("[HEARTBEAT] Skipped - offline mode");
    }
    
    // Update connection status display
    String wifiStatus = networkModule.isConnected() ? "Connected" : "Disconnected";
    String deviceDisplay = deviceId.length() >= 4 ? deviceId.substring(deviceId.length() - 4) : deviceId;
    updateConnectionStatus(wifiStatus, "Synced", deviceDisplay);
  }
}

void checkSerialCommands() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.equalsIgnoreCase("registration")) {
      registrationMode = !registrationMode;
      
      Serial.println();
      Serial.println("═══════════════════════════════════════");
      Serial.print("  REGISTRATION MODE: ");
      Serial.println(registrationMode ? "ENABLED ✓" : "DISABLED ✗");
      Serial.println("  (You can also use ### on keypad)");
      Serial.println("═══════════════════════════════════════");
      Serial.println();

      if (registrationMode) {
        registrationModeStartTime = millis();
        indicateRegistrationMode();
        updateStatusSection("REGISTRATION MODE", TFT_ORANGE);
        updateFooter("Scan tag to register");
        sendToLEDMatrix("REG", "MODE", "ACTIVE");
      } else {
        updateStatusSection("NORMAL MODE", TFT_GREEN);
        updateFooter("Ready to scan");
        sendToLEDMatrix("READY", "", "");
      }
    } else if (command.equalsIgnoreCase("activate")) {
      Serial.println("[SERIAL] Manual activation requested");
      activateOnlineServices(true);
      refreshMenuPanel();
    } else if (command.startsWith("override ")) {
      // Format: override <oldIdentifier> <newIdentifier>
      int firstSpace = command.indexOf(' ');
      String args = command.substring(firstSpace + 1);
      args.trim();
      int sep = args.indexOf(' ');
      if (sep > 0) {
        String oldId = args.substring(0, sep);
        String newId = args.substring(sep + 1);
        oldId.trim(); newId.trim();
        bool ok = overrideQueueUnitByIdentifier(oldId, newId, true);
        Serial.println(ok ? "[OVERRIDE] Replaced identifier" : "[OVERRIDE] Identifier not found");
      } else {
        Serial.println("[OVERRIDE] Usage: override <oldIdentifier> <newIdentifier>");
      }
    } else if (command.startsWith("color ")) {
      // Format: color <identifier> <type>
      int firstSpace = command.indexOf(' ');
      String args = command.substring(firstSpace + 1);
      args.trim();
      int sep = args.indexOf(' ');
      if (sep > 0) {
        String id = args.substring(0, sep);
        String type = args.substring(sep + 1);
        id.trim(); type.trim();
        setQueueUnitOverrideColor(id, type);
        Serial.println("[OVERRIDE] Color command sent: " + id + " -> " + type);
      } else {
        Serial.println("[OVERRIDE] Usage: color <identifier> <type>");
      }
    }
  }
}

namespace {
  // Forward declare functions defined later in this anonymous namespace
  void removeQueueEntriesByIdentifier(const String& identifier) {
    if (identifier.length() == 0) {
      return;
    }

    for (auto it = queueIdentifiers.begin(); it != queueIdentifiers.end();) {
      if (it->second == identifier) {
        queueStates.erase(it->first);
        it = queueIdentifiers.erase(it);
      } else {
        ++it;
      }
    }
  }
}

// Queue management functions with external linkage
bool overrideQueueUnitByIdentifier(const String& oldIdentifier, const String& newIdentifier, bool firstOnly) {
  if (oldIdentifier.length() == 0 || newIdentifier.length() == 0) return false;

  bool replaced = false;
  for (int i = 0; i < MAX_QUEUE_SLOTS; i++) {
    String id = queueSlots[i];
    if (id.length() > 0 && id != "0" && id == oldIdentifier) {
      queueSlots[i] = newIdentifier;
      replaced = true;
      // If only want first occurrence replaced, break after replacement
      if (firstOnly) break;
    }
  }

  if (replaced) {
    // Update any reverse mappings in queueIdentifiers (tagId -> identifier) if present
    for (auto it = queueIdentifiers.begin(); it != queueIdentifiers.end(); ++it) {
      if (it->second == oldIdentifier) {
        it->second = newIdentifier;
      }
    }

    // Notify LED matrix and backend about the change
    refreshQueueCascade();
    // Also send an explicit state update so the matrix can color it appropriately if needed
    sendToLEDMatrix("QUEUE", newIdentifier, "MODE");
  }

  return replaced;
}

void setQueueUnitOverrideColor(const String& identifier, const String& overrideType) {
  if (identifier.length() == 0 || overrideType.length() == 0) return;
  String upper = overrideType;
  upper.toUpperCase();
  // Known override types: RESERVE -> purple, FIX -> amber, CLEAR/RESET to remove
  sendToLEDMatrix("QUEUE", identifier, upper);
}

// Public wrappers with external linkage so other modules (keypad/menu) can call them
bool overrideQueueUnit(const String& oldIdentifier, const String& newIdentifier, bool firstOnly) {
  if (oldIdentifier.length() == 0 || newIdentifier.length() == 0) return false;

  bool replaced = false;
  for (int i = 0; i < MAX_QUEUE_SLOTS; i++) {
    String id = queueSlots[i];
    if (id.length() > 0 && id != "0" && id == oldIdentifier) {
      queueSlots[i] = newIdentifier;
      replaced = true;
      if (firstOnly) break;
    }
  }

  if (replaced) {
    for (auto it = queueIdentifiers.begin(); it != queueIdentifiers.end(); ++it) {
      if (it->second == oldIdentifier) it->second = newIdentifier;
    }
    refreshQueueCascade();
    sendToLEDMatrix("QUEUE", newIdentifier, "MODE");
  }

  return replaced;
}

void setQueueUnitOverrideColorPublic(const String& identifier, const String& overrideType) {
  if (identifier.length() == 0 || overrideType.length() == 0) return;
  String upper = overrideType;
  upper.toUpperCase();
  sendToLEDMatrix("QUEUE", identifier, upper);
}

// Override a specific slot index (0-based). If expectedOld is non-empty, only replace when it matches.
bool overrideQueueUnitAtSlot(int slotIndex, const String& expectedOld, const String& newIdentifier) {
  if (slotIndex < 0 || slotIndex >= MAX_QUEUE_SLOTS) return false;
  String current = queueSlots[slotIndex];
  if (current.length() == 0) current = "0";
  if (expectedOld.length() > 0 && current != expectedOld) {
    return false;
  }
  queueSlots[slotIndex] = newIdentifier;

  // Update reverse mappings
  for (auto it = queueIdentifiers.begin(); it != queueIdentifiers.end(); ++it) {
    if (it->second == current) {
      it->second = newIdentifier;
    }
  }

  refreshQueueCascade();
  sendToLEDMatrix("QUEUE", newIdentifier, "MODE");
  return true;
}

void publishQueueSnapshot(const String& cascadeList) {
  if (
    !servicesActivated ||
    offlineMode ||
    !apiModule.isInitialized() ||
    !networkModule.isConnected()
  ) {
    return;
  }

  static unsigned long lastPublishAt = 0;
  const unsigned long now = millis();
  if (now - lastPublishAt < 250) {
    return;
  }
  lastPublishAt = now;

  ApiResponse response = apiModule.sendQueueSnapshot(
    cascadeList,
    queueSlots,
    MAX_QUEUE_SLOTS,
    operationMode
  );

  if (response.result != API_SUCCESS) {
    Serial.printf(
      "[QUEUE] Snapshot sync failed (HTTP %d)\n",
      response.httpCode
    );
  }
}

void refreshQueueCascade() {
  String cascadeList;
  // Estimate average slot token + delimiter to avoid repeated reallocations.
  cascadeList.reserve(MAX_QUEUE_SLOTS * 8);

  for (int i = 0; i < MAX_QUEUE_SLOTS; i++) {
    if (i > 0) {
      cascadeList += ",";
    }
    const String& slotValue = queueSlots[i];
    if (slotValue.length() == 0) {
      cascadeList += "0";
    } else {
      cascadeList += slotValue;
    }
  }

  sendToLEDMatrix("CASCADE", cascadeList, "");
  publishQueueSnapshot(cascadeList);

  // Display queue on TFT in operation mode
  if (operationMode) {
    showQueueMatrix(cascadeList);
  }
}

// Minimal global display picker used by keypad module to show the
// currently-selected cascade slot. Placed here so `MAX_QUEUE_SLOTS` and
// `queueSlots` are already defined and available.
void displayCascadePicker(int cursorIndex) {
  if (cursorIndex < 0) cursorIndex = 0;
  if (cursorIndex >= MAX_QUEUE_SLOTS) cursorIndex = MAX_QUEUE_SLOTS - 1;

  String val = queueSlots[cursorIndex];
  if (val.length() == 0 || val == "0") val = "-";

  displayKeypadPrompt("Slot " + String(cursorIndex + 1) + ":", val);
  updateFooter("Use 2/8/4/6 to move, # select, * cancel");
}

String handleQueueScan(const String& tagId) {
  // One-tap behavior: always append a new (green) occurrence for this tag
  // and automatically mark any earlier occurrences of the same identifier as completed (cyan).
  String identifier = lastRfidDetails.unitNumber;
  if (identifier.length() == 0) {
    identifier = tagId;
  }

  String eventType = "ongoing";

  // Mark previous occurrences (if any) as completed on the matrix
  for (int i = 0; i < MAX_QUEUE_SLOTS; i++) {
    String id = queueSlots[i];
    if (id.length() > 0 && id != "0" && id == identifier) {
      // Tell LED matrix this earlier slot is completed (will render cyan)
      sendToLEDMatrix("QUEUE", identifier, "COMPLETED");
    }
  }

  // Append the new occurrence into the next slot (this will be the new green entry)
  queueSlots[nextQueueSlot] = identifier;
  nextQueueSlot++;
  if (nextQueueSlot >= MAX_QUEUE_SLOTS) {
    nextQueueSlot = 0;
  }

  // Track presence and identifier mapping
  queueStates[tagId] = 1;
  queueIdentifiers[tagId] = identifier;

  // Notify LED matrix of the new ongoing entry (green)
  sendToLEDMatrix("QUEUE", identifier, "ONGOING");

  refreshQueueCascade();
  return eventType;
}

void clearQueueHalf(bool leftHalf) {
  int start = leftHalf ? 0 : (MAX_QUEUE_SLOTS / 2);
  int end = leftHalf ? (MAX_QUEUE_SLOTS / 2) : MAX_QUEUE_SLOTS;
  
  Serial.print("[QUEUE] Clearing ");
  Serial.print(leftHalf ? "LEFT" : "RIGHT");
  Serial.println(" half");
  
  for (int i = start; i < end; i++) {
    String id = queueSlots[i];
    if (id.length() > 0 && id != "0") {
      removeQueueEntriesByIdentifier(id);
      // Don't send CLEAR to preserve colors of remaining entries
      // sendToLEDMatrix("QUEUE", id, "CLEAR");
    }
    queueSlots[i] = "0";
  }
  
  refreshQueueCascade();
  updateStatusSection(leftHalf ? "LEFT CLEARED" : "RIGHT CLEARED", TFT_CYAN);
}

void clearEntireQueue() {
  Serial.println("[QUEUE] Wiping entire queue");
  for (int i = 0; i < MAX_QUEUE_SLOTS; i++) {
    String id = queueSlots[i];
    if (id.length() > 0 && id != "0") {
      sendToLEDMatrix("QUEUE", id, "CLEAR");
    }
    queueSlots[i] = "0";
  }

  queueStates.clear();
  queueIdentifiers.clear();
  refreshQueueCascade();
  updateStatusSection("QUEUE WIPED", TFT_CYAN);
}

