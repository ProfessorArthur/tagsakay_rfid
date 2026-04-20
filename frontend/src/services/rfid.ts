import apiClient from "./api";
import type { ApiResponse } from "./api";

type RfidEventType =
  | "entry"
  | "unknown"
  | "ongoing"
  | "completed"
  | "override_reserve"
  | "override_fix";

interface RfidUserSummary {
  id: number;
  name: string;
  email?: string;
  role: string;
}

interface Rfid {
  id: string;
  tagId: string;
  userId: number | null;
  user?: RfidUserSummary | null;
  isActive: boolean;
  unitNumber?: string | null;
  lastScanned: string | null;
  lastSeen?: string | null;
  deviceId: string | null;
  registeredBy?: number | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  isRegistered?: boolean;
}

interface RfidScan {
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
    name: string | null;
    role?: string | null;
    isActive?: boolean | null;
  } | null;
}

type RfidScanStatus = RfidScan["status"];

interface UnregisteredRfidScan {
  id: string;
  tagId: string;
  lastSeen: string;
  deviceId: string | null;
  location: string | null;
  scanCount: number;
}

interface UnregisteredScanOptions {
  limit?: number;
  sinceMinutes?: number;
  forceRefresh?: boolean;
}

interface RecentScanCheckResult {
  success: boolean;
  found: boolean;
  scan: {
    id: string;
    deviceId: string | null;
    status: string;
    scanTime: string;
    metadata: Record<string, any>;
    tagId?: string;
  } | null;
}

interface RegisterRfidData {
  tagId: string;
  userId?: number;
  metadata?: Record<string, any>;
  isActive?: boolean;
}

interface UpdateRfidData {
  userId?: number | null;
  isActive?: boolean;
  metadata?: Record<string, any>;
}

interface RfidScanHistoryFilters {
  startDate: string;
  endDate: string;
  eventType?: RfidEventType | "all";
  limit?: number;
  includeCount?: boolean;
}

interface RfidScanHistorySummary {
  byEventType: Record<RfidEventType, number>;
  byStatus: Record<RfidScanStatus, number>;
}

interface RfidScanHistoryResponse {
  range: {
    start: string;
    end: string;
  };
  total: number;
  summary: RfidScanHistorySummary;
  scans: RfidScan[];
}

/**
 * Client-side RFID tag validation (matches backend: 4-32 alphanumeric)
 */
const validateRfidTag = (tagId: string): { valid: boolean; error?: string } => {
  if (!tagId || tagId.length === 0) {
    return { valid: false, error: "RFID tag is required" };
  }

  if (tagId.length < 4 || tagId.length > 32) {
    return {
      valid: false,
      error: "RFID tag must be between 4 and 32 characters",
    };
  }

  // Alphanumeric only
  const alphanumericRegex = /^[a-zA-Z0-9]+$/;
  if (!alphanumericRegex.test(tagId)) {
    return {
      valid: false,
      error: "RFID tag must contain only letters and numbers",
    };
  }

  return { valid: true };
};

const buildScanHistoryResponse = (
  payload: any,
  filters: RfidScanHistoryFilters
): RfidScanHistoryResponse => {
  const baseEventSummary: Record<RfidEventType, number> = {
    entry: 0,
    unknown: 0,
    ongoing: 0,
    completed: 0,
    override_reserve: 0,
    override_fix: 0,
  };

  const baseStatusSummary: Record<RfidScanStatus, number> = {
    success: 0,
    failed: 0,
    unauthorized: 0,
  };

  const eventSummary = {
    ...baseEventSummary,
    ...(payload?.summary?.byEventType ?? {}),
  } as Record<RfidEventType, number>;

  const statusSummary = {
    ...baseStatusSummary,
    ...(payload?.summary?.byStatus ?? {}),
  } as Record<RfidScanStatus, number>;

  const scans = Array.isArray(payload?.scans) ? payload.scans : [];
  const normalizedScans = scans.map((scan: any) => {
    const metadata =
      scan?.metadata && typeof scan.metadata === "object" ? scan.metadata : {};

    const resolvedUnitNumber = (() => {
      const baseUnit =
        typeof scan?.unitNumber === "string" && scan.unitNumber.trim().length
          ? scan.unitNumber
          : null;
      const vehicleUnit =
        typeof scan?.vehicleId === "string" && scan.vehicleId.trim().length
          ? scan.vehicleId
          : null;
      const metadataUnitCandidates = [
        metadata?.unitNumber,
        metadata?.unit_number,
        metadata?.unit,
        metadata?.vehicleNumber,
        metadata?.vehicleId,
      ];
      const metadataUnit = metadataUnitCandidates.find(
        (value) => typeof value === "string" && value.trim().length > 0
      );
      return (
        baseUnit ?? vehicleUnit ?? (metadataUnit as string | undefined) ?? null
      );
    })();

    return {
      ...scan,
      metadata,
      unitNumber: resolvedUnitNumber,
    };
  });

  return {
    range: {
      start: payload?.range?.start ?? filters.startDate,
      end: payload?.range?.end ?? filters.endDate,
    },
    total:
      typeof payload?.total === "number"
        ? payload.total
        : normalizedScans.length ?? 0,
    summary: {
      byEventType: eventSummary,
      byStatus: statusSummary,
    },
    scans: normalizedScans,
  };
};

// Client-side cache for RFID cards
let _rfidsCache: Rfid[] | null = null;
let _rfidsCacheAt = 0;
const RFID_CACHE_TTL_MS = 1000 * 60 * 3; // three minutes
const UNREGISTERED_SCANS_CACHE_TTL_MS = 1500;

type UnregisteredScansCacheEntry = {
  data: UnregisteredRfidScan[];
  expiresAt: number;
};

const unregisteredScansCache = new Map<string, UnregisteredScansCacheEntry>();
const unregisteredScansInFlight = new Map<
  string,
  Promise<ApiResponse<UnregisteredRfidScan[]>>
>();

const getUnregisteredCacheKey = (
  limit: number,
  sinceMinutes: number
): string => `${limit}:${sinceMinutes}`;

const getCachedUnregisteredScans = (
  cacheKey: string
): UnregisteredRfidScan[] | null => {
  const cached = unregisteredScansCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    unregisteredScansCache.delete(cacheKey);
    return null;
  }

  return cached.data;
};

const setCachedUnregisteredScans = (
  cacheKey: string,
  data: UnregisteredRfidScan[]
) => {
  unregisteredScansCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + UNREGISTERED_SCANS_CACHE_TTL_MS,
  });
};

const invalidateRfidsCache = () => {
  _rfidsCache = null;
  _rfidsCacheAt = 0;
};

const rfidService = {
  // Placeholder -- we'll use cached variants below for heavy read operations
  /**
   * Register a new RFID tag
   */
  async registerRfid(data: RegisterRfidData): Promise<Rfid> {
    // Client-side validation
    const validation = validateRfidTag(data.tagId);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    try {
      const response = await apiClient.post("/rfid/register", data);
      const result = response.data;
      // Invalidate cached RFIDs after register
      invalidateRfidsCache();
      return result;
    } catch (error: any) {
      if (error.response?.status === 400) {
        const apiResponse = error.response.data as ApiResponse;
        if (apiResponse.errors && apiResponse.errors.length > 0) {
          throw new Error(apiResponse.errors.join(", "));
        }
      }
      throw new Error(error.message || "Failed to register RFID tag");
    }
  },

  /**
   * Update existing RFID tag details
   */
  async updateRfid(tagId: string, data: UpdateRfidData): Promise<Rfid> {
    if (!tagId) {
      throw new Error("Tag ID is required");
    }

    try {
      const response = await apiClient.put(`/rfid/${tagId}`, data);
      const result = response.data?.rfid ?? response.data;
      invalidateRfidsCache();
      return result;
    } catch (error: any) {
      if (error.response?.status === 400 || error.response?.status === 404) {
        const apiResponse = error.response.data as ApiResponse;
        const message = apiResponse.message || apiResponse.errors?.join(", ");
        if (message) {
          throw new Error(message);
        }
      }
      throw new Error(error.message || "Failed to update RFID tag");
    }
  },

  /**
   * Get RFID tag information
   */
  async getRfidInfo(id: string): Promise<Rfid> {
    try {
      const response = await apiClient.get(`/rfid/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.message || "Failed to fetch RFID info");
    }
  },

  /**
   * Update RFID tag status (activate/deactivate)
   */
  async updateRfidStatus(id: string, isActive: boolean): Promise<Rfid> {
    // Delegate to updateRfid which uses PUT /rfid/:tagId
    return await this.updateRfid(id, { isActive });
  },

  /**
   * Delete RFID tag (superadmin only)
   */
  async deleteRfid(tagId: string): Promise<void> {
    if (!tagId) {
      throw new Error("Tag ID is required");
    }

    try {
      await apiClient.delete(`/rfid/${tagId}`);
      invalidateRfidsCache();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message;
      throw new Error(message || "Failed to delete RFID tag");
    }
  },

  /**
   * Get unregistered RFID cards (scanned but not registered)
   */
  async getUnregisteredCards(
    options: UnregisteredScanOptions = {}
  ): Promise<Rfid[]> {
    try {
      const { limit = 200, sinceMinutes = 60 * 24 * 7 } = options;
      const response = await apiClient.get("/rfid/unregistered/recent", {
        params: {
          limit,
          sinceMinutes,
        },
      });
      const payload = response.data?.data ?? response.data;

      if (Array.isArray(payload?.rfids)) {
        return payload.rfids;
      }

      if (Array.isArray(payload?.unregisteredTags)) {
        return payload.unregisteredTags;
      }

      if (Array.isArray(payload?.cards)) {
        return payload.cards;
      }

      if (Array.isArray(payload)) {
        return payload;
      }

      return [];
    } catch (error: any) {
      console.error("Failed to fetch unregistered cards:", error);
      return [];
    }
  },

  /**
   * Get all registered RFID cards
   */
  async getAllRfidCards(forceRefresh = false): Promise<Rfid[]> {
    try {
      const now = Date.now();
      if (
        !forceRefresh &&
        _rfidsCache &&
        now - _rfidsCacheAt < RFID_CACHE_TTL_MS
      ) {
        return _rfidsCache;
      }
      const response = await apiClient.get("/rfid");
      const payload = response.data;
      const rfids = Array.isArray(payload?.rfids)
        ? payload.rfids
        : Array.isArray(payload)
        ? payload
        : [];

      const normalized = rfids.map((raw: any) => {
        const hasUser = raw?.userId !== null && raw?.userId !== undefined;
        const hasRegistrar =
          raw?.registeredBy !== null && raw?.registeredBy !== undefined;

        // Normalize unitNumber in metadata for UI consumption
        const unitNumber = raw?.unitNumber ?? raw?.metadata?.unitNumber ?? "";
        const normalizedMetadata = {
          ...(raw?.metadata ?? {}),
          unitNumber,
        };

        return {
          ...raw,
          tagId: typeof raw?.tagId === "string" ? raw.tagId.toUpperCase() : "",
          isRegistered:
            raw?.isRegistered !== undefined
              ? Boolean(raw.isRegistered)
              : hasUser || hasRegistrar,
          lastSeen: raw?.lastScanned ?? raw?.updatedAt ?? null,
          metadata: normalizedMetadata,
          unitNumber,
        };
      });
      _rfidsCache = normalized;
      _rfidsCacheAt = Date.now();
      return normalized;
    } catch (error: any) {
      console.error("Failed to fetch all RFID cards:", error);
      return [];
    }
  },

  /**
   * Check if a tag was recently scanned
   */
  async checkRecentScan(tagId: string): Promise<RecentScanCheckResult> {
    const validation = validateRfidTag(tagId);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    try {
      const response = await apiClient.get(`/rfid/check-recent-scan/${tagId}`);
      const payload = response.data;
      return {
        success: true,
        found: Boolean(payload?.found),
        scan: payload?.scan ?? null,
      };
    } catch (error: any) {
      throw new Error(error.message || "Failed to check recent scan");
    }
  },

  /**
   * Get recent unregistered scans (for registration workflow)
   */
  async getRecentUnregisteredScans(
    options: UnregisteredScanOptions = {}
  ): Promise<ApiResponse<UnregisteredRfidScan[]>> {
    const { limit = 10, sinceMinutes = 120, forceRefresh = false } = options;
    const cacheKey = getUnregisteredCacheKey(limit, sinceMinutes);

    if (!forceRefresh) {
      const cached = getCachedUnregisteredScans(cacheKey);
      if (cached) {
        return { success: true, data: cached };
      }

      const pending = unregisteredScansInFlight.get(cacheKey);
      if (pending) {
        return pending;
      }
    }

    const request = (async (): Promise<ApiResponse<UnregisteredRfidScan[]>> => {
      try {
        const response = await apiClient.get("/rfid/unregistered/recent", {
          params: {
            limit,
            sinceMinutes,
          },
        });
        const payload = response.data?.data ?? response.data;
        const tags = Array.isArray(payload?.unregisteredTags)
          ? payload.unregisteredTags
          : Array.isArray(payload?.rfids)
          ? payload.rfids
          : Array.isArray(payload)
          ? payload
          : [];
        setCachedUnregisteredScans(cacheKey, tags);
        return {
          success: true,
          data: tags,
        };
      } catch (error: any) {
        console.error("Failed to fetch recent unregistered scans:", error);
        return { success: false, data: [] }; // Return empty array on error to prevent component crashes
      } finally {
        unregisteredScansInFlight.delete(cacheKey);
      }
    })();

    unregisteredScansInFlight.set(cacheKey, request);

    return request;
  },

  /**
   * Retrieve RFID scans within a date range for reporting
   */
  async getScanHistory(
    filters: RfidScanHistoryFilters
  ): Promise<RfidScanHistoryResponse> {
    if (!filters.startDate || !filters.endDate) {
      throw new Error("startDate and endDate are required");
    }

    const params: Record<string, string | number> = {
      startDate: filters.startDate,
      endDate: filters.endDate,
    };

    if (filters.limit) {
      params.limit = filters.limit;
    }

    if (filters.eventType && filters.eventType !== "all") {
      params.eventType = filters.eventType;
    }

    if (typeof filters.includeCount === "boolean") {
      params.includeCount = filters.includeCount ? "true" : "false";
    }

    const response = await apiClient.get("/rfid/scans/history", {
      params,
    });

    const payload = response.data?.data ?? response.data ?? {};
    return buildScanHistoryResponse(payload, filters);
  },

  async getMyScanHistory(
    filters: RfidScanHistoryFilters
  ): Promise<RfidScanHistoryResponse> {
    if (!filters.startDate || !filters.endDate) {
      throw new Error("startDate and endDate are required");
    }

    const params: Record<string, string | number> = {
      startDate: filters.startDate,
      endDate: filters.endDate,
    };

    if (filters.limit) {
      params.limit = filters.limit;
    }

    if (filters.eventType && filters.eventType !== "all") {
      params.eventType = filters.eventType;
    }

    if (typeof filters.includeCount === "boolean") {
      params.includeCount = filters.includeCount ? "true" : "false";
    }

    const response = await apiClient.get("/rfid/scans/me", {
      params,
    });

    const payload = response.data?.data ?? response.data ?? {};
    return buildScanHistoryResponse(payload, filters);
  },

  /**
   * Validate RFID tag format (client-side helper)
   */
  validateRfidTag,
  // Expose cache invalidation helper
  invalidateRfidsCache,
};

// (cache block moved above)

export default rfidService;
export type {
  Rfid,
  RfidScan,
  RfidScanStatus,
  UnregisteredRfidScan,
  RegisterRfidData,
  UpdateRfidData,
  RecentScanCheckResult,
  RfidEventType,
  RfidScanHistoryFilters,
  RfidScanHistoryResponse,
  RfidScanHistorySummary,
};
