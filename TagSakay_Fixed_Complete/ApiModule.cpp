#include "ApiModule.h"

namespace {
  constexpr unsigned long RETRY_WAIT_SLICE_MS = 25;
  constexpr unsigned long RETRY_DELAY_MAX_MS = 8000;

  bool isRetryableResponse(const ApiResponse& response) {
    if (response.result == API_SUCCESS) {
      return false;
    }

    if (
      response.result == API_NETWORK_ERROR ||
      response.result == API_TIMEOUT
    ) {
      return true;
    }

    if (response.result == API_HTTP_ERROR) {
      return response.httpCode == 429 || response.httpCode >= 500;
    }

    return false;
  }

  bool waitForRetryWindow(unsigned long totalDelayMs) {
    const unsigned long start = millis();

    while ((millis() - start) < totalDelayMs) {
      if (WiFi.status() != WL_CONNECTED) {
        return false;
      }

      unsigned long elapsed = millis() - start;
      unsigned long remaining =
        totalDelayMs > elapsed ? totalDelayMs - elapsed : 0;
      if (remaining == 0) {
        break;
      }

      unsigned long waitMs =
        remaining < RETRY_WAIT_SLICE_MS ? remaining : RETRY_WAIT_SLICE_MS;
      delay(waitMs);
      yield();
    }

    return WiFi.status() == WL_CONNECTED;
  }
}

ApiModule::ApiModule() 
  : initialized(false), lastRequestTime(0), consecutiveFailures(0),
    totalRequests(0), successfulRequests(0), failedRequests(0), totalResponseTime(0) {
  
  // Default retry configuration
  retryConfig.maxRetries = API_RETRY_ATTEMPTS;
  retryConfig.retryDelay = 1000;  // 1 second
  retryConfig.exponentialBackoff = true;
}

bool ApiModule::initialize(const String& url, const String& key, const String& devId) {
  if (key.length() == 0 || devId.length() == 0 || url.length() == 0) {
    LOG_ERROR("API initialization failed: Invalid configuration");
    return false;
  }
  
  baseUrl = url;
  apiKey = key;
  deviceId = devId;
  initialized = true;
  
  LOG_INFO("API Module initialized");
  LOG_INFO("Base URL: " + baseUrl);
  LOG_INFO("Device ID: " + deviceId);
  
  // Reset statistics
  resetStatistics();
  
  return true;
}

void ApiModule::setRetryConfig(int maxRetries, unsigned long retryDelay, bool exponentialBackoff) {
  retryConfig.maxRetries = maxRetries;
  retryConfig.retryDelay = retryDelay;
  retryConfig.exponentialBackoff = exponentialBackoff;
  
  LOG_INFO("Retry config updated: max=" + String(maxRetries) + 
           ", delay=" + String(retryDelay) + "ms");
}

String ApiModule::buildUrl(const String& endpoint) {
  String url = baseUrl;
  if (!url.endsWith("/")) url += "/";
  if (endpoint.startsWith("/")) {
    url += endpoint.substring(1);
  } else {
    url += endpoint;
  }
  return url;
}

bool ApiModule::validateResponse(const String& response) {
  if (response.length() == 0) {
    return false;
  }
  
  // Try to parse as JSON
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, response);
  
  if (error) {
    LOG_WARNING("Response validation failed: Invalid JSON");
    return false;
  }
  
  // Check for success field
  if (!doc.containsKey("success")) {
    LOG_WARNING("Response validation failed: Missing 'success' field");
    return false;
  }
  
  return true;
}

ApiResponse ApiModule::sendRequest(const String& method, const String& endpoint, 
                                   const String& payload, bool useRetry) {
  if (useRetry) {
    return sendRequestWithRetry(method, endpoint, payload);
  }
  
  ApiResponse response;
  response.result = API_NETWORK_ERROR;
  response.httpCode = 0;
  response.data = "";
  response.error = "";
  
  if (!initialized) {
    LOG_ERROR("API not initialized");
    response.error = "API not initialized";
    return response;
  }
  
  // Check memory before making request
  if (!CHECK_MEMORY()) {
    LOG_WARNING("Low memory - request may fail");
  }
  
  String url = buildUrl(endpoint);
  unsigned long startTime = millis();
  
  LOG_DEBUG("API Request: " + method + " " + endpoint);
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", apiKey);
  http.addHeader("User-Agent", String(DEVICE_NAME) + "/" + String(DEVICE_VERSION));
  http.setTimeout(API_TIMEOUT_MS);
  
  int httpCode;
  if (method == "POST") {
    if (payload.length() > 0) {
      LOG_DEBUG("Payload size: " + String(payload.length()) + " bytes");
    }
    httpCode = http.POST(payload);
  } else if (method == "PUT") {
    httpCode = http.PUT(payload);
  } else if (method == "GET") {
    httpCode = http.GET();
  } else if (method == "DELETE") {
    httpCode = http.sendRequest("DELETE");
  } else {
    LOG_ERROR("Unsupported HTTP method: " + method);
    response.error = "Unsupported method";
    http.end();
    return response;
  }
  
  lastRequestTime = millis();
  unsigned long requestDuration = lastRequestTime - startTime;
  totalRequests++;
  totalResponseTime += requestDuration;
  
  if (httpCode > 0) {
    response.data = http.getString();
    response.httpCode = httpCode;
    http.end();
    
    LOG_DEBUG("Response: " + String(httpCode) + " (" + String(requestDuration) + "ms)");
    
    if (httpCode >= 200 && httpCode < 300) {
      // Validate response structure
      if (validateResponse(response.data)) {
        response.result = API_SUCCESS;
        consecutiveFailures = 0;
        successfulRequests++;
      } else {
        response.result = API_JSON_ERROR;
        response.error = "Invalid response format";
        consecutiveFailures++;
        failedRequests++;
      }
    } else {
      response.result = API_HTTP_ERROR;
      response.error = "HTTP " + String(httpCode);
      consecutiveFailures++;
      failedRequests++;
      LOG_WARNING("HTTP Error: " + String(httpCode));
    }
  } else {
    response.error = http.errorToString(httpCode).c_str();
    response.httpCode = httpCode;
    consecutiveFailures++;
    failedRequests++;
    http.end();
    LOG_ERROR("Connection error: " + response.error);
  }
  
  return response;
}

ApiResponse ApiModule::sendRequestWithRetry(const String& method, const String& endpoint, 
                                           const String& payload) {
  ApiResponse response;
  int attempt = 0;
  unsigned long retryDelay = retryConfig.retryDelay;
  
  while (attempt <= retryConfig.maxRetries) {
    if (attempt > 0) {
      LOG_INFO("Retry attempt " + String(attempt) + "/" + String(retryConfig.maxRetries));

      if (!waitForRetryWindow(retryDelay)) {
        response.result = API_NETWORK_ERROR;
        response.httpCode = 0;
        response.data = "";
        response.error = "WiFi disconnected during retry wait";
        return response;
      }
      
      // Exponential backoff
      if (retryConfig.exponentialBackoff) {
        unsigned long nextDelay = retryDelay * 2;
        retryDelay =
          nextDelay > RETRY_DELAY_MAX_MS ? RETRY_DELAY_MAX_MS : nextDelay;
      }
    }
    
    response = sendRequest(method, endpoint, payload, false);
    
    if (response.result == API_SUCCESS) {
      if (attempt > 0) {
        LOG_INFO("Request succeeded after " + String(attempt) + " retries");
      }
      return response;
    }

    if (!isRetryableResponse(response)) {
      return response;
    }
    
    attempt++;
  }
  
  LOG_ERROR("Request failed after " + String(retryConfig.maxRetries) + " retries");
  return response;
}

ApiResponse ApiModule::sendScan(
  const String& tagId,
  const String& location,
  const String& eventType
) {
  if (!IS_VALID_TAG_ID(tagId)) {
    ApiResponse response;
    response.result = API_JSON_ERROR;
    response.error = "Invalid tag ID";
    response.httpCode = 0;
    response.data = "";
    return response;
  }
  
  StaticJsonDocument<512> doc;
  doc["tagId"] = tagId;
  doc["deviceId"] = deviceId;
  doc["timestamp"] = millis();
  
  if (location.length() > 0) {
    doc["location"] = location;
  } else {
    doc["location"] = deviceConfig.location;
  }

  if (eventType.length() > 0) {
    String normalizedEventType = eventType;
    normalizedEventType.toLowerCase();
    doc["eventType"] = normalizedEventType;
  }
  
  // Add device context
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  
  String payload;
  serializeJson(doc, payload);
  
  LOG_INFO("Sending RFID scan: " + tagId);
  
  return sendRequest("POST", "/api/rfid/scan", payload);
}

ApiResponse ApiModule::sendHeartbeat(bool includeStats) {
  String endpoint = "/api/devices/" + deviceId + "/heartbeat";
  
  StaticJsonDocument<512> doc;
  doc["status"] = "online";
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["location"] = deviceConfig.location;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  // Sync key device flags so server UI reflects current state without waiting for poll
  doc["registrationMode"] = registrationMode;
  doc["scanMode"] = deviceConfig.scanMode;
  if (expectedRegistrationTagId.length() > 0) {
    doc["pendingRegistrationTagId"] = expectedRegistrationTagId;
  }
  
  if (includeStats) {
    JsonObject stats = doc.createNestedObject("stats");
    stats["totalScans"] = systemStatus.scanCount;
    stats["errorCount"] = systemStatus.errorCount;
    stats["apiSuccessRate"] = getSuccessRate();
    stats["avgResponseTime"] = (totalRequests > 0) ? (totalResponseTime / totalRequests) : 0;
  }
  
  String payload;
  serializeJson(doc, payload);
  
  LOG_DEBUG("Sending heartbeat");
  
  return sendRequest("POST", endpoint, payload);
}

ApiResponse ApiModule::checkConnection() {
  LOG_DEBUG("Checking API connection");
  ApiResponse response = sendRequest("GET", "/health", "", false);
  if (response.result == API_HTTP_ERROR && response.httpCode == 404) {
    LOG_WARNING("/health not found, attempting legacy /api/health");
    response = sendRequest("GET", "/api/health", "", false);
  }
  return response;
}

ApiResponse ApiModule::getRegistrationStatus() {
  String endpoint = "/api/devices/" + deviceId + "/registration-status";
  LOG_DEBUG("Checking registration status");
  return sendRequest("GET", endpoint, "");
}

ApiResponse ApiModule::sendQueueOverride(int queueNumber, const String& reason) {
  if (!IS_VALID_QUEUE_NUMBER(queueNumber)) {
    ApiResponse response;
    response.result = API_JSON_ERROR;
    response.error = "Invalid queue number";
    response.httpCode = 0;
    response.data = "";
    return response;
  }
  
  String endpoint = "/api/devices/" + deviceId + "/queue-override";
  
  StaticJsonDocument<256> doc;
  doc["queueNumber"] = queueNumber;
  doc["reason"] = reason;
  doc["timestamp"] = millis();
  
  String payload;
  serializeJson(doc, payload);
  
  LOG_INFO("Sending queue override: " + String(queueNumber));
  
  return sendRequest("POST", endpoint, payload);
}

  ApiResponse ApiModule::sendQueueSnapshot(
    const String& cascade,
    const String slotValues[],
    int slotCount,
    bool operationModeActive
  ) {
    StaticJsonDocument<6144> doc;
    doc["cascade"] = cascade;
    doc["slotCount"] = slotCount;
    doc["operationModeActive"] = operationModeActive;

    JsonArray slots = doc.createNestedArray("slots");
    int totalActive = 0;

    for (int i = 0; i < slotCount; i++) {
      JsonObject slot = slots.createNestedObject();
      slot["slotIndex"] = i;

      String value = slotValues[i];
      value.trim();
      value.toUpperCase();

      bool hasValue = value.length() > 0 && value != "0";
      slot["ledValue"] = hasValue ? value : "0";
      slot["displayValue"] = hasValue ? value : "---";
      slot["state"] = hasValue ? "ongoing" : "empty";
      slot["scanId"] = nullptr;
      slot["scanTime"] = nullptr;
      slot["isLatest"] = hasValue;

      if (hasValue) {
        totalActive++;
      }
    }

    doc["totalActive"] = totalActive;

    String payload;
    serializeJson(doc, payload);

    String endpoint = String("/api/devices/") + deviceId + "/queue/snapshot";
    return sendRequest("POST", endpoint, payload, false);
  }

ApiResponse ApiModule::reportStatus(const String& status, const String& reason) {
  String endpoint = "/api/devices/" + deviceId + "/status";
  
  StaticJsonDocument<512> doc;
  doc["status"] = status;
  doc["reason"] = reason;
  doc["timestamp"] = millis();
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["location"] = deviceConfig.location;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["wifiConnected"] = systemStatus.wifiConnected;
  doc["rfidInitialized"] = systemStatus.rfidInitialized;
  doc["offlineMode"] = systemStatus.offlineMode;
  doc["registrationMode"] = registrationMode;
  doc["scanMode"] = deviceConfig.scanMode;
  if (expectedRegistrationTagId.length() > 0) {
    doc["pendingRegistrationTagId"] = expectedRegistrationTagId;
  }
  
  String payload;
  serializeJson(doc, payload);
  
  LOG_INFO("Reporting status: " + status);
  
  return sendRequest("POST", endpoint, payload);
}

ApiResponse ApiModule::registerDevice(const String& macAddress, const String& name, const String& location) {
  StaticJsonDocument<256> doc;
  doc["macAddress"] = macAddress;
  doc["name"] = name;
  doc["location"] = location;
  
  String payload;
  serializeJson(doc, payload);
  
  LOG_INFO("Registering device: " + macAddress);
  
  return sendRequest("POST", "/api/devices", payload);
}

ApiResponse ApiModule::updateDeviceConfig(const String& config) {
  String endpoint = "/api/devices/" + deviceId + "/config";
  
  LOG_INFO("Updating device configuration");
  
  return sendRequest("PUT", endpoint, config);
}

ApiResponse ApiModule::getDeviceConfig() {
  String endpoint = "/api/devices/" + deviceId + "/config";
  
  LOG_DEBUG("Fetching device configuration");
  
  return sendRequest("GET", endpoint, "");
}

ApiResponse ApiModule::reportError(const String& errorType, const String& errorMessage) {
  String endpoint = "/api/devices/" + deviceId + "/error";
  
  StaticJsonDocument<512> doc;
  doc["errorType"] = errorType;
  doc["errorMessage"] = errorMessage;
  doc["timestamp"] = millis();
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  
  String payload;
  serializeJson(doc, payload);
  
  LOG_WARNING("Reporting error: " + errorType);
  
  return sendRequest("POST", endpoint, payload, false);  // Don't retry error reports
}

ApiResponse ApiModule::syncTime() {
  LOG_DEBUG("Syncing time from server");
  return sendRequest("GET", "/api/time", "");
}

RfidDetailResult ApiModule::getRfidDetails(const String& tagId) {
  RfidDetailResult result;

  if (!initialized) {
    result.error = "API not initialized";
    return result;
  }

  String normalizedTag = tagId;
  normalizedTag.trim();
  normalizedTag.toUpperCase();

  if (!IS_VALID_TAG_ID(normalizedTag)) {
    result.error = "Invalid tag ID";
    return result;
  }

  ApiResponse response = sendRequest("GET", "/api/rfid/" + normalizedTag, "");
  result.httpCode = response.httpCode;

  if (response.result != API_SUCCESS) {
    if (response.httpCode == 404) {
      result.success = true;
      result.detailsAvailable = false;
      result.tagId = normalizedTag;
      result.error = response.error.length() ? response.error : String("RFID not found");
    } else {
      result.error = response.error.length() ? response.error : String("Request failed");
    }
    return result;
  }

  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, response.data);
  if (error) {
    result.error = String("Parse error: ") + error.c_str();
    return result;
  }

  bool success = doc["success"] | false;
  if (!success) {
    result.error = doc["message"] | "Details unavailable";
    return result;
  }

  JsonObject data = doc["data"];
  JsonObject rfid = data["rfid"];
  if (rfid.isNull()) {
    result.error = "Details unavailable";
    return result;
  }

  result.success = true;
  result.detailsAvailable = true;
  result.tagId = rfid["tagId"].is<const char*>() ? String(rfid["tagId"].as<const char*>()) : normalizedTag;
  result.unitNumber = rfid["unitNumber"].is<const char*>() ? String(rfid["unitNumber"].as<const char*>()) : String("");
  result.tagActive = rfid["isActive"].is<bool>() ? rfid["isActive"].as<bool>() : false;

  JsonObject user = rfid["user"];
  if (!user.isNull()) {
    const char* name = user["name"] | "";
    const char* email = user["email"] | "";

    String selectedName = String(name);
    if (selectedName.length() == 0) {
      selectedName = String(email);
    }

    result.userName = selectedName;
    result.userAssigned = selectedName.length() > 0;
    result.userActive = user["isActive"].is<bool>() ? user["isActive"].as<bool>() : true;
  } else {
    result.userName = "";
    result.userAssigned = false;
    result.userActive = false;
  }

  result.error = "";
  return result;
}

ApiResponse ApiModule::sendBatchScans(const String scans[], int count) {
  if (count == 0 || count > MAX_SCAN_QUEUE_SIZE) {
    ApiResponse response;
    response.result = API_JSON_ERROR;
    response.error = "Invalid batch size";
    response.httpCode = 0;
    response.data = "";
    return response;
  }
  
  DynamicJsonDocument doc(2048);  // Larger buffer for batch
  JsonArray scanArray = doc.createNestedArray("scans");
  
  for (int i = 0; i < count; i++) {
    JsonObject scan = scanArray.createNestedObject();
    
    // Parse scan string (format: "tagId|timestamp")
    int separatorPos = scans[i].indexOf('|');
    if (separatorPos > 0) {
      scan["tagId"] = scans[i].substring(0, separatorPos);
      scan["timestamp"] = scans[i].substring(separatorPos + 1).toInt();
    } else {
      scan["tagId"] = scans[i];
      scan["timestamp"] = millis();
    }
    scan["deviceId"] = deviceId;
  }
  
  doc["deviceId"] = deviceId;
  doc["count"] = count;
  
  String payload;
  serializeJson(doc, payload);
  
  LOG_INFO("Sending batch scans: " + String(count) + " items");
  
  return sendRequest("POST", "/api/rfid/batch-scan", payload);
}

void ApiModule::getStatistics(unsigned long& total, unsigned long& success, 
                              unsigned long& failed, unsigned long& avgResponseTime) {
  total = totalRequests;
  success = successfulRequests;
  failed = failedRequests;
  avgResponseTime = (totalRequests > 0) ? (totalResponseTime / totalRequests) : 0;
}

void ApiModule::resetStatistics() {
  totalRequests = 0;
  successfulRequests = 0;
  failedRequests = 0;
  totalResponseTime = 0;
  consecutiveFailures = 0;
  
  LOG_INFO("API statistics reset");
}

float ApiModule::getSuccessRate() const {
  if (totalRequests == 0) {
    return 0.0f;
  }
  return (float)successfulRequests / (float)totalRequests * 100.0f;
}

bool ApiModule::testEndpoint(const String& endpoint) {
  LOG_INFO("Testing endpoint: " + endpoint);
  ApiResponse response = sendRequest("GET", endpoint, "", false);
  return response.result == API_SUCCESS;
}

String ApiModule::getLastError() const {
  // Error information is now returned in ApiResponse.error field
  // This method kept for backwards compatibility
  return "";
}
