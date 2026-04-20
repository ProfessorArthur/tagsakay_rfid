import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

const log = (message, color = "reset") => {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

async function readWorkspaceFile(relativePath) {
  const fullPath = path.resolve(repoRoot, relativePath);
  return fs.readFile(fullPath, "utf-8");
}

async function runStaticChecks() {
  log("Running static optimization checks...", "cyan");

  const backendIndex = await readWorkspaceFile("backend-workers/src/index.ts");
  const backendDeviceRoute = await readWorkspaceFile(
    "backend-workers/src/routes/device.ts",
  );
  const frontendApi = await readWorkspaceFile("frontend/src/services/api.ts");
  const frontendStats = await readWorkspaceFile(
    "frontend/src/services/rfidStats.ts",
  );
  const frontendAdaptivePolling = await readWorkspaceFile(
    "frontend/src/utils/adaptivePolling.ts",
  );
  const frontendRfid = await readWorkspaceFile("frontend/src/services/rfid.ts");

  assert(
    backendIndex.includes("isDevelopmentEnv"),
    "Backend environment-based log gating helper is missing",
  );
  assert(
    !backendIndex.includes('app.use("*", logger());'),
    "Backend still has unconditional logger middleware",
  );

  assert(
    frontendApi.includes("const isDevMode = import.meta.env.DEV"),
    "Frontend API service is missing dev-only logging guard",
  );

  assert(
    frontendStats.includes("recentScansInFlight"),
    "Recent scans in-flight dedupe map was not found",
  );

  const hasLegacyHiddenTabGuard = frontendStats.includes("document.hidden");
  const hasAdaptiveHiddenTabGuard =
    frontendStats.includes("createAdaptivePoller") &&
    frontendAdaptivePolling.includes("document.hidden");

  assert(
    hasLegacyHiddenTabGuard || hasAdaptiveHiddenTabGuard,
    "Recent scans hidden-tab polling throttle was not found",
  );

  assert(
    frontendRfid.includes("unregisteredScansInFlight"),
    "Unregistered scans in-flight dedupe map was not found",
  );

  assert(
    backendDeviceRoute.includes("COMMAND_RESPONSE_CACHE_TTL_MS"),
    "Backend command response cache constant is missing",
  );
  assert(
    backendDeviceRoute.includes("fromCache"),
    "Backend commands response metadata (fromCache) is missing",
  );

  log("Static checks passed", "green");
}

async function runOptionalIntegrationCheck() {
  const baseUrl = process.env.BASE_URL || "http://localhost:8787";
  const deviceId = process.env.TEST_DEVICE_ID || "";
  const apiKey = process.env.TEST_DEVICE_API_KEY || "";

  if (!deviceId || !apiKey) {
    log(
      "Skipping live command-cache test: set TEST_DEVICE_ID and TEST_DEVICE_API_KEY to run it.",
      "yellow",
    );
    return;
  }

  log("Running live command-cache test...", "cyan");

  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Device-Id": deviceId,
  };

  let firstResponse;
  try {
    firstResponse = await fetch(`${baseUrl}/api/devices/${deviceId}/commands`, {
      method: "GET",
      headers,
    });
  } catch (error) {
    log(
      `Skipping live command-cache test: unable to reach ${baseUrl} (${error.message})`,
      "yellow",
    );
    return;
  }
  assert(
    firstResponse.ok,
    `First command poll failed with ${firstResponse.status}`,
  );

  const firstJson = await firstResponse.json();
  assert(
    firstJson.success === true,
    "First command poll did not return success=true",
  );
  const commandVersion = firstJson?.data?.commandVersion;
  assert(
    typeof commandVersion === "string" && commandVersion.length > 0,
    "First command poll did not include commandVersion",
  );

  const secondResponse = await fetch(
    `${baseUrl}/api/devices/${deviceId}/commands?lastCommandVersion=${encodeURIComponent(
      commandVersion,
    )}`,
    {
      method: "GET",
      headers,
    },
  );
  assert(
    secondResponse.ok,
    `Second command poll failed with ${secondResponse.status}`,
  );

  const secondJson = await secondResponse.json();
  assert(
    secondJson.success === true,
    "Second command poll did not return success=true",
  );
  assert(
    secondJson?.data?.unchanged === true,
    "Second command poll should report unchanged=true when commandVersion matches",
  );
  assert(
    Array.isArray(secondJson?.data?.commands) &&
      secondJson.data.commands.length === 0,
    "Second command poll should return an empty commands array for unchanged state",
  );

  log("Live command-cache test passed", "green");
}

async function run() {
  try {
    await runStaticChecks();
    await runOptionalIntegrationCheck();
    log("All optimization tests completed", "green");
  } catch (error) {
    log(`Optimization tests failed: ${error.message}`, "red");
    process.exitCode = 1;
  }
}

run();
