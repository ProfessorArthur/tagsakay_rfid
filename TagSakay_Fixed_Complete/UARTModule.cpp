#include "UARTModule.h"

HardwareSerial UARTSerial(2);  // Use UART2 (GPIO16 RX, GPIO17 TX)

namespace {
  String lastLedCommand;
  String lastLedParam1;
  String lastLedParam2;
  unsigned long lastLedTimestamp = 0;
}

void initializeUART() {
  UARTSerial.begin(UART_BAUD, SERIAL_8N1, UART_RX, UART_TX);
  Serial.println("UART initialized for LED Matrix communication (TX-only)");
  Serial.print("UART TX: GPIO");
  Serial.println(UART_TX);
  if (UART_RX >= 0) {
    Serial.print("UART RX: GPIO");
    Serial.println(UART_RX);
  } else {
    Serial.println("UART RX disabled; link is one-way to LED matrix");
  }
  Serial.print("Baud rate: ");
  Serial.println(UART_BAUD);
}

void sendToLEDMatrix(const String& command, const String& param1, const String& param2) {
  String message = command + "|" + param1 + "|" + param2 + "\n";

  Serial.print("Sending to LED Matrix: ");
  Serial.println(message);

  UARTSerial.print(message);
  UARTSerial.flush();  // Wait for transmission to complete

  lastLedCommand = command;
  lastLedParam1 = param1;
  lastLedParam2 = param2;
  lastLedTimestamp = millis();

  delay(50);  // Small delay to ensure message is sent
}

const String& getLastLedCommand() {
  return lastLedCommand;
}

const String& getLastLedParam1() {
  return lastLedParam1;
}

const String& getLastLedParam2() {
  return lastLedParam2;
}

unsigned long getLastLedSendTime() {
  return lastLedTimestamp;
}