# TagSakay User Manual (Draft)

_Last updated: 2025-11-21_

## Table of contents

1. [Overview](#overview)
2. [Initial setup](#initial-setup)
   - [Admin console checklist](#admin-console-checklist)
   - [ESP32 device onboarding](#esp32-device-onboarding)
   - [Driver account onboarding](#driver-account-onboarding)
3. [Daily operations](#daily-operations)
   - [Dispatch / control center](#dispatch--control-center)
   - [Driver dashboard](#driver-dashboard)
   - [System monitoring](#system-monitoring)
4. [Troubleshooting](#troubleshooting)
   - [RFID scan issues](#rfid-scan-issues)
   - [Device offline / heartbeat failures](#device-offline--heartbeat-failures)
   - [Authentication + rate limiting](#authentication--rate-limiting)

---

## Overview

TagSakay is an RFID-based tricycle queue management platform built on Cloudflare Workers, Neon PostgreSQL, Vue 3, and ESP32 edge devices. This manual explains how administrators, dispatchers, and drivers use the system end-to-end—from provisioning new hardware to monitoring daily queues.

Key resources:

- [Onboarding workflow map](./ONBOARDING_WORKFLOW.md)
- [Onboarding wizard (`/onboarding`)](../frontend/src/views/OnboardingWizard.vue) – in-app checklist and quick links
- [Observability dashboards](./OBSERVABILITY_DASHBOARDS.md) – Cloudflare Workers Analytics Engine queries

## Initial setup

### Admin console checklist

1. Sign in to `https://app.tagsakay.com` with a SuperAdmin account.
2. Navigate to **Dashboard → Open wizard** to launch the admin-only onboarding walkthrough.
3. Confirm environment variables/secrets (`DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`) are configured in Wrangler before deploying backend changes.
4. Prepare the RFID card inventory and ensure at least one ESP32 scanner is online.

### ESP32 device onboarding

1. **Flash firmware**: Update `TagSakay_Fixed_Complete/Config.h` with Wi-Fi SSID/password, API base (`https://api.tagsakay.com`), and heartbeat interval. Flash via VS Code + PlatformIO.
2. **Capture metadata**: While connected via USB, note the MAC address and intended deployment location/gate.
3. **Register device**:
   - Option A: Use the onboarding wizard → "Device onboarding" → **Open Device Registration**.
   - Option B: Navigate directly to `/devices/register`.
   - Fill MAC address, device name, and location. Use the new quick-fill chips or saved defaults for repeated deployments.
4. **Save API key**: After submission, copy the one-time API key (also stored in your clipboard helper). If lost, delete and re-register the device.
5. **Configure firmware**: Paste the API key into the firmware config, reboot, and wait for the device to appear as **Online** in `/devices`.
6. **Toggle mode**: From Device Management, toggle `registrationMode` when capturing new RFID tags or switch to `scanMode` for production use.

### Driver account onboarding

1. **Create account**:
   - For bulk invites, direct drivers to `/register` (default role: driver).
   - For managed onboarding, go to `/users` → **Add User** and assign the `driver` role.
2. **Assign RFID tag**:
   - Open `/rfid` → **Register card**.
   - Use the "Unregistered scans" panel to auto-fill the tag ID when a new card is tapped at any ESP32.
   - Link the card to the driver account and mark it **Active**.
3. **Verify dashboard**: Ask the driver to log into `/dashboard`. They should now see the accessible driver view with personal stats, filters, and scan history.

## Daily operations

### Dispatch / control center

- Monitor **Dashboard → Daily Activity** for system-wide scan totals.
- Use **Device Management** to check online/offline status and switch registration mode before onboarding sessions.
- Reference the onboarding wizard at any time for a quick reminder of setup steps.

### Driver dashboard

- Drivers land on `/dashboard` and see:
  - Focusable metric cards (30-day total, weekly scans, last scan time).
  - Filterable scan history (All / Successful / Failed / Unauthorized) with large touch targets.
  - Empty state guidance with a CTA to request RFID assistance when no scans exist.
- Encourage drivers to review their stats daily to catch inactive tags early.

### System monitoring

- Visit the Cloudflare dashboard → Workers → **Observability** to load the Analytics Engine queries listed in [OBSERVABILITY_DASHBOARDS.md](./OBSERVABILITY_DASHBOARDS.md).
- Use the new [CPU profiling notes](./CPU_PROFILING_NOTES.md) to spot hot endpoints and verify CPU reductions after each deployment.

## Troubleshooting

### RFID scan issues

1. Check `/rfid/scans` with filters for the affected tag or driver.
2. If the status is `failed` or `unauthorized`, confirm the driver account and tag are both **Active**.
3. Use the driver dashboard filter to confirm whether failures correlate with a specific device/shift.
4. Update tag metadata in `/rfid` or reassign the card if it belongs to a different driver.

### Device offline / heartbeat failures

1. In `/devices`, look at the **last seen** column; anything older than 2 minutes is considered offline.
2. Ensure the API key stored in firmware matches the latest one issued in Device Registration.
3. Reboot the ESP32 and watch for a heartbeat entry in the device log (or analytics dataset).
4. If the device stays offline, consult [ONBOARDING_WORKFLOW.md](./ONBOARDING_WORKFLOW.md) Section 1 for escalation steps.

### Authentication & rate limiting

- Login failures after five attempts trigger a 15-minute lockout per account. Use `/api/auth/login` rate-limit tests to verify configuration if needed.
- Cloudflare observability logs (`eventType = ERROR`) will show bursts of `401`/`429` responses—use those dashboards to spot abuse.
- Drivers who forget passwords should use the existing reset flow (or have an admin reset via `/users`).

---

> 📌 **Next revision**: Convert this draft into a PDF/Pages doc for field teams, include annotated screenshots, and cross-link to the ESP32 deployment guide.
