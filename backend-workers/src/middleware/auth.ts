import { Context, Next } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { verifyJWT } from "../lib/auth.js";
import { getSession } from "../lib/session.js";

type AuthResult = {
  authorized: boolean;
  status?: number;
  message?: string;
};

type DeviceAuthSuccess = {
  device: any;
  apiKeyRecord?: any;
};

// Module-level cache so it persists across requests
const apiKeyAuthCache = new Map<
  string,
  { device: any; apiKeyId?: string; expiresAt: number }
>();

const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const API_KEY_CACHE_MAX_ENTRIES = 2000;
const API_KEY_SCAN_ATTEMPT_LIMIT = 50; // maximum PBKDF2 checks per request

function pruneApiKeyCache() {
  if (apiKeyAuthCache.size <= API_KEY_CACHE_MAX_ENTRIES) return;
  const iterator = apiKeyAuthCache.keys();
  while (apiKeyAuthCache.size > API_KEY_CACHE_MAX_ENTRIES) {
    const k = iterator.next().value;
    if (!k) break;
    apiKeyAuthCache.delete(k);
  }
}

async function tryAuthenticateUser(c: Context): Promise<AuthResult> {
  const authHeader = c.req.header("Authorization");

  if (authHeader) {
    if (!authHeader.startsWith("Bearer ")) {
      return { authorized: false, status: 401, message: "No token provided" };
    }

    const token = authHeader.substring(7);

    try {
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      c.set("user", payload);
      return { authorized: true };
    } catch (error) {
      return {
        authorized: false,
        status: 401,
        message: "Invalid or expired token",
      };
    }
  }

  try {
    const session = await getSession(c as any);
    if (session) {
      c.set("user", session);
      return { authorized: true };
    }
  } catch (error) {
    console.warn("Session cookie verification failed", error);
  }

  return { authorized: false };
}

async function authenticateDeviceWithApiKey(
  c: Context,
  apiKey: string,
  deviceIdHeader?: string | null
): Promise<DeviceAuthSuccess | null> {
  const db = c.get("db");

  const { devices, apiKeys } = await import("../db/schema.js");
  const { eq, and } = await import("drizzle-orm");
  const { verifyApiKey } = await import("../lib/auth.js");

  // Use the module-level cache above

  const normalizedDeviceId = deviceIdHeader?.trim();

  // Fast path: cached API key lookup
  const cacheEntry = apiKeyAuthCache.get(apiKey);
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    // refresh TTL
    cacheEntry.expiresAt = Date.now() + API_KEY_CACHE_TTL_MS;
    return {
      device: cacheEntry.device,
      apiKeyRecord: cacheEntry.apiKeyId
        ? { id: cacheEntry.apiKeyId }
        : undefined,
    } as any;
  }

  if (normalizedDeviceId) {
    const [specificDevice] = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.deviceId, normalizedDeviceId),
          eq(devices.isActive, true)
        )
      )
      .limit(1);

    if (
      specificDevice?.apiKey &&
      (await verifyApiKey(apiKey, specificDevice.apiKey))
    ) {
      // Cache the result for subsequent requests
      apiKeyAuthCache.set(apiKey, {
        device: specificDevice,
        expiresAt: Date.now() + API_KEY_CACHE_TTL_MS,
      });
      pruneApiKeyCache();
      return { device: specificDevice };
    }

    const [specificApiKey] = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.deviceId, normalizedDeviceId),
          eq(apiKeys.isActive, true)
        )
      )
      .limit(1);

    if (
      specificApiKey?.key &&
      (await verifyApiKey(apiKey, specificApiKey.key))
    ) {
      const [device] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, specificApiKey.deviceId))
        .limit(1);

      if (device) {
        await db
          .update(apiKeys)
          .set({ lastUsed: new Date() })
          .where(eq(apiKeys.id, specificApiKey.id));

        return { device, apiKeyRecord: specificApiKey };
      }
    }
  }

  // Attempt prefix-based lookup to avoid full scans
  const prefixParts = apiKey.split("_");
  let prefixCandidate: string | null = null;
  if (prefixParts.length >= 2) {
    prefixCandidate = `${prefixParts[0]}_${prefixParts[1]}`;
  }

  if (prefixCandidate) {
    const keysForPrefix = await db
      .select()
      .from(apiKeys)
      .where(
        and(eq(apiKeys.prefix, prefixCandidate), eq(apiKeys.isActive, true))
      );

    for (const k of keysForPrefix) {
      if (await verifyApiKey(apiKey, k.key)) {
        const [device] = await db
          .select()
          .from(devices)
          .where(eq(devices.deviceId, k.deviceId))
          .limit(1);

        await db
          .update(apiKeys)
          .set({ lastUsed: new Date() })
          .where(eq(apiKeys.id, k.id));

        if (device) {
          apiKeyAuthCache.set(apiKey, {
            device,
            apiKeyId: k.id,
            expiresAt: Date.now() + API_KEY_CACHE_TTL_MS,
          });
          pruneApiKeyCache();
          return { device, apiKeyRecord: k };
        }

        return { device: { deviceId: k.deviceId }, apiKeyRecord: k };
      }
    }
  }

  const activeDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.isActive, true));

  if (activeDevices.length > 100 && !normalizedDeviceId && !prefixCandidate) {
    console.warn(
      `Large active device count (${activeDevices.length}) without X-Device-Id or prefix; consider including X-Device-Id to optimize auth`
    );
  }

  let scanAttempts = 0;

  for (const device of activeDevices) {
    scanAttempts++;
    if (scanAttempts > API_KEY_SCAN_ATTEMPT_LIMIT) {
      console.warn(`API key scan attempt limit reached: ${scanAttempts}`);
      break;
    }
    if (await verifyApiKey(apiKey, device.apiKey)) {
      // Cache the result for subsequent requests
      apiKeyAuthCache.set(apiKey, {
        device,
        expiresAt: Date.now() + API_KEY_CACHE_TTL_MS,
      });
      pruneApiKeyCache();
      return { device };
    }
  }

  const activeApiKeys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.isActive, true));

  for (const apiKeyRecord of activeApiKeys) {
    scanAttempts++;
    if (scanAttempts > API_KEY_SCAN_ATTEMPT_LIMIT) {
      console.warn(`API key scan attempt limit reached: ${scanAttempts}`);
      break;
    }
    if (await verifyApiKey(apiKey, apiKeyRecord.key)) {
      const [device] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, apiKeyRecord.deviceId))
        .limit(1);

      await db
        .update(apiKeys)
        .set({ lastUsed: new Date() })
        .where(eq(apiKeys.id, apiKeyRecord.id));

      if (device) {
        return { device, apiKeyRecord };
      }

      return {
        device: {
          deviceId: apiKeyRecord.deviceId,
        },
        apiKeyRecord,
      };
    }
  }

  return null;
}

async function tryAuthenticateDevice(c: Context): Promise<AuthResult> {
  const apiKeyHeader = c.req.header("X-API-Key");
  const deviceIdHeader = c.req.header("X-Device-Id");

  if (!apiKeyHeader) {
    return { authorized: false };
  }

  try {
    const match = await authenticateDeviceWithApiKey(
      c,
      apiKeyHeader,
      deviceIdHeader
    );

    if (!match) {
      return { authorized: false, status: 401, message: "Invalid API key" };
    }

    c.set("device", match.device);
    if (match.apiKeyRecord) {
      c.set("apiKey", match.apiKeyRecord);
    }

    return { authorized: true };
  } catch (error) {
    console.error("Device auth error:", error);
    return { authorized: false, status: 401, message: "Authentication failed" };
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const userResult = await tryAuthenticateUser(c);

  if (userResult.authorized) {
    await next();
    return;
  }

  const status = (userResult.status ?? 401) as StatusCode;
  const message = userResult.message ?? "No token provided";

  return c.json({ success: false, message }, status as any);
}

export async function deviceAuthMiddleware(c: Context, next: Next) {
  const deviceResult = await tryAuthenticateDevice(c);

  if (deviceResult.authorized) {
    await next();
    return;
  }

  const status = (deviceResult.status ?? 401) as StatusCode;
  const message = deviceResult.message
    ? deviceResult.message
    : c.req.header("X-API-Key")
    ? "Invalid API key"
    : "No API key provided";

  return c.json({ success: false, message }, status as any);
}

export async function authOrDeviceMiddleware(c: Context, next: Next) {
  const userResult = await tryAuthenticateUser(c);

  if (userResult.authorized) {
    await next();
    return;
  }

  if (userResult.status) {
    const status = (userResult.status ?? 401) as StatusCode;
    return c.json(
      {
        success: false,
        message: userResult.message ?? "Invalid credentials",
      },
      status as any
    );
  }

  const deviceResult = await tryAuthenticateDevice(c);

  if (deviceResult.authorized) {
    await next();
    return;
  }

  const status = (deviceResult.status ?? 401) as StatusCode;
  const message = deviceResult.message
    ? deviceResult.message
    : c.req.header("X-API-Key")
    ? "Invalid API key"
    : "No token or API key provided";

  return c.json({ success: false, message }, status as any);
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");

    if (!user || !roles.includes(user.role)) {
      return c.json(
        { success: false, message: "Insufficient permissions" },
        403
      );
    }

    await next();
  };
}
