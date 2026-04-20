<template>
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body">
      <h2 class="card-title flex justify-between items-center">
        <span>RFID Devices</span>
        <button @click="refreshDevices" class="btn btn-sm btn-ghost">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </h2>

      <div v-if="loading" class="flex justify-center py-4">
        <span class="loading loading-spinner loading-md"></span>
      </div>

      <div v-else-if="devices.length === 0" class="alert alert-info">
        No RFID devices are currently connected
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="device in devices"
          :key="device.id"
          class="flex items-center justify-between p-3 bg-base-100 rounded-md"
        >
          <div class="flex items-center">
            <div
              class="w-3 h-3 rounded-full mr-3"
              :class="device.status === 'online' ? 'bg-success' : 'bg-error'"
            ></div>
            <div>
              <div class="font-medium">{{ device.name }}</div>
              <div class="text-sm opacity-70">
                {{ device.location || "Unknown location" }}
              </div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-sm">
              <span
                :class="
                  device.status === 'online' ? 'text-success' : 'text-error'
                "
              >
                {{ device.status === "online" ? "Online" : "Offline" }}
              </span>
            </div>
            <div class="text-xs opacity-70">
              {{ formatTimestamp(device.lastActive) }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import rfidStatsService, { type DeviceStatus } from "../services/rfidStats";

const devices = ref<DeviceStatus[]>([]);
const loading = ref(true);

const refreshDevices = async () => {
  loading.value = true;
  try {
    devices.value = await rfidStatsService.getConnectedDevices();
  } catch (error) {
    console.error("Failed to fetch RFID devices:", error);
  } finally {
    loading.value = false;
  }
};

const formatTimestamp = (timestamp: string | null): string => {
  if (!timestamp) {
    return "Never";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  // If it's today, show "Today at HH:MM"
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Today at ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // If it's yesterday, show "Yesterday at HH:MM"
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // Otherwise, show date and time
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

onMounted(() => {
  refreshDevices();
});
</script>
