#ifndef UART_MODULE_H
#define UART_MODULE_H

#include <Arduino.h>
#include "Config.h"

// UART Serial for LED Matrix communication
extern HardwareSerial UARTSerial;

// UART operations
void initializeUART();
void sendToLEDMatrix(const String& command, const String& param1, const String& param2);
const String& getLastLedCommand();
const String& getLastLedParam1();
const String& getLastLedParam2();
unsigned long getLastLedSendTime();

#endif // UART_MODULE_H