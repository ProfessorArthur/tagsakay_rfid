#include "Config.h"
#include "UARTHandler.h"
#include "DisplayModes.h"
#include "DisplayCore.h"
#include "SDCardModule.h"

HardwareSerial RFIDSerial(2);
String messageBuffer = "";
bool operationModeActive = false;

namespace {
  constexpr unsigned long INIT_RETURN_DELAY_MS = 1500;
  constexpr unsigned long BEEP_INDICATOR_MS = 50;

  bool pendingIdleScreen = false;
  unsigned long pendingIdleStartedAt = 0;

  bool beepIndicatorOn = false;
  unsigned long beepIndicatorStartedAt = 0;

  void processDeferredDisplayActions() {
    const unsigned long now = millis();

    if (pendingIdleScreen && (now - pendingIdleStartedAt >= INIT_RETURN_DELAY_MS)) {
      displayIdleScreen();
      pendingIdleScreen = false;
    }

    if (beepIndicatorOn && (now - beepIndicatorStartedAt >= BEEP_INDICATOR_MS)) {
      virtualDisp->fillRect(0, 0, 4, 4, COLOR_BLACK);
      dma_display->flipDMABuffer();
      beepIndicatorOn = false;
    }
  }
}

void initializeUART() {
  Serial.println("Initializing UART communication...");
  pinMode(UART_RX, INPUT_PULLUP);  // Add pull-up to reduce noise
  RFIDSerial.begin(UART_BAUD, SERIAL_8N1, UART_RX, UART_TX);
  messageBuffer.reserve(256);
  Serial.println("UART initialized - listening for commands");
}

void processUARTCommand() {
  processDeferredDisplayActions();

  while (RFIDSerial.available()) {
    char c = RFIDSerial.read();
    
    if (c == '\n') {
      if (messageBuffer.length() > 0) {
        parseCommand(messageBuffer);
        messageBuffer.remove(0);
      }
    } else {
      messageBuffer += c;
      if (messageBuffer.length() > 256) {
        Serial.println("Buffer overflow - clearing");
        messageBuffer.remove(0);
      }
    }
  }
}

void parseCommand(const String& command) {
  // Filter out commands with non-printable characters (UART noise)
  bool hasNonPrintable = false;
  for (char c : command) {
    if (c < 32 && c != '\n' && c != '\r' && c != '\t') {
      hasNonPrintable = true;
      break;
    }
  }
  if (hasNonPrintable) {
    return; // Silently ignore noise
  }
  
  Serial.print("Received: ");
  Serial.println(command);
  
  int firstDelim = command.indexOf('|');
  if (firstDelim == -1) {
    // Silently ignore invalid format
    return;
  }
  
  int secondDelim = command.indexOf('|', firstDelim + 1);
  
  String cmd = command.substring(0, firstDelim);
  String data1 = "";
  String data2 = "";
  
  if (secondDelim != -1) {
    data1 = command.substring(firstDelim + 1, secondDelim);
    data2 = command.substring(secondDelim + 1);
  } else {
    data1 = command.substring(firstDelim + 1);
  }
  
  cmd.trim();
  data1.trim();
  data2.trim();
  
  handleCommand(cmd, data1, data2);
}

void handleCommand(const String& cmd, const String& data1, const String& data2) {
  Serial.println("CMD: " + cmd + " | D1: " + data1 + " | D2: " + data2);
  
  // List of valid commands to prevent garbage from executing
  static const char* validCommands[] = {
    "INIT", "STATUS", "READY", "WELCOME", "UNREG", "QUEUE", "CASCADE", 
    "OVERRIDE", "CLEAR", "SCAN", "MESSAGE", "ERROR", "REG", "TEST", 
    "BEEP", "REFRESH", "BRIGHTNESS", "SDTEST", "OFFLINE_SCAN", "SYNC_DB"
  };
  
  bool isValid = false;
  const size_t commandCount = sizeof(validCommands) / sizeof(validCommands[0]);
  for (size_t i = 0; i < commandCount; ++i) {
    if (cmd.equals(validCommands[i])) {
      isValid = true;
      break;
    }
  }
  
  if (!isValid) {
    Serial.println("Unknown command ignored: " + cmd);
    return;
  }
  
  if (cmd == "INIT") {
    deviceId = data1;
    location = data2;
    Serial.println("Initialized - Device: " + deviceId + " | Location: " + location);
    displayWelcomeScreen();
    pendingIdleScreen = true;
    pendingIdleStartedAt = millis();
    
  } else if (cmd == "STATUS") {
    uint16_t color = COLOR_INFO;
    if (data1 == "READY") color = COLOR_READY;
    else if (data1 == "ERROR") color = COLOR_ERROR;
    else if (data1 == "UNREGISTERED") color = COLOR_WARNING;
    displayStatus(data1, color);

  } else if (cmd == "READY") {
    operationModeActive = false;
    displayIdleScreen();
  } else if (cmd == "WELCOME") {
    String name = data1.length() ? data1 : "Driver";
    displayScanResult(name, "WELCOME");
  } else if (cmd == "UNREG") {
    String tagHint = data1.length() ? data1 : "TAG";
    displayScanResult(tagHint, "UNREGISTERED");
    
  } else if (cmd == "QUEUE") {
    // Check if data1 is a number
    bool isNumber = true;
    if (data1.length() == 0) isNumber = false;
    for (unsigned int i = 0; i < data1.length(); i++) {
      if (!isDigit(data1.charAt(i))) {
        isNumber = false;
        break;
      }
    }

    if (isNumber) {
      // Check if data2 is a state keyword (WAITING, ONGOING, etc.)
      String stateCheck = data2;
      stateCheck.toUpperCase();
      if (stateCheck == "ONGOING" || stateCheck == "COMPLETED" || stateCheck == "CLEAR" || stateCheck == "RESERVE" || stateCheck == "FIX") {
        // This is a state update for a specific queue number
        // Normalize numeric IDs so they match padded display values (e.g., '1' -> '01')
        String id = data1;
        id.trim();
        if (id.length() == 1 && isDigit(id.charAt(0)) && id.charAt(0) != '0') {
          id = String("0") + id;
        }
        updateQueueState(id, data2);
      } else {
        // This is a "Now Serving" display command
        int queueNum = data1.toInt();
        displayQueueNumber(queueNum, data2);
      }
    } else {
      // data1 is not a number (e.g. "MODE"), so it's a status message
      displayQueueStatus(data1, data2);
    }
    
  } else if (cmd == "CASCADE") {
    int queueNums[MAX_CASCADE_ENTRIES];
    String unitLabels[MAX_CASCADE_ENTRIES];
    int count = 0;
    int startPos = 0;
    
    while (startPos < data1.length() && count < MAX_CASCADE_ENTRIES) {
      int commaPos = data1.indexOf(',', startPos);
      String numStr;
      
      if (commaPos == -1) {
        numStr = data1.substring(startPos);
        startPos = data1.length();
      } else {
        numStr = data1.substring(startPos, commaPos);
        startPos = commaPos + 1;
      }
      
      numStr.trim();
      if (numStr.length() > 0) {
        queueNums[count++] = numStr.toInt();
      }
    }

    for (int i = 0; i < MAX_CASCADE_ENTRIES; i++) {
      unitLabels[i] = "";
    }

    if (data2.length() > 0) {
      int unitIndex = 0;
      startPos = 0;
      while (startPos < data2.length() && unitIndex < count && unitIndex < MAX_CASCADE_ENTRIES) {
        int commaPos = data2.indexOf(',', startPos);
        String unitStr;

        if (commaPos == -1) {
          unitStr = data2.substring(startPos);
          startPos = data2.length();
        } else {
          unitStr = data2.substring(startPos, commaPos);
          startPos = commaPos + 1;
        }

        unitStr.trim();
        unitLabels[unitIndex++] = unitStr;
      }
    }

    if (count > 0) {
      if (data2.length() > 0) {
        displayCascade(queueNums, count, unitLabels);
      } else {
        displayCascade(queueNums, count);
      }
    }
    
    operationModeActive = (count > 0);
    
  } else if (cmd == "OVERRIDE") {
    int queueNum = data1.toInt();
    displayQueueNumber(queueNum, "OVERRIDE: " + data2);
    
  } else if (cmd == "CLEAR") {
    clearDisplay();
    displayIdleScreen();
    
  } else if (cmd == "SCAN") {
    displayScanResult(data1, data2);
    // When a scan is received, mark the unit/queue as ONGOING so it shows green
    {
      String id = data1;
      id.trim();
      if (id.length() == 1 && isDigit(id.charAt(0)) && id.charAt(0) != '0') {
        id = String("0") + id;
      }
      updateQueueState(id, "ONGOING");
    }
    
  } else if (cmd == "MESSAGE") {
    displayMessage(data1, COLOR_INFO);
    
  } else if (cmd == "ERROR") {
    displayError(data1, data2);

  } else if (cmd == "REG") {
    String state = data1;
    String detail = data2;
    String stateUpper = state;
    String detailUpper = detail;
    stateUpper.toUpperCase();
    detailUpper.toUpperCase();

    if (stateUpper == "SUCCESS") {
      displayMessage("REG SUCCESS", COLOR_SUCCESS);
    } else if (stateUpper == "FAILED" || stateUpper == "FAIL") {
      displayMessage("REG FAILED", COLOR_ERROR);
    } else if (stateUpper == "MISMATCH") {
      displayMessage("TAG MISMATCH", COLOR_WARNING);
    } else if (stateUpper == "ERROR") {
      displayError("REG ERROR", detail);
    } else if (stateUpper == "OFF") {
      displayStatus("REG MODE OFF", COLOR_GREEN);
    } else if (stateUpper == "MODE") {
      bool active = detailUpper == "ACTIVE";
      displayStatus(active ? "REG MODE" : "REG MODE OFF", active ? COLOR_WARNING : COLOR_GREEN);
    } else if (detailUpper == "WAIT") {
      String tagHint = state.length() ? state : String("TAG");
      displayScanResult(tagHint, "REG WAIT");
    } else if (stateUpper == "ONGOING") {
      String tagHint = detail.length() ? detail : String("TAG");
      displayScanResult(tagHint, "REG WAIT");
    } else {
      String message = "REG " + state;
      if (detail.length()) {
        message += " " + detail;
      }
      displayMessage(message, COLOR_INFO);
    }
    
  } else if (cmd == "TEST") {
    displayTestPattern();
    
  } else if (cmd == "BEEP") {
    virtualDisp->fillRect(0, 0, 4, 4, COLOR_YELLOW);
    dma_display->flipDMABuffer();
    beepIndicatorOn = true;
    beepIndicatorStartedAt = millis();
    
  } else if (cmd == "REFRESH") {
    updateDisplay();
    
  } else if (cmd == "BRIGHTNESS") {
    int level = data1.toInt();
    if (level >= 0 && level <= 255) {
      setBrightness(level);
      Serial.println("Brightness set to: " + String(level));
    }
    
  } else if (cmd == "SDTEST") {
    if (sdCard.isReady()) {
      sdCard.writeFile("/test.txt", "SD Card Test Successful!");
      String content = sdCard.readFile("/test.txt");
      Serial.println("Read back: " + content);
      displayMessage("SD OK", COLOR_GREEN);
    } else {
      displayMessage("SD FAIL", COLOR_RED);
    }

  } else if (cmd == "OFFLINE_SCAN") {
    // data1 = Tag ID
    String tagId = data1;
    Serial.println("Offline Scan Lookup: " + tagId);
    
    if (sdCard.isReady()) {
      Serial.println("SD ready, checking database.txt");
      if (sdCard.exists("/database.txt")) {
        Serial.println("database.txt exists");
      } else {
        Serial.println("database.txt not found");
      }
      
      String unitNumber = "";
      String userName = "";
      bool foundRecord = sdCard.lookupTagRecord(tagId, unitNumber, userName);
      
      if (foundRecord && unitNumber.length() > 0) {
        Serial.println("Found Unit: " + unitNumber + ", User: " + userName);
        
        // Display the unit number on the LED matrix only if not in operation mode
        if (!operationModeActive) {
          displayScanResult(unitNumber, "OFFLINE SCAN");
          // Also mark as ongoing on the LED cascade for immediate color change
          String id = unitNumber;
          id.trim();
          if (id.length() == 1 && isDigit(id.charAt(0)) && id.charAt(0) != '0') {
            id = String("0") + id;
          }
          updateQueueState(id, "ONGOING");
        }
        
        // Log the offline scan
        String logEntry = String(millis()) + "," + tagId + "," + unitNumber + "," + userName + "\n";
        sdCard.appendFile("/offline_scans.txt", logEntry.c_str());
      } else {
        Serial.println("Tag not found in DB");
        if (!operationModeActive) {
          displayScanResult(tagId, "UNKNOWN TAG");
        }
      }
    } else {
      Serial.println("SD not ready for offline scan");
      if (!operationModeActive) {
        displayError("SD ERROR", "NO DB");
      }
    }

  } else if (cmd == "SYNC_DB") {
    // data1 = Tag ID, data2 = Unit Number, data3 = User Name (optional)
    if (sdCard.isReady()) {
      String userName = (data2.indexOf(',') != -1) ? data2.substring(data2.indexOf(',') + 1) : "";
      String unitNumber = data2;
      
      // If data2 contains comma, split it into unitNumber and userName
      if (data2.indexOf(',') != -1) {
        unitNumber = data2.substring(0, data2.indexOf(','));
        userName = data2.substring(data2.indexOf(',') + 1);
      }
      
      if (sdCard.saveTag(data1, unitNumber, userName)) {
        Serial.println("Synced: " + data1 + " -> " + unitNumber + " (" + userName + ")");
        // Optional: Show small indicator?
      } else {
        Serial.println("Sync Failed for: " + data1);
      }
    }
    
  } else {
    Serial.println("Unknown command: " + cmd);
  }
}
