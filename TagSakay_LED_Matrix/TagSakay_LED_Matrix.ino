/*
 * TagSakay LED Matrix Display Controller (ESP32 #2) - MODULAR VERSION
 * 
 * Features:
 * - 64x64 P3 LED Matrix Panel control with double buffering
 * - Pixel-based number rendering for space efficiency
 * - Cascade display mode for multiple queue numbers
 * - UART communication with RFID ESP32 #1
 * - Status messages and animations
 */

#include "Config.h"
#include "DisplayCore.h"
#include "DisplayModes.h"
#include "PixelFont.h"
#include "Animations.h"
#include "UARTHandler.h"
#include "SDCardModule.h"

// Extern declarations
extern bool operationModeActive;

// Global state variable definitions
DisplayState currentDisplay = {
  MODE_IDLE,
  "TagSakay",
  "Ready",
  COLOR_READY,
  0,
  0,
  false,
  0,
  0,
  nullptr,
  0,
  nullptr
};

String deviceId = "";
String location = "";
bool systemInitialized = false;
uint8_t brightness = DEFAULT_BRIGHTNESS;
unsigned long lastUpdate = 0;
unsigned long lastHeartbeat = 0;
int animationFrame = 0;
unsigned long lastAnimationUpdate = 0;
unsigned long lastCascadeRefresh = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("<--- TagSakay LED Matrix Controller --->");
  Serial.println("ESP32 #2 - Modular Architecture");
  Serial.println("Double Buffering + Cascade Mode");
  
  // Initialize LED Matrix with double buffering
  initializeMatrix();
  
  // Initialize UART communication
  initializeUART();

  // Initialize SD Card
  if (sdCard.initialize()) {
    Serial.println("SD Card initialized successfully");
    // Optional: Log boot to SD
    sdCard.appendFile("/system.log", "System Booted\n");
  } else {
    Serial.println("SD Card initialization failed");
  }
  
  // Show welcome screen
  displayWelcomeScreen();
  delay(2000);
  
  // Start in idle mode
  displayIdleScreen();
  systemInitialized = true;
  
  Serial.println("System ready - waiting for commands from ESP32 #1");
}

void loop() {
  unsigned long currentMillis = millis();
  
  // Process incoming UART commands
  processUARTCommand();
  
  // Handle scrolling text and update display only when position changes
  if (currentDisplay.scrolling && (currentMillis - lastUpdate > SCROLL_SPEED)) {
    lastUpdate = currentMillis;
    currentDisplay.scrollPosition--;
    
    int textWidth = currentDisplay.primaryText.length() * 6;
    if (currentDisplay.scrollPosition < -textWidth) {
      currentDisplay.scrollPosition = PANEL_RES_X;
    }
    
    // Update display after scroll position changes (with buffer flip)
    updateDisplay();
  }
  
  // Handle animation updates
  if (currentMillis - lastAnimationUpdate > ANIMATION_SPEED) {
    lastAnimationUpdate = currentMillis;
    animationFrame++;
    if (animationFrame > 10) animationFrame = 0;
  }
  
  // Check for display timeout
  if (currentDisplay.duration > 0 && !operationModeActive) {
    if (currentMillis - currentDisplay.startTime > currentDisplay.duration) {
      Serial.println("Display timeout - returning to idle");
      displayIdleScreen();
    }
  }
  
  // Periodic heartbeat (every 30 seconds)
  if (currentMillis - lastHeartbeat > 30000) {
    lastHeartbeat = currentMillis;
    Serial.println("Matrix alive - Mode: " + String(currentDisplay.mode));
  }
  
  // Periodic cascade refresh to prevent display corruption
  if (currentDisplay.mode == MODE_CASCADE && millis() - lastCascadeRefresh > 1000) {
    redrawCascade();
    lastCascadeRefresh = millis();
  }
  
  delay(1);
}