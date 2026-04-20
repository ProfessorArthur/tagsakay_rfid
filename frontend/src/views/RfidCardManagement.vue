<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { globalSearch } from "../services/search";
import rfidService, {
  type Rfid,
  type RegisterRfidData,
  type UnregisteredRfidScan,
  type UpdateRfidData,
} from "../services/rfid";
import userService, { type User } from "../services/user";
import deviceService from "../services/device";
import useToast from "../composables/useToast";
const { success: toastSuccess } = useToast();
import authService from "../services/auth";

// State
const rfidCards = ref<Rfid[]>([]);
const users = ref<User[]>([]);
const loading = ref(true);
const error = ref("");
const success = ref("");
const tab = ref("all"); // 'all', 'registered', 'unregistered'
const activeDevices = ref<any[]>([]);

const isSuperAdmin = computed(() => authService.isSuperAdmin());

// Modal state
const showRegisterModal = ref(false);
const selectedCard = ref<Rfid | null>(null);
const awaitingConfirmation = ref(false);
const pendingRegistration = ref<string | null>(null);
const activeRegistrationDeviceId = ref<string | null>(null);
const shouldDisableRegistrationOnExit = ref(false);

// Search, sort, and filter state
// Page-local search will take precedence over the global search
const localSearchQuery = ref("");
const effectiveSearch = computed(() =>
  (localSearchQuery.value || globalSearch.value || "").trim()
);
const sortAsc = ref(true); // true = A-Z/Low-High, false = Z-A/High-Low
const sortField = ref<"tag" | "unit">("tag");
const statusFilter = ref<"all" | "active" | "inactive">("all");
const userFilter = ref<number | "all" | "unassigned">("all");
const userSearchQuery = ref(""); // Search within user dropdown in modal

const isEditMode = computed(
  () => !!selectedCard.value && selectedCard.value.isRegistered
);

// Form data for registering/editing
const formData = ref<
  RegisterRfidData & { metadata: { notes: string; unitNumber?: string } }
>({
  tagId: "",
  userId: undefined,
  metadata: {
    notes: "",
    unitNumber: "",
  },
  isActive: true,
});

// Computed properties for filtering cards
const registeredCards = computed(() =>
  rfidCards.value.filter((card) => card.isRegistered)
);

const unregisteredCards = computed(() =>
  rfidCards.value.filter((card) => !card.isRegistered)
);

// Filtered users for the modal dropdown
const filteredUsers = computed(() => {
  const query = userSearchQuery.value.trim().toLowerCase();
  if (!query) return users.value;

  return users.value.filter((user) => {
    const nameMatch = user.name.toLowerCase().includes(query);
    const emailMatch = user.email.toLowerCase().includes(query);
    return nameMatch || emailMatch;
  });
});

const getUnitNumberInfo = (card: Rfid) => {
  const directValue =
    typeof card.unitNumber === "string" ? card.unitNumber : "";
  const metadataValue =
    typeof card.metadata?.unitNumber === "string"
      ? card.metadata.unitNumber
      : "";
  const raw = (directValue || metadataValue || "").trim();

  const digitMatch = raw.match(/\d+/g);
  const numericValue =
    digitMatch && digitMatch.length > 0
      ? Number.parseInt(digitMatch.join(""), 10)
      : null;

  return {
    text: raw.toUpperCase(),
    numeric:
      typeof numericValue === "number" && !Number.isNaN(numericValue)
        ? numericValue
        : null,
  };
};

const displayedCards = computed(() => {
  // Base list by tab selection
  let baseList: Rfid[] = [];
  if (tab.value === "registered") baseList = registeredCards.value;
  else if (tab.value === "unregistered") baseList = unregisteredCards.value;
  else baseList = rfidCards.value;

  // Apply status filter (only meaningful for registered cards)
  let filtered = baseList.filter((card) => {
    if (statusFilter.value === "active") return card.isActive === true;
    if (statusFilter.value === "inactive") return card.isActive === false;
    return true; // 'all'
  });

  // Apply user filter
  if (userFilter.value === "unassigned") {
    filtered = filtered.filter((card) => !card.user || card.user.id === null);
  } else if (userFilter.value !== "all") {
    filtered = filtered.filter(
      (card) => (card.user?.id ?? null) === userFilter.value
    );
  }

  // Apply search filter on tagId, user name/email, and unit number
  const q = effectiveSearch.value.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((card) => {
      const tagMatch = (card.tagId || "").toLowerCase().includes(q);
      const userName = card.user?.name?.toLowerCase?.() || "";
      const userEmail = (card as any).user?.email?.toLowerCase?.() || "";
      const userMatch = userName.includes(q) || userEmail.includes(q);

      // Search by unit number
      const unitNumber = getUnitNumberInfo(card).text.toLowerCase();
      const unitMatch = unitNumber.includes(q);

      return tagMatch || userMatch || unitMatch;
    });
  }

  // Sort by selected field
  const sorted = [...filtered].sort((a, b) => {
    if (sortField.value === "unit") {
      const unitA = getUnitNumberInfo(a);
      const unitB = getUnitNumberInfo(b);

      if (unitA.numeric !== null || unitB.numeric !== null) {
        if (unitA.numeric === null) return 1;
        if (unitB.numeric === null) return -1;
        if (unitA.numeric !== unitB.numeric) {
          return sortAsc.value
            ? unitA.numeric - unitB.numeric
            : unitB.numeric - unitA.numeric;
        }
      }

      if (unitA.text < unitB.text) return sortAsc.value ? -1 : 1;
      if (unitA.text > unitB.text) return sortAsc.value ? 1 : -1;
      return 0;
    }

    const tagA = (a.tagId || "").toUpperCase();
    const tagB = (b.tagId || "").toUpperCase();

    if (tagA < tagB) return sortAsc.value ? -1 : 1;
    if (tagA > tagB) return sortAsc.value ? 1 : -1;
    return 0;
  });

  return sorted;
});

// Variable to store the scan check interval
let scanCheckInterval: number | null = null;

// Load initial data
onMounted(async () => {
  await Promise.all([loadRfidCards(), loadUsers(), loadActiveDevices()]);

  // Set up polling for new scans every 3 seconds
  scanCheckInterval = window.setInterval(async () => {
    if (document.hidden) {
      return;
    }
    await checkForNewScans();
  }, 3000);
});

// Clean up when the component is unmounted
onUnmounted(() => {
  // Clean up polling interval
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  // Clean up scan check interval
  if (scanCheckInterval) {
    clearInterval(scanCheckInterval);
    scanCheckInterval = null;
  }

  if (activeRegistrationDeviceId.value) {
    if (shouldDisableRegistrationOnExit.value) {
      deviceService
        .disableRegistrationMode(activeRegistrationDeviceId.value)
        .catch((err) =>
          console.error("Error disabling registration mode on unmount:", err)
        )
        .finally(() => {
          activeRegistrationDeviceId.value = null;
          shouldDisableRegistrationOnExit.value = false;
        });
    } else {
      activeRegistrationDeviceId.value = null;
    }
  }
});

// Handle modal close
const handleModalClose = async () => {
  showRegisterModal.value = false;
  pendingRegistration.value = null;
  awaitingConfirmation.value = false;

  // Stop polling if active
  stopPollingForNewTag();

  if (activeRegistrationDeviceId.value) {
    try {
      await deviceService.disableRegistrationMode(
        activeRegistrationDeviceId.value
      );
    } catch (err) {
      console.error("Error disabling registration mode on cancel:", err);
    } finally {
      activeRegistrationDeviceId.value = null;
      shouldDisableRegistrationOnExit.value = false;
    }
  }

  // Registration mode can be re-enabled from the device management page when needed
};

// Load active devices
const loadActiveDevices = async () => {
  try {
    const response = await deviceService.getActiveDevices();
    activeDevices.value = response;
  } catch (err) {
    console.error("Error fetching active devices:", err);
  }
};

// Load RFID cards
const loadRfidCards = async () => {
  loading.value = true;
  error.value = "";

  try {
    const cards = await rfidService.getAllRfidCards();
    rfidCards.value = cards
      .map((card) => ({
        ...card,
        isRegistered: card.isRegistered ?? Boolean(card.user),
        lastSeen: card.lastSeen ?? card.lastScanned ?? card.updatedAt ?? null,
      }))
      .sort((a, b) => {
        const aTime = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
        const bTime = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        return bTime - aTime;
      });
  } catch (err) {
    console.error("Error fetching RFID cards:", err);
    error.value = "Failed to load RFID cards";
  } finally {
    loading.value = false;
  }
};

// Load users for assignment
const loadUsers = async () => {
  try {
    const response = await userService.getUsers({ includeRfids: false });
    users.value = (response || []).map((user) => ({
      ...user,
      rfids: user.rfids ?? user.rfidTags ?? [],
      rfidTags: user.rfidTags ?? user.rfids ?? [],
    }));
  } catch (err) {
    console.error("Error fetching users:", err);
    error.value = "Failed to load users";
  }
};

// Open modal to register an unregistered card
const openRegisterModal = async (card: any = null) => {
  selectedCard.value = card;
  pendingRegistration.value = null;
  awaitingConfirmation.value = false;
  stopPollingForNewTag();
  userSearchQuery.value = ""; // Clear user search when opening modal

  if (card) {
    formData.value = {
      tagId: card.tagId,
      userId: card.user?.id || undefined,
      metadata: {
        ...(typeof card.metadata === "object" && card.metadata !== null
          ? card.metadata
          : {}),
        notes: card.metadata?.notes || "",
        unitNumber: card.metadata?.unitNumber || "",
      },
      isActive: card.isActive ?? true,
    };
    showRegisterModal.value = true;
  } else {
    // For new card registration, we'll wait for a scan from ESP32
    formData.value = {
      tagId: "",
      userId: undefined,
      metadata: {
        notes: "",
        unitNumber: "",
      },
      isActive: true,
    };

    // Show the modal with scanning state
    pendingRegistration.value = "new";
    awaitingConfirmation.value = true;
    showRegisterModal.value = true;

    // Notify device to enter scanning mode
    if (activeDevices.value.length > 0) {
      const onlineDevices = activeDevices.value.filter(
        (device) => device.status === "online"
      );

      if (onlineDevices.length > 0) {
        try {
          const deviceId = onlineDevices[0].id;
          await deviceService.enableRegistrationMode(deviceId, "new"); // "new" is a special value indicating we're waiting for any card
          activeRegistrationDeviceId.value = deviceId;
          shouldDisableRegistrationOnExit.value = true;

          success.value = "Waiting for new RFID tag scan...";
          console.log(
            `Notified device ${deviceId} to enter scan mode for new tag`
          );

          // Start polling for new scans
          startPollingForNewTag();
        } catch (err) {
          console.error("Error setting device to scan mode:", err);
          error.value = "Failed to activate scanner. Please try again.";
          showRegisterModal.value = false;
          pendingRegistration.value = null;
          awaitingConfirmation.value = false;
        }
      } else {
        error.value =
          "No online RFID devices found. Please check device connections.";
        showRegisterModal.value = false;
      }
    } else {
      error.value = "No RFID devices found. Please check your hardware setup.";
      showRegisterModal.value = false;
    }
  }
};

// Poll specifically for a new, unknown tag
let pollingInterval: number | null = null;
let pollFailCount = 0; // Counter for consecutive failed polling attempts

const startPollingForNewTag = () => {
  // Clear any existing interval
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  // Reset fail count
  pollFailCount = 0;

  // Start a new polling interval
  pollingInterval = window.setInterval(async () => {
    if (document.hidden) {
      return;
    }

    try {
      // Get the most recent unregistered scans
      const response = await rfidService.getRecentUnregisteredScans({
        limit: 5,
        sinceMinutes: 60,
      });

      console.debug("[RFID] Recent unregistered scans", response.data);

      // Reset fail count on success
      pollFailCount = 0;

      if (response.data && response.data.length > 0) {
        // Take the most recent scan
        const latestScan: UnregisteredRfidScan | undefined = response.data[0];

        console.debug("[RFID] Latest unregistered scan detected", latestScan);

        if (!latestScan) {
          return;
        }

        // Stop polling
        stopPollingForNewTag();

        // Update form with the scanned tag
        formData.value.tagId = latestScan.tagId;

        // Update state
        pendingRegistration.value = latestScan.tagId;
        awaitingConfirmation.value = false;
        success.value = `New tag detected: ${latestScan.tagId}! Please complete the registration form.`;

        // Registration mode stays enabled for further tags; admin can disable manually
      }
    } catch (err) {
      console.error("Error polling for new tags:", err);

      // Increment fail count
      pollFailCount++;

      // If we've failed 5 consecutive times (5 seconds), show error message
      if (pollFailCount >= 5) {
        error.value = "Lost connection to the server. Please try again.";
        stopPollingForNewTag();
        await handleModalClose();
      }
    }
  }, 2000); // Check every two seconds to reduce backend load
};
const stopPollingForNewTag = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
};

// Check for newly scanned cards (polling)
const checkForNewScans = async () => {
  // Skip if we're not awaiting confirmation
  if (!awaitingConfirmation.value || !pendingRegistration.value) return;

  // Skip for new tag detection as that's handled by startPollingForNewTag
  if (pendingRegistration.value === "new") return;

  try {
    // Check if there's been a recent scan of the pending tag
    const response = await rfidService.checkRecentScan(
      pendingRegistration.value
    );

    // If a recent scan was found, complete the registration
    if (response.found) {
      // It's a confirmation tap - complete the registration
      await completeRegistration();
      awaitingConfirmation.value = false;
      pendingRegistration.value = null;
      success.value = "RFID card confirmed and registered successfully!";

      // Update cards list
      await loadRfidCards();
    }
  } catch (err) {
    console.error("Error checking for recent scans:", err);
  }
};

// Start the registration process for an unregistered card
const startRegistration = async (card: Rfid) => {
  selectedCard.value = card;
  pendingRegistration.value = card.tagId;
  awaitingConfirmation.value = false;

  stopPollingForNewTag();
  userSearchQuery.value = ""; // Clear user search when opening modal

  const existingMetadata =
    typeof card.metadata === "object" && card.metadata !== null
      ? { ...card.metadata }
      : {};

  formData.value = {
    tagId: card.tagId,
    userId: card.user?.id || undefined,
    metadata: {
      ...existingMetadata,
      notes: existingMetadata?.notes || "",
      unitNumber: existingMetadata?.unitNumber || "",
    },
    isActive: card.isActive ?? true,
  };

  if (activeDevices.value.length > 0) {
    const onlineDevices = activeDevices.value.filter(
      (device) => device.status === "online"
    );

    if (onlineDevices.length > 0) {
      try {
        const deviceId = onlineDevices[0].id;
        await deviceService.enableRegistrationMode(deviceId, card.tagId);
        activeRegistrationDeviceId.value = deviceId;
        shouldDisableRegistrationOnExit.value = true;
        console.log(
          `Notified device ${deviceId} to enter registration mode for tag ${card.tagId}`
        );
      } catch (err) {
        console.error("Error setting device to registration mode:", err);
      }
    }
  }

  success.value = "";
  error.value = "";
  showRegisterModal.value = true;
};

const openEditCard = (card: Rfid) => {
  selectedCard.value = card;
  pendingRegistration.value = null;
  awaitingConfirmation.value = false;
  stopPollingForNewTag();
  userSearchQuery.value = ""; // Clear user search when opening modal

  const existingMetadata =
    typeof card.metadata === "object" && card.metadata !== null
      ? { ...card.metadata }
      : {};

  formData.value = {
    tagId: card.tagId,
    userId: card.user?.id || undefined,
    metadata: {
      ...existingMetadata,
      notes: existingMetadata?.notes || "",
    },
    isActive: card.isActive ?? true,
  };

  success.value = "";
  error.value = "";
  showRegisterModal.value = true;
};

const buildMetadataPayload = () => {
  const metadataValue = formData.value.metadata;
  const baseMetadata =
    typeof metadataValue === "object" && metadataValue !== null
      ? metadataValue
      : { notes: "", unitNumber: "" };

  return {
    ...baseMetadata,
    notes: metadataValue?.notes || "",
    unitNumber: metadataValue?.unitNumber || "",
  };
};

// Prepare for confirmation tap
const prepareForConfirmation = async () => {
  if (!formData.value.tagId) {
    error.value = "Tag ID is required";
    return;
  }

  awaitingConfirmation.value = true;

  if (activeDevices.value.length > 0) {
    const onlineDevices = activeDevices.value.filter(
      (device) => device.status === "online"
    );

    if (onlineDevices.length > 0) {
      try {
        const deviceId = onlineDevices[0].id;

        await deviceService.setRegistrationMode({
          deviceId,
          enabled: true,
          tagId: formData.value.tagId,
        });
        activeRegistrationDeviceId.value = deviceId;
        shouldDisableRegistrationOnExit.value = true;

        console.log(
          `Notified device ${deviceId} to enter registration mode for tag ${formData.value.tagId}`
        );
      } catch (err) {
        console.error("Error setting device to registration mode:", err);
      }
    }
  }

  success.value = `Form data saved! Please tap the RFID card "${pendingRegistration.value}" again to confirm and complete registration.`;
};

const completeRegistration = async () => {
  try {
    const payload: RegisterRfidData = {
      tagId: formData.value.tagId,
      userId:
        formData.value.userId !== undefined ? formData.value.userId : undefined,
      metadata: buildMetadataPayload(),
      isActive: formData.value.isActive,
    };

    await rfidService.registerRfid(payload);
    toastSuccess("RFID card registered");
    showRegisterModal.value = false;
    awaitingConfirmation.value = false;
    pendingRegistration.value = null;
    selectedCard.value = null;
    success.value = "RFID card registered successfully";
    stopPollingForNewTag();
    shouldDisableRegistrationOnExit.value = false;

    // Registration mode remains enabled for additional tags; disable manually when done

    await loadRfidCards();
  } catch (err) {
    console.error("Error registering RFID card:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to register RFID card";
  }
};

const saveCardChanges = async () => {
  if (!selectedCard.value) {
    return;
  }

  try {
    const payload: UpdateRfidData = {
      userId:
        formData.value.userId === undefined ? null : formData.value.userId,
      isActive: formData.value.isActive,
      metadata: buildMetadataPayload(),
    };

    await rfidService.updateRfid(selectedCard.value.tagId, payload);
    toastSuccess("RFID card updated");
    success.value = `RFID card ${selectedCard.value.tagId} updated successfully`;
    showRegisterModal.value = false;
    selectedCard.value = null;
    await loadRfidCards();
  } catch (err) {
    console.error("Error updating RFID card:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to update RFID card";
  }
};

const handleFormSubmit = async () => {
  if (isEditMode.value) {
    await saveCardChanges();
    return;
  }

  if (awaitingConfirmation.value) {
    await completeRegistration();
    return;
  }

  await prepareForConfirmation();
};

const deleteCard = async (card: Rfid) => {
  if (!isSuperAdmin.value) {
    return;
  }

  const confirmed = window.confirm(
    `Are you sure you want to delete card ${card.tagId}? This action cannot be undone.`
  );

  if (!confirmed) {
    return;
  }

  try {
    await rfidService.deleteRfid(card.tagId);
    toastSuccess("RFID card deleted");
    success.value = `Card ${card.tagId} deleted successfully`;
    if (selectedCard.value?.tagId === card.tagId) {
      selectedCard.value = null;
    }
    await loadRfidCards();
  } catch (err) {
    console.error("Error deleting RFID card:", err);
    error.value =
      err instanceof Error ? err.message : "Failed to delete RFID card";
  }
};

// Toggle RFID card active status
const toggleCardStatus = async (card: Rfid) => {
  try {
    await rfidService.updateRfid(card.tagId, { isActive: !card.isActive });
    toastSuccess("RFID card status updated");
    success.value = `Card ${card.tagId} ${
      card.isActive ? "deactivated" : "activated"
    } successfully`;
    await loadRfidCards();
  } catch (err) {
    console.error("Error updating RFID status:", err);
    error.value = "Failed to update RFID status";
  }
};

// Format date for display
const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  return date.toLocaleString();
};
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold mb-6">RFID Card Management</h1>

    <!-- Success/Error alerts -->
    <div v-if="success" class="alert alert-success mb-4">
      {{ success }}
    </div>

    <div v-if="error" class="alert alert-error mb-4">
      {{ error }}
    </div>

    <!-- Tab navigation -->
    <div class="tabs mb-4">
      <a
        class="tab tab-bordered"
        :class="{ 'tab-active': tab === 'all' }"
        @click="tab = 'all'"
      >
        All Cards
      </a>
      <a
        class="tab tab-bordered"
        :class="{ 'tab-active': tab === 'registered' }"
        @click="tab = 'registered'"
      >
        Registered Cards
      </a>
      <a
        class="tab tab-bordered"
        :class="{ 'tab-active': tab === 'unregistered' }"
        @click="tab = 'unregistered'"
      >
        Unregistered Cards
      </a>
    </div>
    <div
      class="inline-flex items-center gap-2 rounded-lg bg-info text-info-content px-4 py-2 mb-2"
    >
      <span class="font-semibold">Total cards in the system:</span>
      <span>{{ displayedCards.length }} cards</span>
    </div>
    <!-- Action buttons -->
    <div
      class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-4"
    >
      <div class="flex flex-col gap-2 w-full">
        <div class="form-control w-full md:w-72">
          <input
            v-model="localSearchQuery"
            type="text"
            placeholder="Search by Tag ID, Unit No., or User..."
            class="input input-sm input-bordered w-full"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <select
            v-model="sortField"
            class="select select-sm select-bordered min-w-[200px]"
            title="Choose sort field"
          >
            <option value="tag">Sort by Tag ID</option>
            <option value="unit">Sort by Unit No.</option>
          </select>

          <button
            class="btn btn-sm"
            :aria-label="sortAsc ? 'Sort descending' : 'Sort ascending'"
            @click="sortAsc = !sortAsc"
            title="Toggle sort order"
          >
            <span v-if="sortAsc">
              {{ sortField === "unit" ? "Low→High ▲" : "A–Z ▲" }}
            </span>
            <span v-else>
              {{ sortField === "unit" ? "High→Low ▼" : "Z–A ▼" }}
            </span>
          </button>

          <select
            v-model="statusFilter"
            class="select select-sm select-bordered"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      <div class="flex flex-col gap-2 w-full md:w-64">
        <div class="flex flex-wrap items-center gap-2 md:justify-end">
          <button @click="loadRfidCards" class="btn btn-sm">Refresh</button>
          <button @click="openRegisterModal()" class="btn btn-sm btn-primary">
            Register New Card
          </button>
        </div>
        <select
          v-model="userFilter"
          class="select select-sm select-bordered w-full"
        >
          <option value="all">All Users</option>
          <option value="unassigned">Not Assigned</option>
          <option v-for="u in users" :key="u.id" :value="u.id" class="truncate">
            {{ u.name }} ({{ u.email }})
          </option>
        </select>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex justify-center my-8">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <!-- RFID cards table -->
    <div v-else-if="displayedCards.length > 0" class="overflow-x-auto">
      <table class="table w-full responsive-table">
        <thead>
          <tr>
            <th>Tag ID</th>
            <th class="hidden sm:table-cell">Unit No.</th>
            <th>Status</th>
            <th>User</th>
            <th>Last Seen</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="card in displayedCards"
            :key="card.tagId"
            :class="{ 'opacity-50': card.isRegistered && !card.isActive }"
          >
            <td data-label="Tag" class="whitespace-normal break-words">
              {{ card.tagId }}
            </td>
            <td
              data-label="Unit"
              class="hidden sm:table-cell whitespace-normal break-words"
            >
              {{ (card as any).metadata?.unitNumber || "-" }}
            </td>
            <td data-label="Status">
              <div v-if="card.isRegistered">
                <span
                  class="badge"
                  :class="card.isActive ? 'badge-success' : 'badge-error'"
                >
                  {{ card.isActive ? "Active" : "Inactive" }}
                </span>
              </div>
              <div v-else>
                <span class="badge badge-warning">Unregistered</span>
              </div>
            </td>
            <td data-label="User">
              <div v-if="card.user">
                {{ card.user.name }}
                <span class="badge badge-sm ml-1">{{ card.user.role }}</span>
              </div>
              <div v-else>Not assigned</div>
            </td>
            <td data-label="Last Seen">
              {{ formatDate(card.lastSeen || card.updatedAt) }}
            </td>
            <td data-label="Actions">
              <div class="flex flex-wrap gap-2">
                <!-- Register unregistered card -->
                <button
                  v-if="!card.isRegistered"
                  @click="startRegistration(card)"
                  class="btn btn-sm btn-primary"
                >
                  Register
                </button>

                <!-- Toggle registered card status -->
                <button
                  v-if="card.isRegistered"
                  @click="toggleCardStatus(card)"
                  class="btn btn-sm"
                  :class="card.isActive ? 'btn-warning' : 'btn-success'"
                >
                  {{ card.isActive ? "Deactivate" : "Activate" }}
                </button>

                <!-- Edit registered card -->
                <button
                  v-if="isSuperAdmin && card.isRegistered"
                  @click="openEditCard(card)"
                  class="btn btn-sm btn-info"
                >
                  Edit
                </button>

                <!-- Delete card -->
                <button
                  v-if="isSuperAdmin"
                  @click="deleteCard(card)"
                  class="btn btn-sm btn-error"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty state -->
    <div v-else class="text-center my-8 p-8 bg-base-200 rounded-lg">
      <p v-if="tab === 'unregistered'">
        No unregistered RFID cards detected yet.
      </p>
      <p v-else-if="tab === 'registered'">No registered RFID cards found.</p>
      <p v-else>No RFID cards found.</p>
    </div>

    <!-- Register/Edit modal -->
    <div v-if="showRegisterModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">
          {{
            isEditMode
              ? "Edit RFID Card"
              : pendingRegistration === "new"
              ? "Scan New RFID Card"
              : selectedCard
              ? "Register RFID Card"
              : "Register New RFID Card"
          }}
        </h3>

        <!-- Waiting for new card scan -->
        <div
          v-if="pendingRegistration === 'new' && awaitingConfirmation"
          class="my-4 p-4 bg-info text-info-content rounded-lg"
        >
          <h4 class="font-bold">Waiting for RFID card scan...</h4>
          <p class="mt-2">
            Please tap any unregistered RFID card on the scanner.
          </p>
          <div class="mt-4 flex justify-center">
            <span class="loading loading-spinner loading-lg"></span>
          </div>
          <div class="mt-6 flex justify-end">
            <button
              type="button"
              class="btn btn-ghost"
              @click="handleModalClose"
            >
              Cancel
            </button>
          </div>
        </div>

        <!-- Waiting for confirmation tap -->
        <div
          v-else-if="
            awaitingConfirmation &&
            pendingRegistration &&
            pendingRegistration !== 'new'
          "
          class="my-4 p-4 bg-warning text-warning-content rounded-lg"
        >
          <h4 class="font-bold">Waiting for confirmation tap...</h4>
          <p class="mt-2">
            Please tap the RFID card "{{ pendingRegistration }}" again to
            confirm and complete registration.
          </p>
        </div>

        <!-- Registration form -->
        <form
          v-if="
            isEditMode ||
            !pendingRegistration ||
            pendingRegistration !== 'new' ||
            !awaitingConfirmation
          "
          @submit.prevent="handleFormSubmit"
          class="mt-4 space-y-4"
        >
          <div class="form-control">
            <label class="label">
              <span class="label-text">Tag ID</span>
            </label>
            <input
              v-model="formData.tagId"
              type="text"
              placeholder="RFID Tag ID"
              class="input input-bordered"
              :readonly="!!selectedCard || !!formData.tagId"
              required
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Unit Number</span>
            </label>
            <input
              v-model="formData.metadata.unitNumber"
              type="text"
              placeholder="e.g., TR-0123"
              class="input input-bordered"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Assign to User (Optional)</span>
            </label>
            <input
              v-model="userSearchQuery"
              type="text"
              placeholder="Search users by name or email..."
              class="input input-bordered input-sm mb-2"
            />
            <select
              v-model="formData.userId"
              class="select select-bordered"
              size="8"
            >
              <option :value="undefined">Not assigned</option>
              <option
                v-for="user in filteredUsers"
                :key="user.id"
                :value="user.id"
              >
                {{ user.name }} ({{ user.email }})
              </option>
            </select>
            <div
              v-if="filteredUsers.length === 0 && userSearchQuery"
              class="text-sm text-warning mt-1"
            >
              No users found matching "{{ userSearchQuery }}"
            </div>
          </div>

          <div v-if="isEditMode" class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Card Active</span>
              <input
                type="checkbox"
                class="toggle toggle-success"
                v-model="formData.isActive"
              />
            </label>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Notes</span>
            </label>
            <textarea
              v-model="formData.metadata.notes"
              class="textarea textarea-bordered"
              placeholder="Optional notes about this card"
            ></textarea>
          </div>

          <div class="modal-action">
            <button
              type="button"
              @click="handleModalClose"
              class="btn btn-ghost"
            >
              Cancel
            </button>
            <button type="submit" class="btn btn-primary">
              {{
                isEditMode
                  ? "Save Changes"
                  : awaitingConfirmation
                  ? "Complete Registration"
                  : "Continue & Wait for Tap"
              }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
