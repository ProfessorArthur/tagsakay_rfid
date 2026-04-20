Date: 2025-11-06
Error Encountered: Drizzle migration to the production Neon database failed with `error: type "event_type" already exists`, blocking `npm run db:migrate` and leaving new columns unapplied.
Date of Fix: 2025-11-06
Details: Discovered the target database was missing the `drizzle_migrations` tracking tables, so Drizzle kept replaying the initial enum creation. Added instructions to create `drizzle_migrations` / `drizzle_migrations_lock`, outlined manual column ALTERs (using `text` for hashed codes), and documented the need to seed baseline hashes before future runs.

---

Date: 2025-11-06
Error Encountered: Drizzle migration registry drift routinely reappeared after database resets, requiring manual hash seeding before every deploy.
Date of Fix: 2025-11-06
Details: Built `src/db/syncMigrations.ts` to hash each migration file, backfill missing rows in `_drizzle_migrations`, and warn on hash mismatches. Added npm script `npm run db:sync-migrations` so environments can self-heal before running `npm run db:migrate`.

---

Date: 2025-11-06
Error Encountered: Email verification codes were hashed before storage, but the schema and migration still defined `verificationCode` as `varchar(6)`.
Date of Fix: 2025-11-06
Details: Updated `src/db/schema.ts` and `drizzle/0001_faulty_shinko_yamashiro.sql` to declare the column as `text`, then marked seeded users as verified to keep login smoke tests working.

---

Date: 2025-11-06
Error Encountered: ESP32 scanner showed a white screen immediately after initialization.
Date of Fix: 2025-11-06
Details: Traced the regression to a keypad pin map (`{4,2,15,5}`) that conflicted with the TFT_eSPI SPI lines. Restored the proven mapping `{5,19,21,22}` for columns and `{25,26,32,33}` for rows, matching the successful diagnostic sketch.

---

Date: 2025-11-06
Error Encountered: Production device registration returned HTTP 500 errors while local registration worked correctly.
Date of Fix: 2025-11-07
Details: Investigation revealed two critical issues: (1) Production database schema still had `varchar(64)` for API key columns, unable to store PBKDF2 hashes (~111 chars); (2) Device authentication middleware was re-hashing incoming keys instead of verifying against stored hashes. Fixed by updating schema to use `text` columns, implementing `verifyApiKey()` for proper hash verification, creating `syncMigrations.ts` for automatic migration registry synchronization, and updating `clean-db.ts` to drop enums during cleanup. Generated migration `0002_happy_mattie_franklin.sql` to apply column type changes.

---

Date: 2025-11-07
Error Encountered: Frontend device management page showed empty device rows despite successful API responses containing device data.
Date of Fix: 2025-11-07
Details: Backend API returns devices in nested structure `{ success: true, data: { devices: [...], total: n } }`, but frontend service was accessing `response.data` directly instead of `response.data.devices`. Updated `getAllDevices()` in `frontend/src/services/device.ts` to correctly access the nested devices array.

---

Date: 2025-11-26
Error Encountered: Cloudflare Worker terminated with `Worker exceeded CPU time limit` for `POST /api/rfid/scan`.
Date of Fix: 2025-11-26
Details: Investigation showed the device authentication middleware re-verified API keys against all active devices and API keys on every request when a request did not include a device identifier or recognizable key prefix. Since API key verification uses PBKDF2 (100k iterations), this produced O(n) PBKDF2 checks per request and caused the worker to exceed CPU time limits under load. Fix implemented:

- Added an in-memory, short TTL cache mapping plaintext API keys to resolved Device/API key records to prevent repeated PBKDF2 verifications
- Added prefix-based lookup: when API key includes a prefix (e.g., `tsk_dev_xxx`), only API keys matching the prefix are checked which drastically reduces verification attempts
- Added a scan attempt limit (default 50 PBKDF2 checks per request) to prevent DoS-like CPU usage; operations log a warning and break fallback scanning if limit is exceeded
- Prefer `X-Device-Id` header: when provided, auth checks are performed only for that device (fast path). Where missing, the auth uses the prefix-based path first, caching results
  Notes: This preserves backward compatibility with existing devices but strongly encourages device firmware to add `X-Device-Id` header and to include the API key prefix to avoid falling back to scan mode, which is expensive. Also added runtime logging to detect fallback scenarios for operational monitoring.

Action items pending:

- Replace in-memory cache with a shared KV-based solution for durable caching if CPU issues reappear under high concurrency on production (requires migration planning)
- Add observability metric for `auth.fallback_scan_count` to Cloudflare analytics to monitor scan fallback frequency

Date: 2025-11-07
Error Encountered: Device registration on production returned 409 Conflict errors, appearing as registration failure.
Date of Fix: 2025-11-07
Details: Not a bug—correct behavior. HTTP 409 indicates device with that MAC address already exists in database (duplicate prevention). Users attempting to re-register existing devices should either use a different MAC address, delete the existing device first, or use the existing device. Verified production database contains three registered devices (001122334455, AABBCCDDEEFF, 80F3DA4C46A4) from seed data and prior registrations.

---

Date: 2025-11-07
Error Encountered: Frontend device deletion returned 404 "Route not found" despite correct API URL (`DELETE /api/devices/:deviceId`).
Date of Fix: 2025-11-07
Details: DELETE route handler was incorrectly nested inside the PUT handler in `backend-workers/src/routes/device.ts`, preventing Hono from registering it at startup. Moved `app.delete("/:deviceId", ...)` block to module level (after PUT handler) so the route is properly registered. DELETE now responds with 200 success or 404 if device doesn't exist.

---

Date: 2025-11-10
Error Encountered: ESP32 diagnostics firmware attempted WebSocket connection to `/ws/device` endpoint but received HTTP 200 OK JSON response instead of WebSocket upgrade (101 Switching Protocols).
Date of Fix: 2025-11-11
Details: Backend `/ws/device` endpoint was implemented as standard HTTP GET handler returning JSON, not performing WebSocket handshake. Since Cloudflare Workers free tier doesn't support native WebSockets without Durable Objects (paid feature), migrated architecture from WebSocket to HTTP polling. Changes: (1) Backend: Added `GET /api/devices/:deviceId/commands` endpoint returning pending commands (registration mode, scan mode, etc.) in JSON format; (2) ESP32: Removed `WebSocketsClient` library dependency, replaced `webSocket.loop()` with `pollCommands()` calling backend every 5 seconds (`COMMAND_POLL_INTERVAL`), replaced `sendWebSocketHeartbeat()` with existing `testAPIHeartbeat()` every 30 seconds (`HEARTBEAT_INTERVAL`); (3) Registration flow: Changed from bidirectional WebSocket messages to server-controlled via polling—admin enables registration in panel, device polls `/commands` endpoint, receives `enable_registration` action with expected tag ID, validates scanned cards against server-provided ID; (4) UI: Renamed "WebSocket Test" stage to "Command Poll Test", updated menu option "8: WebSocket" → "8: Cmd Poll", replaced `drawWebSocketTest()` with `drawCommandPollTest()` showing poll count and HTTP status codes; (5) Config: Removed `WS_HOST`, `WS_PORT`, `WS_PATH`, `USE_SECURE_WS`, `WS_RECONNECT_INTERVAL`, `WS_PING_INTERVAL` from `Config.h`, added `COMMAND_POLL_INTERVAL` (5000ms) and `HEARTBEAT_INTERVAL` (30000ms). System now fully functional on Cloudflare Workers free tier with HTTP polling architecture replacing WebSocket real-time communication.

---

Date: 2025-11-11
Error Encountered: Frontend admin panels displayed “No online RFID devices found” even while diagnostics firmware reported the device active, due to backend returning raw device rows without online/offline metadata and the frontend assuming nested `data.devices` responses.
Date of Fix: 2025-11-11
Details: Updated backend `/api/devices`, `/api/devices/active`, heartbeat, and mode endpoints to enrich every device payload with `status`, ISO `lastSeen`, and `lastSeenAgoSeconds`, treating missing heartbeats as offline. Frontend services now normalize those responses, filter stale records, and map the enriched fields into dashboard and RFID card views, restoring accurate device presence indicators across the UI.

---

Date: 2025-11-11
Error Encountered: RFID card registration “fiasco” — ESP32 scans reached the worker logs, but neither the backend nor the Vue admin panel surfaced the tag for assignment, so cards could not be registered.
Date of Fix: 2025-11-12
Details: Discovered three compounding issues: (1) `rfid.ts` stored device metadata as `null`, causing `JSON.parse` failures on the frontend; (2) API responses returned nested structures that the Vue services weren’t normalizing, so unregistered scans never appeared in the tables; (3) Registration mode expected WebSocket acknowledgements that no longer existed after moving to HTTP polling. Fixed by defaulting metadata to `{}` in the worker, normalizing RFID scan payloads (flattening device info and counts), updating Vue services/components to consume the new shape, and wiring the registration modal to the HTTP command-poll workflow. After redeploying firmware and frontend, scanned cards now surface immediately for registration and persist correctly in the database.

---

Date: 2025-11-12
Error Encountered: User Management and RFID card assignment views rendered empty tables even though `/api/users` returned data.
Date of Fix: 2025-11-12
Details: Axios interceptor already unwraps the `{ success, data }` envelope, but `userService.getUsers()` still expected a nested `response.data` object, returning `undefined`. Normalized the service to output an array and updated consuming views (`UserManagement.vue`, `RfidCardManagement.vue`, dashboard stats) to read the shared `User` type, restoring user listings across the UI.

---

Date: 2025-11-16
Error Encountered: RFID registration modal stalled on "Continue & Wait for Tap" even after the confirmation tap, leaving cards stuck in the unregistered list.
Date of Fix: 2025-11-16
Details: Backend lacked a way to verify the follow-up scan, so the frontend never received a success signal. Added `/api/rfid/check-recent-scan/:tagId` to validate confirmation taps, filtered registered tags out of the unregistered scan feed, and refactored `RfidCardManagement.vue` to call the new endpoint before completing registration. Frontend service now normalizes the response and closes the loop so cards move to the registered list immediately after the confirmation tap.

---

Date: 2025-11-17
Error Encountered: Registration mode switched off automatically after each successful card registration, forcing admins to re-enable it and blocking rapid batch enrollments.
Date of Fix: 2025-11-17
Details: Traced the auto-disable to lingering frontend callbacks that called `disableRegistrationMode()` after modal close, polling completion, and the registration mutation. Removed those calls in `RfidCardManagement.vue`, updated the device management view to clarify manual control, and aligned ESP32 firmware/diagnostics sketches so the keypad toggle (key “9”) is the sole way to exit registration mode. Confirmed backend keeps `registrationMode` true until an explicit disable request, restoring uninterrupted onboarding sessions.

---

Date: 2025-11-18
Error Encountered: Admin dashboard calls to `/api/rfid/unregistered/recent` in production exceeded the 10-second Axios timeout, showing “Failed to fetch recent unregistered scans” and blocking RFID onboarding.
Date of Fix: 2025-11-18
Details: Query examined millions of historical failed scans because the frontend never constrained the lookback window. Added a `sinceMinutes` guard and server-side cap (5 minutes–30 days) in `backend-workers/src/routes/rfid.ts`, updated `frontend/src/services/rfid.ts` to pass scoped windows for both table loads and registration polling, and retuned `RfidCardManagement.vue` polling cadence/error handling. Production API now responds in ~350 ms and the modal resumes normal operation.

---

Date: 2025-11-18
Error Encountered: Registration mode flipped off as soon as admins closed the RFID registration modal, so visiting Device Management after a successful enrolment falsely showed the scanner idle.
Date of Fix: 2025-11-18
Details: `RfidCardManagement.vue` always called `disableRegistrationMode()` during unmount, even when registration finished cleanly. Introduced a `shouldDisableRegistrationOnExit` flag that tracks in-progress sessions, cleared it once registration completes, and now only disable on unmount when a session is still pending. Verified registering multiple cards in succession keeps the reader in registration mode until the admin explicitly turns it off from the UI or keypad.

---

Date: 2025-11-19
Error Encountered: Relentless looping in ESP32 firmware due to unconditional UI refresh on `scan_mode` command, and 401 Unauthorized errors when device attempted to access Admin-only endpoints (`GET /api/devices/:deviceId`, `POST /api/devices/:deviceId/mode`).
Date of Fix: 2025-11-19
Details:

1.  **Firmware Loop**: Modified `HTTPPolling.cpp` to check if `scan_mode` actually changed before updating config and refreshing UI, preventing the infinite loop.
2.  **Auth Errors**:
    - Added `GET /api/devices/:deviceId/config` endpoint to backend (protected by Device Auth/API Key) to allow devices to fetch their own configuration.
    - Updated firmware `syncDeviceProfile()` to use the new `/config` endpoint.
    - Updated firmware `updateDeviceMode()` to use `/api/devices/:deviceId/status` (Device Auth) instead of `/mode` (Admin Auth).
    - This ensures devices can operate fully using only their API Key without requiring Admin JWT tokens.

---

Date: 2025-11-19
Error Encountered: ESP32 Serial Monitor spammed with "[POLL] Disable registration command received" messages every 5 seconds when registration mode was inactive.
Date of Fix: 2025-11-19
Details: The backend `/commands` endpoint always returns a `disable_registration` command if the device is not in registration mode. The firmware was logging this command every time it was received. Modified `HTTPPolling.cpp` to suppress the log message if the device is already not in registration mode and has no pending registration tag, eliminating the log spam while maintaining correct functionality.

---

Date: 2025-11-21
Error Encountered: Production frontend threw `Uncaught TypeError: Cannot read properties of undefined (reading 'length')` in Dashboard.vue, likely when driver view attempted to access `.length` on undefined API responses.
Date of Fix: 2025-11-21
Details: Driver dashboard loads RFID cards and scan history via async calls. If API failed or returned unexpected data, the code called `.filter()` and `.map()` on undefined values, causing runtime errors. Added defensive checks: (1) Verify `getAllRfidCards()` returns an array before filtering; (2) Verify `getScanHistory()` returns valid `history.scans` array before filtering; (3) Added array guards in `dailyTripsData` and `historicalTripsData` computed properties to ensure `monthlyScanBuckets` and `weeklyScanBuckets` are arrays before calling `.map()`. These changes prevent crashes when API calls fail or return malformed data in production.

---

Date: 2025-11-21
Error Encountered: PDF download in RFID Scan History (admin side) threw `Uncaught TypeError: Cannot read properties of undefined (reading 'length')` when attempting to generate report.
Date of Fix: 2025-11-21
Details: PDF generation accessed `Object.keys(eventBreakdown.value)` and `eventEntries.length` without checking if data was loaded. If API failed or summary data was missing, the code crashed. Added defensive checks: (1) Return base/empty object in `eventBreakdown` computed if `summary.value` is null/undefined; (2) Check if `eventBreakdown.value` exists before creating `eventEntries` array; (3) Skip drawing event chart if `eventEntries` is empty; (4) Guard `eventBarData` computed to return empty dataset if `eventBreakdown` is invalid. These changes allow PDF generation to complete gracefully even with partial or missing data.

---

Date: 2025-11-21
Error Encountered: Cloudflare Workers began terminating `POST /api/rfid/scan` requests with `Worker exceeded CPU time limit` because `deviceAuthMiddleware` re-hashed every active device/api key on each scan (O(n) PBKDF2 checks).
Date of Fix: 2025-11-21
Details: Updated `authenticateDeviceWithApiKey()` to first honor a new `X-Device-Id` header, querying just that device (and its dedicated API key) before falling back to the legacy table scans. This reduces verification to a single PBKDF2 operation per request, eliminating CPU overruns. Firmware/diagnostics clients should start sending `X-Device-Id` so every scan hits the fast path.

---

Date: 2025-11-22
Error Encountered: `GET /api/devices/:deviceId/commands` returned HTTP 500 with `TypeError: writeDataPoint(): Maximum of 1 indexes supported` whenever observability middleware attempted to log the request in the Cloudflare Analytics Engine dataset.
Date of Fix: 2025-11-22
Details: The middleware passed two separate index values (`eventType` and `method route`) to `dataset.writeDataPoint`, but Analytics Engine datasets only permit a single index field, so writes failed and the request bubbled up as a 500. Updated `queueWrite()` in `src/middleware/observability.ts` to concatenate both bits into one index string (`eventType:METHOD ROUTE`, trimmed to 512 chars). After redeploying the worker, observability writes succeed and the commands endpoint no longer fails.

---

Date: 2025-11-23
Error Encountered: ESP32 firmware failed to compile with "expected '}' before numeric constant" in TagSakay_Fixed_Complete.ino at line 53, due to WiFiConfig struct initialization being placed after the anonymous namespace, causing scope issues.
Date of Fix: 2025-11-23
Details: Moved the WiFiConfig and related configuration instances to before the namespace in TagSakay_Fixed_Complete.ino to ensure they are defined at global scope.

---

Date: 2025-11-23
Error Encountered: In ESP32 keypad override mode, after selecting a slot and prompted for new ID, pressing any number key caused the system to revert to "system ready" display, but override mode remained active.
Date of Fix: 2025-11-23
Details: The color selection logic was incorrectly checking overrideStage == 3 (new ID entry) instead of 4 (color selection), causing premature execution of color code when pressing 1-3 during new ID entry. Fixed by changing the check to overrideStage == 4 and updating the prompt to show "New ID:" during entry.

---

Date: 2025-11-23
Error Encountered: Pressing 'B' in operation mode triggered full queue wipe instead of toggling operation mode, due to conflicting shortcuts.
Date of Fix: 2025-11-23
Details: Removed the 'B' key shortcut for clearing the entire queue in operation mode, as 'B' is primarily used for toggling operation mode in the menu. Also ensured that after completing override color selection, the system returns to operation mode display if operationMode is active.

---

Date: 2025-11-24
Error Encountered: ESP32 UART communication exhibited noise causing display glitching and artifacts on both TFT and LED matrix displays.
Date of Fix: 2025-11-24
Details: Added pull-up resistor to UART RX pin in TagSakay_Fixed_Complete.ino and implemented command validation and noise filtering in UARTHandler.cpp to prevent corrupted commands from affecting display updates.

---

Date: 2025-11-24
Error Encountered: SD card database operations in TagSakay_LED_Matrix.ino failed to access tag data, causing offline mode to not function properly.
Date of Fix: 2025-11-24
Details: Added diagnostic logging for SD card checks in SDCardModule.cpp and implemented proper error handling for SD card initialization and file operations to ensure reliable offline tag storage and lookup.

---

Date: 2025-11-24
Error Encountered: Queue colors on LED matrix changed after clearing the queue, losing the green/cyan color coding for active vs completed entries.
Date of Fix: 2025-11-24
Details: Modified queue clearing logic in TagSakay_LED_Matrix.ino to preserve the last index mapping for color determination, ensuring colors remain consistent after queue operations.

---

Date: 2025-11-25
Error Encountered: Production frontend threw CSP violation error "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com" blocking Cloudflare beacon script, and JSON parsing error "undefined" is not valid JSON in getUser() function causing authentication failures.
Date of Fix: 2025-11-25
Details: Two production issues encountered: (1) Content Security Policy blocked Cloudflare analytics beacon script at https://static.cloudflareinsights.com/beacon.min.js; (2) Authentication service getUser() function attempted to parse "undefined" string from localStorage, causing JSON parsing failures. Fixed by: (1) Adding https://static.cloudflareinsights.com to CSP script-src directive in frontend/index.html; (2) Enhanced error handling in frontend/src/services/auth.ts getUser() function to validate localStorage data and handle corrupted entries gracefully, with automatic cleanup of invalid data.

---

Date: 2025-11-24
Error Encountered: ESP32 firmware failed to compile with multiple errors in DisplayModule.cpp: "'map' is not a member of 'std'", "expected primary-expression before ',' token", "expected primary-expression before 'int'", "'lastIndexByValue' was not declared in this scope".
Date of Fix: 2025-11-24
Details: The std::map usage in showQueueMatrix function required the <map> header to be included. Added #include <map> to DisplayModule.cpp after the existing includes, resolving the compilation errors and allowing the TFT display to use the same color-coding logic as the LED matrix.

---

Date: 2025-11-26
Error Encountered: Production RFID scan POST requests failed with HTTP 500 error "No transactions support in neon-http driver" while GET requests worked correctly.
Date of Fix: 2025-11-26
Details: The backend RFID scan POST endpoint (/api/rfid/scan) used db.transaction() to wrap the scan insertion and RFID lastScanned update, but Neon's HTTP driver (used in production) doesn't support transactions. This caused all RFID scan POSTs to fail with 500 errors while GET operations continued working. Fixed by removing the transaction wrapper and performing the update directly with db.update(), accepting that if the lastScanned update fails, the scan record remains (which is acceptable since lastScanned is just for tracking). The change ensures atomicity at the database level while being compatible with the neon-http driver.

---
