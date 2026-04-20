# 💻 TagSakay Development Guide

Complete development patterns, code examples, and implementation guide for the TagSakay RFID system.

---

## 🚀 Development Workflow

### Daily Development Commands

```bash
# Backend Development
cd backend-workers
npm run dev              # Start development server
npm run db:studio        # Open database UI
npm run test:api         # Test all endpoints

# Frontend Development
cd frontend
npm run dev              # Start Vite dev server
npm run type-check       # TypeScript validation
npm run test            # Run unit tests

# Database Operations
npm run db:generate      # Generate new migration
npm run db:migrate       # Apply migrations
npm run seed            # Add test data
npm run db:reset        # Reset & reseed database
```

> ⚙️ **Migration Checklist:** Whenever you add a new `.sql` file under `drizzle/`, make sure the same tag exists in `drizzle/meta/_journal.json` before running `npm run migrate`. Drizzle only applies migrations that appear in this journal. Recommended sequence:
>
> 1. Create the new `000X_your_migration.sql` file.
> 2. Append the migration entry in `_journal.json` (or simply run `npm run db:sync-migrations` to generate it).
> 3. Run `npm run db:sync-migrations` so the `_drizzle_migrations` table is aware of the new tag.
> 4. Execute `npm run migrate` against the target database.

### Git Workflow

```bash
# Feature Development
git checkout -b feature/new-functionality
git add .
git commit -m "feat: add new RFID scanning feature"
git push origin feature/new-functionality

# Code Review & Merge
# Create PR → Review → Merge to main
git checkout main
git pull origin main
```

---

## 🏗️ Code Patterns & Examples

### Backend API Patterns

#### 1. Route Implementation (Hono Framework)

```typescript
// routes/rfid.ts - Complete RFID route example
import { Hono } from "hono";
import { authMiddleware, requireRole } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { validateRfidInput } from "../lib/validation";

const rfid = new Hono();

// Apply middleware
rfid.use("/*", authMiddleware);
rfid.use("/register", rateLimit("rfid_register", 10, 60000)); // 10/min

// GET /api/rfid - List all registered RFID tags
rfid.get("/", requireRole("admin"), async (c) => {
  const db = c.get("db");

  try {
    const tags = await db
      .select({
        id: rfidTags.id,
        tagId: rfidTags.tagId,
        status: rfidTags.status,
        scanCount: rfidTags.scanCount,
        lastSeen: rfidTags.lastSeen,
        user: {
          id: users.id,
          email: users.email,
        },
      })
      .from(rfidTags)
      .leftJoin(users, eq(rfidTags.userId, users.id))
      .where(eq(rfidTags.status, "active"))
      .orderBy(desc(rfidTags.lastSeen));

    return c.json({
      success: true,
      message: `Found ${tags.length} active RFID tags`,
      data: { tags },
    });
  } catch (error) {
    console.error("Error fetching RFID tags:", error);
    return c.json(
      {
        success: false,
        message: "Failed to fetch RFID tags",
      },
      500
    );
  }
});

// POST /api/rfid/register - Register new RFID tag
rfid.post("/register", requireRole("admin"), async (c) => {
  const db = c.get("db");
  const body = await c.req.json();

  // Validate input
  const validation = validateRfidInput(body);
  if (!validation.success) {
    return c.json(
      {
        success: false,
        message: "Validation failed",
        errors: validation.errors,
      },
      400
    );
  }

  const { tagId, userId } = body;

  try {
    // Check if tag already exists
    const [existingTag] = await db
      .select()
      .from(rfidTags)
      .where(eq(rfidTags.tagId, tagId))
      .limit(1);

    if (existingTag) {
      return c.json(
        {
          success: false,
          message: "RFID tag already registered",
        },
        409
      );
    }

    // Register new tag
    const [newTag] = await db
      .insert(rfidTags)
      .values({
        tagId,
        userId,
        status: "active",
        firstSeen: new Date(),
        lastSeen: new Date(),
        scanCount: 0,
      })
      .returning();

    return c.json(
      {
        success: true,
        message: "RFID tag registered successfully",
        data: { tag: newTag },
      },
      201
    );
  } catch (error) {
    console.error("Error registering RFID tag:", error);
    return c.json(
      {
        success: false,
        message: "Failed to register RFID tag",
      },
      500
    );
  }
});

export default rfid;
```

#### 2. WebSocket Implementation (Durable Objects)

```typescript
// durable-objects/DeviceConnection.ts
export class DeviceConnection {
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<string, WebSocket> = new Map();
  private deviceInfo: DeviceInfo | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSession(webSocket: WebSocket) {
    webSocket.accept();

    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, webSocket);

    // Authentication required within 30 seconds
    const authTimeout = setTimeout(() => {
      if (!this.deviceInfo) {
        webSocket.close(1008, "Authentication timeout");
      }
    }, 30000);

    webSocket.addEventListener("message", async (event) => {
      try {
        const message = JSON.parse(event.data);
        await this.handleMessage(sessionId, message, authTimeout);
      } catch (error) {
        console.error("WebSocket message error:", error);
        webSocket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid message format",
          })
        );
      }
    });

    webSocket.addEventListener("close", () => {
      clearTimeout(authTimeout);
      this.sessions.delete(sessionId);
      this.deviceInfo = null;
    });
  }

  async handleMessage(
    sessionId: string,
    message: any,
    authTimeout: NodeJS.Timeout
  ) {
    const webSocket = this.sessions.get(sessionId);
    if (!webSocket) return;

    switch (message.type) {
      case "authenticate":
        const device = await this.authenticateDevice(message.apiKey);
        if (device) {
          clearTimeout(authTimeout);
          this.deviceInfo = device;

          // Update device heartbeat
          await this.updateHeartbeat(device.deviceId);

          webSocket.send(
            JSON.stringify({
              type: "authenticated",
              deviceId: device.deviceId,
              message: "Device authenticated successfully",
            })
          );
        } else {
          webSocket.close(1008, "Invalid credentials");
        }
        break;

      case "scan":
        if (!this.deviceInfo) {
          webSocket.close(1008, "Not authenticated");
          return;
        }

        await this.processScan(message.data);
        webSocket.send(
          JSON.stringify({
            type: "scan_processed",
            message: "Scan recorded successfully",
          })
        );
        break;

      case "heartbeat":
        if (!this.deviceInfo) {
          webSocket.close(1008, "Not authenticated");
          return;
        }

        await this.updateHeartbeat(this.deviceInfo.deviceId);
        webSocket.send(
          JSON.stringify({
            type: "heartbeat_ack",
            timestamp: new Date().toISOString(),
          })
        );
        break;
    }
  }

  async authenticateDevice(apiKey: string): Promise<DeviceInfo | null> {
    // Authenticate device via API key
    const hashedKey = await this.hashApiKey(apiKey);

    // Query database to validate device
    // Implementation depends on your database setup

    return null; // Return device info if valid
  }

  async processScan(scanData: any): Promise<void> {
    // Process RFID scan and store in database
    // Broadcast to all connected clients

    const scanRecord = {
      tagId: scanData.tagId,
      deviceId: this.deviceInfo!.deviceId,
      scannedAt: new Date().toISOString(),
      isRegistered: await this.isTagRegistered(scanData.tagId),
    };

    // Store in database
    await this.storeScan(scanRecord);

    // Broadcast to frontend clients
    await this.broadcastScan(scanRecord);
  }
}
```

### Frontend Patterns (Vue 3 + TypeScript)

#### 1. Composable Pattern

```typescript
// composables/useRfidService.ts
import { ref, computed } from "vue";
import { api } from "../services/api";

export interface RfidTag {
  id: number;
  tagId: string;
  status: "active" | "inactive" | "lost";
  scanCount: number;
  lastSeen: string;
  user?: {
    id: number;
    email: string;
  };
}

export function useRfidService() {
  const tags = ref<RfidTag[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Computed properties
  const activeTags = computed(() =>
    tags.value.filter((tag) => tag.status === "active")
  );

  const totalScans = computed(() =>
    tags.value.reduce((sum, tag) => sum + tag.scanCount, 0)
  );

  // Load all RFID tags
  const loadTags = async (): Promise<void> => {
    loading.value = true;
    error.value = null;

    try {
      const response = await api.get<{ tags: RfidTag[] }>("/rfid");
      if (response.success) {
        tags.value = response.data.tags;
      } else {
        throw new Error(response.message);
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load tags";
      console.error("Error loading RFID tags:", err);
    } finally {
      loading.value = false;
    }
  };

  // Register new RFID tag
  const registerTag = async (tagData: {
    tagId: string;
    userId?: number;
  }): Promise<boolean> => {
    loading.value = true;
    error.value = null;

    try {
      const response = await api.post<{ tag: RfidTag }>(
        "/rfid/register",
        tagData
      );
      if (response.success) {
        tags.value.push(response.data.tag);
        return true;
      } else {
        throw new Error(response.message);
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to register tag";
      return false;
    } finally {
      loading.value = false;
    }
  };

  // Update tag status
  const updateTagStatus = async (
    tagId: string,
    status: string
  ): Promise<boolean> => {
    try {
      const response = await api.put(`/rfid/${tagId}`, { status });
      if (response.success) {
        const tagIndex = tags.value.findIndex((tag) => tag.tagId === tagId);
        if (tagIndex !== -1) {
          tags.value[tagIndex].status = status as any;
        }
        return true;
      }
      return false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to update tag";
      return false;
    }
  };

  return {
    // State
    tags: readonly(tags),
    loading: readonly(loading),
    error: readonly(error),

    // Computed
    activeTags,
    totalScans,

    // Methods
    loadTags,
    registerTag,
    updateTagStatus,
  };
}
```

#### 2. Vue Component Pattern

```vue
<!-- views/RfidCardManagement.vue -->
<template>
  <div class="p-6">
    <!-- Header -->
    <div class="flex justify-between items-center mb-6">
      <div>
        <h1 class="text-3xl font-bold">RFID Card Management</h1>
        <p class="text-base-content/70">
          Manage RFID tags and user assignments
        </p>
      </div>
      <button class="btn btn-primary" @click="showRegisterModal = true">
        <svg
          class="w-5 h-5 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
          />
        </svg>
        Register New Tag
      </button>
    </div>

    <!-- Filters -->
    <div class="card bg-base-100 shadow-lg mb-6">
      <div class="card-body">
        <div class="flex gap-4 items-center">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Filter by Status</span>
            </label>
            <select
              v-model="selectedStatus"
              class="select select-bordered"
              @change="applyFilters"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="lost">Lost</option>
            </select>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Search Tag ID</span>
            </label>
            <input
              v-model="searchTerm"
              type="text"
              class="input input-bordered"
              placeholder="Enter tag ID..."
              @input="applyFilters"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Assignment</span>
            </label>
            <select
              v-model="assignmentFilter"
              class="select select-bordered"
              @change="applyFilters"
            >
              <option value="">All Tags</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Statistics -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div class="stat bg-base-100 shadow-lg rounded-lg">
        <div class="stat-title">Total Tags</div>
        <div class="stat-value text-primary">{{ tags.length }}</div>
      </div>
      <div class="stat bg-base-100 shadow-lg rounded-lg">
        <div class="stat-title">Active Tags</div>
        <div class="stat-value text-success">{{ activeTags.length }}</div>
      </div>
      <div class="stat bg-base-100 shadow-lg rounded-lg">
        <div class="stat-title">Total Scans</div>
        <div class="stat-value text-info">{{ totalScans }}</div>
      </div>
      <div class="stat bg-base-100 shadow-lg rounded-lg">
        <div class="stat-title">Assigned Tags</div>
        <div class="stat-value text-warning">{{ assignedTags.length }}</div>
      </div>
    </div>

    <!-- Tags Table -->
    <div class="card bg-base-100 shadow-lg">
      <div class="card-body">
        <div v-if="loading" class="flex justify-center py-8">
          <span class="loading loading-spinner loading-lg"></span>
        </div>

        <div v-else-if="error" class="alert alert-error">
          <svg
            class="stroke-current shrink-0 w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{{ error }}</span>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="table table-zebra w-full">
            <thead>
              <tr>
                <th>Tag ID</th>
                <th>Assigned User</th>
                <th>Status</th>
                <th>Scan Count</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tag in filteredTags" :key="tag.id">
                <td>
                  <div class="font-mono font-bold">{{ tag.tagId }}</div>
                </td>
                <td>
                  <div v-if="tag.user" class="flex items-center gap-2">
                    <div class="avatar placeholder">
                      <div
                        class="bg-neutral-focus text-neutral-content rounded-full w-8"
                      >
                        <span class="text-xs">{{
                          tag.user.email[0].toUpperCase()
                        }}</span>
                      </div>
                    </div>
                    <span>{{ tag.user.email }}</span>
                  </div>
                  <span v-else class="text-base-content/50">Unassigned</span>
                </td>
                <td>
                  <div
                    class="badge"
                    :class="{
                      'badge-success': tag.status === 'active',
                      'badge-error': tag.status === 'inactive',
                      'badge-warning': tag.status === 'lost',
                    }"
                  >
                    {{ tag.status.toUpperCase() }}
                  </div>
                </td>
                <td>{{ tag.scanCount }}</td>
                <td>{{ formatDate(tag.lastSeen) }}</td>
                <td>
                  <div class="dropdown dropdown-left">
                    <label tabindex="0" class="btn btn-ghost btn-sm"> ⋮ </label>
                    <ul
                      tabindex="0"
                      class="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52"
                    >
                      <li><a @click="editTag(tag)">Edit Tag</a></li>
                      <li><a @click="assignUser(tag)">Assign User</a></li>
                      <li><a @click="viewHistory(tag)">View History</a></li>
                      <li>
                        <a @click="deactivateTag(tag)" class="text-error"
                          >Deactivate</a
                        >
                      </li>
                    </ul>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Register Modal -->
    <div v-if="showRegisterModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">Register New RFID Tag</h3>

        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text">Tag ID</span>
          </label>
          <input
            v-model="newTag.tagId"
            type="text"
            class="input input-bordered"
            placeholder="Enter RFID tag ID"
          />
        </div>

        <div class="form-control mb-6">
          <label class="label">
            <span class="label-text">Assign to User (Optional)</span>
          </label>
          <select v-model="newTag.userId" class="select select-bordered">
            <option value="">Leave Unassigned</option>
            <option v-for="user in users" :key="user.id" :value="user.id">
              {{ user.email }}
            </option>
          </select>
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" @click="showRegisterModal = false">
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="!newTag.tagId"
            @click="handleRegisterTag"
          >
            Register Tag
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRfidService } from "../composables/useRfidService";
import { useUserService } from "../composables/useUserService";

// Composables
const { tags, loading, error, loadTags, registerTag, activeTags, totalScans } =
  useRfidService();
const { users, loadUsers } = useUserService();

// Local state
const showRegisterModal = ref(false);
const selectedStatus = ref("");
const searchTerm = ref("");
const assignmentFilter = ref("");
const newTag = ref({ tagId: "", userId: null });

// Computed properties
const assignedTags = computed(() => tags.value.filter((tag) => tag.user));

const filteredTags = computed(() => {
  let filtered = tags.value;

  if (selectedStatus.value) {
    filtered = filtered.filter((tag) => tag.status === selectedStatus.value);
  }

  if (searchTerm.value) {
    filtered = filtered.filter((tag) =>
      tag.tagId.toLowerCase().includes(searchTerm.value.toLowerCase())
    );
  }

  if (assignmentFilter.value === "assigned") {
    filtered = filtered.filter((tag) => tag.user);
  } else if (assignmentFilter.value === "unassigned") {
    filtered = filtered.filter((tag) => !tag.user);
  }

  return filtered;
});

// Methods
const applyFilters = () => {
  // Filters are reactive, no additional action needed
};

const handleRegisterTag = async () => {
  const success = await registerTag({
    tagId: newTag.value.tagId,
    userId: newTag.value.userId || undefined,
  });

  if (success) {
    showRegisterModal.value = false;
    newTag.value = { tagId: "", userId: null };
  }
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString();
};

const editTag = (tag: any) => {
  // Implementation for editing tag
};

const assignUser = (tag: any) => {
  // Implementation for assigning user
};

const viewHistory = (tag: any) => {
  // Implementation for viewing scan history
};

const deactivateTag = (tag: any) => {
  // Implementation for deactivating tag
};

// Lifecycle
onMounted(() => {
  loadTags();
  loadUsers();
});
</script>
```

### ESP32 Development Patterns

#### 1. Modular Architecture

```cpp
// Config.h - Configuration management
#ifndef CONFIG_H
#define CONFIG_H

// Production Configuration (Default)
#define WS_HOST "api.tagsakay.com"
#define WS_PORT 443
#define USE_SECURE_WS true
#define API_BASE_URL "https://api.tagsakay.com/api"

// Development Configuration (Comment out for production)
// #define WS_HOST "192.168.1.100"
// #define WS_PORT 8787
// #define USE_SECURE_WS false
// #define API_BASE_URL "http://192.168.1.100:8787/api"

// Hardware Configuration
#define RFID_SS_PIN 21
#define RFID_RST_PIN 22
#define BUZZER_PIN 2
#define LED_PIN 4

// Timing Configuration
#define WIFI_TIMEOUT 20000
#define WS_RECONNECT_INTERVAL 5000
#define HEARTBEAT_INTERVAL 30000
#define SCAN_DEBOUNCE_TIME 2000

// Buffer Sizes
#define MAX_BUFFERED_SCANS 50
#define EEPROM_SIZE 512

#endif
```

#### 2. WebSocket Communication Module

**WebSocketModule.h:**

```cpp
#ifndef WEBSOCKETMODULE_H
#define WEBSOCKETMODULE_H

#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "Config.h"

class WebSocketModule {
private:
  WebSocketsClient* ws;
  String deviceId;
  bool connected;
  unsigned long lastHeartbeat;
  unsigned long lastReconnectAttempt;

  // Callback for received messages
  void (*onScanResponseCallback)(JsonDocument&);
  void (*onConfigUpdateCallback)(JsonDocument&);

public:
  WebSocketModule();
  void begin(String deviceId);
  void loop();
  bool isConnected();
  void sendScan(String tagId, String location = "");
  void sendHeartbeat();
  void sendConfig(bool registrationMode, bool scanMode);
  void setOnScanResponse(void (*callback)(JsonDocument&));
  void setOnConfigUpdate(void (*callback)(JsonDocument&));

private:
  void connect();
  void reconnect();
  void handleMessage(uint8_t* payload, size_t length);
  static void webSocketEvent(WStype_t type, uint8_t* payload, size_t length);
};

#endif
```

**WebSocketModule.cpp:**

```cpp
#include "WebSocketModule.h"

// Static reference for callback
static WebSocketModule* instance = nullptr;

WebSocketModule::WebSocketModule() {
  ws = new WebSocketsClient();
  connected = false;
  lastHeartbeat = 0;
  lastReconnectAttempt = 0;
  onScanResponseCallback = nullptr;
  onConfigUpdateCallback = nullptr;
  instance = this;
}

void WebSocketModule::begin(String deviceId) {
  this->deviceId = deviceId;

  // Build WebSocket path with deviceId
  String path = String("/ws/device?deviceId=") + deviceId;

  // Connect to WebSocket server
  ws->begin(WS_HOST, WS_PORT, path);
  ws->onEvent([](WStype_t type, uint8_t* payload, size_t length) {
    if (instance) {
      instance->webSocketEvent(type, payload, length);
    }
  });

  // Set reconnect interval
  ws->setReconnectInterval(WS_RECONNECT_INTERVAL);
  Serial.println("[WS] Initializing WebSocket...");
}

void WebSocketModule::loop() {
  ws->loop();

  // Send heartbeat every 30 seconds if connected
  if (connected && (millis() - lastHeartbeat > HEARTBEAT_INTERVAL)) {
    sendHeartbeat();
  }

  // Attempt reconnection if disconnected
  if (!connected && (millis() - lastReconnectAttempt > WS_RECONNECT_INTERVAL)) {
    lastReconnectAttempt = millis();
    Serial.println("[WS] Attempting to reconnect...");
  }
}

bool WebSocketModule::isConnected() {
  return connected;
}

void WebSocketModule::sendScan(String tagId, String location) {
  if (!connected) {
    Serial.println("[WS] Not connected - cannot send scan");
    return;
  }

  JsonDocument doc;
  doc["action"] = "scan";
  doc["tagId"] = tagId;
  doc["location"] = location;
  doc["timestamp"] = millis();

  String message;
  serializeJson(doc, message);

  ws->sendTXT(message);
  Serial.println("[WS] Scan sent: " + tagId);
}

void WebSocketModule::sendHeartbeat() {
  if (!connected) return;

  JsonDocument doc;
  doc["action"] = "heartbeat";
  doc["timestamp"] = millis();

  String message;
  serializeJson(doc, message);

  ws->sendTXT(message);
  lastHeartbeat = millis();
}

void WebSocketModule::webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      connected = false;
      break;

    case WStype_CONNECTED:
      Serial.printf("[WS] Connected to: %s\n", payload);
      connected = true;
      lastHeartbeat = millis();
      break;

    case WStype_TEXT:
      Serial.printf("[WS] Message received: %s\n", payload);
      handleMessage(payload, length);
      break;

    case WStype_ERROR:
      Serial.printf("[WS] Error: %s\n", payload);
      break;
  }
}

void WebSocketModule::handleMessage(uint8_t* payload, size_t length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    Serial.println("[WS] JSON parse error");
    return;
  }

  // Check if it's a scan response
  if (doc.containsKey("scan") && onScanResponseCallback) {
    onScanResponseCallback(doc);
  }

  // Check if it's a config update
  if (doc.containsKey("config") && onConfigUpdateCallback) {
    onConfigUpdateCallback(doc);
  }

  // Check for heartbeat acknowledgment
  if (doc["action"] == "heartbeat_ack") {
    Serial.println("[WS] Heartbeat acknowledged");
  }
}

void WebSocketModule::setOnScanResponse(void (*callback)(JsonDocument&)) {
  onScanResponseCallback = callback;
}

void WebSocketModule::setOnConfigUpdate(void (*callback)(JsonDocument&)) {
  onConfigUpdateCallback = callback;
}
```

#### 3. Main Application Integration

```cpp
// TagSakay_Fixed_Complete.ino
#include "WebSocketModule.h"

// Add WebSocket module
WebSocketModule wsModule;

void setup() {
  Serial.begin(115200);

  // Existing initialization...
  displayModule.begin();
  networkModule.begin(wifiConfig);
  rfidModule.begin();

  // Initialize WebSocket
  String deviceId = WiFi.macAddress();
  wsModule.begin(deviceId);

  // Set callbacks
  wsModule.setOnScanResponse(handleScanResponse);
  wsModule.setOnConfigUpdate(handleConfigUpdate);

  Serial.println("WebSocket initialized");
}

void loop() {
  // Run WebSocket loop (maintains connection)
  wsModule.loop();

  // Existing RFID scanning logic
  if (rfidModule.tagPresent()) {
    String tagId = rfidModule.readTag();

    // Send scan via WebSocket instead of HTTP
    if (wsModule.isConnected()) {
      wsModule.sendScan(tagId, "Main Gate");
      displayModule.showMessage("Processing...");
    } else {
      // Fallback to HTTP if WebSocket not connected
      displayModule.showMessage("Offline Mode");
      apiModule.sendScanHTTP(tagId);  // Keep HTTP fallback
    }
  }

  // Existing keypad, display, etc.
  keypadModule.loop();
  displayModule.loop();
}

// Callback when scan response received
void handleScanResponse(JsonDocument& doc) {
  if (doc["success"]) {
    bool isRegistered = doc["scan"]["isRegistered"];

    if (isRegistered && doc.containsKey("user")) {
      String userName = doc["user"]["name"];
      String userRole = doc["user"]["role"];

      // Show success with user info
      displayModule.showSuccess(userName);
      Serial.println("✅ Registered: " + userName + " (" + userRole + ")");
    } else {
      // Unregistered tag
      displayModule.showError("Not Registered");
      Serial.println("❌ Unregistered tag");
    }
  } else {
    // Error occurred
    String error = doc["error"] | "Unknown error";
    displayModule.showError(error);
    Serial.println("❌ Error: " + error);
  }
}

// Callback when config update received
void handleConfigUpdate(JsonDocument& doc) {
  if (doc.containsKey("config")) {
    bool regMode = doc["config"]["registrationMode"];
    deviceConfig.registrationMode = regMode;

    Serial.println("⚙️ Config updated: Registration Mode = " + String(regMode));
    displayModule.showMessage(regMode ? "REG MODE ON" : "REG MODE OFF");
  }
}
```

#### 4. RFID Scanning Module

```cpp
// Config.h - Configuration management
#ifndef CONFIG_H
#define CONFIG_H

// Production Configuration (Default)
#define WS_HOST "api.tagsakay.com"
#define WS_PORT 443
#define USE_SECURE_WS true
#define API_BASE_URL "https://api.tagsakay.com/api"

// Development Configuration (Comment out for production)
// #define WS_HOST "192.168.1.100"
// #define WS_PORT 8787
// #define USE_SECURE_WS false
// #define API_BASE_URL "http://192.168.1.100:8787/api"

// Hardware Configuration
#define RFID_SS_PIN 21
#define RFID_RST_PIN 22
#define BUZZER_PIN 2
#define LED_PIN 4

// Timing Configuration
#define WIFI_TIMEOUT 20000
#define WS_RECONNECT_INTERVAL 5000
#define HEARTBEAT_INTERVAL 30000
#define SCAN_DEBOUNCE_TIME 2000

// Buffer Sizes
#define MAX_BUFFERED_SCANS 50
#define EEPROM_SIZE 512

#endif
```

```cpp
// RFIDModule.cpp - RFID scanning implementation
#include "RFIDModule.h"
#include "Config.h"

RFIDModule::RFIDModule() : mfrc522(RFID_SS_PIN, RFID_RST_PIN) {}

bool RFIDModule::init() {
  SPI.begin();
  mfrc522.PCD_Init();

  // Self-test
  byte version = mfrc522.PCD_ReadRegister(mfrc522.VersionReg);
  if (version == 0x00 || version == 0xFF) {
    Serial.println("⚠️ RFID module not detected");
    return false;
  }

  Serial.printf("✅ RFID module initialized (v0x%02X)\n", version);
  return true;
}

String RFIDModule::scanTag() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return "";
  }

  String tagId = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    tagId += String(mfrc522.uid.uidByte[i] < 0x10 ? "0" : "");
    tagId += String(mfrc522.uid.uidByte[i], HEX);
  }
  tagId.toUpperCase();

  // Anti-collision and halt
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();

  return tagId;
}

bool RFIDModule::isTagPresent() {
  return mfrc522.PICC_IsNewCardPresent();
}
```

```cpp
// WebSocketModule.cpp - WebSocket communication
#include "WebSocketModule.h"
#include "Config.h"

WebSocketModule::WebSocketModule() :
  client(),
  isConnected(false),
  lastHeartbeat(0),
  reconnectAttempts(0) {}

bool WebSocketModule::connect(const char* apiKey) {
  this->apiKey = String(apiKey);

  String url = String("ws") + (USE_SECURE_WS ? "s" : "") + "://" +
               WS_HOST + ":" + WS_PORT + "/ws/device";

  Serial.printf("🔌 Connecting to: %s\n", url.c_str());

  bool connected = client.connect(url);
  if (connected) {
    client.onMessage([this](WebsocketsMessage message) {
      handleMessage(message.data());
    });

    client.onEvent([this](WebsocketsEvent event, String data) {
      handleEvent(event, data);
    });

    // Send authentication
    authenticate();
    isConnected = true;
    reconnectAttempts = 0;

    Serial.println("✅ WebSocket connected");
  } else {
    Serial.println("❌ WebSocket connection failed");
    reconnectAttempts++;
  }

  return connected;
}

void WebSocketModule::authenticate() {
  StaticJsonDocument<200> authMsg;
  authMsg["type"] = "authenticate";
  authMsg["apiKey"] = apiKey;
  authMsg["deviceId"] = WiFi.macAddress();
  authMsg["timestamp"] = millis();

  String message;
  serializeJson(authMsg, message);
  client.send(message);

  Serial.println("🔐 Authentication sent");
}

void WebSocketModule::sendScan(const String& tagId) {
  if (!isConnected) {
    Serial.println("⚠️ Cannot send scan - not connected");
    return;
  }

  StaticJsonDocument<300> scanMsg;
  scanMsg["type"] = "scan";
  scanMsg["data"]["tagId"] = tagId;
  scanMsg["data"]["deviceId"] = WiFi.macAddress();
  scanMsg["data"]["timestamp"] = WiFi.getTime();
  scanMsg["data"]["signalStrength"] = WiFi.RSSI();

  String message;
  serializeJson(scanMsg, message);
  client.send(message);

  Serial.printf("📡 Scan sent: %s\n", tagId.c_str());
}

void WebSocketModule::sendHeartbeat() {
  if (!isConnected || millis() - lastHeartbeat < HEARTBEAT_INTERVAL) {
    return;
  }

  StaticJsonDocument<200> heartbeatMsg;
  heartbeatMsg["type"] = "heartbeat";
  heartbeatMsg["deviceId"] = WiFi.macAddress();
  heartbeatMsg["timestamp"] = WiFi.getTime();
  heartbeatMsg["uptime"] = millis();
  heartbeatMsg["freeHeap"] = ESP.getFreeHeap();

  String message;
  serializeJson(heartbeatMsg, message);
  client.send(message);

  lastHeartbeat = millis();
  Serial.println("💗 Heartbeat sent");
}

void WebSocketModule::handleMessage(const String& message) {
  StaticJsonDocument<500> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    Serial.printf("❌ JSON parse error: %s\n", error.c_str());
    return;
  }

  String type = doc["type"];

  if (type == "authenticated") {
    Serial.println("✅ Device authenticated");
  } else if (type == "scan_processed") {
    Serial.println("✅ Scan processed by server");
  } else if (type == "heartbeat_ack") {
    Serial.println("💗 Heartbeat acknowledged");
  } else if (type == "error") {
    Serial.printf("❌ Server error: %s\n", doc["message"].as<String>().c_str());
  }
}

void WebSocketModule::handleEvent(WebsocketsEvent event, String data) {
  switch (event) {
    case WebsocketsEvent::ConnectionOpened:
      Serial.println("🔓 WebSocket connection opened");
      break;
    case WebsocketsEvent::ConnectionClosed:
      Serial.println("🔒 WebSocket connection closed");
      isConnected = false;
      break;
    case WebsocketsEvent::GotPing:
      Serial.println("🏓 Ping received");
      client.pong();
      break;
    case WebsocketsEvent::GotPong:
      Serial.println("🏓 Pong received");
      break;
  }
}

void WebSocketModule::loop() {
  if (isConnected) {
    client.poll();
    sendHeartbeat();
  } else if (reconnectAttempts < 5) {
    Serial.println("🔄 Attempting to reconnect...");
    delay(WS_RECONNECT_INTERVAL);
    connect(apiKey.c_str());
  }
}
```

---

## 🔧 Development Tools & Scripts

### Database Management Scripts

```bash
#!/bin/bash
# scripts/db-reset.sh - Reset database completely
echo "🗄️ Resetting TagSakay database..."

cd backend-workers

# Drop all tables
npm run db:drop

# Regenerate schema
npm run db:generate

# Apply migrations
npm run db:migrate

# Seed with test data
npm run seed

echo "✅ Database reset complete"
```

```javascript
// scripts/test-api.js - API testing script
const BASE_URL = "http://localhost:8787/api";

async function testAPI() {
  console.log("🧪 Testing TagSakay API...\n");

  // Test health endpoint
  console.log("1. Health Check");
  const health = await fetch(`${BASE_URL}/../health`);
  console.log("Status:", health.status);
  console.log("Response:", await health.json());
  console.log("");

  // Test authentication
  console.log("2. Authentication");
  const auth = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@tagsakay.local",
      password: "Admin123!@#",
    }),
  });

  const authData = await auth.json();
  console.log("Auth Status:", auth.status);
  console.log("Has Token:", !!authData.data?.token);

  const token = authData.data?.token;
  if (!token) {
    console.log("❌ Authentication failed");
    return;
  }
  console.log("✅ Authentication successful\n");

  // Test protected endpoint
  console.log("3. Protected Endpoint");
  const users = await fetch(`${BASE_URL}/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const usersData = await users.json();
  console.log("Users Status:", users.status);
  console.log("User Count:", usersData.data?.users?.length || 0);
  console.log("");

  console.log("✅ API tests complete");
}

testAPI().catch(console.error);
```

### Device Management Scripts

```bash
#!/bin/bash
# scripts/register-device.sh - Register new ESP32 device
if [ $# -ne 3 ]; then
  echo "Usage: $0 <MAC_ADDRESS> <NAME> <LOCATION>"
  echo "Example: $0 AA:BB:CC:DD:EE:FF 'Gate Scanner' 'Main Entrance'"
  exit 1
fi

MAC=$1
NAME=$2
LOCATION=$3

echo "📱 Registering ESP32 device..."
echo "MAC: $MAC"
echo "Name: $NAME"
echo "Location: $LOCATION"
echo ""

cd backend-workers
npm run device:register "$MAC" "$NAME" "$LOCATION"
```

### Development Utilities

```typescript
// utils/dev-helpers.ts - Development utilities
export class DevHelpers {
  static async generateTestData() {
    const devices = [
      {
        mac: "AA:BB:CC:DD:EE:01",
        name: "Gate 1 Scanner",
        location: "Main Entrance",
      },
      {
        mac: "AA:BB:CC:DD:EE:02",
        name: "Gate 2 Scanner",
        location: "Exit Gate",
      },
      {
        mac: "AA:BB:CC:DD:EE:03",
        name: "Queue Scanner",
        location: "Waiting Area",
      },
    ];

    const rfidTags = ["ABC123", "DEF456", "GHI789", "JKL012", "MNO345"];

    console.log("🎲 Generating test data...");

    // Register devices
    for (const device of devices) {
      console.log(`📱 Registering device: ${device.name}`);
      // Implementation depends on your API client
    }

    // Register RFID tags
    for (const tagId of rfidTags) {
      console.log(`🏷️ Registering RFID tag: ${tagId}`);
      // Implementation depends on your API client
    }

    console.log("✅ Test data generated");
  }

  static mockScanData(deviceId: string, count: number = 10) {
    const tagIds = ["ABC123", "DEF456", "GHI789", "JKL012", "MNO345"];
    const scans = [];

    for (let i = 0; i < count; i++) {
      scans.push({
        tagId: tagIds[Math.floor(Math.random() * tagIds.length)],
        deviceId,
        timestamp: new Date(
          Date.now() - Math.random() * 86400000
        ).toISOString(),
      });
    }

    return scans;
  }

  static validateEnvironment() {
    const required = ["DATABASE_URL", "JWT_SECRET"];

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      console.error("❌ Missing environment variables:", missing);
      return false;
    }

    console.log("✅ Environment validation passed");
    return true;
  }
}
```

---

## 🧪 Testing Patterns

### Backend API Testing

```typescript
// tests/api.test.ts
import { describe, test, expect, beforeAll, afterAll } from "vitest";

describe("TagSakay API", () => {
  let authToken: string;

  beforeAll(async () => {
    // Setup test environment
    const response = await fetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: "admin@tagsakay.local",
        password: "Admin123!@#",
      }),
    });

    const data = await response.json();
    authToken = data.data.token;
  });

  describe("Authentication", () => {
    test("should login with valid credentials", async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@tagsakay.local",
          password: "Admin123!@#",
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.token).toBeDefined();
    });

    test("should reject invalid credentials", async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@tagsakay.local",
          password: "wrongpassword",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("RFID Management", () => {
    test("should list RFID tags", async () => {
      const response = await fetch("/api/rfid", {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.tags)).toBe(true);
    });

    test("should register new RFID tag", async () => {
      const tagId = `TEST${Date.now()}`;

      const response = await fetch("/api/rfid/register", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tagId }),
      });

      const data = await response.json();
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.tag.tagId).toBe(tagId);
    });
  });
});
```

### Frontend Component Testing

```typescript
// tests/components/RfidCardManagement.test.ts
import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RfidCardManagement from "../views/RfidCardManagement.vue";

// Mock the composables
vi.mock("../composables/useRfidService", () => ({
  useRfidService: () => ({
    tags: ref([
      { id: 1, tagId: "ABC123", status: "active", scanCount: 5 },
      { id: 2, tagId: "DEF456", status: "inactive", scanCount: 2 },
    ]),
    loading: ref(false),
    error: ref(null),
    loadTags: vi.fn(),
    registerTag: vi.fn(),
  }),
}));

describe("RfidCardManagement", () => {
  test("renders tag list", () => {
    const wrapper = mount(RfidCardManagement);

    expect(wrapper.text()).toContain("ABC123");
    expect(wrapper.text()).toContain("DEF456");
  });

  test("filters tags by status", async () => {
    const wrapper = mount(RfidCardManagement);

    const statusSelect = wrapper.find('select[data-testid="status-filter"]');
    await statusSelect.setValue("active");

    expect(wrapper.text()).toContain("ABC123");
    expect(wrapper.text()).not.toContain("DEF456");
  });

  test("opens register modal", async () => {
    const wrapper = mount(RfidCardManagement);

    const registerButton = wrapper.find('[data-testid="register-button"]');
    await registerButton.trigger("click");

    expect(wrapper.find(".modal").classes()).toContain("modal-open");
  });
});
```

---

## 📚 Code Quality & Standards

### TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.vue"],
  "exclude": ["node_modules", "dist"]
}
```

### ESLint Configuration

```json
// .eslintrc.json
{
  "extends": [
    "eslint:recommended",
    "@typescript-eslint/recommended",
    "@vue/typescript/recommended"
  ],
  "rules": {
    "no-console": "warn",
    "no-debugger": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "vue/multi-word-component-names": "off",
    "vue/no-v-html": "error"
  }
}
```

### Git Hooks (Husky)

```json
// package.json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "commit-msg": "commitlint -E HUSKY_GIT_PARAMS"
    }
  },
  "lint-staged": {
    "*.{ts,vue}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

---

**Last Updated:** November 4, 2025  
**Status:** ✅ Complete development guide  
**Next:** See `04_DEPLOYMENT.md` for production deployment
