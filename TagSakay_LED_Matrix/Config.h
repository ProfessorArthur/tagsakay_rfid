#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// =======================
// LED Matrix Configuration
// =======================

// For two 64x32 panels chained vertically (uncomment for single 64x64)
#define PANEL_RES_X 64
#define PANEL_RES_Y 32
#define NUM_ROWS     2
#define NUM_COLS     1
#define PANEL_CHAIN  2
#define VIRTUAL_MATRIX_CHAIN_TYPE CHAIN_TOP_LEFT_DOWN

// Uncomment for single 64x64 P3 panel
// #define PANEL_RES_X 64
// #define PANEL_RES_Y 64
// #define PANEL_CHAIN  1

// =======================
// Pin Configuration
// =======================

#define R1_PIN 25
#define G1_PIN 26
#define B1_PIN 27
#define R2_PIN 14
#define G2_PIN 12
#define B2_PIN 13
#define A_PIN  23
#define B_PIN  19
#define C_PIN   5
#define D_PIN  17
#define E_PIN  18  // Required for 64-row panels (1/32 scan)
#define LAT_PIN 4
#define OE_PIN  15
#define CLK_PIN 16

// UART Communication Pins
#define UART_RX 32
#define UART_TX -1 // Disabled to free up Pin 33 for SD Card
#define UART_BAUD 115200

// SD Card Pins
#define SD_CS_PIN   22
#define SD_MOSI_PIN 21
#define SD_MISO_PIN 35 // Changed from 2 to 35 (Input-only pin) to prevent boot conflict
#define SD_SCK_PIN  33

// =======================
// Display Settings
// =======================

#define DEFAULT_BRIGHTNESS 50   // 0-255
#define MESSAGE_DURATION 5000   // How long to show messages (ms)
#define QUEUE_DISPLAY_DURATION 10000  // How long to show queue info (ms)
#define SCROLL_SPEED 50         // Milliseconds between scroll steps

// =======================
// Cascade Display Layout Settings
// =======================

#define ROW_HEIGHT      8   // pixels between rows
#define START_Y         0   // top margin (Changed from 1 to 0 to fit 8 rows)
#define DIGIT_WIDTH     4   // width of each digit (3px + 1px gap)
#define PIPE_WIDTH      2   // width for pipe separator (1px + 1px gap)
#define MARGIN          1   // left margin
#define NUMBERS_PER_ROW 5   // numbers per row
#define MAX_ROWS        8   // total rows for cascade
#define MAX_CASCADE_ENTRIES 40
#define MAX_DIGITS_PER_ENTRY 3

// Small visual adjustment to shift LED numbers right on physical panels
// Set this to 0 to disable; increase for more shift
#define LED_MATRIX_SCOOT_X 1

// =======================
// Color Definitions
// =======================

#define COLOR_BLACK   0x0000
#define COLOR_WHITE   0xFFFF
#define COLOR_RED     0xF800
#define COLOR_GREEN   0x07E0
#define COLOR_BLUE    0x001F
#define COLOR_YELLOW  0xFFE0
#define COLOR_CYAN    0x07FF
#define COLOR_MAGENTA 0xF81F
#define COLOR_ORANGE  0xFD20
#define COLOR_AMBER   0xFD20
#define COLOR_PURPLE  0x780F
#define COLOR_PINK    0xFE19
// Additional shades
#define COLOR_DARK_BLUE 0x0008

// Status colors
#define COLOR_SUCCESS COLOR_GREEN
#define COLOR_ERROR   COLOR_RED
#define COLOR_WARNING COLOR_ORANGE
#define COLOR_INFO    COLOR_CYAN
#define COLOR_READY   COLOR_BLUE

// =======================
// Animation Settings
// =======================

#define ANIMATION_SPEED 100

// =======================
// Display Mode Enumeration
// =======================

enum DisplayMode {
  MODE_IDLE,
  MODE_QUEUE,
  MODE_CASCADE,
  MODE_STATUS,
  MODE_MESSAGE,
  MODE_SCAN,
  MODE_ERROR,
  MODE_TEST
};

// =======================
// Display State Structure
// =======================

struct DisplayState {
  DisplayMode mode;
  String primaryText;
  String secondaryText;
  uint16_t color;
  unsigned long startTime;
  unsigned long duration;
  bool scrolling;
  int scrollPosition;
  int queueNumber;
  int* queueList;
  int queueListSize;
  String* queueUnitList;
};

// =======================
// Global State Variables
// =======================

extern DisplayState currentDisplay;
extern String deviceId;
extern String location;
extern bool systemInitialized;
extern uint8_t brightness;
extern unsigned long lastUpdate;
extern unsigned long lastHeartbeat;
extern int animationFrame;
extern unsigned long lastAnimationUpdate;

#endif // CONFIG_H