import { Hono } from "hono";
import {
  deviceAuthMiddleware,
  authMiddleware,
  authOrDeviceMiddleware,
  requireRole,
} from "../middleware/auth.js";
import {
  rfids,
  rfidScans,
  users,
  NewRfidScan,
  type Device,
} from "../db/schema.js";
import { eq, desc, and, isNull, sql, or, inArray } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { resolveCascadeSnapshot } from "../lib/queueSnapshot.js";
import {
  archiveOldScans,
  getArchiveStats,
  cleanupOldArchives,
} from "../db/archive.js";

type Env = {
  Bindings: {
    DATABASE_URL: string;
    JWT_SECRET: string;
    SESSION_SECRET: string;
  };
  Variables: {
    db: Database;
    device?: Device;
    user?: any;
  };
};

const app = new Hono<Env>();

const RFID_EVENT_TYPES = ["entry", "unknown", "ongoing", "completed"] as const;

type RfidEventType = (typeof RFID_EVENT_TYPES)[number];

const isValidEventType = (value: unknown): value is RfidEventType => {
  return (
    typeof value === "string" &&
    RFID_EVENT_TYPES.includes(value as RfidEventType)
  );
};

const normalizeTagId = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
};

const matchNormalizedTag = (column: any, normalizedTagId: string) =>
  sql`upper(${column}) = ${normalizedTagId}`;

const matchAnyNormalizedTags = (column: any, normalizedTags: string[]) => {
  const values = normalizedTags
    .map((tag) => tag.trim().toUpperCase())
    .filter((tag) => tag.length > 0);

  if (values.length === 0) {
    return undefined;
  }

  return sql`upper(${column}) IN (${sql.join(
    values.map((tag) => sql`${tag}`),
    sql`, `
  )})`;
};

const padUnitCandidate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const v = value.trim();
  if (/^[1-9]{1}$/.test(v)) {
    return `0${v}`;
  }
  return v.length ? v : null;
};

const normalizeUnitCandidate = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const stringValue = typeof value === "string" ? value : String(value);
  const trimmed = stringValue.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toUpperCase();
};

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const MAX_WEEKLY_DAYS = 7;
const MAX_MONTHLY_BUCKETS = 6;
const DEFAULT_HISTORY_RANGE_DAYS = 7;
const MAX_HISTORY_RANGE_DAYS = 31;
const MAX_HISTORY_PAGE = 200;
const DEFAULT_HISTORY_LIMIT = 500;
const MAX_HISTORY_LIMIT = 2000;

type DailyScanRow = {
  date: string;
  total: number;
  success: number;
  failed: number;
  unauthorized: number;
};

type MonthlyScanRow = {
  month: string;
  total: number;
  success: number;
  failed: number;
  unauthorized: number;
};

const toUtcStartOfDay = (input: Date): Date => {
  const date = new Date(input);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const toUtcStartOfMonth = (input: Date): Date => {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1));
};

const addUtcDays = (input: Date, days: number): Date => {
  const date = new Date(input);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

const addUtcMonths = (input: Date, months: number): Date => {
  const year = input.getUTCFullYear();
  const month = input.getUTCMonth();
  const resultMonth = month + months;
  return new Date(Date.UTC(year, resultMonth, 1));
};

const formatIsoDate = (input: Date): string => {
  return input.toISOString().slice(0, 10);
};

const formatIsoMonth = (input: Date): string => {
  return input.toISOString().slice(0, 7);
};

const getCachedTagRecord = (tagId: string): CachedTagRecord | undefined => {
  return getCachedValue(tagLookupCache, tagId);
};

const setCachedTagRecord = (tagId: string, record: CachedTagRecord) => {
  setCachedValue(
    tagLookupCache,
    tagId,
    record,
    TAG_CACHE_TTL_MS,
    TAG_CACHE_MAX_ENTRIES
  );
};

const fetchRfidTagRecord = async (
  db: Database,
  normalizedTagId: string
): Promise<CachedTagRecord> => {
  const cached = getCachedTagRecord(normalizedTagId);
  if (cached !== undefined) {
    return cached;
  }

  const [rfidTag] = await db
    .select()
    .from(rfids)
    .leftJoin(users, eq(rfids.userId, users.id))
    .where(matchNormalizedTag(rfids.tagId, normalizedTagId))
    .limit(1);

  if (!rfidTag || !rfidTag.Rfids) {
    setCachedTagRecord(normalizedTagId, null);
    return null;
  }

  const record: CachedTagRecord = {
    rfid: rfidTag.Rfids,
    user: rfidTag.Users ?? null,
  };
  setCachedTagRecord(normalizedTagId, record);
  return record;
};

const getCachedStats = <T extends DailyScanRow[] | MonthlyScanRow[]>(
  key: string
): T | undefined => {
  return getCachedValue(statsCache, key) as T | undefined;
};

const setCachedStats = (
  key: string,
  value: DailyScanRow[] | MonthlyScanRow[]
) => {
  setCachedValue(statsCache, key, value, STATS_CACHE_TTL_MS, 8);
};

const getCachedDashboardStats = (
  key: string
): DashboardStatsData | undefined => {
  return getCachedValue(dashboardCache, key) as DashboardStatsData | undefined;
};

const setCachedDashboardStats = (key: string, value: DashboardStatsData) => {
  setCachedValue(dashboardCache, key, value, DASHBOARD_CACHE_TTL_MS, 2);
};

const getWeeklyStats = async (
  db: Database,
  days: number
): Promise<DailyScanRow[]> => {
  const cacheKey = `weekly:${days}`;
  const cached = getCachedStats<DailyScanRow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const stats = await fetchRollingDailyScanStats(db, days);
  setCachedStats(cacheKey, stats);
  return stats;
};

const getMonthlyStats = async (
  db: Database,
  months: number
): Promise<MonthlyScanRow[]> => {
  const cacheKey = `monthly:${months}`;
  const cached = getCachedStats<MonthlyScanRow[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const stats = await fetchRollingMonthlyScanStats(db, months);
  setCachedStats(cacheKey, stats);
  return stats;
};

type RfidRecord = typeof rfids.$inferSelect;
type UserRecord = typeof users.$inferSelect;
type CachedTagRecord = { rfid: RfidRecord; user: UserRecord | null } | null;
type CacheEntry<T> = { value: T; expiresAt: number };

type DashboardStatsData = {
  scans: {
    today: {
      total: number;
      success: number;
      failed: number;
      unauthorized: number;
    };
    yesterday: { total: number };
    rollingSevenDays: { total: number; success: number };
    monthToDate: { total: number; success: number };
    weeklyBuckets: DailyScanRow[];
    monthlyBuckets: MonthlyScanRow[];
  };
  cards: { total: number; createdThisMonth: number };
  devices: {
    total: number;
    active: number;
    online: number;
    registrationModeEnabled: number;
  };
  users: {
    total: number;
    createdThisMonth: number;
    drivers: number;
    admins: number;
    superadmins: number;
  };
};

const TAG_CACHE_TTL_MS = 60_000;
const TAG_CACHE_MAX_ENTRIES = 500;
const STATS_CACHE_TTL_MS = 60_000;
const DASHBOARD_CACHE_TTL_MS = 30_000; // 30 seconds for dashboard data
const HISTORY_COUNT_CACHE_TTL_MS = 30_000;
const DRIVER_TAG_CACHE_TTL_MS = 60_000;
const DRIVER_TAG_CACHE_MAX_ENTRIES = 500;

const tagLookupCache = new Map<string, CacheEntry<CachedTagRecord>>();
const statsCache = new Map<
  string,
  CacheEntry<DailyScanRow[] | MonthlyScanRow[]>
>();
const dashboardCache = new Map<string, CacheEntry<DashboardStatsData>>();
const historyCountCache = new Map<string, CacheEntry<number>>();
const driverTagCache = new Map<string, CacheEntry<string[]>>();

const pruneCache = <T>(
  cache: Map<string, CacheEntry<T>>,
  maxEntries: number
) => {
  if (cache.size <= maxEntries) {
    return;
  }

  const iterator = cache.keys();
  while (cache.size > maxEntries) {
    const oldestKey = iterator.next().value;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
};

const getCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string
): T | undefined => {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

const setCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number
) => {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  pruneCache(cache, maxEntries);
};

const fetchRollingDailyScanStats = async (
  db: Database,
  days: number
): Promise<DailyScanRow[]> => {
  const cappedDays = Math.max(1, Math.min(days, MAX_WEEKLY_DAYS));
  const todayStart = toUtcStartOfDay(new Date());
  const windowStart = addUtcDays(todayStart, -(cappedDays - 1));

  const result = await db.execute(sql`
    SELECT
      to_char(date_trunc('day', "scanTime"), 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE "status" = 'success')::int AS success,
      COUNT(*) FILTER (WHERE "status" = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE "status" = 'unauthorized')::int AS unauthorized
    FROM "RfidScans"
    WHERE "scanTime" >= ${windowStart}
    GROUP BY 1
    ORDER BY 1
  `);

  const rows = (result.rows as DailyScanRow[]) || [];
  const mapped = new Map<string, DailyScanRow>();
  rows.forEach((row) => mapped.set(row.date, row));

  const filled: DailyScanRow[] = [];
  for (let i = 0; i < cappedDays; i++) {
    const date = addUtcDays(windowStart, i);
    const key = formatIsoDate(date);
    filled.push(
      mapped.get(key) ?? {
        date: key,
        total: 0,
        success: 0,
        failed: 0,
        unauthorized: 0,
      }
    );
  }

  return filled;
};

const fetchRollingMonthlyScanStats = async (
  db: Database,
  months: number
): Promise<MonthlyScanRow[]> => {
  const cappedMonths = Math.max(1, Math.min(months, MAX_MONTHLY_BUCKETS));
  const currentMonthStart = toUtcStartOfMonth(new Date());
  const windowStart = addUtcMonths(currentMonthStart, -(cappedMonths - 1));

  const result = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', "scanTime"), 'YYYY-MM') AS month,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE "status" = 'success')::int AS success,
      COUNT(*) FILTER (WHERE "status" = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE "status" = 'unauthorized')::int AS unauthorized
    FROM "RfidScans"
    WHERE "scanTime" >= ${windowStart}
    GROUP BY 1
    ORDER BY 1
  `);

  const rows = (result.rows as MonthlyScanRow[]) || [];
  const mapped = new Map<string, MonthlyScanRow>();
  rows.forEach((row) => mapped.set(row.month, row));

  const filled: MonthlyScanRow[] = [];
  for (let i = 0; i < cappedMonths; i++) {
    const monthDate = addUtcMonths(windowStart, i);
    const key = formatIsoMonth(monthDate);
    filled.push(
      mapped.get(key) ?? {
        month: key,
        total: 0,
        success: 0,
        failed: 0,
        unauthorized: 0,
      }
    );
  }

  return filled;
};

const fetchUnregisteredTags = async (db: Database, limit: number) => {
  const constrainedLimit = Math.max(1, Math.min(limit, 200));

  const result = await db.execute(sql`
    WITH failed_scans AS (
      SELECT
        "id",
        UPPER("rfidTagId") AS normalized_tag,
        "rfidTagId",
        "deviceId",
        "location",
        "scanTime",
        COUNT(*) OVER (PARTITION BY UPPER("rfidTagId")) AS scan_count,
        ROW_NUMBER() OVER (PARTITION BY UPPER("rfidTagId") ORDER BY "scanTime" DESC) AS rn
      FROM "RfidScans"
      WHERE "status" = 'failed' AND "userId" IS NULL
    ),
    latest_failed AS (
      SELECT
        normalized_tag,
        "rfidTagId",
        "deviceId",
        "location",
        "scanTime" AS last_seen,
        scan_count
      FROM failed_scans
      WHERE rn = 1
      ORDER BY last_seen DESC
      LIMIT ${constrainedLimit * 3}
    )
    SELECT
      lf.normalized_tag AS tag,
      lf.rfidTagId AS display_tag,
      lf.deviceId AS device_id,
      lf.location,
      lf.last_seen,
      lf.scan_count
    FROM latest_failed lf
    LEFT JOIN "Rfids" r ON UPPER(r."tagId") = lf.normalized_tag
    WHERE r."id" IS NULL
    ORDER BY lf.last_seen DESC
    LIMIT ${constrainedLimit};
  `);

  const rows =
    (result.rows as Array<{
      tag: string;
      display_tag: string;
      device_id: string | null;
      location: string | null;
      last_seen: string;
      scan_count: number;
    }>) ?? [];

  const unregisteredTags = rows.map((row) => ({
    id: `${row.tag}-${row.last_seen}`,
    tagId: row.tag,
    lastSeen: new Date(row.last_seen),
    deviceId: row.device_id,
    location: row.location,
    scanCount: row.scan_count,
  }));

  return {
    unregisteredTags,
    total: unregisteredTags.length,
    scansChecked: rows.length,
  };
};

// POST /api/rfid/scan - Handle RFID scan from ESP32 device
app.post("/scan", deviceAuthMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const device = c.get("device");

    if (!device) {
      return c.json(
        {
          success: false,
          message: "Device not authenticated",
        },
        401
      );
    }

    const { tagId, location, unitNumber, vehicleId, eventType } =
      await c.req.json();
    const normalizedTagId = normalizeTagId(tagId);
    const payloadUnitNumber = padUnitCandidate(
      normalizeUnitCandidate(unitNumber) ?? normalizeUnitCandidate(vehicleId)
    );

    if (!normalizedTagId) {
      return c.json(
        {
          success: false,
          message: "Missing required field: tagId is required",
        },
        400
      );
    }

    console.log(
      `RFID scan attempt: ${normalizedTagId} from device ${device.deviceId}`
    );

    // Check if RFID exists and is active (cached)
    const cachedTagRecord = await fetchRfidTagRecord(db, normalizedTagId);

    if (!cachedTagRecord) {
      console.warn(`Unregistered RFID: ${normalizedTagId}`);

      // Record failed scan attempt
      const failedScan: NewRfidScan = {
        rfidTagId: normalizedTagId,
        rfidId: null,
        deviceId: device.deviceId,
        location: location || null,
        unitNumber: payloadUnitNumber,
        status: "failed",
        eventType: "unknown",
        metadata: { reason: "Tag not registered" },
      };

      await db.insert(rfidScans).values(failedScan);

      return c.json(
        {
          success: false,
          message: "RFID tag not registered",
          data: { tagId: normalizedTagId, registered: false },
        },
        404
      );
    }

    const { rfid, user } = cachedTagRecord;
    const rfidMetadata = (rfid.metadata ?? {}) as Record<string, unknown>;
    const cardUnitNumber =
      [
        rfid.unitNumber,
        rfidMetadata["unitNumber"],
        rfidMetadata["unit"],
        rfidMetadata["vehicleNumber"],
        rfidMetadata["vehicleId"],
      ]
        .map((candidate) => normalizeUnitCandidate(candidate))
        .find((value): value is string => Boolean(value)) ?? null;
    const resolvedUnitNumber = padUnitCandidate(
      payloadUnitNumber ?? cardUnitNumber
    );

    // Check if RFID is active
    if (!rfid.isActive) {
      const inactiveScan: NewRfidScan = {
        rfidTagId: normalizedTagId,
        rfidId: rfid.id,
        deviceId: device.deviceId,
        userId: user?.id || null,
        location: location || null,
        unitNumber: resolvedUnitNumber,
        status: "unauthorized",
        eventType: "unknown",
        metadata: { reason: "Tag is inactive" },
      };

      await db.insert(rfidScans).values(inactiveScan);

      return c.json(
        {
          success: false,
          message: "RFID tag is inactive",
          data: { tagId: normalizedTagId, active: false },
        },
        403
      );
    }

    // Check if user is active (if associated)
    if (user && !user.isActive) {
      const unauthorizedScan: NewRfidScan = {
        rfidTagId: normalizedTagId,
        rfidId: rfid.id,
        deviceId: device.deviceId,
        userId: user.id,
        location: location || null,
        unitNumber: resolvedUnitNumber,
        status: "unauthorized",
        eventType: "unknown",
        metadata: { reason: "User is inactive" },
      };

      await db.insert(rfidScans).values(unauthorizedScan);

      return c.json(
        {
          success: false,
          message: "User associated with this RFID is inactive",
          data: {
            tagId: normalizedTagId,
            userName: user.name,
            userActive: false,
          },
        },
        403
      );
    }

    // Record successful scan
    const finalEventType = isValidEventType(eventType) ? eventType : "ongoing";

    const successScan: NewRfidScan = {
      rfidTagId: normalizedTagId,
      rfidId: rfid.id,
      deviceId: device.deviceId,
      userId: user?.id || null,
      location: location || null,
      unitNumber: resolvedUnitNumber,
      status: "success",
      eventType: finalEventType as any,
      metadata: {},
    };

    const [scan] = await db.insert(rfidScans).values(successScan).returning();

    // Update RFID last scanned
    await db
      .update(rfids)
      .set({
        lastScanned: new Date(),
        deviceId: device.deviceId,
      })
      .where(matchNormalizedTag(rfids.tagId, normalizedTagId));

    return c.json({
      success: true,
      message: "Scan recorded successfully",
      data: {
        scan: {
          id: scan.id,
          tagId: normalizedTagId,
          scanTime: scan.scanTime,
          status: scan.status,
          eventType: scan.eventType,
        },
        user: user
          ? {
              id: user.id,
              name: user.name,
              role: user.role,
            }
          : null,
        rfid: {
          tagId: normalizeTagId(rfid.tagId),
          isActive: rfid.isActive,
        },
      },
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to process scan",
        error: error.message,
      },
      500
    );
  }
});

// Batch insert RFID scans for high-throughput scenarios
const batchInsertRfidScans = async (
  db: Database,
  scans: Array<{
    tagId: string;
    deviceId: string;
    location?: string;
    unitNumber?: string;
    eventType?: RfidEventType;
    metadata?: Record<string, any>;
  }>
): Promise<Array<{ id: string; tagId: string; status: string }>> => {
  if (!scans.length) {
    return [];
  }

  // Validate all scans first
  const validatedScans = scans.map((scan) => {
    const normalizedTagId = normalizeTagId(scan.tagId);
    if (!normalizedTagId) {
      throw new Error(`Invalid RFID tag ID: ${scan.tagId}`);
    }

    if (!scan.deviceId) {
      throw new Error(`Device ID required for scan: ${normalizedTagId}`);
    }

    return {
      tagId: normalizedTagId,
      deviceId: scan.deviceId,
      location: scan.location || null,
      unitNumber: scan.unitNumber || null,
      eventType: scan.eventType || "unknown",
      metadata: scan.metadata || {},
    };
  });

  // Get RFID and user data for all tags in batch
  const tagIds = validatedScans.map((scan) => scan.tagId);
  const rfidData = await db
    .select({
      tagId: rfids.tagId,
      userId: rfids.userId,
      isActive: rfids.isActive,
      unitNumber: rfids.unitNumber,
    })
    .from(rfids)
    .where(inArray(rfids.tagId, tagIds));

  const rfidMap = new Map(
    rfidData.map((rfid) => [rfid.tagId.toUpperCase(), rfid])
  );

  // Prepare batch insert data
  const now = new Date();
  const insertData: NewRfidScan[] = validatedScans.map((scan) => {
    const rfid = rfidMap.get(scan.tagId.toUpperCase());
    const isRegistered = Boolean(rfid);
    const isActive = rfid?.isActive ?? false;
    const userId = rfid?.userId ?? null;
    const unitNumber = padUnitCandidate(rfid?.unitNumber ?? scan.unitNumber);

    let status: "success" | "failed" | "unauthorized" = "failed";
    if (isRegistered && isActive) {
      status = "success";
    } else if (isRegistered && !isActive) {
      status = "unauthorized";
    }

    return {
      rfidTagId: scan.tagId,
      deviceId: scan.deviceId,
      userId,
      location: scan.location,
      unitNumber,
      scanTime: now,
      status,
      eventType: scan.eventType,
      metadata: scan.metadata,
    };
  });

  // Batch insert all scans
  const insertedScans = await db
    .insert(rfidScans)
    .values(insertData)
    .returning({ id: rfidScans.id, rfidTagId: rfidScans.rfidTagId });

  // Update lastScanned for registered RFIDs
  const registeredTagIds = insertData
    .filter((scan) => scan.status === "success")
    .map((scan) => scan.rfidTagId);

  if (registeredTagIds.length > 0) {
    await db
      .update(rfids)
      .set({ lastScanned: now })
      .where(inArray(rfids.tagId, registeredTagIds));
  }

  // Return results with status
  return insertedScans.map((inserted) => {
    const originalScan = insertData.find(
      (scan) => scan.rfidTagId === inserted.rfidTagId
    );
    return {
      id: inserted.id,
      tagId: inserted.rfidTagId,
      status: originalScan?.status || "failed",
    };
  });
};

// POST /api/rfid/scan/batch - Batch process multiple RFID scans
app.post("/scan/batch", deviceAuthMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const device = c.get("device");
    const body = await c.req.json();

    if (!device) {
      return c.json(
        {
          success: false,
          message: "Unauthorized device request",
        },
        401
      );
    }

    if (!Array.isArray(body.scans)) {
      return c.json(
        {
          success: false,
          message: "Request body must contain 'scans' array",
        },
        400
      );
    }

    if (body.scans.length === 0) {
      return c.json(
        {
          success: false,
          message: "Scans array cannot be empty",
        },
        400
      );
    }

    if (body.scans.length > 100) {
      return c.json(
        {
          success: false,
          message: "Maximum 100 scans per batch",
        },
        400
      );
    }

    // Validate scan format
    for (let i = 0; i < body.scans.length; i++) {
      const scan = body.scans[i];
      if (!scan.tagId || typeof scan.tagId !== "string") {
        return c.json(
          {
            success: false,
            message: `Scan ${i}: tagId is required and must be a string`,
          },
          400
        );
      }
    }

    // Override deviceId with authenticated device
    const scansWithDevice = body.scans.map((scan: any) => ({
      ...scan,
      deviceId: device.deviceId,
    }));

    const results = await batchInsertRfidScans(db, scansWithDevice);

    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const unauthorizedCount = results.filter(
      (r) => r.status === "unauthorized"
    ).length;

    return c.json({
      success: true,
      message: `Processed ${results.length} RFID scans (${successCount} success, ${failedCount} failed, ${unauthorizedCount} unauthorized)`,
      data: {
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failedCount,
          unauthorized: unauthorizedCount,
        },
      },
    });
  } catch (error: any) {
    console.error("Batch scan error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to process batch scans",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/rfid - List all RFIDs (admin/superadmin only)
app.get("/", authMiddleware, requireRole("admin", "superadmin"), async (c) => {
  try {
    const db = c.get("db");
    const limitRaw = c.req.query("limit");
    const offsetRaw = c.req.query("offset") || "0";

    const parsedOffset = Number.parseInt(offsetRaw, 10);
    const sanitizedOffset = Number.isFinite(parsedOffset)
      ? Math.max(parsedOffset, 0)
      : 0;

    const requestedLimit =
      limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined;
    const sanitizedLimit =
      requestedLimit !== undefined && Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 500)
        : undefined;

    const isPaginated =
      sanitizedLimit !== undefined || (sanitizedOffset && sanitizedOffset > 0);

    let query = db
      .select({
        id: rfids.id,
        tagId: rfids.tagId,
        userId: rfids.userId,
        isActive: rfids.isActive,
        unitNumber: rfids.unitNumber,
        lastScanned: rfids.lastScanned,
        deviceId: rfids.deviceId,
        registeredBy: rfids.registeredBy,
        metadata: rfids.metadata,
        createdAt: rfids.createdAt,
        updatedAt: rfids.updatedAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
        },
      })
      .from(rfids)
      .leftJoin(users, eq(rfids.userId, users.id))
      .orderBy(desc(rfids.createdAt));

    if (sanitizedLimit !== undefined) {
      query = query.limit(sanitizedLimit) as typeof query;
    }

    if (sanitizedOffset > 0) {
      query = query.offset(sanitizedOffset) as typeof query;
    }

    const allRfids = await query;

    let totalRecords = allRfids.length;
    if (isPaginated) {
      const totalResult = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(rfids);
      totalRecords = Number(totalResult[0]?.total ?? allRfids.length);
    }

    const hasMore = isPaginated
      ? sanitizedOffset + allRfids.length < totalRecords
      : false;

    return c.json({
      success: true,
      message: `Retrieved ${allRfids.length} RFID tags`,
      data: {
        rfids: allRfids,
        total: totalRecords,
        count: allRfids.length,
        pagination: {
          limit: sanitizedLimit ?? null,
          offset: sanitizedOffset,
          hasMore,
        },
      },
    });
  } catch (error: any) {
    console.error("List RFIDs error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve RFIDs",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/rfid/:tagId - Get specific RFID by tag ID
app.get("/:tagId", authOrDeviceMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const tagIdParam = c.req.param("tagId");
    const normalizedTagId = normalizeTagId(tagIdParam);

    if (!normalizedTagId) {
      return c.json(
        {
          success: false,
          message: "Invalid RFID tag ID",
        },
        400
      );
    }

    const [rfidData] = await db
      .select({
        id: rfids.id,
        tagId: rfids.tagId,
        isActive: rfids.isActive,
        unitNumber: rfids.unitNumber,
        lastScanned: rfids.lastScanned,
        deviceId: rfids.deviceId,
        metadata: rfids.metadata,
        createdAt: rfids.createdAt,
        updatedAt: rfids.updatedAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          isActive: users.isActive,
        },
      })
      .from(rfids)
      .leftJoin(users, eq(rfids.userId, users.id))
      .where(matchNormalizedTag(rfids.tagId, normalizedTagId))
      .limit(1);

    if (!rfidData) {
      return c.json(
        {
          success: false,
          message: "RFID tag not found",
        },
        404
      );
    }

    const isDeviceRequest = Boolean(c.get("device")) && !c.get("user");

    if (isDeviceRequest) {
      const minimalUser = rfidData.user
        ? {
            id: rfidData.user.id,
            name: rfidData.user.name,
            email: rfidData.user.email,
            isActive: rfidData.user.isActive,
          }
        : null;

      return c.json({
        success: true,
        message: "RFID tag retrieved successfully",
        data: {
          rfid: {
            tagId: normalizeTagId(rfidData.tagId),
            unitNumber: rfidData.unitNumber ?? null,
            isActive: rfidData.isActive,
            user: minimalUser,
          },
        },
      });
    }

    // Get recent scans for this tag when requested by an authenticated user
    const recentScans = await db
      .select()
      .from(rfidScans)
      .where(matchNormalizedTag(rfidScans.rfidTagId, normalizedTagId))
      .orderBy(desc(rfidScans.scanTime))
      .limit(10);

    return c.json({
      success: true,
      message: "RFID tag retrieved successfully",
      data: {
        rfid: {
          ...rfidData,
          tagId: normalizeTagId(rfidData.tagId),
        },
        recentScans: recentScans,
      },
    });
  } catch (error: any) {
    console.error("Get RFID error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve RFID",
        error: error.message,
      },
      500
    );
  }
});

// POST /api/rfid/register - Register new RFID tag (admin/superadmin only)
app.post(
  "/register",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const user = c.get("user");
      const {
        tagId,
        userId,
        isActive = true,
        metadata = {},
        unitNumber,
      } = await c.req.json();

      const normalizedTagId = normalizeTagId(tagId);

      if (!normalizedTagId) {
        return c.json(
          {
            success: false,
            message: "tagId is required",
          },
          400
        );
      }

      // Check if tag already exists
      const [existingTag] = await db
        .select()
        .from(rfids)
        .where(matchNormalizedTag(rfids.tagId, normalizedTagId))
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

      // If userId provided, verify user exists
      if (userId) {
        const [userExists] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!userExists) {
          return c.json(
            {
              success: false,
              message: "User not found",
            },
            404
          );
        }
      }

      // Create new RFID
      const [newRfid] = await db
        .insert(rfids)
        .values({
          tagId: normalizedTagId,
          userId: userId || null,
          isActive,
          registeredBy: user.id,
          metadata,
          unitNumber:
            unitNumber ?? (metadata?.unitNumber as string | undefined) ?? null,
        })
        .returning();

      return c.json(
        {
          success: true,
          message: "RFID tag registered successfully",
          data: {
            rfid: {
              ...newRfid,
              tagId: normalizedTagId,
            },
          },
        },
        201
      );
    } catch (error: any) {
      console.error("Register RFID error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to register RFID",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/rfid/check-recent-scan/:tagId - Verify a tag was scanned recently during registration
app.get(
  "/check-recent-scan/:tagId",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const tagIdParam = c.req.param("tagId");
      const normalizedTagId = normalizeTagId(tagIdParam);

      if (!normalizedTagId) {
        return c.json(
          {
            success: false,
            message: "Invalid RFID tag ID",
          },
          400
        );
      }

      const lookbackWindowMs = 2 * 60 * 1000; // two minutes
      const since = new Date(Date.now() - lookbackWindowMs);

      const [recentScan] = await db
        .select({
          id: rfidScans.id,
          deviceId: rfidScans.deviceId,
          status: rfidScans.status,
          scanTime: rfidScans.scanTime,
          metadata: rfidScans.metadata,
        })
        .from(rfidScans)
        .where(
          and(
            eq(rfidScans.status, "failed"),
            matchNormalizedTag(rfidScans.rfidTagId, normalizedTagId),
            sql`${rfidScans.scanTime} >= ${since}`
          )
        )
        .orderBy(desc(rfidScans.scanTime))
        .limit(1);

      if (!recentScan) {
        return c.json({
          success: true,
          data: {
            found: false,
            scan: null,
          },
        });
      }

      return c.json({
        success: true,
        data: {
          found: true,
          scan: {
            ...recentScan,
            tagId: normalizedTagId,
          },
        },
      });
    } catch (error: any) {
      console.error("Check recent scan error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to verify recent scan",
          error: error.message,
        },
        500
      );
    }
  }
);

// PUT /api/rfid/:tagId - Update RFID tag (admin/superadmin only)
app.put(
  "/:tagId",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const tagIdParam = c.req.param("tagId");
      const normalizedTagId = normalizeTagId(tagIdParam);
      const body = await c.req.json();
      const { userId, isActive, metadata, unitNumber } = body as {
        userId?: number | null;
        isActive?: boolean;
        metadata?: Record<string, any>;
        unitNumber?: string | null;
      };
      const unitNumberFromBody = unitNumber as string | undefined;
      const unitNumberFromMetadata =
        (metadata?.unitNumber as string | undefined) ?? undefined;

      if (!normalizedTagId) {
        return c.json(
          {
            success: false,
            message: "Invalid RFID tag ID",
          },
          400
        );
      }

      // Check if RFID exists
      const [existingRfid] = await db
        .select()
        .from(rfids)
        .where(matchNormalizedTag(rfids.tagId, normalizedTagId))
        .limit(1);

      if (!existingRfid) {
        return c.json(
          {
            success: false,
            message: "RFID tag not found",
          },
          404
        );
      }

      // If userId is being updated, verify user exists
      if (userId !== undefined) {
        if (userId !== null) {
          const [userExists] = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          if (!userExists) {
            return c.json(
              {
                success: false,
                message: "User not found",
              },
              404
            );
          }
        }
      }

      // Build update object
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (userId !== undefined) updateData.userId = userId;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (metadata !== undefined) updateData.metadata = metadata;
      if (unitNumberFromBody !== undefined)
        updateData.unitNumber = padUnitCandidate(unitNumberFromBody) || null;
      else if (unitNumberFromMetadata !== undefined)
        updateData.unitNumber =
          padUnitCandidate(unitNumberFromMetadata) || null;

      // Update RFID
      const [updatedRfid] = await db
        .update(rfids)
        .set(updateData)
        .where(matchNormalizedTag(rfids.tagId, normalizedTagId))
        .returning();

      return c.json({
        success: true,
        message: "RFID tag updated successfully",
        data: {
          rfid: {
            ...updatedRfid,
            tagId: normalizeTagId(updatedRfid.tagId),
          },
        },
      });
    } catch (error: any) {
      console.error("Update RFID error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to update RFID",
          error: error.message,
        },
        500
      );
    }
  }
);

// DELETE /api/rfid/:tagId - Delete RFID tag (superadmin only)
app.delete("/:tagId", authMiddleware, requireRole("superadmin"), async (c) => {
  try {
    const db = c.get("db");
    const tagIdParam = c.req.param("tagId");
    const normalizedTagId = normalizeTagId(tagIdParam);

    if (!normalizedTagId) {
      return c.json(
        {
          success: false,
          message: "Invalid RFID tag ID",
        },
        400
      );
    }

    // Check if RFID exists
    const [existingRfid] = await db
      .select()
      .from(rfids)
      .where(matchNormalizedTag(rfids.tagId, normalizedTagId))
      .limit(1);

    if (!existingRfid) {
      return c.json(
        {
          success: false,
          message: "RFID tag not found",
        },
        404
      );
    }

    // Delete RFID (scans will remain for audit trail)
    await db
      .delete(rfids)
      .where(matchNormalizedTag(rfids.tagId, normalizedTagId));

    return c.json({
      success: true,
      message: "RFID tag deleted successfully",
      data: {
        deletedTagId: normalizedTagId,
      },
    });
  } catch (error: any) {
    console.error("Delete RFID error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to delete RFID",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/rfid/unregistered/recent - Get recent unregistered scans (admin/superadmin only)
app.get(
  "/unregistered/recent",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const limitParam = Number.parseInt(c.req.query("limit") || "50", 10);
      const sinceMinutesParam = Number.parseInt(
        c.req.query("sinceMinutes") || "4320",
        10
      ); // default 72 hours

      const sanitizedLimit = Math.min(
        Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1),
        200
      );

      const sanitizedWindowMinutes = Math.min(
        Math.max(
          Number.isFinite(sinceMinutesParam) ? sinceMinutesParam : 4320,
          5
        ),
        43200
      ); // cap at 30 days

      const windowStart = new Date(
        Date.now() - sanitizedWindowMinutes * 60 * 1000
      );

      // Aggregate in SQL to avoid per-tag lookups that time out under load
      const result = await db.execute(
        sql`
          with aggregated as (
            select
              upper(${rfidScans.rfidTagId}) as "tagId",
              max(${rfidScans.scanTime}) as "lastSeen",
              count(*)::int as "scanCount",
              (array_agg(${rfidScans.id} order by ${rfidScans.scanTime} desc))[1] as "id",
              (array_agg(${rfidScans.deviceId} order by ${rfidScans.scanTime} desc))[1] as "deviceId",
              (array_agg(${rfidScans.location} order by ${rfidScans.scanTime} desc))[1] as "location"
            from ${rfidScans}
            where ${rfidScans.status} = 'failed'
              and ${rfidScans.userId} is null
              and ${rfidScans.scanTime} >= ${windowStart}
            group by upper(${rfidScans.rfidTagId})
          )
          select
            a."id",
            a."tagId",
            a."lastSeen",
            a."scanCount",
            a."deviceId",
            a."location"
          from aggregated a
          left join ${rfids} on upper(${rfids.tagId}) = a."tagId"
          where ${rfids.id} is null
          order by a."lastSeen" desc
          limit ${sanitizedLimit}
        `
      );

      const rows = result.rows as Array<{
        id: string | null;
        tagId: string | null;
        lastSeen: Date | string | null;
        scanCount: number | null;
        deviceId: string | null;
        location: string | null;
      }>;

      let unregisteredTags = rows
        .filter((row) => row.tagId)
        .map((row) => ({
          id: row.id ?? null,
          tagId: normalizeTagId(row.tagId),
          lastSeen:
            row.lastSeen instanceof Date
              ? row.lastSeen
              : row.lastSeen
              ? new Date(row.lastSeen)
              : null,
          deviceId: row.deviceId,
          location: row.location,
          scanCount: Number(row.scanCount ?? 0),
        }));

      // Fallback to legacy helper if the optimized query returned no rows
      if (unregisteredTags.length === 0) {
        const fallback = await fetchUnregisteredTags(db, sanitizedLimit * 2);

        unregisteredTags = fallback.unregisteredTags.filter((tag) => {
          if (!tag.lastSeen) {
            return false;
          }
          return tag.lastSeen >= windowStart;
        });

        // Ensure newest first, limited to requested size
        unregisteredTags.sort((a, b) => {
          const aTime = a.lastSeen ? a.lastSeen.getTime() : 0;
          const bTime = b.lastSeen ? b.lastSeen.getTime() : 0;
          return bTime - aTime;
        });

        unregisteredTags = unregisteredTags.slice(0, sanitizedLimit);
      }

      const scansChecked = unregisteredTags.reduce(
        (sum, tag) =>
          sum + (Number.isFinite(tag.scanCount) ? tag.scanCount : 0),
        0
      );

      return c.json({
        success: true,
        message: `Retrieved ${unregisteredTags.length} unregistered RFID tags`,
        data: {
          unregisteredTags,
          total: unregisteredTags.length,
          scansChecked,
          windowMinutes: sanitizedWindowMinutes,
        },
      });
    } catch (error: any) {
      console.error("Get unregistered scans error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve unregistered scans",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/rfid/scans/unregistered - Legacy alias for unregistered scans list
app.get(
  "/scans/unregistered",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const limit = parseInt(c.req.query("limit") || "50");

      const { unregisteredTags, total, scansChecked } =
        await fetchUnregisteredTags(db, limit);

      return c.json({
        success: true,
        message: `Retrieved ${total} unregistered RFID tags`,
        data: {
          unregisteredTags,
          total,
          scansChecked,
        },
      });
    } catch (error: any) {
      console.error("Get unregistered scans error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve unregistered scans",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/rfid/scans/recent - Retrieve recent RFID scans
app.get(
  "/scans/recent",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const limit = Math.min(
        Math.max(parseInt(c.req.query("limit") || "25", 10), 1),
        200
      );

      const scans = await db
        .select({
          id: rfidScans.id,
          rfidTagId: rfidScans.rfidTagId,
          deviceId: rfidScans.deviceId,
          userId: rfidScans.userId,
          location: rfidScans.location,
          unitNumber: rfidScans.unitNumber,
          scanTime: rfidScans.scanTime,
          status: rfidScans.status,
          eventType: rfidScans.eventType,
          metadata: rfidScans.metadata,
          userName: users.name,
          userRole: users.role,
          userActive: users.isActive,
        })
        .from(rfidScans)
        .leftJoin(users, eq(rfidScans.userId, users.id))
        .orderBy(desc(rfidScans.scanTime))
        .limit(limit);

      const normalizedScans = scans.map((scan) => ({
        id: scan.id,
        rfidTagId: normalizeTagId(scan.rfidTagId),
        deviceId: scan.deviceId,
        userId: scan.userId,
        location: scan.location,
        unitNumber: scan.unitNumber,
        scanTime: scan.scanTime,
        status: scan.status,
        eventType: scan.eventType,
        metadata: scan.metadata ?? {},
        user: scan.userId
          ? {
              id: scan.userId,
              name: scan.userName,
              role: scan.userRole,
              isActive: scan.userActive,
            }
          : null,
      }));

      return c.json({
        success: true,
        message: `Retrieved ${normalizedScans.length} RFID scans`,
        data: {
          scans: normalizedScans,
        },
      });
    } catch (error: any) {
      console.error("Get recent RFID scans error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve recent scans",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/rfid/scans/recent/public - Driver-safe queue snapshot without PII
app.get("/scans/recent/public", authMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const limit = Math.min(
      Math.max(parseInt(c.req.query("limit") || "25", 10), 1),
      200
    );

    const scans = await db
      .select({
        id: rfidScans.id,
        rfidTagId: rfidScans.rfidTagId,
        deviceId: rfidScans.deviceId,
        location: rfidScans.location,
        unitNumber: rfidScans.unitNumber,
        scanTime: rfidScans.scanTime,
        status: rfidScans.status,
        eventType: rfidScans.eventType,
        metadata: rfidScans.metadata,
      })
      .from(rfidScans)
      .orderBy(desc(rfidScans.scanTime))
      .limit(limit);

    const normalizedScans = scans.map((scan) => ({
      id: scan.id,
      rfidTagId: normalizeTagId(scan.rfidTagId),
      deviceId: scan.deviceId,
      userId: null,
      location: scan.location,
      unitNumber: scan.unitNumber,
      scanTime: scan.scanTime,
      status: scan.status,
      eventType: scan.eventType,
      metadata: scan.metadata ?? {},
      user: null,
    }));

    return c.json({
      success: true,
      message: `Retrieved ${normalizedScans.length} RFID scans`,
      data: {
        scans: normalizedScans,
      },
    });
  } catch (error: any) {
    console.error("Get public recent RFID scans error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve public recent scans",
        error: error.message,
      },
      500
    );
  }
});

app.get("/queue/cascade", authMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const limitParam = Number.parseInt(c.req.query("limit") || "40", 10);
    const requestedDeviceId = c.req.query("deviceId") || undefined;
    const snapshot = await resolveCascadeSnapshot(db, limitParam, {
      deviceId: requestedDeviceId,
    });

    return c.json({
      success: true,
      message: "LED cascade snapshot ready",
      data: snapshot,
    });
  } catch (error: any) {
    console.error("Get LED cascade snapshot error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve LED cascade snapshot",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/rfid/scans/history - Retrieve scans within a date range for reporting
app.get(
  "/scans/history",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const startParam = c.req.query("startDate");
      const endParam = c.req.query("endDate");
      const eventTypeParam = c.req.query("eventType");
      const includeCountParam = c.req.query("includeCount");
      const limitParam = Number.parseInt(
        c.req.query("limit") || `${DEFAULT_HISTORY_LIMIT}`,
        10
      );
      const pageParam = Number.parseInt(c.req.query("page") || "1", 10);

      const now = new Date();
      const defaultEndInclusive = addUtcDays(toUtcStartOfDay(now), 1);
      const defaultStart = addUtcDays(
        defaultEndInclusive,
        -DEFAULT_HISTORY_RANGE_DAYS
      );

      const parsedStart = startParam ? new Date(startParam) : defaultStart;
      const parsedEnd = endParam ? new Date(endParam) : defaultEndInclusive;

      if (
        Number.isNaN(parsedStart.getTime()) ||
        Number.isNaN(parsedEnd.getTime())
      ) {
        return c.json(
          {
            success: false,
            message: "Invalid startDate or endDate parameter",
          },
          400
        );
      }

      const rangeStart = toUtcStartOfDay(parsedStart);
      const rangeEndExclusive = addUtcDays(toUtcStartOfDay(parsedEnd), 1);

      if (rangeEndExclusive <= rangeStart) {
        return c.json(
          {
            success: false,
            message: "endDate must be after startDate",
          },
          400
        );
      }

      const rangeDays = Math.ceil(
        (rangeEndExclusive.getTime() - rangeStart.getTime()) /
          (24 * 60 * 60 * 1000)
      );

      if (rangeDays > MAX_HISTORY_RANGE_DAYS) {
        return c.json(
          {
            success: false,
            message: `Date range cannot exceed ${MAX_HISTORY_RANGE_DAYS} days`,
          },
          400
        );
      }

      let eventTypeFilter: RfidEventType | undefined;
      if (eventTypeParam) {
        if (!isValidEventType(eventTypeParam)) {
          return c.json(
            {
              success: false,
              message: "Invalid eventType filter",
            },
            400
          );
        }
        eventTypeFilter = eventTypeParam;
      }

      const sanitizedLimit = Math.min(
        Math.max(
          Number.isFinite(limitParam) ? limitParam : DEFAULT_HISTORY_LIMIT,
          1
        ),
        MAX_HISTORY_LIMIT
      );
      const sanitizedPage = Math.max(
        Number.isFinite(pageParam) ? pageParam : 1,
        1
      );
      const constrainedPage = Math.min(sanitizedPage, MAX_HISTORY_PAGE);
      const offset = (constrainedPage - 1) * sanitizedLimit;
      const shouldIncludeCount = includeCountParam === "true";

      const filters = [
        sql`${rfidScans.scanTime} >= ${rangeStart}`,
        sql`${rfidScans.scanTime} < ${rangeEndExclusive}`,
      ];

      if (eventTypeFilter) {
        filters.push(eq(rfidScans.eventType, eventTypeFilter));
      }

      let totalScans: number | undefined;
      if (shouldIncludeCount) {
        const countCacheKey = [
          "history",
          rangeStart.toISOString(),
          rangeEndExclusive.toISOString(),
          eventTypeFilter ?? "all",
        ].join(":");

        totalScans = getCachedValue(historyCountCache, countCacheKey);
        if (totalScans === undefined) {
          const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(rfidScans)
            .where(and(...filters));

          totalScans = Number(countResult[0]?.count ?? 0);
          setCachedValue(
            historyCountCache,
            countCacheKey,
            totalScans,
            HISTORY_COUNT_CACHE_TTL_MS,
            250
          );
        }
      }

      const scans = await db
        .select({
          id: rfidScans.id,
          rfidTagId: rfidScans.rfidTagId,
          deviceId: rfidScans.deviceId,
          userId: rfidScans.userId,
          location: rfidScans.location,
          unitNumber: rfidScans.unitNumber,
          scanTime: rfidScans.scanTime,
          status: rfidScans.status,
          eventType: rfidScans.eventType,
          metadata: rfidScans.metadata,
          userName: users.name,
          userRole: users.role,
          userActive: users.isActive,
        })
        .from(rfidScans)
        .leftJoin(users, eq(rfidScans.userId, users.id))
        .where(and(...filters))
        .orderBy(desc(rfidScans.scanTime))
        .limit(sanitizedLimit + 1)
        .offset(offset);

      const hasExtraRow = scans.length > sanitizedLimit;
      const pageRows = hasExtraRow ? scans.slice(0, sanitizedLimit) : scans;

      const normalizedScans: Array<{
        id: string;
        rfidTagId: string;
        deviceId: string | null;
        userId: number | null;
        location: string | null;
        unitNumber: string | null;
        scanTime: Date;
        status: string;
        eventType: string;
        metadata: Record<string, any>;
        user: {
          id: number;
          name: string | null;
          role: string | null;
          isActive: boolean | null;
        } | null;
      }> = [];

      const eventTypeSummary: Record<string, number> = {};
      const statusSummary: Record<string, number> = {
        success: 0,
        failed: 0,
        unauthorized: 0,
      };

      for (const scan of pageRows) {
        const normalizedScan = {
          id: scan.id,
          rfidTagId: normalizeTagId(scan.rfidTagId),
          deviceId: scan.deviceId,
          userId: scan.userId,
          location: scan.location,
          unitNumber: scan.unitNumber,
          scanTime: scan.scanTime,
          status: scan.status,
          eventType: scan.eventType,
          metadata: (scan.metadata ?? {}) as Record<string, any>,
          user: scan.userId
            ? {
                id: scan.userId,
                name: scan.userName,
                role: scan.userRole,
                isActive: scan.userActive,
              }
            : null,
        };

        normalizedScans.push(normalizedScan);
        eventTypeSummary[normalizedScan.eventType] =
          (eventTypeSummary[normalizedScan.eventType] ?? 0) + 1;
        statusSummary[normalizedScan.status] =
          (statusSummary[normalizedScan.status] ?? 0) + 1;
      }

      const effectiveTotal =
        totalScans ??
        (hasExtraRow
          ? offset + normalizedScans.length + 1
          : offset + normalizedScans.length);
      const totalPages = Math.max(1, Math.ceil(effectiveTotal / sanitizedLimit));
      const hasNext =
        totalScans !== undefined
          ? constrainedPage < totalPages
          : hasExtraRow;

      return c.json({
        success: true,
        message: `Retrieved ${normalizedScans.length} RFID scans (page ${constrainedPage} of ${totalPages})`,
        data: {
          range: {
            start: rangeStart.toISOString(),
            end: new Date(rangeEndExclusive.getTime() - 1).toISOString(),
          },
          pagination: {
            page: constrainedPage,
            limit: sanitizedLimit,
            total: effectiveTotal,
            totalPages,
            hasNext,
            hasPrev: constrainedPage > 1,
            isTotalEstimated: totalScans === undefined,
          },
          summary: {
            byEventType: eventTypeSummary,
            byStatus: statusSummary,
          },
          scans: normalizedScans,
        },
      });
    } catch (error: any) {
      console.error("Get RFID scan history error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve RFID scan history",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/rfid/scans/me - Driver-accessible scan history limited to their tags/userId
app.get("/scans/me", authMiddleware, async (c) => {
  try {
    const db = c.get("db");
    const authUser = c.get("user");

    if (!authUser?.id) {
      return c.json({ success: false, message: "User context missing" }, 401);
    }

    const startParam = c.req.query("startDate");
    const endParam = c.req.query("endDate");
    const limitParam = Number.parseInt(
      c.req.query("limit") || `${DEFAULT_HISTORY_LIMIT}`,
      10
    );

    const now = new Date();
    const defaultEndInclusive = addUtcDays(toUtcStartOfDay(now), 1);
    const defaultStart = addUtcDays(
      defaultEndInclusive,
      -DEFAULT_HISTORY_RANGE_DAYS
    );

    const parsedStart = startParam ? new Date(startParam) : defaultStart;
    const parsedEnd = endParam ? new Date(endParam) : defaultEndInclusive;

    if (
      Number.isNaN(parsedStart.getTime()) ||
      Number.isNaN(parsedEnd.getTime())
    ) {
      return c.json(
        {
          success: false,
          message: "Invalid startDate or endDate parameter",
        },
        400
      );
    }

    const rangeStart = toUtcStartOfDay(parsedStart);
    const rangeEndExclusive = addUtcDays(toUtcStartOfDay(parsedEnd), 1);

    if (rangeEndExclusive <= rangeStart) {
      return c.json(
        {
          success: false,
          message: "endDate must be after startDate",
        },
        400
      );
    }

    const rangeDays = Math.ceil(
      (rangeEndExclusive.getTime() - rangeStart.getTime()) /
        (24 * 60 * 60 * 1000)
    );

    if (rangeDays > MAX_HISTORY_RANGE_DAYS) {
      return c.json(
        {
          success: false,
          message: `Date range cannot exceed ${MAX_HISTORY_RANGE_DAYS} days`,
        },
        400
      );
    }

    const sanitizedLimit = Math.min(
      Math.max(
        Number.isFinite(limitParam) ? limitParam : DEFAULT_HISTORY_LIMIT,
        1
      ),
      MAX_HISTORY_LIMIT
    );

    const driverTagCacheKey = `driver-tags:${authUser.id}`;
    let tagCandidates = getCachedValue(driverTagCache, driverTagCacheKey);

    if (tagCandidates === undefined) {
      const [userRecord] = await db
        .select({ id: users.id, rfidTag: users.rfidTag })
        .from(users)
        .where(eq(users.id, authUser.id))
        .limit(1);

      if (!userRecord) {
        return c.json({ success: false, message: "User not found" }, 404);
      }

      const ownedRfids = await db
        .select({ tagId: rfids.tagId })
        .from(rfids)
        .where(eq(rfids.userId, authUser.id));

      const normalizedTagSet = new Set<string>();
      const addTagCandidate = (value?: string | null) => {
        const normalized = normalizeTagId(value);
        if (!normalized) {
          return;
        }
        normalizedTagSet.add(normalized);
      };

      addTagCandidate(userRecord.rfidTag);
      ownedRfids.forEach((card) => addTagCandidate(card.tagId));

      tagCandidates = Array.from(normalizedTagSet);
      setCachedValue(
        driverTagCache,
        driverTagCacheKey,
        tagCandidates,
        DRIVER_TAG_CACHE_TTL_MS,
        DRIVER_TAG_CACHE_MAX_ENTRIES
      );
    }

    const filters = [
      sql`${rfidScans.scanTime} >= ${rangeStart}`,
      sql`${rfidScans.scanTime} < ${rangeEndExclusive}`,
    ];

    const tagFilter = matchAnyNormalizedTags(rfidScans.rfidTagId, tagCandidates);

    if (tagFilter) {
      filters.push(
        or(eq(rfidScans.userId, authUser.id), tagFilter as any) as any
      );
    } else {
      filters.push(eq(rfidScans.userId, authUser.id));
    }

    const scans = await db
      .select({
        id: rfidScans.id,
        rfidTagId: rfidScans.rfidTagId,
        deviceId: rfidScans.deviceId,
        userId: rfidScans.userId,
        location: rfidScans.location,
        unitNumber: rfidScans.unitNumber,
        scanTime: rfidScans.scanTime,
        status: rfidScans.status,
        eventType: rfidScans.eventType,
        metadata: rfidScans.metadata,
      })
      .from(rfidScans)
      .where(and(...filters))
      .orderBy(desc(rfidScans.scanTime))
      .limit(sanitizedLimit);

    const normalizedScans: Array<{
      id: string;
      rfidTagId: string;
      deviceId: string | null;
      userId: number | null;
      location: string | null;
      unitNumber: string | null;
      scanTime: Date;
      status: string;
      eventType: string;
      metadata: Record<string, any>;
    }> = [];

    const eventTypeSummary: Record<string, number> = {};
    const statusSummary: Record<string, number> = {
      success: 0,
      failed: 0,
      unauthorized: 0,
    };

    for (const scan of scans) {
      const normalizedScan = {
        ...scan,
        rfidTagId: normalizeTagId(scan.rfidTagId),
        metadata: (scan.metadata ?? {}) as Record<string, any>,
      };

      normalizedScans.push(normalizedScan);
      eventTypeSummary[normalizedScan.eventType] =
        (eventTypeSummary[normalizedScan.eventType] ?? 0) + 1;
      statusSummary[normalizedScan.status] =
        (statusSummary[normalizedScan.status] ?? 0) + 1;
    }

    return c.json({
      success: true,
      message: `Retrieved ${normalizedScans.length} RFID scans for user`,
      data: {
        range: {
          start: rangeStart.toISOString(),
          end: new Date(rangeEndExclusive.getTime() - 1).toISOString(),
        },
        total: normalizedScans.length,
        summary: {
          byEventType: eventTypeSummary,
          byStatus: statusSummary,
        },
        scans: normalizedScans,
      },
    });
  } catch (error: any) {
    console.error("Get driver RFID scan history error:", error);
    return c.json(
      {
        success: false,
        message: "Failed to retrieve driver RFID scan history",
        error: error.message,
      },
      500
    );
  }
});

// GET /api/rfid/stats/weekly - Rolling 7-day scan analytics
app.get(
  "/stats/weekly",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const stats = await getWeeklyStats(db, MAX_WEEKLY_DAYS);

      return c.json({
        success: true,
        message: `Retrieved ${stats.length} days of RFID scan analytics`,
        data: {
          stats,
        },
      });
    } catch (error: any) {
      console.error("Get weekly RFID stats error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve weekly RFID statistics",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/rfid/stats/monthly - Rolling 6-month scan analytics
app.get(
  "/stats/monthly",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const stats = await getMonthlyStats(db, MAX_MONTHLY_BUCKETS);

      return c.json({
        success: true,
        message: `Retrieved ${stats.length} months of RFID scan analytics`,
        data: {
          stats,
        },
      });
    } catch (error: any) {
      console.error("Get monthly RFID stats error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve monthly RFID statistics",
          error: error.message,
        },
        500
      );
    }
  }
);

// Fetch dashboard statistics from database
const fetchDashboardStats = async (
  db: Database
): Promise<DashboardStatsData> => {
  const now = new Date();
  const todayStart = toUtcStartOfDay(now);
  const yesterdayStart = addUtcDays(todayStart, -1);
  const sevenDayStart = addUtcDays(todayStart, -6);
  const monthStart = toUtcStartOfMonth(now);
  const onlineCutoff = new Date(now.getTime() - ONLINE_THRESHOLD_MS);

  // Execute all dashboard queries in parallel for better performance
  const [
    scanOverviewResult,
    cardStatsResult,
    deviceStatsResult,
    userStatsResult,
    weeklyStats,
    monthlyStats,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE "scanTime" >= ${todayStart})::int AS today_total,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${todayStart} AND "status" = 'success'
        )::int AS today_success,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${todayStart} AND "status" = 'failed'
        )::int AS today_failed,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${todayStart} AND "status" = 'unauthorized'
        )::int AS today_unauthorized,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${yesterdayStart} AND "scanTime" < ${todayStart}
        )::int AS yesterday_total,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${sevenDayStart}
        )::int AS rolling_seven_total,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${sevenDayStart} AND "status" = 'success'
        )::int AS rolling_seven_success,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${monthStart}
        )::int AS month_total,
        COUNT(*) FILTER (
          WHERE "scanTime" >= ${monthStart} AND "status" = 'success'
        )::int AS month_success
      FROM "RfidScans"
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total_cards,
        COUNT(*) FILTER (WHERE "createdAt" >= ${monthStart})::int AS cards_this_month
      FROM "Rfids"
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total_devices,
        COUNT(*) FILTER (WHERE "isActive" = true)::int AS active_devices,
        COUNT(*) FILTER (
          WHERE "isActive" = true AND "lastSeen" >= ${onlineCutoff}
        )::int AS online_devices,
        COUNT(*) FILTER (WHERE "registrationMode" = true)::int AS registration_mode_devices
      FROM "Devices"
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE "role" = 'driver')::int AS drivers,
        COUNT(*) FILTER (WHERE "role" = 'admin')::int AS admins,
        COUNT(*) FILTER (WHERE "role" = 'superadmin')::int AS superadmins,
        COUNT(*) FILTER (WHERE "createdAt" >= ${monthStart})::int AS users_this_month
      FROM "Users"
    `),
    getWeeklyStats(db, MAX_WEEKLY_DAYS),
    getMonthlyStats(db, MAX_MONTHLY_BUCKETS),
  ]);

  type ScanOverviewRow = {
    today_total: unknown;
    today_success: unknown;
    today_failed: unknown;
    today_unauthorized: unknown;
    yesterday_total: unknown;
    rolling_seven_total: unknown;
    rolling_seven_success: unknown;
    month_total: unknown;
    month_success: unknown;
  };

  type CardStatsRow = {
    total_cards: unknown;
    cards_this_month: unknown;
  };

  type DeviceStatsRow = {
    total_devices: unknown;
    active_devices: unknown;
    online_devices: unknown;
    registration_mode_devices: unknown;
  };

  type UserStatsRow = {
    total_users: unknown;
    drivers: unknown;
    admins: unknown;
    superadmins: unknown;
    users_this_month: unknown;
  };

  const toNumber = (value: unknown): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const scanOverview =
    (scanOverviewResult.rows?.[0] as Partial<ScanOverviewRow> | undefined) ??
    {
    today_total: 0,
    today_success: 0,
    today_failed: 0,
    today_unauthorized: 0,
    yesterday_total: 0,
    rolling_seven_total: 0,
    rolling_seven_success: 0,
    month_total: 0,
    month_success: 0,
  };

  const cardStats =
    (cardStatsResult.rows?.[0] as Partial<CardStatsRow> | undefined) ?? {
    total_cards: 0,
    cards_this_month: 0,
  };

  const deviceStats =
    (deviceStatsResult.rows?.[0] as Partial<DeviceStatsRow> | undefined) ?? {
    total_devices: 0,
    active_devices: 0,
    online_devices: 0,
    registration_mode_devices: 0,
  };

  const userStats =
    (userStatsResult.rows?.[0] as Partial<UserStatsRow> | undefined) ?? {
    total_users: 0,
    drivers: 0,
    admins: 0,
    superadmins: 0,
    users_this_month: 0,
  };

  return {
    scans: {
      today: {
          total: toNumber(scanOverview.today_total),
          success: toNumber(scanOverview.today_success),
          failed: toNumber(scanOverview.today_failed),
          unauthorized: toNumber(scanOverview.today_unauthorized),
      },
      yesterday: {
          total: toNumber(scanOverview.yesterday_total),
      },
      rollingSevenDays: {
          total: toNumber(scanOverview.rolling_seven_total),
          success: toNumber(scanOverview.rolling_seven_success),
      },
      monthToDate: {
          total: toNumber(scanOverview.month_total),
          success: toNumber(scanOverview.month_success),
      },
      weeklyBuckets: weeklyStats,
      monthlyBuckets: monthlyStats,
    },
    cards: {
        total: toNumber(cardStats.total_cards),
        createdThisMonth: toNumber(cardStats.cards_this_month),
    },
    devices: {
        total: toNumber(deviceStats.total_devices),
        active: toNumber(deviceStats.active_devices),
        online: toNumber(deviceStats.online_devices),
        registrationModeEnabled: toNumber(deviceStats.registration_mode_devices),
    },
    users: {
        total: toNumber(userStats.total_users),
        createdThisMonth: toNumber(userStats.users_this_month),
        drivers: toNumber(userStats.drivers),
        admins: toNumber(userStats.admins),
        superadmins: toNumber(userStats.superadmins),
    },
  };
};

// GET /api/rfid/stats/dashboard - Aggregated dashboard analytics
app.get(
  "/stats/dashboard",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const cacheKey = "dashboard";

      // Check cache first
      const cached = getCachedDashboardStats(cacheKey);
      if (cached) {
        return c.json({
          success: true,
          message: "Dashboard statistics retrieved from cache",
          data: cached,
        });
      }

      // Fetch fresh data and cache it
      const stats = await fetchDashboardStats(db);
      setCachedDashboardStats(cacheKey, stats);

      return c.json({
        success: true,
        message: "Dashboard statistics retrieved successfully",
        data: stats,
      });
    } catch (error: any) {
      console.error("Get dashboard RFID stats error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve dashboard statistics",
          error: error.message,
        },
        500
      );
    }
  }
);

// Database maintenance endpoints (superadmin only)

// GET /api/rfid/maintenance/archive-stats - Get archive statistics
app.get(
  "/maintenance/archive-stats",
  authMiddleware,
  requireRole("superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const stats = await getArchiveStats(db);

      return c.json({
        success: true,
        message: "Archive statistics retrieved successfully",
        data: stats,
      });
    } catch (error: any) {
      console.error("Get archive stats error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to retrieve archive statistics",
          error: error.message,
        },
        500
      );
    }
  }
);

// POST /api/rfid/maintenance/archive-scans - Archive old scan data
app.post(
  "/maintenance/archive-scans",
  authMiddleware,
  requireRole("superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const body = await c.req.json();
      const retentionDays = body.retentionDays || 90;

      if (retentionDays < 30) {
        return c.json(
          {
            success: false,
            message: "Retention period must be at least 30 days",
          },
          400
        );
      }

      const result = await archiveOldScans(db, retentionDays);

      return c.json({
        success: true,
        message: `Archived ${result.archived} old scan records`,
        data: {
          archived: result.archived,
          retentionDays,
          errors: result.errors,
        },
      });
    } catch (error: any) {
      console.error("Archive scans error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to archive scans",
          error: error.message,
        },
        500
      );
    }
  }
);

// POST /api/rfid/maintenance/cleanup-archives - Clean up very old archived data
app.post(
  "/maintenance/cleanup-archives",
  authMiddleware,
  requireRole("superadmin"),
  async (c) => {
    try {
      const db = c.get("db");
      const body = await c.req.json();
      const retentionDays = body.retentionDays || 365;

      if (retentionDays < 180) {
        return c.json(
          {
            success: false,
            message: "Archive retention period must be at least 180 days",
          },
          400
        );
      }

      const result = await cleanupOldArchives(db, retentionDays);

      return c.json({
        success: true,
        message: `Cleaned up ${result.deleted} very old archived records`,
        data: {
          deleted: result.deleted,
          retentionDays,
          errors: result.errors,
        },
      });
    } catch (error: any) {
      console.error("Cleanup archives error:", error);
      return c.json(
        {
          success: false,
          message: "Failed to cleanup archives",
          error: error.message,
        },
        500
      );
    }
  }
);

// GET /api/rfid - List all RFIDs (with auth)
// GET /api/rfid/:tagId - Get specific RFID
// POST /api/rfid/register - Register new RFID
// PUT /api/rfid/:tagId - Update RFID
// DELETE /api/rfid/:tagId - Delete RFID
// ... (add more endpoints as needed)

export default app;
