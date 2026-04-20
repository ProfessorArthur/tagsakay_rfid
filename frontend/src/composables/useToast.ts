import { ref } from "vue";

export type ToastType = "success" | "error" | "info" | "warning";
export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  timeout?: number; // milliseconds
}

const toasts = ref<Toast[]>([]);

const defaultTimeout = 4000;

const pushToast = (toast: Omit<Toast, "id">) => {
  const id = Math.random().toString(36).slice(2, 9);
  const t = { id, ...toast };
  toasts.value.push(t);
  if (t.timeout === undefined) t.timeout = defaultTimeout;
  if (t.timeout && t.timeout > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, t.timeout);
  }
  return id;
};

const dismissToast = (id: string) => {
  toasts.value = toasts.value.filter((t) => t.id !== id);
};

const success = (message: string, timeout?: number) =>
  pushToast({ type: "success", message, timeout });
const error = (message: string, timeout?: number) =>
  pushToast({ type: "error", message, timeout });
const info = (message: string, timeout?: number) =>
  pushToast({ type: "info", message, timeout });
const warning = (message: string, timeout?: number) =>
  pushToast({ type: "warning", message, timeout });

export function useToast() {
  return {
    toasts,
    pushToast,
    dismissToast,
    success,
    error,
    info,
    warning,
  };
}

export default useToast;
