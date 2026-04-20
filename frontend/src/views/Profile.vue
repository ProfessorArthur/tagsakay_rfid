<script setup lang="ts">
import { computed } from "vue";
import authService from "../services/auth";
import Identicon from "../components/Identicon.vue";

const user = computed(() => authService.getUser());
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">My Profile</h1>
    </div>

    <div class="card bg-base-200 p-6 max-w-3xl">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
        <div class="avatar mx-auto sm:mx-0">
          <Identicon
            :seed="user?.email || user?.name || String(user?.id)"
            :size="80"
            className="rounded-full"
          />
        </div>

        <div class="sm:col-span-2">
          <div class="mb-2">
            <div class="text-sm text-base-content/70">Name</div>
            <div class="text-lg font-semibold">{{ user?.name || "—" }}</div>
          </div>

          <div class="mb-2">
            <div class="text-sm text-base-content/70">Email</div>
            <div class="text-lg font-semibold">{{ user?.email || "—" }}</div>
          </div>

          <div>
            <div class="text-sm text-base-content/70">Role</div>
            <div class="text-lg font-semibold">{{ user?.role || "—" }}</div>
          </div>
        </div>
      </div>

      <div class="divider my-6"></div>

      <p class="text-sm text-base-content/70">
        This is a lightweight profile page. For now you can view your profile
        details here.
      </p>
      <div class="mt-4 flex gap-2">
        <button
          class="btn btn-sm btn-primary"
          @click="$router.push('/settings')"
        >
          Account Settings
        </button>
        <button class="btn btn-sm" @click="$router.push('/users')">
          Manage Users
        </button>
      </div>
    </div>
  </div>
</template>
