import api from "./api";
import { ref } from "vue";
import deviceService, { type Device } from "./device";
import type { RfidEventType } from "./rfid";
import {
  createAdaptivePoller,
  type AdaptivePoller,
} from "../utils/adaptivePolling";

export interface ScanStats {
  label: string;
  count: number;
  total: number;
  success: number;
  failed: number;
  unauthorized: number;
  rawKey: string;
}

export interface DailyScanBucket {
  date: string;
  total: number;
  success: number;
  failed: number;
  unauthorized: number;
}

export interface MonthlyScanBucket {
  month: string;
  total: number;
  success: number;
  failed: number;
  unauthorized: number;
}

export interface DashboardScanMetrics {
  today: {
    total: number;
    success: number;
    failed: number;
    unauthorized: number;
  };
  yesterday: {
    total: number;
  };
  rollingSevenDays: {
    total: number;
    success: number;
  };
  monthToDate: {
    total: number;
    success: number;
  };
  weeklyBuckets: DailyScanBucket[];
  monthlyBuckets: MonthlyScanBucket[];
}

export interface DashboardCardMetrics {
  total: number;
  createdThisMonth: number;
}

export interface DashboardDeviceMetrics {
  total: number;
  active: number;
  online: number;
  registrationModeEnabled: number;
}

export interface DashboardUserMetrics {
  total: number;
  createdThisMonth: number;
  drivers: number;
  admins: number;
  superadmins: number;
}

export interface DashboardStats {
  scans: DashboardScanMetrics;
  cards: DashboardCardMetrics;
  devices: DashboardDeviceMetrics;
  users: DashboardUserMetrics;
}

export interface DeviceStatus {
  id: string;
  name: string;
  lastActive: string | null;
  status: "online" | "offline";
  location?: string;
  lastSeenAgoSeconds?: number | null;
}

export interface RfidScanResult {
  id: string;
  rfidTagId: string;
  deviceId: string | null;
  userId: number | null;
  eventType: RfidEventType;
  location: string | null;
  unitNumber: string | null;
  scanTime: string;
  status: "success" | "failed" | "unauthorized";
  metadata: Record<string, any>;
  user?: {
    id: number;
    name: string;
    role: string;
    isActive?: boolean;
  } | null;
}

export type QueueCellState =
  | "ongoing"
  | "completed"
  | "error"
  | "info"
  | "default"
  | "stale"
  | "empty"
  | "reserve"
  | "fix";

export interface CascadeSlot {
  slotIndex: number;
  ledValue: string;
  displayValue: string;
  state: QueueCellState;
  scanId: string | null;
  scanTime: string | null;
  isLatest: boolean;
}

export interface CascadeSnapshot {
  slots: CascadeSlot[];
  cascade: string;
  totalActive: number;
  operationModeActive: boolean;
  lastUpdated: string | null;
}

const recentScans = ref<RfidScanResult[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

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

const deriveScanUnitNumber = (
  scan: any,
  metadata: Record<string, any>
): string | null => {
  const candidates: unknown[] = [
    scan?.unitNumber,
    scan?.vehicleNumber,
    scan?.vehicleId,
    metadata["unitNumber"],
    metadata["unit_number"],
    metadata["unit"],
    metadata["vehicleNumber"],
    metadata["vehicleId"],
  ];

  return (
    candidates
      .map((candidate) => normalizeUnitCandidate(candidate))
      .find((value): value is string => Boolean(value)) ?? null
  );
};

const normalizeScanPayload = (payload: any): RfidScanResult[] => {
  const scans = Array.isArray(payload?.scans)
    ? payload.scans
    : Array.isArray(payload)
    ? payload
    : [];

  return scans.map((scan: any) => {
    const metadata =
      scan?.metadata && typeof scan.metadata === "object" ? scan.metadata : {};
    return {
      ...scan,
      unitNumber: deriveScanUnitNumber(scan, metadata),
      metadata,
    };
  });
};

// Polling interval in milliseconds
const DEFAULT_POLLING_INTERVAL = 5000;
let scanPoller: AdaptivePoller | null = null;
let recentScansSignature = "";

const RECENT_SCANS_CACHE_TTL_MS = 1500;
const recentScansCache = new Map<
  number,
  { value: RfidScanResult[]; expiresAt: number }
>();
const recentScansInFlight = new Map<number, Promise<RfidScanResult[]>>();

const getCachedRecentScans = (limit: number): RfidScanResult[] | null => {
  const cached = recentScansCache.get(limit);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    recentScansCache.delete(limit);
    return null;
  }
  return cached.value;
};

const setCachedRecentScans = (limit: number, scans: RfidScanResult[]) => {
  recentScansCache.set(limit, {
    value: scans,
    expiresAt: Date.now() + RECENT_SCANS_CACHE_TTL_MS,
  });
};

const buildRecentScansSignature = (scans: RfidScanResult[]): string => {
  return scans
    .map(
      (scan) =>
        `${scan.id}:${scan.scanTime}:${scan.status}:${scan.eventType}:${
          scan.deviceId ?? ""
        }`
    )
    .join("|");
};

const rfidStatsService = {
  /**
   * Get RFID scan statistics by day for the last 7 days
   */
  async getWeeklyStats(): Promise<ScanStats[]> {
    try {
      const response = await api.get("/rfid/stats/weekly");
      const buckets = Array.isArray(response.data?.stats)
        ? (response.data.stats as DailyScanBucket[])
        : [];

      return buckets.map((bucket) => {
        const date = new Date(bucket.date);
        const label = Number.isNaN(date.getTime())
          ? bucket.date
          : date.toLocaleDateString(undefined, {
              month: "short",
              day: "2-digit",
            });

        return {
          label,
          count: bucket.total,
          total: bucket.total,
          success: bucket.success,
          failed: bucket.failed,
          unauthorized: bucket.unauthorized,
          rawKey: bucket.date,
        } satisfies ScanStats;
      });
    } catch (error) {
      console.error("Error fetching weekly RFID stats:", error);
      return [];
    }
  },

  /**
   * Get RFID scan statistics by month for the last 6 months
   */
  async getMonthlyStats(): Promise<ScanStats[]> {
    try {
      const response = await api.get("/rfid/stats/monthly");
      const buckets = Array.isArray(response.data?.stats)
        ? (response.data.stats as MonthlyScanBucket[])
        : [];

      return buckets.map((bucket) => {
        const [year, month] = bucket.month.split("-").map(Number);
        const label =
          year && month
            ? new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
                undefined,
                {
                  month: "short",
                  year: "numeric",
                }
              )
            : bucket.month;

        return {
          label,
          count: bucket.total,
          total: bucket.total,
          success: bucket.success,
          failed: bucket.failed,
          unauthorized: bucket.unauthorized,
          rawKey: bucket.month,
        } satisfies ScanStats;
      });
    } catch (error) {
      console.error("Error fetching monthly RFID stats:", error);
      return [];
    }
  },

  /**
   * Get connected RFID devices status
   * Shows which ESP32 devices are currently connected
   */
  async getConnectedDevices(): Promise<DeviceStatus[]> {
    try {
      const devices = await deviceService.getAllDevices();

      const mappedDevices = devices.map(
        (device: Device): DeviceStatus => ({
          id: device.deviceId,
          name: device.name,
          status: device.status === "online" ? "online" : "offline",
          lastActive: device.lastSeen ?? device.updatedAt ?? null,
          location: device.location,
          lastSeenAgoSeconds: device.lastSeenAgoSeconds ?? null,
        })
      );

      return mappedDevices.sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === "online" ? -1 : 1;
        }

        const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0;
        const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0;
        return bTime - aTime;
      });
    } catch (error) {
      console.error("Error fetching connected RFID devices:", error);
      return []; // Return empty array if error occurs
    }
  },

  /**
   * Get recent RFID scans
   * Shows the most recent scans from all devices
   */
  async getRecentScans(
    limit: number = 10,
    forceRefresh = false
  ): Promise<RfidScanResult[]> {
    if (!forceRefresh) {
      const cached = getCachedRecentScans(limit);
      if (cached) {
        recentScans.value = cached;
        return cached;
      }

      const pending = recentScansInFlight.get(limit);
      if (pending) {
        return pending;
      }
    }

    const request = (async () => {
      try {
        loading.value = true;
        error.value = null;
        const response = await api.get(`/rfid/scans/recent?limit=${limit}`);
        const normalized = normalizeScanPayload(response.data);
        const nextSignature = buildRecentScansSignature(normalized);

        if (nextSignature !== recentScansSignature) {
          recentScans.value = normalized;
          recentScansSignature = nextSignature;
        }

        setCachedRecentScans(limit, normalized);
        return recentScans.value;
      } catch (err: any) {
        error.value =
          err.response?.data?.message || "Failed to fetch recent scans";
        console.error("Error fetching recent RFID scans:", err);
        return [];
      } finally {
        loading.value = false;
        recentScansInFlight.delete(limit);
      }
    })();

    recentScansInFlight.set(limit, request);
    return request;
  },

  /**
   * Get sanitized recent scans feed for drivers
   */
  async getPublicQueueSnapshot(limit: number = 10): Promise<RfidScanResult[]> {
    try {
      const response = await api.get(
        `/rfid/scans/recent/public?limit=${limit}`
      );
      return normalizeScanPayload(response.data);
    } catch (err) {
      console.error("Error fetching public RFID queue:", err);
      throw err;
    }
  },

  async getCascadeSnapshot(limit: number = 40): Promise<CascadeSnapshot> {
    try {
      const response = await api.get(`/rfid/queue/cascade?limit=${limit}`);
      // `api` response interceptor unwraps the backend `{ success, data }` format
      // and sets `response.data` to the inner `data` already. Use that.
      const snapshot = response.data ?? {};
      const slots = Array.isArray(snapshot.slots)
        ? (snapshot.slots as any[]).map((slot, index) =>
            normalizeCascadeSlot(slot, index)
          )
        : [];

      return {
        slots,
        cascade:
          typeof snapshot.cascade === "string"
            ? snapshot.cascade
            : slots.map((slot) => slot.ledValue).join(","),
        totalActive:
          Number(snapshot.totalActive) ||
          slots.filter((slot) => slot.ledValue !== "0").length,
        operationModeActive:
          snapshot.operationModeActive === undefined
            ? true
            : Boolean(snapshot.operationModeActive),
        lastUpdated: snapshot.lastUpdated ?? null,
      } satisfies CascadeSnapshot;
    } catch (err) {
      console.error("Error fetching LED cascade snapshot:", err);
      throw err;
    }
  },

  /**
   * Start polling for recent RFID scans
   * Automatically updates recentScans ref at the given interval
   */
  startPolling(interval: number = DEFAULT_POLLING_INTERVAL, limit = 10) {
    this.stopPolling();

    // Get initial data
    void this.getRecentScans(limit, true);

    scanPoller = createAdaptivePoller(
      async () => {
        await this.getRecentScans(limit, true);
      },
      {
        baseIntervalMs: interval,
        maxIntervalMs: Math.max(interval * 6, 30000),
        pauseWhenHidden: true,
      }
    );

    scanPoller.start();
  },

  /**
   * Stop polling for RFID scans
   */
  stopPolling() {
    if (scanPoller) {
      scanPoller.stop();
      scanPoller = null;
    }
  },

  /**
   * Get comprehensive dashboard statistics
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const fallback: DashboardStats = {
      scans: {
        today: { total: 0, success: 0, failed: 0, unauthorized: 0 },
        yesterday: { total: 0 },
        rollingSevenDays: { total: 0, success: 0 },
        monthToDate: { total: 0, success: 0 },
        weeklyBuckets: [],
        monthlyBuckets: [],
      },
      cards: { total: 0, createdThisMonth: 0 },
      devices: {
        total: 0,
        active: 0,
        online: 0,
        registrationModeEnabled: 0,
      },
      users: {
        total: 0,
        createdThisMonth: 0,
        drivers: 0,
        admins: 0,
        superadmins: 0,
      },
    };

    try {
      const response = await api.get("/rfid/stats/dashboard");
      const data = response.data as Partial<DashboardStats> | undefined;

      if (!data) {
        return fallback;
      }

      const normalizeDaily = (buckets?: DailyScanBucket[]): DailyScanBucket[] =>
        Array.isArray(buckets)
          ? buckets.map((bucket) => ({
              date: bucket.date,
              total: Number(bucket.total) || 0,
              success: Number(bucket.success) || 0,
              failed: Number(bucket.failed) || 0,
              unauthorized: Number(bucket.unauthorized) || 0,
            }))
          : [];

      const normalizeMonthly = (
        buckets?: MonthlyScanBucket[]
      ): MonthlyScanBucket[] =>
        Array.isArray(buckets)
          ? buckets.map((bucket) => ({
              month: bucket.month,
              total: Number(bucket.total) || 0,
              success: Number(bucket.success) || 0,
              failed: Number(bucket.failed) || 0,
              unauthorized: Number(bucket.unauthorized) || 0,
            }))
          : [];

      return {
        scans: {
          today: {
            total: Number(data.scans?.today?.total) || 0,
            success: Number(data.scans?.today?.success) || 0,
            failed: Number(data.scans?.today?.failed) || 0,
            unauthorized: Number(data.scans?.today?.unauthorized) || 0,
          },
          yesterday: {
            total: Number(data.scans?.yesterday?.total) || 0,
          },
          rollingSevenDays: {
            total: Number(data.scans?.rollingSevenDays?.total) || 0,
            success: Number(data.scans?.rollingSevenDays?.success) || 0,
          },
          monthToDate: {
            total: Number(data.scans?.monthToDate?.total) || 0,
            success: Number(data.scans?.monthToDate?.success) || 0,
          },
          weeklyBuckets: normalizeDaily(data.scans?.weeklyBuckets),
          monthlyBuckets: normalizeMonthly(data.scans?.monthlyBuckets),
        },
        cards: {
          total: Number(data.cards?.total) || 0,
          createdThisMonth: Number(data.cards?.createdThisMonth) || 0,
        },
        devices: {
          total: Number(data.devices?.total) || 0,
          active: Number(data.devices?.active) || 0,
          online: Number(data.devices?.online) || 0,
          registrationModeEnabled:
            Number(data.devices?.registrationModeEnabled) || 0,
        },
        users: {
          total: Number(data.users?.total) || 0,
          createdThisMonth: Number(data.users?.createdThisMonth) || 0,
          drivers: Number(data.users?.drivers) || 0,
          admins: Number(data.users?.admins) || 0,
          superadmins: Number(data.users?.superadmins) || 0,
        },
      } satisfies DashboardStats;
    } catch (error) {
      console.error("Error fetching dashboard statistics:", error);
      return fallback;
    }
  },

  // Expose reactive references
  recentScans,
  loading,
  error,
};

export default rfidStatsService;

function normalizeCascadeSlot(slot: any, fallbackIndex: number): CascadeSlot {
  const slotIndex = Number.isFinite(slot?.slotIndex)
    ? Number(slot.slotIndex)
    : fallbackIndex;
  const rawDisplayCandidate = (() => {
    if (typeof slot?.displayValue === "string") {
      const trimmed = slot.displayValue.trim();
      if (trimmed.length) {
        return trimmed;
      }
    }
    if (typeof slot?.displayValue === "number") {
      return String(slot.displayValue);
    }
    if (
      typeof slot?.ledValue === "string" ||
      typeof slot?.ledValue === "number"
    ) {
      return String(slot.ledValue);
    }
    return "";
  })();
  const displayValue = rawDisplayCandidate.length
    ? rawDisplayCandidate.toUpperCase()
    : "---";
  const ledValue = (() => {
    if (typeof slot?.ledValue === "string") {
      const trimmed = slot.ledValue.trim();
      return trimmed.length ? trimmed.toUpperCase() : "0";
    }
    if (typeof slot?.ledValue === "number") {
      const normalized = String(slot.ledValue).trim();
      return normalized.length ? normalized.toUpperCase() : "0";
    }
    return "0";
  })();
  const normalizedState = ((): QueueCellState => {
    const candidate =
      typeof slot?.state === "string" ? slot.state.toLowerCase() : "";
    switch (candidate) {
      case "ongoing":
        return "ongoing";
      case "completed":
        return "completed";
      case "error":
        return "error";
      case "info":
        return "info";
      case "stale":
        return "stale";
      case "default":
        return "default";
      case "reserve":
        return "reserve";
      case "fix":
        return "fix";
      default:
        return ledValue === "0" ? "empty" : "default";
    }
  })();

  return {
    slotIndex,
    ledValue,
    displayValue,
    state: normalizedState,
    scanId: typeof slot?.scanId === "string" ? slot.scanId : null,
    scanTime: typeof slot?.scanTime === "string" ? slot.scanTime : null,
    isLatest: Boolean(slot?.isLatest),
  } satisfies CascadeSlot;
}
