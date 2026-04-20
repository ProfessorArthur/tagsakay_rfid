/**
 * DeviceConnection Durable Object (DEPRECATED)
 *
 * This file is no longer used as Durable Objects require a paid Cloudflare plan.
 * WebSocket connections are now handled via standard HTTP upgrade.
 *
 * Kept for reference/future use if upgrading to paid plan.
 *
 * Previous features (now handled by WebSocket polling):
 * - WebSocket connection management
 * - Duplicate scan prevention
 * - Offline scan buffering
 * - Device state persistence
 * - Real-time scan processing
 */

import { DurableObject } from "cloudflare:workers";
import type { Database } from "../db/index.js";
import { createDb } from "../db/index.js";
import { devices, rfidScans, rfids, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

interface ScanMessage {
  action: "scan";
  tagId: string;
  location?: string;
  timestamp?: number;
}

interface HeartbeatMessage {
  action: "heartbeat";
  timestamp: number;
}

interface ConfigMessage {
  action: "config";
  registrationMode?: boolean;
  scanMode?: boolean;
}

type WebSocketMessage = ScanMessage | HeartbeatMessage | ConfigMessage;

interface DeviceState {
  deviceId: string;
  lastScanTime: number;
  lastHeartbeat: number;
  scanCount: number;
  offlineScans: Array<{ tagId: string; timestamp: number }>;
  registrationMode: boolean;
  isConnected: boolean;
}

export class DeviceConnection extends DurableObject {
  private websocket: WebSocket | null = null;
  private deviceId: string | null = null;
  private state: DeviceState | null = null;
  private db: Database | null = null;
  public env: any; // Changed from private to public to match DurableObject base class

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId");

    if (!deviceId) {
      return new Response("Missing deviceId parameter", { status: 400 });
    }

    this.deviceId = deviceId;
    this.db = createDb(this.env.DATABASE_URL);

    // Load device state from durable storage
    await this.loadState();

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    // HTTP endpoint for device status
    return new Response(
      JSON.stringify({
        success: true,
        deviceId: this.deviceId,
        state: this.state,
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  private async loadState(): Promise<void> {
    const stored = await this.ctx.storage.get<DeviceState>("state");

    if (stored) {
      this.state = stored;
    } else {
      // Initialize new state
      this.state = {
        deviceId: this.deviceId!,
        lastScanTime: 0,
        lastHeartbeat: Date.now(),
        scanCount: 0,
        offlineScans: [],
        registrationMode: false,
        isConnected: false,
      };
      await this.saveState();
    }
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      await this.ctx.storage.put("state", this.state);
    }
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    // Check if device already has an active connection
    if (this.websocket) {
      return new Response("Device already connected", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.websocket = server;

    if (this.state) {
      this.state.isConnected = true;
      this.state.lastHeartbeat = Date.now();
      await this.saveState();
    }

    // Send welcome message
    this.send({
      success: true,
      message: "Connected to TagSakay API",
      deviceId: this.deviceId,
      timestamp: Date.now(),
    });

    // Process any offline scans that were buffered
    if (this.state && this.state.offlineScans.length > 0) {
      this.send({
        success: true,
        message: `Processing ${this.state.offlineScans.length} offline scans`,
        offlineScans: this.state.offlineScans.length,
      });

      for (const scan of this.state.offlineScans) {
        await this.processScan(scan.tagId, scan.timestamp);
      }

      this.state.offlineScans = [];
      await this.saveState();
    }

    // Handle incoming messages
    server.addEventListener("message", async (event) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data as string);
        await this.handleMessage(data);
      } catch (error) {
        console.error("WebSocket message error:", error);
        this.send({
          success: false,
          error: "Invalid message format",
        });
      }
    });

    // Handle connection close
    server.addEventListener("close", async () => {
      this.websocket = null;
      if (this.state) {
        this.state.isConnected = false;
        await this.saveState();
      }
      console.log(`Device ${this.deviceId} disconnected`);
    });

    // Handle errors
    server.addEventListener("error", (event) => {
      console.error(`WebSocket error for device ${this.deviceId}:`, event);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleMessage(message: WebSocketMessage): Promise<void> {
    switch (message.action) {
      case "scan":
        await this.handleScan(message);
        break;

      case "heartbeat":
        await this.handleHeartbeat(message);
        break;

      case "config":
        await this.handleConfig(message);
        break;

      default:
        this.send({
          success: false,
          error: "Unknown action",
        });
    }
  }

  private async handleScan(message: ScanMessage): Promise<void> {
    if (!this.state) return;

    const now = Date.now();
    const timeSinceLastScan = now - this.state.lastScanTime;

    // Prevent duplicate scans (minimum 1 second interval)
    if (timeSinceLastScan < 1000) {
      this.send({
        success: false,
        error: "Duplicate scan - please wait 1 second between scans",
        timeSinceLastScan,
      });
      return;
    }

    this.state.lastScanTime = now;
    this.state.scanCount++;
    await this.saveState();

    // Process the scan
    await this.processScan(message.tagId, message.timestamp || now);
  }

  private async processScan(tagId: string, timestamp: number): Promise<void> {
    if (!this.db || !this.deviceId) return;

    try {
      // Check if RFID tag is registered
      const [rfidTag] = await this.db
        .select()
        .from(rfids)
        .where(eq(rfids.tagId, tagId))
        .limit(1);

      const isRegistered = !!rfidTag;
      let userData = null;

      if (isRegistered && rfidTag.userId) {
        // Get user info
        const [user] = await this.db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, rfidTag.userId))
          .limit(1);

        userData = user;
      }

      // Get device info
      const [device] = await this.db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, this.deviceId))
        .limit(1);

      // Create scan record
      const [scan] = await this.db
        .insert(rfidScans)
        .values({
          rfidTagId: tagId, // Correct field name from schema
          rfidId: rfidTag?.id || null,
          deviceId: this.deviceId,
          userId: rfidTag?.userId || null,
          eventType: isRegistered ? "entry" : "unknown",
          location: device?.location || "Unknown",
          unitNumber: rfidTag?.unitNumber ?? null,
          scanTime: new Date(timestamp),
          status: isRegistered ? "success" : "failed",
          metadata: {
            deviceName: device?.name,
            registrationMode: this.state?.registrationMode || false,
            unregistered: !isRegistered,
          },
        })
        .returning();

      // Update device lastSeen
      if (device) {
        await this.db
          .update(devices)
          .set({ lastSeen: new Date() })
          .where(eq(devices.deviceId, this.deviceId));
      }

      // Send response back to ESP32
      this.send({
        success: true,
        scan: {
          id: scan.id,
          tagId,
          timestamp,
          isRegistered,
          status: isRegistered ? "success" : "unregistered",
        },
        user: userData
          ? {
              name: userData.name,
              role: userData.role,
            }
          : null,
        device: {
          name: device?.name,
          location: device?.location,
        },
      });
    } catch (error) {
      console.error("Scan processing error:", error);

      // Buffer scan for retry if database error
      if (this.state) {
        this.state.offlineScans.push({ tagId, timestamp });
        await this.saveState();
      }

      this.send({
        success: false,
        error: "Failed to process scan - buffered for retry",
        tagId,
      });
    }
  }

  private async handleHeartbeat(message: HeartbeatMessage): Promise<void> {
    if (!this.state) return;

    this.state.lastHeartbeat = message.timestamp;
    await this.saveState();

    this.send({
      success: true,
      action: "heartbeat_ack",
      timestamp: Date.now(),
      scanCount: this.state.scanCount,
    });
  }

  private async handleConfig(message: ConfigMessage): Promise<void> {
    if (!this.state) return;

    if (message.registrationMode !== undefined) {
      this.state.registrationMode = message.registrationMode;

      // Update device in database
      if (this.db && this.deviceId) {
        await this.db
          .update(devices)
          .set({ registrationMode: message.registrationMode })
          .where(eq(devices.deviceId, this.deviceId));
      }
    }

    if (message.scanMode !== undefined) {
      // Update scan mode if needed (scanMode is boolean in schema)
      if (this.db && this.deviceId) {
        await this.db
          .update(devices)
          .set({ scanMode: message.scanMode })
          .where(eq(devices.deviceId, this.deviceId));
      }
    }

    await this.saveState();

    this.send({
      success: true,
      message: "Configuration updated",
      config: {
        registrationMode: this.state.registrationMode,
      },
    });
  }

  private send(data: any): void {
    if (this.websocket) {
      try {
        this.websocket.send(JSON.stringify(data));
      } catch (error) {
        console.error("Failed to send WebSocket message:", error);
      }
    }
  }
}
