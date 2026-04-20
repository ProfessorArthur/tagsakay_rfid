<template>
  <div class="bg-white shadow rounded-lg p-4">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold text-gray-700">Live RFID Scans</h3>
      <span v-if="loading" class="inline-flex items-center">
        <span class="animate-pulse relative inline-flex h-3 w-3 mr-2">
          <span
            class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
          ></span>
          <span
            class="relative inline-flex rounded-full h-3 w-3 bg-green-500"
          ></span>
        </span>
        <span class="text-sm text-green-600">Live</span>
      </span>
    </div>

    <div
      v-if="error"
      class="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4"
    >
      <p>{{ error }}</p>
    </div>

    <div class="relative overflow-x-auto max-h-96 overflow-y-auto">
      <table class="w-full text-sm text-left text-gray-500 responsive-table">
        <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0">
          <tr>
            <th scope="col" class="px-4 py-3">Time</th>
            <th scope="col" class="px-4 py-3">Tag ID</th>
            <th scope="col" class="px-4 py-3">Device</th>
            <th scope="col" class="px-4 py-3">User</th>
            <th scope="col" class="px-4 py-3">Location</th>
            <th scope="col" class="px-4 py-3">Event</th>
            <th scope="col" class="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="scan in scans"
            :key="scan.id"
            :class="{
              'bg-green-50': scan.status === 'success',
              'bg-red-50': scan.status === 'failed',
              'bg-yellow-50': scan.status === 'unauthorized',
            }"
            class="border-b transition-colors duration-300"
          >
            <td class="px-4 py-3" data-label="Time">
              {{ formatTime(scan.scanTime) }}
            </td>
            <td class="px-4 py-3 font-mono" data-label="Tag">
              {{ scan.rfidTagId }}
            </td>
            <td class="px-4 py-3" data-label="Device">
              {{ scan.deviceId || "Unknown" }}
            </td>
            <td class="px-4 py-3" data-label="User">
              {{ scan.user?.name || "Unknown" }}
            </td>
            <td class="px-4 py-3" data-label="Location">
              {{ scan.location || "Unknown" }}
            </td>
            <td class="px-4 py-3" data-label="Event">
              <span
                :class="[
                  'px-2 py-1 text-xs font-semibold rounded-full capitalize',
                  getEventBadgeClass(scan.eventType),
                ]"
              >
                {{ getEventBadgeLabel(scan.eventType) }}
              </span>
            </td>
            <td class="px-4 py-3" data-label="Status">
              <span
                v-if="scan.status === 'success'"
                class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800"
              >
                Success
              </span>
              <span
                v-else-if="scan.status === 'failed'"
                class="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800"
              >
                Failed
              </span>
              <span
                v-else
                class="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800"
              >
                Unauthorized
              </span>
            </td>
          </tr>
          <tr v-if="scans.length === 0">
            <td colspan="7" class="px-4 py-6 text-center text-gray-500">
              No recent RFID scans detected
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from "vue";
import rfidStatsService from "../services/rfidStats";
import type { RfidEventType } from "../services/rfid";

const props = defineProps({
  limit: {
    type: Number,
    default: 10,
  },
  autoRefresh: {
    type: Boolean,
    default: true,
  },
  refreshInterval: {
    type: Number,
    default: 5000, // 5 seconds
  },
});

// Use the reactive refs from the service
const { recentScans, loading, error } = rfidStatsService;

type EventBadgeStyle = {
  label: string;
  className: string;
};

const EVENT_TYPE_BADGES: Record<RfidEventType | "default", EventBadgeStyle> = {
  entry: { label: "Entry", className: "bg-green-100 text-green-800" },
  ongoing: { label: "Ongoing", className: "bg-sky-100 text-sky-800" },
  completed: { label: "Completed", className: "bg-violet-100 text-violet-800" },
  unknown: { label: "Unknown", className: "bg-gray-100 text-gray-800" },
  override_reserve: {
    label: "Reserve Override",
    className: "bg-pink-100 text-pink-800",
  },
  override_fix: {
    label: "Fix Override",
    className: "bg-orange-100 text-orange-800",
  },
  default: { label: "Event", className: "bg-gray-100 text-gray-800" },
};

const getEventBadgeStyle = (eventType: string): EventBadgeStyle => {
  return (
    EVENT_TYPE_BADGES[eventType as RfidEventType] ?? EVENT_TYPE_BADGES.default
  );
};

const getEventBadgeClass = (eventType: string): string =>
  getEventBadgeStyle(eventType).className;

const getEventBadgeLabel = (eventType: string): string =>
  getEventBadgeStyle(eventType).label;

// Computed property to access the scans
const scans = computed(() => recentScans.value);

// Format timestamp to readable format
const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
};

// Start polling when component is mounted
onMounted(() => {
  if (props.autoRefresh) {
    rfidStatsService.startPolling(props.refreshInterval, props.limit);
  } else {
    rfidStatsService.getRecentScans(props.limit);
  }
});

// Stop polling when component is unmounted
onUnmounted(() => {
  rfidStatsService.stopPolling();
});
</script>
