#include "DisplayCore.h"
#include "DisplayModes.h"

MatrixPanel_I2S_DMA *dma_display = nullptr;
VirtualMatrixPanel *virtualDisp = nullptr;

void initializeMatrix() {
  Serial.println("Initializing LED Matrix with double buffering...");
  
  HUB75_I2S_CFG::i2s_pins _pins = {
    R1_PIN, G1_PIN, B1_PIN,
    R2_PIN, G2_PIN, B2_PIN,
    A_PIN,  B_PIN,  C_PIN,
    D_PIN,  E_PIN,
    LAT_PIN, OE_PIN, CLK_PIN
  };
  
  HUB75_I2S_CFG mxconfig(
    PANEL_RES_X,
    PANEL_RES_Y,
    PANEL_CHAIN,
    _pins
  );
  
  mxconfig.double_buff = true;
  mxconfig.clkphase = false;  // Try inverted clock phase
  mxconfig.driver = HUB75_I2S_CFG::FM6126A;  // Reverted to working driver
  
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  
  if (!dma_display->begin()) {
    Serial.println("****** I2S memory allocation failed ***********");
    while (1) { delay(1000); }
  }
  
  dma_display->setBrightness8(DEFAULT_BRIGHTNESS);
  dma_display->fillScreen(COLOR_BLACK);
  dma_display->flipDMABuffer();
  
  virtualDisp = new VirtualMatrixPanel(
    *dma_display,
    NUM_ROWS,
    NUM_COLS,
    PANEL_RES_X,
    PANEL_RES_Y,
    VIRTUAL_MATRIX_CHAIN_TYPE
  );
  virtualDisp->fillScreen(COLOR_BLACK);
  dma_display->flipDMABuffer();  // Flip buffer after virtualDisp initialization

  Serial.println("LED Matrix initialized successfully");
}

void clearDisplay() {
  virtualDisp->fillScreen(COLOR_BLACK);
  dma_display->flipDMABuffer();
}

void setBrightness(uint8_t level) {
  brightness = level;
  dma_display->setBrightness8(brightness);
  Serial.print("Brightness: ");
  Serial.println(brightness);
}

void drawBorder(uint16_t color) {
  virtualDisp->drawRect(0, 0, PANEL_RES_X, PANEL_RES_Y * NUM_ROWS, color);
}

void drawProgressBar(int progress, int y, uint16_t color) {
  int barWidth = (PANEL_RES_X - 10) * progress / 100;
  virtualDisp->drawRect(5, y, PANEL_RES_X - 10, 4, COLOR_WHITE);
  virtualDisp->fillRect(6, y + 1, barWidth, 2, color);
}

void drawCenteredText(String text, int y, uint16_t color, uint8_t textSize) {
  virtualDisp->setTextSize(textSize);
  virtualDisp->setTextColor(color);
  
  int textWidth = text.length() * 6 * textSize;
  int x = (PANEL_RES_X - textWidth) / 2;
  if (x < 0) x = 0;
  
  virtualDisp->setCursor(x, y);
  virtualDisp->print(text);
}

void drawScrollingText(String text, int y, uint16_t color) {
  virtualDisp->setTextSize(1);
  virtualDisp->setTextColor(color);
  virtualDisp->setCursor(currentDisplay.scrollPosition, y);
  virtualDisp->print(text);
}

void updateDisplay() {
  switch (currentDisplay.mode) {
    case MODE_QUEUE:
      if (currentDisplay.scrolling) {
        virtualDisp->fillScreen(COLOR_BLACK);
        drawBorder(COLOR_GREEN);
        drawCenteredText("NOW SERVING", 5, COLOR_YELLOW, 1);
        // Large number drawing handled in DisplayModes
        drawScrollingText(currentDisplay.primaryText, 50, COLOR_WHITE);
        dma_display->flipDMABuffer();
      }
      break;
      
    case MODE_MESSAGE:
      if (currentDisplay.scrolling) {
        virtualDisp->fillScreen(COLOR_BLACK);
        drawBorder(currentDisplay.color);
        drawScrollingText(currentDisplay.primaryText, 28, currentDisplay.color);
        dma_display->flipDMABuffer();
      }
      break;
      
    case MODE_SCAN:
      if (currentDisplay.scrolling) {
        virtualDisp->fillScreen(COLOR_BLACK);
        drawBorder(COLOR_SUCCESS);
        drawCenteredText(currentDisplay.secondaryText, 8, COLOR_GREEN, 1);
        virtualDisp->fillRect(28, 20, 8, 3, COLOR_GREEN);
        virtualDisp->fillRect(32, 23, 3, 8, COLOR_GREEN);
        drawScrollingText(currentDisplay.primaryText, 40, COLOR_WHITE);
        dma_display->flipDMABuffer();
      }
      break;

    case MODE_CASCADE:
      redrawCascade();
      break;
      
    default:
      break;
  }
}

uint16_t getQueueColor(int queueNum) {
  return (queueNum % 2 == 0) ? COLOR_WHITE : COLOR_AMBER;
}