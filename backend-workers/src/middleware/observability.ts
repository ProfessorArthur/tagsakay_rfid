import type { MiddlewareHandler } from "hono";

const EVENT_VERSION = "1.0.0";
const SKIP_ROUTES = new Set(["/", "/health"]);

type ObservabilityPayload = {
  eventType: "REQUEST" | "ERROR";
  route: string;
  method: string;
  status: number;
  durationMs: number;
  success: boolean;
  requestId?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  cfRay?: string | null;
  errorName?: string;
  errorMessage?: string;
};

type AnalyticsEngineDataset = {
  writeDataPoint: (data: {
    indexes?: string[];
    doubles?: number[];
    blobs?: string[];
    ints?: number[];
  }) => Promise<void> | void;
};

export type ObservabilityBindings = {
  OBSERVABILITY_DATASET?: AnalyticsEngineDataset;
};

const getDataset = (env: unknown): AnalyticsEngineDataset | undefined => {
  if (!env || typeof env !== "object") {
    return undefined;
  }

  return (env as ObservabilityBindings).OBSERVABILITY_DATASET;
};

const queueWrite = (
  dataset: AnalyticsEngineDataset,
  payload: ObservabilityPayload,
  waitUntil?: (promise: Promise<any>) => void
) => {
  const data = {
    timestamp: new Date().toISOString(),
    version: EVENT_VERSION,
    ...payload,
  } satisfies ObservabilityPayload & { timestamp: string; version: string };

  const routeKey = `${payload.method} ${payload.route}`.slice(0, 256);
  const indexValue = `${payload.eventType}:${routeKey}`.slice(0, 512);

  const writePromise = dataset.writeDataPoint({
    indexes: [indexValue],
    ints: [payload.status, payload.success ? 1 : 0],
    doubles: [payload.durationMs],
    blobs: [JSON.stringify(data)],
  }) as Promise<void>;

  if (waitUntil) {
    waitUntil(writePromise);
    return;
  }

  void writePromise;
};

export const observabilityMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const path = c.req.path;
    if (c.req.method === "OPTIONS" || SKIP_ROUTES.has(path)) {
      await next();
      return;
    }

    const dataset = getDataset(c.env);

    if (!dataset) {
      await next();
      return;
    }

    const start = performance.now();
    const basePayload = {
      route: c.req.routePath ?? path,
      method: c.req.method,
      requestId: c.req.header("cf-request-id") ?? c.req.header("x-request-id"),
      clientIp:
        c.req.header("cf-connecting-ip") ??
        c.req.header("x-forwarded-for") ??
        null,
      userAgent: c.req.header("user-agent"),
      cfRay: c.req.header("cf-ray"),
    } satisfies Partial<ObservabilityPayload>;

    try {
      await next();
      const durationMs = Math.round(performance.now() - start);
      const status = c.res.status ?? 200;
      const payload: ObservabilityPayload = {
        ...basePayload,
        eventType: status >= 500 ? "ERROR" : "REQUEST",
        status,
        durationMs,
        success: status < 400,
        route: basePayload.route ?? path,
        method: basePayload.method ?? c.req.method,
      };

      queueWrite(
        dataset,
        payload,
        c.executionCtx?.waitUntil.bind(c.executionCtx)
      );
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      const payload: ObservabilityPayload = {
        ...basePayload,
        eventType: "ERROR",
        route: basePayload.route ?? path,
        method: basePayload.method ?? c.req.method,
        status: 500,
        durationMs,
        success: false,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      };

      queueWrite(
        dataset,
        payload,
        c.executionCtx?.waitUntil.bind(c.executionCtx)
      );
      throw error;
    }
  };
};

export const recordCustomObservabilityEvent = (
  env: unknown,
  payload: ObservabilityPayload,
  waitUntil?: (promise: Promise<any>) => void
) => {
  const dataset = getDataset(env);
  if (!dataset) {
    return;
  }

  queueWrite(dataset, payload, waitUntil);
};
