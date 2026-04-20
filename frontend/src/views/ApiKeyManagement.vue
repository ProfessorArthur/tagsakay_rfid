<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import apiKeyService from "../services/apiKey";
import type { ApiKey, CreateApiKeyData } from "../services/apiKey";

const router = useRouter();
const apiKeys = ref<ApiKey[]>([]);
const loading = ref(true);
const error = ref("");
const success = ref("");

// For key type management - default to service since device keys are created via Device Management
// Only service keys are managed here now
const keyType = ref("service");

// For permission management
const permissionsManage = ref(false);

const newApiKey = ref<CreateApiKeyData>({
  name: "",
  deviceId: `service-${Date.now()}`, // Service ID pattern
  macAddress: "", // Not needed for service keys but may be required by API
  description: "",
  permissions: ["scan"],
});

const createdKey = ref<string>("");
const isCreateModalOpen = ref(false);

onMounted(async () => {
  await loadApiKeys();
});

const goBack = () => {
  router.go(-1); // Go back to the previous page
};

const loadApiKeys = async () => {
  loading.value = true;
  error.value = "";

  try {
    const response = await apiKeyService.listApiKeys();
    apiKeys.value = response.data || [];
  } catch (err: any) {
    error.value = err.response?.data?.message || "Failed to load API keys.";
  } finally {
    loading.value = false;
  }
};

// Ensure scan permission is always included
const ensureScanPermission = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (!target.checked) {
    // Force it back to checked if unchecked
    target.checked = true;
  }
};

const createApiKey = async () => {
  loading.value = true;
  error.value = "";
  success.value = "";

  // For service keys, we set a generic deviceId if not specified
  if (keyType.value === "service" && !newApiKey.value.deviceId.trim()) {
    newApiKey.value.deviceId = `service-${Date.now()}`;
  }

  // Prepare permissions array
  const permissions = ["scan"];
  if (permissionsManage.value) {
    permissions.push("manage");
  }

  // Update permissions in the API key data
  newApiKey.value.permissions = permissions;

  try {
    const response = await apiKeyService.createApiKey(newApiKey.value);

    // Extract the API key and push to list
    if (response.success && response.data) {
      const newKey = response.data;
      createdKey.value = newKey.key; // Backend returns key field

      // Add to list without the full API key
      apiKeys.value.push({
        id: newKey.id,
        name: newKey.name,
        deviceId: newKey.deviceId,
        macAddress: newKey.macAddress,
        prefix: newKey.prefix,
        permissions: newKey.permissions,
        lastUsed: null,
        isActive: true,
        createdBy: newKey.createdBy || 0,
        createdAt: newKey.createdAt,
        updatedAt: newKey.createdAt,
        description: newKey.description || null,
      });
    }

    success.value = "API key created successfully!";
    isCreateModalOpen.value = false;

    // Reset form with defaults for service keys
    newApiKey.value = {
      name: "",
      deviceId: `service-${Date.now()}`,
      macAddress: "",
      description: "",
      permissions: ["scan"],
    };

    // Reset permission toggles
    permissionsManage.value = false;
  } catch (err: any) {
    error.value = err.response?.data?.message || "Failed to create API key.";
  } finally {
    loading.value = false;
  }
};

const updateApiKeyStatus = async (id: string, isActive: boolean) => {
  loading.value = true;
  error.value = "";

  try {
    await apiKeyService.updateApiKey(id, { isActive });

    // Update local state
    const index = apiKeys.value.findIndex((apiKey) => apiKey.id === id);
    if (index !== -1) {
      apiKeys.value[index].isActive = isActive;
    }

    success.value = `API key ${
      isActive ? "activated" : "deactivated"
    } successfully!`;
  } catch (err: any) {
    error.value =
      err.response?.data?.message || "Failed to update API key status.";
  } finally {
    loading.value = false;
  }
};

const revokeApiKey = async (id: string) => {
  if (
    !confirm(
      "Are you sure you want to revoke this API key? This action cannot be undone."
    )
  ) {
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    await apiKeyService.revokeApiKey(id);

    // Remove from local state
    apiKeys.value = apiKeys.value.filter((apiKey) => apiKey.id !== id);

    success.value = "API key revoked successfully!";
  } catch (err: any) {
    error.value = err.response?.data?.message || "Failed to revoke API key.";
  } finally {
    loading.value = false;
  }
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
  success.value = "API key copied to clipboard!";

  // Clear success message after 3 seconds
  setTimeout(() => {
    if (success.value === "API key copied to clipboard!") {
      success.value = "";
    }
  }, 3000);
};
</script>

<template>
  <div>
    <div class="flex items-center gap-2 flex-wrap mb-2">
      <button class="btn btn-ghost btn-circle" @click="goBack">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6"
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
      </button>
      <h1 class="text-3xl font-bold">API Key Management</h1>
    </div>

    <div
      class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6"
    >
      <div class="flex gap-2">
        <router-link to="/devices" class="btn btn-outline btn-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 mr-1"
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
          Manage Devices
        </router-link>
      </div>
      <button
        class="btn btn-primary self-start md:self-auto w-full md:w-auto"
        @click="isCreateModalOpen = true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5 mr-2"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clip-rule="evenodd"
          />
        </svg>
        Create New Service API Key
      </button>
    </div>

    <div class="alert alert-info mb-4">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        class="stroke-current shrink-0 w-6 h-6"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        ></path>
      </svg>
      <div>
        <p>
          <span class="font-bold">Service API Keys:</span> This page is for
          creating API keys for services, mobile apps, and other integrations.
        </p>
        <p class="mt-1">
          For RFID device API keys, please go to the
          <router-link to="/devices" class="underline font-semibold"
            >Device Management</router-link
          >
          page, where API keys are automatically created when you register a
          device.
        </p>
      </div>
    </div>

    <div class="alert alert-error" v-if="error">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
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
      <span>{{ error }}</span>
    </div>

    <div class="alert alert-success" v-if="success">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
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
      <span>{{ success }}</span>
    </div>

    <div v-if="createdKey" class="alert alert-info mb-6">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        class="h-6 w-6 shrink-0 stroke-current"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        ></path>
      </svg>
      <div>
        <span class="font-bold">New API Key Created:</span>
        <code class="block p-3 bg-base-300 mt-2 rounded">{{ createdKey }}</code>
        <span class="text-sm mt-2 block"
          >This key will only be shown once. Please copy it now.</span
        >
      </div>
      <button class="btn btn-sm" @click="copyToClipboard(createdKey)">
        Copy
      </button>
    </div>

    <div v-if="loading" class="flex justify-center my-12">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <div v-else class="overflow-x-auto">
      <table class="table table-zebra responsive-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Device ID</th>
            <th class="hidden lg:table-cell">MAC Address</th>
            <th>Prefix</th>
            <th>Permissions</th>
            <th>Status</th>
            <th class="hidden lg:table-cell">Last Used</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="apiKeys.length === 0">
            <td colspan="9" class="text-center">No API keys found</td>
          </tr>
          <tr v-for="apiKey in apiKeys" :key="apiKey.id">
            <td data-label="Name" class="whitespace-normal break-words">
              {{ apiKey.name }}
            </td>
            <td data-label="Type">
              <span
                class="badge"
                :class="apiKey.macAddress ? 'badge-primary' : 'badge-secondary'"
              >
                {{ apiKey.macAddress ? "Device" : "Service" }}
              </span>
            </td>
            <td data-label="Device ID" class="whitespace-normal break-words">
              {{ apiKey.deviceId }}
            </td>
            <td data-label="MAC Address" class="hidden lg:table-cell">
              {{ apiKey.macAddress || "N/A" }}
            </td>
            <td data-label="Prefix">{{ apiKey.prefix }}</td>
            <td data-label="Permissions">
              <div class="flex flex-wrap gap-1">
                <template v-if="Array.isArray(apiKey.permissions)">
                  <!-- Check if permissions are individual characters -->
                  <template
                    v-if="
                      apiKey.permissions.length > 2 &&
                      apiKey.permissions.every((p) => p.length === 1) &&
                      (apiKey.permissions.join('') === 'scan' ||
                        apiKey.permissions.join('') === 'manage')
                    "
                  >
                    <!-- Show joined permission as a single badge -->
                    <span class="badge badge-primary">
                      {{ apiKey.permissions.join("") }}
                    </span>
                  </template>
                  <template v-else>
                    <!-- Show each permission as a separate badge -->
                    <span
                      v-for="(permission, index) in apiKey.permissions"
                      :key="index"
                      class="badge badge-primary mr-1"
                    >
                      {{ permission }}
                    </span>
                  </template>
                </template>
                <template v-else-if="typeof apiKey.permissions === 'string'">
                  <!-- Handle case where permissions is a single string -->
                  <span class="badge badge-primary">
                    {{ apiKey.permissions }}
                  </span>
                </template>
                <template v-else>
                  <!-- Fallback for any other case -->
                  <span class="badge badge-primary">Unknown</span>
                </template>
              </div>
            </td>
            <td data-label="Status">
              <span
                class="badge"
                :class="apiKey.isActive ? 'badge-success' : 'badge-error'"
              >
                {{ apiKey.isActive ? "Active" : "Inactive" }}
              </span>
            </td>
            <td data-label="Last Used" class="hidden lg:table-cell">
              {{
                apiKey.lastUsed
                  ? new Date(apiKey.lastUsed).toLocaleString()
                  : "Never"
              }}
            </td>
            <td data-label="Actions">
              <div class="flex gap-2">
                <button
                  class="btn btn-sm"
                  :class="apiKey.isActive ? 'btn-error' : 'btn-success'"
                  @click="updateApiKeyStatus(apiKey.id, !apiKey.isActive)"
                >
                  {{ apiKey.isActive ? "Deactivate" : "Activate" }}
                </button>
                <button
                  class="btn btn-sm btn-error"
                  @click="revokeApiKey(apiKey.id)"
                >
                  Revoke
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Create API Key Modal -->
    <dialog :class="['modal', { 'modal-open': isCreateModalOpen }]">
      <div class="modal-box max-w-2xl w-full max-h-[80vh] p-8">
        <h3 class="font-bold text-xl">Create Service API Key</h3>

        <form @submit.prevent="createApiKey" class="mt-6">
          <div class="alert alert-warning mb-8">
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
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p>
                For device API keys, please use the
                <router-link to="/devices" class="underline font-semibold"
                  >Device Management</router-link
                >
                page instead.
              </p>
              <p class="text-sm mt-1">
                This form is only for creating service API keys used by
                applications.
              </p>
            </div>
          </div>

          <input type="hidden" v-model="keyType" value="service" />

          <div class="form-control mb-4">
            <label class="label">
              <span class="label-text font-medium me-2">Name</span>
            </label>
            <input
              type="text"
              v-model="newApiKey.name"
              placeholder="Mobile App Service"
              class="input input-bordered"
              required
            />
          </div>

          <div class="form-control mb-4">
            <label class="label">
              <span class="label-text font-medium me-2">Service ID</span>
            </label>
            <input
              type="text"
              v-model="newApiKey.deviceId"
              placeholder="mobile-app-service"
              class="input input-bordered"
              required
            />
            <label class="label">
              <span class="label-text-alt text-gray-600">
                Use a descriptive service identifier (e.g., mobile-app,
                admin-dashboard)
              </span>
            </label>
          </div>

          <!-- MAC Address removed as this is only for service keys -->

          <div class="form-control mb-6">
            <label class="label">
              <span class="label-text font-medium me-2"
                >Description (Optional)</span
              >
            </label>
            <textarea
              v-model="newApiKey.description"
              placeholder="API key for mobile app integration"
              class="textarea textarea-bordered h-20"
            ></textarea>
          </div>

          <div class="form-control mb-6">
            <label class="label">
              <span class="label-text font-medium">Permissions</span>
            </label>
            <div class="flex flex-wrap gap-2">
              <label class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  checked
                  @change="ensureScanPermission"
                  class="checkbox checkbox-primary"
                />
                <span class="label-text">scan (always required)</span>
              </label>
              <label class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  v-model="permissionsManage"
                  class="checkbox checkbox-primary"
                />
                <span class="label-text">manage</span>
              </label>
            </div>
            <div class="mt-4 text-sm text-gray-600">
              <p class="mb-2">
                <strong>scan</strong> - Required permission to scan RFID tags
              </p>
              <p>
                <strong>manage</strong> - Permission to manage devices and API
                keys
              </p>
            </div>
          </div>

          <div class="modal-action mt-8">
            <button
              type="button"
              class="btn btn-outline"
              @click="isCreateModalOpen = false"
            >
              Cancel
            </button>
            <button type="submit" class="btn btn-primary" :disabled="loading">
              <span
                class="loading loading-spinner loading-xs"
                v-if="loading"
              ></span>
              Create
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button @click="isCreateModalOpen = false">close</button>
      </form>
    </dialog>
  </div>
</template>
