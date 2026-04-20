#include "NetworkModule.h"
#include "DisplayModule.h"
#include "UARTModule.h"
#include "ApiModule.h"
#include "esp_mac.h"
#include <WiFiClientSecure.h>
#include <time.h>

extern WiFiConfig wifiConfig;
extern ServerConfig serverConfig;
extern NTPConfig ntpConfig;
extern DeviceConfig deviceConfig;
extern SystemStatus systemStatus;
extern String deviceId;
extern String lastScannedTag;
extern bool offlineMode;
extern bool registrationMode;
extern String expectedRegistrationTagId;
extern unsigned long registrationModeStartTime;
extern ApiModule apiModule;

namespace {
  constexpr unsigned long WIFI_CONNECTION_STEP_MS = 100;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;

  bool isTerminalWiFiStatus(wl_status_t status) {
    return status == WL_CONNECT_FAILED || status == WL_NO_SSID_AVAIL;
  }

  bool waitForWiFi(unsigned long timeoutMs) {
    const unsigned long start = millis();

    while ((millis() - start) < timeoutMs) {
      wl_status_t status = WiFi.status();
      if (status == WL_CONNECTED) {
        return true;
      }

      if (isTerminalWiFiStatus(status)) {
        return false;
      }

      unsigned long elapsed = millis() - start;
      unsigned long remaining = timeoutMs > elapsed ? timeoutMs - elapsed : 0;
      if (remaining == 0) {
        break;
      }

      unsigned long waitMs =
        remaining < WIFI_CONNECTION_STEP_MS ? remaining : WIFI_CONNECTION_STEP_MS;
      delay(waitMs);
      yield();
    }

    return WiFi.status() == WL_CONNECTED;
  }

  bool beginHttpClient(HTTPClient& http, const String& url) {
    if (url.startsWith("https://")) {
      secureClient.setInsecure();
      return http.begin(secureClient, url);
    }

    return http.begin(plainClient, url);
  }

  String safeString(const char* value) {
    return value ? String(value) : String("");
  }
}

NetworkModule::NetworkModule()
  : initialized(false),
    connected(false),
    lastConnectionAttempt(0),
    connectionTimeout(WIFI_RECONNECT_INTERVAL),
    reconnectAttempts(0),
    macAddress(""),
    ipAddress(""),
    consecutiveFailures(0) {}

bool NetworkModule::initialize(const char* ssid, const char* password) {
  macAddress = getDeviceMacAddress();
  connectionTimeout = WIFI_RECONNECT_INTERVAL;
  reconnectAttempts = 0;
  lastConnectionAttempt = millis();

  if (ssid == nullptr || strlen(ssid) == 0) {
    Serial.println("[NETWORK] Missing SSID configuration");
    initialized = true;
    connected = false;
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(25);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < wifiConfig.maxRetries) {
    if (waitForWiFi(wifiConfig.retryDelay)) {
      break;
    }

    attempts++;
    Serial.print('.');

    if (isTerminalWiFiStatus(WiFi.status())) {
      break;
    }
  }
  Serial.println();

  initialized = true;
  connected = WiFi.status() == WL_CONNECTED;

  if (connected) {
    ipAddress = WiFi.localIP().toString();
    consecutiveFailures = 0;
    Serial.print("[NETWORK] Connected. IP: ");
    Serial.println(ipAddress);
  } else {
    Serial.println("[NETWORK] WiFi initialization failed");
  }

  return connected;
}

bool NetworkModule::reconnect() {
  if (!initialized) {
    return initialize(wifiConfig.ssid, wifiConfig.password);
  }

  reconnectAttempts++;
  lastConnectionAttempt = millis();

  WiFi.disconnect();
  delay(25);
  WiFi.begin(wifiConfig.ssid, wifiConfig.password);

  waitForWiFi(WIFI_RECONNECT_INTERVAL);

  connected = WiFi.status() == WL_CONNECTED;
  if (connected) {
    ipAddress = WiFi.localIP().toString();
    consecutiveFailures = 0;
    reconnectAttempts = 0;
  }

  return connected;
}

void NetworkModule::updateConnectionStatus() {
  bool currentlyConnected = WiFi.status() == WL_CONNECTED;

  if (currentlyConnected != connected) {
    connected = currentlyConnected;
    if (connected) {
      ipAddress = WiFi.localIP().toString();
      consecutiveFailures = 0;
      Serial.println("[NETWORK] Connection restored");
    } else {
      Serial.println("[NETWORK] Connection lost");
    }
  }
}

// Legacy compatibility helpers
bool connectToWiFi() {
  Serial.println("[NETWORK] Connecting using legacy helper...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiConfig.ssid, wifiConfig.password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < wifiConfig.maxRetries) {
    if (waitForWiFi(wifiConfig.retryDelay)) {
      break;
    }

    attempts++;

    String statusMsg = "WiFi: " + String(attempts) + "/" + String(wifiConfig.maxRetries);
    updateStatusSection(statusMsg, TFT_YELLOW);
    Serial.print('.');

    if (isTerminalWiFiStatus(WiFi.status())) {
      break;
    }
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    updateStatusSection("WiFi CONNECTED", TFT_GREEN);
    return true;
  }

  updateStatusSection("WiFi FAILED", TFT_RED);
  return false;
}

String getDeviceMacAddress() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);

  char buffer[13];
  snprintf(buffer,
           sizeof(buffer),
           "%02X%02X%02X%02X%02X%02X",
           mac[0],
           mac[1],
           mac[2],
           mac[3],
           mac[4],
           mac[5]);

  return String(buffer);
}

bool initializeTime() {
  if (ntpConfig.ntpServer == nullptr) {
    Serial.println("[TIME] No NTP server configured");
    return false;
  }

  configTime(ntpConfig.gmtOffset_sec, ntpConfig.daylightOffset_sec, ntpConfig.ntpServer);

  tm timeinfo;
  const int maxAttempts = 10;
  int attempt = 0;

  while (!getLocalTime(&timeinfo) && attempt < maxAttempts) {
    delay(500);
    attempt++;
  }

  if (attempt >= maxAttempts) {
    Serial.println("[TIME] Failed to synchronize time");
    return false;
  }

  Serial.println("[TIME] Time synchronized successfully");
  return true;
}

String getCurrentTimestamp() {
  time_t now = time(nullptr);
  if (now == 0) {
    return String("1970-01-01T00:00:00Z");
  }

  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);

  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}

ApiResponse makeApiRequest(const String& endpoint, const String& payload, const String& method) {
  ApiResponse response;
  response.result = API_NETWORK_ERROR;
  response.httpCode = 0;
  response.data = "";
  response.error = "";

  if (WiFi.status() != WL_CONNECTED) {
    response.error = "WiFi disconnected";
    return response;
  }

  HTTPClient http;
  String url = safeString(serverConfig.baseUrl) + endpoint;

  if (!beginHttpClient(http, url)) {
    response.error = "HTTP init failed";
    return response;
  }

  http.setConnectTimeout(serverConfig.timeout);
  http.setTimeout(serverConfig.timeout);
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.addHeader("Content-Type", "application/json");

  String apiKey = safeString(serverConfig.apiKey);
  if (apiKey.length() == 0) {
    apiKey = String(API_DEFAULT_KEY);
  }
  if (apiKey.length() > 0) {
    http.addHeader("x-api-key", apiKey);
  }

  int httpCode = 0;
  if (method.equalsIgnoreCase("POST")) {
    httpCode = http.POST(payload);
  } else if (method.equalsIgnoreCase("PUT")) {
    httpCode = http.PUT(payload);
  } else if (method.equalsIgnoreCase("DELETE")) {
    httpCode = http.sendRequest("DELETE", payload);
  } else {
    httpCode = http.GET();
  }

  response.httpCode = httpCode;

  if (httpCode > 0) {
    response.data = http.getString();
    if (httpCode >= 200 && httpCode < 300) {
      response.result = API_SUCCESS;
    } else {
      response.result = API_HTTP_ERROR;
      response.error = "HTTP " + String(httpCode);
    }
  } else {
    response.result = API_NETWORK_ERROR;
    response.error = http.errorToString(httpCode);
  }

  http.end();
  return response;
}

void handleScanResponse(const String& responseData) {
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, responseData);

  if (error) {
    Serial.print("[SCAN] JSON parse error: ");
    Serial.println(error.c_str());
    updateStatusSection("SCAN ERROR", TFT_RED);
    updateScanSection(lastScannedTag, "PARSE ERROR", error.c_str(), TFT_RED);
    updateFooter("Scan response invalid");
    indicateError();
    sendToLEDMatrix("ERROR", "PARSE", "");
    return;
  }

  bool success = doc["success"].as<bool>();
  String message = doc["message"].as<String>();
  JsonObject data = doc["data"].is<JsonObject>() ? doc["data"].as<JsonObject>() : JsonObject();
  JsonObject scan = data["scan"].is<JsonObject>() ? data["scan"].as<JsonObject>() : doc["scan"].as<JsonObject>();
  JsonObject user = data["user"].is<JsonObject>() ? data["user"].as<JsonObject>() : doc["user"].as<JsonObject>();

  String tagId = lastScannedTag;
  if (!scan.isNull() && scan["tagId"].is<const char*>()) {
    tagId = scan["tagId"].as<String>();
  }

  if (!success) {
    if (message.length() == 0 && doc["error"].is<const char*>()) {
      message = doc["error"].as<String>();
    }

    updateStatusSection("SCAN FAILED", TFT_RED);
    updateScanSection(tagId, "ERROR", message, TFT_RED);
    updateFooter(message.length() ? message : String("Scan rejected"));
    indicateError();
    sendToLEDMatrix("ERROR", tagId.substring(0, 8), "");
    return;
  }

  String userName;
  if (!user.isNull()) {
    if (user["name"].is<const char*>()) {
      userName = user["name"].as<String>();
    } else {
      String first = user["firstName"].as<String>();
      String last = user["lastName"].as<String>();
      userName = first;
      if (first.length() && last.length()) {
        userName += " ";
      }
      userName += last;
    }
  }

  bool isRegistered = false;
  String status = scan["status"].as<String>();
  status.toLowerCase();

  if (scan["isRegistered"].is<bool>()) {
    isRegistered = scan["isRegistered"].as<bool>();
  } else if (status == "registered" || status == "valid" || status == "success") {
    isRegistered = true;
  }

  if (isRegistered) {
    updateStatusSection("REGISTERED", TFT_GREEN);

    String secondary = "";
    if (scan["queueNumber"].is<int>()) {
      secondary = "Queue #" + String(scan["queueNumber"].as<int>());
    } else if (scan["queuePosition"].is<int>()) {
      secondary = "Position " + String(scan["queuePosition"].as<int>());
    } else if (scan["message"].is<const char*>()) {
      secondary = scan["message"].as<String>();
    }

    updateScanSection(tagId, userName.length() ? userName : "Registered", secondary, TFT_GREEN);
    updateFooter(userName.length() ? "Access granted" : "Registered tag");
    sendToLEDMatrix("WELCOME", (userName.length() ? userName : tagId).substring(0, 8), "");
    indicateSuccess();
  } else {
    updateStatusSection("UNREGISTERED", TFT_ORANGE);
    updateScanSection(tagId, "NOT REGISTERED", "Please register", TFT_ORANGE);
    updateFooter("Unregistered card detected");
    sendToLEDMatrix("UNREG", tagId.substring(0, 8), "");
    indicateUnregisteredTag();
  }
}

void handleRfidScan(String tagId) {
  if (tagId.length() == 0) {
    return;
  }

  lastScannedTag = tagId;

  StaticJsonDocument<256> doc;
  doc["tagId"] = tagId;
  doc["deviceId"] = deviceId;
  doc["location"] = deviceConfig.location;
  doc["timestamp"] = getCurrentTimestamp();

  String payload;
  serializeJson(doc, payload);

  ApiResponse response = makeApiRequest("/api/rfid/scan", payload, "POST");

  if (response.result == API_SUCCESS) {
    handleScanResponse(response.data);
  } else {
    String errorMsg = response.error.length() ? response.error : String("HTTP ") + response.httpCode;
    updateStatusSection("SCAN FAILED", TFT_RED);
    updateScanSection(tagId, "ERROR", errorMsg, TFT_RED);
    updateFooter(errorMsg);
    indicateError();
    sendToLEDMatrix("ERROR", tagId.substring(0, 8), "");
  }
}

void sendRfidScan(String tagId) {
  handleRfidScan(tagId);
}

bool sendHeartbeat() {
  Serial.println("Sending heartbeat...");

  String endpoint = "/api/devices/" + deviceId + "/heartbeat";

  StaticJsonDocument<256> doc;
  doc["status"] = "online";
  doc["timestamp"] = getCurrentTimestamp();
  doc["uptime"] = millis() / 1000;
  doc["location"] = serverConfig.deviceLocation;

  String payload;
  serializeJson(doc, payload);

  showHeartbeat(true);

  ApiResponse response = makeApiRequest(endpoint, payload, "POST");
  bool success = (response.result == API_SUCCESS);

  if (success) {
    Serial.println("Heartbeat sent successfully");
    updateStatusSection("HEARTBEAT SENT", TFT_GREEN);
    updateFooter("Heartbeat acknowledged by server");
  } else {
    Serial.println("Heartbeat failed");
    updateStatusSection("HEARTBEAT FAIL", TFT_RED);
    String errorMsg = response.error.length() > 0 ? response.error : "Network error";
    updateFooter("Heartbeat failed: " + errorMsg);
  }

  delay(100);
  showHeartbeat(false);
  return success;
}

void reportDeviceStatus(String reason) {
  Serial.print("Reporting device status. Reason: ");
  Serial.println(reason);

  if (offlineMode) {
    Serial.println("Skipping device status report - offline mode");
    return;
  }

  if (!apiModule.isInitialized()) {
    Serial.println("Skipping device status report - API module not initialized");
    return;
  }

  ApiResponse response = apiModule.reportStatus("active", reason);

  if (response.result == API_SUCCESS) {
    Serial.println("Device status reported successfully");
    return;
  }

  Serial.print("Failed to report device status");
  if (response.httpCode != 0) {
    Serial.print(" (HTTP ");
    Serial.print(response.httpCode);
    Serial.print(')');
  }
  if (response.error.length() > 0) {
    Serial.print(": ");
    Serial.print(response.error);
  }
  Serial.println();
}

void checkRegistrationModeFromServer() {
  String endpoint = "/api/devices/" + deviceId + "/registration-status";

  ApiResponse response = makeApiRequest(endpoint, "", "GET");

  if (response.result == API_SUCCESS) {
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, response.data);

    if (!error) {
      bool serverRegistrationMode = doc["data"]["registrationMode"] | false;
      String expectedTag = doc["data"]["expectedTagId"] | "";

      if (serverRegistrationMode != registrationMode) {
        registrationMode = serverRegistrationMode;
        expectedRegistrationTagId = expectedTag;

        Serial.print("Registration mode updated from server: ");
        Serial.println(registrationMode ? "ENABLED" : "DISABLED");

        if (registrationMode) {
          Serial.print("Expected tag ID: ");
          Serial.println(expectedRegistrationTagId);
          registrationModeStartTime = millis();
          indicateRegistrationMode();
          updateScanSection("", "Waiting for tag", expectedRegistrationTagId, TFT_MAGENTA);
          sendToLEDMatrix("REG", "WAITING", expectedTag.substring(0, 8));
        } else {
          Serial.println("Registration mode disabled by server");
          indicateReady();
          updateScanSection("", "", "", TFT_WHITE);
        }
      }
    }
  }
}

bool updateDeviceMode(bool registrationModeEnabled, bool scanModeEnabled, const String& pendingTagId) {
  String endpoint = "/api/devices/" + deviceId + "/status";

  StaticJsonDocument<256> doc;
  doc["registrationMode"] = registrationModeEnabled;
  doc["scanMode"] = scanModeEnabled;
  if (pendingTagId.length() > 0) {
    doc["pendingRegistrationTagId"] = pendingTagId;
  } else {
    doc["pendingRegistrationTagId"] = nullptr;  // Explicitly clear expectation when empty
  }

  String payload;
  serializeJson(doc, payload);

  ApiResponse response = makeApiRequest(endpoint, payload, "POST");
  if (response.result != API_SUCCESS) {
    Serial.println("Failed to update device mode via API");
    return false;
  }

  StaticJsonDocument<512> resDoc;
  DeserializationError error = deserializeJson(resDoc, response.data);
  if (!error) {
    JsonObject device = resDoc["data"]["device"];
    if (!device.isNull()) {
      registrationMode = device["registrationMode"] | registrationModeEnabled;
      deviceConfig.scanMode = device["scanMode"] | scanModeEnabled;
      expectedRegistrationTagId = device["pendingRegistrationTagId"] | expectedRegistrationTagId;
    }
  }

  if (registrationModeEnabled) {
    registrationModeStartTime = millis();
  } else {
    registrationModeStartTime = 0;
  }

  return true;
}

bool syncDeviceProfile() {
  String endpoint = "/api/devices/" + deviceId + "/config";

  ApiResponse response = makeApiRequest(endpoint, "", "GET");
  if (response.result != API_SUCCESS) {
    Serial.println("Failed to sync device profile from API");
    return false;
  }

  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, response.data);
  if (error) {
    Serial.print("JSON parsing error during profile sync: ");
    Serial.println(error.c_str());
    return false;
  }

  JsonObject device = doc["data"]["device"];
  if (device.isNull()) {
    Serial.println("Device payload missing during profile sync");
    return false;
  }

  deviceConfig.name = String(device["name"] | deviceConfig.name.c_str());
  deviceConfig.location = String(device["location"] | deviceConfig.location.c_str());
  deviceConfig.registrationMode = device["registrationMode"] | deviceConfig.registrationMode;
  deviceConfig.scanMode = device["scanMode"] | deviceConfig.scanMode;

  registrationMode = deviceConfig.registrationMode;
  expectedRegistrationTagId = String(device["pendingRegistrationTagId"] | expectedRegistrationTagId.c_str());

  updateStatusSection("PROFILE SYNCED", TFT_GREEN);
  updateFooter("Device profile refreshed from server");

  return true;
}

bool pollServerCommands() {
  String endpoint = "/api/devices/" + deviceId + "/commands";

  ApiResponse response = makeApiRequest(endpoint, "", "GET");
  if (response.result != API_SUCCESS) {
    Serial.printf("[POLL] Command poll failed (HTTP %d)\n", response.httpCode);
    return false;
  }

  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, response.data);
  if (error) {
    Serial.print("[POLL] JSON parse error: ");
    Serial.println(error.c_str());
    return false;
  }

  if (!doc["success"]) {
    Serial.println("[POLL] Response missing success=true");
    return false;
  }

  bool refreshNeeded = false;
  JsonObject data = doc["data"];

  // Sync device status flags from server if present
  if (!data["deviceStatus"].isNull()) {
    JsonObject status = data["deviceStatus"];

    if (!status["registrationMode"].isNull()) {
      bool reg = status["registrationMode"].as<bool>();
      if (reg != registrationMode) {
        registrationMode = reg;
        if (registrationMode) {
          registrationModeStartTime = millis();
        } else {
          registrationModeStartTime = 0;
          expectedRegistrationTagId = "";
        }
        Serial.printf("[POLL] Registration mode %s by server\n", reg ? "ENABLED" : "DISABLED");
        refreshNeeded = true;
      }
    }

    if (!status["scanMode"].isNull()) {
      bool scan = status["scanMode"].as<bool>();
      if (scan != deviceConfig.scanMode) {
        deviceConfig.scanMode = scan;
        Serial.printf("[POLL] Scan mode %s by server\n", scan ? "ENABLED" : "DISABLED");
        refreshNeeded = true;
      }
    }
  }

  // Process commands array
  if (!data["commands"].isNull() && data["commands"].is<JsonArray>()) {
    JsonArray commands = data["commands"].as<JsonArray>();
    for (JsonObject cmd : commands) {
      String action = cmd["action"].as<String>();
      if (action == "enable_registration") {
        String tagId = cmd["tagId"].as<String>();
        registrationMode = true;
        expectedRegistrationTagId = tagId;
        registrationModeStartTime = millis();
        Serial.printf("[POLL] Enable registration for tag: %s\n", tagId.c_str());
        refreshNeeded = true;
      } else if (action == "disable_registration") {
        registrationMode = false;
        expectedRegistrationTagId = "";
        Serial.println("[POLL] Disable registration");
        refreshNeeded = true;
      } else if (action == "scan_mode") {
        bool enabled = cmd["enabled"].isNull() ? deviceConfig.scanMode : cmd["enabled"].as<bool>();
        deviceConfig.scanMode = enabled;
        Serial.printf("[POLL] Scan mode set %s\n", enabled ? "ENABLED" : "DISABLED");
        refreshNeeded = true;
      }
    }
  }

  if (refreshNeeded) {
    // Minimal UI nudge to reflect mode changes
    if (registrationMode) {
      indicateRegistrationMode();
      updateFooter("Registration mode enabled");
    } else {
      indicateReady();
      updateFooter("Normal scanning mode");
    }
  }

  return true;
}