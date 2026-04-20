export type ThemeName = "light" | "dark";
export type ThemeMode = ThemeName | "system";

const STORAGE_KEY = "tagsakay-theme-mode";
const SYSTEM_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const isThemeMode = (value: unknown): value is ThemeMode => {
  return value === "light" || value === "dark" || value === "system";
};

const getSystemTheme = (): ThemeName => {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SYSTEM_MEDIA_QUERY).matches
  ) {
    return "dark";
  }

  return "light";
};

export const resolveThemeMode = (mode: ThemeMode): ThemeName => {
  return mode === "system" ? getSystemTheme() : mode;
};

export const getStoredThemeMode = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
};

export const setStoredThemeMode = (mode: ThemeMode): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore storage write failures in restricted environments.
  }
};

export const applyThemeMode = (mode: ThemeMode): ThemeName => {
  if (typeof document === "undefined") {
    return resolveThemeMode(mode);
  }

  const resolved = resolveThemeMode(mode);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("tagsakay-theme-change", {
        detail: { mode, resolved },
      })
    );
  }

  return resolved;
};

export const initializeTheme = (): ThemeMode => {
  const mode = getStoredThemeMode();
  applyThemeMode(mode);
  return mode;
};

export const watchSystemThemeChanges = (): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const mediaQuery = window.matchMedia(SYSTEM_MEDIA_QUERY);
  const handler = () => {
    if (getStoredThemeMode() === "system") {
      applyThemeMode("system");
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }

  mediaQuery.addListener(handler);
  return () => mediaQuery.removeListener(handler);
};
