<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { globalSearch } from "../services/search";
import userService, { type User } from "../services/user";

// State management
const users = ref<User[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const showModal = ref(false);
const editingUser = ref<User | null>(null);
const isCreating = ref(false);

// Search, sort, and filter state
// Local search (page-specific) will take precedence over the top/global search if present
const localSearchQuery = ref("");
const effectiveSearch = computed(() => {
  return (localSearchQuery.value || globalSearch.value || "").trim();
});
const sortAsc = ref(true); // true = A-Z, false = Z-A
const sortField = ref<"name" | "email" | "role">("name");
const roleFilter = ref<"all" | "driver" | "admin" | "superadmin">("all");
const statusFilter = ref<"all" | "active" | "inactive">("all");

// Form data
const formData = ref({
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  role: "driver",
  isActive: true,
});

// Fetch users on component mount
onMounted(async () => {
  await fetchUsers();
});

// Computed property for filtered and sorted users
const displayedUsers = computed(() => {
  let filtered = [...users.value];

  // Apply role filter
  if (roleFilter.value !== "all") {
    filtered = filtered.filter((user) => user.role === roleFilter.value);
  }

  // Apply status filter
  if (statusFilter.value === "active") {
    filtered = filtered.filter((user) => user.isActive === true);
  } else if (statusFilter.value === "inactive") {
    filtered = filtered.filter((user) => user.isActive === false);
  }

  // Apply search filter (page local override, otherwise use global)
  const q = effectiveSearch.value.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((user) => {
      const nameMatch = user.name.toLowerCase().includes(q);
      const emailMatch = user.email.toLowerCase().includes(q);
      const roleMatch = user.role.toLowerCase().includes(q);
      return nameMatch || emailMatch || roleMatch;
    });
  }

  // Sort by selected field
  const sorted = [...filtered].sort((a, b) => {
    let aValue = "";
    let bValue = "";

    if (sortField.value === "name") {
      aValue = a.name.toLowerCase();
      bValue = b.name.toLowerCase();
    } else if (sortField.value === "email") {
      aValue = a.email.toLowerCase();
      bValue = b.email.toLowerCase();
    } else if (sortField.value === "role") {
      aValue = a.role.toLowerCase();
      bValue = b.role.toLowerCase();
    }

    if (aValue < bValue) return sortAsc.value ? -1 : 1;
    if (aValue > bValue) return sortAsc.value ? 1 : -1;
    return 0;
  });

  return sorted;
});

// Fetch users from API
async function fetchUsers() {
  loading.value = true;
  error.value = null;

  try {
    const response = await userService.getUsers();
    users.value = response || [];
  } catch (err) {
    error.value = "Failed to load users. Please try again.";
    console.error("Error fetching users:", err);
  } finally {
    loading.value = false;
  }
}

// Open modal for creating a new user
function openCreateModal() {
  isCreating.value = true;
  editingUser.value = null;
  formData.value = {
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "driver",
    isActive: true,
  };
  showModal.value = true;
}

// Open modal for editing an existing user
function openEditModal(user: User) {
  isCreating.value = false;
  editingUser.value = user;
  formData.value = {
    name: user.name,
    email: user.email,
    password: "", // Don't prefill password for security
    confirmPassword: "",
    role: user.role,
    isActive: user.isActive,
  };
  showModal.value = true;
}

// Handle form submission (create or update)
import useToast from "../composables/useToast";
const { success: toastSuccess, error: toastError } = useToast();

async function submitForm() {
  try {
    // Validate password confirmation
    if (
      (isCreating.value || formData.value.password) &&
      formData.value.password !== formData.value.confirmPassword
    ) {
      error.value = "Passwords do not match";
      return;
    }

    if (isCreating.value) {
      // Create new user
      await userService.createUser(formData.value);
      toastSuccess("User created successfully");
    } else if (editingUser.value) {
      // Update existing user
      await userService.updateUser(editingUser.value.id, formData.value);
      toastSuccess("User updated successfully");
    }

    // Close modal and refresh data
    showModal.value = false;
    await fetchUsers();
  } catch (err) {
    console.error("Error saving user:", err);
    error.value = "Failed to save user. Please try again.";
    toastError("Failed to save user");
  }
}

// Delete a user
async function deleteUser(userId: number) {
  if (!confirm("Are you sure you want to delete this user?")) {
    return;
  }

  try {
    await userService.deleteUser(userId);
    await fetchUsers();
    toastSuccess("User deleted");
  } catch (err) {
    console.error("Error deleting user:", err);
    error.value = "Failed to delete user. Please try again.";
    toastError("Failed to delete user");
  }
}

// Toggle user active status
async function toggleUserStatus(user: User) {
  try {
    await userService.updateUser(user.id, { isActive: !user.isActive });
    await fetchUsers();
  } catch (err) {
    console.error("Error updating user status:", err);
    error.value = "Failed to update user status. Please try again.";
  }
}
</script>

<template>
  <div class="p-4">
    <div
      class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6"
    >
      <h1 class="text-2xl font-bold">User Management</h1>
      <button
        @click="openCreateModal"
        class="btn btn-primary self-start sm:self-auto"
      >
        <i class="fas fa-plus mr-2"></i> Add User
      </button>
    </div>

    <!-- Search and Filter Controls -->
    <div class="mb-4 space-y-3">
      <!-- Search bar -->
      <div class="form-control w-full sm:w-96">
        <input
          v-model="localSearchQuery"
          type="text"
          placeholder="Search by name, email, or role..."
          class="input input-sm input-bordered w-full"
        />
      </div>

      <!-- Filters and sorting -->
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="sortField"
          class="select select-sm select-bordered min-w-[160px]"
          title="Choose sort field"
        >
          <option value="name">Sort by Name</option>
          <option value="email">Sort by Email</option>
          <option value="role">Sort by Role</option>
        </select>

        <button
          class="btn btn-sm"
          :aria-label="sortAsc ? 'Sort descending' : 'Sort ascending'"
          @click="sortAsc = !sortAsc"
          title="Toggle sort order"
        >
          <span v-if="sortAsc">A–Z ▲</span>
          <span v-else>Z–A ▼</span>
        </button>

        <select v-model="roleFilter" class="select select-sm select-bordered">
          <option value="all">All Roles</option>
          <option value="driver">Driver</option>
          <option value="admin">Admin</option>
          <option value="superadmin">Super Admin</option>
        </select>

        <select v-model="statusFilter" class="select select-sm select-bordered">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <!-- Results count -->
      <div
        class="inline-flex items-center gap-2 rounded-lg bg-info text-info-content px-4 py-2"
      >
        <span class="font-semibold">Total users:</span>
        <span>{{ displayedUsers.length }} / {{ users.length }}</span>
      </div>
    </div>

    <!-- Alert for errors -->
    <div v-if="error" class="alert alert-error mb-4">
      <div class="flex-1">
        <label>{{ error }}</label>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex justify-center my-8">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <!-- Users table -->
    <div v-else class="overflow-x-auto">
      <table class="table w-full responsive-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th class="hidden md:table-cell">RFID Tags</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="user in displayedUsers"
            :key="user.id"
            :class="{ 'opacity-50': !user.isActive }"
          >
            <td data-label="Name">{{ user.name }}</td>
            <td data-label="Email">{{ user.email }}</td>
            <td data-label="Role">
              <span
                class="badge"
                :class="{
                  'badge-primary': user.role === 'admin',
                  'badge-secondary': user.role === 'superadmin',
                  'badge-accent': user.role === 'driver',
                }"
                >{{ user.role }}</span
              >
            </td>
            <td data-label="Status">
              <span
                class="badge"
                :class="user.isActive ? 'badge-success' : 'badge-error'"
              >
                {{ user.isActive ? "Active" : "Inactive" }}
              </span>
            </td>
            <td data-label="RFID Tags" class="hidden md:table-cell">
              <span
                v-if="user.rfids && user.rfids.length"
                class="badge badge-info"
              >
                {{ user.rfids.length }} tags
              </span>
              <span v-else>No tags</span>
            </td>
            <td data-label="Actions">
              <div class="flex space-x-2">
                <button
                  @click="openEditModal(user)"
                  class="btn btn-sm btn-info"
                >
                  Edit
                </button>
                <button
                  @click="toggleUserStatus(user)"
                  class="btn btn-sm"
                  :class="user.isActive ? 'btn-warning' : 'btn-success'"
                >
                  {{ user.isActive ? "Disable" : "Enable" }}
                </button>
                <button
                  @click="deleteUser(user.id)"
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

    <!-- User Modal (Create/Edit) -->
    <div v-if="showModal" class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">
          {{ isCreating ? "Create New User" : "Edit User" }}
        </h3>

        <form @submit.prevent="submitForm" class="mt-4 space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Name</span>
            </label>
            <input
              v-model="formData.name"
              type="text"
              placeholder="Full Name"
              class="input input-bordered"
              required
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Email</span>
            </label>
            <input
              v-model="formData.email"
              type="email"
              placeholder="Email"
              class="input input-bordered"
              required
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text"
                >Password
                {{ !isCreating ? "(Leave empty to keep current)" : "" }}</span
              >
            </label>
            <input
              v-model="formData.password"
              type="password"
              placeholder="Password"
              class="input input-bordered"
              :required="isCreating"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Confirm Password</span>
            </label>
            <input
              v-model="formData.confirmPassword"
              type="password"
              placeholder="Confirm Password"
              class="input input-bordered"
              :required="isCreating || formData.password !== ''"
            />
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">Role</span>
            </label>
            <select v-model="formData.role" class="select select-bordered">
              <option value="driver">Driver</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Super Admin</option>
            </select>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Active</span>
              <input
                v-model="formData.isActive"
                type="checkbox"
                class="toggle toggle-success"
              />
            </label>
          </div>

          <div class="modal-action">
            <button
              type="button"
              @click="showModal = false"
              class="btn btn-ghost"
            >
              Cancel
            </button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

