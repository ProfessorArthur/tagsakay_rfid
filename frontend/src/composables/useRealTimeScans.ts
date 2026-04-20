import { ref, computed } from "vue";
// MIGRATION NOTE (Nov 2024): WebSocket functionality disabled due to Cloudflare Workers free tier limitations
// Backend now uses HTTP polling architecture - devices poll GET /api/devices/:deviceId/commands every 5s
// Frontend uses this composable for maintaining scan history and stats only
// WebSocket imports kept for future reference when upgrading to Durable Objects (paid tier)
// import { useWebSocket } from "./useWebSocket";
import type { RfidScan } from "../services/rfid";

/* DISABLED: WebSocket event types (kept for reference)
interface RealTimeScanEvent {
  success: boolean;
  scan?: {
    id: number;
    tagId: string;
    timestamp: number;
    isRegistered: boolean;
    status: "success" | "unregistered";
  };
  user?: {
    name: string;
    role: string;
  };
  device?: {
    name: string;
    location: string;
  };
  error?: string;
}

interface DeviceConnectionEvent {
  success: boolean;
  message: string;
  deviceId?: string;
  timestamp?: number;
  offlineScans?: number;
}

interface HeartbeatEvent {
  success: boolean;
  action: "heartbeat_ack";
  timestamp: number;
  scanCount: number;
}

type WebSocketEvent =
  | RealTimeScanEvent
  | DeviceConnectionEvent
  | HeartbeatEvent;
*/

export const useRealTimeScans = () => {
  const recentScans = ref<RfidScan[]>([]);
  const connectedDevices = ref<Set<string>>(new Set());
  const totalScanCount = ref(0);
  const lastScanTime = ref<Date | null>(null);

  // HTTP Polling state (replaces WebSocket state)
  const pollingState = ref({
    connected: false,
    connecting: false,
    error: null as string | null,
    reconnectAttempts: 0,
  });

  /* DISABLED: WebSocket implementation (kept for reference)
  // Get WebSocket URL from environment
  const getWebSocketUrl = () => {
    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8787";
    const wsUrl = apiUrl.replace(/^http/, "ws");
    return `${wsUrl}/ws/device`;
  };

  // Create WebSocket connection for real-time updates
  const {
    state,
    connect,
    disconnect,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
  } = useWebSocket({
    url: getWebSocketUrl(),
    autoReconnect: true,
    reconnectDelay: 3000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000, // 30 seconds
  });
  */

  // Connection status computed properties (now use HTTP polling state)
  const isConnected = computed(() => pollingState.value.connected);
  const isConnecting = computed(() => pollingState.value.connecting);
  const connectionError = computed(() => pollingState.value.error);
  const reconnectAttempts = computed(
    () => pollingState.value.reconnectAttempts
  );

  /* DISABLED: WebSocket message handling (kept for reference)
  // Handle incoming WebSocket messages
  onMessage((data: WebSocketEvent) => {

    // Handle scan events
    if ("scan" in data && data.scan) {
      const newScan: RfidScan = {
        id: data.scan.id.toString(),
        rfidTagId: data.scan.tagId,
        deviceId: data.device?.name || "Unknown Device",
        userId: data.user ? 1 : null, // We don't have user ID in the event
        eventType: data.scan.isRegistered ? "entry" : "unknown",
        location: data.device?.location || "Unknown Location",
        unitNumber: null,
        scanTime: new Date(data.scan.timestamp).toISOString(),
        status:
          data.scan.status === "unregistered" ? "failed" : data.scan.status,
        metadata: {
          userName: data.user?.name,
          userRole: data.user?.role,
          deviceName: data.device?.name,
          realTime: true,
        },
      };

      // Add to beginning of recent scans array
      recentScans.value.unshift(newScan);

      // Keep only the 50 most recent scans
      if (recentScans.value.length > 50) {
        recentScans.value = recentScans.value.slice(0, 50);
      }

      totalScanCount.value++;
      lastScanTime.value = new Date(data.scan.timestamp);

      // Emit custom event for components to listen to
      window.dispatchEvent(
        new CustomEvent("rfid-scan", {
          detail: {
            scan: newScan,
            user: data.user,
            device: data.device,
          },
        })
      );
    }

    // Handle device connection events
    if ("deviceId" in data && data.deviceId) {
      if (data.success) {
        connectedDevices.value.add(data.deviceId);

        // Show offline scans being processed
        if (
          "offlineScans" in data &&
          data.offlineScans &&
          data.offlineScans > 0
        ) {
          window.dispatchEvent(
            new CustomEvent("device-offline-scans", {
              detail: {
                deviceId: data.deviceId,
                count: data.offlineScans,
              },
            })
          );
        }
      }
    }

    // Handle heartbeat acknowledgments
    if ("action" in data && data.action === "heartbeat_ack") {
      // Update scan count from heartbeat
      if ("scanCount" in data) {
        totalScanCount.value = Math.max(totalScanCount.value, data.scanCount);
      }
    }
  });

  // Handle connection events
  onConnect(() => {
    window.dispatchEvent(new CustomEvent("websocket-connected"));
  });

  onDisconnect(() => {
    connectedDevices.value.clear();
    window.dispatchEvent(new CustomEvent("websocket-disconnected"));
  });

  onError((error: string) => {
    console.error("Real-time scan connection error:", error);
    window.dispatchEvent(
      new CustomEvent("websocket-error", {
        detail: { error },
      })
    );
  });
  */

  // HTTP Polling implementation (replaces WebSocket)
  // Note: Components should use backend HTTP API endpoints directly for real-time updates
  // This composable now primarily maintains scan history and statistics

  // Public methods
  const startListening = () => {
    // Simulate connection start for HTTP polling mode
    pollingState.value.connecting = true;
    pollingState.value.error = null;

    // Set connected state after short delay
    setTimeout(() => {
      pollingState.value.connecting = false;
      pollingState.value.connected = true;

      // Emit polling-connected event for Dashboard
      window.dispatchEvent(new CustomEvent("polling-connected"));
    }, 100);
  };

  const stopListening = () => {
    // Simulate disconnection for HTTP polling mode
    pollingState.value.connected = false;
    pollingState.value.connecting = false;
    connectedDevices.value.clear();

    // Emit polling-disconnected event for Dashboard
    window.dispatchEvent(new CustomEvent("polling-disconnected"));
  };

  const clearRecentScans = () => {
    recentScans.value = [];
  };

  // Statistics computed properties
  const stats = computed(() => ({
    totalScans: totalScanCount.value,
    recentScansCount: recentScans.value.length,
    connectedDevicesCount: connectedDevices.value.size,
    lastScanTime: lastScanTime.value,
    successfulScans: recentScans.value.filter(
      (scan: RfidScan) => scan.status === "success"
    ).length,
    unregisteredScans: recentScans.value.filter(
      (scan: RfidScan) =>
        scan.status === "failed" || scan.eventType === "unknown"
    ).length,
  }));

  return {
    // State
    recentScans: computed(() => recentScans.value),
    connectedDevices: computed(() => Array.from(connectedDevices.value)),
    stats,

    // Connection state
    isConnected,
    isConnecting,
    connectionError,
    reconnectAttempts,

    // Methods
    startListening,
    stopListening,
    clearRecentScans,
  };
};
