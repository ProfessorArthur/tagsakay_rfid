#include "DisplayModes.h"
#include "DisplayCore.h"
#include "PixelFont.h"
#include "Animations.h"

// Optimized cascade display structures
static int cascadeQueueBuffer[MAX_CASCADE_ENTRIES] = {0};
static String cascadeUnitBuffer[MAX_CASCADE_ENTRIES];
static String cascadeDisplayValues[MAX_CASCADE_ENTRIES];
static int cascadeEntryCount = 0;
static int cascadeMaxDigitsUsed = 2;
static int cascadeNumbersPerRowUsed = NUMBERS_PER_ROW;
static bool cascadeHasUnitData = false;

// Cached layout calculations (recalculated only when data changes)
static int cachedEntryWidth = 0;
static int cachedRowsPerCol = 0;
static int cachedColWidth = 0;
static int cachedMaxCols = 0;
static bool layoutCacheValid = false;

static std::map<String, String> queueStateMap;

// Forward declarations
static void renderCascade();
static void invalidateLayoutCache();
static uint16_t getQueueItemColor(const String& displayValue, int index, const std::map<String, int>& lastIndexByValue);
static void calculateLayoutParameters();

static void invalidateLayoutCache() {
  layoutCacheValid = false;
}

// Utility to display single-digit unit numbers as zero-padded (01..09)
static String padUnitNumber(const String& input) {
  String v = input;
  v.trim();
  // Do not pad an explicit '0' (used as empty/default slot)
  if (v == "0") return v;

  if (v.length() == 1) {
    char ch = v.charAt(0);
    // Pad only if it's 1-9 (not 0)
    if (ch >= '1' && ch <= '9') {
      return String("0") + v;
    }
  }
  return v;
}

static void calculateLayoutParameters() {
  if (layoutCacheValid) return;

  cachedEntryWidth = cascadeMaxDigitsUsed * DIGIT_WIDTH;
  cachedRowsPerCol = (PANEL_RES_Y * NUM_ROWS - START_Y) / ROW_HEIGHT;
  if (cachedRowsPerCol < 1) cachedRowsPerCol = 1;

  cachedColWidth = cachedEntryWidth + PIPE_WIDTH + 2;
  cachedMaxCols = (PANEL_RES_X - MARGIN) / cachedColWidth;
  if (cachedMaxCols < 1) cachedMaxCols = 1;

  layoutCacheValid = true;
}

static uint16_t getQueueItemColor(const String& displayValue, int index, const std::map<String, int>& lastIndexByValue) {
  // Check for explicit queue state (this takes precedence)
  if (queueStateMap.count(displayValue)) {
    String state = queueStateMap[displayValue];
    if (state == "ONGOING") {
      // Only mark ONGOING as green for the latest occurrence; older duplicates should be cyan
      auto it = lastIndexByValue.find(displayValue);
      if (it != lastIndexByValue.end() && it->second == index) {
        return COLOR_GREEN;
      }
      return COLOR_CYAN;
    }
    if (state == "COMPLETED") return COLOR_CYAN;
    if (state == "RESERVE") return COLOR_MAGENTA;
    if (state == "FIX") return COLOR_AMBER;
    if (state == "ERROR") return COLOR_ERROR;
    if (state == "INFO") return COLOR_INFO;
  }

  // Determine if this is the latest occurrence of this value
  bool isLatest = true;
  auto latestIt = lastIndexByValue.find(displayValue);
  if (latestIt != lastIndexByValue.end()) {
    isLatest = (latestIt->second == index);
  }

  // If not the latest occurrence, use cyan (previous/completed)
  if (!isLatest) {
    return COLOR_CYAN;
  }

  // Default: latest occurrence is active (green)
  return COLOR_GREEN;
}

void updateQueueState(String id, String state) {
  id.trim();
  state.trim();
  state.toUpperCase();

  if (state == "CLEAR" || state == "RESET") {
    queueStateMap.erase(id);
  } else {
    queueStateMap[id] = state;
  }

  Serial.println("Queue State Updated: " + id + " -> " + state);

  if (currentDisplay.mode == MODE_CASCADE) {
    invalidateLayoutCache(); // Invalidate cache since colors may have changed
    redrawCascade();
  }
}

void displayIdleScreen() {
  currentDisplay.mode = MODE_IDLE;
  currentDisplay.startTime = millis();
  currentDisplay.duration = 0;
  currentDisplay.scrolling = false;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  drawBorder(COLOR_BLUE);
  
  virtualDisp->setTextSize(1);
  virtualDisp->setTextColor(COLOR_CYAN);
  drawCenteredText("TagSakay", 10, COLOR_CYAN, 1);
  drawCenteredText("LED Matrix", 25, COLOR_WHITE, 1);
  
  if (location.length() > 0) {
    drawCenteredText(location, 40, COLOR_GREEN, 1);
  }
  
  drawCenteredText("Ready", 55, COLOR_READY, 1);
  
  dma_display->flipDMABuffer();  // Initial display flip
  Serial.println("Display: Idle screen");
}

void displayQueueNumber(int queueNumber, String name) {
  currentDisplay.mode = MODE_QUEUE;
  currentDisplay.queueNumber = queueNumber;
  currentDisplay.primaryText = name;
  currentDisplay.startTime = millis();
  currentDisplay.duration = QUEUE_DISPLAY_DURATION;
  currentDisplay.scrolling = (name.length() > 10);
  currentDisplay.scrollPosition = PANEL_RES_X;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  animateTransition();
  drawBorder(COLOR_GREEN);
  
  drawCenteredText("NOW SERVING", 5, COLOR_YELLOW, 1);
  drawLargePixelNumber(10, 20, queueNumber, COLOR_GREEN);
  
  if (currentDisplay.scrolling) {
    drawScrollingText(name, 50, COLOR_WHITE);
  } else {
    drawCenteredText(name, 50, COLOR_WHITE, 1);
  }
  
  dma_display->flipDMABuffer();  // Initial display flip
  Serial.println("Display: Queue #" + String(queueNumber) + " - " + name);
}

void displayQueueStatus(String status, String tagId) {
  currentDisplay.mode = MODE_SCAN; // Reuse scan mode for layout
  currentDisplay.primaryText = tagId;
  currentDisplay.secondaryText = status;
  currentDisplay.startTime = millis();
  currentDisplay.duration = MESSAGE_DURATION;
  currentDisplay.scrolling = (tagId.length() > 10);
  currentDisplay.scrollPosition = PANEL_RES_X;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  
  uint16_t color = COLOR_INFO;
  if (status == "ONGOING") color = COLOR_GREEN;
  else if (status == "COMPLETED") color = COLOR_CYAN;
  else if (status == "RESERVE") color = COLOR_MAGENTA;
  else if (status == "FIX") color = COLOR_AMBER;
  else if (status == "MODE") color = COLOR_CYAN;
  
  drawBorder(color);
  
  if (status == "MODE") {
     drawCenteredText("QUEUE MODE", 15, color, 1);
     drawCenteredText(tagId, 35, COLOR_WHITE, 1); // "ACTIVE"
  } else {
     drawCenteredText(status, 15, color, 1);
     if (currentDisplay.scrolling) {
       drawScrollingText(tagId, 35, COLOR_WHITE);
     } else {
       drawCenteredText(tagId, 35, COLOR_WHITE, 1);
     }
  }
  
  dma_display->flipDMABuffer();
  Serial.println("Display: Queue Status - " + status + " | " + tagId);
}

void displayCascade(int* queueNumbers, int numQueues) {
  displayCascade(queueNumbers, numQueues, nullptr);
}

void displayStatus(String status, uint16_t color) {
  currentDisplay.mode = MODE_STATUS;
  currentDisplay.primaryText = status;
  currentDisplay.color = color;
  currentDisplay.startTime = millis();
  currentDisplay.duration = MESSAGE_DURATION;
  currentDisplay.scrolling = false;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  drawBorder(color);
  drawCenteredText(status, 28, color, 1);
  
  dma_display->flipDMABuffer();  // Initial display flip
  Serial.println("Display: Status - " + status);
}

void displayMessage(String message, uint16_t color) {
  currentDisplay.mode = MODE_MESSAGE;
  currentDisplay.primaryText = message;
  currentDisplay.color = color;
  currentDisplay.startTime = millis();
  currentDisplay.duration = MESSAGE_DURATION;
  currentDisplay.scrolling = (message.length() > 10);
  currentDisplay.scrollPosition = PANEL_RES_X;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  drawBorder(color);
  
  if (currentDisplay.scrolling) {
    drawScrollingText(message, 28, color);
  } else {
    drawCenteredText(message, 28, color, 1);
  }
  
  dma_display->flipDMABuffer();  // Initial display flip
  Serial.println("Display: Message - " + message);
}

void displayScanResult(String name, String eventType) {
  currentDisplay.mode = MODE_SCAN;
  String displayName = padUnitNumber(name);
  currentDisplay.primaryText = displayName;
  currentDisplay.secondaryText = eventType;
  currentDisplay.startTime = millis();
  currentDisplay.duration = MESSAGE_DURATION;
  currentDisplay.scrolling = (displayName.length() > 10);
  currentDisplay.scrollPosition = PANEL_RES_X;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  animateSuccess();
  drawBorder(COLOR_SUCCESS);
  
  uint16_t eventColor = COLOR_GREEN;
  String eventUpper = eventType;  // Normalize for consistent color mapping
  eventUpper.toUpperCase();
  if (eventUpper.indexOf("SUCCESS") >= 0) eventColor = COLOR_GREEN;
  else if (eventUpper.indexOf("OUT") >= 0) eventColor = COLOR_ORANGE;
  else if (eventUpper.indexOf("IN") >= 0) eventColor = COLOR_CYAN;
  else if (eventUpper.indexOf("UNREG") >= 0) eventColor = COLOR_WARNING;
  else if (eventUpper.indexOf("WAIT") >= 0) eventColor = COLOR_INFO;
  else if (eventUpper.indexOf("ERROR") >= 0) eventColor = COLOR_ERROR;
  
  drawCenteredText(eventType, 8, eventColor, 1);
  
  virtualDisp->fillRect(28, 20, 8, 3, COLOR_GREEN);
  virtualDisp->fillRect(32, 23, 3, 8, COLOR_GREEN);
  
  if (currentDisplay.scrolling) {
    drawScrollingText(displayName, 40, COLOR_WHITE);
  } else {
    drawCenteredText(displayName, 40, COLOR_WHITE, 1);
  }
  
  dma_display->flipDMABuffer();  // Initial display flip
  Serial.println("Display: Scan - " + displayName + " | " + eventType);
}

void displayError(String errorType, String message) {
  currentDisplay.mode = MODE_ERROR;
  currentDisplay.primaryText = errorType;
  currentDisplay.secondaryText = message;
  currentDisplay.startTime = millis();
  currentDisplay.duration = MESSAGE_DURATION;
  currentDisplay.scrolling = false;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  drawBorder(COLOR_ERROR);
  
  virtualDisp->drawLine(26, 10, 38, 22, COLOR_ERROR);
  virtualDisp->drawLine(38, 10, 26, 22, COLOR_ERROR);
  virtualDisp->drawLine(27, 10, 39, 22, COLOR_ERROR);
  virtualDisp->drawLine(39, 10, 27, 22, COLOR_ERROR);
  
  drawCenteredText(errorType, 30, COLOR_ERROR, 1);
  
  if (message.length() > 0) {
    drawCenteredText(message.substring(0, 10), 45, COLOR_YELLOW, 1);
  }
  
  dma_display->flipDMABuffer();  // Initial display flip
  Serial.println("Display: Error - " + errorType + " | " + message);
}

void displayTestPattern() {
  currentDisplay.mode = MODE_TEST;
  currentDisplay.startTime = millis();
  currentDisplay.duration = 5000;
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  
  drawPixelNumber(5, 5, 12, COLOR_WHITE);
  drawPixelNumber(20, 5, 34, COLOR_AMBER);
  drawPixelNumber(35, 5, 56, COLOR_GREEN);
  
  drawLargePixelNumber(5, 20, 78, COLOR_CYAN);
  drawLargePixelNumber(5, 40, 90, COLOR_MAGENTA);
  
  drawCenteredText("TEST PATTERN", 58, COLOR_WHITE, 1);
  
  dma_display->flipDMABuffer();  // Initial display flip
  Serial.println("Display: Test pattern");
}

void displayWelcomeScreen() {
  currentDisplay.queueList = nullptr;
  currentDisplay.queueListSize = 0;
  currentDisplay.queueUnitList = nullptr;
  
  virtualDisp->fillScreen(COLOR_BLACK);
  drawBorder(COLOR_CYAN);
  
  virtualDisp->setTextSize(1);
  virtualDisp->setTextColor(COLOR_CYAN);
  drawCenteredText("TagSakay", 10, COLOR_CYAN, 1);
  
  drawCenteredText("RFIDSystem", 25, COLOR_WHITE, 1);
  drawCenteredText("-Loading-", 40, COLOR_GREEN, 1);
  
  // Animate progress bar (intentional multiple flips for animation effect)
  for (int i = 0; i <= 100; i += 10) {
    drawProgressBar(i, 55, COLOR_GREEN);
    dma_display->flipDMABuffer();
    delay(100);
  }
  
  Serial.println("Display: Welcome screen");
}

void displayCascade(const int* queueNumbers, int numQueues, const String* unitNumbers) {
  if (queueNumbers == nullptr || numQueues <= 0) {
    return;
  }

  int cappedQueues = numQueues;
  if (cappedQueues > MAX_CASCADE_ENTRIES) {
    cappedQueues = MAX_CASCADE_ENTRIES;
  }

  cascadeEntryCount = cappedQueues;
  cascadeHasUnitData = (unitNumbers != nullptr);
  cascadeMaxDigitsUsed = 1;

  for (int i = 0; i < cascadeEntryCount; i++) {
    cascadeQueueBuffer[i] = queueNumbers[i];
    cascadeUnitBuffer[i] = "";

    String displayValue = String(queueNumbers[i]);
    displayValue = padUnitNumber(displayValue);

    if (unitNumbers != nullptr) {
      String unitValue = unitNumbers[i];
      unitValue.trim();
      cascadeUnitBuffer[i] = padUnitNumber(unitValue);
        if (unitValue.length() > 0) {
          displayValue = padUnitNumber(unitValue);
        }
    }

    cascadeDisplayValues[i] = displayValue;

    int digits = displayValue.length();
    if (digits > cascadeMaxDigitsUsed) {
      cascadeMaxDigitsUsed = digits;
    }
  }

  if (cascadeMaxDigitsUsed > MAX_DIGITS_PER_ENTRY) {
    cascadeMaxDigitsUsed = MAX_DIGITS_PER_ENTRY;
  }

  int entryWidth = cascadeMaxDigitsUsed * DIGIT_WIDTH;
  cascadeNumbersPerRowUsed = NUMBERS_PER_ROW;

  while (cascadeNumbersPerRowUsed > 1) {
    int requiredWidth = (cascadeNumbersPerRowUsed * entryWidth) + ((cascadeNumbersPerRowUsed - 1) * (PIPE_WIDTH + 1)) + (MARGIN * 2);
    if (requiredWidth <= PANEL_RES_X) {
      break;
    }
    cascadeNumbersPerRowUsed--;
  }

  if (cascadeNumbersPerRowUsed < 1) {
    cascadeNumbersPerRowUsed = 1;
  }

  // Invalidate layout cache since data has changed
  invalidateLayoutCache();

  currentDisplay.mode = MODE_CASCADE;
  currentDisplay.startTime = millis();
  currentDisplay.duration = 0;
  currentDisplay.scrolling = false;
  currentDisplay.queueList = cascadeQueueBuffer;
  currentDisplay.queueListSize = cascadeEntryCount;
  currentDisplay.queueUnitList = cascadeHasUnitData ? cascadeUnitBuffer : nullptr;

  renderCascade();

  Serial.print("Display: Cascade - ");
  Serial.print(cascadeEntryCount);
  Serial.print(" entries");
  if (cascadeHasUnitData) {
    Serial.print(" (unit numbers)");
  }
  Serial.println();
}

static void renderCascade() {
  if (cascadeEntryCount <= 0) {
    return;
  }

  // Calculate layout parameters (cached for performance)
  calculateLayoutParameters();

  virtualDisp->fillScreen(COLOR_BLACK);

  // Build map of last index by value (for determining latest occurrences)
  std::map<String, int> lastIndexByValue;
  for (int i = 0; i < cascadeEntryCount; i++) {
    String value = cascadeDisplayValues[i];
    value.trim();
    if (value.length() == 0 || value == "0") {
      continue;
    }
    lastIndexByValue[value] = i;
  }

  // Calculate display parameters
  int totalSlots = cachedRowsPerCol * cachedMaxCols;
  int startIndex = max(0, cascadeEntryCount - totalSlots);
  int displayCount = min(totalSlots, cascadeEntryCount);

  // Render each visible item
  for (int displayIndex = 0; displayIndex < displayCount; displayIndex++) {
    int i = startIndex + displayIndex;
    int row = displayIndex % cachedRowsPerCol;
    int col = displayIndex / cachedRowsPerCol;

    // Safety check (shouldn't be needed with proper calculations)
    if (col >= cachedMaxCols) break;

    int xPos = MARGIN + (col * cachedColWidth);
    int yPos = START_Y + (row * ROW_HEIGHT);

    String displayValue = cascadeDisplayValues[i];
    if (displayValue.length() == 0 || displayValue == "0") {
      continue;
    }

    // Get optimized color for this item
    uint16_t color = getQueueItemColor(displayValue, i, lastIndexByValue);

    // Render the number/identifier
    drawPixelNumberString(xPos, yPos, displayValue, cascadeMaxDigitsUsed, color);

    // Draw separator pipe between columns (not after last column)
    if (col < cachedMaxCols - 1) {
      drawPixelPipe(xPos + cachedEntryWidth + 1, yPos, COLOR_WHITE);
    }
  }

  dma_display->flipDMABuffer();
}

void redrawCascade() {
  renderCascade();
}

void displayCascadePicker(int cursorIndex) {
  if (cascadeEntryCount <= 0) {
    displayMessage("No entries", COLOR_ORANGE);
    return;
  }

  // Clamp cursorIndex
  if (cursorIndex < 0) cursorIndex = 0;
  if (cursorIndex >= cascadeEntryCount) cursorIndex = cascadeEntryCount - 1;

  // Calculate layout parameters (cached for performance)
  calculateLayoutParameters();

  virtualDisp->fillScreen(COLOR_BLACK);

  // Build map of last index by value (for determining latest occurrences)
  std::map<String, int> lastIndexByValue;
  for (int i = 0; i < cascadeEntryCount; i++) {
    String value = cascadeDisplayValues[i];
    value.trim();
    if (value.length() == 0 || value == "0") continue;
    lastIndexByValue[value] = i;
  }

  // Render all items with cursor highlighting
  for (int i = 0; i < cascadeEntryCount; i++) {
    int row = i % cachedRowsPerCol;
    int col = i / cachedRowsPerCol;
    if (col >= cachedMaxCols) break;

    int xPos = MARGIN + (col * cachedColWidth);
    int yPos = START_Y + (row * ROW_HEIGHT);

    String displayValue = cascadeDisplayValues[i];
    if (displayValue.length() == 0 || displayValue == "0") continue;

    // Get color using optimized function
    uint16_t color = getQueueItemColor(displayValue, i, lastIndexByValue);

    // Draw highlight for cursor
    if (i == cursorIndex) {
      virtualDisp->fillRect(xPos - 2, yPos - 2, cachedEntryWidth + 4, ROW_HEIGHT - 2, COLOR_DARK_BLUE);
      virtualDisp->drawRect(xPos - 3, yPos - 3, cachedEntryWidth + 6, ROW_HEIGHT, COLOR_YELLOW);
    }

    drawPixelNumberString(xPos, yPos, displayValue, cascadeMaxDigitsUsed, color);

    if (col < cachedMaxCols - 1) {
      drawPixelPipe(xPos + cachedEntryWidth + 1, yPos, COLOR_WHITE);
    }
  }

  // Footer showing selected slot info
  String footer = "Slot " + String(cursorIndex + 1);
  if (cursorIndex >= 0 && cursorIndex < cascadeEntryCount) {
    String v = cascadeDisplayValues[cursorIndex];
    if (v.length() > 0) footer += String(": ") + v;
  }
  drawCenteredText(footer, PANEL_RES_Y - 12, COLOR_WHITE, 1);
  drawCenteredText("Use 2/8/4/6 move  # select  * cancel", PANEL_RES_Y - 4, COLOR_INFO, 1);

  dma_display->flipDMABuffer();
}
