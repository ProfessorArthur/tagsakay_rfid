import { drizzle } from "drizzle-orm/neon-http";
import { neon, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./schema.js";

// Configure websocket constructor for local Wrangler dev
neonConfig.webSocketConstructor = ws;

const dbCache = new Map<string, ReturnType<typeof drizzle>>();

export function createDb(databaseUrl: string) {
  const cachedDb = dbCache.get(databaseUrl);
  if (cachedDb) {
    return cachedDb;
  }

  const sql = neon(databaseUrl);
  const db = drizzle(sql, { schema });
  dbCache.set(databaseUrl, db);
  return db;
}

export type Database = ReturnType<typeof createDb>;
