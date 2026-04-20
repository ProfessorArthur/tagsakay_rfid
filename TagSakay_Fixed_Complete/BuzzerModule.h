#ifndef BUZZER_MODULE_H
#define BUZZER_MODULE_H

#include <Arduino.h>
#include <stddef.h>

#ifndef BUZZER_PIN
#define BUZZER_PIN -1
#endif

#ifndef BUZZER_ACTIVE_LEVEL
#define BUZZER_ACTIVE_LEVEL HIGH
#endif

#ifndef BUZZER_IDLE_LEVEL
#define BUZZER_IDLE_LEVEL LOW
#endif

inline bool& buzzerEnabledFlag() {
  static bool enabled = false;
  return enabled;
}

inline bool initializeBuzzer() {
  if (BUZZER_PIN < 0) {
    buzzerEnabledFlag() = false;
    return false;
  }

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, BUZZER_IDLE_LEVEL);
  buzzerEnabledFlag() = true;
  return true;
}

inline bool isBuzzerEnabled() {
  return buzzerEnabledFlag();
}

inline void buzzerStop() {
  if (!isBuzzerEnabled()) {
    return;
  }
  digitalWrite(BUZZER_PIN, BUZZER_IDLE_LEVEL);
}

inline void buzzerPlayPattern(const uint16_t* segments, size_t count) {
  if (!isBuzzerEnabled() || segments == nullptr || count == 0) {
    return;
  }

  for (size_t i = 0; i < count; ++i) {
    const bool active = (i % 2 == 0);
    digitalWrite(BUZZER_PIN, active ? BUZZER_ACTIVE_LEVEL : BUZZER_IDLE_LEVEL);
    const uint16_t duration = segments[i];
    if (duration > 0) {
      delay(duration);
    }
  }

  buzzerStop();
}

inline void buzzerShortBeep() {
  static const uint16_t pattern[] = {70, 40};
  buzzerPlayPattern(pattern, sizeof(pattern) / sizeof(pattern[0]));
}

inline void buzzerSuccessTone() {
  static const uint16_t pattern[] = {80, 50, 80, 120};
  buzzerPlayPattern(pattern, sizeof(pattern) / sizeof(pattern[0]));
}

inline void buzzerErrorTone() {
  static const uint16_t pattern[] = {220, 120, 180, 150};
  buzzerPlayPattern(pattern, sizeof(pattern) / sizeof(pattern[0]));
}

inline void buzzerWarningTone() {
  static const uint16_t pattern[] = {140, 80, 140, 200};
  buzzerPlayPattern(pattern, sizeof(pattern) / sizeof(pattern[0]));
}

inline void buzzerRegistrationTone() {
  static const uint16_t pattern[] = {70, 40, 70, 40, 70, 200};
  buzzerPlayPattern(pattern, sizeof(pattern) / sizeof(pattern[0]));
}

inline void buzzerReadyTone() {
  static const uint16_t pattern[] = {150, 120};
  buzzerPlayPattern(pattern, sizeof(pattern) / sizeof(pattern[0]));
}

inline void buzzerRegistrationConfirmTone() {
  static const uint16_t pattern[] = {90, 50, 120, 110};
  buzzerPlayPattern(pattern, sizeof(pattern) / sizeof(pattern[0]));
}

#endif // BUZZER_MODULE_H
