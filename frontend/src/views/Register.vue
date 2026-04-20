<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
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
import type { RegisterData } from "../services/auth";

const router = useRouter();
const userData = ref<RegisterData>({
  name: "",
  email: "",
  password: "",
  role: "driver", // Default role
});
const confirmPassword = ref("");
const loading = ref(false);
const error = ref("");
const success = ref(""); // Add success message
const showPassword = ref(false);
const showConfirmPassword = ref(false);
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

// Password strength validation
const passwordStrength = ref({
  valid: false,
  score: 0,
  feedback: [] as string[],
});

// Watch password changes for real-time validation
watch(
  () => userData.value.password,
  (newPassword) => {
    if (newPassword.length > 0) {
      passwordStrength.value =
        authService.validatePasswordStrength(newPassword);
    } else {
      passwordStrength.value = { valid: false, score: 0, feedback: [] };
    }
  }
);

// Computed properties for password strength display
const passwordStrengthColor = computed(() => {
  const score = passwordStrength.value.score;
  if (score === 0) return "bg-error";
  if (score === 1) return "bg-error";
  if (score === 2) return "bg-warning";
  if (score === 3) return "bg-info";
  return "bg-success";
});

const passwordStrengthText = computed(() => {
  const score = passwordStrength.value.score;
  if (score === 0) return "Very Weak";
  if (score === 1) return "Weak";
  if (score === 2) return "Fair";
  if (score === 3) return "Good";
  return "Strong";
});

const passwordStrengthWidth = computed(() => {
  const score = passwordStrength.value.score;
  return `${(score / 4) * 100}%`;
});

const passwordsMatch = computed(() => {
  if (confirmPassword.value.length === 0) return true;
  return userData.value.password === confirmPassword.value;
});

const register = async () => {
  // Validate passwords match
  if (userData.value.password !== confirmPassword.value) {
    error.value = "Passwords do not match.";
    return;
  }

  // Validate password strength
  if (!passwordStrength.value.valid) {
    error.value =
      "Password does not meet minimum requirements (at least 15 characters).";
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    const response = await authService.register(userData.value);

    // Check if email verification is required
    // Note: API interceptor extracts 'data' field, so response IS the data
    if (response?.verified === false) {
      // Show success message
      success.value = `✅ Account created! Check your email (${response.email}) for the verification code.`;
      error.value = "";

      // Show toast and wait 2 seconds, then redirect
      toastSuccess &&
        toastSuccess(
          `Account created — check ${response.email} for verification`
        );
      setTimeout(() => {
        router.push({
          name: "VerifyEmail",
          query: { email: response.email },
        });
      }, 2000);
    } else if (response?.token) {
      // Legacy: if token is present, user is verified
      success.value = "✅ Registration successful!";
      authService.saveUserData(response);
      toastSuccess && toastSuccess("Registration successful — welcome!");

      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    } else {
      // Fallback - show message
      success.value = "✅ Registration successful! Redirecting...";
      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    }
  } catch (err: any) {
    success.value = ""; // Clear success on error

    // Handle validation errors with detailed feedback
    if (err.response?.status === 400) {
      error.value =
        err.message || "Invalid registration data. Please check all fields.";
    }
    // Handle rate limiting
    else if (err.response?.status === 429) {
      error.value =
        err.message ||
        "Too many registration attempts. Please try again later.";
    }
    // Generic error
    else {
      const msg = err.message || "Registration failed. Please try again.";
      error.value = msg;
      toastError && toastError(msg);
    }
  } finally {
    loading.value = false;
  }
};

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
          Register for TagSakay
        </h2>

        <div v-if="error" class="alert alert-error mb-6" role="alert">
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

        <div v-if="success" class="alert alert-success mb-6" role="alert">
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

        <form @submit.prevent="register" class="space-y-6">
          <div class="form-control w-full">
            <label class="label" for="name">
              <span class="label-text text-base font-medium">Full Name</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              v-model="userData.name"
              placeholder="John Doe"
              class="input input-bordered input-primary w-full"
              required
              autocomplete="name"
            />
          </div>

          <div class="form-control w-full">
            <label class="label" for="email">
              <span class="label-text text-base font-medium">Email</span>
            </label>
            <input
              type="email"
              id="email"
              name="email"
              v-model="userData.email"
              placeholder="email@example.com"
              class="input input-bordered input-primary w-full"
              required
              autocomplete="email"
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
                v-model="userData.password"
                placeholder="Password (min 15 characters)"
                class="input input-bordered input-primary w-full pr-14"
                required
                autocomplete="new-password"
              />
              <button
                type="button"
                aria-label="Toggle password visibility"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-primary z-20 pointer-events-auto opacity-100 focus:outline-none"
                @click="showPassword = !showPassword"
              >
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
            <!-- Password Strength Indicator -->
            <div v-if="userData.password.length > 0" class="mt-2 space-y-1">
              <div class="flex items-center justify-between text-xs">
                <span class="label-text">Password Strength:</span>
                <span
                  :class="[
                    'font-semibold',
                    passwordStrengthColor.replace('bg-', 'text-'),
                  ]"
                >
                  {{ passwordStrengthText }}
                </span>
              </div>
              <div class="w-full bg-base-300 rounded-full h-2 overflow-hidden">
                <div
                  :class="[
                    'h-full transition-all duration-300',
                    passwordStrengthColor,
                  ]"
                  :style="{ width: passwordStrengthWidth }"
                ></div>
              </div>
              <ul class="text-xs space-y-1 mt-2 ml-4">
                <li
                  v-for="(feedback, index) in passwordStrength.feedback"
                  :key="index"
                  :class="
                    passwordStrength.score >= 3
                      ? 'text-success'
                      : 'text-warning'
                  "
                >
                  {{ feedback }}
                </li>
              </ul>
            </div>
          </div>

          <div class="form-control w-full">
            <label class="label" for="confirmPassword">
              <span class="label-text text-base font-medium"
                >Confirm Password</span
              >
            </label>
            <div class="relative">
              <input
                :type="showConfirmPassword ? 'text' : 'password'"
                id="confirmPassword"
                name="confirmPassword"
                v-model="confirmPassword"
                placeholder="Confirm Password"
                :class="[
                  'input input-bordered w-full pr-14',
                  passwordsMatch ? 'input-primary' : 'input-error',
                ]"
                required
                autocomplete="new-password"
              />
              <button
                type="button"
                aria-label="Toggle confirm password visibility"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-primary z-20 pointer-events-auto opacity-100 focus:outline-none"
                @click="showConfirmPassword = !showConfirmPassword"
              >
                <svg
                  v-if="!showConfirmPassword"
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
            <label
              class="label"
              v-if="!passwordsMatch && confirmPassword.length > 0"
            >
              <span class="label-text-alt text-error"
                >❌ Passwords do not match</span
              >
            </label>
            <label
              class="label"
              v-else-if="passwordsMatch && confirmPassword.length > 0"
            >
              <span class="label-text-alt text-success"
                >✅ Passwords match</span
              >
            </label>
          </div>

          <div class="form-control w-full">
            <label class="label" for="rfidTag">
              <span class="label-text text-base font-medium"
                >RFID Tag
                <span class="text-xs opacity-70">(Optional)</span></span
              >
            </label>
            <input
              type="text"
              id="rfidTag"
              name="rfidTag"
              v-model="userData.rfidTag"
              placeholder="RFID Tag ID"
              class="input input-bordered input-primary w-full"
              autocomplete="off"
            />
          </div>

          <div class="card-actions justify-end mt-8">
            <button
              type="submit"
              class="btn btn-primary w-full text-base"
              :disabled="loading || !passwordStrength.valid || !passwordsMatch"
            >
              <span
                class="loading loading-spinner loading-sm"
                v-if="loading"
              ></span>
              <span v-if="loading">Registering...</span>
              <span
                v-else-if="
                  !passwordStrength.valid && userData.password.length > 0
                "
              >
                ⚠️ Weak Password
              </span>
              <span v-else-if="!passwordsMatch && confirmPassword.length > 0">
                ❌ Passwords Don't Match
              </span>
              <span v-else>Register</span>
            </button>
          </div>
        </form>

        <div class="divider my-8">OR</div>

        <div class="text-center">
          <router-link
            to="/login"
            class="link link-hover link-primary text-base"
          >
            Already have an account? Login
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
