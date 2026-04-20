#include "KeypadModule.h"
#include "DisplayModule.h"
#include "NetworkModule.h"
#include "UARTModule.h"
#include "BuzzerModule.h"
#include "HTTPPolling.h"
#include "ApiModule.h"
#include "RFIDModule.h"
#include <map> // Include map for std::map usage

// Forward declaration for isOverrideActive
bool isOverrideActive();

// Keypad pin configuration
byte rowPins[KEYPAD_ROWS] = {25, 26, 32, 33};  // Rows 1-4 (matches working test sketch)
byte colPins[KEYPAD_COLS] = {5, 19, 21, 22};   // Cols 1-4 (keeps clear of TFT SPI pins)

// Keypad layout
char keys[KEYPAD_ROWS][KEYPAD_COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, KEYPAD_ROWS, KEYPAD_COLS);

// Keypad state variables
String keypadBuffer = "";
bool keypadActive = false;
bool keypadMenuActive = false;
bool keypadMenuVisible = false;
unsigned long keypadLastInput = 0;

// Override flow state (keypad-driven)
bool overrideActive = false;
int overrideStage = 0; // 0: inactive, 1: old id, 2: slot picker, 3: new id, 4: color select
String overrideOld = "";
String overrideNew = "";
int overrideCursor = 0;
int overrideSelectedSlot = -1;

extern bool offlineMode;
extern bool registrationMode;
extern bool operationMode; // New Operation Mode flag
extern std::map<String, int> queueStates; // Queue states map
extern std::map<String, String> queueIdentifiers; // Queue identifiers map
extern String expectedRegistrationTagId;
extern unsigned long registrationModeStartTime;
extern String registrationKeypadBuffer;
extern unsigned long lastRegistrationKeypadInput;
extern NetworkModule networkModule;
extern RFIDModule rfidModule;
extern ApiModule apiModule;
extern SystemStatus systemStatus;
extern HTTPPollingModule pollingModule;
extern DeviceConfig deviceConfig;
extern bool servicesActivated;
extern bool queuePanelVisible;
extern String queueSlots[40];
extern bool activateOnlineServices(bool showFeedback);
extern bool registrationMode;
extern unsigned long registrationModeStartTime;
extern String expectedRegistrationTagId;
extern bool offlineMode;
extern ApiModule apiModule;
extern bool operationMode;
extern bool keypadMenuActive;
extern bool keypadMenuVisible;
extern bool overrideActive;
extern int overrideStage;
extern int overrideCursor;
extern String overrideOld;
extern String overrideNew;
extern int overrideSelectedSlot;
extern String keypadBuffer;
extern bool keypadActive;
extern unsigned long keypadLastInput;

void resetRfidDetailState();
extern void clearQueueHalf(bool leftHalf);
extern void clearEntireQueue();
extern bool triggerNetworkReconnect(const char* reasonLabel, bool allowOfflineFallback);
// Externs for override helpers in main firmware
extern bool overrideQueueUnit(const String& oldIdentifier, const String& newIdentifier, bool firstOnly = true);
extern void setQueueUnitOverrideColorPublic(const String& identifier, const String& overrideType);
// Extern to render picker UI on TFT
extern void displayCascadePicker(int cursorIndex);
// Additional externs for slot-specific and identifier-based overrides and cascade refresh
extern bool overrideQueueUnitAtSlot(int slotIndex, const String& expectedOld, const String& newIdentifier);
extern bool overrideQueueUnitByIdentifier(const String& oldIdentifier, const String& newIdentifier, bool firstOnly = true);
extern void refreshQueueCascade();

void initializeKeypad() {
  Serial.println("[KEYPAD] Configuring legacy keypad interface...");

  for (int i = 0; i < KEYPAD_ROWS; ++i) {
    pinMode(rowPins[i], INPUT_PULLUP);
  }

  for (int j = 0; j < KEYPAD_COLS; ++j) {
    pinMode(colPins[j], OUTPUT);
    digitalWrite(colPins[j], HIGH);
  }

  delay(50);
  Serial.println("[KEYPAD] Ready on rows 25,26,32,33 and cols 5,19,21,22");
}

namespace {
  bool handleAdvancedKeypadCommand(char key) {
    lastRegistrationKeypadInput = millis();
    registrationKeypadBuffer += key;

    if (registrationKeypadBuffer.endsWith("###")) {
      registrationMode = !registrationMode;
      registrationKeypadBuffer = "";

      Serial.println();
      Serial.println("═══════════════════════════════════════");
      Serial.print("  REGISTRATION MODE: ");
      Serial.println(registrationMode ? "ENABLED ✓" : "DISABLED ✗");
      Serial.println("═══════════════════════════════════════");
      Serial.println();

      if (registrationMode) {
        registrationModeStartTime = millis();
        indicateRegistrationMode();
        updateStatusSection("REGISTRATION MODE", TFT_ORANGE);
        String waitHint = expectedRegistrationTagId.length() > 0
                             ? String("Target: ") + expectedRegistrationTagId.substring(0, expectedRegistrationTagId.length() > 8 ? 8 : expectedRegistrationTagId.length())
                             : String("Scan tag to register");
        updateFooter(waitHint);
        updateScanSection("", "Waiting for tag", expectedRegistrationTagId, TFT_MAGENTA);
        sendToLEDMatrix("REG", "MODE", "ACTIVE");
        resetRfidDetailState();
      } else {
        updateStatusSection("NORMAL MODE", TFT_GREEN);
        updateFooter("Ready to scan");
        sendToLEDMatrix("READY", "", "");
        resetRfidDetailState();
      }

      return true;
    }

    if (registrationKeypadBuffer.length() > 10) {
      registrationKeypadBuffer = registrationKeypadBuffer.substring(registrationKeypadBuffer.length() - 10);
    }

    if (key == 'C' && registrationKeypadBuffer.length() == 1) {
      Serial.println("[KEYPAD] Clearing pending registration tag");

      registrationKeypadBuffer = "";
      expectedRegistrationTagId = "";

      if (registrationMode) {
        registrationModeStartTime = millis();
        indicateRegistrationMode();
        updateStatusSection("REG READY", TFT_ORANGE);
        updateScanSection("", "Waiting for tag", "", TFT_MAGENTA);
        updateFooter("Scan next tag to register");
        sendToLEDMatrix("REG", "WAITING", "NEW");
      } else {
        updateStatusSection("REG MODE OFF", TFT_GREEN);
        updateFooter("Ready to scan");
        sendToLEDMatrix("READY", "", "");
      }

      if (!offlineMode) {
        updateDeviceMode(registrationMode, deviceConfig.scanMode, "");
      }

      return true;
    }

    if (key == '*') {
      if (operationMode && keypadBuffer.length() == 0) {
        bool success = triggerNetworkReconnect("Keypad manual reconnect", false);
        updateFooter(success ? "Reconnected via keypad" : "Reconnect failed");
        return true;
      }

      if (!offlineMode && apiModule.isInitialized()) {
        ApiResponse response = apiModule.sendHeartbeat(true);
        if (response.result == API_SUCCESS) {
          Serial.println("[HEARTBEAT] Manual heartbeat sent");
          updateStatusSection("HEARTBEAT OK", TFT_GREEN);
        } else {
          Serial.println("[HEARTBEAT] Failed");
          updateStatusSection("HEARTBEAT FAIL", TFT_RED);
        }
      } else {
        Serial.println("[HEARTBEAT] Offline mode");
        updateStatusSection("OFFLINE", TFT_ORANGE);
      }
    }

    return false;
  }
}

void handleKeypadInput() {
  char key = keypad.getKey();

  if (key) {
    Serial.print("Key pressed: ");
    Serial.println(key);

    buzzerShortBeep();

    recordMenuKey(key);

    keypadLastInput = millis();

    // During override mode, filter keys based on current stage
    if (overrideActive) {
      bool keyAllowed = false;
      if (overrideStage == 2) {
        // Slot picker: only navigation keys (2,4,6,8), select (#), and cancel (*)
        keyAllowed = (key == '2' || key == '4' || key == '6' || key == '8' || key == '#' || key == '*');
      } else if (overrideStage == 3) {
        // New ID entry: allow digits, confirm (#), and cancel (*)
        keyAllowed = ((key >= '0' && key <= '9') || key == '#' || key == '*');
      } else if (overrideStage == 4) {
        // Color selection: allow digits 1-3, confirm (#), and cancel (*)
        keyAllowed = ((key >= '1' && key <= '3') || key == '#' || key == '*');
      }
      
      if (!keyAllowed) {
        Serial.println("[KEYPAD] Key ignored during override mode");
        return;
      }
    }

    // When waiting for activation, allow 'A' to open menu, and menu interaction keys if menu is active
    if (!servicesActivated) {
      // Allow 'A' to open the menu and 'B' to toggle offline operation mode while waiting for activation
      if (key != 'A' && key != 'B' && !(keypadMenuActive && (key == '1' || key == 'D' || key == '#'))) {
        // Ignore all keys except 'A' (to open menu) and menu keys (1, D, #) when menu is active
        Serial.println("[KEYPAD] Key ignored - waiting for activation, press A to open menu");
        return;
      }
    }

    // Operation Mode Shortcuts (disabled during override)
    if (operationMode && !isOverrideActive()) {
      if (key == 'C') {
        Serial.println("[KEYPAD] Operation Mode: Clear Left Half");
        clearQueueHalf(true);
        return;
      }
      if (key == 'D') {
        Serial.println("[KEYPAD] Operation Mode: Clear Right Half");
        clearQueueHalf(false);
        return;
      }
    }

    // Queue panel close
    if (queuePanelVisible && key == '*') {
      hideQueuePanel();
      showKeypadMenu();
      return;
    }

    if (handleAdvancedKeypadCommand(key)) {
      return;
    }

    // When waiting for activation, 'A' key always opens menu; 'B' toggles operation mode offline
    if (!servicesActivated && key == 'A') {
      keypadMenuActive = true;
      keypadMenuVisible = true;
      showKeypadMenu();
      return;
    }

    if (!servicesActivated && key == 'B') {
      // Toggle operation mode, but stay offline (do not attempt network updates)
      operationMode = !operationMode;
      if (operationMode) {
        queueStates.clear(); // Reset queue states on enable
        queueIdentifiers.clear();
        offlineMode = true; // Force offline since services are not activated
        updateStatusSection("OPERATION MODE (OFFLINE)", TFT_CYAN);
        updateFooter("Offline queue mode active");
        sendToLEDMatrix("QUEUE", "MODE", "ACTIVE");
        refreshQueueCascade(); // Display the queue matrix
      } else {
        queueStates.clear(); // Clear queue states on disable
        queueIdentifiers.clear();
        // Keep offlineMode as-is unless the network is actually enabled later
        updateStatusSection("NORMAL MODE (OFFLINE)", TFT_GREEN);
        updateFooter("Offline normal mode");
        sendToLEDMatrix("READY", "", "");
        indicateReady(); // Restore normal scan display
      }
      return;
    }

    // Menu activation with A key (works when services are activated)
    if (key == 'A' && servicesActivated && !keypadMenuActive) {
      keypadMenuActive = true;
      keypadMenuVisible = true;
      showKeypadMenu();
      return;
    }

    if (keypadMenuActive) {
      handleKeypadMenuSelection(key);
    } else {
      processKeypadKey(key);
    }
  }
}

void processKeypadKey(char key) {
  // use file-scope overrideActive/overrideStage/overrideOld/overrideNew

  // If we're in the override slot-picker stage, handle navigation and cancel keys here
  if (overrideActive && overrideStage == 2) {
    if (key == '4') { // left
      if (overrideCursor % 5 > 0) overrideCursor--; // Move left within row
      refreshQueueCascade(); // Refresh display to show new cursor position
      updateFooter("Slot " + String(overrideCursor + 1) + " - Use 2/8/4/6 to move, # select, * cancel");
      return;
    } else if (key == '6') { // right
      if (overrideCursor % 5 < 4) overrideCursor++; // Move right within row
      refreshQueueCascade(); // Refresh display to show new cursor position
      updateFooter("Slot " + String(overrideCursor + 1) + " - Use 2/8/4/6 to move, # select, * cancel");
      return;
    } else if (key == '2') { // up
      if (overrideCursor >= 5) overrideCursor -= 5; // Move up one row
      refreshQueueCascade(); // Refresh display to show new cursor position
      updateFooter("Slot " + String(overrideCursor + 1) + " - Use 2/8/4/6 to move, # select, * cancel");
      return;
    } else if (key == '8') { // down
      if (overrideCursor < 35) overrideCursor += 5; // Move down one row
      refreshQueueCascade(); // Refresh display to show new cursor position
      updateFooter("Slot " + String(overrideCursor + 1) + " - Use 2/8/4/6 to move, # select, * cancel");
      return;
    } else if (key == '*') { // cancel override flow
      overrideActive = false;
      overrideStage = 0;
      keypadBuffer = "";
      keypadMenuActive = true;  // Restore menu since user was in menu when starting override
      showKeypadMenu();
      updateFooter("Override cancelled - menu active");
      return;
    }
  }

  if (key == '#') {
    // Confirm input
    if (overrideActive) {
      if (overrideStage == 1) {
        // Old ID entered, now show slot picker
        overrideOld = keypadBuffer;
        keypadBuffer = "";
        overrideStage = 2;
        overrideCursor = 0;
        overrideSelectedSlot = -1;
        displayCascadePicker(overrideCursor);
        updateFooter("Use 2/8/4/6 to move, # select, * cancel");
        return;
      } else if (overrideStage == 2) {
        // Confirm slot selection - get current value as old ID, then prompt for new ID
        // Convert row-major cursor position to column-major slot index
        int cursorRow = overrideCursor / 5;
        int cursorCol = overrideCursor % 5;
        overrideSelectedSlot = cursorCol * 8 + cursorRow;
        String currentValue = queueSlots[overrideSelectedSlot];
        if (currentValue.length() == 0 || currentValue == "0") {
          currentValue = ""; // Empty slot
        }
        overrideOld = currentValue;
        overrideStage = 3;
        keypadBuffer = "";
        displayKeypadPrompt("New Unit:", "");
        updateFooter("Enter new unit number, press #");
        return;
      } else if (overrideStage == 3) {
        // New ID entered, perform slot-specific override
        overrideNew = keypadBuffer;
        keypadBuffer = "";
        bool ok = overrideQueueUnitAtSlot(overrideSelectedSlot, overrideOld, overrideNew);
        if (ok) {
          updateStatusSection("OVERRIDE OK", TFT_GREEN);
          updateFooter("Slot " + String(overrideSelectedSlot + 1) + ": " + overrideOld + " -> " + overrideNew);
          // Proceed to color selection
          overrideStage = 4;
          displayKeypadPrompt("Color:1=RES 2=FIX 3=CLEAR", "");
        } else {
          updateStatusSection("OVERRIDE FAIL", TFT_RED);
          updateFooter("Slot mismatch or not found");
          // End override flow on failure
          overrideActive = false;
          overrideStage = 0;
          overrideOld = "";
          overrideNew = "";
          keypadBuffer = "";
          keypadMenuVisible = false;
          keypadMenuActive = false;
          hideKeypadMenu();
          if (operationMode) {
            updateStatusSection("OPERATION MODE", TFT_CYAN);
            updateFooter("Queue mode active");
          } else {
            indicateReady();
          }
        }
        return;
      }
    }
    // Non-override confirm: fallback to existing network override flow
    if (keypadBuffer.length() > 0 && !overrideActive) {
      Serial.print("Processing keypad input: ");
      Serial.println(keypadBuffer);

      processQueueOverride(keypadBuffer);
      clearKeypadInput();
    }
  } else if (key == '*') {
    // Cancel input
    Serial.println("Keypad input cancelled");
    clearKeypadInput();
    indicateReady();
  } else if (isDigit(key) && overrideActive) {
    // If we're in color selection stage, treat the digit as the color choice
    if (overrideActive && overrideStage == 4) {
      String choice = String(key);
      if (choice == "1") {
        setQueueUnitOverrideColorPublic(overrideNew, "RESERVE");
        updateStatusSection("COLOR: RESERVE", TFT_MAGENTA);
        updateFooter("Reserved " + overrideNew);
      } else if (choice == "2") {
        setQueueUnitOverrideColorPublic(overrideNew, "FIX");
        updateStatusSection("COLOR: FIX", TFT_ORANGE);
        updateFooter("Marked for fix: " + overrideNew);
      } else if (choice == "3") {
        setQueueUnitOverrideColorPublic(overrideNew, "CLEAR");
        updateStatusSection("COLOR: CLEARED", TFT_CYAN);
        updateFooter("Cleared override for " + overrideNew);
      } else {
        updateStatusSection("COLOR: INVALID", TFT_ORANGE);
        updateFooter("Invalid color choice");
      }
      // Show the selection for a moment before ending
      delay(1500);
      // End override flow
      overrideActive = false;
      overrideStage = 0;
      overrideOld = "";
      overrideNew = "";
      keypadBuffer = "";
      keypadMenuVisible = false;
      keypadMenuActive = false;
      hideKeypadMenu();
      if (operationMode) {
        updateStatusSection("OPERATION MODE", TFT_CYAN);
        updateFooter("Queue mode active");
        refreshQueueCascade(); // Update LED Matrix with new queue state
        // Re-open the menu for user convenience in operation mode
        showKeypadMenu(false);
      } else {
        indicateReady();
      }
      return;
    }

    // Add digit to buffer
    keypadBuffer += key;
    keypadActive = true;

    Serial.print("Current buffer: ");
    Serial.println(keypadBuffer);

    // Use appropriate prompt based on context
    if (overrideActive && overrideStage == 3) {
      displayKeypadPrompt("New ID:", keypadBuffer);
    } else {
      displayKeypadPrompt("Enter Queue #:", keypadBuffer);
    }
  }
}

void handleKeypadMenuSelection(char key) {
  if (!servicesActivated) {
    switch (key) {
      case '1':
      case 'D': {
        Serial.println("Menu: Activate system");
        activateOnlineServices(true);
        refreshMenuPanel();
        break;
      }
      case '#': {
        Serial.println("Menu: Exit");
        keypadMenuActive = false;
        hideKeypadMenu();
        updateFooter("Menu closed. Press A to reopen");
        Serial.println("Menu closed. Press 'A' to reactivate selections.");
        break;
      }
      default: {
        Serial.println("Menu: Activation required first");
        updateFooter("Activate system first");
        refreshMenuPanel();
        break;
      }
    }
    return;
  }

  switch (key) {
    case '1': {
      Serial.println("Menu: Send heartbeat");
      sendHeartbeat();
      refreshMenuPanel();
      break;
    }
    case '2': {
      bool enable = !registrationMode;
      Serial.print("Menu: Toggle registration mode -> ");
      Serial.println(enable ? "ON" : "OFF");

      if (enable) {
        if (updateDeviceMode(true, false)) {
          indicateRegistrationMode();
          updateScanSection("", "Waiting for tag", expectedRegistrationTagId, TFT_MAGENTA);
          sendToLEDMatrix("REG", "MODE", "ACTIVE");
          String waitHint = expectedRegistrationTagId.length() ? expectedRegistrationTagId.substring(0, 8) : String("NEW");
          sendToLEDMatrix("REG", "WAITING", waitHint);
          updateFooter("Registration mode enabled");
        } else {
          updateStatusSection("REG MODE FAIL", TFT_RED);
          updateFooter("Unable to enable registration mode");
        }
      } else {
        if (updateDeviceMode(false, true)) {
          updateStatusSection("REG MODE OFF", TFT_GREEN);
          updateScanSection("", "", "", TFT_WHITE);
          updateFooter("Registration mode disabled");
          sendToLEDMatrix("REG", "OFF", "");
          sendToLEDMatrix("READY", "", "");
        } else {
          updateStatusSection("REG MODE FAIL", TFT_RED);
          updateFooter("Unable to disable registration mode");
        }
      }

      refreshMenuPanel();
      break;
    }
    case 'B': { // New Operation Mode Toggle
      operationMode = !operationMode;
      Serial.print("Menu: Toggle operation mode -> ");
      Serial.println(operationMode ? "ON" : "OFF");

      if (operationMode) {
        queueStates.clear(); // Reset queue states on enable
        queueIdentifiers.clear();
        updateStatusSection("OPERATION MODE", TFT_CYAN);
        updateFooter("Queue mode active");
        sendToLEDMatrix("QUEUE", "MODE", "ACTIVE");
        refreshQueueCascade(); // Display the queue matrix
      } else {
        queueStates.clear(); // Clear queue states on disable
        queueIdentifiers.clear();
        updateStatusSection("NORMAL MODE", TFT_GREEN);
        updateFooter("Ready to scan");
        sendToLEDMatrix("READY", "", "");
        indicateReady(); // Restore normal scan display
      }
      refreshMenuPanel();
      break;
    }
    case '3': {
      Serial.println("Menu: Sync device profile");
      if (syncDeviceProfile()) {
        updateScanSection("", "", "", TFT_WHITE);
        updateFooter("Device profile synced");
      } else {
        updateStatusSection("SYNC FAILED", TFT_RED);
        updateFooter("Unable to sync device profile");
      }
      refreshMenuPanel();
      break;
    }
    case '4': {
      Serial.println("Menu: Poll server commands");
      bool success = pollingModule.pollImmediate();
      if (success) {
        updateStatusSection("POLL COMPLETE", TFT_GREEN);
        updateFooter("Commands processed");
      } else {
        updateStatusSection("POLL FAILED", TFT_RED);
        updateFooter("Command polling failed");
      }
      refreshMenuPanel();
      break;
    }
    case '5': {
      if (operationMode) {
        // Start matrix navigation override flow: show matrix with cursor
        Serial.println("Menu: Override unit (matrix navigation)");
        overrideActive = true;
        overrideStage = 2; // Skip to matrix navigation stage
        overrideCursor = 0; // Start at slot 0
        keypadBuffer = "";
        keypadMenuActive = false;  // Exit menu so navigation gets key presses
        hideKeypadMenu();  // Hide the menu to prevent confusion
        refreshQueueCascade(); // Show matrix with highlight
        updateFooter("Slot 1 - Use 2/8/4/6 to move, # select, * cancel");
      } else {
        Serial.println("Menu: System summary");
        showSystemSummaryPanel();
      }
      refreshMenuPanel();
      break;
    }
    case '6': {
      Serial.println("Menu: Network info");
      showNetworkInfoPanel();
      refreshMenuPanel();
      break;
    }
    case '7': {
      Serial.println("Menu: API stats");
      showApiDiagnosticsPanel();
      refreshMenuPanel();
      break;
    }
    case '8': {
      Serial.println("Menu: Last scan info");
      showLastScanPanel();
      refreshMenuPanel();
      break;
    }
    case '9': {
      Serial.println("Menu: Clear registration expectation");
      if (registrationMode) {
        expectedRegistrationTagId = "";
        pollingModule.clearPendingRegistrationTag(); // Clear local polling state
        registrationModeStartTime = millis();
        indicateRegistrationMode();
        updateScanSection("", "Waiting for tag", "", TFT_MAGENTA);
        updateFooter("Registration queue cleared");
        sendToLEDMatrix("REG", "WAITING", "NEW");
        if (!offlineMode) {
          updateDeviceMode(registrationMode, deviceConfig.scanMode, "");
        }
      } else {
        updateFooter("Registration mode inactive");
      }
      refreshMenuPanel();
      break;
    }
    case '*': {
      // Build current cascade
      String cascade = "";
      for (int i = 0; i < 40; i++) {
        if (i > 0) cascade += ",";
        String val = queueSlots[i];
        if (val.length() == 0) val = "0";
        cascade += val;
      }

      if (queuePanelVisible) {
        hideQueuePanel();
      } else {
        showQueuePanel(cascade);
      }
      queuePanelVisible = !queuePanelVisible;
      refreshMenuPanel();
      break;
    }
    case 'D': {
      Serial.println("Menu: Retry activation");
      activateOnlineServices(true);
      refreshMenuPanel();
      break;
    }
    case '#': {
      Serial.println("Menu: Exit");
      keypadMenuActive = false;
      hideKeypadMenu();
      updateFooter("Menu closed. Press A to reopen");
      Serial.println("Menu closed. Press 'A' to reactivate selections.");
      break;
    }
    default:
      Serial.println("Invalid menu selection");
      updateFooter("Invalid menu key");
      refreshMenuPanel();
      break;
  }
}

void processQueueOverride(const String& queueNumber) {
  Serial.print("Processing queue override for number: ");
  Serial.println(queueNumber);

  HTTPClient http;
  String url = String(serverConfig.baseUrl) + "/api/devices/" + deviceId + "/queue-override";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", serverConfig.apiKey);

  StaticJsonDocument<200> doc;
  doc["queueNumber"] = queueNumber.toInt();
  doc["reason"] = "Manual keypad override";

  String payload;
  serializeJson(doc, payload);

  Serial.println("Sending queue override request:");
  Serial.println(payload);

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    String response = http.getString();
    Serial.print("HTTP Response: ");
    Serial.println(httpCode);
    Serial.println(response);

    if (httpCode == 200) {
      updateStatusSection("OVERRIDE OK", TFT_GREEN);
      updateFooter("Queue override successful");
      sendToLEDMatrix("OVERRIDE", queueNumber, "");
    } else {
      updateStatusSection("OVERRIDE FAIL", TFT_RED);
      updateFooter("Queue override failed");
    }
  } else {
    Serial.print("HTTP Error: ");
    Serial.println(http.errorToString(httpCode));
    updateStatusSection("NET ERROR", TFT_RED);
    updateFooter("Network error during override");
  }

  http.end();
}

void clearKeypadInput() {
  keypadBuffer = "";
  keypadActive = false;
  keypadMenuActive = false;
}

bool checkKeypadTimeout(unsigned long currentMillis) {
  if (keypadActive && (currentMillis - keypadLastInput > KEY_INPUT_TIMEOUT)) {
    return true;
  }
  return false;
}

// Check if override mode is currently active
bool isOverrideActive() {
  return overrideActive;
}

// KeypadModule Class Implementation
KeypadModule::KeypadModule() 
  : keypad(nullptr), keypadBuffer(""), keypadActive(false), 
    keypadMenuActive(false), keypadLastInput(0), lastKey(0), lastKeyTime(0) {
  
  // Initialize key layout
  char defaultKeys[KEYPAD_ROWS][KEYPAD_COLS] = {
    {'1', '2', '3', 'A'},
    {'4', '5', '6', 'B'},
    {'7', '8', '9', 'C'},
    {'*', '0', '#', 'D'}
  };
  
  memcpy(keys, defaultKeys, sizeof(keys));
}

bool KeypadModule::initialize() {
  Serial.println("[KEYPAD] Initializing...");
  
  rowPins = new byte[KEYPAD_ROWS]{32, 33, 25, 26};
  colPins = new byte[KEYPAD_COLS]{4, 2, 15, 5};
  
  setupPins();
  
  keypad = new Keypad(makeKeymap(keys), rowPins, colPins, KEYPAD_ROWS, KEYPAD_COLS);
  keypad->setDebounceTime(50);
  
  Serial.println("[KEYPAD] Initialized successfully");
  return true;
}

void KeypadModule::setupPins() {
  for (int i = 0; i < KEYPAD_ROWS; i++) {
    pinMode(rowPins[i], INPUT_PULLUP);
  }
  for (int j = 0; j < KEYPAD_COLS; j++) {
    pinMode(colPins[j], OUTPUT);
    digitalWrite(colPins[j], HIGH);
  }
  delay(50);
}

char KeypadModule::getKey() {
  if (!keypad) {
    return 0;
  }
  
  char key = keypad->getKey();
  
  if (key) {
    unsigned long currentTime = millis();
    if (key != lastKey || (currentTime - lastKeyTime) > KEYPAD_DEBOUNCE_MS) {
      lastKey = key;
      lastKeyTime = currentTime;
      keypadLastInput = currentTime;
      return key;
    }
  }
  
  return 0;
}

void KeypadModule::reinitialize() {
  setupPins();
  if (keypad) {
    keypad->setDebounceTime(50);
  }
}

char KeypadModule::scanManual() {
  for (int col = 0; col < KEYPAD_COLS; col++) {
    for (int c = 0; c < KEYPAD_COLS; c++) {
      digitalWrite(colPins[c], (c == col) ? LOW : HIGH);
    }
    
    delayMicroseconds(100);
    
    for (int row = 0; row < KEYPAD_ROWS; row++) {
      if (digitalRead(rowPins[row]) == LOW) {
        // Reset all columns
        for (int c = 0; c < KEYPAD_COLS; c++) {
          digitalWrite(colPins[c], HIGH);
        }
        return keys[row][col];
      }
    }
  }
  
  // Reset all columns
  for (int c = 0; c < KEYPAD_COLS; c++) {
    digitalWrite(colPins[c], HIGH);
  }
  
  return 0;
}

bool KeypadModule::testColumn(int col, char* detectedKey) {
  if (col < 0 || col >= KEYPAD_COLS) {
    return false;
  }
  
  // Set all columns HIGH
  for (int c = 0; c < KEYPAD_COLS; c++) {
    digitalWrite(colPins[c], HIGH);
  }
  
  // Set target column LOW
  digitalWrite(colPins[col], LOW);
  
  unsigned long startTime = millis();
  while (millis() - startTime < TEST_MODE_TIMEOUT) {
    for (int row = 0; row < KEYPAD_ROWS; row++) {
      if (digitalRead(rowPins[row]) == LOW) {
        *detectedKey = keys[row][col];
        
        // Wait for key release
        while (digitalRead(rowPins[row]) == LOW) {
          delay(10);
        }
        
        // Reset columns
        for (int c = 0; c < KEYPAD_COLS; c++) {
          digitalWrite(colPins[c], HIGH);
        }
        
        return true;
      }
    }
    delay(50);
  }
  
  // Reset columns
  for (int c = 0; c < KEYPAD_COLS; c++) {
    digitalWrite(colPins[c], HIGH);
  }
  
  return false;
}

void KeypadModule::getPinStates(int* rowStates, int* colStates) {
  for (int i = 0; i < KEYPAD_ROWS; i++) {
    rowStates[i] = digitalRead(rowPins[i]);
  }
  
  for (int j = 0; j < KEYPAD_COLS; j++) {
    colStates[j] = digitalRead(colPins[j]);
  }
}

bool KeypadModule::testSwappedPins(const byte* altRowPins, const byte* altColPins) {
  Serial.println("[KEYPAD] Testing swapped pin configuration...");
  
  // Configure alternative pins
  for (int i = 0; i < KEYPAD_ROWS; i++) {
    pinMode(altRowPins[i], INPUT_PULLUP);
  }
  for (int j = 0; j < KEYPAD_COLS; j++) {
    pinMode(altColPins[j], OUTPUT);
    digitalWrite(altColPins[j], HIGH);
  }
  
  bool success = false;
  unsigned long startTime = millis();
  
  while (millis() - startTime < TEST_MODE_TIMEOUT && !success) {
    for (int col = 0; col < KEYPAD_COLS; col++) {
      for (int c = 0; c < KEYPAD_COLS; c++) {
        digitalWrite(altColPins[c], (c == col) ? LOW : HIGH);
      }
      delayMicroseconds(100);
      
      for (int row = 0; row < KEYPAD_ROWS; row++) {
        if (digitalRead(altRowPins[row]) == LOW) {
          char detectedKey = keys[row][col];
          Serial.print("[KEYPAD] Swapped config detected: ");
          Serial.println(detectedKey);
          success = true;
          break;
        }
      }
      if (success) break;
    }
    delay(10);
  }
  
  // Restore original configuration
  setupPins();
  
  return success;
}