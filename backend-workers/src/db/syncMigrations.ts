import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

config({ path: ".dev.vars" });

const MIGRATIONS_TABLE = "_drizzle_migrations";

async function readMigrations() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const drizzleDir = path.resolve(scriptDir, "../../drizzle");
  const journalPath = path.join(drizzleDir, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    throw new Error(
      "Drizzle journal not found. Have you generated migrations?"
    );
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = Array.isArray(journal.entries) ? journal.entries : [];

  return entries.map((entry: any) => {
    const tag = entry.tag as string;
    const migrationPath = path.join(drizzleDir, `${tag}.sql`);

    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file missing for tag ${tag}`);
    }

    const sql = fs.readFileSync(migrationPath, "utf8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    return {
      id: tag,
      hash,
    };
  });
}

async function ensureMigrationsTable(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
         "id" text PRIMARY KEY,
         "hash" text NOT NULL,
         "created_at" bigint NOT NULL
       )`
    );
  } finally {
    client.release();
  }
}

async function syncMigrations() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in .dev.vars");
  }

  const migrations = await readMigrations();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await ensureMigrationsTable(pool);

    const client = await pool.connect();

    try {
      const { rows }: { rows: { id: string; hash: string }[] } =
        await client.query(`SELECT id, hash FROM "${MIGRATIONS_TABLE}"`);

      const existing = new Map(rows.map((row) => [row.id, row.hash]));
      const inserts: { id: string; hash: string }[] = [];

      for (const migration of migrations) {
        const current = existing.get(migration.id);

        if (!current) {
          inserts.push(migration);
          continue;
        }

        if (current !== migration.hash) {
          console.warn(
            `⚠️  Hash mismatch for migration ${migration.id}. Expected ${migration.hash}, found ${current}.`
          );
        }
      }

      if (inserts.length === 0) {
        console.log("✅ Migration registry already up to date");
        return;
      }

      for (const migration of inserts) {
        const timestamp = Date.now();
        await client.query(
          `INSERT INTO "${MIGRATIONS_TABLE}" (id, hash, created_at) VALUES ($1, $2, $3)`,
          [migration.id, migration.hash, timestamp]
        );
        console.log(`📝 Registered migration ${migration.id}`);
      }
    } finally {
      client.release();
    }

    console.log("✅ Migration registry synchronized");
  } finally {
    await pool.end();
  }
}

syncMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Failed to sync migrations:", error);
    process.exit(1);
  });
