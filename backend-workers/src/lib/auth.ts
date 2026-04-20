import * as jose from "jose";

// ============================================================================
// PASSWORD HASHING - OWASP Compliant
// ============================================================================
// Uses PBKDF2; Cloudflare Workers cap iteration count at 100,000
// Format: algorithm$iterations$salt$hash

const PBKDF2_ITERATIONS = 100000; // Cloudflare Web Crypto upper limit
const MAX_SUPPORTED_ITERATIONS = 100000;
const SALT_LENGTH = 16; // 16 bytes = 128 bits
const HASH_LENGTH = 32; // 32 bytes = 256 bits

export async function hashPassword(password: string): Promise<string> {
  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  // Import password as key material
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive key using PBKDF2
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    HASH_LENGTH * 8 // bits
  );

  // Convert to hex strings
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Return in format: pbkdf2$iterations$salt$hash
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  // Parse stored hash
  const parts = storedHash.split("$");

  // Handle legacy SHA-256 hashes (for backward compatibility during migration)
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    // Legacy SHA-256 verification
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const legacyHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return legacyHash === storedHash;
  }

  const [, iterations, saltHex, hashHex] = parts;
  const iterationCount = parseInt(iterations);

  if (iterationCount > MAX_SUPPORTED_ITERATIONS) {
    console.error(
      `PBKDF2 iteration count ${iterationCount} exceeds platform limit (${MAX_SUPPORTED_ITERATIONS}).`
    );
    return false;
  }

  // Convert hex strings back to Uint8Array
  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );
  const originalHash = new Uint8Array(
    hashHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  // Derive key using same parameters
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedHashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterationCount,
      hash: "SHA-256",
    },
    passwordKey,
    HASH_LENGTH * 8
  );

  const derivedHash = new Uint8Array(derivedHashBuffer);

  // Constant-time comparison to prevent timing attacks
  return constantTimeCompare(originalHash, derivedHash);
}

// Constant-time comparison to prevent timing attacks
function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

// ============================================================================
// JWT SECURITY - OWASP Compliant
// ============================================================================
// Uses HS256 with proper claims validation
// Reduced expiration time from 24h to 4h
// Includes jti (JWT ID) for token tracking/blacklisting

export async function generateJWT(
  payload: any,
  secret: string,
  expiresIn: string = "4h" // Reduced from 24h per OWASP guidance
): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);

  // Generate unique JWT ID for token tracking
  const jti = generateRandomId();

  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setNotBefore(Math.floor(Date.now() / 1000)) // nbf claim
    .setIssuer("tagsakay-api") // iss claim
    .setAudience("tagsakay-client") // aud claim
    .setJti(jti) // JWT ID for tracking
    .sign(secretKey);

  return jwt;
}

export async function verifyJWT(
  token: string,
  secret: string,
  options: {
    checkIssuer?: boolean;
    checkAudience?: boolean;
  } = {}
): Promise<any> {
  try {
    const secretKey = new TextEncoder().encode(secret);

    // Verify with all standard claims
    const { payload } = await jose.jwtVerify(token, secretKey, {
      issuer: options.checkIssuer !== false ? "tagsakay-api" : undefined,
      audience: options.checkAudience !== false ? "tagsakay-client" : undefined,
      clockTolerance: 30, // Allow 30 seconds clock skew
    });

    // Additional validation checks
    if (!payload.iat) {
      throw new Error("Missing issued at (iat) claim");
    }

    if (!payload.exp) {
      throw new Error("Missing expiration (exp) claim");
    }

    // Validate nbf (not before) claim if present
    if (payload.nbf) {
      const now = Math.floor(Date.now() / 1000);
      if (now < payload.nbf) {
        throw new Error("Token not yet valid (nbf)");
      }
    }

    return payload;
  } catch (error) {
    // Generic error message to prevent information disclosure
    throw new Error("Invalid or expired token");
  }
}

// Generate random ID for JWT tracking
function generateRandomId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

// ============================================================================
// API KEY SECURITY - OWASP Compliant
// ============================================================================
// Generates cryptographically secure 32-byte API keys
// Uses PBKDF2 for API key hashing (same as passwords)

export function generateApiKey(prefix: string = "tsk"): string {
  // Generate 32 bytes of random data (256 bits)
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);

  // Convert to base62 (alphanumeric) for better readability
  const base62 =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";

  for (let i = 0; i < array.length; i++) {
    result += base62[array[i] % base62.length];
  }

  // Add prefix for identification (e.g., tsk_dev_xxx)
  return `${prefix}_${result}`;
}

export async function hashApiKey(apiKey: string): Promise<string> {
  // Use same PBKDF2 hashing as passwords for API keys
  return await hashPassword(apiKey);
}

export async function verifyApiKey(
  apiKey: string,
  storedHash: string
): Promise<boolean> {
  // Use same verification as passwords
  return await verifyPassword(apiKey, storedHash);
}

// ============================================================================
// PASSWORD STRENGTH VALIDATION - OWASP Compliant
// ============================================================================
// OWASP recommends: min 8 chars with MFA, min 15 chars without MFA

export interface PasswordStrength {
  isValid: boolean;
  errors: string[];
  score: number; // 0-4 (weak to strong)
}

export function validatePasswordStrength(
  password: string,
  hasMFA: boolean = false
): PasswordStrength {
  const errors: string[] = [];
  let score = 0;

  // Minimum length check (OWASP guidelines)
  const minLength = hasMFA ? 8 : 15;
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters`);
  } else {
    score++;
  }

  // Maximum length check (prevent DoS)
  if (password.length > 128) {
    errors.push("Password must not exceed 128 characters");
  }

  // Check for complexity (optional but recommended)
  if (password.length >= minLength) {
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
  }

  // Check for common patterns (basic)
  const commonPatterns = [
    /^123456/,
    /^password/i,
    /^qwerty/i,
    /^admin/i,
    /^letmein/i,
  ];

  if (commonPatterns.some((pattern) => pattern.test(password))) {
    errors.push("Password contains common patterns");
    score = Math.max(0, score - 2);
  }

  return {
    isValid:
      errors.length === 0 &&
      password.length >= minLength &&
      password.length <= 128,
    errors,
    score: Math.min(4, score),
  };
}
