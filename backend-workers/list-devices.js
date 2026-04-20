import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

config({ path: ".dev.vars" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

pool
  .query(
    `
  SELECT "deviceId", "macAddress", "name", "location", "isActive", "createdAt"
  FROM "Devices"
  ORDER BY "createdAt" DESC
`
  )
  .then((result) => {
    console.log("Registered devices in production:");
    console.log(JSON.stringify(result.rows, null, 2));
    return pool.end();
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
