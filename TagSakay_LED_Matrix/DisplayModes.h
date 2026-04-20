#ifndef DISPLAY_MODES_H
#define DISPLAY_MODES_H

#include <Arduino.h>
#include "Config.h"
#include <map>

// Display mode functions
void displayIdleScreen();
void displayQueueNumber(int queueNumber, String name);
void displayQueueStatus(String status, String tagId); // New function
void displayCascade(const int* queueNumbers, int numQueues, const String* unitNumbers = nullptr);
void displayCascadePicker(int cursorIndex);
void displayStatus(String status, uint16_t color);
void displayMessage(String message, uint16_t color);
void displayScanResult(String name, String eventType);
void displayError(String errorType, String message);
void displayTestPattern();
void displayWelcomeScreen();
void redrawCascade();
void updateQueueState(String id, String state);

#endif // DISPLAY_MODES_H