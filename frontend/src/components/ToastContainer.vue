<template>
  <div
    class="fixed top-4 left-2 right-2 sm:left-auto sm:right-4 z-50 flex flex-col items-stretch sm:items-end gap-2"
  >
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast toast-top toast-end"
      :class="[toastClass(t.type)]"
    >
      <div>
        <span>{{ t.message }}</span>
      </div>
      <div class="flex-none">
        <button class="btn btn-ghost btn-sm" @click="dismissToast(t.id)">
          ✕
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import useToast from "../composables/useToast";

const { toasts, dismissToast } = useToast();

const toastClass = (type: string) => {
  switch (type) {
    case "success":
      return "toast-success";
    case "error":
      return "toast-error";
    case "warning":
      return "toast-warning";
    default:
      return "toast-info";
  }
};
</script>

<style scoped>
/* Override DaisyUI's default fixed/bottom toast behaviour so toasts
   are positioned by this container (fixed top-right). DaisyUI places
   .toast as position:fixed with bottom:1rem by default which forced
   them into the bottom-right. Make them static/relative so they stack
   inside the fixed container above. */
.toast {
  position: static !important;
  top: auto !important;
  bottom: auto !important;
  inset-inline: auto !important;
  translate: none !important;
  transform: none !important;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  min-width: 220px;
  width: 100%;
  max-width: min(28rem, calc(100vw - 1rem));
  border-radius: 0.375rem;
}
.toast-success {
  background: rgba(34, 197, 94, 0.85); /* stronger visibility */
  border: 1px solid rgba(34, 197, 94, 0.25);
  color: #0b0f0b; /* dark text for high contrast */
}
.toast-error {
  background: rgba(239, 68, 68, 0.9);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #fff;
}
.toast-info {
  background: rgba(59, 130, 246, 0.9);
  border: 1px solid rgba(59, 130, 246, 0.25);
  color: #fff;
}
.toast-warning {
  background: rgba(245, 158, 11, 0.9);
  border: 1px solid rgba(245, 158, 11, 0.25);
  color: #111;
}

/* Slight elevation so toasts are visibly above the page */
.toast {
  box-shadow: 0 6px 18px rgba(2, 6, 23, 0.45);
}

@media (max-width: 640px) {
  .toast {
    min-width: 0;
    max-width: calc(100vw - 1rem);
  }
}
</style>
