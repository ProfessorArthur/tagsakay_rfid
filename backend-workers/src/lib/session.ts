import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";

const SESSION_COOKIE_NAME = "ts_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  id: number;
  email: string;
  role: string;
  name: string;
}

function getSecretKey(c: Context): Uint8Array {
  const secret = c.env.SESSION_SECRET;

  if (!secret || secret.trim().length === 0) {
    throw new Error("SESSION_SECRET is not configured");
  }

  return new TextEncoder().encode(secret);
}

function isSecureRequest(c: Context): boolean {
  try {
    const url = new URL(c.req.url);
    if (url.protocol === "https:") {
      return true;
    }
  } catch (_error) {
    // Ignore parsing issues and fall back to secure by default
  }

  // Cloudflare sets CF-Visitor header with scheme information
  const cfVisitor = c.req.header("CF-Visitor");
  if (cfVisitor && cfVisitor.includes('"scheme":"https"')) {
    return true;
  }

  // Default to false for local development when protocol can't be determined
  return false;
}

export async function createSession(c: Context, payload: SessionPayload) {
  const secretKey = getSecretKey(c);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const tokenPayload: JWTPayload = { ...payload };

  const token = await new SignJWT(tokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey);

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export function clearSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

export async function getSession(c: Context): Promise<SessionPayload | null> {
  const sessionCookie = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return null;
  }

  try {
    const secretKey = getSecretKey(c);
    const { payload } = await jwtVerify(sessionCookie, secretKey, {
      algorithms: ["HS256"],
    });

    return {
      id: payload.id as number,
      email: payload.email as string,
      role: payload.role as string,
      name: payload.name as string,
    } satisfies SessionPayload;
  } catch (error) {
    // Invalid session cookie: remove it to avoid repeated failures
    clearSession(c);
    console.warn("Failed to verify session cookie", error);
    return null;
  }
}

export async function refreshSession(c: Context, payload: SessionPayload) {
  return createSession(c, payload);
}
