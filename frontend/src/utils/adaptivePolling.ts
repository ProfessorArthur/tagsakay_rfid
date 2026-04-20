export type AdaptivePollingTask = () => Promise<void>;

export interface AdaptivePollingOptions {
  baseIntervalMs: number;
  maxIntervalMs?: number;
  maxBackoffExp?: number;
  pauseWhenHidden?: boolean;
  immediate?: boolean;
  onError?: (error: unknown, consecutiveErrors: number) => void;
}

export interface AdaptivePoller {
  start: () => void;
  stop: () => void;
  triggerNow: () => void;
  isRunning: () => boolean;
}

const DEFAULT_MAX_BACKOFF_EXP = 4; // 2^4 = 16x

export const createAdaptivePoller = (
  task: AdaptivePollingTask,
  options: AdaptivePollingOptions
): AdaptivePoller => {
  const baseIntervalMs = Math.max(500, options.baseIntervalMs);
  const maxIntervalMs = Math.max(
    options.maxIntervalMs ?? baseIntervalMs * 6,
    baseIntervalMs
  );
  const maxBackoffExp = Math.max(
    0,
    options.maxBackoffExp ?? DEFAULT_MAX_BACKOFF_EXP
  );
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const immediate = options.immediate ?? true;

  let timeoutId: number | null = null;
  let running = false;
  let consecutiveErrors = 0;

  const clearTimer = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    timeoutId = window.setTimeout(() => {
      void tick();
    }, delayMs);
  };

  const getNextDelay = () => {
    if (consecutiveErrors === 0) {
      return baseIntervalMs;
    }
    const backoffMultiplier = 2 ** Math.min(consecutiveErrors, maxBackoffExp);
    return Math.min(baseIntervalMs * backoffMultiplier, maxIntervalMs);
  };

  const tick = async () => {
    if (!running) {
      return;
    }

    if (
      pauseWhenHidden &&
      typeof document !== "undefined" &&
      document.hidden
    ) {
      schedule(baseIntervalMs);
      return;
    }

    try {
      await task();
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      options.onError?.(error, consecutiveErrors);
    }

    if (!running) {
      return;
    }

    schedule(getNextDelay());
  };

  const onVisibilityChange = () => {
    if (!running || !pauseWhenHidden || typeof document === "undefined") {
      return;
    }
    if (!document.hidden) {
      clearTimer();
      void tick();
    }
  };

  return {
    start() {
      if (running) {
        return;
      }
      running = true;

      if (pauseWhenHidden && typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibilityChange);
      }

      if (immediate) {
        void tick();
      } else {
        schedule(baseIntervalMs);
      }
    },

    stop() {
      running = false;
      clearTimer();

      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    },

    triggerNow() {
      if (!running) {
        return;
      }
      clearTimer();
      void tick();
    },

    isRunning() {
      return running;
    },
  };
};
