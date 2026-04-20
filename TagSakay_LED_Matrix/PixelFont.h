#ifndef PIXEL_FONT_H
#define PIXEL_FONT_H

#include <Arduino.h>
#include "Config.h"

// Pixel font data (3×5 digits)
extern const byte DIGIT_PATTERNS[10][5];

// Pixel drawing functions
void drawPixelDigit(int x, int y, int digit, uint16_t color);
void drawPixelNumber(int x, int y, int number, uint16_t color);
void drawLargePixelNumber(int x, int y, int number, uint16_t color);
void drawPixelPipe(int x, int y, uint16_t color);
void drawPixelNumberString(int x, int y, const String& value, int maxDigits, uint16_t color);

#endif // PIXEL_FONT_H