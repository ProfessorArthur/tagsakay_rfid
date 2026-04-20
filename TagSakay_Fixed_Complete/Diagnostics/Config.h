#ifndef TAGSAKAY_DIAGNOSTICS_CONFIG_H
#define TAGSAKAY_DIAGNOSTICS_CONFIG_H

#include <Arduino.h>

// PN532 HSPI pins (same as production)
#define PN532_SCK 14
#define PN532_MISO 12
#define PN532_MOSI 13
#define PN532_SS 27

// UART link to LED matrix (TX only)
#define UART_TX 17
#define UART_RX -1
#define UART_BAUD 115200

// Active buzzer configuration
#define BUZZER_PIN 16
#define BUZZER_ACTIVE_LEVEL HIGH
#define BUZZER_IDLE_LEVEL LOW

// TFT layout for 480x320 ILI9488 panel
#define SCREEN_WIDTH 480
#define SCREEN_HEIGHT 320

#define HEADER_HEIGHT 48
#define STATUS_SECTION_Y 56
#define STATUS_SECTION_HEIGHT 104
#define SCAN_SECTION_Y 170
#define SCAN_SECTION_HEIGHT 120
#define FOOTER_Y 290
#define FOOTER_HEIGHT 30

#define LEFT_MARGIN 12
#define CENTER_X (SCREEN_WIDTH / 2)

// Keypad configuration (4x4 matrix)
#define KEYPAD_ROWS 4
#define KEYPAD_COLS 4

// Supplemental color definitions (align with production firmware palette)
#define TFT_ORANGE 0xFD20
#define TFT_DARKGREEN 0x03E0
#define TFT_NAVY 0x000F
#define TFT_DARKGREY 0x7BEF
#define TFT_LIGHTGREY 0xC618
#define TFT_PURPLE 0x780F

// HTTP Polling Configuration
#define COMMAND_POLL_INTERVAL 5000   // Poll every 5 seconds
#define HEARTBEAT_INTERVAL 30000     // Heartbeat every 30 seconds

// API Configuration (Update these values before flashing)
#define API_HOST "api.tagsakay.com"         // Change to "api.tagsakay.com" for production
#define API_PORT 443                // Change to 443 for production HTTPS
#define USE_HTTPS true              // Set to true for production

// Device Configuration (Set after device registration)
// Get these values from the Device Registration page in admin panel
const char* deviceId = "80F3DA4C46A4";           // MAC address without colons (e.g., "001122334455")
const char* apiKey = "apikey";             // Device API key from registration

// Registration Mode
#define REGISTRATION_MODE_TIMEOUT 120000  // 2 minutes

#endif // TAGSAKAY_DIAGNOSTICS_CONFIG_H
