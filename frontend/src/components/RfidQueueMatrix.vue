<script setup lang="ts">
import { computed, ref } from "vue";
import type { PropType } from "vue";
import rfidStatsService, {
  type CascadeSnapshot,
  type QueueCellState as ServiceQueueCellState,
  type RfidScanResult,
} from "../services/rfidStats";

const props = defineProps({
  rows: { type: Number, default: 8 },
  columns: { type: Number, default: 5 },
  scope: {
    type: String as PropType<"system" | "driver">,
    default: "system",
  },
});

const { recentScans, loading, error } = rfidStatsService;
const cascadeSnapshot = ref<CascadeSnapshot | null>(null);
const snapshotLoading = ref(false);
const snapshotError = ref<string | null>(null);

const isDriverScope = computed(() => props.scope === "driver");
const cardClasses = computed(() => [
  "queue-card",
  { "queue-card--compact": isDriverScope.value },
]);

const totalCells = computed(
  () => Math.max(1, props.rows) * Math.max(1, props.columns)
);

type QueueCellState = ServiceQueueCellState;
type QueueEntry = {
  id: string;
  value: string;
  state: QueueCellState;
  isLatest: boolean;
};

const extractSlotValue = (
  slot: CascadeSnapshot["slots"][number]
): string | null => {
  const candidates: unknown[] = [slot.displayValue, slot.ledValue];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" && typeof candidate !== "number") {
      continue;
    }
    const normalized = String(candidate).trim().toUpperCase();
    if (!normalized || normalized === "0" || normalized === "---") {
      continue;
    }
    return normalized;
  }
  return null;
};

const resolveUnit = (scan?: RfidScanResult | null): string => {
  if (!scan) return "---";
  const metadata = (scan.metadata ?? {}) as Record<string, unknown>;
  const candidate =
    scan.unitNumber ??
    metadata.unitNumber ??
    metadata.unit ??
    metadata.vehicleNumber ??
    metadata.vehicleId;
  if (candidate === undefined || candidate === null) return "---";
  const value = String(candidate).trim();
  return value.length ? value.toUpperCase() : "---";
};

const normalizeStateValue = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const resolveQueueState = (scan?: RfidScanResult | null): QueueCellState => {
  if (!scan) return "empty";
  const metadata = (scan.metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    metadata.queueState,
    metadata.queueStatus,
    metadata.state,
    metadata.status,
    metadata.stage,
    metadata.displayState,
    scan.eventType,
    scan.status,
  ];
  const normalized = candidates
    .map((candidate) => normalizeStateValue(candidate))
    .find((value) => value.length > 0);

  switch (normalized) {
    case "ONGOING":
    case "SERVING":
      return "ongoing";
    case "COMPLETED":
    case "DONE":
      return "completed";
    case "ERROR":
    case "FAILED":
    case "UNREGISTERED":
    case "UNAUTHORIZED":
      return "error";
    case "INFO":
    case "MODE":
      return "info";
    case "RESERVE":
    case "OVERRIDE_RESERVE":
      return "reserve";
    case "FIX":
    case "OVERRIDE_FIX":
      return "fix";
    default:
      if (scan.status === "failed" || scan.status === "unauthorized") {
        return "error";
      }
      return "default";
  }
};

const buildEntriesFromScans = (
  scans: RfidScanResult[] | null | undefined,
  limit: number
): QueueEntry[] => {
  const rows = Array.isArray(scans) ? scans : [];
  const baseEntries = rows.slice(0, limit).map((scan, index) => ({
    id: scan.id ?? `${scan.rfidTagId}-${index}`,
    value: resolveUnit(scan),
    state: resolveQueueState(scan),
    isLatest: true,
  }));

  if (baseEntries.length >= limit) return baseEntries;

  const placeholders = Array.from(
    { length: limit - baseEntries.length },
    (_, idx) => ({
      id: `empty-${idx}`,
      value: "---",
      state: "empty" as QueueCellState,
      isLatest: false,
    })
  );

  return [...baseEntries, ...placeholders];
};

const activeFeed = computed(() =>
  Array.isArray(recentScans.value) ? recentScans.value : []
);

const normalizeBooleanCandidate = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (
      ["on", "true", "enabled", "active", "operation", "operational"].includes(
        normalized
      )
    )
      return true;
    if (
      ["off", "false", "disabled", "inactive", "registration", "idle"].includes(
        normalized
      )
    )
      return false;
  }
  return undefined;
};

const resolveOperationModeFlag = (
  scan?: RfidScanResult | null
): boolean | undefined => {
  if (!scan) return undefined;
  const metadata = (scan.metadata ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    metadata.operationMode,
    metadata.operation_mode,
    metadata.operation,
    metadata.mode,
    metadata.queueMode,
    metadata.queue_mode,
    metadata.queueState,
    metadata.queue_state,
    metadata.displayState,
  ];
  for (const candidate of candidates) {
    const parsed = normalizeBooleanCandidate(candidate);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const detectedOperationMode = computed(() => {
  if (cascadeSnapshot.value) {
    return cascadeSnapshot.value.operationModeActive;
  }
  for (const scan of activeFeed.value) {
    const flag = resolveOperationModeFlag(scan);
    if (flag !== undefined) return flag;
  }
  return undefined;
});

const operationModeActive = computed(() =>
  detectedOperationMode.value === undefined ? true : detectedOperationMode.value
);

const buildEntriesFromSnapshot = (
  slots: CascadeSnapshot["slots"] | undefined
): QueueEntry[] => {
  const slotList = Array.isArray(slots) ? slots : [];

  // Build index arrays for each display value so we can mark earlier
  // occurrences as `completed` (cyan) and the last occurrence as the
  // active/latest entry (keeps its original state).
  const indicesByValue = new Map<string, number[]>();
  slotList.forEach((slot, index) => {
    const value = extractSlotValue(slot);
    if (!value) return;
    const arr = indicesByValue.get(value) ?? [];
    arr.push(index);
    indicesByValue.set(value, arr);
  });

  return slotList.map((slot, index) => {
    const displayValue = extractSlotValue(slot);
    if (!displayValue) {
      return {
        id: slot?.scanId ?? `slot-${slot?.slotIndex ?? index}`,
        value: "---",
        state: "empty",
        isLatest: false,
      };
    }

    const indices = indicesByValue.get(displayValue) ?? [];
    const lastIndex = indices.length ? indices[indices.length - 1] : undefined;
    const isLatest =
      lastIndex === undefined ? slot.isLatest ?? true : lastIndex === index;

    // If there are multiple occurrences and this is not the last one,
    // mark it as `completed` (cyan) and not latest. The latest keeps the
    // slot's original state and is marked latest.
    let stateToUse: QueueCellState = slot.state;
    if (indices.length > 1 && !isLatest) {
      stateToUse = "completed";
    }

    return {
      id: slot?.scanId ?? `slot-${slot?.slotIndex ?? index}`,
      value: displayValue,
      state: stateToUse,
      isLatest,
    };
  });
};

const queueEntries = computed<QueueEntry[]>(() => {
  if (cascadeSnapshot.value) {
    return buildEntriesFromSnapshot(cascadeSnapshot.value.slots);
  }

  return buildEntriesFromScans(activeFeed.value, totalCells.value);
});

const hasQueueContent = computed(() =>
  queueEntries.value.some((entry) => entry.value !== "---")
);

const QUEUE_STATE_PRIORITY: Record<QueueCellState, number> = {
  ongoing: 1,
  completed: 2,
  info: 3,
  error: 4,
  default: 5,
  stale: 6,
  empty: 7,
  reserve: 8,
  fix: 9,
};

const queueStateLabels: Record<QueueCellState, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  error: "Error",
  info: "Info",
  default: "Active",
  stale: "Previous",
  empty: "Idle",
  reserve: "Reserve",
  fix: "Fix",
};

const matrixRows = computed(() => {
  const entries = queueEntries.value;
  const rowCount = Math.max(1, props.rows);
  const columnCount = Math.max(1, props.columns);
  const totalSlots = rowCount * columnCount;
  const trimmed = entries.slice(0, totalSlots);
  const placeholdersNeeded = Math.max(totalSlots - trimmed.length, 0);

  const cells = [
    ...trimmed.map((entry) => ({
      id: entry.id,
      value: entry.value,
      // If snapshot-driven (cascadeSnapshot present) we trust the entry.state
      // produced by `buildEntriesFromSnapshot` (which marks earlier
      // occurrences as `completed`). For the fallback active feed we keep
      // the previous behavior of marking non-latest as `stale`.
      state: cascadeSnapshot.value
        ? entry.state
        : entry.isLatest
        ? entry.state
        : ("stale" as QueueCellState),
    })),
    ...Array.from({ length: placeholdersNeeded }, (_, index) => ({
      id: `empty-${index}`,
      value: "---",
      state: "empty" as QueueCellState,
    })),
  ];

  const rows: Array<
    Array<{ id: string; value: string; state: QueueCellState }>
  > = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const rowCells: Array<{
      id: string;
      value: string;
      state: QueueCellState;
    }> = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const dataIndex = columnIndex * rowCount + rowIndex; // column-major layout matches LED
      rowCells.push(
        cells[dataIndex] ?? {
          id: `empty-${dataIndex}`,
          value: "---",
          state: "empty",
        }
      );
    }
    rows.push(rowCells);
  }

  return rows;
});

const legendStates = computed<QueueCellState[]>(() => {
  const states = new Set<QueueCellState>();
  queueEntries.value.forEach((entry) => {
    states.add(entry.isLatest ? entry.state : "stale");
  });

  const orderedStates = Array.from(states)
    .filter((state) => state !== "empty")
    .sort((a, b) => QUEUE_STATE_PRIORITY[a] - QUEUE_STATE_PRIORITY[b]);

  if (!orderedStates.length && queueEntries.value.length) {
    orderedStates.push("default");
  }

  return orderedStates;
});

const lastUpdated = computed(() => {
  if (cascadeSnapshot.value?.lastUpdated) {
    return new Date(cascadeSnapshot.value.lastUpdated);
  }
  const latest = activeFeed.value[0] ?? null;
  return latest ? new Date(latest.scanTime) : null;
});

const lastUpdatedLabel = computed(() =>
  lastUpdated.value
    ? lastUpdated.value.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null
);

const fetchCascadeSnapshot = async () => {
  try {
    snapshotLoading.value = true;
    snapshotError.value = null;
    console.log(
      "RfidQueueMatrix: fetching cascade snapshot (limit=",
      totalCells.value,
      ")"
    );
    const fetched = await rfidStatsService.getCascadeSnapshot(totalCells.value);
    console.log("RfidQueueMatrix: fetched cascade snapshot:", fetched);
    cascadeSnapshot.value = fetched;
  } catch (err: any) {
    snapshotError.value =
      err?.response?.data?.message ||
      err?.message ||
      "Failed to fetch LED queue";
    console.error("RfidQueueMatrix: fetchCascadeSnapshot error:", err);
  } finally {
    snapshotLoading.value = false;
  }
};

const refreshQueue = async () => {
  if (isDriverScope.value) {
    await fetchCascadeSnapshot();
    return;
  }
  await fetchCascadeSnapshot();
  await rfidStatsService.getRecentScans(totalCells.value);
};

const serviceLoading = computed(
  () => snapshotLoading.value || (!isDriverScope.value && loading.value)
);
const refreshInProgress = computed(
  () => snapshotLoading.value || (!isDriverScope.value && loading.value)
);
const serviceError = computed(
  () =>
    snapshotError.value ||
    (!isDriverScope.value && !cascadeSnapshot.value ? error.value : null)
);
const showOperationModeBanner = computed(
  () => detectedOperationMode.value === false
);
const activeCellCount = computed(
  () => queueEntries.value.filter((entry) => entry.value !== "---").length
);

// Fetching is manual via the Refresh button. Do not auto-fetch on mount.
</script>

<template>
  <div :class="cardClasses">
    <div class="queue-header">
      <div>
        <div class="queue-title">Driver Queue Matrix</div>
        <div class="queue-subtitle">Showing up to {{ totalCells }} slots</div>
      </div>
      <div class="queue-controls">
        <div :class="['queue-status', { 'queue-status--error': serviceError }]">
          <span v-if="serviceError">Error</span>
          <span v-else>{{ activeCellCount }} active</span>
        </div>
        <div class="queue-timestamp">{{ lastUpdatedLabel ?? "—" }}</div>
        <button
          class="queue-button"
          :disabled="refreshInProgress"
          @click="refreshQueue"
        >
          {{ refreshInProgress ? "Refreshing…" : "Refresh" }}
        </button>
      </div>
    </div>

    <p v-if="serviceError" class="queue-error">{{ serviceError }}</p>

    <div
      :class="[
        'matrix-board',
        { 'matrix-board--paused': !operationModeActive },
      ]"
    >
      <div v-if="serviceLoading" class="matrix-paused-message">
        Loading latest queue…
      </div>
      <template v-else>
        <div v-if="!hasQueueContent" class="matrix-paused-message">
          No queue snapshot available.
        </div>
        <div
          v-for="(row, rowIndex) in matrixRows"
          :key="`matrix-row-${rowIndex}`"
          class="matrix-row"
        >
          <template
            v-for="(cell, cellIndex) in row"
            :key="`${cell.id}-${cellIndex}`"
          >
            <span class="matrix-cell" :class="`matrix-cell--${cell.state}`">{{
              cell.value
            }}</span>
            <span v-if="cellIndex < row.length - 1" class="matrix-divider"
              >|</span
            >
          </template>
        </div>
      </template>
    </div>

    <div
      v-if="showOperationModeBanner"
      class="alert alert-info matrix-status-banner"
    >
      Operation mode is disabled. Showing the last recorded queue until scanners
      resume.
    </div>

    <div v-if="legendStates.length" class="queue-legend">
      <span
        v-for="state in legendStates"
        :key="state"
        class="queue-legend__item"
        :class="`queue-legend__item--${state}`"
      >
        {{ queueStateLabels[state] }}
      </span>
    </div>

    <p class="queue-footer">
      Showing {{ queueEntries.length }} active drivers · manual refresh
    </p>
  </div>
</template>

<style scoped>
.queue-card {
  background: var(--fallback-b2, #f5f5f5);
  color: var(--fallback-bc, #111827);
  border-radius: 0.75rem;
  padding: 1.5rem;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.queue-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
}

.queue-title {
  font-size: 1.125rem;
  font-weight: 600;
}

.queue-subtitle {
  font-size: 0.875rem;
  color: rgba(17, 24, 39, 0.7);
}

.queue-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
}

.queue-status {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
  color: #22c55e;
}

.queue-status--error {
  color: #ef4444;
}

.queue-timestamp {
  color: rgba(17, 24, 39, 0.65);
}

.queue-button {
  padding: 0.4rem 0.85rem;
  border-radius: 0.5rem;
  border: none;
  font-weight: 600;
  font-size: 0.8rem;
  background: #2563eb;
  color: #ffffff;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.queue-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.queue-error {
  margin: 0;
  font-size: 0.85rem;
  color: #dc2626;
}

.matrix-board {
  background: #040d21;
  border-radius: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 1.5rem;
  font-family: "Roboto Mono", "SFMono-Regular", Menlo, Monaco, Consolas,
    monospace;
  color: #6ee7b7;
  text-transform: uppercase;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.matrix-board--paused {
  opacity: 0.85;
}

.matrix-paused-message {
  color: rgba(255, 255, 255, 0.75);
  text-align: center;
  font-size: 0.95rem;
  line-height: 1.4;
}

.matrix-board::-webkit-scrollbar {
  display: none;
}

.matrix-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.35rem 0;
  font-size: 1.75rem;
  font-weight: 600;
}

.matrix-cell {
  flex: 1;
  text-align: center;
  transition: color 0.2s ease;
}

.matrix-cell--ongoing {
  color: rgb(74, 222, 128);
}

.matrix-cell--completed {
  color: #22d3ee;
}

.matrix-cell--error {
  color: #f87171;
}

.matrix-cell--info {
  color: #60a5fa;
}

.matrix-cell--default {
  color: #6ee7b7;
}

.matrix-cell--stale {
  /* Previous/stale items — change this color to taste. */
  color: rgb(9, 173, 250); /* cool gray */
  opacity: 0.7;
  font-weight: 600;
}

.matrix-cell--empty {
  color: rgba(255, 255, 255, 0.25);
}

.matrix-cell--reserve {
  color: #d946ef; /* magenta */
}

.matrix-cell--fix {
  color: #f59e0b; /* amber */
}

.matrix-divider {
  width: 1.25rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.35);
}

.queue-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.queue-legend__item {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
}

.queue-legend__item--ongoing {
  border-color: rgb(74, 222, 128);
  color: rgb(74, 222, 128);
}

.queue-legend__item--completed {
  border-color: rgba(34, 211, 238, 0.4);
  color: #22d3ee;
}

.queue-legend__item--error {
  border-color: rgba(248, 113, 113, 0.4);
  color: #f87171;
}

.queue-legend__item--info {
  border-color: rgba(96, 165, 250, 0.4);
  color: #60a5fa;
}

.queue-legend__item--default {
  border-color: rgba(110, 231, 183, 0.35);
  color: #6ee7b7;
}

.queue-legend__item--stale {
  border-color: rgb(9, 173, 250);
  color: rgb(9, 173, 250);
}

.queue-legend__item--empty {
  border-color: rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.5);
}

.queue-legend__item--reserve {
  border-color: rgba(217, 70, 239, 0.4);
  color: #d946ef;
}

.queue-legend__item--fix {
  border-color: rgba(245, 158, 11, 0.4);
  color: #f59e0b;
}

.queue-footer {
  font-size: 0.75rem;
  color: rgba(17, 24, 39, 0.55);
}

.matrix-status-banner {
  margin-top: 0.75rem;
}

.queue-card--compact {
  padding: 1rem;
}

.queue-card--compact .queue-title {
  font-size: 1rem;
}

.queue-card--compact .queue-controls {
  font-size: 0.75rem;
}

.queue-card--compact .matrix-board {
  padding: 1rem;
}

.queue-card--compact .matrix-row {
  font-size: clamp(1rem, 3.3vw, 1.35rem);
}

.queue-card--compact .matrix-divider {
  width: 0.65rem;
}

@media (max-width: 1024px) {
  .queue-card--compact {
    padding: 0.75rem;
  }

  .queue-card--compact .queue-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}

@media (max-width: 600px) {
  .queue-card--compact .matrix-row {
    font-size: clamp(0.9rem, 5vw, 1.15rem);
  }

  .queue-card--compact .matrix-board {
    padding: 0.85rem;
  }

  .queue-card--compact .queue-controls {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
