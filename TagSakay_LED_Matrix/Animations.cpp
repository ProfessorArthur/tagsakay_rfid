#include "Animations.h"
#include "DisplayCore.h"

void animateTransition() {
  for (int i = 0; i < 2; i++) {
    virtualDisp->fillScreen(COLOR_BLACK);
    dma_display->flipDMABuffer();
    delay(50);
  }
}

void animateSuccess() {
  for (int i = 0; i < 2; i++) {
    drawBorder(COLOR_SUCCESS);
    dma_display->flipDMABuffer();
    delay(100);
    drawBorder(COLOR_BLACK);
    dma_display->flipDMABuffer();
    delay(100);
  }
  drawBorder(COLOR_SUCCESS);
}

void animateError() {
  for (int i = 0; i < 3; i++) {
    drawBorder(COLOR_ERROR);
    dma_display->flipDMABuffer();
    delay(150);
    drawBorder(COLOR_BLACK);
    dma_display->flipDMABuffer();
    delay(150);
  }
  drawBorder(COLOR_ERROR);
}