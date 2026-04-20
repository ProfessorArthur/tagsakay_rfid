#ifndef NETWORK_MODULE_H
#define NETWORK_MODULE_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "Config.h"

// API Response Structures
enum ApiResult {
  API_SUCCESS,
  API_HTTP_ERROR,
  API_NETWORK_ERROR,
  API_JSON_ERROR,
  API_TIMEOUT
};

struct ApiResponse {
  ApiResult result;
  int httpCode;
  String data;
  String error;
};

class NetworkModule {
private:
  bool initialized;
  bool connected;
  unsigned long lastConnectionAttempt;
  unsigned long connectionTimeout;
  int reconnectAttempts;
  String macAddress;
  String ipAddress;
  int consecutiveFailures;
  
public:
  NetworkModule();
  
  bool initialize(const char* ssid, const char* password);
  bool reconnect();
  bool isConnected() const { return connected; }
  bool isInitialized() const { return initialized; }
  
  // State management
  int getReconnectAttempts() const { return reconnectAttempts; }
  unsigned long getLastAttemptTime() const { return lastConnectionAttempt; }
  String getMacAddress() const { return macAddress; }
  String getIpAddress() const { return ipAddress; }
  void resetReconnectAttempts() { reconnectAttempts = 0; }
  
  // API communication
  int getConsecutiveFailures() const { return consecutiveFailures; }
  void resetFailureCount() { consecutiveFailures = 0; }
  void incrementFailureCount() { consecutiveFailures++; }
  
  // Status check
  void updateConnectionStatus();
};

// WiFi and Network
bool connectToWiFi();
String getDeviceMacAddress();

// Time synchronization
bool initializeTime();
String getCurrentTimestamp();

// API Communication
ApiResponse makeApiRequest(const String& endpoint, const String& payload = "", const String& method = "GET");
void handleRfidScan(String tagId);
void handleScanResponse(const String& responseData);
bool sendHeartbeat();
void sendRfidScan(String tagId);
void reportDeviceStatus(String reason);
void checkRegistrationModeFromServer();
bool updateDeviceMode(bool registrationModeEnabled, bool scanModeEnabled, const String& pendingTagId = "");
bool syncDeviceProfile();

#endif // NETWORK_MODULE_H