#include "PixelFont.h"
#include "DisplayCore.h"

const byte DIGIT_PATTERNS[10][5] = {
  {0b111, 0b101, 0b101, 0b101, 0b111},  // 0
  {0b010, 0b110, 0b010, 0b010, 0b111},  // 1
  {0b111, 0b001, 0b111, 0b100, 0b111},  // 2
  {0b111, 0b001, 0b111, 0b001, 0b111},  // 3
  {0b101, 0b101, 0b111, 0b001, 0b001},  // 4
  {0b111, 0b100, 0b111, 0b001, 0b111},  // 5
  {0b111, 0b100, 0b111, 0b101, 0b111},  // 6
  {0b111, 0b001, 0b010, 0b010, 0b010},  // 7
  {0b111, 0b101, 0b111, 0b101, 0b111},  // 8
  {0b111, 0b101, 0b111, 0b001, 0b111}   // 9
};

void drawPixelDigit(int x, int y, int digit, uint16_t color) {
  if (digit < 0 || digit > 9) return;
  
  for (int row = 0; row < 5; row++) {
    byte pattern = DIGIT_PATTERNS[digit][row];
    for (int col = 0; col < 3; col++) {
      if (pattern & (1 << (2 - col))) {
        virtualDisp->drawPixel(x + col, y + row, color);
      } else {
        virtualDisp->drawPixel(x + col, y + row, COLOR_BLACK);
      }
    }
  }
}

void drawPixelNumber(int x, int y, int number, uint16_t color) {
  int baseX = x + LED_MATRIX_SCOOT_X;
  // Clear area for two digits to avoid artifacts
  for (int row = 0; row < 5; row++) {
    for (int col = 0; col < DIGIT_WIDTH * 2; col++) {
      virtualDisp->drawPixel(baseX + col, y + row, COLOR_BLACK);
    }
  }
  if (number < 10) {
    if (number == 0) {
      // Do not draw 00 for empty/zero; area already cleared above
      return;
    }
    if (number > 0) {
      // Draw tens place as '0', then the ones place as the number to get leading zero (01..09)
      drawPixelDigit(baseX, y, 0, color);
      drawPixelDigit(baseX + DIGIT_WIDTH, y, number, color);
    } else {
      // number == 0: keep area clear (no 00 shown)
    }
  } else {
    int tens = number / 10;
    int ones = number % 10;
    drawPixelDigit(baseX, y, tens, color);
    drawPixelDigit(baseX + DIGIT_WIDTH, y, ones, color);
  }
}

void drawLargePixelNumber(int x, int y, int number, uint16_t color) {
  int scale = 3;
  int baseX = x + LED_MATRIX_SCOOT_X;
  // Clear area for scaled two-digit number (6 cols by 5 rows if scale=3, but safe region)
  for (int row = 0; row < 5; row++) {
    for (int col = 0; col < (3 * 2 * scale); col++) {
      virtualDisp->fillRect(baseX + col, y + row * scale, 1, scale, COLOR_BLACK);
    }
  }
  if (number < 10) {
    // Draw tens place as '0' at the left side
    for (int row = 0; row < 5; row++) {
      byte pattern = DIGIT_PATTERNS[0][row];
      for (int col = 0; col < 3; col++) {
        if (pattern & (1 << (2 - col))) {
          virtualDisp->fillRect(baseX + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    // Draw ones place at the normal ones position (right side)
    for (int row = 0; row < 5; row++) {
      byte pattern = DIGIT_PATTERNS[number][row];
      for (int col = 0; col < 3; col++) {
        if (pattern & (1 << (2 - col))) {
          virtualDisp->fillRect(baseX + col * scale + 4 * scale, y + row * scale, scale, scale, color);
        }
      }
    }
  } else {
    int tens = number / 10;
    int ones = number % 10;
    
    for (int row = 0; row < 5; row++) {
      byte pattern = DIGIT_PATTERNS[tens][row];
      for (int col = 0; col < 3; col++) {
        if (pattern & (1 << (2 - col))) {
          virtualDisp->fillRect(baseX + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    
    for (int row = 0; row < 5; row++) {
      byte pattern = DIGIT_PATTERNS[ones][row];
      for (int col = 0; col < 3; col++) {
        if (pattern & (1 << (2 - col))) {
          virtualDisp->fillRect(baseX + col * scale + 4 * scale, y + row * scale, scale, scale, color);
        }
      }
    }
  }
}

void drawPixelPipe(int x, int y, uint16_t color) {
  for (int i = 0; i < 5; i++) {
    virtualDisp->drawPixel(x, y + i, color);
  }
}

void drawPixelNumberString(int x, int y, const String& value, int maxDigits, uint16_t color) {
  int constrainedDigits = maxDigits;
  if (constrainedDigits < 1) {
    constrainedDigits = 1;
  }

  int areaWidth = constrainedDigits * DIGIT_WIDTH;

  for (int row = 0; row < 5; row++) {
    for (int col = 0; col < areaWidth; col++) {
      virtualDisp->drawPixel(x + col, y + row, COLOR_BLACK);
    }
  }

  String digits = value;
  int length = digits.length();
  if (length > constrainedDigits) {
    digits = digits.substring(length - constrainedDigits);
    length = digits.length();
  }

  int startX = x + (constrainedDigits - length) * DIGIT_WIDTH;
  startX += LED_MATRIX_SCOOT_X;

  for (int i = 0; i < length; i++) {
    char ch = digits.charAt(i);
    if (ch >= '0' && ch <= '9') {
      drawPixelDigit(startX + (i * DIGIT_WIDTH), y, ch - '0', color);
    }
  }
}
