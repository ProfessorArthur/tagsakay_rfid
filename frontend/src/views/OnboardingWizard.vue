<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";

type WizardPath = "device" | "driver";

type DeviceDefaults = {
  name?: string;
  location?: string;
};

const router = useRouter();
const currentStep = ref(1);
const selectedPath = ref<WizardPath | null>(null);
const DEVICE_DEFAULTS_KEY = "tagsakay_device_defaults";
const devicePrefill = ref<DeviceDefaults>({ name: "", location: "" });
const savedDefaults = ref<DeviceDefaults | null>(null);

const checklistMap: Record<
  WizardPath,
  Array<{ title: string; detail: string }>
> = {
  device: [
    {
      title: "Flash latest firmware",
      detail:
        "Update Config.h with Wi-Fi creds, API host, and heartbeat interval.",
    },
    {
      title: "Capture MAC + location",
      detail:
        "Record the MAC from the serial monitor and decide which gate/station owns it.",
    },
    {
      title: "Register in app",
      detail:
        "Use the device form to create the record and capture the one-time API key.",
    },
    {
      title: "Paste API key + reboot",
      detail:
        "Set the key in firmware, reboot, and confirm the heartbeat shows the device online.",
    },
  ],
  driver: [
    {
      title: "Create driver account",
      detail:
        "From User Management, add the driver or invite them via the public registration form.",
    },
    {
      title: "Scan new RFID tag",
      detail:
        "Have the driver tap an unassigned tag and select it from the Unregistered Tags list.",
    },
    {
      title: "Link tag to driver",
      detail:
        "Fill the registration modal with the driver's record and mark the tag active.",
    },
    {
      title: "Verify dashboard access",
      detail:
        "Have the driver log in to /dashboard to confirm their stats populate.",
    },
  ],
};

const choosePath = (path: WizardPath) => {
  selectedPath.value = path;
  currentStep.value = 2;
};

const resetWizard = () => {
  selectedPath.value = null;
  currentStep.value = 1;
};

const activeChecklist = computed(() =>
  selectedPath.value ? checklistMap[selectedPath.value] : []
);

const primaryLink = computed(() => {
  if (selectedPath.value === "device") {
    return { label: "Open Device Registration", href: "/devices/register" };
  }
  if (selectedPath.value === "driver") {
    return { label: "Open User Management", href: "/users" };
  }
  return null;
});

const secondaryLink = computed(() => {
  if (selectedPath.value === "device") {
    return { label: "View Device List", href: "/devices" };
  }
  if (selectedPath.value === "driver") {
    return { label: "Open RFID Management", href: "/rfid" };
  }
  return null;
});

const primaryLabel = computed(
  () => primaryLink.value?.label ?? "Primary action"
);
const primaryHref = computed(() => primaryLink.value?.href ?? null);
const hasPrimaryLink = computed(() => Boolean(primaryLink.value));

const secondaryLabel = computed(
  () => secondaryLink.value?.label ?? "Secondary action"
);
const secondaryHref = computed(() => secondaryLink.value?.href ?? null);
const hasSecondaryLink = computed(() => Boolean(secondaryLink.value));

const goTo = (href: string | null) => {
  if (!href) return;
  router.push(href);
};

const loadDeviceDefaults = (): DeviceDefaults | null => {
  if (typeof window === "undefined") {
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

const saveDeviceDefaults = (defaults: DeviceDefaults) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(DEVICE_DEFAULTS_KEY, JSON.stringify(defaults));
  savedDefaults.value = defaults;
};

const applySavedDefaults = () => {
  if (!savedDefaults.value) {
    return;
  }
  devicePrefill.value = {
    name: savedDefaults.value.name ?? "",
    location: savedDefaults.value.location ?? "",
  };
};

const persistPrefill = () => {
  if (!devicePrefill.value.name && !devicePrefill.value.location) {
    return;
  }
  saveDeviceDefaults(devicePrefill.value);
};

const clearSavedDefaults = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(DEVICE_DEFAULTS_KEY);
  savedDefaults.value = null;
};

onMounted(() => {
  savedDefaults.value = loadDeviceDefaults();
  if (savedDefaults.value) {
    devicePrefill.value = savedDefaults.value;
  }
});
</script>

<template>
  <div class="min-h-screen bg-base-200 py-10 px-4">
    <div class="max-w-5xl mx-auto">
      <header class="mb-8 text-center">
        <p class="text-sm uppercase tracking-wide text-primary font-semibold">
          Guided setup
        </p>
        <h1 class="text-4xl font-bold text-base-content mb-3">
          Onboarding Wizard
        </h1>
        <p class="text-base text-base-content/70 max-w-2xl mx-auto">
          Choose whether you're setting up hardware or a driver profile, then
          follow the tailored checklist with quick links and saved defaults.
        </p>
      </header>

      <div class="steps w-full mb-10">
        <span class="step step-primary">Select path</span>
        <span class="step" :class="{ 'step-primary': currentStep >= 2 }"
          >Checklist</span
        >
        <span class="step" :class="{ 'step-primary': currentStep >= 3 }"
          >Next actions</span
        >
      </div>

      <section
        v-if="currentStep === 1"
        class="grid grid-cols-1 md:grid-cols-2 gap-6"
      >
        <button
          type="button"
          class="card bg-base-100 shadow-xl hover:border-primary focus:border-primary border border-transparent transition text-left"
          @click="choosePath('device')"
        >
          <div class="card-body">
            <h2 class="card-title text-2xl">Device onboarding</h2>
            <p class="text-base-content/70">
              Register an ESP32 scanner, capture its API key, and verify the
              heartbeat.
            </p>
            <span class="badge badge-primary badge-outline mt-4 w-fit"
              >ESP32 + API key</span
            >
          </div>
        </button>

        <button
          type="button"
          class="card bg-base-100 shadow-xl hover:border-primary focus:border-primary border border-transparent transition text-left"
          @click="choosePath('driver')"
        >
          <div class="card-body">
            <h2 class="card-title text-2xl">Driver onboarding</h2>
            <p class="text-base-content/70">
              Create driver accounts, link RFID tags, and confirm dashboard
              access.
            </p>
            <span class="badge badge-primary badge-outline mt-4 w-fit"
              >Users + RFID</span
            >
          </div>
        </button>
      </section>

      <section v-else class="card bg-base-100 shadow-xl">
        <div class="card-body space-y-6">
          <div class="flex flex-wrap justify-between gap-3 items-center">
            <div>
              <p class="text-sm uppercase text-primary font-semibold">
                {{ selectedPath === "device" ? "Device" : "Driver" }} journey
              </p>
              <h2 class="text-3xl font-bold text-base-content">
                {{
                  selectedPath === "device"
                    ? "Checklist for ESP32 scanners"
                    : "Checklist for drivers + RFID"
                }}
              </h2>
            </div>
            <button type="button" class="btn btn-ghost" @click="resetWizard">
              Start over
            </button>
          </div>

          <ol class="space-y-4">
            <li
              v-for="(item, index) in activeChecklist"
              :key="item.title"
              class="flex gap-4 items-start"
            >
              <span
                class="w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center"
              >
                {{ index + 1 }}
              </span>
              <div>
                <p class="font-semibold text-base-content">{{ item.title }}</p>
                <p class="text-sm text-base-content/70">{{ item.detail }}</p>
              </div>
            </li>
          </ol>

          <div
            v-if="selectedPath === 'device'"
            class="bg-base-200 rounded-xl p-5"
          >
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-lg font-semibold">Save default device values</h3>
              <div class="space-x-2">
                <button
                  type="button"
                  class="btn btn-xs"
                  :disabled="!devicePrefill.name && !devicePrefill.location"
                  @click="persistPrefill"
                >
                  Save defaults
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  :disabled="!savedDefaults"
                  @click="clearSavedDefaults"
                >
                  Clear
                </button>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="form-control">
                <span class="label-text text-sm text-base-content/70"
                  >Device name</span
                >
                <input
                  v-model="devicePrefill.name"
                  type="text"
                  class="input input-bordered"
                  placeholder="Gate Scanner A"
                />
              </label>
              <label class="form-control">
                <span class="label-text text-sm text-base-content/70"
                  >Location</span
                >
                <input
                  v-model="devicePrefill.location"
                  type="text"
                  class="input input-bordered"
                  placeholder="Main Terminal"
                />
              </label>
            </div>
            <p class="text-xs text-base-content/60 mt-3">
              Saved defaults automatically appear in the Device Registration
              form so you can reuse the last name/location combination.
            </p>
            <button
              v-if="savedDefaults"
              type="button"
              class="btn btn-ghost btn-xs mt-2"
              @click="applySavedDefaults"
            >
              Apply saved values ({{ savedDefaults.name || "—" }} /
              {{ savedDefaults.location || "—" }})
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              class="btn btn-outline"
              :disabled="!hasSecondaryLink"
              @click="goTo(secondaryHref)"
            >
              {{ secondaryLabel }}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="!hasPrimaryLink"
              @click="goTo(primaryHref)"
            >
              {{ primaryLabel }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
