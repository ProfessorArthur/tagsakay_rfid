import type { MiddlewareHandler } from "hono";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:8787",
  "https://api.tagsakay.com",
  "https://app.tagsakay.com",
  "https://tagsakay.com",
  "https://www.tagsakay.com",
];

const normalizeOrigin = (origin: string | null | undefined): string | null => {
  if (!origin) {
    return null;
  }
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
};

const setCorsHeaders = (headers: Headers, origin: string) => {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
};

export const customCors = (): MiddlewareHandler => {
  return async (c, next) => {
    const origin = normalizeOrigin(c.req.header("origin"));

    if (c.req.method === "OPTIONS") {
      const response = new Response(null, { status: 204 });
      const headers = response.headers;
      if (origin) {
        setCorsHeaders(headers, origin);
      }
      headers.set(
        "Access-Control-Allow-Methods",
        "GET,HEAD,POST,PUT,DELETE,OPTIONS"
      );
      headers.set(
        "Access-Control-Allow-Headers",
        c.req.header("Access-Control-Request-Headers") ??
          "Content-Type, Authorization"
      );
      headers.set("Access-Control-Max-Age", "86400");
      const varyHeader = headers.get("Vary");
      headers.set(
        "Vary",
        varyHeader
          ? `${varyHeader}, Access-Control-Request-Headers`
          : "Access-Control-Request-Headers"
      );
      return response;
    }

    let error: unknown;
    try {
      await next();
    } catch (err) {
      error = err;
    } finally {
      if (origin) {
        setCorsHeaders(c.res.headers, origin);
      }
    }

    if (error) {
      throw error;
    }
  };
};
