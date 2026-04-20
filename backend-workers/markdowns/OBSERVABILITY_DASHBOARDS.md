# TagSakay Observability Dashboards

## Overview

The API now streams per-request telemetry to Cloudflare Workers Analytics Engine via the `OBSERVABILITY_DATASET` binding. Every request records:

| Field        | Source         | Notes                                                         |
| ------------ | -------------- | ------------------------------------------------------------- |
| `indexes[0]` | `eventType`    | `REQUEST` for < 500 status, `ERROR` for failures/exceptions   |
| `indexes[1]` | `method route` | e.g., `POST /api/rfid/scan`                                   |
| `ints[0]`    | HTTP status    | Stored as integer                                             |
| `ints[1]`    | Success flag   | `1` for status < 400, otherwise `0`                           |
| `doubles[0]` | Duration       | Rounded milliseconds                                          |
| `blobs[0]`   | JSON payload   | Includes route, method, cf-ray, client IP, UA, error metadata |

Use these metrics to build dashboards for uptime, error rates, and performance regression tracking.

## 1. Create/Verify the Dataset

```bash
# Create once per account
wrangler analytics create tagsakay_observability

# Confirm binding in wrangler.toml
[[analytics_engine_datasets]]
binding = "OBSERVABILITY_DATASET"
dataset = "tagsakay_observability"
```

Deploy the Worker (`npm run deploy`) so the binding attaches in production.

## 2. Sample Queries

### Success vs Error Trend (5-minute bins)

```sql
SELECT
  DATE_BIN('5 minutes', _timestamp) AS window,
  SUM(CASE WHEN ints[1] = 1 THEN 1 ELSE 0 END) AS successes,
  SUM(CASE WHEN ints[1] = 0 THEN 1 ELSE 0 END) AS failures
FROM tagsakay_observability
WHERE indexes[0] IN ('REQUEST','ERROR')
GROUP BY window
ORDER BY window DESC
LIMIT 288; -- 24 hours
```

### Slowest Endpoints (>400ms)

```sql
SELECT
  indexes[1] AS endpoint,
  COUNT(*) AS total_calls,
  AVG(doubles[0]) AS avg_ms,
  PERCENTILE(doubles[0], 0.95) AS p95_ms
FROM tagsakay_observability
WHERE doubles[0] > 400
GROUP BY endpoint
ORDER BY p95_ms DESC
LIMIT 20;
```

### Error Details by Route

```sql
SELECT
  indexes[1] AS endpoint,
  ints[0] AS status,
  JSON_VALUE(blobs[0], '$.errorMessage') AS error_message,
  COUNT(*) AS occurrences
FROM tagsakay_observability
WHERE indexes[0] = 'ERROR'
GROUP BY endpoint, status, error_message
ORDER BY occurrences DESC
LIMIT 50;
```

## 3. Build Dashboards in Cloudflare

1. Cloudflare Dashboard → Workers & Queues → _tagsakay-api_ → **Observability** → **Analytics dashboards**.
2. Click **Create dashboard**, select **Analytics Engine** as the source, and paste any query above.
3. Configure visualizations:
   - Stack area chart for success vs failure trend.
   - Table or bar chart for slow endpoints.
   - Pie chart for status code distribution.
4. Save dashboards and share with the team (viewer roles need Workers access).

## 4. Alerts & Follow-Up

- Use dashboard thresholds to define manual alerting (e.g., failure count > 20/5 min).
- Pair with existing security logs for incident reviews (see `Error Logging.md`).
- Extend instrumentation by calling `recordCustomObservabilityEvent` for domain-specific KPIs (device registration, RFID scans, etc.).

_Last updated: 2025-11-21_
