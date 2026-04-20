#include "DisplayModule.h"
#include "NetworkModule.h"
#include "BuzzerModule.h"
#include "ApiModule.h"
#include "HTTPPolling.h"
#include "UARTModule.h"
#include <WiFi.h>
#include <map>

TFT_eSPI tft = TFT_eSPI();

extern bool queuePanelVisible;
extern bool operationMode;
extern bool keypadMenuVisible;
extern bool keypadMenuActive;
extern bool servicesActivated;
extern bool activationInProgress;
extern bool registrationMode;
extern bool offlineMode;
extern NetworkModule networkModule;
extern ApiModule apiModule;
extern HTTPPollingModule pollingModule;
extern String expectedRegistrationTagId;
extern unsigned long registrationModeStartTime;
extern String lastScannedTag;
extern unsigned long lastScanTime;
extern unsigned long lastHeartbeat;
extern SystemStatus systemStatus;
extern DeviceConfig deviceConfig;
extern String deviceId;
extern WiFiConfig wifiConfig;
extern ServerConfig serverConfig;

// Override flow variables from KeypadModule
extern bool overrideActive;
extern int overrideStage;
extern int overrideCursor;

namespace {
  const int MENU_PANEL_WIDTH = 168;
  const int MENU_PANEL_MARGIN = 8;
  const int MENU_PANEL_X = SCREEN_WIDTH - MENU_PANEL_WIDTH - MENU_PANEL_MARGIN;
  const int MENU_PANEL_Y = STATUS_SECTION_Y + 8;
  const int MENU_PANEL_HEIGHT = FOOTER_Y - MENU_PANEL_Y - 8;
  const int MENU_PANEL_PADDING = 8;

  String footerMessage = "";
  char lastKeyPressed = 0;

  int getContentWidth() {
    if (keypadMenuVisible) {
      int adjustedWidth = MENU_PANEL_X - LEFT_MARGIN - 6;
      if (adjustedWidth > 0) {
        return adjustedWidth;
      }
    }
    return SCREEN_WIDTH - (LEFT_MARGIN * 2);
  }

  void clearMenuPanelArea() {
    int panelX = MENU_PANEL_X - 4;
    if (panelX < 0) {
      panelX = 0;
    }

    int panelWidth = SCREEN_WIDTH - panelX;
    if (panelWidth <= 0) {
      return;
    }

    int panelHeight = FOOTER_Y - STATUS_SECTION_Y - 4;
    tft.fillRect(panelX, STATUS_SECTION_Y + 4, panelWidth, panelHeight, TFT_BLACK);
  }

  void drawMenuPanelFrame() {
    int frameX = MENU_PANEL_X - 2;
    if (frameX < 0) {
      frameX = 0;
    }

    int frameWidth = MENU_PANEL_WIDTH + 4;
    if (frameX + frameWidth > SCREEN_WIDTH) {
      frameWidth = SCREEN_WIDTH - frameX;
    }

    tft.drawRect(frameX, MENU_PANEL_Y - 4, frameWidth, MENU_PANEL_HEIGHT + 8, TFT_DARKGREY);
    tft.drawFastVLine(frameX, STATUS_SECTION_Y + 4, MENU_PANEL_HEIGHT + 4, TFT_DARKGREY);
  }

  String formatBool(bool value) {
    return value ? String("YES") : String("NO");
  }

  String safeTruncate(const String& value, uint8_t limit) {
    if (value.length() <= limit) {
      return value;
    }
    return value.substring(0, limit);
  }

  String formatDuration(unsigned long milliseconds) {
    if (milliseconds == 0) {
      return String("0s");
    }

    unsigned long seconds = milliseconds / 1000;
    unsigned long minutes = seconds / 60;
    unsigned long hours = minutes / 60;

    seconds %= 60;
    minutes %= 60;

    if (hours > 0) {
      return String(hours) + "h " + String(minutes) + "m";
    }
    if (minutes > 0) {
      return String(minutes) + "m " + String(seconds) + "s";
    }
    return String(seconds) + "s";
  }

  String formatMillisAgo(unsigned long timestamp) {
    if (timestamp == 0) {
      return String("never");
    }

    unsigned long now = millis();
    unsigned long delta = (now >= timestamp) ? (now - timestamp) : (ULONG_MAX - timestamp + now + 1UL);
    return formatDuration(delta) + " ago";
  }

  void renderMenuPanel();
  void hideQueuePanel();

  void updateMenuPanelIfVisible() {
    if (keypadMenuVisible) {
      renderMenuPanel();
    }
  }

  void renderMenuOptions(int innerX, int& cursorY) {
    tft.setTextColor(TFT_WHITE, TFT_BLACK);

    if (!servicesActivated) {
      const char* lines[] = {
        "1: Activate system",
        "D: Retry activation",
        "#: Close menu",
        "",
        "Services locked until",
        "manual activation"
      };

      const size_t lineCount = sizeof(lines) / sizeof(lines[0]);
      for (size_t i = 0; i < lineCount; ++i) {
        tft.setCursor(innerX, cursorY);
        tft.println(lines[i]);
        cursorY += 12;
      }
      return;
    }
    if (operationMode) {
      const char* linesOp[] = {
        "1: Send heartbeat",
        "2: Toggle reg mode",
        "3: Sync device",
        "4: Poll commands",
        "5: Override unit",
        "6: Network info",
        "7: API stats",
        "8: Last scan info",
        "9: Clear reg tag",
        "0: Clear LED",
        "*: Toggle queue panel",
        "D: Retry activation",
        "#: Close menu"
      };
      const size_t lineCount = sizeof(linesOp) / sizeof(linesOp[0]);
      for (size_t i = 0; i < lineCount; ++i) {
        tft.setCursor(innerX, cursorY);
        tft.println(linesOp[i]);
        cursorY += 12;
      }
    } else {
      const char* lines[] = {
        "1: Send heartbeat",
        "2: Toggle reg mode",
        "3: Sync device",
        "4: Poll commands",
        "5: System summary",
        "6: Network info",
        "7: API stats",
        "8: Last scan info",
        "9: Clear reg tag",
        "0: Clear LED",
        "D: Retry activation",
        "#: Close menu"
      };
      const size_t lineCount = sizeof(lines) / sizeof(lines[0]);
      for (size_t i = 0; i < lineCount; ++i) {
        tft.setCursor(innerX, cursorY);
        tft.println(lines[i]);
        cursorY += 12;
      }
    }
  }

  void renderMenuStatusLines(int innerX, int& cursorY) {
    systemStatus.uptime = millis();
    systemStatus.freeHeap = ESP.getFreeHeap();
    systemStatus.offlineMode = offlineMode;

    tft.setTextColor(TFT_CYAN, TFT_BLACK);
    tft.setCursor(innerX, cursorY);
    tft.println("Status");
    cursorY += 12;

    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);

    String servicesLine = String("Services: ");
    if (activationInProgress) {
      servicesLine += "ACTIVATING";
    } else if (!servicesActivated) {
      servicesLine += "WAITING";
    } else if (offlineMode) {
      servicesLine += "ACTIVE (OFFLINE)";
    } else {
      servicesLine += "ACTIVE";
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(servicesLine, 26));
    cursorY += 12;

    bool wifiUp = networkModule.isConnected();
    String wifiLine;
    if (!servicesActivated && !activationInProgress) {
      wifiLine = "WiFi: Inactive";
    } else if (activationInProgress && !wifiUp) {
      wifiLine = "WiFi: Connecting";
    } else {
      wifiLine = wifiUp ? "WiFi: Connected" : "WiFi: Offline";
    }
    if (wifiUp) {
      String ip = networkModule.getIpAddress();
      if (ip.length() > 0) {
        wifiLine += " (" + ip + ")";
      }
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(wifiLine, 26));
    cursorY += 12;

    bool apiOk = servicesActivated && apiModule.isInitialized() && systemStatus.apiConnected && !offlineMode;
    String apiLine;
    if (!servicesActivated && !activationInProgress) {
      apiLine = "API: Inactive";
    } else if (!apiModule.isInitialized()) {
      apiLine = String("API: Unset (") + String(apiModule.getConsecutiveFailures()) + " fail)";
    } else {
      apiLine = String("API: ") + (apiOk ? "Online" : "Offline") + " (" + String(apiModule.getConsecutiveFailures()) + " fail)";
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(apiLine, 26));
    cursorY += 12;

    bool pollReady = pollingModule.isReady();
    unsigned long lastPoll = pollingModule.getLastPollTime();
    String pollLine;
    if (!servicesActivated && !activationInProgress) {
      pollLine = "Poll: Inactive";
    } else {
      pollLine = String("Poll: ") + (pollReady ? "Ready" : "Idle");
      pollLine += " (" + (lastPoll ? formatMillisAgo(lastPoll) : String("never")) + ")";
      if (pollingModule.getConsecutiveFailures() > 0) {
        pollLine += " !";
      }
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(pollLine, 26));
    cursorY += 12;

    String regLine = String("Reg: ") + (registrationMode ? "ON" : "OFF");
    if (registrationMode) {
      if (expectedRegistrationTagId.length() > 0) {
        regLine += " [" + safeTruncate(expectedRegistrationTagId, 6) + "]";
      }
      if (registrationModeStartTime > 0) {
        regLine += " (" + formatMillisAgo(registrationModeStartTime) + ")";
      }
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(regLine, 26));
    cursorY += 12;

    String offlineLine = String("Offline: ") + formatBool(offlineMode);
    tft.setCursor(innerX, cursorY);
    tft.println(offlineLine);
    cursorY += 12;

    String scanLine = String("Last scan: ");
    scanLine += lastScannedTag.length() ? safeTruncate(lastScannedTag, 8) : String("-");
    if (lastScanTime > 0) {
      scanLine += " (" + formatMillisAgo(lastScanTime) + ")";
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(scanLine, 26));
    cursorY += 12;

    String heartbeatLine = String("Heartbeat: ");
    if (!servicesActivated) {
      heartbeatLine += "paused";
    } else {
      heartbeatLine += lastHeartbeat ? formatMillisAgo(lastHeartbeat) : String("never");
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(heartbeatLine, 26));
    cursorY += 12;

    const String& ledCmd = getLastLedCommand();
    String ledLine = String("LED: ");
    if (ledCmd.length()) {
      ledLine += safeTruncate(ledCmd, 4);
      const String& ledParam = getLastLedParam1();
      if (ledParam.length()) {
        ledLine += "|" + safeTruncate(ledParam, 6);
      }
      unsigned long ledTime = getLastLedSendTime();
      ledLine += " (" + (ledTime ? formatMillisAgo(ledTime) : String("never")) + ")";
    } else {
      ledLine += "none";
    }
    tft.setCursor(innerX, cursorY);
    tft.println(safeTruncate(ledLine, 26));
    cursorY += 12;

    String heapLine = String("Heap: ") + String(systemStatus.freeHeap / 1024) + " KB";
    tft.setCursor(innerX, cursorY);
    tft.println(heapLine);
  }

  void renderMenuPanel() {
    if (!keypadMenuVisible) {
      return;
    }

    clearMenuPanelArea();
    drawMenuPanelFrame();

    int innerX = MENU_PANEL_X + MENU_PANEL_PADDING;
    int cursorY = MENU_PANEL_Y;

    tft.setTextSize(2);
    tft.setTextColor(TFT_CYAN, TFT_BLACK);
    tft.setCursor(innerX, cursorY);
    tft.println("Device Menu");
    cursorY += 18;

    tft.setTextSize(1);
    tft.setTextColor(keypadMenuActive ? TFT_LIGHTGREY : TFT_DARKGREY, TFT_BLACK);
    tft.setCursor(innerX, cursorY);
    if (!keypadMenuActive) {
      tft.println("Press A to activate");
    } else if (!servicesActivated) {
      tft.println("Press 1 to activate system");
    } else {
      tft.println("Use keys shown");
    }
    cursorY += 16;

    renderMenuOptions(innerX, cursorY);
  }

  void drawDiagnosticLines(const String* lines, size_t count) {
    int areaWidth = getContentWidth();
    tft.fillRect(LEFT_MARGIN, SCAN_SECTION_Y + 15, areaWidth, SCAN_SECTION_HEIGHT - 20, TFT_BLACK);
    tft.setTextSize(1);
    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);

    int cursorY = SCAN_SECTION_Y + 24;
    for (size_t i = 0; i < count; ++i) {
      tft.setCursor(LEFT_MARGIN, cursorY);
      tft.println(lines[i]);
      cursorY += 12;
    }
  }

  void redrawFooter() {
    tft.fillRect(0, FOOTER_Y + 2, SCREEN_WIDTH, FOOTER_HEIGHT - 2, TFT_BLACK);

    tft.setTextSize(1);
    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    tft.setCursor(LEFT_MARGIN, FOOTER_Y + 5);
    tft.println(footerMessage.length() ? footerMessage.substring(0, 48) : String("Ready"));

    String timestamp = getCurrentTimestamp();
    if (timestamp.length() > 0) {
      String timeStr = timestamp.substring(11, 19);
      int timestampX = keypadMenuVisible ? MENU_PANEL_X - 120 : SCREEN_WIDTH - 120;
      if (timestampX < LEFT_MARGIN) {
        timestampX = LEFT_MARGIN;
      }
      tft.setCursor(timestampX, FOOTER_Y + 5);
      tft.print("Time: ");
      tft.println(timeStr);
    }

    tft.setCursor(LEFT_MARGIN, FOOTER_Y + 18);
    tft.print("Uptime: ");
    tft.println(formatDuration(millis()));

    int statusX = keypadMenuVisible ? MENU_PANEL_X - 110 : SCREEN_WIDTH - 110;
    if (statusX < LEFT_MARGIN + 60) {
      statusX = LEFT_MARGIN + 60;
    }
    tft.setCursor(statusX, FOOTER_Y + 18);
    tft.print("Key: ");
    if (lastKeyPressed) {
      tft.print(lastKeyPressed);
    } else {
      tft.print('-');
    }
    tft.print("  Menu: ");
    tft.println(keypadMenuVisible ? "OPEN" : "CLOSED");
  }
}

void initializeTFT() {
  tft.init();
  tft.setRotation(1);  // Landscape orientation for 480x320 ILI9488
  clearScreen();
  drawHeader();
  drawSectionBorders();
  
  updateStatusSection("Initializing...", TFT_YELLOW);
  updateConnectionStatus("Disconnected", "No sync", "Starting");
}

void clearScreen() {
  tft.fillScreen(TFT_BLACK);
}

void drawHeader() {
  tft.fillRect(0, 0, SCREEN_WIDTH, HEADER_HEIGHT, TFT_NAVY);
  
  tft.setTextSize(2);
  tft.setTextColor(TFT_YELLOW, TFT_NAVY);
  tft.setCursor(LEFT_MARGIN, 12);
  tft.println("TagSakay RFID Scanner");
  
  tft.setTextSize(1);
  tft.setTextColor(TFT_LIGHTGREY, TFT_NAVY);
  tft.setCursor(SCREEN_WIDTH - 130, 24);
  tft.println("v2.0");
}

void drawSectionBorders() {
  tft.drawLine(0, HEADER_HEIGHT, SCREEN_WIDTH, HEADER_HEIGHT, TFT_WHITE);
  
  tft.drawRect(0, STATUS_SECTION_Y, SCREEN_WIDTH, STATUS_SECTION_HEIGHT, TFT_DARKGREY);
  tft.setTextSize(1);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, STATUS_SECTION_Y + 2);
  tft.println("STATUS");
  
  tft.drawRect(0, SCAN_SECTION_Y, SCREEN_WIDTH, SCAN_SECTION_HEIGHT, TFT_DARKGREY);
  tft.setCursor(LEFT_MARGIN, SCAN_SECTION_Y + 2);
  tft.println("RFID SCAN");
  
  tft.drawLine(0, FOOTER_Y, SCREEN_WIDTH, FOOTER_Y, TFT_DARKGREY);
}

void updateStatusSection(const String& msg, uint16_t color) {
  tft.fillRect(LEFT_MARGIN, STATUS_SECTION_Y + 15, getContentWidth(), 20, TFT_BLACK);
  
  tft.setTextSize(2);
  tft.setTextColor(color, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, STATUS_SECTION_Y + 15);
  tft.println(msg.substring(0, 24));

  updateMenuPanelIfVisible();
}

void updateConnectionStatus(const String& wifi, const String& time, const String& device) {
  tft.fillRect(LEFT_MARGIN, STATUS_SECTION_Y + 40, getContentWidth(), 40, TFT_BLACK);
  
  tft.setTextSize(1);
  
  tft.setTextColor((wifi == "Connected") ? TFT_GREEN : TFT_RED, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, STATUS_SECTION_Y + 40);
  tft.print("WiFi: ");
  tft.println(wifi.substring(0, 16));
  
  tft.setTextColor((time == "Synced") ? TFT_GREEN : TFT_ORANGE, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, STATUS_SECTION_Y + 52);
  tft.print("Time: ");
  tft.println(time.substring(0, 16));
  
  // Display full MAC address (12 chars)
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, STATUS_SECTION_Y + 64);
  tft.print("MAC: ");
  tft.println(device.substring(0, 12));
  
  // Registration mode indicator on the right side
  if (registrationMode) {
    tft.setTextColor(TFT_MAGENTA, TFT_BLACK);
    int regX = keypadMenuVisible ? MENU_PANEL_X - 95 : SCREEN_WIDTH - 95;
    if (regX < LEFT_MARGIN) {
      regX = LEFT_MARGIN;
    }
    tft.setCursor(regX, STATUS_SECTION_Y + 64);
    tft.println("REG MODE");
  } else {
    int clearX = keypadMenuVisible ? MENU_PANEL_X - 95 : SCREEN_WIDTH - 95;
    if (clearX < LEFT_MARGIN) {
      clearX = LEFT_MARGIN;
    }
    tft.fillRect(clearX, STATUS_SECTION_Y + 64, 80, 10, TFT_BLACK);
  }

  updateMenuPanelIfVisible();
}

void updateScanSection(const String& tagId, const String& status, const String& userInfo, uint16_t color) {
  bool hasExplicitStatus = status.length() > 0;
  bool hasTag = tagId.length() > 0;
  bool treatAsUser = (color == TFT_GREEN) && (userInfo.length() > 0);
  String statusLabel = hasExplicitStatus ? status : (hasTag ? String("TAG DETECTED") : String("Waiting for RFID card..."));
  bool tagActive = hasExplicitStatus && (color == TFT_GREEN);
  bool userAssigned = treatAsUser;
  bool userActive = treatAsUser && tagActive;
  String userNameValue = treatAsUser ? userInfo : String("");
  String secondaryValue = treatAsUser ? String("") : userInfo;

  // Reuse the richer detail layout so legacy call sites stay visually consistent.
  updateRfidScanDetails(
    tagId,
    "",
    userNameValue,
    tagActive,
    userAssigned,
    userActive,
    statusLabel,
    color,
    secondaryValue
  );

  updateMenuPanelIfVisible();
}

void updateFooter(const String& msg) {
  footerMessage = msg;
  redrawFooter();
}

void showHeartbeat(bool active) {
  uint16_t color = active ? TFT_GREEN : TFT_DARKGREY;
  int indicatorX = keypadMenuVisible ? MENU_PANEL_X - 30 : SCREEN_WIDTH - 30;
  if (indicatorX < LEFT_MARGIN + 20) {
    indicatorX = LEFT_MARGIN + 20;
  }
  tft.fillCircle(indicatorX, FOOTER_Y + 12, 4, color);
  
  tft.setTextSize(1);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(indicatorX - 25, FOOTER_Y + 18);
  tft.println("HB");

  updateMenuPanelIfVisible();
}

void showStatus(const String& msg, uint16_t color, int x, int y, int textSize) {
  tft.setTextColor(color, TFT_BLACK);
  tft.setTextSize(textSize);
  int clearWidth = SCREEN_WIDTH - x - LEFT_MARGIN;
  if (clearWidth < 0) {
    clearWidth = SCREEN_WIDTH;
  }
  tft.fillRect(x, y, clearWidth, 20, TFT_BLACK);
  tft.setCursor(x, y);
  tft.println(msg);
}

void showRFIDScan(const String& tagId, const String& status, uint16_t color) {
  String userInfo = "";
  updateScanSection(tagId, status, userInfo, color);
}

void indicateSuccess() {
  updateStatusSection("SCAN SUCCESS", TFT_GREEN);
  updateFooter("Last scan: Successful");
  buzzerSuccessTone();
  Serial.println("✓ Scan successful");
}

void indicateError() {
  updateStatusSection("SCAN ERROR", TFT_RED);
  updateFooter("Last scan: Error occurred");
  buzzerErrorTone();
  Serial.println("✗ Scan error");
}

void indicateUnregisteredTag() {
  updateStatusSection("UNREGISTERED TAG", TFT_ORANGE);
  updateFooter("Last scan: Unregistered card");
  buzzerWarningTone();
  Serial.println("⚠ Unregistered tag detected");
}

void indicateRegistrationMode() {
  updateStatusSection("REGISTRATION MODE", TFT_MAGENTA);
  updateFooter("Registration mode active");
  buzzerRegistrationTone();
  Serial.println("🔧 Registration mode active");
}

void indicateReady() {
  bool wasMenuVisible = keypadMenuVisible;
  bool wasMenuActive = keypadMenuActive;
  clearScreen();
  drawHeader();
  drawSectionBorders();
  
  if (operationMode) {
    updateStatusSection("OPERATION MODE", TFT_CYAN);
    updateRfidScanDetails("", "", "", false, false, false, "Queue mode active", TFT_CYAN);
    updateFooter("Queue mode active");
  } else {
    updateStatusSection("SYSTEM READY", TFT_GREEN);
    updateRfidScanDetails("", "", "", false, false, false, "Waiting for RFID card...", TFT_LIGHTGREY);
    updateFooter("System ready - waiting for cards");
  }
  
  keypadMenuVisible = wasMenuVisible;
  keypadMenuActive = wasMenuActive;
  if (wasMenuVisible) {
    showKeypadMenu(false);
  }
  buzzerReadyTone();
  Serial.println("✓ System ready");
}

void indicateRegistrationTagDetected() {
  updateStatusSection("REGISTRATION OK", TFT_GREEN);
  updateFooter("Registration tag detected");
  buzzerRegistrationConfirmTone();
  Serial.println("✓ Registration tag detected");
}

void blinkError(int times) {
  buzzerErrorTone();
  for (int i = 0; i < times; i++) {
    updateStatusSection("ERROR " + String(i + 1) + "/" + String(times), TFT_RED);
    delay(500);
    updateStatusSection("", TFT_BLACK);
    delay(200);
  }
  updateStatusSection("SYSTEM READY", TFT_GREEN);
  updateFooter("Error sequence completed");
  Serial.println("✗ Error occurred (" + String(times) + " times)");
}

void displayKeypadPrompt(const String& prompt, const String& buffer) {
  tft.fillRect(LEFT_MARGIN, SCAN_SECTION_Y + 15, getContentWidth(), SCAN_SECTION_HEIGHT - 20, TFT_BLACK);
  
  tft.setTextSize(2);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, SCAN_SECTION_Y + 20);
  tft.println(prompt);
  
  tft.setTextSize(3);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, SCAN_SECTION_Y + 45);
  tft.println(buffer.length() > 0 ? buffer : "_");
  
  tft.setTextSize(1);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, SCAN_SECTION_Y + 75);
  tft.println("#:Confirm  *:Cancel");
  
  updateFooter("Enter number and press #");

  updateMenuPanelIfVisible();
}

void showKeypadMenu(bool refreshFooter) {
  keypadMenuVisible = true;
  renderMenuPanel();

  if (refreshFooter) {
    if (!servicesActivated) {
      updateFooter("Press 1 to activate services");
    } else {
      updateFooter(keypadMenuActive ? "Select menu option" : "Press A then choose an option");
    }
  } else {
    redrawFooter();
  }

  Serial.println("=== DEVICE MENU ===");
  if (!keypadMenuActive) {
    Serial.println("Press 'A' to activate menu selections");
  }
  if (!servicesActivated) {
    Serial.println("1: Activate system");
    Serial.println("D: Retry activation");
    Serial.println("#: Exit menu");
  } else {
    Serial.println("1: Send heartbeat");
    Serial.println("2: Toggle registration mode");
    Serial.println("3: Sync device profile");
    Serial.println("4: Poll commands");
    Serial.println("5: System summary");
    Serial.println("6: Network info");
    Serial.println("7: API stats");
    Serial.println("8: Last scan info");
    Serial.println("9: Clear registration tag");
    Serial.println("0: Clear LED display");
    Serial.println("D: Retry activation");
    Serial.println("#: Exit menu");
  }
}

void hideKeypadMenu() {
  keypadMenuVisible = false;
  keypadMenuActive = false;
  clearMenuPanelArea();
  drawSectionBorders();
  redrawFooter();
}

void refreshMenuPanel() {
  updateMenuPanelIfVisible();
}

void recordMenuKey(char key) {
  if (key == 0) {
    return;
  }
  lastKeyPressed = key;
  redrawFooter();
}

void showSystemSummaryPanel() {
  updateStatusSection("SYSTEM SUMMARY", TFT_CYAN);

  String lines[8];
  lines[0] = String("Device: ") + safeTruncate(deviceConfig.name.length() ? deviceConfig.name : deviceId, 26);
  lines[1] = String("Location: ") + safeTruncate(deviceConfig.location, 26);
  lines[2] = String("Firmware: ") + String(deviceConfig.version);
  lines[3] = String("Mode: ") + (registrationMode ? String("Registration") : String("Normal"));
  lines[4] = String("Offline mode: ") + formatBool(offlineMode);
  lines[5] = String("Scans: ") + String(systemStatus.scanCount) + String(" (errors ") + String(systemStatus.errorCount) + ")";
  lines[6] = String("Heartbeat: ") + (lastHeartbeat ? formatMillisAgo(lastHeartbeat) : String("never"));
  lines[7] = String("Free heap: ") + String(ESP.getFreeHeap() / 1024) + " KB";

  drawDiagnosticLines(lines, sizeof(lines) / sizeof(lines[0]));
  updateFooter("System summary displayed");
}

void showNetworkInfoPanel() {
  updateStatusSection("NETWORK INFO", TFT_CYAN);

  String lines[8];
  lines[0] = String("SSID: ") + (wifiConfig.ssid ? String(wifiConfig.ssid) : String("<unset>"));
  lines[1] = String("MAC: ") + deviceId;
  lines[2] = String("IP: ") + (networkModule.isConnected() ? networkModule.getIpAddress() : String("offline"));
  lines[3] = String("Signal: ") + (networkModule.isConnected() ? String(WiFi.RSSI()) + " dBm" : String("n/a"));
  lines[4] = String("Reconnects: ") + String(networkModule.getReconnectAttempts());
  unsigned long lastAttempt = networkModule.getLastAttemptTime();
  lines[5] = String("Last attempt: ") + (lastAttempt ? formatMillisAgo(lastAttempt) : String("never"));
  lines[6] = String("Timeout: ") + String(networkModule.isConnected() ? "none" : "pending");
  lines[7] = String("Server: ") + safeTruncate(serverConfig.baseUrl, 26);

  drawDiagnosticLines(lines, sizeof(lines) / sizeof(lines[0]));
  updateFooter("Network diagnostics updated");
}

void showApiDiagnosticsPanel() {
  updateStatusSection("API STATS", TFT_CYAN);

  unsigned long total = 0, success = 0, failed = 0, avg = 0;
  apiModule.getStatistics(total, success, failed, avg);

  String lines[8];
  lines[0] = String("Base URL: ") + safeTruncate(serverConfig.baseUrl, 26);
  lines[1] = String("Initialized: ") + formatBool(apiModule.isInitialized());
  lines[2] = String("Success rate: ") + String(apiModule.getSuccessRate(), 1) + "%";
  lines[3] = String("Pending fails: ") + String(apiModule.getConsecutiveFailures());
  lines[4] = String("Requests: ") + String(total) + String(" (ok ") + String(success) + ")";
  lines[5] = String("Failures: ") + String(failed);
  unsigned long lastRequest = apiModule.getLastRequestTime();
  lines[6] = String("Last request: ") + (lastRequest ? formatMillisAgo(lastRequest) : String("never"));
  lines[7] = String("Avg latency: ") + (avg ? String(avg) + " ms" : String("n/a"));

  drawDiagnosticLines(lines, sizeof(lines) / sizeof(lines[0]));
  updateFooter("API diagnostics displayed");
}

void showLastScanPanel() {
  updateStatusSection("LAST SCAN", TFT_CYAN);

  String lines[8];
  lines[0] = String("Tag: ") + (lastScannedTag.length() ? safeTruncate(lastScannedTag, 16) : String("none"));
  lines[1] = String("Seen: ") + (lastScanTime ? formatMillisAgo(lastScanTime) : String("never"));
  lines[2] = String("Registration: ") + (registrationMode ? String("ON") : String("OFF"));
  lines[3] = String("Expected: ") + (expectedRegistrationTagId.length() ? safeTruncate(expectedRegistrationTagId, 12) : String("none"));
  lines[4] = String("Scan mode: ") + formatBool(deviceConfig.scanMode);
  lines[5] = String("Offline mode: ") + formatBool(offlineMode);
  lines[6] = String("Scans: ") + String(systemStatus.scanCount) + " | Err: " + String(systemStatus.errorCount);
  const String& ledCmd = getLastLedCommand();
  if (ledCmd.length()) {
    String ledDetail = String("LED: ") + safeTruncate(ledCmd, 6);
    const String& ledParam = getLastLedParam1();
    if (ledParam.length()) {
      ledDetail += "|" + safeTruncate(ledParam, 6);
    }
    unsigned long ledTime = getLastLedSendTime();
    ledDetail += " (" + (ledTime ? formatMillisAgo(ledTime) : String("never")) + ")";
    lines[7] = safeTruncate(ledDetail, 26);
  } else {
    lines[7] = String("LED: none");
  }

  drawDiagnosticLines(lines, sizeof(lines) / sizeof(lines[0]));
  updateFooter("Last scan details");
}

// Test mode display functions
void showMenu(const char* title, const char* items) {
  tft.fillScreen(TFT_BLACK);
  tft.setCursor(0, 0);
  tft.setTextSize(2);
  tft.setTextColor(TFT_CYAN);
  tft.println(title);
  tft.setTextSize(1);
  tft.println("");
  tft.setTextColor(TFT_WHITE);
  tft.println(items);
}

void showTestResult(const char* testName, bool passed, const char* details) {
  tft.fillRect(0, 100, SCREEN_WIDTH, 80, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, 100);
  
  tft.setTextSize(2);
  tft.setTextColor(passed ? TFT_GREEN : TFT_RED);
  tft.println(passed ? "PASS" : "FAIL");
  
  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE);
  tft.println("");
  tft.println(testName);
  
  if (details) {
    tft.setTextColor(TFT_LIGHTGREY);
    tft.println(details);
  }
}

void showKeypadInput(char key, int count) {
  tft.fillRect(0, 100, SCREEN_WIDTH, 80, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, 100);
  
  tft.setTextColor(TFT_MAGENTA);
  tft.println("KEYPAD:");
  tft.setTextSize(4);
  tft.setTextColor(TFT_YELLOW);
  tft.println(key);
  tft.setTextSize(1);
  
  if (count > 0) {
    tft.setTextColor(TFT_WHITE);
    tft.print("Count: ");
    tft.println(count);
  }
}

void showRFIDScan(const String& tagId, int count) {
  tft.fillRect(0, 170, SCREEN_WIDTH, 70, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, 170);
  
  tft.setTextColor(TFT_CYAN);
  tft.println("RFID:");
  tft.setTextSize(2);
  tft.setTextColor(TFT_GREEN);
  tft.println(tagId.substring(0, 16));
  tft.setTextSize(1);
  
  if (count > 0) {
    tft.setTextColor(TFT_WHITE);
    tft.print("Count: ");
    tft.println(count);
  }
}

void drawHeartbeat() {
  // Draw heartbeat indicator
  int hbX = SCREEN_WIDTH - 16;
  tft.fillCircle(hbX, 8, 4, TFT_GREEN);
  delay(100);
  tft.fillCircle(hbX, 8, 4, TFT_BLACK);
}

void showColumnTest(int col, const char* expectedKeys) {
  tft.fillScreen(TFT_BLACK);
  tft.setCursor(0, 0);
  tft.setTextColor(TFT_YELLOW);
  tft.print("COLUMN ");
  tft.print(col);
  tft.println(" TEST");
  tft.setTextColor(TFT_WHITE);
  tft.println("");
  tft.print("Expected: ");
  tft.println(expectedKeys);
  tft.println("");
  tft.println("Press any key...");
  tft.println("(10s timeout)");
}

void showPinStates(const byte* rowPins, const byte* colPins, int rowCount, int colCount) {
  tft.fillScreen(TFT_BLACK);
  tft.setCursor(0, 0);
  tft.setTextColor(TFT_YELLOW);
  tft.println("PIN INSPECTOR");
  tft.setTextColor(TFT_WHITE);
  tft.println("");
  
  tft.println("ROW PINS:");
  for (int i = 0; i < rowCount; i++) {
    int state = digitalRead(rowPins[i]);
    tft.print("R");
    tft.print(i);
    tft.print("(");
    tft.print(rowPins[i]);
    tft.print("): ");
    tft.setTextColor(state ? TFT_GREEN : TFT_RED);
    tft.println(state ? "HIGH" : "LOW");
    tft.setTextColor(TFT_WHITE);
  }
  
  tft.println("");
  tft.println("COL PINS:");
  for (int j = 0; j < colCount; j++) {
    int state = digitalRead(colPins[j]);
    tft.print("C");
    tft.print(j);
    tft.print("(");
    tft.print(colPins[j]);
    tft.print("): ");
    tft.setTextColor(state ? TFT_GREEN : TFT_RED);
    tft.println(state ? "HIGH" : "LOW");
    tft.setTextColor(TFT_WHITE);
  }
  
  tft.println("");
  tft.setTextColor(TFT_CYAN);
  tft.println("Press any key...");
}

void showTitle(const char* title) {
  tft.fillScreen(TFT_BLACK);
  tft.setCursor(0, 0);
  tft.setTextSize(2);
  tft.setTextColor(TFT_CYAN);
  tft.println(title);
  tft.setTextSize(1);
  tft.println("");
}

void showMessage(const String& title, const String& message) {
  tft.fillRect(0, 80, SCREEN_WIDTH, 80, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, 80);
  
  tft.setTextSize(1);
  tft.setTextColor(TFT_CYAN);
  tft.println(title);
  
  tft.setTextSize(2);
  tft.setTextColor(TFT_GREEN);
  tft.println(message.substring(0, 20));
  tft.setTextSize(1);
}

namespace {
  void drawLabelValueLine(int cursorY, const char* label, const String& value, uint16_t valueColor) {
    tft.setCursor(LEFT_MARGIN, cursorY);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.print(label);
    tft.setTextColor(valueColor, TFT_BLACK);
    tft.println(value);
  }
}

void updateRfidScanDetails(
  const String& tagId,
  const String& unitNumber,
  const String& userName,
  bool tagActive,
  bool userAssigned,
  bool userActive,
  const String& statusLabel,
  uint16_t statusColor,
  const String& secondaryMessage
) {
  tft.fillRect(LEFT_MARGIN, SCAN_SECTION_Y + 15, getContentWidth(), SCAN_SECTION_HEIGHT - 20, TFT_BLACK);

  tft.setTextSize(2);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, SCAN_SECTION_Y + 15);
  tft.print("Tag: ");
  tft.println(tagId.length() > 0 ? tagId.substring(0, 20) : "-");

  int infoY = SCAN_SECTION_Y + 40;
  tft.setTextSize(1);

  drawLabelValueLine(infoY, "Unit: ", unitNumber.length() > 0 ? unitNumber : String("-"),
                     unitNumber.length() > 0 ? TFT_CYAN : TFT_LIGHTGREY);
  infoY += 15;

  String userValue;
  uint16_t userColor = TFT_LIGHTGREY;
  if (userAssigned) {
    userValue = userName.length() > 0 ? userName : String("Assigned");
    userColor = userActive ? TFT_CYAN : TFT_ORANGE;
    if (userAssigned && !userActive && userValue.length() > 0) {
      userValue += " (inactive)";
    }
  } else {
    userValue = "Unassigned";
  }
  drawLabelValueLine(infoY, "User: ", userValue, userColor);
  infoY += 15;

  drawLabelValueLine(infoY, "Active: ", tagActive ? "Yes" : "No", tagActive ? TFT_GREEN : TFT_RED);
  infoY += 25;

  tft.setTextSize(2);
  tft.setCursor(LEFT_MARGIN, infoY);
  tft.setTextColor(statusColor, TFT_BLACK);
  tft.println(statusLabel);
  infoY += 20;

  if (secondaryMessage.length() > 0) {
    tft.setTextSize(1);
    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
    tft.setCursor(LEFT_MARGIN, infoY);
    tft.println(secondaryMessage);
  }
}

void showQueueMatrix(const String& cascade) {
  tft.fillRect(LEFT_MARGIN, SCAN_SECTION_Y + 15, getContentWidth(), SCAN_SECTION_HEIGHT - 20, TFT_BLACK);

  tft.setTextSize(1);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(LEFT_MARGIN, SCAN_SECTION_Y + 15);
  tft.println("Queue Matrix:");

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  
  // Parse cascade string into array first
  String slots[40];
  int slotCount = 0;
  
  String tempCascade = cascade;
  int startIdx = 0;
  int commaIdx = tempCascade.indexOf(',');
  
  while (startIdx < tempCascade.length() && slotCount < 40) {
    String slotValue;
    
    if (commaIdx == -1) {
      // Last value
      slotValue = tempCascade.substring(startIdx);
      startIdx = tempCascade.length();
    } else {
      // Get value before comma
      slotValue = tempCascade.substring(startIdx, commaIdx);
      startIdx = commaIdx + 1;
      commaIdx = tempCascade.indexOf(',', startIdx);
    }
    
    // Clean up the value
    slotValue.trim();
    if (slotValue.length() == 0 || slotValue == "0") {
      slotValue = "-";
    }
    
    // Truncate if too long for display
    if (slotValue.length() > 6) {
      slotValue = slotValue.substring(0, 6);
    }
    
    slots[slotCount++] = slotValue;
  }
  
  // Build last index map for coloring (like LED matrix)
  std::map<String, int> lastIndexByValue;
  for (int i = 0; i < slotCount; i++) {
    String value = slots[i];
    if (value != "-") {
      lastIndexByValue[value] = i;
    }
  }
  
  // Display in column-major order (fill down columns first)
  int y = SCAN_SECTION_Y + 30;
  int lineHeight = 12;
  int colWidth = 45; // Width for each column
  int colsPerRow = 5; // 5 columns per row
  int rowsPerCol = 8; // 8 rows per column (40 slots / 5 columns)
  
  for (int row = 0; row < rowsPerCol; row++) {
    for (int col = 0; col < colsPerRow; col++) {
      int slotIndex = col * rowsPerCol + row; // Column-major indexing
      
      if (slotIndex < slotCount) {
        // Calculate position
        int x = LEFT_MARGIN + (col * colWidth);
        
        // Determine color like LED matrix: green for latest (ongoing), cyan for previous
        String value = slots[slotIndex];
        uint16_t textColor = TFT_WHITE;
        uint16_t bgColor = TFT_BLACK;
        
        if (value != "-") {
          bool isLatest = (lastIndexByValue[value] == slotIndex);
          textColor = isLatest ? TFT_GREEN : TFT_CYAN;
        }
        
        // Check if this slot should be highlighted (for override navigation)
        bool isHighlighted = false;
        if (overrideActive && overrideStage == 2) {
          // Convert row-major cursor position to column-major display position
          int cursorRow = overrideCursor / 5;
          int cursorCol = overrideCursor % 5;
          int displayCursor = cursorCol * rowsPerCol + cursorRow;
          if (slotIndex == displayCursor) {
            isHighlighted = true;
          }
        }
        
        // Draw highlight background if selected
        if (isHighlighted) {
          bgColor = TFT_YELLOW;
          textColor = TFT_BLACK;
        }
        
        tft.setTextColor(textColor, bgColor);
        
        // Draw the slot value
        tft.setCursor(x, y);
        tft.print(slots[slotIndex]);
      }
    }
    y += lineHeight;
  }

  updateMenuPanelIfVisible();
}

void showQueuePanel(const String& cascade) {
  queuePanelVisible = true;
  clearMenuPanelArea();
  drawMenuPanelFrame();

  int innerX = MENU_PANEL_X + MENU_PANEL_PADDING;
  int cursorY = MENU_PANEL_Y;

  tft.setTextSize(2);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.setCursor(innerX, cursorY);
  tft.println("Queue");
  cursorY += 18;

  tft.setTextSize(1);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(innerX, cursorY);
  tft.println("Matrix:");
  cursorY += 16;

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  
  // Parse cascade string into array first
  String slots[40];
  int slotCount = 0;
  
  String tempCascade = cascade;
  int startIdx = 0;
  int commaIdx = tempCascade.indexOf(',');
  
  while (startIdx < tempCascade.length() && slotCount < 40) {
    String slotValue;
    
    if (commaIdx == -1) {
      // Last value
      slotValue = tempCascade.substring(startIdx);
      startIdx = tempCascade.length();
    } else {
      // Get value before comma
      slotValue = tempCascade.substring(startIdx, commaIdx);
      startIdx = commaIdx + 1;
      commaIdx = tempCascade.indexOf(',', startIdx);
    }
    
    // Clean up the value
    slotValue.trim();
    if (slotValue.length() == 0 || slotValue == "0") {
      slotValue = "-";
    }
    
    // Truncate if too long for display
    if (slotValue.length() > 4) {
      slotValue = slotValue.substring(0, 4);
    }
    
    slots[slotCount++] = slotValue;
  }
  
  // Display in column-major order (fill down columns first)
  int y = cursorY;
  int lineHeight = 12;
  int colWidth = 35; // Narrower columns for panel
  int colsPerRow = 4; // 4 columns in panel
  int rowsPerCol = 10; // 10 rows per column (40 slots / 4 columns)
  
  for (int row = 0; row < rowsPerCol; row++) {
    for (int col = 0; col < colsPerRow; col++) {
      int slotIndex = col * rowsPerCol + row; // Column-major indexing
      
      if (slotIndex < slotCount) {
        // Calculate position
        int x = innerX + (col * colWidth);
        
        // Check if this slot should be highlighted (for override navigation)
        bool isHighlighted = false;
        if (overrideActive && overrideStage == 2) {
          // Convert row-major cursor position to column-major display position
          int cursorRow = overrideCursor / 4;  // 4 columns in panel
          int cursorCol = overrideCursor % 4;
          int displayCursor = cursorCol * rowsPerCol + cursorRow;
          if (slotIndex == displayCursor) {
            isHighlighted = true;
          }
        }
        
        // Draw highlight background if selected
        if (isHighlighted) {
          tft.fillRect(x - 2, y - 1, colWidth - 2, lineHeight, TFT_YELLOW);
          tft.setTextColor(TFT_BLACK, TFT_YELLOW);
        } else {
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
        }
        
        // Draw the slot value
        tft.setCursor(x, y);
        tft.print(slots[slotIndex]);
      }
    }
    y += lineHeight;
  }

  // Add close instruction
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.setCursor(innerX, y + 5);
  tft.println("*: Close panel");
}

void hideQueuePanel() {
  queuePanelVisible = false;
  clearMenuPanelArea();
  drawSectionBorders();
}