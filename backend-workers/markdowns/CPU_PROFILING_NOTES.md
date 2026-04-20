# Worker CPU Profiling Notes

_Last updated: 2025-11-21_

## How to pull current telemetry

1. **Run slow-endpoint query** (Cloudflare dashboard → Analytics Engine):
   ```sql
   SELECT indexes[1] AS endpoint,
          COUNT(*) AS calls,
          AVG(doubles[0]) AS avg_ms,
          PERCENTILE(doubles[0], 0.95) AS p95_ms
   FROM tagsakay_observability
   WHERE indexes[0] IN ('REQUEST','ERROR')
   GROUP BY endpoint
   ORDER BY p95_ms DESC
   LIMIT 25;
   ```
2. **Compare request volume vs. CPU** by exporting the query above and pairing with the Workers CPU graph (Workers → Observability → CPU time). Spikes that align to high `p95_ms` rows are the top optimization targets.

## Current hotspots (code review + recent telemetry)

| Endpoint                      | Why it is expensive                                                                                                                                                        | File reference                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST /api/rfid/scan`         | Performs three serial lookups (tag, user, duplicates) and unconditional insert per scan; bursts of device traffic keep the Worker CPU busy doing per-request Drizzle work. | `backend-workers/src/routes/rfid.ts` (~lines 180-400)   |
| `GET /api/rfid/scans/history` | Builds large result sets (up to 2k rows) with joins, runtime filtering, and JSON normalization loops per request.                                                          | `backend-workers/src/routes/rfid.ts` (~lines 1220-1410) |
| `GET /api/rfid/unregistered`  | Uses `fetchUnregisteredTags` which runs an extra case-insensitive lookup per candidate tag (`Promise.all` over each tag). CPU time grows with the scan backlog.            | `backend-workers/src/routes/rfid.ts` (~lines 230-360)   |
| `GET /api/devices`            | Returns every device then enriches each record (ISO conversions, status math). The in-memory transformation becomes costly when dashboards auto-refresh every few seconds. | `backend-workers/src/routes/device.ts` (~lines 60-170)  |

## Next steps

- Cache expensive lookups (RFID tag + user) between scans for a short TTL.
- Batch lookups in `fetchUnregisteredTags` instead of checking each tag individually.
- Memoize device enrich results (or paginate) for list endpoints used by the driver console.
- Push summary analytics (weekly/monthly stats) into cached KV/blobs refreshed periodically.

Document any measurements after implementing each change so we can track CPU deltas release-over-release.

## Implemented optimizations (2025-11-21)

- **RFID tag cache**: `POST /api/rfid/scan` now keeps a 10s, 500-entry cache of tag+user lookups, eliminating redundant Drizzle reads during busy boarding windows.
- **SQL batching for `/unregistered`**: aggregation happens in PostgreSQL (CTE + window functions) so the Worker no longer loops over every failed scan tag.
- **Rolling stat cache**: weekly/monthly analytics endpoints reuse a 60s cache, saving repeated aggregate scans when dashboards auto-refresh.

## Additional optimizations (2025-11-24)

- **Device list pagination**: `GET /api/devices` now supports `limit` (default 50, max 200) and `page` (default 1) parameters, reducing in-memory enrichment to only paginated records. Counts are computed efficiently in SQL.
- **Scan history pagination**: `GET /api/rfid/scans/history` now supports `page` parameter with offset-based pagination, limiting processing to requested page size while providing total counts for navigation.

_Next release_: validate CPU graph after redeploy; expect additional 10-15% drop during dashboard refreshes and history queries with large result sets.

## Throughput re-test checklist

1. **Baseline (pre-deploy)** – capture 15 minutes of CPU + request metrics (`Workers → Observability → CPU time`, plus slow-endpoint query above filtered to the last 1h) to compare against future runs.
2. **Replay scan burst** – run `npm run test:api scanRfid '{"tagId":"ABC123","deviceId":"001122"}'` in a loop (or the ESP32 hardware) at ~5 req/sec for 2 minutes to confirm the tag cache holds steady (watch success P95 stay < 120 ms).
3. **Hit dashboards** – load the admin analytics page + driver console, confirm `/stats/weekly`, `/stats/monthly`, and `/stats/dashboard` reuse cached data (one DB query per minute in `db.execute` logs).
4. **Compare CPU** – 10 minutes after redeploy, export CPU chart + slow-endpoint query. Expect ~10% lower CPU during scan bursts and significantly fewer `/unregistered` invocations (SQL now handles batching).
5. **Log findings** – append deltas + screenshots into `markdowns/05_PROGRESS.md` so future work can track regressions.
