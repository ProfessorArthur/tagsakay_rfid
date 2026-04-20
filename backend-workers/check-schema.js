import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";

config({ path: ".dev.vars" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool
  .query(
    `
  SELECT column_name, data_type, character_maximum_length 
  FROM information_schema.columns 
  WHERE table_name = 'ApiKeys' AND column_name = 'key'
`
  )
  .then((result) => {
    console.log("Production ApiKeys.key column:");
    console.log(JSON.stringify(result.rows, null, 2));
    return pool.end();
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
