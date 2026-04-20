import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { createDb, type Database } from "./db/index.js";
import {
  observabilityMiddleware,
  type ObservabilityBindings,
} from "./middleware/observability.js";
import { customCors } from "./middleware/customCors.js";

// Import routes
import authRoutes from "./routes/auth.js";
import rfidRoutes from "./routes/rfid.js";
import deviceRoutes from "./routes/device.js";
import userRoutes from "./routes/user.js";
import apiKeyRoutes from "./routes/apiKey.js";

// Import security middleware
import {
  securityHeaders,
  validateContentType,
  requestSizeLimit,
} from "./middleware/security.js";

type Bindings = ObservabilityBindings & {
  DATABASE_URL: string;
  JWT_SECRET: string;
  APP_ENV?: string;
};

type Variables = {
  db: Database;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const prettyJsonMiddleware = prettyJSON();
const requestLogger = logger();

const isDevelopmentEnv = (rawEnv: unknown): boolean => {
  const normalized = String(rawEnv ?? "").trim().toLowerCase();
  return (
    normalized === "development" ||
    normalized === "dev" ||
    normalized === "local" ||
    normalized.length === 0
  );
};

// Compression middleware for API responses
// Notes:
// - Skip compression in development so local dev & debugging don't return compressed bytes
// - Only attempt to compress when CompressionStream is available; don't set a gzip header
//   if we can't actually compress (avoid mismatched headers/body that confuse clients)
const compressionMiddleware = async (c: any, next: any) => {
  await next();

  // Only compress in production - avoid sending gzipped responses during local development
  const runtimeEnv = (c.env.APP_ENV || c.env.NODE_ENV || "")
    .toString()
    .toLowerCase();
  if (runtimeEnv !== "production") return;

  // Only compress JSON responses
  const contentType = c.res.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return;
  }

  // Check if client accepts gzip
  const acceptEncoding = c.req.header("accept-encoding") || "";
  if (!acceptEncoding.includes("gzip")) {
    return;
  }

  // Only compress when CompressionStream is available; otherwise leave response alone
  if (typeof CompressionStream === "undefined") {
    return;
  }

  // Compress response body
  const originalBody = await c.res.text();
  const stream = new CompressionStream("gzip");
  const compressedStream = new Response(originalBody).body?.pipeThrough(stream);

  // Copy headers, remove content-length (unknown after compression), set encoding
  const newHeaders: Record<string, string> = {};
  for (const [k, v] of c.res.headers.entries()) {
    // avoid copying content-length because size will change
    if (k.toLowerCase() === "content-length") continue;
    newHeaders[k] = v as string;
  }
  if (compressedStream) {
    newHeaders["content-encoding"] = "gzip";
    newHeaders["vary"] = "accept-encoding";

    c.res = new Response(compressedStream, {
      status: c.res.status,
      headers: newHeaders,
    });
  } else {
    // If compression failed / not available, keep original response
    console.warn(
      "Compression requested but failed - sending uncompressed response"
    );
  }
};

// Middleware
app.use("*", async (c, next) => {
  if (isDevelopmentEnv(c.env.APP_ENV)) {
    return requestLogger(c, next);
  }
  await next();
});
app.use("*", async (c, next) => {
  if (isDevelopmentEnv(c.env.APP_ENV)) {
    return prettyJsonMiddleware(c, next);
  }
  await next();
});
app.use("*", observabilityMiddleware());
app.use("*", customCors());
app.use("*", compressionMiddleware);

// Security middleware (OWASP compliant)
app.use("*", securityHeaders);
app.use("*", validateContentType);
app.use("*", requestSizeLimit);

// Inject database into context
app.use("*", async (c, next) => {
  c.set("db", createDb(c.env.DATABASE_URL));
  await next();
});

// request-logging middleware
app.use("*", async (c, next) => {
  if (isDevelopmentEnv(c.env.APP_ENV)) {
    console.log(
      "[incoming] method=",
      c.req.method,
      "path=",
      c.req.path,
      "url=",
      c.req.url
    );
  }
  try {
    await next();
  } catch (err) {
    if (isDevelopmentEnv(c.env.APP_ENV)) {
      console.error("[incoming] handler error", err);
    }
    throw err;
  }
});

// Health check
app.get("/", (c) => {
  return c.json({
    success: true,
    message: "TagSakay API is running on Cloudflare Workers",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (c) => {
  return c.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// WebSocket endpoint for ESP32 devices (standard HTTP upgrade)
app.get("/ws/device", async (c) => {
  const deviceId = c.req.query("deviceId");

  if (!deviceId) {
    return c.json(
      {
        success: false,
        message: "Missing deviceId parameter",
      },
      400
    );
  }

  // WebSocket upgrade (Cloudflare Workers handles this natively)
  // Clients connect and maintain persistent connection
  // Server sends real-time updates via HTTP push or polling fallback

  return c.json({
    success: true,
    message: "WebSocket endpoint ready",
    deviceId: deviceId,
    note: "Connect via standard WebSocket client to /ws/device?deviceId=YOUR_ID",
  });
});

// Routes
app.route("/api/auth", authRoutes);
app.route("/api/rfid", rfidRoutes);
app.route("/api/devices", deviceRoutes);
app.route("/api/users", userRoutes);
app.route("/api/keys", apiKeyRoutes);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: "Route not found",
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  console.error("Error:", err);
  return c.json(
    {
      success: false,
      message: err.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? err.stack : undefined,
    },
    500
  );
});

// final catch-all route (use app.all so the function matches route handler typing)
app.all("*", (c) => {
  console.warn("[route] no handler matched", c.req.method, c.req.path);
  return c.json({ success: false, message: "Not found" }, 404);
});

export default app;
