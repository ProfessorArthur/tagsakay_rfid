import api from "./api";
import type { ApiResponse } from "./api";

export interface Device {
  id: string;
  recordId?: string;
  deviceId: string;
  macAddress: string;
  name: string;
  location: string;
  isActive: boolean;
  registrationMode: boolean;
  scanMode: boolean;
  pendingRegistrationTagId: string;
  status?: "online" | "offline";
  lastSeen?: string | null;
  lastSeenAgoSeconds?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface RegisterDeviceRequest {
  macAddress: string;
  name: string;
  location: string;
}

export interface RegisterDeviceResponse {
  device: Device;
  apiKey: string;
}

export interface UpdateDeviceStatusRequest {
  isActive?: boolean;
  registrationMode?: boolean;
  pendingRegistrationTagId?: string;
  scanMode?: boolean;
}

export interface DeleteDeviceResult {
  removed: boolean;
  archived: boolean;
  linkedScanCount: number;
  device?: Partial<Device>;
}

/**
 * Client-side MAC address validation (matches backend: XX:XX:XX:XX:XX:XX or XXXXXXXXXXXX)
 */
const validateMacAddress = (
  mac: string
): { valid: boolean; error?: string } => {
  if (!mac || mac.length === 0) {
    return { valid: false, error: "MAC address is required" };
  }

  // Format 1: XX:XX:XX:XX:XX:XX (with colons)
  const macWithColonsRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

  // Format 2: XXXXXXXXXXXX (without colons)
  const macWithoutColonsRegex = /^[0-9A-Fa-f]{12}$/;

  if (!macWithColonsRegex.test(mac) && !macWithoutColonsRegex.test(mac)) {
    return {
      valid: false,
      error:
        "Invalid MAC address format. Use XX:XX:XX:XX:XX:XX or XXXXXXXXXXXX",
    };
  }

  return { valid: true };
};

/**
 * Validate device name
 */
const validateDeviceName = (
  name: string
): { valid: boolean; error?: string } => {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Device name is required" };
  }

  if (name.length < 2 || name.length > 100) {
    return {
      valid: false,
      error: "Device name must be between 2 and 100 characters",
    };
  }

  return { valid: true };
};

/**
 * Validate device location
 */
const validateLocation = (
  location: string
): { valid: boolean; error?: string } => {
  if (!location || location.trim().length === 0) {
    return { valid: false, error: "Device location is required" };
  }

  if (location.length > 200) {
    return { valid: false, error: "Location must be less than 200 characters" };
  }

  return { valid: true };
};

const DEVICE_STALE_THRESHOLD_MS = 2 * 60 * 1000;

const toIsoString = (
  value: string | Date | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

const secondsFromNow = (isoString: string | null): number | null => {
  if (!isoString) {
    return null;
  }

  const timestamp = new Date(isoString).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.floor((Date.now() - timestamp) / 1000);
};

const deriveStatus = (raw: any): "online" | "offline" => {
  const isActive = Boolean(raw?.isActive);
  if (!isActive) {
    return "offline";
  }

  const lastSeenIso = toIsoString(raw?.lastSeen);
  if (!lastSeenIso) {
    return "offline";
  }

  return Date.now() - new Date(lastSeenIso).getTime() <=
    DEVICE_STALE_THRESHOLD_MS
    ? "online"
    : "offline";
};

const normalizeDevice = (raw: any): Device => {
  const deviceId = raw?.deviceId ?? raw?.id;
  if (!deviceId) {
    throw new Error("Device payload missing deviceId");
  }

  const lastSeen = toIsoString(raw?.lastSeen);
  const status =
    typeof raw?.status === "string" ? raw.status : deriveStatus(raw);

  return {
    id: deviceId,
    recordId: raw?.id && raw.id !== deviceId ? raw.id : undefined,
    deviceId,
    macAddress: raw?.macAddress ?? "",
    name: raw?.name ?? deviceId,
    location: raw?.location ?? "",
    isActive: Boolean(raw?.isActive),
    registrationMode: Boolean(raw?.registrationMode),
    scanMode: Boolean(raw?.scanMode),
    pendingRegistrationTagId: raw?.pendingRegistrationTagId ?? "",
    status,
    lastSeen,
    lastSeenAgoSeconds:
      typeof raw?.lastSeenAgoSeconds === "number"
        ? raw.lastSeenAgoSeconds
        : secondsFromNow(lastSeen),
    createdAt: toIsoString(raw?.createdAt),
    updatedAt: toIsoString(raw?.updatedAt),
  };
};

// Client-side device cache
let _devicesCache: Device[] | null = null;
let _devicesCacheAt = 0;
const DEVICE_CACHE_TTL_MS = 1000 * 60 * 3; // 3 minutes

const invalidateDevicesCache = () => {
  _devicesCache = null;
  _devicesCacheAt = 0;
};

const deviceService = {
  /**
   * Register a new device with its MAC address
   */
  registerDevice: async (
    deviceData: RegisterDeviceRequest
  ): Promise<RegisterDeviceResponse> => {
    // Client-side validation
    const macValidation = validateMacAddress(deviceData.macAddress);
    if (!macValidation.valid) {
      throw new Error(macValidation.error);
    }

    const nameValidation = validateDeviceName(deviceData.name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error);
    }

    const locationValidation = validateLocation(deviceData.location);
    if (!locationValidation.valid) {
      throw new Error(locationValidation.error);
    }

    try {
      const response = await api.post("/devices/register", deviceData);
      // Invalidate devices cache when a new device is created
      invalidateDevicesCache();
      return response.data as RegisterDeviceResponse;
    } catch (error: any) {
      if (error.response?.status === 400) {
        const apiResponse = error.response.data as ApiResponse;
        if (apiResponse.errors && apiResponse.errors.length > 0) {
          throw new Error(apiResponse.errors.join(", "));
        }
      }
      if (error.response?.status === 429) {
        throw new Error(
          "Too many registration attempts. Please try again later."
        );
      }
      throw new Error(error.message || "Failed to register device");
    }
  },

  /**
   * Get active devices that are online
   */
  getActiveDevices: async (): Promise<Device[]> => {
    try {
      const response = await api.get("/devices/active");
      const devices = Array.isArray(response.data?.devices)
        ? response.data.devices.map(normalizeDevice)
        : [];

      const staleDevices = Array.isArray(response.data?.stale)
        ? response.data.stale.map(normalizeDevice)
        : [];

      if (staleDevices.length > 0) {
        console.debug(
          "[device-service] Stale devices awaiting heartbeat:",
          staleDevices.map((device: Device) => ({
            deviceId: device.deviceId,
            lastSeen: device.lastSeen,
          }))
        );
      }

      return devices.filter((device: Device) => device.status === "online");
    } catch (error: any) {
      console.error("Failed to fetch active devices:", error);
      return [];
    }
  },

  /**
   * Get all registered devices
   */
  getAllDevices: async (forceRefresh = false): Promise<Device[]> => {
    const now = Date.now();
    if (
      !forceRefresh &&
      _devicesCache &&
      now - _devicesCacheAt < DEVICE_CACHE_TTL_MS
    ) {
      return _devicesCache;
    }
    try {
      const response = await api.get("/devices");
      const devices = Array.isArray(response.data?.devices)
        ? response.data.devices.map(normalizeDevice)
        : [];
      _devicesCache = devices;
      _devicesCacheAt = Date.now();
      return devices;
    } catch (error: any) {
      console.error("Failed to fetch all devices:", error);
      return [];
    }
  },

  /**
   * Update device status (enable/disable)
   */
  updateDeviceStatus: async (
    deviceId: string,
    statusData: UpdateDeviceStatusRequest
  ): Promise<Partial<Device>> => {
    try {
      const response = await api.put(`/devices/${deviceId}`, statusData);
      const device = response.data?.device as Partial<Device> | undefined;
      if (!device) {
        throw new Error("Device payload missing from update response");
      }
      // Invalidate devices cache to reflect the update
      invalidateDevicesCache();
      return device;
    } catch (error: any) {
      throw new Error(error.message || "Failed to update device status");
    }
  },

  /**
   * Delete a device
   */
  deleteDevice: async (deviceId: string): Promise<DeleteDeviceResult> => {
    try {
      const response = await api.delete(`/devices/${deviceId}`);
      // Clear cache to reflect deletion
      invalidateDevicesCache();

      const payload = response.data ?? {};
      return {
        removed: Boolean(payload.removed),
        archived: Boolean(payload.archived),
        linkedScanCount: Number(payload.linkedScanCount ?? 0),
        device: payload.device,
      };
    } catch (error: any) {
      throw new Error(error.message || "Failed to delete device");
    }
  },

  /**
   * Unarchive a previously archived device
   */
  unarchiveDevice: async (deviceId: string): Promise<Device> => {
    try {
      const response = await api.post(`/devices/${deviceId}/unarchive`, {});
      const rawDevice = response.data?.device;
      if (!rawDevice) {
        throw new Error("Device payload missing from unarchive response");
      }

      invalidateDevicesCache();
      return normalizeDevice(rawDevice);
    } catch (error: any) {
      throw new Error(error.message || "Failed to unarchive device");
    }
  },

  /**
   * Enable registration mode for a device
   */
  enableRegistrationMode: async (
    deviceId: string,
    tagId?: string
  ): Promise<Partial<Device>> => {
    try {
      const response = await api.post(`/devices/${deviceId}/mode`, {
        registrationMode: true,
        pendingRegistrationTagId: tagId || "",
        scanMode: !tagId,
      });
      const device = response.data?.device as Partial<Device> | undefined;
      if (!device) {
        throw new Error("Device payload missing from enable response");
      }
      invalidateDevicesCache();
      return device;
    } catch (error: any) {
      throw new Error(error.message || "Failed to enable registration mode");
    }
  },

  /**
   * Disable registration mode for a device
   */
  disableRegistrationMode: async (
    deviceId: string
  ): Promise<Partial<Device>> => {
    try {
      const response = await api.post(`/devices/${deviceId}/mode`, {
        registrationMode: false,
        pendingRegistrationTagId: "",
      });
      const device = response.data?.device as Partial<Device> | undefined;
      if (!device) {
        throw new Error("Device payload missing from disable response");
      }
      invalidateDevicesCache();
      return device;
    } catch (error: any) {
      throw new Error(error.message || "Failed to disable registration mode");
    }
  },

  /**
   * Set registration mode for a device with more control
   */
  setRegistrationMode: async ({
    deviceId,
    enabled,
    tagId,
  }: {
    deviceId: string;
    enabled: boolean;
    tagId?: string;
  }): Promise<Partial<Device>> => {
    try {
      const response = await api.post(`/devices/${deviceId}/mode`, {
        registrationMode: enabled,
        pendingRegistrationTagId: tagId || "",
        scanMode: !tagId && enabled,
      });
      const device = response.data?.device as Partial<Device> | undefined;
      if (!device) {
        throw new Error("Device payload missing from mode response");
      }
      invalidateDevicesCache();
      return device;
    } catch (error: any) {
      throw new Error(error.message || "Failed to set registration mode");
    }
  },

  // Export validation helpers
  validateMacAddress,
  validateDeviceName,
  validateLocation,
  // expose invalidation helper
  invalidateDevicesCache,
};

export default deviceService;
