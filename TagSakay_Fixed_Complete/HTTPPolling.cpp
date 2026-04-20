#include "HTTPPolling.h"
#include "NetworkModule.h"
#include "ApiModule.h"
#include "DisplayModule.h"

HTTPPollingModule::HTTPPollingModule()
  : network(nullptr), api(nullptr), ready(false), interval(COMMAND_POLL_INTERVAL),
    lastPoll(0), consecutiveFailures(0), lastServerRegistrationMode(false),
    lastPendingRegistrationTag("") {}

bool HTTPPollingModule::begin(NetworkModule* networkModule, ApiModule* apiModule, unsigned long intervalMs) {
  network = networkModule;
  api = apiModule;
  setInterval(intervalMs);
  lastPoll = millis();
  consecutiveFailures = 0;
  ready = (network != nullptr && api != nullptr);

  if (ready) {
    Serial.printf("[POLL] HTTP polling configured (interval %lu ms)\n", interval);
  } else {
    Serial.println("[POLL] HTTP polling disabled - missing dependencies");
  }

  return ready;
}

void HTTPPollingModule::setInterval(unsigned long intervalMs) {
  interval = intervalMs;
  if (interval == 0) {
    interval = COMMAND_POLL_INTERVAL;
  }
}

void HTTPPollingModule::loop() {
  if (!ready) {
    return;
  }

  unsigned long now = millis();
  if (!shouldPoll(now)) {
    return;
  }

  lastPoll = now;
  poll();
}

bool HTTPPollingModule::pollImmediate() {
  if (!ready) {
    return false;
  }

  lastPoll = millis();
  return poll();
}

bool HTTPPollingModule::shouldPoll(unsigned long now) const {
  return MILLIS_OVERFLOW_SAFE(now, lastPoll) >= interval;
}

bool HTTPPollingModule::poll() {
  if (!ready) {
    return false;
  }

  if (offlineMode) {
    return false;
  }

  if (!network->isConnected()) {
    return false;
  }

  if (!api->isInitialized()) {
    return false;
  }

  String endpoint = "/api/devices/" + deviceId + "/commands";
  ApiResponse response = makeApiRequest(endpoint, "", "GET");
  if (response.result != API_SUCCESS) {
    consecutiveFailures++;
    Serial.printf("[POLL] Command poll failed (HTTP %d, streak %d)\n", response.httpCode, consecutiveFailures);
    return false;
  }

  consecutiveFailures = 0;
  return handleResponse(response.data);
}

bool HTTPPollingModule::handleResponse(const String& payload) {
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("[POLL] JSON parse error: ");
    Serial.println(error.c_str());
    return false;
  }

  if (!doc["success"].is<bool>() || !doc["success"].as<bool>()) {
    Serial.println("[POLL] Response missing success=true");
    return false;
  }

  JsonObject data = doc["data"];  // Safe even if missing; returns null object
  if (data.isNull()) {
    Serial.println("[POLL] Payload missing data object");
    return false;
  }

  bool refreshUI = false;

  if (data.containsKey("deviceStatus") && data["deviceStatus"].is<JsonObject>()) {
    JsonObject status = data["deviceStatus"].as<JsonObject>();
    applyDeviceStatus(status, refreshUI);
  }

  if (data.containsKey("commands") && data["commands"].is<JsonArray>()) {
    JsonArray commands = data["commands"].as<JsonArray>();
    for (JsonObject command : commands) {
      processCommand(command, refreshUI);
    }
  }

  if (refreshUI) {
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

void HTTPPollingModule::applyDeviceStatus(const JsonObject& status, bool& refreshUI) {
  if (status.containsKey("registrationMode")) {
    bool reg = status["registrationMode"].as<bool>();
    if (reg != lastServerRegistrationMode) {
      lastServerRegistrationMode = reg;
      if (reg) {
        Serial.println("[POLL] Server requested registration mode (manual activation required)");
        if (!registrationMode) {
          updateFooter("Press ### to start registration");
        }
      } else {
        Serial.println("[POLL] Server cleared registration mode");
        if (!registrationMode) {
          registrationModeStartTime = 0;
          expectedRegistrationTagId = "";
          lastPendingRegistrationTag = "";
          updateFooter("Registration mode cleared");
        }
      }
    }
  }

  if (status.containsKey("scanMode")) {
    bool scan = status["scanMode"].as<bool>();
    if (scan != deviceConfig.scanMode) {
      deviceConfig.scanMode = scan;
      Serial.printf("[POLL] Scan mode %s by server\n", scan ? "ENABLED" : "DISABLED");
      refreshUI = true;
    }
  }
}

void HTTPPollingModule::processCommand(const JsonObject& command, bool& refreshUI) {
  if (!command.containsKey("action")) {
    return;
  }

  String action = command["action"].as<String>();
  if (action == "enable_registration") {
    String tagId = command.containsKey("tagId") ? command["tagId"].as<String>() : "";
    if (tagId != lastPendingRegistrationTag) {
      Serial.printf("[POLL] Pending registration tag received: %s\n", tagId.c_str());
    }
    lastPendingRegistrationTag = tagId;
    if (tagId.length() > 0) {
      expectedRegistrationTagId = tagId;
    }
    if (!registrationMode) {
      String msg;
      if (tagId.length() > 0) {
        size_t previewLen = tagId.length() > 8 ? 8 : tagId.length();
        msg = String("Press ### to register ") + tagId.substring(0, previewLen);
      } else {
        msg = "Press ### to start registration";
      }
      
      // Only update footer if the tag changed to avoid constant redraws
      if (tagId != lastPendingRegistrationTag) {
         updateFooter(msg);
      }
    }
  } else if (action == "disable_registration") {
    if (lastPendingRegistrationTag.length() > 0) {
      Serial.println("[POLL] Server cleared pending registration tag");
    } else if (registrationMode) {
      Serial.println("[POLL] Disable registration command received");
    }
    lastPendingRegistrationTag = "";
    if (!registrationMode) {
      expectedRegistrationTagId = "";
      registrationModeStartTime = 0;
    }
  } else if (action == "scan_mode") {
    bool enabled = command.containsKey("enabled") ? command["enabled"].as<bool>() : deviceConfig.scanMode;
    if (deviceConfig.scanMode != enabled) {
      deviceConfig.scanMode = enabled;
      Serial.printf("[POLL] Scan mode set %s\n", enabled ? "ENABLED" : "DISABLED");
      refreshUI = true;
    }
  }
}
