#ifndef DISPLAY_MODULE_H
#define DISPLAY_MODULE_H

#include <Arduino.h>
#include <TFT_eSPI.h>
#include "Config.h"

// TFT Display object
extern TFT_eSPI tft;

// Display initialization and layout
void initializeTFT();
void clearScreen();
void drawHeader();
void drawSectionBorders();

// Status updates
void updateStatusSection(const String& msg, uint16_t color);
void updateConnectionStatus(const String& wifi, const String& time, const String& device);
void updateScanSection(const String& tagId, const String& status, const String& userInfo, uint16_t color);
void updateFooter(const String& msg);
void showHeartbeat(bool active);
void updateRfidScanDetails(
	const String& tagId,
	const String& unitNumber,
	const String& userName,
	bool tagActive,
	bool userAssigned,
	bool userActive,
	const String& statusLabel,
	uint16_t statusColor,
	const String& secondaryMessage = ""
);
void showRfidDetailError(const String& tagId, const String& message);
void showQueueMatrix(const String& cascade);
void showQueuePanel(const String& cascade);
void hideQueuePanel();

// Legacy compatibility
void showStatus(const String& msg, uint16_t color = TFT_WHITE, int x = 10, int y = 200, int textSize = 2);
void showRFIDScan(const String& tagId, const String& status, uint16_t color);

// Visual indicators
void indicateSuccess();
void indicateError();
void indicateUnregisteredTag();
void indicateRegistrationMode();
void indicateReady();
void indicateRegistrationTagDetected();
void blinkError(int times);

// Keypad display
void displayKeypadPrompt(const String& prompt, const String& buffer);
void showKeypadMenu(bool refreshFooter = true);
void hideKeypadMenu();
void refreshMenuPanel();
void recordMenuKey(char key);

// Test mode displays
void showMenu(const char* title, const char* items);
void showTestResult(const char* testName, bool passed, const char* details = nullptr);
void showKeypadInput(char key, int count);
void showRFIDScan(const String& tagId, int count);
void drawHeartbeat();
void showColumnTest(int col, const char* expectedKeys);
void showPinStates(const byte* rowPins, const byte* colPins, int rowCount, int colCount);
void showTitle(const char* title);
void showMessage(const String& title, const String& message);
void showSystemSummaryPanel();
void showNetworkInfoPanel();
void showApiDiagnosticsPanel();
void showLastScanPanel();

#endif // DISPLAY_MODULE_H