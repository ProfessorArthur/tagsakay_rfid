import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

// Load environment variables from .dev.vars
config({ path: ".dev.vars" });

/**
 * Truncate all tables (delete all data but keep schema)
 */
const truncateAllTables = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in .dev.vars");
  }

  console.log("🧹 Starting database cleanup...");
  console.log(
    "📦 Database:",
    process.env.DATABASE_URL.split("@")[1]?.split("?")[0]
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Drop custom enum types first (to allow clean migration replay)
    console.log("🗑️  Dropping custom enum types...");
    await pool.query(`DROP TYPE IF EXISTS event_type CASCADE`);
    console.log("✓ Dropped: event_type");
    await pool.query(`DROP TYPE IF EXISTS role CASCADE`);
    console.log("✓ Dropped: role");
    await pool.query(`DROP TYPE IF EXISTS scan_status CASCADE`);
    console.log("✓ Dropped: scan_status");

    // Get all table names from information_schema
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);

    const tables = result.rows.map((row: any) => row.table_name);

    if (tables.length === 0) {
      console.log("⚠️  No tables found to drop");
    } else {
      console.log(`📋 Found ${tables.length} tables: ${tables.join(", ")}`);

      // Drop each table completely (CASCADE handles foreign keys)
      for (const table of tables) {
        await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        console.log(`✓ Dropped: ${table}`);
      }
    }

    console.log("✅ Database cleanup complete!");
  } catch (error) {
    console.error("❌ Cleanup failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
};

// Execute cleanup
truncateAllTables()
  .then(() => {
    console.log("👍 All tables truncated - database is ready for fresh start");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Cleanup error:", error);
    process.exit(1);
  });
