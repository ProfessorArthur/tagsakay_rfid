#ifndef KEYPAD_MODULE_H
#define KEYPAD_MODULE_H

#include <Arduino.h>
#include <Keypad.h>
#include "Config.h"

class KeypadModule {
private:
  Keypad* keypad;
  byte* rowPins;
  byte* colPins;
  char keys[KEYPAD_ROWS][KEYPAD_COLS];
  String keypadBuffer;
  bool keypadActive;
  bool keypadMenuActive;
  unsigned long keypadLastInput;
  char lastKey;
  unsigned long lastKeyTime;
  
  void setupPins();
  
public:
  KeypadModule();
  
  bool initialize();
  char getKey();
  void reinitialize();
  
  // Diagnostic methods
  char scanManual();
  bool testColumn(int col, char* detectedKey);
  void getPinStates(int* rowStates, int* colStates);
  bool testSwappedPins(const byte* altRowPins, const byte* altColPins);
  
  // Expose pin arrays for diagnostics
  const byte* getRowPins() const { return rowPins; }
  const byte* getColPins() const { return colPins; }
  int getRowCount() const { return KEYPAD_ROWS; }
  int getColCount() const { return KEYPAD_COLS; }
  
  // State management
  String getBuffer() const { return keypadBuffer; }
  void clearBuffer() { keypadBuffer = ""; keypadActive = false; }
  bool isActive() const { return keypadActive; }
  unsigned long getLastInputTime() const { return keypadLastInput; }
};

// Legacy compatibility
extern byte rowPins[KEYPAD_ROWS];
extern byte colPins[KEYPAD_COLS];
extern char keys[KEYPAD_ROWS][KEYPAD_COLS];
extern Keypad keypad;

// Keypad state
extern String keypadBuffer;
extern bool keypadActive;
extern bool keypadMenuActive;
extern bool keypadMenuVisible;
extern unsigned long keypadLastInput;

// Keypad operations
void initializeKeypad();
void handleKeypadInput();
void processKeypadKey(char key);
void handleKeypadMenuSelection(char key);
void processQueueOverride(const String& queueNumber);
void clearKeypadInput();
bool checkKeypadTimeout(unsigned long currentMillis);

#endif // KEYPAD_MODULE_H