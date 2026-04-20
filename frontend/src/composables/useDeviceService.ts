/**
 * Enhanced Device Service with improved error handling and loading states
 * Uses useApiState composable for consistent state management
 */
import { useApiState } from "../composables/useApiState";
import deviceService from "../services/device";
import type {
  Device,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  UpdateDeviceStatusRequest,
} from "../services/device";

export function useDeviceService() {
  // Individual API states for different operations
  const deviceListState = useApiState<Device[]>([]);
  const activeDevicesState = useApiState<Device[]>([]);
  const registerDeviceState = useApiState<RegisterDeviceResponse>();
  const updateDeviceState = useApiState<Partial<Device>>();
  const deleteDeviceState = useApiState<void>();

  /**
   * Load all devices with enhanced error handling
   */
  const loadDevices = async () => {
    return await deviceListState.execute(() => deviceService.getAllDevices(), {
      maxRetries: 2,
      retryDelay: 1000,
    });
  };

  /**
   * Load active devices only
   */
  const loadActiveDevices = async () => {
    return await activeDevicesState.execute(
      () => deviceService.getActiveDevices(),
      { maxRetries: 2, retryDelay: 1000 }
    );
  };

  /**
   * Register new device with validation
   */
  const registerDevice = async (deviceData: RegisterDeviceRequest) => {
    // Client-side validation
    const macValidation = deviceService.validateMacAddress(
      deviceData.macAddress
    );
    if (!macValidation.valid) {
      registerDeviceState.setError(
        macValidation.error || "Invalid MAC address"
      );
      return null;
    }

    const nameValidation = deviceService.validateDeviceName(deviceData.name);
    if (!nameValidation.valid) {
      registerDeviceState.setError(
        nameValidation.error || "Invalid device name"
      );
      return null;
    }

    const locationValidation = deviceService.validateLocation(
      deviceData.location
    );
    if (!locationValidation.valid) {
      registerDeviceState.setError(
        locationValidation.error || "Invalid location"
      );
      return null;
    }

    const result = await registerDeviceState.execute(
      () => deviceService.registerDevice(deviceData),
      { maxRetries: 1 }
    );

    // Refresh device list after successful registration
    if (result) {
      await loadDevices();
    }

    return result;
  };

  /**
   * Update device status
   */
  const updateDeviceStatus = async (
    deviceId: string,
    statusData: UpdateDeviceStatusRequest
  ) => {
    const result = await updateDeviceState.execute(
      () => deviceService.updateDeviceStatus(deviceId, statusData),
      { maxRetries: 1 }
    );

    // Refresh device list after successful update
    if (result) {
      await loadDevices();
    }

    return result;
  };

  /**
   * Delete device
   */
  const deleteDevice = async (deviceId: string) => {
    const result = await deleteDeviceState.execute(
      () => deviceService.deleteDevice(deviceId),
      { maxRetries: 1 }
    );

    // Refresh device list after successful deletion
    if (result !== null) {
      await loadDevices();
    }

    return result;
  };

  /**
   * Enable registration mode for device
   */
  const enableRegistrationMode = async (deviceId: string, tagId?: string) => {
    return await updateDeviceState.execute(
      () => deviceService.enableRegistrationMode(deviceId, tagId),
      { maxRetries: 1 }
    );
  };

  /**
   * Disable registration mode for device
   */
  const disableRegistrationMode = async (deviceId: string) => {
    return await updateDeviceState.execute(
      () => deviceService.disableRegistrationMode(deviceId),
      { maxRetries: 1 }
    );
  };

  /**
   * Set registration mode with more control
   */
  const setRegistrationMode = async (params: {
    deviceId: string;
    enabled: boolean;
    tagId?: string;
  }) => {
    const result = await updateDeviceState.execute(
      () => deviceService.setRegistrationMode(params),
      { maxRetries: 1 }
    );

    // Refresh devices to update status
    if (result) {
      await loadDevices();
    }

    return result;
  };

  /**
   * Refresh all device data
   */
  const refreshAll = async () => {
    await Promise.all([loadDevices(), loadActiveDevices()]);
  };

  /**
   * Reset all states
   */
  const resetAll = () => {
    deviceListState.reset();
    activeDevicesState.reset();
    registerDeviceState.reset();
    updateDeviceState.reset();
    deleteDeviceState.reset();
  };

  /**
   * Find device by MAC address (from loaded list)
   */
  const findDeviceByMac = (macAddress: string): Device | undefined => {
    return deviceListState.data.value?.find(
      (device) => device.macAddress === macAddress
    );
  };

  /**
   * Get device statistics (from loaded list)
   */
  const getDeviceStats = () => {
    const devices = deviceListState.data.value || [];
    const activeDevices = activeDevicesState.data.value || [];

    return {
      total: devices.length,
      active: devices.filter((d) => d.isActive).length,
      inactive: devices.filter((d) => !d.isActive).length,
      online: activeDevices.length,
      offline: devices.length - activeDevices.length,
      registrationMode: devices.filter((d) => d.registrationMode).length,
    };
  };

  /**
   * Get devices by location (from loaded list)
   */
  const getDevicesByLocation = (location: string): Device[] => {
    return (
      deviceListState.data.value?.filter((device) =>
        device.location.toLowerCase().includes(location.toLowerCase())
      ) || []
    );
  };

  return {
    // State access
    devices: deviceListState.data,
    devicesLoading: deviceListState.loading,
    devicesError: deviceListState.error,

    activeDevices: activeDevicesState.data,
    activeDevicesLoading: activeDevicesState.loading,
    activeDevicesError: activeDevicesState.error,

    registerLoading: registerDeviceState.loading,
    registerError: registerDeviceState.error,

    updateLoading: updateDeviceState.loading,
    updateError: updateDeviceState.error,

    deleteLoading: deleteDeviceState.loading,
    deleteError: deleteDeviceState.error,

    // Actions
    loadDevices,
    loadActiveDevices,
    registerDevice,
    updateDeviceStatus,
    deleteDevice,
    enableRegistrationMode,
    disableRegistrationMode,
    setRegistrationMode,
    refreshAll,
    resetAll,

    // Utilities
    findDeviceByMac,
    getDeviceStats,
    getDevicesByLocation,

    // Validation helpers
    validateMacAddress: deviceService.validateMacAddress,
    validateDeviceName: deviceService.validateDeviceName,
    validateLocation: deviceService.validateLocation,
  };
}

export type {
  Device,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  UpdateDeviceStatusRequest,
};
