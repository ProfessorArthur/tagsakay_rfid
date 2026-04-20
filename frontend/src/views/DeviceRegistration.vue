<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useDeviceService } from "../composables/useDeviceService";
// MIGRATION NOTE (Nov 2024): WebSocket functionality disabled - using HTTP polling
// import { useDeviceWebSocket } from "../composables/useDeviceWebSocket";

const router = useRouter();
const { registerDevice, registerLoading, registerError } = useDeviceService();

const macAddress = ref("");
const name = ref("");
const location = ref("");

const apiKey = ref<string | null>(null);
const registeredDevice = ref<any | null>(null);
const showResult = ref(false);
const wsTestConnected = ref(false); // Kept for UI compatibility (renamed to pollingTest internally)
const copySuccess = ref(false);
const validationErrors = ref<Record<string, string>>({});

type DeviceDefaults = {
  name?: string;
  location?: string;
};

const DEVICE_DEFAULTS_KEY = "tagsakay_device_defaults";
const savedDefaults = ref<DeviceDefaults | null>(null);
const supportsStorage =
  typeof window !== "undefined" && "localStorage" in window;
const nameSuggestions = [
  "Gate Scanner A",
  "Gate Scanner B",
  "Dispatch Tablet",
  "Express Lane Unit",
];
const locationSuggestions = [
  "Main Terminal",
  "Annex Gate",
  "North Tricycle Bay",
  "Satellite Hub",
];

const loadDefaultsFromStorage = (): DeviceDefaults | null => {
  if (!supportsStorage) {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(DEVICE_DEFAULTS_KEY);
    return stored ? (JSON.parse(stored) as DeviceDefaults) : null;
  } catch (error) {
    console.warn("Failed to load device defaults", error);
    return null;
  }
};

const persistDefaults = (defaults: DeviceDefaults) => {
  if (!supportsStorage) {
    return;
  }
  window.localStorage.setItem(DEVICE_DEFAULTS_KEY, JSON.stringify(defaults));
  savedDefaults.value = defaults;
};

const applySavedDefaults = () => {
  if (!savedDefaults.value) {
    return;
  }
  if (savedDefaults.value.name) {
    name.value = savedDefaults.value.name;
  }
  if (savedDefaults.value.location) {
    location.value = savedDefaults.value.location;
  }
};

const clearSavedDefaults = () => {
  if (!supportsStorage) {
    return;
  }
  window.localStorage.removeItem(DEVICE_DEFAULTS_KEY);
  savedDefaults.value = null;
};

// DISABLED: WebSocket composable (HTTP polling mode)
// let deviceWs: ReturnType<typeof useDeviceWebSocket> | null = null;

// Enhanced validation
const validateForm = () => {
  const errors: Record<string, string> = {};

  // MAC Address validation
  if (!macAddress.value.trim()) {
    errors.macAddress = "MAC address is required";
  } else if (
    !macAddress.value.match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/) &&
    !macAddress.value.match(/^[0-9A-Fa-f]{12}$/)
  ) {
    errors.macAddress =
      "Invalid MAC address format. Use XX:XX:XX:XX:XX:XX or XXXXXXXXXXXX";
  }

  // Device name validation
  if (!name.value.trim()) {
    errors.name = "Device name is required";
  } else if (name.value.trim().length < 2) {
    errors.name = "Device name must be at least 2 characters";
  } else if (name.value.length > 100) {
    errors.name = "Device name must be less than 100 characters";
  }

  // Location validation
  if (!location.value.trim()) {
    errors.location = "Location is required";
  } else if (location.value.length > 200) {
    errors.location = "Location must be less than 200 characters";
  }

  validationErrors.value = errors;
  return Object.keys(errors).length === 0;
};

const isFormValid = computed(() => {
  return macAddress.value.trim() && name.value.trim() && location.value.trim();
});

const submit = async () => {
  // Clear previous states
  apiKey.value = null;
  showResult.value = false;
  validationErrors.value = {};

  // Validate form
  if (!validateForm()) {
    return;
  }

  const payload = {
    macAddress: macAddress.value.trim(),
    name: name.value.trim(),
    location: location.value.trim(),
  };

  const result: any = await registerDevice(payload as any);
  if (result) {
    // Handle different response formats from backend
    registeredDevice.value = result.device || result;
    apiKey.value = result.apiKey || result.apiKey?.fullKey || null;
    showResult.value = true;

    persistDefaults({
      name: payload.name,
      location: payload.location,
    });

    // Clear form
    macAddress.value = "";
    name.value = "";
    location.value = "";
  }
};

const copyApiKey = async () => {
  if (!apiKey.value) return;

  try {
    await navigator.clipboard.writeText(apiKey.value);
    copySuccess.value = true;
    setTimeout(() => {
      copySuccess.value = false;
    }, 3000);
  } catch (err) {
    console.error("Failed to copy API key:", err);
    // Fallback: select the text for manual copy
    const input = document.querySelector("input[readonly]") as HTMLInputElement;
    if (input) {
      input.select();
      input.setSelectionRange(0, 99999); // For mobile devices
    }
  }
};

const testConnect = () => {
  if (!registeredDevice.value) return;

  // HTTP polling mode - simulate connection test
  if (wsTestConnected.value) {
    // Disconnect
    wsTestConnected.value = false;
    console.log("HTTP polling test disconnected");
    return;
  }

  // Connect - simulate successful connection for HTTP polling mode
  wsTestConnected.value = true;
  console.log(
    "HTTP polling test: Device uses HTTPClient to poll GET /api/devices/:deviceId/commands"
  );

  /* DISABLED: WebSocket connection test
  if (deviceWs) {
    deviceWs.disconnectDevice();
    deviceWs = null;
    wsTestConnected.value = false;
    return;
  }

  deviceWs = useDeviceWebSocket({ deviceId: registeredDevice.value.deviceId });
  deviceWs.connectDevice();
  wsTestConnected.value = true;
  */
};

const goToDeviceManagement = () => {
  router.push("/devices");
};

const registerAnother = () => {
  showResult.value = false;
  apiKey.value = null;
  registeredDevice.value = null;
  wsTestConnected.value = false;

  /* DISABLED: WebSocket cleanup
  if (deviceWs) {
    deviceWs.disconnectDevice();
    deviceWs = null;
  }
  */

  if (savedDefaults.value) {
    applySavedDefaults();
  }
};

onMounted(() => {
  const defaults = loadDefaultsFromStorage();
  if (defaults) {
    savedDefaults.value = defaults;
    if (!name.value && defaults.name) {
      name.value = defaults.name;
    }
    if (!location.value && defaults.location) {
      location.value = defaults.location;
    }
  }
});
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-base-200 to-base-300 p-6">
    <div class="max-w-5xl mx-auto">
      <!-- Page Header -->
      <div class="text-center mb-12">
        <div class="flex items-center justify-center mb-6">
          <div class="bg-slate-200 dark:bg-slate-700 p-4 rounded-full">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-12 w-12 text-slate-700 dark:text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
        </div>
        <h1 class="text-4xl font-bold text-base-content mb-4">
          Register ESP32 Device
        </h1>
        <p class="text-lg text-base-content/70 max-w-2xl mx-auto">
          Register a new ESP32 device to the TagSakay RFID system and receive
          its secure API key for configuration.
        </p>
      </div>

      <!-- Registration Form -->
      <div class="card bg-base-100 shadow-xl mb-12 border border-base-300">
        <div class="card-body p-8">
          <div class="flex items-center gap-3 mb-6">
            <div class="bg-slate-200 dark:bg-slate-700 p-2 rounded-lg">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 text-slate-700 dark:text-slate-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 class="text-2xl font-bold text-base-content">
              Device Information
            </h2>
          </div>

          <details
            class="collapse collapse-arrow bg-base-200/70 border border-base-300 rounded-xl mb-6"
          >
            <summary class="collapse-title text-base font-semibold">
              Need a refresher? Review the onboarding steps.
            </summary>
            <div class="collapse-content text-sm text-base-content/80">
              <ol class="list-decimal list-inside space-y-1 mb-3">
                <li>Capture the MAC + planned location from the ESP32.</li>
                <li>
                  Register the device below and store the one-time API key.
                </li>
                <li>
                  Paste the key into firmware, reboot, and confirm it pings.
                </li>
              </ol>
              <RouterLink to="/onboarding" class="link link-primary">
                Open the onboarding wizard ↗
              </RouterLink>
            </div>
          </details>

          <!-- Information Alert -->
          <div
            class="alert alert-info mb-8 border-info/30 bg-info/15 text-base-content"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="stroke-current shrink-0 w-6 h-6 text-info-content"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <div>
              <h4 class="font-bold text-lg text-base-content">
                Automatic API Key Generation
              </h4>
              <p class="mt-1 text-base-content/90">
                An API key will be automatically generated upon successful
                registration. Save it securely as it will only be shown once.
              </p>
            </div>
          </div>

          <div
            v-if="supportsStorage"
            class="alert bg-base-200 border border-base-300 mb-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <div>
              <p class="font-semibold text-base-content">Saved defaults</p>
              <p class="text-sm text-base-content/70">
                {{
                  savedDefaults
                    ? "Name: " +
                      (savedDefaults.name || "—") +
                      ", Location: " +
                      (savedDefaults.location || "—")
                    : "No defaults saved yet. Fill the form and register once to save them."
                }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="btn btn-xs btn-primary"
                :disabled="!savedDefaults"
                @click="applySavedDefaults"
              >
                Apply to form
              </button>
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                :disabled="!savedDefaults"
                @click="clearSavedDefaults"
              >
                Clear defaults
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <!-- MAC Address Field -->
            <div class="form-control mb-8 flex flex-col">
              <label class="label mb-2 justify-between">
                <span class="label-text font-semibold text-base"
                  >MAC Address</span
                >
                <span class="label-text-alt text-error">Required</span>
              </label>
              <input
                v-model="macAddress"
                type="text"
                class="input input-bordered input-lg focus:input-primary mb-2 w-full"
                :class="{ 'input-error': validationErrors.macAddress }"
                placeholder="AA:BB:CC:DD:EE:FF or AABBCCDDEEFF"
                @blur="validateForm"
              />
              <label class="label">
                <span class="label-text-alt text-sm"
                  >Format: XX:XX:XX:XX:XX:XX or XXXXXXXXXXXX</span
                >
                <span
                  v-if="validationErrors.macAddress"
                  class="label-text-alt text-error font-medium"
                >
                  {{ validationErrors.macAddress }}
                </span>
              </label>
            </div>

            <!-- Device Name Field -->
            <div class="form-control mb-8 flex flex-col">
              <label class="label mb-2 justify-between">
                <span class="label-text font-semibold text-base"
                  >Device Name</span
                >
                <span class="label-text-alt text-error">Required</span>
              </label>
              <input
                v-model="name"
                type="text"
                class="input input-bordered input-lg focus:input-primary mb-2 w-full"
                :class="{ 'input-error': validationErrors.name }"
                placeholder="Gate #1, Main Scanner, etc."
                @blur="validateForm"
              />
              <label class="label">
                <span class="label-text-alt text-sm"
                  >Descriptive name for the device</span
                >
                <span
                  v-if="validationErrors.name"
                  class="label-text-alt text-error font-medium"
                >
                  {{ validationErrors.name }}
                </span>
              </label>
              <div class="flex flex-wrap gap-2 mt-2">
                <button
                  v-for="suggestion in nameSuggestions"
                  :key="suggestion"
                  type="button"
                  class="btn btn-xs btn-outline"
                  @click="name = suggestion"
                >
                  Use "{{ suggestion }}"
                </button>
              </div>
            </div>

            <!-- Location Field -->
            <div class="form-control lg:col-span-2 mb-8 flex flex-col">
              <label class="label mb-2 justify-between">
                <span class="label-text font-semibold text-base">Location</span>
                <span class="label-text-alt text-error">Required</span>
              </label>
              <input
                v-model="location"
                type="text"
                class="input input-bordered input-lg focus:input-primary mb-2 w-full"
                :class="{ 'input-error': validationErrors.location }"
                placeholder="Main Terminal, Gate A, Building 1 Entrance, etc."
                @blur="validateForm"
              />
              <label class="label">
                <span class="label-text-alt text-sm"
                  >Physical location where the device is installed</span
                >
                <span
                  v-if="validationErrors.location"
                  class="label-text-alt text-error font-medium"
                >
                  {{ validationErrors.location }}
                </span>
              </label>
              <div class="flex flex-wrap gap-2 mt-2">
                <button
                  v-for="locationOption in locationSuggestions"
                  :key="locationOption"
                  type="button"
                  class="btn btn-xs btn-outline"
                  @click="location = locationOption"
                >
                  {{ locationOption }}
                </button>
              </div>
            </div>
          </div>

          <!-- Form Actions -->
          <div class="divider my-8"></div>
          <div
            class="flex flex-col sm:flex-row gap-4 justify-between items-center"
          >
            <button
              type="button"
              class="btn btn-ghost btn-lg"
              @click="goToDeviceManagement"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back to Device Management
            </button>

            <button
              type="button"
              class="btn btn-primary btn-lg px-8"
              :disabled="registerLoading || !isFormValid"
              @click="submit"
            >
              <span
                v-if="registerLoading"
                class="loading loading-spinner loading-sm mr-2"
              ></span>
              <svg
                v-if="!registerLoading"
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              <span v-if="!registerLoading">Register Device</span>
              <span v-else>Registering Device...</span>
            </button>
          </div>

          <!-- Error Display -->
          <div v-if="registerError" class="alert alert-error mt-8 shadow-lg">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <h3 class="font-bold">Registration Failed</h3>
              <div class="text-sm">{{ registerError }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Success Result -->
      <div
        v-if="showResult"
        class="card bg-gradient-to-br from-success to-success/80 text-success-content shadow-2xl mb-12"
      >
        <div class="card-body p-8">
          <div class="flex items-center gap-4 mb-8">
            <div class="bg-success-content/20 p-3 rounded-full">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-10 w-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h2 class="text-3xl font-bold">
                Device Registered Successfully!
              </h2>
              <p class="text-success-content/80 text-lg mt-1">
                Your ESP32 device is now ready for configuration
              </p>
            </div>
          </div>

          <!-- Device Details -->
          <div
            class="bg-base-100 text-base-content rounded-xl p-6 mb-8 shadow-lg"
          >
            <div class="flex items-center gap-2 mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 text-slate-600 dark:text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                />
              </svg>
              <h3 class="text-xl font-bold text-base-content">
                Device Details
              </h3>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-base-200 rounded-lg p-4">
                <div class="text-sm font-medium text-base-content/60">
                  Device ID
                </div>
                <div class="font-mono text-lg font-bold">
                  {{ registeredDevice?.deviceId }}
                </div>
              </div>
              <div class="bg-base-200 rounded-lg p-4">
                <div class="text-sm font-medium text-base-content/60">
                  Device Name
                </div>
                <div class="text-lg font-semibold">
                  {{ registeredDevice?.name }}
                </div>
              </div>
              <div class="bg-base-200 rounded-lg p-4">
                <div class="text-sm font-medium text-base-content/60">
                  MAC Address
                </div>
                <div class="font-mono text-lg font-bold">
                  {{ registeredDevice?.macAddress }}
                </div>
              </div>
              <div class="bg-base-200 rounded-lg p-4">
                <div class="text-sm font-medium text-base-content/60">
                  Location
                </div>
                <div class="text-lg font-semibold">
                  {{ registeredDevice?.location }}
                </div>
              </div>
            </div>
          </div>

          <!-- API Key Display -->
          <div
            class="bg-base-100 text-base-content rounded-xl p-6 mb-8 shadow-lg border-2 border-warning/20"
          >
            <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div class="flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6 text-warning"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-3a1 1 0 011-1h2.586l6.243-6.243A6 6 0 0121 9z"
                  />
                </svg>
                <h3 class="text-xl font-bold text-base-content">API Key</h3>
              </div>
              <div class="badge badge-warning badge-lg font-semibold">
                ⚠️ Show Only Once
              </div>
            </div>

            <div
              class="alert alert-warning mb-4 border-warning/30 bg-warning/10"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="stroke-current shrink-0 w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.232 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <div>
                <div class="font-bold">Important Security Notice</div>
                <div class="text-sm">
                  Save this API key now. It will not be shown again for security
                  reasons.
                </div>
              </div>
            </div>

            <div class="flex gap-3">
              <input
                class="input input-bordered flex-1 font-mono text-sm bg-base-200"
                :value="apiKey"
                readonly
                select-on-click
              />
              <button
                class="btn btn-outline btn-lg"
                :class="{ 'btn-success': copySuccess }"
                @click="copyApiKey"
              >
                <svg
                  v-if="!copySuccess"
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                  />
                </svg>
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {{ copySuccess ? "Copied!" : "Copy Key" }}
              </button>
            </div>
          </div>

          <!-- ESP32 Configuration Guide -->
          <div
            class="bg-base-100 text-base-content rounded-xl p-6 mb-8 shadow-lg"
          >
            <div class="flex items-center gap-2 mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 text-slate-600 dark:text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                />
              </svg>
              <h3 class="text-xl font-bold text-base-content">
                ESP32 Configuration
              </h3>
            </div>
            <p class="text-base-content/70 mb-4">
              Add these constants to your ESP32 firmware or configuration file:
            </p>
            <div class="mockup-code bg-base-300 shadow-inner">
              <pre
                class="px-4"
              ><code class="text-sm">// ESP32 Configuration Constants (HTTP Polling Mode)
const char* DEVICE_ID = "{{ registeredDevice?.deviceId }}";
const char* API_KEY = "{{ apiKey }}";
const char* API_HOST = "localhost";
const int API_PORT = 8787;
const char* API_BASE_PATH = "/api";

// Polling intervals (milliseconds)
const unsigned long COMMAND_POLL_INTERVAL = 5000;  // Poll for commands every 5s
const unsigned long HEARTBEAT_INTERVAL = 30000;     // Send heartbeat every 30s

// Key endpoints:
// - GET /api/devices/{DEVICE_ID}/commands (poll for registration mode)
// - POST /api/rfid/scan (send RFID scans)
// - POST /api/devices/{DEVICE_ID}/heartbeat (send heartbeat)</code></pre>
            </div>
          </div>

          <!-- HTTP Polling Test -->
          <div
            class="bg-base-100 text-base-content rounded-xl p-6 mb-8 shadow-lg"
          >
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6 text-slate-600 dark:text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                  />
                </svg>
                <h3 class="text-xl font-bold text-base-content">
                  Connectivity Test
                </h3>
              </div>
              <div
                class="badge badge-lg font-semibold"
                :class="wsTestConnected ? 'badge-success' : 'badge-outline'"
              >
                <div
                  class="w-2 h-2 rounded-full mr-2"
                  :class="
                    wsTestConnected
                      ? 'bg-success-content animate-pulse'
                      : 'bg-base-content/40'
                  "
                ></div>
                {{ wsTestConnected ? "Connected" : "Disconnected" }}
              </div>
            </div>
            <p class="text-base-content/70 mb-4">
              Test the HTTP polling connection to verify device connectivity
              with the TagSakay system (devices poll commands endpoint every 5
              seconds):
            </p>
            <button
              class="btn btn-outline btn-lg"
              :class="wsTestConnected ? 'btn-error' : 'btn-neutral'"
              @click="testConnect"
            >
              <svg
                v-if="!wsTestConnected"
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span v-if="!wsTestConnected">Test Connection</span>
              <span v-else>Disconnect Test</span>
            </button>
          </div>

          <!-- Action Buttons -->
          <div class="flex flex-col sm:flex-row gap-4 justify-between">
            <button class="btn btn-outline btn-lg" @click="registerAnother">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Register Another Device
            </button>
            <button
              class="btn btn-primary btn-lg px-8"
              @click="goToDeviceManagement"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              Go to Device Management
            </button>
          </div>
        </div>
      </div>

      <!-- Copy Success Toast -->
      <div v-if="copySuccess" class="toast toast-top toast-end z-50">
        <div class="alert alert-success shadow-lg">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span class="font-medium">API key copied to clipboard!</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
pre {
  white-space: pre-wrap;
}

/* Smooth transitions for all interactive elements */
.btn {
  transition: all 0.2s ease-in-out;
}

.input {
  transition: all 0.2s ease-in-out;
}

.card {
  transition: all 0.3s ease-in-out;
}

/* Hover effects */
.card:hover {
  transform: translateY(-2px);
}

/* Fade in animation for success result */
.card.bg-gradient-to-br {
  animation: fadeInUp 0.5s ease-out;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Loading animation for form submission */
.loading {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Custom pulse animation for connection status */
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
