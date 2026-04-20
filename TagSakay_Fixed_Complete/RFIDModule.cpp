#include "RFIDModule.h"
#include "NetworkModule.h"
#include "DisplayModule.h"
#include "UARTModule.h"

Adafruit_PN532 nfc(PN532_SCK, PN532_MISO, PN532_MOSI, PN532_SS);

// RFIDModule Class Implementation
RFIDModule::RFIDModule() 
  : nfc(nullptr), hspi(nullptr), initialized(false), 
    lastScannedTag(""), lastScanTime(0), consecutiveFailures(0) {}

bool RFIDModule::initialize() {
  Serial.println("[RFID] Initializing PN532...");
  
  hspi = new SPIClass(HSPI);
  hspi->begin(PN532_SCK, PN532_MISO, PN532_MOSI, PN532_SS);
  
  nfc = new Adafruit_PN532(PN532_SS, hspi);
  nfc->begin();

  uint32_t versiondata = nfc->getFirmwareVersion();
  if (!versiondata) {
    Serial.println("[RFID] ERROR: PN532 not found!");
    initialized = false;
    return false;
  }
  
  Serial.print("[RFID] Found chip PN5");
  Serial.println((versiondata >> 24) & 0xFF, HEX);
  Serial.print("[RFID] Firmware v");
  Serial.print((versiondata >> 16) & 0xFF, DEC);
  Serial.print(".");
  Serial.println((versiondata >> 8) & 0xFF, DEC);
  
  // Configure SAM with retry logic
  int retries = 0;
  while (!nfc->SAMConfig() && retries < RFID_RETRY_ATTEMPTS) {
    Serial.println("[RFID] SAMConfig failed, retrying...");
    delay(100);
    retries++;
  }
  
  if (retries >= RFID_RETRY_ATTEMPTS) {
    Serial.println("[RFID] ERROR: SAMConfig failed after retries");
    initialized = false;
    return false;
  }

  Serial.println("[RFID] Initialized successfully");
  initialized = true;
  consecutiveFailures = 0;
  return true;
}

String RFIDModule::readTag() {
  if (!initialized) {
    Serial.println("[RFID] ERROR: Not initialized");
    consecutiveFailures++;
    return "";
  }
  
  uint8_t uid[7] = {0, 0, 0, 0, 0, 0, 0};
  uint8_t uidLength;

  bool success = nfc->readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, RFID_SCAN_TIMEOUT);

  if (success) {
    String tagId = "";
    for (uint8_t i = 0; i < uidLength; i++) {
      if (uid[i] < 0x10) tagId += "0";
      tagId += String(uid[i], HEX);
    }
    tagId.toUpperCase();
    consecutiveFailures = 0;
    return tagId;
  }

  return "";
}

bool RFIDModule::scanWithDebounce(String& tagId, unsigned long debounceMs) {
  if (!initialized) {
    Serial.println("[RFID] ERROR: Not initialized");
    return false;
  }
  
  String scannedTag = readTag();
  
  if (scannedTag.length() > 0) {
    unsigned long currentTime = millis();
    if (scannedTag != lastScannedTag || (currentTime - lastScanTime) > debounceMs) {
      lastScannedTag = scannedTag;
      lastScanTime = currentTime;
      tagId = scannedTag;
      return true;
    }
  }
  
  return false;
}

bool RFIDModule::testConnection() {
  if (!initialized) {
    return false;
  }
  
  uint32_t versiondata = nfc->getFirmwareVersion();
  return (versiondata != 0);
}

String RFIDModule::getFirmwareVersion() {
  if (!initialized) {
    return "Not initialized";
  }
  
  uint32_t versiondata = nfc->getFirmwareVersion();
  if (!versiondata) {
    return "Error reading version";
  }
  
  String version = "v";
  version += String((versiondata >> 16) & 0xFF, DEC);
  version += ".";
  version += String((versiondata >> 8) & 0xFF, DEC);
  
  return version;
}

// Legacy compatibility functions
void initializeRFID() {
  Serial.println("Initializing PN532 RFID Reader...");
  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println("Didn't find PN532 board");
    updateStatusSection("RFID NOT FOUND", TFT_RED);
    while (1) { delay(1000); }
  }

  Serial.print("Found chip PN5");
  Serial.println((versiondata >> 24) & 0xFF, HEX);
  Serial.print("Firmware ver. ");
  Serial.print((versiondata >> 16) & 0xFF, DEC);
  Serial.print('.');
  Serial.println((versiondata >> 8) & 0xFF, DEC);

  nfc.SAMConfig();
  Serial.println("PN532 configured and ready to read RFID tags!");
}

String readRfidTag() {
  uint8_t uid[] = {0, 0, 0, 0, 0, 0, 0};
  uint8_t uidLength;

  boolean success = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100);

  if (success) {
    String tagId = "";
    for (uint8_t i = 0; i < uidLength; i++) {
      if (uid[i] < 0x10) tagId += "0";
      tagId += String(uid[i], HEX);
    }
    tagId.toUpperCase();
    return tagId;
  }

  return "";
}

void handleRFIDLoop() {
  String tagId = readRfidTag();

  if (tagId.length() > 0) {
    unsigned long currentMillis = millis();

    // Prevent duplicate scans within 3 seconds
    if (tagId == lastScannedTag && (currentMillis - lastScanTime < 3000)) {
      Serial.println("Duplicate scan ignored (within 3s window)");
      return;
    }

    lastScannedTag = tagId;
    lastScanTime = currentMillis;

    Serial.println("================================================");
    Serial.print("RFID Tag Detected: ");
    Serial.println(tagId);
    Serial.println("================================================");

    updateStatusSection("TAG DETECTED", TFT_CYAN);

    if (registrationMode) {
      Serial.println("Registration mode active - checking tag match...");

      if (expectedRegistrationTagId.length() > 0) {
        if (tagId.equalsIgnoreCase(expectedRegistrationTagId)) {
          Serial.println("✓ Registration tag match! Completing registration...");

          indicateRegistrationTagDetected();
          updateRfidScanDetails(
            tagId,
            "",
            "",
            true,
            false,
            false,
            "Registration confirmed",
            TFT_GREEN,
            ""
          );
          sendToLEDMatrix("REG", "SUCCESS", tagId.substring(0, 8));

          registrationMode = false;
          expectedRegistrationTagId = "";

          // Report successful registration
          reportDeviceStatus("registration_complete");

          delay(2000);
          indicateReady();
        } else {
          Serial.println("✗ Tag mismatch! Expected: " + expectedRegistrationTagId + ", Got: " + tagId);
          updateRfidScanDetails(
            tagId,
            "",
            "",
            false,
            false,
            false,
            "Wrong tag",
            TFT_RED,
            "Not the expected tag"
          );
          sendToLEDMatrix("REG", "MISMATCH", "");
          blinkError(2);
        }
      } else {
        Serial.println("⚠ Registration mode active but no expected tag set");
        updateRfidScanDetails(
          tagId,
          "",
          "",
          false,
          false,
          false,
          "Registration error",
          TFT_ORANGE,
          "No expected tag"
        );
        sendToLEDMatrix("REG", "ERROR", "");
      }
    } else {
      // Normal scanning mode
      handleRfidScan(tagId);
    }

    // Small delay to prevent rapid repeated scans
    delay(500);
  }
}