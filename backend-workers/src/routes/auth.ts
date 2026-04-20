import { Hono } from "hono";
import {
  generateJWT,
  verifyPassword,
  hashPassword,
  verifyJWT,
  validatePasswordStrength,
} from "../lib/auth.js";
import { clearSession, createSession, refreshSession } from "../lib/session.js";
import { sendVerificationEmail } from "../lib/email.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import {
  authRateLimit,
  checkAccountLock,
  recordFailedLogin,
  resetLoginAttempts,
} from "../middleware/rateLimit.js";
import { validateRequestBody, validateEmail } from "../lib/validation.js";
import {
  logLoginSuccess,
  logLoginFailure,
  logAccountLocked,
  logPasswordChange,
  logValidationFailure,
  SecurityEventType,
  SeverityLevel,
  securityLogger,
} from "../lib/securityLogger.js";

type Env = {
  Bindings: {
    DATABASE_URL: string;
    JWT_SECRET: string;
    SESSION_SECRET: string;
    RESEND_API_KEY: string;
  };
  Variables: {
    db: Database;
    user?: any;
  };
};

const app = new Hono<Env>();

// Helper to get IP address
function getIpAddress(c: any): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For") ||
    c.req.header("X-Real-IP") ||
    "unknown"
  );
}

// POST /api/auth/login - Enhanced with rate limiting and account lockout
app.post("/login", authRateLimit, async (c) => {
  const db = c.get("db");
  const ipAddress = getIpAddress(c);
  const userAgent = c.req.header("User-Agent");

  // Parse and validate request body
  // Wrap with a safe parse so we can log and return a helpful error in dev if the JSON is malformed
  let body: any = undefined;
  try {
    body = await c.req.json();
  } catch (parseErr: any) {
    // In development, log the raw body for debugging
    try {
      const raw = await c.req.text();
      console.error(
        "[DEV] Failed to parse JSON request body for /api/auth/login - raw body:",
        raw
      );
    } catch (e) {
      console.error("[DEV] Failed to read raw body after JSON.parse failed", e);
    }

    console.error(
      "JSON parse error at /api/auth/login:",
      parseErr?.message || parseErr
    );

    return c.json(
      { success: false, message: "Invalid JSON in request body" },
      400
    );
  }
  const { email, password } = body;

  // Normalize email to lowercase for consistent lookups
  const normalizedEmail = email?.toLowerCase() || "";

  // Input validation
  const emailValidation = validateEmail(normalizedEmail);
  if (!emailValidation.valid) {
    logValidationFailure(
      "/api/auth/login",
      [emailValidation.error!],
      ipAddress
    );
    return c.json(
      {
        success: false,
        message: "Invalid email or password", // Generic message
      },
      400
    );
  }

  if (!normalizedEmail || !password) {
    logValidationFailure("/api/auth/login", ["Missing credentials"], ipAddress);
    return c.json(
      {
        success: false,
        message: "Invalid email or password",
      },
      400
    );
  }

  // Check if account is locked due to failed attempts
  const lockStatus = checkAccountLock(normalizedEmail);
  if (lockStatus.locked) {
    const remainingTime = Math.ceil(
      (lockStatus.lockedUntil! - Date.now()) / 1000 / 60
    );
    logLoginFailure(normalizedEmail, "Account locked", ipAddress, userAgent);

    return c.json(
      {
        success: false,
        message: "Account temporarily locked. Please try again later.",
        retryAfter: `${remainingTime} minutes`,
      },
      429
    );
  }

  // Fetch user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!user) {
    // Record failed attempt (even for non-existent users to prevent enumeration)
    recordFailedLogin(normalizedEmail);
    logLoginFailure(normalizedEmail, "User not found", ipAddress, userAgent);

    return c.json(
      {
        success: false,
        message: "Invalid email or password", // Generic message
      },
      401
    );
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password);

  if (!isValid) {
    const attemptResult = recordFailedLogin(normalizedEmail);
    logLoginFailure(normalizedEmail, "Invalid password", ipAddress, userAgent);

    if (attemptResult.locked) {
      logAccountLocked(normalizedEmail, 15 * 60 * 1000, ipAddress);

      return c.json(
        {
          success: false,
          message: "Too many failed attempts. Account temporarily locked.",
          retryAfter: "15 minutes",
        },
        429
      );
    }

    return c.json(
      {
        success: false,
        message: "Invalid email or password", // Generic message
      },
      401
    );
  }

  // Check if account is active
  if (!user.isActive) {
    logLoginFailure(normalizedEmail, "Account inactive", ipAddress, userAgent);
    return c.json(
      {
        success: false,
        message: "Account is inactive. Please contact support.",
      },
      403
    );
  }

  // Check if email is verified
  if (!user.isEmailVerified) {
    logLoginFailure(
      normalizedEmail,
      "Email not verified",
      ipAddress,
      userAgent
    );
    return c.json(
      {
        success: false,
        message:
          "Please verify your email before logging in. Check your inbox for the verification code.",
      },
      403
    );
  }

  try {
    // Generate JWT with shorter expiration (4 hours)
    const token = await generateJWT(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      c.env.JWT_SECRET,
      "4h" // Reduced from 24h
    );

    // Reset failed login attempts on successful login
    resetLoginAttempts(normalizedEmail);

    // Log successful login
    logLoginSuccess(normalizedEmail, ipAddress, userAgent);

    try {
      await createSession(c, {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (sessionError) {
      console.error("Failed to create session cookie", sessionError);
    }

    return c.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        expiresIn: "4h",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          rfidTag: user.rfidTag,
        },
      },
    });
  } catch (error: any) {
    securityLogger.log({
      eventType: SecurityEventType.ERROR,
      severity: SeverityLevel.HIGH,
      username: email,
      ipAddress,
      message: "JWT generation failed during login",
      metadata: { error: error.message },
    });

    return c.json(
      {
        success: false,
        message: "Login failed. Please try again.",
      },
      500
    );
  }
});

// POST /api/auth/register - Enhanced with validation and password strength checking
app.post("/register", authRateLimit, async (c) => {
  const db = c.get("db");
  const ipAddress = getIpAddress(c);

  const body = await c.req.json();

  // Validate request body
  const validation = validateRequestBody(body, {
    name: { type: "string", required: true, minLength: 2, maxLength: 100 },
    email: { type: "email", required: true },
    password: { type: "string", required: true, minLength: 15, maxLength: 128 },
    role: {
      type: "enum",
      allowedValues: ["superadmin", "admin", "driver"] as const,
      required: false,
    },
    rfidTag: { type: "rfid", required: false },
  });

  if (!validation.valid) {
    logValidationFailure("/api/auth/register", validation.errors, ipAddress);
    return c.json(
      {
        success: false,
        message: "Validation failed",
        errors: validation.errors,
      },
      400
    );
  }

  const {
    name,
    email,
    password,
    role = "driver",
    rfidTag,
  } = validation.sanitized!;

  // Normalize email to lowercase for consistent lookups
  const normalizedEmail = email.toLowerCase();

  // Check password strength (without MFA, min 15 chars recommended)
  const passwordCheck = validatePasswordStrength(password, false);
  if (!passwordCheck.isValid) {
    logValidationFailure(
      "/api/auth/register",
      passwordCheck.errors,
      ipAddress,
      normalizedEmail
    );
    return c.json(
      {
        success: false,
        message: "Password does not meet security requirements",
        errors: passwordCheck.errors,
      },
      400
    );
  }

  // Check if email already exists
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existingUser) {
    // Don't log this as it's expected behavior
    return c.json(
      {
        success: false,
        message: "A link to activate your account has been emailed.", // Generic message per OWASP
      },
      400
    );
  }

  // Check if RFID tag already exists (if provided)
  if (rfidTag) {
    const [existingRfid] = await db
      .select()
      .from(users)
      .where(eq(users.rfidTag, rfidTag))
      .limit(1);

    if (existingRfid) {
      logValidationFailure(
        "/api/auth/register",
        ["RFID tag already assigned"],
        ipAddress,
        normalizedEmail
      );
      return c.json(
        {
          success: false,
          message: "Registration failed. Please try again or contact support.",
        },
        409
      );
    }
  }

  try {
    // Hash password with PBKDF2
    const hashedPassword = await hashPassword(password);

    // Generate 6-digit verification code
    const verificationCode = Math.random().toString().substring(2, 8);
    const hashedVerificationCode = await hashPassword(verificationCode); // Hash code for storage
    const expiryTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: role as "superadmin" | "admin" | "driver",
        rfidTag: rfidTag || null,
        isActive: true,
        isEmailVerified: false, // Not verified yet
        verificationCode: hashedVerificationCode, // Store hashed code
        verificationCodeExpiry: expiryTime,
      })
      .returning();

    // Send verification email (send plaintext code to user)
    const emailResult = await sendVerificationEmail(
      c.env.RESEND_API_KEY,
      normalizedEmail,
      verificationCode,
      "https://tagsakay.com"
    );

    if (!emailResult.success) {
      console.error("Failed to send verification email:", emailResult.error);
      // Don't fail registration, just log the error
    }

    // Log successful registration
    securityLogger.log({
      eventType: SecurityEventType.LOGIN_SUCCESS,
      severity: SeverityLevel.LOW,
      username: normalizedEmail,
      ipAddress,
      message: `New user registered (awaiting email verification): ${normalizedEmail}`,
    });

    // Return response - user is registered but not verified yet
    return c.json(
      {
        success: true,
        message:
          "Registration successful! Check your email to verify your account.",
        data: {
          email: newUser.email,
          verified: false,
          // Don't send token yet - user must verify first
        },
      },
      201
    );
  } catch (error: any) {
    securityLogger.log({
      eventType: SecurityEventType.ERROR,
      severity: SeverityLevel.HIGH,
      username: normalizedEmail,
      ipAddress,
      message: "Registration failed",
      metadata: { error: error.message },
    });

    return c.json(
      {
        success: false,
        message: "Registration failed. Please try again.",
      },
      500
    );
  }
});

// POST /api/auth/verify-email - Verify email with code
// Apply rate limiting to prevent brute-force attacks on 6-digit code
app.post("/verify-email", authRateLimit, async (c) => {
  const db = c.get("db");
  const ipAddress = getIpAddress(c);

  const body = await c.req.json();
  const { email, code } = body;

  // Normalize email to lowercase
  const normalizedEmail = email?.toLowerCase() || "";

  // Validate inputs
  if (!normalizedEmail || !code) {
    return c.json(
      {
        success: false,
        message: "Email and verification code are required",
      },
      400
    );
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user) {
      logValidationFailure(
        "/api/auth/verify-email",
        ["User not found"],
        ipAddress,
        normalizedEmail
      );
      return c.json(
        {
          success: false,
          message: "User not found",
        },
        404
      );
    }

    if (user.isEmailVerified) {
      return c.json(
        {
          success: false,
          message: "Email already verified",
        },
        400
      );
    }

    // Check if code has expired first
    if (
      !user.verificationCodeExpiry ||
      new Date() > user.verificationCodeExpiry
    ) {
      return c.json(
        {
          success: false,
          message: "Verification code has expired. Please register again.",
        },
        400
      );
    }

    // Verify hashed code (compare submitted code with stored hash)
    const codeIsValid = await verifyPassword(code, user.verificationCode || "");

    if (!codeIsValid) {
      logValidationFailure(
        "/api/auth/verify-email",
        ["Invalid verification code"],
        ipAddress,
        normalizedEmail
      );
      return c.json(
        {
          success: false,
          message: "Invalid verification code",
        },
        400
      );
    }

    // Mark as verified
    await db
      .update(users)
      .set({
        isEmailVerified: true,
        verificationCode: null,
        verificationCodeExpiry: null,
      })
      .where(eq(users.id, user.id));

    // Generate token for login
    const token = await generateJWT(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      c.env.JWT_SECRET,
      "4h"
    );

    // Log successful verification
    securityLogger.log({
      eventType: SecurityEventType.LOGIN_SUCCESS,
      severity: SeverityLevel.LOW,
      username: normalizedEmail,
      ipAddress,
      message: `Email verified: ${normalizedEmail}`,
    });

    try {
      await createSession(c, {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (sessionError) {
      console.error("Failed to create session cookie", sessionError);
    }

    return c.json({
      success: true,
      message: "Email verified successfully",
      data: {
        token,
        expiresIn: "4h",
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          rfidTag: user.rfidTag,
        },
      },
    });
  } catch (error: any) {
    securityLogger.log({
      eventType: SecurityEventType.ERROR,
      severity: SeverityLevel.HIGH,
      username: email,
      ipAddress,
      message: "Email verification failed",
      metadata: { error: error.message },
    });

    return c.json(
      {
        success: false,
        message: "Verification failed. Please try again.",
      },
      500
    );
  }
});

// POST /api/auth/refresh
app.post("/refresh", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        message: "No token provided",
      },
      401
    );
  }

  const token = authHeader.substring(7);

  try {
    // Verify the old token (even if expired, we can extract the payload)
    const payload = await verifyJWT(token, c.env.JWT_SECRET);

    const db = c.get("db");

    // Verify user still exists and is active
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.id))
      .limit(1);

    if (!user) {
      return c.json(
        {
          success: false,
          message: "User not found",
        },
        404
      );
    }

    if (!user.isActive) {
      return c.json(
        {
          success: false,
          message: "Account is inactive",
        },
        403
      );
    }

    // Generate new token with updated data
    const newToken = await generateJWT(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      c.env.JWT_SECRET
    );

    try {
      await refreshSession(c, {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (sessionError) {
      console.error("Failed to refresh session cookie", sessionError);
    }

    return c.json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        token: newToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          rfidTag: user.rfidTag,
        },
      },
    });
  } catch (error: any) {
    console.error("Token refresh error:", error);
    return c.json(
      {
        success: false,
        message: "Token refresh failed",
        error: error.message,
      },
      401
    );
  }
});

// POST /api/auth/logout
app.post("/logout", authMiddleware, async (c) => {
  // In a stateless JWT system, logout is handled client-side by removing the token
  // However, we can add server-side logic here if needed (e.g., token blacklisting)

  const user = c.get("user");

  // Optional: Log the logout event
  console.log(`User ${user.email} (ID: ${user.id}) logged out`);

  clearSession(c);

  // Optional: You could add token to a blacklist table here
  // For now, we'll just return success
  return c.json({
    success: true,
    message: "Logout successful",
    data: {
      loggedOut: true,
    },
  });
});

// Add more auth endpoints: register, refresh, logout, etc.

export default app;
