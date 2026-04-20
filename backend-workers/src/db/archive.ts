import { rfidScans } from "./schema.js";
import { sql, lte, and } from "drizzle-orm";
import type { Database } from "./index.js";

/**
 * Archive old RFID scan data to improve performance
 * Moves scans older than the specified retention period to archive tables
 */
export async function archiveOldScans(
  db: Database,
  retentionDays: number = 90
): Promise<{
  archived: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let archived = 0;

  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(`Archiving RFID scans older than ${cutoffDate.toISOString()}`);

    // Create archive table if it doesn't exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "RfidScansArchive" (
        LIKE "RfidScans" INCLUDING ALL
      );
    `);

    // Move old records to archive (using a transaction for safety)
    const result = await db.execute(sql`
      WITH moved_rows AS (
        DELETE FROM "RfidScans"
        WHERE "scanTime" <= ${cutoffDate}
        RETURNING *
      )
      INSERT INTO "RfidScansArchive"
      SELECT * FROM moved_rows;
    `);

    archived = result.rowCount || 0;

    // Create indexes on archive table for potential future queries
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "rfid_scans_archive_scan_time_idx"
      ON "RfidScansArchive" ("scanTime");
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "rfid_scans_archive_device_id_scan_time_idx"
      ON "RfidScansArchive" ("deviceId", "scanTime");
    `);

    console.log(`Successfully archived ${archived} RFID scan records`);
  } catch (error: any) {
    const errorMsg = `Failed to archive old scans: ${error.message}`;
    console.error(errorMsg);
    errors.push(errorMsg);
  }

  return { archived, errors };
}

/**
 * Get archive statistics
 */
export async function getArchiveStats(db: Database): Promise<{
  activeScans: number;
  archivedScans: number;
  oldestActiveScan?: Date;
  newestArchivedScan?: Date;
}> {
  try {
    // Get active scans count and oldest
    const activeResult = await db
      .select({
        count: sql<number>`count(*)`,
        oldest: sql<Date>`min("scanTime")`,
      })
      .from(rfidScans);

    const activeStats = activeResult[0];

    // Get archived scans count and newest
    const archiveResult = await db.execute(sql`
      SELECT
        count(*) as count,
        max("scanTime") as newest
      FROM "RfidScansArchive"
    `);

    const archiveStats = archiveResult.rows?.[0] || { count: 0, newest: null };

    return {
      activeScans: activeStats.count || 0,
      archivedScans: Number(archiveStats.count) || 0,
      oldestActiveScan: activeStats.oldest,
      newestArchivedScan: archiveStats.newest
        ? new Date(archiveStats.newest as string)
        : undefined,
    };
  } catch (error: any) {
    console.error("Failed to get archive stats:", error);
    // Return default values if archive table doesn't exist yet
    const activeResult = await db
      .select({
        count: sql<number>`count(*)`,
        oldest: sql<Date>`min("scanTime")`,
      })
      .from(rfidScans);

    const activeStats = activeResult[0];

    return {
      activeScans: activeStats.count || 0,
      archivedScans: 0,
      oldestActiveScan: activeStats.oldest,
    };
  }
}

/**
 * Clean up very old archived data (optional deep archive)
 */
export async function cleanupOldArchives(
  db: Database,
  retentionDays: number = 365
): Promise<{
  deleted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let deleted = 0;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(
      `Deleting archived scans older than ${cutoffDate.toISOString()}`
    );

    const result = await db.execute(sql`
      DELETE FROM "RfidScansArchive"
      WHERE "scanTime" <= ${cutoffDate}
    `);

    deleted = result.rowCount || 0;
    console.log(`Deleted ${deleted} very old archived records`);
  } catch (error: any) {
    const errorMsg = `Failed to cleanup old archives: ${error.message}`;
    console.error(errorMsg);
    errors.push(errorMsg);
  }

  return { deleted, errors };
}
