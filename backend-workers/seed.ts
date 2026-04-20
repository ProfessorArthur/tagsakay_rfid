import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { users, rfids, devices, apiKeys } from "./src/db/schema";
import crypto from "crypto";

config({ path: ".dev.vars" });

// Simple password hashing using Node crypto (for seeding only)
// In production, use the Web Crypto API version from your auth.ts
async function hashPassword(password: string): Promise<string> {
  return crypto.createHash("sha256").update(password).digest("hex");
}

const seed = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in .dev.vars");
  }

  console.log("🌱 Seeding database...");
  console.log(
    "📦 Database:",
    process.env.DATABASE_URL.split("@")[1]?.split("?")[0]
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    // Clear existing data (in reverse order of dependencies)
    console.log("🗑️  Clearing existing data...");
    await db.delete(apiKeys);
    await db.delete(devices);
    await db.delete(rfids);
    await db.delete(users);

    // Seed SuperAdmin
    console.log("\n👤 Creating users...");
    const [admin] = await db
      .insert(users)
      .values({
        name: "Super Admin",
        email: "admin@tagsakay.com",
        password: await hashPassword("admin123"),
        role: "superadmin",
        isActive: true,
        isEmailVerified: true,
      })
      .returning();
    console.log("   ✅ SuperAdmin:", admin.email);

    // Seed Admin
    const [regularAdmin] = await db
      .insert(users)
      .values({
        name: "Regular Admin",
        email: "admin2@tagsakay.com",
        password: await hashPassword("admin123"),
        role: "admin",
        isActive: true,
        isEmailVerified: true,
      })
      .returning();
    console.log("   ✅ Admin:", regularAdmin.email);

    // Seed Test Driver with RFID
    const [driver] = await db
      .insert(users)
      .values({
        name: "Juan Dela Cruz",
        email: "driver@test.com",
        password: await hashPassword("driver123"),
        role: "driver",
        isActive: true,
        rfidTag: "TEST001",
        isEmailVerified: true,
      })
      .returning();
    console.log("   ✅ Driver:", driver.email);

    // Seed Inactive Driver
    const [inactiveDriver] = await db
      .insert(users)
      .values({
        name: "Inactive Driver",
        email: "inactive@test.com",
        password: await hashPassword("driver123"),
        role: "driver",
        isActive: false,
        rfidTag: "TEST999",
        isEmailVerified: true,
      })
      .returning();
    console.log("   ✅ Inactive Driver:", inactiveDriver.email);

    // Seed RFIDs
    console.log("\n🏷️  Creating RFID tags...");
    await db.insert(rfids).values({
      tagId: "TEST001",
      userId: driver.id,
      isActive: true,
      registeredBy: admin.id,
      metadata: { vehicleType: "tricycle", plateNumber: "ABC-123" },
    });
    console.log("   ✅ RFID: TEST001 (Active, assigned to driver)");

    await db.insert(rfids).values({
      tagId: "TEST002",
      userId: null,
      isActive: true,
      registeredBy: admin.id,
      metadata: { note: "Unassigned tag" },
    });
    console.log("   ✅ RFID: TEST002 (Active, unassigned)");

    await db.insert(rfids).values({
      tagId: "TEST999",
      userId: inactiveDriver.id,
      isActive: false,
      registeredBy: admin.id,
      metadata: { note: "Deactivated tag" },
    });
    console.log("   ✅ RFID: TEST999 (Inactive)");

    // Seed Devices
    console.log("\n📱 Creating devices...");
    const [device1] = await db
      .insert(devices)
      .values({
        deviceId: "001122334455",
        macAddress: "00:11:22:33:44:55",
        name: "Main Gate Scanner",
        location: "Main Entrance",
        apiKey: "test_device_key_main_gate",
        isActive: true,
        registrationMode: false,
        scanMode: true,
      })
      .returning();
    console.log("   ✅ Device:", device1.name, `(${device1.deviceId})`);

    const [device2] = await db
      .insert(devices)
      .values({
        deviceId: "AABBCCDDEEFF",
        macAddress: "AA:BB:CC:DD:EE:FF",
        name: "Exit Gate Scanner",
        location: "Exit Point",
        apiKey: "test_device_key_exit_gate",
        isActive: true,
        registrationMode: false,
        scanMode: true,
      })
      .returning();
    console.log("   ✅ Device:", device2.name, `(${device2.deviceId})`);

    // Seed API Keys
    console.log("\n🔑 Creating API keys...");
    await db.insert(apiKeys).values({
      name: "Main Gate API Key",
      deviceId: device1.deviceId,
      description: "Primary API key for main entrance scanner",
      key: crypto.randomBytes(32).toString("hex"),
      prefix: "tsk_main",
      permissions: ["scan", "heartbeat"],
      isActive: true,
      createdBy: admin.id,
      type: "device",
    });
    console.log("   ✅ API Key for Main Gate");

    await db.insert(apiKeys).values({
      name: "Exit Gate API Key",
      deviceId: device2.deviceId,
      description: "Primary API key for exit gate scanner",
      key: crypto.randomBytes(32).toString("hex"),
      prefix: "tsk_exit",
      permissions: ["scan", "heartbeat"],
      isActive: true,
      createdBy: admin.id,
      type: "device",
    });
    console.log("   ✅ API Key for Exit Gate");

    console.log("\n🎉 Database seeded successfully!\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📝 Test Credentials:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n🔐 Admin Accounts:");
    console.log("   SuperAdmin: admin@tagsakay.com / admin123");
    console.log("   Admin:      admin2@tagsakay.com / admin123");
    console.log("\n🚗 Driver Accounts:");
    console.log("   Active:     driver@test.com / driver123");
    console.log("   Inactive:   inactive@test.com / driver123");
    console.log("\n🏷️  RFID Tags:");
    console.log("   TEST001  (Active, assigned to driver)");
    console.log("   TEST002  (Active, unassigned)");
    console.log("   TEST999  (Inactive)");
    console.log("   UNKNOWN  (Not registered - will create scan record)");
    console.log("\n📱 Device API Keys:");
    console.log("   Main Gate: test_device_key_main_gate");
    console.log("   Exit Gate: test_device_key_exit_gate");
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n🚀 Quick Test Commands:");
    console.log("\n# Login as admin:");
    console.log("curl -X POST http://localhost:8787/api/auth/login \\");
    console.log('  -H "Content-Type: application/json" \\');
    console.log(
      '  -d \'{"email":"admin@tagsakay.com","password":"admin123"}\''
    );
    console.log("\n# Scan RFID (device auth):");
    console.log("curl -X POST http://localhost:8787/api/rfid/scan \\");
    console.log('  -H "X-API-Key: test_device_key_main_gate" \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"tagId":"TEST001","location":"Main Gate"}\'');
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (error) {
    console.error("\n❌ Seeding failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
};

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
