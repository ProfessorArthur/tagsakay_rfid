// ============================================================================
// RFID SCAN TEST SCRIPT
// ============================================================================
// Tests the RFID scan endpoint with the simplified event type system
// Verifies that "waiting" is no longer accepted and "ongoing" is the default

const BASE_URL = "http://localhost:8787";
const TEST_DEVICE_ID = "001122334455";
const TEST_TAG_ID = "ABC123456789";
const TEST_LOCATION = "Test Location";

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

// Helper to print colored output
function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  log("\n" + "=".repeat(60), "cyan");
  log(`  ${title}`, "bright");
  log("=".repeat(60), "cyan");
}

function logSuccess(message) {
  log(`✅ ${message}`, "green");
}

function logError(message) {
  log(`❌ ${message}`, "red");
}

function logWarning(message) {
  log(`⚠️  ${message}`, "yellow");
}

function logInfo(message) {
  log(`ℹ️  ${message}`, "blue");
}

// Sleep function for delays
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test function to send RFID scan
async function sendRfidScan(tagId, eventType = null, testName = "") {
  try {
    const payload = {
      tagId: tagId,
      deviceId: TEST_DEVICE_ID,
      location: TEST_LOCATION,
    };

    if (eventType) {
      payload.eventType = eventType;
    }

    const response = await fetch(`${BASE_URL}/api/rfid/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "test_device_key_main_gate",
        "X-Device-Id": TEST_DEVICE_ID,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    return {
      status: response.status,
      data,
      testName,
    };
  } catch (error) {
    logError(`Network error in ${testName}: ${error.message}`);
    throw error;
  }
}

// Main test function
async function runRfidScanTest() {
  logSection("🧪 RFID SCAN TEST - Event Type System");

  log("\n📋 Test Configuration:", "magenta");
  log(`   Base URL: ${BASE_URL}`);
  log(`   Test Device ID: ${TEST_DEVICE_ID}`);
  log(`   Test Tag ID: ${TEST_TAG_ID}`);
  log(`   Test Location: ${TEST_LOCATION}`);
  log(`   Expected: "waiting" rejected, "ongoing" as default`);

  const results = [];

  // Test 1: Scan without eventType (should default to "ongoing")
  logSection("🔄 Test 1: Default Event Type (no eventType specified)");
  try {
    const result = await sendRfidScan(TEST_TAG_ID, null, "Default Event Type");
    results.push(result);

    logInfo(`Status: ${result.status}`);
    logInfo(`Message: ${result.data.message || "N/A"}`);

    if (result.status === 201 && result.data.success) {
      logSuccess("Scan accepted with default event type");
      logInfo(`Event Type: ${result.data.data?.eventType || "N/A"}`);
    } else {
      logError(`Scan failed: ${result.data.message || "Unknown error"}`);
    }
  } catch (error) {
    logError(`Test 1 failed: ${error.message}`);
  }

  await sleep(500);

  // Test 2: Scan with explicit "ongoing" eventType
  logSection("🔄 Test 2: Explicit 'ongoing' Event Type");
  try {
    const result = await sendRfidScan(
      TEST_TAG_ID,
      "ongoing",
      "Explicit Ongoing"
    );
    results.push(result);

    logInfo(`Status: ${result.status}`);
    logInfo(`Message: ${result.data.message || "N/A"}`);

    if (result.status === 201 && result.data.success) {
      logSuccess("Scan accepted with 'ongoing' event type");
      logInfo(`Event Type: ${result.data.data?.eventType || "N/A"}`);
    } else {
      logError(`Scan failed: ${result.data.message || "Unknown error"}`);
    }
  } catch (error) {
    logError(`Test 2 failed: ${error.message}`);
  }

  await sleep(500);

  // Test 3: Scan with "completed" eventType
  logSection("🔄 Test 3: 'completed' Event Type");
  try {
    const result = await sendRfidScan(
      TEST_TAG_ID,
      "completed",
      "Completed Event"
    );
    results.push(result);

    logInfo(`Status: ${result.status}`);
    logInfo(`Message: ${result.data.message || "N/A"}`);

    if (result.status === 201 && result.data.success) {
      logSuccess("Scan accepted with 'completed' event type");
      logInfo(`Event Type: ${result.data.data?.eventType || "N/A"}`);
    } else {
      logError(`Scan failed: ${result.data.message || "Unknown error"}`);
    }
  } catch (error) {
    logError(`Test 3 failed: ${error.message}`);
  }

  await sleep(500);

  // Test 4: Scan with invalid "waiting" eventType (should be rejected)
  logSection("🔄 Test 4: Invalid 'waiting' Event Type (should be rejected)");
  try {
    const result = await sendRfidScan(
      TEST_TAG_ID,
      "waiting",
      "Invalid Waiting"
    );
    results.push(result);

    logInfo(`Status: ${result.status}`);
    logInfo(`Message: ${result.data.message || "N/A"}`);

    if (result.status === 400 && !result.data.success) {
      logSuccess("'waiting' event type correctly rejected");
      logInfo(`Error: ${result.data.message || "N/A"}`);
    } else {
      logError("'waiting' event type was not rejected as expected");
      logWarning(`Unexpected success with status ${result.status}`);
    }
  } catch (error) {
    logError(`Test 4 failed: ${error.message}`);
  }

  await sleep(500);

  // Test 5: Scan with another invalid eventType
  logSection(
    "🔄 Test 5: Invalid 'unknown_old' Event Type (should default to 'ongoing')"
  );
  try {
    const result = await sendRfidScan(
      TEST_TAG_ID,
      "unknown_old",
      "Invalid Unknown"
    );
    results.push(result);

    logInfo(`Status: ${result.status}`);
    logInfo(`Message: ${result.data.message || "N/A"}`);

    if (result.status === 201 && result.data.success) {
      logSuccess("Invalid event type defaulted to 'ongoing'");
      logInfo(`Event Type: ${result.data.data?.eventType || "N/A"}`);
      if (result.data.data?.eventType === "ongoing") {
        logSuccess("Correctly defaulted to 'ongoing'");
      } else {
        logWarning(
          `Defaulted to '${result.data.data?.eventType}' instead of 'ongoing'`
        );
      }
    } else {
      logError(`Scan failed: ${result.data.message || "Unknown error"}`);
    }
  } catch (error) {
    logError(`Test 5 failed: ${error.message}`);
  }

  // Analysis
  logSection("📊 Test Results Analysis");

  const successfulScans = results.filter(
    (r) => r.status === 201 && r.data.success
  ).length;
  const rejectedScans = results.filter(
    (r) => r.status === 400 && !r.data.success
  ).length;
  const totalTests = results.length;

  log(`Total Tests: ${totalTests}`);
  log(`Successful Scans: ${successfulScans}`);
  log(`Rejected Invalid Types: ${rejectedScans}`);

  // Check specific test results
  const testResults = {
    defaultToOngoing:
      results[0]?.status === 201 &&
      results[0]?.data?.data?.eventType === "ongoing",
    explicitOngoing: results[1]?.status === 201 && results[1]?.data?.success,
    completedAccepted: results[2]?.status === 201 && results[2]?.data?.success,
    waitingRejected: results[3]?.status === 400 && !results[3]?.data?.success,
    invalidDefaultsToOngoing:
      results[4]?.status === 201 &&
      results[4]?.data?.data?.eventType === "ongoing",
  };

  if (testResults.defaultToOngoing) {
    logSuccess("Default event type correctly set to 'ongoing'");
  } else {
    logError("Default event type not set to 'ongoing'");
  }

  if (testResults.explicitOngoing) {
    logSuccess("Explicit 'ongoing' event type accepted");
  } else {
    logError("Explicit 'ongoing' event type rejected");
  }

  if (testResults.completedAccepted) {
    logSuccess("'completed' event type accepted");
  } else {
    logError("'completed' event type rejected");
  }

  if (testResults.waitingRejected) {
    logSuccess("'waiting' event type correctly rejected");
  } else {
    logError("'waiting' event type was not rejected");
  }

  if (testResults.invalidDefaultsToOngoing) {
    logSuccess("Invalid event types correctly default to 'ongoing'");
  } else {
    logError("Invalid event types did not default to 'ongoing'");
  }

  // Final summary
  logSection("📈 Test Summary");

  const allTestsPassed = Object.values(testResults).every((result) => result);

  if (allTestsPassed) {
    logSuccess("\n🎉 ALL TESTS PASSED!");
    log("\n✨ The simplified event type system is working correctly:", "green");
    log("   - Default event type is 'ongoing'", "green");
    log("   - 'ongoing' and 'completed' event types are accepted", "green");
    log("   - 'waiting' event type is correctly rejected", "green");
    log("   - Invalid event types default to 'ongoing'", "green");
  } else {
    logError("\n❌ SOME TESTS FAILED");
    log("\n⚠️  Issues detected:", "yellow");
    Object.entries(testResults).forEach(([test, passed]) => {
      if (!passed) {
        log(`   - ${test.replace(/([A-Z])/g, " $1").toLowerCase()}`, "red");
      }
    });
  }

  logSection("🏁 Test Complete");

  return allTestsPassed;
}

// Run the test
runRfidScanTest()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    logError(`\n💥 Test failed with error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
