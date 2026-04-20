#ifndef HTTPPOLLING_H
#define HTTPPOLLING_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Config.h"

class NetworkModule;
class ApiModule;

class HTTPPollingModule {
public:
  HTTPPollingModule();

  bool begin(NetworkModule* networkModule, ApiModule* apiModule, unsigned long intervalMs = COMMAND_POLL_INTERVAL);
  void loop();
  bool pollImmediate();
  bool isReady() const { return ready; }
  unsigned long getInterval() const { return interval; }
  void setInterval(unsigned long intervalMs);
  unsigned long getLastPollTime() const { return lastPoll; }
  int getConsecutiveFailures() const { return consecutiveFailures; }
  void clearPendingRegistrationTag() { lastPendingRegistrationTag = ""; }

private:
  NetworkModule* network;
  ApiModule* api;
  bool ready;
  unsigned long interval;
  unsigned long lastPoll;
  int consecutiveFailures;
  bool lastServerRegistrationMode;
  String lastPendingRegistrationTag;

  bool shouldPoll(unsigned long now) const;
  bool poll();
  bool handleResponse(const String& payload);
  void applyDeviceStatus(const JsonObject& status, bool& refreshUI);
  void processCommand(const JsonObject& command, bool& refreshUI);
};

#endif // HTTPPOLLING_H
