# Onboarding Workflow Map

_Last updated: 2025-11-21_

This document captures the current end-to-end onboarding experience for both **devices** (ESP32 scanners) and **people** (drivers/admins), plus the friction points we need to streamline.

## 1. Device onboarding (ESP32)

1. **Hardware prep** – Technician flashes the latest firmware from `TagSakay_Fixed_Complete/` with Wi-Fi + API host values baked into `Config.h`.
2. **MAC capture** – While connected over USB, they read the device MAC and relay it to an admin.
3. **Admin registration** – An admin opens `Devices → Register` in the web app (or runs `npm run device:register <mac> "Gate" "Location"`). The Workers API issues a hashed API key.
4. **Key transfer** – The cleartext API key is shared manually (chat/screenshot) and pasted into the ESP32 config before reboot.
5. **Field validation** – Once powered, the device pings `/api/devices/:id/heartbeat`; admins must refresh the device table to confirm it shows as online.
6. **Registration/scan modes** – Operators toggle `registrationMode` or `scanMode` from the devices page before handing the hardware to a dispatcher.

### Pain points

- API key is only shown once, so any missed copy requires deleting/re-registering the device.
- No guided wizard ties the MAC capture → API key → firmware flash steps together.
- Online/offline feedback requires manual refresh; no toast or push notification when the heartbeat lands.

## 2. Driver onboarding (people + RFID)

1. **Account creation** – Admins either: (a) invite drivers via the public `/register` page (defaults to role `driver`), or (b) create them manually in `UserManagement`.
2. **RFID issuance** – Dispatcher scans an unused RFID card while watching the `RfidCardManagement` modal (see `frontend/README_RFID_REGISTRATION.md`) and links it to the driver record.
3. **Device association** – Driver taps in at the terminal; backend validates tag + driver status via `/api/rfid/scan`.
4. **Driver dashboard** – Once they log into `/dashboard`, the driver sees their own stats + scan history (recently improved for accessibility).

### Pain points

- Drivers cannot self-serve tag requests; they rely on admins watching the unregistered scan list.
- Registration flow lives in multiple places (public register page, admin modal) with inconsistent messaging.
- Onboarding instructions are scattered across README files; there is no single checklist combining device + user steps.

## 3. Next steps to streamline

- Introduce a guided onboarding wizard that asks: "Are you setting up a device or a driver?" and walks through the exact steps above with inline validations.
- Prefill device metadata (location, gate) based on the MAC prefix or dispatcher selection. ✅ (wizard now saves last-used name/location and Device Registration renders quick-fill chips)
- Surface contextual tooltips/links (e.g., "Need an RFID tag? Contact the dispatcher"), and ensure the upcoming user manual references the same flow. ✅ onboarding wizard + Device Registration collapse instructions now provide these callouts.

## 4. New tooling (2025-11-21)

- **Onboarding Wizard (`/onboarding`)** – Admin-only route that lets you pick Device vs Driver onboarding, provides a four-step checklist, and links straight into Device Registration, Device List, User Management, or RFID cards as needed.
- **Saved defaults** – The wizard (and Device Registration form) now store the last used device name/location in `localStorage` (`tagsakay_device_defaults`). Use the "Apply to form" button or quick-fill chips to avoid retyping identical metadata for batches of scanners.
- **Inline guidance** – Device Registration includes an expandable "Need a refresher?" section plus buttons linking to the wizard so onboarding instructions live beside the form instead of scattered across READMEs.
