import {
  pgTable,
  varchar,
  integer,
  boolean,
  timestamp,
  uuid,
  json,
  pgEnum,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Enums
export const roleEnum = pgEnum("role", ["admin", "superadmin", "driver"]);
export const eventTypeEnum = pgEnum("event_type", [
  "entry",
  "unknown",
  "ongoing",
  "completed",
  "override_reserve",
  "override_fix",
]);
export const scanStatusEnum = pgEnum("scan_status", [
  "success",
  "failed",
  "unauthorized",
]);

// Users table
export const users = pgTable(
  "Users",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    role: roleEnum("role").default("driver").notNull(),
    isActive: boolean("isActive").default(true),
    rfidTag: varchar("rfidTag", { length: 255 }).unique(),
    isEmailVerified: boolean("isEmailVerified").default(false).notNull(),
    verificationCode: text("verificationCode"),
    verificationCodeExpiry: timestamp("verificationCodeExpiry"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Performance indexes
    index("users_email_idx").on(table.email),
    index("users_role_active_idx").on(table.role, table.isActive),
    index("users_rfid_tag_idx").on(table.rfidTag),
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_rfid_tag_unique").on(table.rfidTag),
  ]
);

// RFIDs table
// Devices table
export const devices = pgTable(
  "Devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: varchar("deviceId", { length: 255 }).notNull().unique(),
    macAddress: varchar("macAddress", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    location: varchar("location", { length: 255 }).notNull(),
    apiKey: varchar("apiKey", { length: 255 }).notNull().unique(),
    isActive: boolean("isActive").default(true),
    registrationMode: boolean("registrationMode").default(false),
    pendingRegistrationTagId: varchar("pendingRegistrationTagId", {
      length: 255,
    }).default(""),
    scanMode: boolean("scanMode").default(false),
    lastSeen: timestamp("lastSeen"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Performance indexes
    index("devices_device_id_idx").on(table.deviceId),
    index("devices_api_key_idx").on(table.apiKey),
    index("devices_active_last_seen_idx").on(table.isActive, table.lastSeen),
    index("devices_registration_mode_idx").on(table.registrationMode),
    uniqueIndex("devices_device_id_unique").on(table.deviceId),
    uniqueIndex("devices_api_key_unique").on(table.apiKey),
  ]
);

// RFIDs table
export const rfids = pgTable(
  "Rfids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tagId: varchar("tagId", { length: 255 }).notNull().unique(),
    userId: integer("userId").references(() => users.id),
    isActive: boolean("isActive").default(true),
    unitNumber: varchar("unitNumber", { length: 255 }),
    lastScanned: timestamp("lastScanned"),
    deviceId: varchar("deviceId", { length: 255 }).references(
      () => devices.deviceId,
      {
        onDelete: "set null",
        onUpdate: "cascade",
      }
    ),
    registeredBy: integer("registeredBy")
      .notNull()
      .references(() => users.id),
    metadata: json("metadata").default({}),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Performance indexes
    index("rfids_tag_id_idx").on(table.tagId),
    index("rfids_tag_id_upper_idx").on(sql`upper(${table.tagId})`),
    index("rfids_user_id_idx").on(table.userId),
    index("rfids_device_id_idx").on(table.deviceId),
    index("rfids_active_last_scanned_idx").on(
      table.isActive,
      table.lastScanned
    ),
    index("rfids_registered_by_idx").on(table.registeredBy),
    uniqueIndex("rfids_tag_id_unique").on(table.tagId),
  ]
);

// RFID Scans table
export const rfidScans = pgTable(
  "RfidScans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfidTagId: varchar("rfidTagId", { length: 255 }).notNull(),
    rfidId: uuid("rfidId").references(() => rfids.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    deviceId: varchar("deviceId", { length: 255 })
      .notNull()
      .references(() => devices.deviceId, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    userId: integer("userId").references(() => users.id),
    eventType: eventTypeEnum("eventType").default("unknown").notNull(),
    location: varchar("location", { length: 255 }),
    unitNumber: varchar("unitNumber", { length: 255 }),
    scanTime: timestamp("scanTime").defaultNow().notNull(),
    status: scanStatusEnum("status").default("success").notNull(),
    metadata: json("metadata").default({}),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Performance indexes - critical for dashboard and history queries
    index("rfid_scans_scan_time_idx").on(table.scanTime),
    index("rfid_scans_device_id_scan_time_idx").on(
      table.deviceId,
      table.scanTime
    ),
    index("rfid_scans_user_id_scan_time_idx").on(table.userId, table.scanTime),
    index("rfid_scans_rfid_tag_id_scan_time_idx").on(
      table.rfidTagId,
      table.scanTime
    ),
    index("rfid_scans_tag_upper_scan_time_idx").on(
      sql`upper(${table.rfidTagId})`,
      table.scanTime
    ),
    index("rfid_scans_status_scan_time_idx").on(table.status, table.scanTime),
    index("rfid_scans_event_type_scan_time_idx").on(
      table.eventType,
      table.scanTime
    ),
    index("rfid_scans_rfid_id_idx").on(table.rfidId),

    // Partial indexes for common queries
    index("rfid_scans_failed_recent_idx")
      .on(table.rfidTagId, table.scanTime)
      .where(sql`${table.status} = 'failed' AND ${table.userId} IS NULL`),

    index("rfid_scans_failed_tag_upper_scan_time_idx")
      .on(sql`upper(${table.rfidTagId})`, table.scanTime)
      .where(sql`${table.status} = 'failed' AND ${table.userId} IS NULL`),

    index("rfid_scans_success_recent_idx")
      .on(table.scanTime)
      .where(sql`${table.status} = 'success'`),
  ]
);

// API Keys table
export const apiKeys = pgTable(
  "ApiKeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    deviceId: varchar("deviceId", { length: 255 })
      .notNull()
      .references(() => devices.deviceId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    description: text("description"),
    key: text("key").notNull().unique(),
    prefix: varchar("prefix", { length: 10 }).notNull(),
    permissions: json("permissions").default(["scan"]).$type<string[]>(),
    lastUsed: timestamp("lastUsed"),
    isActive: boolean("isActive").default(true),
    createdBy: integer("createdBy")
      .notNull()
      .references(() => users.id),
    metadata: json("metadata").default({}),
    type: varchar("type", { length: 50 }).default("device").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Performance indexes
    index("api_keys_key_idx").on(table.key),
    index("api_keys_device_id_idx").on(table.deviceId),
    index("api_keys_prefix_idx").on(table.prefix),
    index("api_keys_active_last_used_idx").on(table.isActive, table.lastUsed),
    index("api_keys_created_by_idx").on(table.createdBy),
    uniqueIndex("api_keys_key_unique").on(table.key),
  ]
);

export type QueueSnapshotSlot = {
  slotIndex: number;
  ledValue: string;
  displayValue: string;
  state: string;
  scanId: string | null;
  scanTime: string | null;
  isLatest: boolean;
};

export const queueSnapshots = pgTable(
  "QueueSnapshots",
  {
    deviceId: varchar("deviceId", { length: 255 })
      .primaryKey()
      .references(() => devices.deviceId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    slots: json("slots").$type<QueueSnapshotSlot[]>().notNull().default([]),
    cascade: text("cascade").notNull(),
    slotCount: integer("slotCount").notNull().default(40),
    totalActive: integer("totalActive").notNull().default(0),
    operationModeActive: boolean("operationModeActive").notNull().default(true),
    lastUpdated: timestamp("lastUpdated").defaultNow().notNull(),
    source: varchar("source", { length: 32 }).notNull().default("device"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Performance indexes
    index("queue_snapshots_last_updated_idx").on(table.lastUpdated),
    index("queue_snapshots_source_idx").on(table.source),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  registeredRfids: many(rfids, { relationName: "registeredBy" }),
  ownedRfid: one(rfids, {
    fields: [users.rfidTag],
    references: [rfids.tagId],
  }),
  scans: many(rfidScans),
  createdApiKeys: many(apiKeys),
}));

export const rfidsRelations = relations(rfids, ({ one, many }) => ({
  user: one(users, {
    fields: [rfids.userId],
    references: [users.id],
  }),
  registrar: one(users, {
    fields: [rfids.registeredBy],
    references: [users.id],
    relationName: "registeredBy",
  }),
  scans: many(rfidScans),
}));

export const rfidScansRelations = relations(rfidScans, ({ one }) => ({
  rfid: one(rfids, {
    fields: [rfidScans.rfidId],
    references: [rfids.id],
  }),
  user: one(users, {
    fields: [rfidScans.userId],
    references: [users.id],
  }),
  device: one(devices, {
    fields: [rfidScans.deviceId],
    references: [devices.deviceId],
  }),
}));

export const devicesRelations = relations(devices, ({ many, one }) => ({
  scans: many(rfidScans),
  queueSnapshot: one(queueSnapshots, {
    fields: [devices.deviceId],
    references: [queueSnapshots.deviceId],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  creator: one(users, {
    fields: [apiKeys.createdBy],
    references: [users.id],
  }),
}));

export const queueSnapshotsRelations = relations(queueSnapshots, ({ one }) => ({
  device: one(devices, {
    fields: [queueSnapshots.deviceId],
    references: [devices.deviceId],
  }),
}));

// Type exports for TypeScript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Rfid = typeof rfids.$inferSelect;
export type NewRfid = typeof rfids.$inferInsert;

export type RfidScan = typeof rfidScans.$inferSelect;
export type NewRfidScan = typeof rfidScans.$inferInsert;

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type QueueSnapshot = typeof queueSnapshots.$inferSelect;
export type NewQueueSnapshot = typeof queueSnapshots.$inferInsert;
