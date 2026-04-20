<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import authService from "../services/auth";
import useToast from "../composables/useToast";
import {
  applyThemeMode,
  getStoredThemeMode,
  setStoredThemeMode,
  type ThemeName,
} from "../utils/theme";

const { success: toastSuccess, error: toastError } = useToast();
import type { LoginCredentials } from "../services/auth";

const router = useRouter();
const credentials = ref<LoginCredentials>({
  email: "",
  password: "",
});
const loading = ref(false);
const error = ref("");
const showPassword = ref(false);
const rateLimited = ref(false);
const retryAfter = ref("");
const accountLocked = ref(false);
const activeTheme = ref<ThemeName>(applyThemeMode(getStoredThemeMode()));

const nextThemeLabel = computed(() =>
  activeTheme.value === "dark" ? "light" : "dark"
);

const syncActiveTheme = () => {
  if (typeof document === "undefined") {
    return;
  }

  const current = document.documentElement.getAttribute("data-theme");
  activeTheme.value = current === "dark" ? "dark" : "light";
};

const handleThemeChange = () => {
  syncActiveTheme();
};

const toggleTheme = () => {
  const nextTheme: ThemeName = activeTheme.value === "dark" ? "light" : "dark";
  setStoredThemeMode(nextTheme);
  activeTheme.value = applyThemeMode(nextTheme);
};

const login = async () => {
  loading.value = true;
  error.value = "";
  rateLimited.value = false;
  accountLocked.value = false;

  try {
    const response = await authService.login(credentials.value);
    authService.saveUserData(response);
    toastSuccess && toastSuccess("Logged in — welcome back");
    router.push("/dashboard");
  } catch (err: any) {
    // Handle rate limiting (429)
    if (err.response?.status === 429) {
      rateLimited.value = true;
      const retryAfterValue = err.response.data?.retryAfter || "later";
      retryAfter.value = retryAfterValue;
      error.value = `Too many login attempts. Please try again ${retryAfterValue}.`;

      // Auto-clear rate limit message after retry time
      if (retryAfterValue.includes("seconds")) {
        const seconds = parseInt(retryAfterValue);
        if (!isNaN(seconds)) {
          setTimeout(() => {
            rateLimited.value = false;
            error.value = "";
          }, seconds * 1000);
        }
      }
    }
    // Handle account lockout (403)
    else if (err.response?.status === 403) {
      accountLocked.value = true;
      error.value =
        err.message ||
        "Account is temporarily locked. Please contact support or try again later.";
    }
    // Handle validation errors (400)
    else if (err.response?.status === 400) {
      error.value = err.message || "Invalid email or password format.";
    }
    // Generic error
    else {
      const msg =
        err?.message || "Login failed. Please check your credentials.";
      error.value = msg;
      toastError && toastError(msg);
    }
  } finally {
    loading.value = false;
  }
};

// Computed property for error alert styling
const errorAlertClass = computed(() => {
  if (rateLimited.value) return "alert-warning";
  if (accountLocked.value) return "alert-error";
  return "alert-error";
});

onMounted(() => {
  syncActiveTheme();
  window.addEventListener("tagsakay-theme-change", handleThemeChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("tagsakay-theme-change", handleThemeChange);
});
</script>

<template>
  <div class="flex min-h-[85vh] items-center justify-center p-6">
    <div class="card bg-base-200 shadow-xl w-full max-w-lg">
      <div class="card-body p-8">
        <div class="flex justify-end mb-2">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :aria-label="`Switch to ${nextThemeLabel} mode`"
            :title="`Switch to ${nextThemeLabel} mode`"
            @click="toggleTheme"
          >
            <svg
              v-if="activeTheme === 'dark'"
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm0 13a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm8-5a1 1 0 010 2h-1a1 1 0 110-2h1zM4 10a1 1 0 010 2H3a1 1 0 110-2h1zm10.95 4.536a1 1 0 011.414 1.414l-.707.707a1 1 0 01-1.414-1.414l.707-.707zM5.757 5.343a1 1 0 010 1.414l-.707.707A1 1 0 113.636 6.05l.707-.707a1 1 0 011.414 0zm10.607 2.121a1 1 0 10-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM5.05 14.95a1 1 0 00-1.414 1.414l.707.707a1 1 0 001.414-1.414l-.707-.707zM10 6a4 4 0 100 8 4 4 0 000-8z"
              />
            </svg>
            <svg
              v-else
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
                d="M21.752 15.002A9.718 9.718 0 0112 21c-5.385 0-9.75-4.365-9.75-9.75 0-4.055 2.477-7.53 6-9 0 0-1.5 6 3 9.75s10.5 3 10.5 3z"
              />
            </svg>
            <span class="ml-2">{{ nextThemeLabel }} mode</span>
          </button>
        </div>
        <h2 class="card-title text-3xl font-bold justify-center mb-6">
          Login to TagSakay
        </h2>

        <div :class="['alert', errorAlertClass, 'mb-6']" v-if="error">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6 shrink-0 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              v-if="!rateLimited"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <path
              v-else
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div class="flex-1">
            <span>{{ error }}</span>
            <div v-if="rateLimited" class="text-sm mt-1 opacity-80">
              ⏱️ Rate limit will reset automatically. Please wait before trying
              again.
            </div>
            <div v-if="accountLocked" class="text-sm mt-1 opacity-80">
              🔒 Your account has been temporarily locked for security. Please
              wait 15 minutes.
            </div>
          </div>
        </div>

        <form @submit.prevent="login" class="space-y-6">
          <div class="form-control w-full">
            <label class="label" for="email">
              <span class="label-text text-base font-medium">Email</span>
            </label>
            <input
              type="email"
              id="email"
              name="email"
              v-model="credentials.email"
              placeholder="email@example.com"
              class="input input-bordered input-primary w-full"
              required
              autocomplete="username"
            />
          </div>

          <div class="form-control w-full">
            <label class="label" for="password">
              <span class="label-text text-base font-medium">Password</span>
            </label>
            <div class="relative">
              <input
                :type="showPassword ? 'text' : 'password'"
                id="password"
                name="password"
                v-model="credentials.password"
                placeholder="Password"
                class="input input-bordered input-primary w-full pr-14"
                required
                autocomplete="current-password"
              />
              <button
                type="button"
                aria-label="Toggle password visibility"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-primary z-20 pointer-events-auto opacity-100 focus:outline-none"
                @click="showPassword = !showPassword"
              >
                <!-- Eye icon when password is hidden -->
                <svg
                  v-if="!showPassword"
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
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                <!-- Eye-slash icon when password is visible -->
                <svg
                  v-else
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
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              </button>
            </div>
            <div class="label justify-end mt-3">
              <a href="#" class="label-text-alt link link-hover text-primary"
                >Forgot password?</a
              >
            </div>
          </div>

          <div class="card-actions justify-end mt-8">
            <button
              type="submit"
              class="btn btn-primary w-full text-base"
              :disabled="loading || rateLimited"
            >
              <span
                class="loading loading-spinner loading-sm"
                v-if="loading"
              ></span>
              <span v-if="rateLimited && !loading">⏱️ Please Wait</span>
              <span v-else-if="loading">Logging in...</span>
              <span v-else>Login</span>
            </button>
          </div>
        </form>

        <div class="divider my-8">OR</div>

        <div class="text-center">
          <router-link
            to="/register"
            class="link link-hover link-primary text-base"
            >Register a new account</router-link
          >
        </div>
      </div>
    </div>
  </div>
</template>
