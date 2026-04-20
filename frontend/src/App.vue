<script setup lang="ts">
import { RouterView, useRouter, useRoute } from "vue-router";
import {
  ref,
  watchEffect,
  onMounted,
  computed,
  defineAsyncComponent,
  onUnmounted,
} from "vue";

const SidebarLayout = defineAsyncComponent(
  () => import("./components/SidebarLayout.vue")
);
const ToastContainer = defineAsyncComponent(
  () => import("./components/ToastContainer.vue")
);

const getIsLoggedIn = (): boolean => !!localStorage.getItem("token");

const router = useRouter();
const route = useRoute();
const isLoggedIn = ref(getIsLoggedIn());

// Check if current route requires authentication
const isAuthRoute = computed(() => {
  return Boolean(route.meta.requiresAuth);
});

const isPublicLanding = computed(() => {
  return Boolean(route.meta.publicLanding);
});

const showToastContainer = computed(() => {
  return !isPublicLanding.value;
});

// Listen for changes in localStorage to update isLoggedIn reactively
const handleStorage = () => {
  isLoggedIn.value = getIsLoggedIn();
  checkAuthentication();
};

window.addEventListener("storage", handleStorage);

// Function to check authentication and redirect if needed
const checkAuthentication = () => {
  isLoggedIn.value = getIsLoggedIn();

  const requiresAuth = Boolean(route.meta.requiresAuth);
  const requiresGuest = Boolean(route.meta.requiresGuest);

  if (!isLoggedIn.value && requiresAuth) {
    router.push("/login");
    return;
  }

  if (isLoggedIn.value && requiresGuest) {
    router.push("/dashboard");
  }
};

// Watch for route changes and update isLoggedIn
watchEffect(checkAuthentication);

// Initial check on component mount
onMounted(checkAuthentication);
onUnmounted(() => {
  window.removeEventListener("storage", handleStorage);
});
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <!-- Use sidebar layout for authenticated routes -->
    <SidebarLayout v-if="isLoggedIn && isAuthRoute">
      <RouterView />
    </SidebarLayout>

    <!-- Use simple layout for login/register pages -->
    <main v-else class="container mx-auto px-4 py-8">
      <RouterView />
    </main>

    <!-- Global Toast Container -->
    <ToastContainer v-if="showToastContainer" />
  </div>
</template>

<style>
body {
  font-family: "Inter", sans-serif;
}
</style>
