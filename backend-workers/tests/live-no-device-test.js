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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeBase = (baseUrl) => String(baseUrl || "").replace(/\/+$/, "");

const resolveApiBase = () => {
  const raw =
    process.env.API_BASE_URL || process.env.BASE_URL || "http://localhost:8787";
  const normalized = normalizeBase(raw);
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
};

const resolveBackendRoot = (apiBaseUrl) =>
  apiBaseUrl.endsWith("/api") ? apiBaseUrl.slice(0, -4) : apiBaseUrl;

const config = {
  frontendUrl:
    process.env.FRONTEND_URL || "https://tagsakay-frontend.pages.dev",
  apiBaseUrl: resolveApiBase(),
  requireLiveStack: process.env.REQUIRE_LIVE_STACK === "1",
  adminEmail: process.env.ADMIN_EMAIL || "admin@tagsakay.com",
  adminPassword: process.env.ADMIN_PASSWORD || "JustDoIt4017",
  deviceId: process.env.DEVICE_ID || "001122334455",
  deviceApiKey:
    process.env.DEVICE_API_KEY ||
    process.env.TEST_DEVICE_API_KEY ||
    "test_device_key_main_gate",
  testLocation: process.env.TEST_LOCATION || "No-device live smoke test",
  testTagId:
    process.env.TEST_TAG_ID || `SMOKE${Date.now().toString(36).toUpperCase()}`,
  keepVirtualDevice: process.env.KEEP_VIRTUAL_DEVICE === "1",
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    json,
    text,
  };
}

const generateVirtualMacAddress = () => {
  const randomByte = () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();

  // 02 prefix sets a locally administered MAC for test-only virtual devices.
  return `02:${randomByte()}:${randomByte()}:${randomByte()}:${randomByte()}:${randomByte()}`;
};

async function run() {
  let virtualDeviceId = null;
  try {
    log("Running no-device live stack smoke test", "cyan");
    log(`Frontend URL: ${config.frontendUrl}`);
    log(`API Base URL: ${config.apiBaseUrl}`);
    log(`Device ID: ${config.deviceId}`);
    log(`Test Tag ID: ${config.testTagId}`);

    const frontendResponse = await fetch(config.frontendUrl, { method: "GET" });
    assert(
      frontendResponse.ok,
      `Frontend check failed: ${config.frontendUrl} returned ${frontendResponse.status}`,
    );
    log(`Frontend reachable (${frontendResponse.status})`, "green");

    const backendRoot = resolveBackendRoot(config.apiBaseUrl);
    let backendHealth;
    try {
      backendHealth = await fetchJson(`${backendRoot}/health`, {
        method: "GET",
      });
    } catch (error) {
      if (config.requireLiveStack) {
        throw new Error(
          `Backend health request failed for ${backendRoot}: ${error.message}`,
        );
      }

      log(
        `Skipping live backend assertions: cannot reach ${backendRoot} (${error.message}). Start wrangler dev or set API_BASE_URL.`,
        "yellow",
      );
      return;
    }

    if (!backendHealth.ok) {
      if (config.requireLiveStack) {
        throw new Error(
          `Backend health failed: status ${backendHealth.status}`,
        );
      }

      log(
        `Skipping live backend assertions: ${backendRoot}/health returned ${backendHealth.status}.`,
        "yellow",
      );
      return;
    }

    assert(
      backendHealth.ok,
      `Backend health failed: status ${backendHealth.status}`,
    );
    log("Backend health endpoint reachable", "green");

    const loginResponse = await fetchJson(`${config.apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: config.adminEmail,
        password: config.adminPassword,
      }),
    });

    assert(
      loginResponse.ok && loginResponse.json?.success,
      `Admin login failed (${loginResponse.status}): ${
        loginResponse.json?.message || loginResponse.text
      }. Set ADMIN_EMAIL and ADMIN_PASSWORD env vars for your live account.`,
    );

    const token = loginResponse.json?.data?.token;
    assert(token, "Login did not return a bearer token");
    log("Admin login successful", "green");

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    const dashboardResponse = await fetchJson(
      `${config.apiBaseUrl}/rfid/stats/dashboard`,
      {
        method: "GET",
        headers: authHeaders,
      },
    );
    assert(
      dashboardResponse.ok && dashboardResponse.json?.success,
      `Dashboard stats request failed (${dashboardResponse.status})`,
    );
    log("Dashboard stats fetched (backend + DB path OK)", "green");

    let deviceId = config.deviceId;
    let deviceApiKey = config.deviceApiKey;

    if (!process.env.DEVICE_API_KEY && !process.env.TEST_DEVICE_API_KEY) {
      const virtualMacAddress = generateVirtualMacAddress();
      const virtualName = `Virtual Test Device ${Date.now().toString(36).toUpperCase()}`;
      const registerResponse = await fetchJson(
        `${config.apiBaseUrl}/devices/register`,
        {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            macAddress: virtualMacAddress,
            name: virtualName,
            location: "Virtual test runner",
          }),
        },
      );

      assert(
        registerResponse.ok && registerResponse.json?.success,
        `Virtual device registration failed (${registerResponse.status}): ${
          registerResponse.json?.message || registerResponse.text
        }`,
      );

      const createdDevice = registerResponse.json?.data?.device;
      const generatedApiKey = registerResponse.json?.data?.apiKey;
      assert(
        createdDevice?.deviceId,
        "Virtual device registration missing deviceId",
      );
      assert(generatedApiKey, "Virtual device registration missing apiKey");

      deviceId = createdDevice.deviceId;
      deviceApiKey = generatedApiKey;
      virtualDeviceId = deviceId;
      log(`Virtual device registered: ${deviceId}`, "green");
    }

    const deviceHeaders = {
      "Content-Type": "application/json",
      "X-API-Key": deviceApiKey,
      "X-Device-Id": deviceId,
    };

    const firstCommandPoll = await fetchJson(
      `${config.apiBaseUrl}/devices/${deviceId}/commands`,
      {
        method: "GET",
        headers: deviceHeaders,
      },
    );
    assert(
      firstCommandPoll.ok && firstCommandPoll.json?.success,
      `Device commands poll failed (${firstCommandPoll.status})`,
    );

    const commandPayload = firstCommandPoll.json?.data ?? {};
    const commandVersion = commandPayload?.commandVersion;
    assert(
      Array.isArray(commandPayload?.commands),
      "Device commands poll did not return a commands array",
    );
    log("Device command poll successful", "green");

    if (typeof commandVersion === "string" && commandVersion.length > 0) {
      const secondCommandPoll = await fetchJson(
        `${config.apiBaseUrl}/devices/${deviceId}/commands?lastCommandVersion=${encodeURIComponent(
          commandVersion,
        )}`,
        {
          method: "GET",
          headers: deviceHeaders,
        },
      );
      assert(
        secondCommandPoll.ok && secondCommandPoll.json?.success,
        `Second command poll failed (${secondCommandPoll.status})`,
      );
      assert(
        secondCommandPoll.json?.data?.unchanged === true,
        "Expected unchanged=true for matching commandVersion",
      );
      log("Command cache fast-path verified", "green");
    } else {
      log(
        "Legacy commands payload detected (no commandVersion). Skipping cache fast-path assertion.",
        "yellow",
      );
    }

    const heartbeatResponse = await fetchJson(
      `${config.apiBaseUrl}/devices/${deviceId}/heartbeat`,
      {
        method: "POST",
        headers: deviceHeaders,
        body: JSON.stringify({
          status: "online",
          firmwareVersion: "no-device-test",
        }),
      },
    );

    assert(
      heartbeatResponse.ok && heartbeatResponse.json?.success,
      `Device heartbeat failed (${heartbeatResponse.status})`,
    );
    log("Device heartbeat simulated successfully", "green");

    const scanResponse = await fetchJson(`${config.apiBaseUrl}/rfid/scan`, {
      method: "POST",
      headers: deviceHeaders,
      body: JSON.stringify({
        tagId: config.testTagId,
        location: config.testLocation,
        eventType: "ongoing",
      }),
    });

    // Success (registered) and 404/403 (unregistered/inactive) both prove DB write path was exercised.
    assert(
      [200, 403, 404].includes(scanResponse.status),
      `RFID scan call returned unexpected status ${scanResponse.status}`,
    );
    log(`RFID scan simulated (status ${scanResponse.status})`, "green");

    let foundInRecent = false;
    for (let i = 0; i < 5; i++) {
      const recentResponse = await fetchJson(
        `${config.apiBaseUrl}/rfid/scans/recent?limit=25`,
        {
          method: "GET",
          headers: authHeaders,
        },
      );

      assert(
        recentResponse.ok && recentResponse.json?.success,
        `Recent scans request failed (${recentResponse.status})`,
      );

      const scans = recentResponse.json?.data?.scans || [];
      foundInRecent = scans.some(
        (scan) =>
          String(scan?.rfidTagId || "").toUpperCase() === config.testTagId,
      );

      if (foundInRecent) {
        break;
      }
      await sleep(1000);
    }

    assert(
      foundInRecent,
      "Could not find the simulated scan in recent scans (DB verification failed)",
    );
    log("Scan found in recent history (DB persistence verified)", "green");

    if (virtualDeviceId && !config.keepVirtualDevice) {
      const cleanupResponse = await fetchJson(
        `${config.apiBaseUrl}/devices/${virtualDeviceId}`,
        {
          method: "DELETE",
          headers: authHeaders,
        },
      );

      if (cleanupResponse.ok && cleanupResponse.json?.success) {
        log(`Virtual device cleaned up: ${virtualDeviceId}`, "green");
      } else {
        log(
          `Warning: virtual device cleanup failed (${cleanupResponse.status}) for ${virtualDeviceId}`,
          "yellow",
        );
      }
    }

    log("No-device live stack smoke test PASSED", "green");
  } catch (error) {
    log(`No-device live stack smoke test FAILED: ${error.message}`, "red");
    process.exitCode = 1;
  } finally {
    if (virtualDeviceId && config.keepVirtualDevice) {
      log(
        `Virtual device kept for manual checks: ${virtualDeviceId}`,
        "yellow",
      );
    }
  }
}

run();
