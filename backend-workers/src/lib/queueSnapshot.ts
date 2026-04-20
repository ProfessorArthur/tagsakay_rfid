import { desc, eq } from "drizzle-orm";
import {
  queueSnapshots,
  rfidScans,
  type QueueSnapshotSlot,
} from "../db/schema.js";
import type { Database } from "../db/index.js";

export type QueueCellState =
  | "ongoing"
  | "completed"
  | "error"
  | "info"
  | "default"
  | "stale"
  | "empty";

type RawScanRow = {
  id: string;
  rfidTagId: string;
  unitNumber: string | null;
  scanTime: Date | string | null;
  status: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
};

export type CascadeSlot = {
  slotIndex: number;
  ledValue: string;
  displayValue: string;
  state: QueueCellState;
  scanId: string | null;
  scanTime: string | null;
  isLatest: boolean;
};

export type CascadeSnapshot = {
  slots: CascadeSlot[];
  cascade: string;
  totalActive: number;
  operationModeActive: boolean;
  lastUpdated: string | null;
};

const CASCADE_SLOT_COUNT = 40;

const clampSlotCount = (slotCount: number): number =>
  Math.max(1, Math.min(slotCount, CASCADE_SLOT_COUNT));

type DeviceSnapshotPayload = {
  slots?: Array<Partial<QueueSnapshotSlot>> | null;
  cascade?: string;
  slotCount?: number;
  totalActive?: number;
  operationModeActive?: boolean;
  lastUpdated?: string | Date | null;
};

type PersistedSnapshotRow = {
  deviceId: string;
  slots: QueueSnapshotSlot[] | null;
  cascade: string | null;
  slotCount: number | null;
  totalActive: number | null;
  operationModeActive: boolean | null;
  lastUpdated: Date | null;
  updatedAt: Date | null;
};

const toIsoString = (input: Date | string | null): string | null => {
  if (!input) {
    return null;
  }
  if (input instanceof Date) {
    return input.toISOString();
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toISOString();
};

const normalizeStateValue = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

const sanitizeSlotDisplayValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "number") {
    return String(value).trim().toUpperCase();
  }
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().toUpperCase();
  if (!trimmed || trimmed === "0" || trimmed === "---") {
    return "";
  }
  return trimmed;
};

// Ensure single-digit numeric unit values are padded to 2-digits (eg 1 -> 01)
const padUnitNumber = (value: string): string => {
  if (!value) return value;
  // Only pad pure 1-digit numbers (1 through 9). Ignore already padded values and alphanumeric strings.
  if (/^[1-9]{1}$/.test(value)) {
    return `0${value}`;
  }
  return value;
};

const coerceQueueCellState = (value: unknown): QueueCellState => {
  const normalized = normalizeStateValue(value);

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
    case "STALE":
      return "stale";
    case "EMPTY":
      return "empty";
    default:
      return "default";
  }
};

const createEmptySlot = (slotIndex: number): CascadeSlot => ({
  slotIndex,
  ledValue: "0",
  displayValue: "---",
  state: "empty",
  scanId: null,
  scanTime: null,
  isLatest: false,
});

const normalizeSlotFromPayload = (
  slotIndex: number,
  slot: Partial<QueueSnapshotSlot> | null,
  cascadeHint?: string
): CascadeSlot => {
  const displayCandidate =
    slot?.displayValue ?? slot?.ledValue ?? cascadeHint ?? "";
  const normalizedDisplay = padUnitNumber(
    sanitizeSlotDisplayValue(displayCandidate)
  );
  const hasValue = normalizedDisplay.length > 0;

  if (!hasValue) {
    return createEmptySlot(slotIndex);
  }

  return {
    slotIndex,
    ledValue: normalizedDisplay,
    displayValue: normalizedDisplay,
    state: coerceQueueCellState(slot?.state ?? "ongoing"),
    scanId: slot?.scanId ?? null,
    scanTime: slot?.scanTime ? toIsoString(slot.scanTime) : null,
    isLatest: slot?.isLatest ?? true,
  };
};

export const normalizeDeviceSnapshotPayload = (
  payload: DeviceSnapshotPayload,
  slotCount: number = CASCADE_SLOT_COUNT
): CascadeSnapshot => {
  const targetSlots = clampSlotCount(payload.slotCount ?? slotCount);
  const rawSlots = Array.isArray(payload.slots) ? payload.slots : [];
  const cascadeParts =
    typeof payload.cascade === "string" ? payload.cascade.split(",") : [];

  const slotsByIndex = new Map<number, Partial<QueueSnapshotSlot> | null>();
  rawSlots.forEach((slot, idx) => {
    if (slot && typeof slot.slotIndex === "number") {
      slotsByIndex.set(slot.slotIndex, slot);
    } else if (!slotsByIndex.has(idx)) {
      slotsByIndex.set(idx, slot ?? null);
    }
  });

  const slots: CascadeSlot[] = Array.from({ length: targetSlots }, (_, idx) => {
    const slotPayload = slotsByIndex.has(idx)
      ? slotsByIndex.get(idx) ?? null
      : null;
    return normalizeSlotFromPayload(idx, slotPayload, cascadeParts[idx]);
  });

  const cascade = slots.map((slot) => slot.ledValue || "0").join(",");
  const totalActive = slots.filter((slot) => slot.ledValue !== "0").length;
  const operationModeActive =
    payload.operationModeActive === undefined
      ? true
      : Boolean(payload.operationModeActive);
  const lastUpdated = toIsoString(
    (payload.lastUpdated as Date | string | null) ?? null
  );

  return {
    slots,
    cascade,
    totalActive,
    operationModeActive,
    lastUpdated,
  };
};

const resolveQueueState = (scan: RawScanRow): QueueCellState => {
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
    default:
      if (scan.status === "failed" || scan.status === "unauthorized") {
        return "error";
      }
      return "default";
  }
};

const resolveUnitValue = (scan: RawScanRow): string => {
  const metadata = (scan.metadata ?? {}) as Record<string, unknown>;
  const candidate =
    scan.unitNumber ??
    metadata.unitNumber ??
    metadata.unit ??
    metadata.vehicleNumber ??
    metadata.vehicleId ??
    scan.rfidTagId;

  if (!candidate) {
    return "";
  }

  return String(candidate).trim().toUpperCase();
};

const normalizeBooleanCandidate = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (
      ["on", "true", "enabled", "active", "operation", "operational"].includes(
        normalized
      )
    ) {
      return true;
    }
    if (
      ["off", "false", "disabled", "inactive", "registration", "idle"].includes(
        normalized
      )
    ) {
      return false;
    }
  }
  return undefined;
};

const resolveOperationModeFlag = (scan: RawScanRow): boolean | undefined => {
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
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
};

export const buildCascadeSnapshot = async (
  db: Database,
  slotCount: number = CASCADE_SLOT_COUNT
): Promise<CascadeSnapshot> => {
  const constrainedSlots = clampSlotCount(slotCount);

  const rows = await db
    .select({
      id: rfidScans.id,
      rfidTagId: rfidScans.rfidTagId,
      unitNumber: rfidScans.unitNumber,
      scanTime: rfidScans.scanTime,
      status: rfidScans.status,
      eventType: rfidScans.eventType,
      metadata: rfidScans.metadata,
    })
    .from(rfidScans)
    .where(eq(rfidScans.status, "success"))
    .orderBy(desc(rfidScans.scanTime))
    .limit(constrainedSlots * 6);

  // Normalize metadata to the expected shape so helper functions accept rows safely
  const normalizedRows = rows.map((r) => ({
    id: r.id,
    rfidTagId: r.rfidTagId,
    unitNumber: r.unitNumber,
    scanTime: r.scanTime,
    status: r.status,
    eventType: r.eventType,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  })) as RawScanRow[];

  const ordered = normalizedRows.slice().reverse();
  const ongoingEvents = ordered.filter((scan) => scan.eventType === "ongoing");
  const trimmed = ongoingEvents.slice(-constrainedSlots);

  const slots: CascadeSlot[] = Array.from(
    { length: constrainedSlots },
    (_, idx) => ({
      slotIndex: idx,
      ledValue: "0",
      displayValue: "---",
      state: "empty",
      scanId: null,
      scanTime: null,
      isLatest: false,
    })
  );

  const lastIndexByValue = new Map<string, number>();

  trimmed.forEach((scan, index) => {
    const displayValue = padUnitNumber(resolveUnitValue(scan));
    const ledValue = displayValue.length ? displayValue : "0";
    const state = resolveQueueState(scan);

    slots[index] = {
      slotIndex: index,
      ledValue,
      displayValue: displayValue.length ? displayValue : "---",
      state,
      scanId: scan.id,
      scanTime: toIsoString(scan.scanTime),
      isLatest: true,
    };

    if (displayValue.length) {
      lastIndexByValue.set(displayValue, index);
    }
  });

  slots.forEach((slot) => {
    if (!slot.scanId) {
      return;
    }
    const lastIndex = lastIndexByValue.get(slot.displayValue);
    if (lastIndex !== undefined && lastIndex !== slot.slotIndex) {
      slot.state = "stale";
      slot.isLatest = false;
    }
  });

  const cascade = slots.map((slot) => slot.ledValue || "0").join(",");
  const totalActive = slots.filter((slot) => slot.ledValue !== "0").length;

  let operationModeFlag: boolean | undefined;
  for (const scan of ordered) {
    operationModeFlag = resolveOperationModeFlag(scan);
    if (operationModeFlag !== undefined) {
      break;
    }
  }

  const lastUpdated = trimmed.length
    ? toIsoString(trimmed[trimmed.length - 1].scanTime)
    : null;

  return {
    slots,
    cascade,
    totalActive,
    operationModeActive:
      operationModeFlag === undefined ? true : operationModeFlag,
    lastUpdated,
  };
};

const getLatestDeviceCascadeSnapshot = async (
  db: Database,
  slotCount: number,
  deviceId?: string
): Promise<CascadeSnapshot | null> => {
  const constrainedSlots = clampSlotCount(slotCount);
  const selection = {
    deviceId: queueSnapshots.deviceId,
    slots: queueSnapshots.slots,
    cascade: queueSnapshots.cascade,
    slotCount: queueSnapshots.slotCount,
    totalActive: queueSnapshots.totalActive,
    operationModeActive: queueSnapshots.operationModeActive,
    lastUpdated: queueSnapshots.lastUpdated,
    updatedAt: queueSnapshots.updatedAt,
  };

  const rows = deviceId
    ? await db
        .select(selection)
        .from(queueSnapshots)
        .where(eq(queueSnapshots.deviceId, deviceId))
        .limit(1)
    : await db
        .select(selection)
        .from(queueSnapshots)
        .orderBy(desc(queueSnapshots.updatedAt))
        .limit(1);

  const row = rows[0] as PersistedSnapshotRow | undefined;
  if (!row) {
    return null;
  }

  return normalizeDeviceSnapshotPayload(
    {
      slots: (row.slots ?? []) as Array<Partial<QueueSnapshotSlot>>,
      cascade: row.cascade ?? undefined,
      slotCount: row.slotCount ?? undefined,
      totalActive: row.totalActive ?? undefined,
      operationModeActive: row.operationModeActive ?? undefined,
      lastUpdated: row.lastUpdated ?? row.updatedAt ?? null,
    },
    constrainedSlots
  );
};

export const resolveCascadeSnapshot = async (
  db: Database,
  slotCount: number = CASCADE_SLOT_COUNT,
  options?: { deviceId?: string | null }
): Promise<CascadeSnapshot> => {
  const constrainedSlots = clampSlotCount(slotCount);
  const deviceSnapshot = await getLatestDeviceCascadeSnapshot(
    db,
    constrainedSlots,
    options?.deviceId ?? undefined
  );

  if (deviceSnapshot) {
    return deviceSnapshot;
  }

  return buildCascadeSnapshot(db, constrainedSlots);
};
