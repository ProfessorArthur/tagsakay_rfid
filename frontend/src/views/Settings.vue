<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  applyThemeMode,
  getStoredThemeMode,
  resolveThemeMode,
  setStoredThemeMode,
  type ThemeMode,
} from "../utils/theme";

// Lightweight settings placeholder
const autosave = ref(true);
const notifications = ref(true);
const themeMode = ref<ThemeMode>(getStoredThemeMode());
const activeTheme = computed(() => resolveThemeMode(themeMode.value));

watch(
  themeMode,
  (mode) => {
    setStoredThemeMode(mode);
    applyThemeMode(mode);
  },
  { immediate: true }
);
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Account Settings</h1>
    </div>

    <div class="card bg-base-200 p-6 max-w-3xl">
      <div class="form-control mb-4">
        <label class="cursor-pointer label">
          <span class="label-text">Enable autosave preferences</span>
          <input
            type="checkbox"
            class="toggle toggle-primary ml-2"
            v-model="autosave"
          />
        </label>
      </div>

      <div class="form-control mb-4">
        <label class="cursor-pointer label">
          <span class="label-text">Receive notifications</span>
          <input
            type="checkbox"
            class="toggle toggle-primary ml-2"
            v-model="notifications"
          />
        </label>
      </div>

      <div class="form-control mb-4">
        <label class="label">
          <span class="label-text">Theme</span>
          <span class="label-text-alt">Applies globally</span>
        </label>
        <select v-model="themeMode" class="select select-bordered max-w-xs">
          <option value="system">System default</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <p class="mt-2 text-xs text-base-content/70">
          Active theme: {{ activeTheme }}
        </p>
      </div>

      <div class="text-sm text-base-content/70">
        These are placeholder settings for your account. We can expand this page
        to include password changes, two-factor authentication setup, and other
        profile preferences later.
      </div>
    </div>
  </div>
</template>
