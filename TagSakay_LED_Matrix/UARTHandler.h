#ifndef UART_HANDLER_H
#define UART_HANDLER_H

#include <Arduino.h>
#include "Config.h"

extern HardwareSerial RFIDSerial;
extern String messageBuffer;
extern bool operationModeActive;

void initializeUART();
void processUARTCommand();
void parseCommand(const String& command);
void handleCommand(const String& cmd, const String& data1, const String& data2);

#endif // UART_HANDLER_H