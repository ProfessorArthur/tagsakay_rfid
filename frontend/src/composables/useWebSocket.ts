/**
 * useWebSocket Base Composable
 * =============================
 * DEPRECATION NOTICE (November 2024)
 *
 * This composable is kept for reference only. WebSocket functionality has been disabled
 * throughout the application due to Cloudflare Workers free tier limitations.
 *
 * BACKGROUND:
 * - Cloudflare Workers free tier does not support native WebSockets
 * - WebSocket upgrade requires Durable Objects (paid feature)
 * - Backend attempted WebSocket upgrade but received HTTP 200 instead of 101
 *
 * MIGRATION TO HTTP POLLING:
 * - Backend: Added GET /api/devices/:deviceId/commands endpoint (returns command array)
 * - ESP32: Polls commands endpoint every 5 seconds (COMMAND_POLL_INTERVAL)
 * - Frontend: Uses polling state instead of WebSocket connection state
 *
 * CURRENT STATE:
 * - useRealTimeScans: Disabled WebSocket, uses polling state simulation
 * - useDeviceWebSocket: Disabled WebSocket, returns stub methods with warnings
 * - Dashboard: Uses "polling-connected" events instead of "websocket-connected"
 * - WebSocketTest page: Archived with deprecation notice
 *
 * FUTURE UPGRADE PATH:
 * - When upgrading to Cloudflare Workers paid tier with Durable Objects:
 *   1. Uncomment WebSocket imports in composables
 *   2. Re-enable this base composable functionality
 *   3. Update backend to properly handle WebSocket upgrades with Durable Objects
 *   4. Test bidirectional communication flow
 *   5. Remove HTTP polling simulation code
 *
 * For current HTTP polling implementation, see:
 * - backend-workers/src/routes/device.ts (GET /:deviceId/commands endpoint)
 * - TagSakay_Fixed_Complete/Diagnostics/DisplayDiagnostics.ino (pollCommands function)
 * - frontend/src/composables/useRealTimeScans.ts (polling state management)
 */
import { ref, reactive, onUnmounted } from "vue";

export interface WebSocketConfig {
  url: string;
  protocols?: string[];
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastMessage: any;
  reconnectAttempts: number;
}

export interface WebSocketComposable {
  state: WebSocketState;
  connect: () => void;
  disconnect: () => void;
  send: (data: any) => boolean;
  onMessage: (callback: (data: any) => void) => void;
  onConnect: (callback: () => void) => void;
  onDisconnect: (callback: () => void) => void;
  onError: (callback: (error: string) => void) => void;
}

export const useWebSocket = (config: WebSocketConfig): WebSocketComposable => {
  const ws = ref<WebSocket | null>(null);
  const messageCallbacks = ref<Array<(data: any) => void>>([]);
  const connectCallbacks = ref<Array<() => void>>([]);
  const disconnectCallbacks = ref<Array<() => void>>([]);
  const errorCallbacks = ref<Array<(error: string) => void>>([]);

  let reconnectTimeout: number | null = null;
  let heartbeatInterval: number | null = null;

  const state = reactive<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
    lastMessage: null,
    reconnectAttempts: 0,
  });

  const connect = () => {
    if (state.connected || state.connecting) {
      return;
    }

    state.connecting = true;
    state.error = null;

    try {
      ws.value = new WebSocket(config.url, config.protocols);

      ws.value.onopen = () => {
        state.connected = true;
        state.connecting = false;
        state.error = null;
        state.reconnectAttempts = 0;

        // Start heartbeat if configured
        if (config.heartbeatInterval && config.heartbeatInterval > 0) {
          startHeartbeat();
        }

        connectCallbacks.value.forEach((callback) => callback());
      };

      ws.value.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          state.lastMessage = data;
          messageCallbacks.value.forEach((callback) => callback(data));
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
          const errorMsg = "Invalid message format received";
          state.error = errorMsg;
          errorCallbacks.value.forEach((callback) => callback(errorMsg));
        }
      };

      ws.value.onclose = (event) => {
        state.connected = false;
        state.connecting = false;

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        disconnectCallbacks.value.forEach((callback) => callback());

        // Auto-reconnect if enabled and not a normal closure
        if (config.autoReconnect && event.code !== 1000) {
          scheduleReconnect();
        }
      };

      ws.value.onerror = (event) => {
        console.error("WebSocket error:", event);
        const errorMsg = "WebSocket connection error";
        state.error = errorMsg;
        state.connecting = false;
        errorCallbacks.value.forEach((callback) => callback(errorMsg));
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      const errorMsg = "Failed to create WebSocket connection";
      state.error = errorMsg;
      state.connecting = false;
      errorCallbacks.value.forEach((callback) => callback(errorMsg));
    }
  };

  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (ws.value) {
      ws.value.close(1000, "Client disconnect");
      ws.value = null;
    }

    state.connected = false;
    state.connecting = false;
    state.reconnectAttempts = 0;
  };

  const send = (data: any): boolean => {
    if (!ws.value || state.connected === false) {
      console.warn("WebSocket not connected, cannot send message");
      return false;
    }

    try {
      const message = typeof data === "string" ? data : JSON.stringify(data);
      ws.value.send(message);
      return true;
    } catch (error) {
      console.error("Failed to send WebSocket message:", error);
      const errorMsg = "Failed to send message";
      state.error = errorMsg;
      errorCallbacks.value.forEach((callback) => callback(errorMsg));
      return false;
    }
  };

  const scheduleReconnect = () => {
    if (state.reconnectAttempts >= (config.maxReconnectAttempts || 5)) {
      const errorMsg = "Max reconnection attempts reached";
      state.error = errorMsg;
      errorCallbacks.value.forEach((callback) => callback(errorMsg));
      return;
    }

    const delay =
      (config.reconnectDelay || 3000) * Math.pow(1.5, state.reconnectAttempts);
    state.reconnectAttempts++;

    reconnectTimeout = window.setTimeout(() => {
      connect();
    }, delay);
  };

  const startHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    heartbeatInterval = window.setInterval(() => {
      if (state.connected) {
        send({
          action: "heartbeat",
          timestamp: Date.now(),
        });
      }
    }, config.heartbeatInterval);
  };

  const onMessage = (callback: (data: any) => void) => {
    messageCallbacks.value.push(callback);
  };

  const onConnect = (callback: () => void) => {
    connectCallbacks.value.push(callback);
  };

  const onDisconnect = (callback: () => void) => {
    disconnectCallbacks.value.push(callback);
  };

  const onError = (callback: (error: string) => void) => {
    errorCallbacks.value.push(callback);
  };

  // Cleanup on component unmount
  onUnmounted(() => {
    disconnect();
  });

  return {
    state,
    connect,
    disconnect,
    send,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
  };
};
