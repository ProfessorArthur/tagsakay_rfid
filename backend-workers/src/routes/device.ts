import { Hono } from "hono";
import {
  authMiddleware,
  requireRole,
  deviceAuthMiddleware,
} from "../middleware/auth.js";
import { apiRateLimit } from "../middleware/rateLimit.js";
import { devices, queueSnapshots, rfidScans } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { generateApiKey, hashApiKey } from "../lib/auth.js";
import { normalizeDeviceSnapshotPayload } from "../lib/queueSnapshot.js";

type Env = {
  Bindings: {
    DATABASE_URL: string;
    JWT_SECRET: string;
    SESSION_SECRET: string;
  };
  Variables: {
    db: Database;
    user?: any;
    device?: any;
  };
};

const app = new Hono<Env>();

const DEVICE_ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
const COMMAND_RESPONSE_CACHE_TTL_MS = 10_000;
const ARCHIVED_DEVICE_PREFIX = "[Archived] ";

const stripArchivedPrefix = (name: string): string => {
  let normalized = name;

  while (normalized.startsWith(ARCHIVED_DEVICE_PREFIX)) {
    normalized = normalized.slice(ARCHIVED_DEVICE_PREFIX.length);
  }

  const trimmed = normalized.trim();
  return trimmed.length > 0 ? trimmed : name;
};

type DeviceStatusPayload = {
  isActive: boolean | null;
  registrationMode: boolean | null;
  scanMode: boolean | null;
  pendingRegistrationTagId: string;
};

type DeviceCommandPayload = {
  commands: Array<Record<string, unknown>>;
  deviceStatus: DeviceStatusPayload;
  commandVersion: string;
};

type DeviceCommandCacheEntry = {
  value: DeviceCommandPayload;
  expiresAt: number;
};

const deviceCommandResponseCache = new Map<string, DeviceCommandCacheEntry>();

const buildDeviceCommandPayload = (deviceData: {
  isActive: boolean | null;
  registrationMode: boolean | null;
  scanMode: boolean | null;
  pendingRegistrationTagId: string | null;
}): DeviceCommandPayload => {
  const registrationMode = Boolean(deviceData.registrationMode);
  const scanMode = Boolean(deviceData.scanMode);
  const pendingRegistrationTagId = deviceData.pendingRegistrationTagId ?? "";
  const commandVersion = [
    registrationMode ? "1" : "0",
    scanMode ? "1" : "0",
    pendingRegistrationTagId,
    deviceData.isActive ? "1" : "0",
  ].join("|");

  const commands: Array<Record<string, unknown>> = [];
  if (registrationMode && pendingRegistrationTagId) {
    commands.push({
      action: "enable_registration",
      tagId: pendingRegistrationTagId,
      timestamp: Date.now(),
    });
  } else if (!registrationMode) {
    commands.push({
      action: "disable_registration",
      timestamp: Date.now(),
    });
  }

  commands.push({
    action: "scan_mode",
    enabled: scanMode,
    timestamp: Date.now(),
  });

  return {
    commands,
    deviceStatus: {
      isActive: deviceData.isActive,
      registrationMode: deviceData.registrationMode,
      scanMode: deviceData.scanMode,
      pendingRegistrationTagId,
    },
    commandVersion,
  };
};

const getCachedDeviceCommands = (
  deviceId: string
): DeviceCommandPayload | undefined => {
  const cached = deviceCommandResponseCache.get(deviceId);
  if (!cached) {
    return undefined;
  }
  if (Date.now() > cached.expiresAt) {
    deviceCommandResponseCache.delete(deviceId);
    return undefined;
  }
  return cached.value;
};

const setCachedDeviceCommands = (deviceId: string, payload: DeviceCommandPayload) => {
  deviceCommandResponseCache.set(deviceId, {
    value: payload,
    expiresAt: Date.now() + COMMAND_RESPONSE_CACHE_TTL_MS,
  });
};

const invalidateDeviceCommandCache = (deviceId: string) => {
  deviceCommandResponseCache.delete(deviceId);
};

type DeviceResponseRecord = {
  id: string;
  deviceId: string;
  macAddress: string;
  name: string;
  location: string;
  isActive: boolean | null;
  registrationMode: boolean | null;
  scanMode: boolean | null;
  pendingRegistrationTagId?: string | null;
  lastSeen: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type EnrichedDeviceRecord = DeviceResponseRecord & {
  status: "online" | "offline";
  lastSeenAgoSeconds: number | null;
};

const resolveSnapshotDate = (timestamp: string | null): Date => {
  if (!timestamp) {
    return new Date();
  }
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const toIsoString = (
  value: Date | string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

const enrichDeviceRecord = (
  device: DeviceResponseRecord
): EnrichedDeviceRecord => {
  const now = Date.now();
  const lastSeenIso = toIsoString(device.lastSeen);
  const lastSeenDate = lastSeenIso ? new Date(lastSeenIso) : null;
  const isActive = device.isActive ?? false;

  const isOnline =
    isActive &&
    lastSeenDate !== null &&
    now - lastSeenDate.getTime() <= DEVICE_ONLINE_THRESHOLD_MS;

  return {
    ...device,
    isActive,
    registrationMode: device.registrationMode ?? false,
    scanMode: device.scanMode ?? false,
    pendingRegistrationTagId: device.pendingRegistrationTagId ?? "",
    lastSeen: lastSeenIso,
    createdAt: toIsoString(device.createdAt),
    updatedAt: toIsoString(device.updatedAt),
    status: isOnline ? "online" : "offline",
    lastSeenAgoSeconds:
      lastSeenDate === null
        ? null
        : Math.floor((now - lastSeenDate.getTime()) / 1000),
  };
};

// POST /api/devices/register - Register new device (admin/superadmin only)
app.post(
  "/register",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const user = c.get("user");
      const { macAddress, name, location } = await c.req.json();

      if (!macAddress || !name || !location) {
        return c.json(
          {
            success: false,
            message: "macAddress, name, and location are required",
          },
          400
        );
      }

      // Format deviceId from MAC address (remove colons)
      const deviceId = macAddress.replace(/:/g, "");

      // Check if device already exists
      const [existingDevice] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, deviceId))
        .limit(1);

      if (existingDevice) {
        return c.json(
          {
            success: false,
            message: "Device already registered",
          },
          409
        );
      }

      // Generate API key for device
      const apiKey = generateApiKey();
      const hashedApiKey = await hashApiKey(apiKey);

      // Create new device
      const [newDevice] = await db
        .insert(devices)
        .values({
          deviceId,
          macAddress,
          name,
          location,
          apiKey: hashedApiKey,
          isActive: true,
          registrationMode: false,
          scanMode: false,
          pendingRegistrationTagId: "",
        })
        .returning();

      const registeredDevice = enrichDeviceRecord({
        id: newDevice.id,
        deviceId: newDevice.deviceId,
        macAddress: newDevice.macAddress,
        name: newDevice.name,
        location: newDevice.location,
        isActive: newDevice.isActive,
        registrationMode: newDevice.registrationMode,
        scanMode: newDevice.scanMode,
        pendingRegistrationTagId: newDevice.pendingRegistrationTagId,
        lastSeen: newDevice.lastSeen,
        createdAt: newDevice.createdAt,
        updatedAt: newDevice.updatedAt,
      });

      return c.json(
        {
          success: true,
          message: "Device registered successfully",
          data: {
            device: registeredDevice,
            apiKey: apiKey, // Return plain API key only once
          },
        },
        201
      );
    } catch (error: any) {
      console.error("Device registration error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to register device",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/devices - List all devices (admin/superadmin only)
app.get("/", authMiddleware, requireRole("admin", "superadmin"), async (c) => {
  try {
    const db = c.get("db");

    // Pagination parameters
    const limitParam = Number.parseInt(c.req.query("limit") || "50", 10);
    const pageParam = Number.parseInt(c.req.query("page") || "1", 10);

    const sanitizedLimit = Math.min(
      Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1),
      200
    );
    const sanitizedPage = Math.max(
      Number.isFinite(pageParam) ? pageParam : 1,
      1
    );
    const offset = (sanitizedPage - 1) * sanitizedLimit;

    // Get total count and online/offline counts
    const countResult = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "isActive" = true AND "lastSeen" >= ${new Date(
          Date.now() - DEVICE_ONLINE_THRESHOLD_MS
        )})::int AS online,
        COUNT(*) FILTER (WHERE "isActive" = true AND "lastSeen" < ${new Date(
          Date.now() - DEVICE_ONLINE_THRESHOLD_MS
        )})::int AS offline
      FROM "Devices"
    `);

    const totalDevices = (countResult.rows[0] as any)?.total || 0;
    const onlineCount = (countResult.rows[0] as any)?.online || 0;
    const offlineCount = (countResult.rows[0] as any)?.offline || 0;

    // Get paginated devices
    const paginatedDevices = await db
      .select({
        id: devices.id,
        deviceId: devices.deviceId,
        macAddress: devices.macAddress,
        name: devices.name,
        location: devices.location,
        isActive: devices.isActive,
        registrationMode: devices.registrationMode,
        scanMode: devices.scanMode,
        pendingRegistrationTagId: devices.pendingRegistrationTagId,
        lastSeen: devices.lastSeen,
        createdAt: devices.createdAt,
        updatedAt: devices.updatedAt,
      })
      .from(devices)
      .orderBy(desc(devices.lastSeen))
      .limit(sanitizedLimit)
      .offset(offset);

    const enrichedDevices = paginatedDevices.map(enrichDeviceRecord);

    const totalPages = Math.ceil(totalDevices / sanitizedLimit);

    return c.json({
      success: true,
      message: `Retrieved ${enrichedDevices.length} devices (page ${sanitizedPage} of ${totalPages})`,
      data: {
        devices: enrichedDevices,
        pagination: {
          page: sanitizedPage,
          limit: sanitizedLimit,
          total: totalDevices,
          totalPages,
          hasNext: sanitizedPage < totalPages,
          hasPrev: sanitizedPage > 1,
        },
        summary: {
          online: onlineCount,
          offline: offlineCount,
        },
      },
    });
  } catch (error: any) {
    console.error("List devices error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve devices",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/devices/active - List active devices
app.get(
  "/active",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");

      const activeDevices = await db
        .select({
          id: devices.id,
          deviceId: devices.deviceId,
          macAddress: devices.macAddress,
          name: devices.name,
          location: devices.location,
          isActive: devices.isActive,
          registrationMode: devices.registrationMode,
          scanMode: devices.scanMode,
          pendingRegistrationTagId: devices.pendingRegistrationTagId,
          lastSeen: devices.lastSeen,
          createdAt: devices.createdAt,
          updatedAt: devices.updatedAt,
        })
        .from(devices)
        .where(eq(devices.isActive, true))
        .orderBy(desc(devices.lastSeen));

      const enrichedActiveDevices = activeDevices.map(enrichDeviceRecord);
      const onlineDevices = enrichedActiveDevices.filter(
        (device) => device.status === "online"
      );
      const staleDevices = enrichedActiveDevices.filter(
        (device) => device.status === "offline"
      );

      return c.json({
        success: true,
        message: `Retrieved ${onlineDevices.length} online devices`,
        data: {
          devices: onlineDevices,
          total: onlineDevices.length,
          stale: staleDevices,
        },
      });
    } catch (error: any) {
      console.error("List active devices error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve active devices",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/devices/:deviceId - Get specific device
app.get("/:deviceId", authMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const deviceId = c.req.param("deviceId");

    const [device] = await db
      .select({
        id: devices.id,
        deviceId: devices.deviceId,
        macAddress: devices.macAddress,
        name: devices.name,
        location: devices.location,
        isActive: devices.isActive,
        registrationMode: devices.registrationMode,
        scanMode: devices.scanMode,
        pendingRegistrationTagId: devices.pendingRegistrationTagId,
        lastSeen: devices.lastSeen,
        createdAt: devices.createdAt,
        updatedAt: devices.updatedAt,
      })
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .limit(1);

    if (!device) {
      return c.json(
        {
          success: false,
          message: "Device not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      message: "Device retrieved successfully",
      data: {
        device: enrichDeviceRecord(device),
      },
    });
  } catch (error: any) {
    console.error("Get device error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve device",
        error: error.message,
      },
      500
    );
  }
});

// PUT /api/devices/:deviceId - Update device (admin/superadmin only)
app.put(
  "/:deviceId",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const deviceId = c.req.param("deviceId");
      const { name, location, isActive } = await c.req.json();

      // Check if device exists
      const [existingDevice] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, deviceId))
        .limit(1);

      if (!existingDevice) {
        return c.json(
          {
            success: false,
            message: "Device not found",
          },
          404
        );
      }

      // Build update object
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (name !== undefined) updateData.name = name;
      if (location !== undefined) updateData.location = location;
      if (isActive !== undefined) updateData.isActive = isActive;

      // Update device
      const [updatedDevice] = await db
        .update(devices)
        .set(updateData)
        .where(eq(devices.deviceId, deviceId))
        .returning();

      invalidateDeviceCommandCache(deviceId);

      const responseDevice = enrichDeviceRecord({
        id: updatedDevice.id,
        deviceId: updatedDevice.deviceId,
        macAddress: updatedDevice.macAddress,
        name: updatedDevice.name,
        location: updatedDevice.location,
        isActive: updatedDevice.isActive,
        registrationMode: updatedDevice.registrationMode,
        scanMode: updatedDevice.scanMode,
        pendingRegistrationTagId: updatedDevice.pendingRegistrationTagId,
        lastSeen: updatedDevice.lastSeen,
        createdAt: updatedDevice.createdAt,
        updatedAt: updatedDevice.updatedAt,
      });

      return c.json({
        success: true,
        message: "Device updated successfully",
        data: {
          device: responseDevice,
        },
      });
    } catch (error: any) {
      console.error("Update device error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to update device",
          error: error.message,
        },
        500
      );
    }
  }
);

// DELETE /api/devices/:deviceId - Remove a device (admin/superadmin only)
app.delete(
  "/:deviceId",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const deviceId = c.req.param("deviceId");

      const [existingDevice] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, deviceId))
        .limit(1);

      if (!existingDevice) {
        return c.json(
          {
            success: false,
            message: "Device not found",
          },
          404
        );
      }

      const scanCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(rfidScans)
        .where(eq(rfidScans.deviceId, deviceId));
      const linkedScanCount = Number(scanCountResult[0]?.count ?? 0);

      if (linkedScanCount > 0) {
        const archivedName = existingDevice.name.startsWith(ARCHIVED_DEVICE_PREFIX)
          ? existingDevice.name
          : `${ARCHIVED_DEVICE_PREFIX}${existingDevice.name}`.slice(0, 255);

        const [archivedDevice] = await db
          .update(devices)
          .set({
            isActive: false,
            registrationMode: false,
            scanMode: false,
            pendingRegistrationTagId: "",
            name: archivedName,
            updatedAt: new Date(),
          })
          .where(eq(devices.deviceId, deviceId))
          .returning({
            id: devices.id,
            deviceId: devices.deviceId,
            name: devices.name,
            isActive: devices.isActive,
          });

        invalidateDeviceCommandCache(deviceId);

        return c.json(
          {
            success: true,
            message:
              "Device has scan history and was archived instead of being deleted.",
            data: {
              device: archivedDevice,
              archived: true,
              removed: false,
              linkedScanCount,
            },
          },
          200
        );
      }

      const result = await db
        .delete(devices)
        .where(eq(devices.deviceId, deviceId))
        .returning({
          id: devices.id,
          deviceId: devices.deviceId,
          name: devices.name,
        });

      invalidateDeviceCommandCache(deviceId);

      return c.json({
        success: true,
        message: "Device removed successfully",
        data: {
          device: result[0],
          archived: false,
          removed: true,
          linkedScanCount: 0,
        },
      });
    } catch (error: any) {
      console.error("Delete device error:", error);

      if (error?.code === "23503") {
        return c.json(
          {
            success: false,
            message:
              "Cannot delete device because it is still referenced by related records.",
          },
          409
        );
      }

      return c.json(
        {
          success: false,
          message: "Failed to remove device",
          error: error.message,
        },
        500
      );
    }
  }
);

// POST /api/devices/:deviceId/unarchive - Restore previously archived device
app.post(
  "/:deviceId/unarchive",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const deviceId = c.req.param("deviceId");

      const [existingDevice] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, deviceId))
        .limit(1);

      if (!existingDevice) {
        return c.json(
          {
            success: false,
            message: "Device not found",
          },
          404
        );
      }

      const restoredName = stripArchivedPrefix(existingDevice.name).slice(0, 255);

      const [updatedDevice] = await db
        .update(devices)
        .set({
          isActive: true,
          registrationMode: false,
          scanMode: false,
          pendingRegistrationTagId: "",
          name: restoredName,
          updatedAt: new Date(),
        })
        .where(eq(devices.deviceId, deviceId))
        .returning();

      invalidateDeviceCommandCache(deviceId);

      const responseDevice = enrichDeviceRecord({
        id: updatedDevice.id,
        deviceId: updatedDevice.deviceId,
        macAddress: updatedDevice.macAddress,
        name: updatedDevice.name,
        location: updatedDevice.location,
        isActive: updatedDevice.isActive,
        registrationMode: updatedDevice.registrationMode,
        scanMode: updatedDevice.scanMode,
        pendingRegistrationTagId: updatedDevice.pendingRegistrationTagId,
        lastSeen: updatedDevice.lastSeen,
        createdAt: updatedDevice.createdAt,
        updatedAt: updatedDevice.updatedAt,
      });

      return c.json({
        success: true,
        message: "Device unarchived successfully",
        data: {
          device: responseDevice,
          unarchived: true,
        },
      });
    } catch (error: any) {
      console.error("Unarchive device error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to unarchive device",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/devices/:deviceId/commands - Poll for pending commands (device auth + rate limit)
app.get(
  "/:deviceId/commands",
  apiRateLimit,
  deviceAuthMiddleware,
  async (c) => {
    try {
      const db = c.get("db");
      const deviceId = c.req.param("deviceId");
      const device = c.get("device");

      // Verify deviceId matches authenticated device
      if (device && device.deviceId !== deviceId) {
        return c.json(
          {
            success: false,
            message: "Device ID mismatch",
          },
          403
        );
      }

      const clientCommandVersion = c.req.query("lastCommandVersion") ?? "";
      const cachedPayload = getCachedDeviceCommands(deviceId);
      if (cachedPayload) {
        const commands =
          clientCommandVersion === cachedPayload.commandVersion
            ? []
            : cachedPayload.commands;

        return c.json({
          success: true,
          message: "Commands retrieved from cache",
          data: {
            commands,
            deviceStatus: cachedPayload.deviceStatus,
            commandVersion: cachedPayload.commandVersion,
            unchanged: clientCommandVersion === cachedPayload.commandVersion,
            fromCache: true,
          },
        });
      }

      // Get device state
      const [deviceData] = await db
        .select({
          deviceId: devices.deviceId,
          isActive: devices.isActive,
          registrationMode: devices.registrationMode,
          scanMode: devices.scanMode,
          pendingRegistrationTagId: devices.pendingRegistrationTagId,
          lastSeen: devices.lastSeen,
        })
        .from(devices)
        .where(eq(devices.deviceId, deviceId))
        .limit(1);

      if (!deviceData) {
        invalidateDeviceCommandCache(deviceId);
        return c.json(
          {
            success: false,
            message: "Device not found",
          },
          404
        );
      }

      const payload = buildDeviceCommandPayload(deviceData);
      setCachedDeviceCommands(deviceId, payload);

      const commands =
        clientCommandVersion === payload.commandVersion ? [] : payload.commands;

      return c.json({
        success: true,
        message: "Commands retrieved",
        data: {
          commands,
          deviceStatus: payload.deviceStatus,
          commandVersion: payload.commandVersion,
          unchanged: clientCommandVersion === payload.commandVersion,
          fromCache: false,
        },
      });
    } catch (error: any) {
      console.error("Get commands error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve commands",
          error: error.message,
        },
        500
      );
    }
  }
);

// POST /api/devices/:deviceId/heartbeat - Device heartbeat (device auth)
app.post("/:deviceId/heartbeat", deviceAuthMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const deviceId = c.req.param("deviceId");
    const device = c.get("device");

    // Verify deviceId matches authenticated device
    if (device && device.deviceId !== deviceId) {
      return c.json(
        {
          success: false,
          message: "Device ID mismatch",
        },
        403
      );
    }

    // Update last seen timestamp
    const [updatedDevice] = await db
      .update(devices)
      .set({
        lastSeen: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(devices.deviceId, deviceId))
      .returning();

    invalidateDeviceCommandCache(deviceId);

    if (!updatedDevice) {
      return c.json(
        {
          success: false,
          message: "Device not found",
        },
        404
      );
    }

    const heartbeatDevice = enrichDeviceRecord({
      id: updatedDevice.id,
      deviceId: updatedDevice.deviceId,
      macAddress: updatedDevice.macAddress,
      name: updatedDevice.name,
      location: updatedDevice.location,
      isActive: updatedDevice.isActive,
      registrationMode: updatedDevice.registrationMode,
      scanMode: updatedDevice.scanMode,
      pendingRegistrationTagId: updatedDevice.pendingRegistrationTagId,
      lastSeen: updatedDevice.lastSeen,
      createdAt: updatedDevice.createdAt,
      updatedAt: updatedDevice.updatedAt,
    });

    return c.json({
      success: true,
      message: "Heartbeat received",
      data: {
        device: heartbeatDevice,
      },
    });
  } catch (error: any) {
    console.error("Heartbeat error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to process heartbeat",
        error: error.message,
      },
      500
    );
  }
});

// POST /api/devices/:deviceId/status - Device status updates (device auth)
app.post("/:deviceId/status", deviceAuthMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const deviceId = c.req.param("deviceId");
    const device = c.get("device");

    if (device && device.deviceId !== deviceId) {
      return c.json(
        {
          success: false,
          message: "Device ID mismatch",
        },
        403
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : "";

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
      lastSeen: new Date(),
    };

    if (typeof body?.registrationMode === "boolean") {
      updateData.registrationMode = body.registrationMode;
    }

    if (typeof body?.scanMode === "boolean") {
      updateData.scanMode = body.scanMode;
    }

    if (typeof body?.pendingRegistrationTagId === "string") {
      updateData.pendingRegistrationTagId = body.pendingRegistrationTagId;
    }

    if (
      reason === "registration_timeout" ||
      reason === "registration_complete"
    ) {
      updateData.registrationMode = false;
      updateData.pendingRegistrationTagId = "";
    }

    const [existingDevice] = await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .limit(1);

    if (!existingDevice) {
      return c.json(
        {
          success: false,
          message: "Device not found",
        },
        404
      );
    }

    const [updatedDevice] = await db
      .update(devices)
      .set(updateData)
      .where(eq(devices.deviceId, deviceId))
      .returning();

    invalidateDeviceCommandCache(deviceId);

    const responseDevice = enrichDeviceRecord({
      id: updatedDevice.id,
      deviceId: updatedDevice.deviceId,
      macAddress: updatedDevice.macAddress,
      name: updatedDevice.name,
      location: updatedDevice.location,
      isActive: updatedDevice.isActive,
      registrationMode: updatedDevice.registrationMode,
      scanMode: updatedDevice.scanMode,
      pendingRegistrationTagId: updatedDevice.pendingRegistrationTagId,
      lastSeen: updatedDevice.lastSeen,
      createdAt: updatedDevice.createdAt,
      updatedAt: updatedDevice.updatedAt,
    });

    return c.json({
      success: true,
      message: "Device status updated",
      data: {
        device: responseDevice,
      },
    });
  } catch (error: any) {
    console.error("Device status update error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to update device status",
        error: error.message,
      },
      500
    );
  }
});

// In-memory rate limiter (module scope)
const deviceLastSeen = new Map<string, number>();
const MIN_SNAPSHOT_INTERVAL_MS = 500; // minimum ms between snapshots from same device
const DUPLICATE_SKIP_WINDOW_MS = 30_000; // if unchanged within this window, skip DB write

app.post("/:deviceId/queue/snapshot", async (c) => {
  const db = c.get("db");
  const deviceId = c.req.param("deviceId");

  // Read raw body so we can guard against huge payloads
  const raw = await c.req.text();
  if (raw.length > 200_000) {
    console.warn(
      `[queue/snapshot] payload too large for device=${deviceId} size=${raw.length}`
    );
    return c.json({ success: false, message: "Payload too large" }, 413);
  }

  // Simple per-device rate limit (best-effort, in-memory)
  const now = Date.now();
  const last = deviceLastSeen.get(deviceId) ?? 0;
  if (now - last < MIN_SNAPSHOT_INTERVAL_MS) {
    console.warn(
      `[queue/snapshot] rate limit hit device=${deviceId} intervalMs=${
        now - last
      }`
    );
    return c.json({ success: false, message: "Too many requests" }, 429);
  }
  deviceLastSeen.set(deviceId, now);

  // Ensure the device is registered before attempting to persist snapshots
  try {
    const [registered] = await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .limit(1);
    if (!registered) {
      console.warn(`[queue/snapshot] device not registered device=${deviceId}`);
      return c.json({ success: false, message: "Device not registered" }, 404);
    }
  } catch (err) {
    console.warn(
      `[queue/snapshot] device lookup failed device=${deviceId}`,
      err
    );
    return c.json({ success: false, message: "Device lookup failed" }, 500);
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    console.warn(`[queue/snapshot] invalid json for device=${deviceId}`);
    return c.json({ success: false, message: "Invalid JSON" }, 400);
  }

  // Protect against unexpectedly large slot arrays from devices
  if (Array.isArray(body.slots) && body.slots.length > 40) {
    console.warn(
      `[queue/snapshot] trimming slots for device=${deviceId} from ${body.slots.length} -> 40`
    );
    body.slots = body.slots.slice(0, 40);
  }

  // Fast-path: if the device sent a precomputed cascade string and no slots,
  // avoid expensive normalization and SELECT by performing a single upsert
  // that only updates when the cascade actually changed. This reduces CPU
  // by skipping per-slot normalization and the extra select step.
  if (typeof body.cascade === "string" && !Array.isArray(body.slots)) {
    try {
      // Normalize and pad the device-supplied cascade string so the server
      // stores consistent zero-padded values (eg. 1 -> 01). This avoids
      // display and coloring discrepancies between firmware and backend.
      const rawFastCascade = String(body.cascade);
      const fastCascade = rawFastCascade
        .split(",")
        .map((part) => {
          const trimmed = ((part ?? "") + "").toString().trim().toUpperCase();
          if (!trimmed || trimmed === "0" || trimmed === "---") return "0";
          if (/^[1-9]{1}$/.test(trimmed)) return `0${trimmed}`; // pad single-digit numbers (not '0')
          return trimmed;
        })
        .join(",");
      const tFastDb = performance.now();
      await db.execute(sql`
        INSERT INTO "QueueSnapshots" ("deviceId","cascade","updatedAt")
        VALUES (${deviceId}, ${fastCascade}, now())
        ON CONFLICT ("deviceId") DO UPDATE
        SET "cascade" = EXCLUDED."cascade", "updatedAt" = now()
        WHERE "QueueSnapshots"."cascade" IS DISTINCT FROM EXCLUDED."cascade";
      `);
      const fastDbMs = Math.round(performance.now() - tFastDb);
      console.log(
        `[queue/snapshot] fast-path upsert device=${deviceId} dbMs=${fastDbMs}`
      );
      return c.json({ success: true, message: "Snapshot updated (fast-path)" });
    } catch (err) {
      console.warn(
        `[queue/snapshot] fast-path upsert failed device=${deviceId}`,
        err
      );
      // fall through to the regular normalize + upsert path
    }
  }

  const t0 = performance.now();
  try {
    const tNormStart = performance.now();
    let normalized: any;
    try {
      normalized = normalizeDeviceSnapshotPayload(body);
    } catch (err) {
      console.warn(`[queue/snapshot] normalize failed device=${deviceId}`, err);
      return c.json(
        { success: false, message: "Invalid snapshot payload" },
        400
      );
    }
    const normMs = Math.round(performance.now() - tNormStart);
    console.log(
      `[queue/snapshot] normalize timeMs=${normMs} device=${deviceId}`
    );

    const cascadeStr =
      typeof normalized === "string"
        ? normalized
        : normalized?.cascade ?? JSON.stringify(normalized);

    console.log(
      `[queue/snapshot] device=${deviceId} cascadeStr=${String(
        cascadeStr
      ).slice(0, 200)}`
    );

    // Quick duplicate-skip: read existing cascade and avoid an upsert if unchanged recently
    const tSelectStart = performance.now();
    let existingRow: any = null;
    try {
      const rows = await db
        .select({
          cascade: queueSnapshots.cascade,
          updatedAt: queueSnapshots.updatedAt,
        })
        .from(queueSnapshots)
        .where(eq(queueSnapshots.deviceId, deviceId))
        .limit(1);
      if (rows && rows.length) existingRow = rows[0];
    } catch (err) {
      console.warn(
        `[queue/snapshot] select existing failed device=${deviceId}`,
        err
      );
      // continue to attempt upsert if select fails
    }
    const selectMs = Math.round(performance.now() - tSelectStart);
    if (existingRow) {
      console.log(
        `[queue/snapshot] device=${deviceId} existingCascade=${String(
          existingRow.cascade
        ).slice(0, 200)} updatedAt=${existingRow.updatedAt}`
      );
    }

    if (existingRow && existingRow.cascade === cascadeStr) {
      const lastUpdatedMs = new Date(existingRow.updatedAt).getTime();
      if (now - lastUpdatedMs < DUPLICATE_SKIP_WINDOW_MS) {
        const took = Math.round(performance.now() - t0);
        console.log(
          `[queue/snapshot] skipped upsert (no change) device=${deviceId} totalMs=${took} normalizeMs=${normMs} selectMs=${selectMs}`
        );
        return c.json({ success: true, message: "No change" }, 200);
      }
      // else fall through to update timestamp via upsert (or update only)
    }

    const tDbStart = performance.now();
    // Upsert: replace the snapshot for this device
    // Prepare normalized values with non-null types for DB
    const normalizedSlots = (normalized.slots ?? []) as any[];
    const normalizedSlotCount = normalizedSlots.length || 0;
    const normalizedTotalActive =
      typeof normalized.totalActive === "number" ? normalized.totalActive : 0;
    const normalizedOperationModeActive =
      normalized.operationModeActive === undefined
        ? true
        : Boolean(normalized.operationModeActive);
    const normalizedLastUpdated = normalized.lastUpdated
      ? new Date(normalized.lastUpdated)
      : new Date();

    // Persist full normalized snapshot (cascade + slots + metadata)
    await db
      .insert(queueSnapshots)
      .values({
        deviceId,
        cascade: cascadeStr,
        slots: normalizedSlots,
        slotCount: normalizedSlotCount,
        totalActive: normalizedTotalActive,
        operationModeActive: normalizedOperationModeActive,
        lastUpdated: normalizedLastUpdated,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: queueSnapshots.deviceId,
        set: {
          cascade: cascadeStr,
          slots: normalizedSlots,
          slotCount: normalizedSlotCount,
          totalActive: normalizedTotalActive,
          operationModeActive: normalizedOperationModeActive,
          lastUpdated: normalizedLastUpdated,
          updatedAt: new Date(),
        },
      });
    const dbMs = Math.round(performance.now() - tDbStart);

    const took = Math.round(performance.now() - t0);
    console.log(
      `[queue/snapshot] upsert complete device=${deviceId} totalMs=${took} normalizeMs=${normMs} selectMs=${selectMs} dbMs=${dbMs}`
    );
    return c.json({ success: true, message: "Snapshot updated" });
  } catch (err) {
    const took = Math.round(performance.now() - t0);
    console.error(
      `[queue/snapshot] failed device=${deviceId} timeMs=${took}`,
      err
    );
    return c.json({ success: false, message: "Internal error" }, 500);
  }
});

// POST /api/devices/:deviceId/mode - Change device mode (admin/superadmin only)
app.post(
  "/:deviceId/mode",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const deviceId = c.req.param("deviceId");
      const { registrationMode, scanMode, pendingRegistrationTagId } =
        await c.req.json();

      // Check if device exists
      const [existingDevice] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, deviceId))
        .limit(1);

      if (!existingDevice) {
        return c.json(
          {
            success: false,
            message: "Device not found",
          },
          404
        );
      }

      // Build update object
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (registrationMode !== undefined)
        updateData.registrationMode = registrationMode;
      if (scanMode !== undefined) updateData.scanMode = scanMode;
      if (pendingRegistrationTagId !== undefined)
        updateData.pendingRegistrationTagId = pendingRegistrationTagId;

      // Update device mode
      const [updatedDevice] = await db
        .update(devices)
        .set(updateData)
        .where(eq(devices.deviceId, deviceId))
        .returning();

      invalidateDeviceCommandCache(deviceId);

      const responseDevice = enrichDeviceRecord({
        id: updatedDevice.id,
        deviceId: updatedDevice.deviceId,
        macAddress: updatedDevice.macAddress,
        name: updatedDevice.name,
        location: updatedDevice.location,
        isActive: updatedDevice.isActive,
        registrationMode: updatedDevice.registrationMode,
        scanMode: updatedDevice.scanMode,
        pendingRegistrationTagId: updatedDevice.pendingRegistrationTagId,
        lastSeen: updatedDevice.lastSeen,
        createdAt: updatedDevice.createdAt,
        updatedAt: updatedDevice.updatedAt,
      });

      return c.json({
        success: true,
        message: "Device mode updated successfully",
        data: {
          device: responseDevice,
        },
      });
    } catch (error: any) {
      console.error("Update device mode error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to update device mode",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/devices/:deviceId/config - Get device configuration (device auth)
app.get("/:deviceId/config", deviceAuthMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const deviceId = c.req.param("deviceId");
    const device = c.get("device");

    // Verify deviceId matches authenticated device
    if (device && device.deviceId !== deviceId) {
      return c.json(
        {
          success: false,
          message: "Device ID mismatch",
        },
        403
      );
    }

    const [deviceData] = await db
      .select({
        deviceId: devices.deviceId,
        name: devices.name,
        location: devices.location,
        registrationMode: devices.registrationMode,
        scanMode: devices.scanMode,
        pendingRegistrationTagId: devices.pendingRegistrationTagId,
      })
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .limit(1);

    if (!deviceData) {
      return c.json(
        {
          success: false,
          message: "Device not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      message: "Device configuration retrieved",
      data: {
        device: {
          name: deviceData.name,
          location: deviceData.location,
          registrationMode: deviceData.registrationMode,
          scanMode: deviceData.scanMode,
          pendingRegistrationTagId: deviceData.pendingRegistrationTagId,
        },
      },
    });
  } catch (error: any) {
    console.error("Get device config error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve device configuration",
        error: error.message,
      },
      500
    );
  }
});

// POST /api/devices/:deviceId/queue-override - Handle queue override from device (device auth)
app.post("/:deviceId/queue-override", deviceAuthMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const deviceId = c.req.param("deviceId");
    const device = c.get("device");

    if (device && device.deviceId !== deviceId) {
      return c.json(
        {
          success: false,
          message: "Device ID mismatch",
        },
        403
      );
    }

    const body = await c.req.json();
    const { slot, tagId, color } = body;

    if (typeof slot !== "number" || slot < 0 || slot > 39) {
      return c.json(
        {
          success: false,
          message: "Invalid slot number (must be 0-39)",
        },
        400
      );
    }

    if (
      !tagId ||
      typeof tagId !== "string" ||
      tagId.length < 4 ||
      tagId.length > 32
    ) {
      return c.json(
        {
          success: false,
          message: "Invalid tagId (must be 4-32 characters)",
        },
        400
      );
    }

    if (
      !color ||
      typeof color !== "string" ||
      !["RESERVE", "FIX"].includes(color.toUpperCase())
    ) {
      return c.json(
        {
          success: false,
          message: "Invalid color (must be RESERVE or FIX)",
        },
        400
      );
    }

    // Log the override action (you can extend this to store in DB if needed)
    console.log(
      `[queue-override] device=${deviceId} slot=${slot} tagId=${tagId} color=${color}`
    );

    // Store the override as an RFID scan event
    const eventType =
      color.toUpperCase() === "RESERVE" ? "override_reserve" : "override_fix";

    const [newScan] = await db
      .insert(rfidScans)
      .values({
        rfidTagId: tagId,
        deviceId,
        eventType,
        status: "success",
        metadata: {
          overrideSlot: slot,
          overrideColor: color.toUpperCase(),
          overrideType: "manual_queue_override",
        },
      })
      .returning();

    return c.json({
      success: true,
      message: "Queue override processed",
      data: {
        scanId: newScan.id,
        slot,
        tagId,
        color: color.toUpperCase(),
        eventType,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Queue override error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to process queue override",
        error: error.message,
      },
      500
    );
  }
});

export default app;
