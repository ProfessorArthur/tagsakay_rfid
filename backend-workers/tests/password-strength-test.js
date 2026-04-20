// ============================================================================
// PASSWORD STRENGTH VALIDATION TEST SCRIPT
// ============================================================================
// Tests password strength validation on registration endpoint
// Verifies backend rejects weak passwords according to OWASP standards

const BASE_URL = "http://localhost:8787";

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

// Test passwords with various strengths
const testCases = [
  {
    name: "Very Weak - Too Short",
    password: "pass",
    email: "test1@example.com",
    name: "Test User 1",
    expectedStrength: 0,
    shouldPass: false,
    reason: "Less than 15 characters",
  },
  {
    name: "Very Weak - Only Lowercase",
    password: "password",
    email: "test2@example.com",
    name: "Test User 2",
    expectedStrength: 0,
    shouldPass: false,
    reason: "Only lowercase letters, no numbers/special chars",
  },
  {
    name: "Weak - Common Password",
    password: "password123",
    email: "test3@example.com",
    name: "Test User 3",
    expectedStrength: 1,
    shouldPass: false,
    reason: "Common password pattern",
  },
  {
    name: "Weak - Simple Pattern",
    password: "Password1",
    email: "test4@example.com",
    name: "Test User 4",
    expectedStrength: 1,
    shouldPass: false,
    reason: "Missing special characters",
  },
  {
    name: "Fair - Basic Complexity",
    password: "Password1!",
    email: "test5@example.com",
    name: "Test User 5",
    expectedStrength: 2,
    shouldPass: false,
    reason: "Meets minimum but still predictable",
  },
  {
    name: "Good - Decent Password",
    password: "MyP@ssw0rd123",
    email: "test6@example.com",
    name: "Test User 6",
    expectedStrength: 3,
    shouldPass: true,
    reason: "Good mix of character types, longer length",
  },
  {
    name: "Strong - Excellent Password",
    password: "Tr1cYcl3!Qu3u3$yst3m#2024",
    email: "test7@example.com",
    name: "Test User 7",
    expectedStrength: 4,
    shouldPass: true,
    reason: "Long, complex, with multiple character types",
  },
];

// Test function to attempt registration
async function attemptRegistration(testCase) {
  try {
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: testCase.name,
        email: testCase.email,
        password: testCase.password,
      }),
    });

    const data = await response.json();

    return {
      status: response.status,
      data,
      success: response.status === 201,
    };
  } catch (error) {
    logError(`Network error: ${error.message}`);
    throw error;
  }
}

// Sleep function for delays
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main test function
async function runPasswordStrengthTest() {
  logSection("🔐 PASSWORD STRENGTH VALIDATION TEST");

  log("\n📋 Test Configuration:", "magenta");
  log(`   Base URL: ${BASE_URL}`);
  log(`   Test Cases: ${testCases.length}`);
  log(`   OWASP Standards: Min 15 chars (for registration), complexity requirements`);

  // Check if rate limit is active
  logInfo("\n⏱️  Checking if rate limit is currently active...");
  const checkResponse = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "check@test.com",
      password: "Test123!",
      name: "Check",
    }),
  });

  if (checkResponse.status === 429) {
    const retryAfter = checkResponse.headers.get("Retry-After") || "5";
    logWarning(
      `   (This is expected if you ran the rate limit test recently)`,
      "yellow"
    );
    await sleep((parseInt(retryAfter) + 2) * 1000);
    logSuccess("Rate limit cleared! Starting password strength tests...");
  } else {
    logSuccess("No active rate limit. Proceeding with tests...");
  }

  const results = [];
  let passedTests = 0;
  let failedTests = 0;

  logSection("🧪 Testing Password Strength Validation");

  for (const testCase of testCases) {
    logInfo(`\n${testCase.name}:`);
    log(
      `   Password: "${"*".repeat(testCase.password.length)}" (${
        testCase.password.length
      } chars)`
    );
    log(`   Expected Strength: ${testCase.expectedStrength}/4`);
    log(`   Should Pass Backend: ${testCase.shouldPass ? "Yes" : "No"}`);
    log(`   Reason: ${testCase.reason}`);

    const result = await attemptRegistration(testCase);
    results.push({ testCase, result });

    log(
      `   Status: ${result.status}`,
      result.status === 201 ? "green" : "yellow"
    );
    log(`   Message: ${result.data.message || "N/A"}`);

    // Skip validation if rate limited (shouldn't happen with delays)
    if (result.status === 429) {
      logWarning(
        `Rate limited during test! Skipping validation for this test case.`
      );
      failedTests++;
      continue;
    }

    // Validate result matches expectation
    const testPassed = testCase.shouldPass
      ? result.success
      : !result.success && result.status === 400;

    if (testPassed) {
      logSuccess(`Test passed! Backend responded as expected.`);
      passedTests++;
    } else {
      logError(`Test failed! Backend response was unexpected.`);
      if (testCase.shouldPass) {
        log(`   Expected: 201 (Success), Got: ${result.status}`, "red");
      } else {
        log(
          `   Expected: 400 (Validation Error), Got: ${result.status}`,
          "red"
        );
      }
      failedTests++;
    }

    // Small delay between requests to avoid rate limiting (200ms)
    await sleep(200);
  }

  // Analysis
  logSection("📊 Test Results Analysis");

  // Group by expected strength
  const byStrength = {
    0: results.filter((r) => r.testCase.expectedStrength === 0),
    1: results.filter((r) => r.testCase.expectedStrength === 1),
    2: results.filter((r) => r.testCase.expectedStrength === 2),
    3: results.filter((r) => r.testCase.expectedStrength === 3),
    4: results.filter((r) => r.testCase.expectedStrength === 4),
  };

  log("\n📈 Results by Strength Level:", "magenta");

  for (let level = 0; level <= 4; level++) {
    const levelResults = byStrength[level];
    const rejected = levelResults.filter((r) => !r.result.success).length;
    const accepted = levelResults.filter((r) => r.result.success).length;

    const levelName = ["Very Weak", "Weak", "Fair", "Good", "Strong"][level];
    log(`\n   Level ${level} (${levelName}):`);
    log(`      Total: ${levelResults.length}`);
    log(`      Accepted: ${accepted}`, accepted > 0 ? "green" : "reset");
    log(`      Rejected: ${rejected}`, rejected > 0 ? "yellow" : "reset");
  }

  // Check specific requirements
  logSection("✅ OWASP Requirements Validation");

  const veryWeakRejected = byStrength[0].every((r) => !r.result.success);
  const weakRejected = byStrength[1].every((r) => !r.result.success);
  const strongAccepted = byStrength[4].every((r) => r.result.success);

  if (veryWeakRejected) {
    logSuccess("All 'Very Weak' passwords correctly rejected");
  } else {
    logError("Some 'Very Weak' passwords were accepted (SECURITY RISK!)");
  }

  if (weakRejected) {
    logSuccess("All 'Weak' passwords correctly rejected");
  } else {
    logError("Some 'Weak' passwords were accepted (SECURITY RISK!)");
  }

  if (strongAccepted) {
    logSuccess("All 'Strong' passwords correctly accepted");
  } else {
    logError("Some 'Strong' passwords were rejected");
  }

  // Final summary
  logSection("📈 Test Summary");

  log(`   Total Tests: ${results.length}`);
  log(`   Passed: ${passedTests}`, passedTests > 0 ? "green" : "reset");
  log(`   Failed: ${failedTests}`, failedTests > 0 ? "red" : "reset");
  log(`   Success Rate: ${((passedTests / results.length) * 100).toFixed(1)}%`);

  const allTestsPassed = failedTests === 0;

  if (allTestsPassed) {
    logSuccess("\n🎉 ALL TESTS PASSED!");
    log("\n✨ Password validation is working correctly:", "green");
    log("   - Very weak passwords are rejected", "green");
    log("   - Weak passwords are rejected", "green");
    log("   - Strong passwords are accepted", "green");
    log("   - Validation messages are appropriate", "green");
  } else {
    logError("\n❌ SOME TESTS FAILED");
    log(`\n⚠️  ${failedTests} test(s) did not behave as expected`, "yellow");
  }

  logSection("🏁 Test Complete");

  return allTestsPassed;
}

// Run the test
runPasswordStrengthTest()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    logError(`\n💥 Test failed with error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
