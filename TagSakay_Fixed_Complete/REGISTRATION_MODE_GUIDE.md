# Registration Mode - User Guide

## Overview

Registration mode allows you to register new RFID tags to the system. When activated, the next scanned tag will be sent to the backend for registration instead of normal queue processing.

This firmware uses an HTTP control path aligned with the Diagnostics utility:

- Command polling: device calls `GET /api/devices/:deviceId/commands` every 5s (\`COMMAND_POLL_INTERVAL\`).
- Heartbeats: device posts `/api/devices/:deviceId/heartbeat` every 30s (\`HEARTBEAT_INTERVAL\`).
- Heartbeat payload includes `registrationMode`, `scanMode`, and `pendingRegistrationTagId` so the admin UI mirrors the device state quickly.

---

## How to Activate/Deactivate

### Method 1: Keypad (Recommended)

Press `###` (three hash keys) on the keypad to toggle registration mode.

**Example:**

```
Press: # # #
Result: Registration mode ENABLED ✓
```

Press `###` again to exit:

```
Press: # # #
Result: Registration mode DISABLED ✗
```

**Note:** You must press all three `#` keys within 3 seconds, or the buffer will clear.

---

### Method 2: Serial Command (Alternative)

Type `registration` in the Serial Monitor and press Enter.

**Example:**

```
Serial> registration
Result: REGISTRATION MODE: ENABLED ✓
        (You can also use ### on keypad)
```

Type `registration` again to exit.

---

## Visual Indicators

### When Registration Mode is ENABLED:

**Display:**

- Status: "REGISTRATION MODE" (Orange)
- Footer: "Scan tag to register"

**LED Matrix:**

- Shows: "REG MODE ACTIVE"

**Serial Monitor:**

```
═══════════════════════════════════════
  REGISTRATION MODE: ENABLED ✓
═══════════════════════════════════════
```

**LED/Buzzer:**

- Plays registration mode indicator pattern (3 quick beeps)

---

### When Scanning in Registration Mode:

**Display:**

- Status: "REGISTERING TAG" (Orange)
- Shows tag ID being registered
- Message: "Please wait..."

**LED Matrix:**

- Shows: "REG [TAG_ID] WAIT"

**Serial Monitor:**

```
═══════════════════════════════════════
  REGISTRATION MODE - TAG DETECTED
  Tag ID: 04A3B2C1D5E6F7
═══════════════════════════════════════
[HTTP] Sending registration via HTTP
[✓] Tag registered successfully!
```

---

### On Successful Registration:

**Display:**

- Status: "REGISTERED" (Green)
- Message: "Success!"

**LED Matrix:**

- Shows: "REG SUCCESS"

**Serial Monitor:**

```
[✓] Tag registered successfully!
```

**Behavior:**

- Success tone/visual plays
- **Auto-exits registration mode after 2 seconds**
- Returns to normal scanning mode

---

### On Failed Registration:

**Display:**

- Status: "REG FAILED" (Red)
- Shows error message

**LED Matrix:**

- Shows: "REG FAILED"

**Serial Monitor:**

```
[✗] Registration failed: [error message]
```

**Behavior:**

- Error tone/visual plays
- Stays in registration mode (you can try again)

---

## Auto-Timeout

Registration mode will automatically deactivate after **5 minutes** (configurable via `REGISTRATION_MODE_TIMEOUT` in Config.h).

**Serial Monitor:**

```
[REGISTRATION] Timeout reached
```

---

## Technical Details

### Buffer Management

- Keypad input is buffered for pattern detection
- Buffer clears after 3 seconds of inactivity
- Buffer limited to last 10 characters (prevents memory issues)

### Registration Flow

1. User presses `###` or types `registration`
2. System enters registration mode
3. User scans RFID tag
4. System sends tag to the backend API via HTTP
5. Backend validates and registers tag
6. System shows success/failure
7. Auto-exits on success (stays on failure for retry)

### API Endpoint

The registration uses the same endpoint as normal scanning:

```
POST /api/rfid/scan
{
   "tagId": "04A3B2C1D5E6F7",
   "deviceId": "001122334455",
   "location": "Gate 1",
   "timestamp": 1234567890
}
```

The backend determines if it's a registration based on whether the tag exists in the database.

---

## Troubleshooting

### "Cannot register - offline mode"

**Cause:** Device is not connected to WiFi or backend API  
**Solution:**

- Check WiFi connection
- Verify backend is running
- Exit offline mode

### Keypad `###` not working

**Cause:** Keys pressed too slowly (>3 second gap)  
**Solution:** Press all three `#` keys quickly (within 3 seconds)

### Registration fails immediately

**Cause:** Backend API error or tag already registered  
**Solution:**

- Check Serial Monitor for error details
- Verify backend logs
- Tag may already be in database

---

## Configuration

### Adjust Timeout (Config.h)

```cpp
#define REGISTRATION_MODE_TIMEOUT 300000  // 5 minutes (in milliseconds)
```

### Adjust Keypad Buffer Timeout

```cpp
#define KEYPAD_BUFFER_TIMEOUT 3000  // 3 seconds (in milliseconds)
```

---

## Usage Examples

### Scenario 1: Register New Driver

```
1. Press ###
   → Display shows "REGISTRATION MODE"
2. Driver scans their RFID card
   → Display shows "REGISTERING TAG"
3. Wait 1-2 seconds
   → Display shows "REGISTERED - Success!"
4. System auto-exits to normal mode
   → Display shows "NORMAL MODE - Ready to scan"
```

### Scenario 2: Try to Register Duplicate

```
1. Press ###
2. Scan already-registered tag
3. Display shows "REG FAILED - Tag already exists"
4. Press ### to exit registration mode
   → Or scan a different tag to try again
```

### Scenario 3: Serial Command Alternative

```
1. Open Serial Monitor (115200 baud)
2. Type: registration
3. Press Enter
   → "REGISTRATION MODE: ENABLED ✓"
4. Scan tag
5. Type: registration
6. Press Enter
   → "REGISTRATION MODE: DISABLED ✗"
```

---

## Security Notes

- ⚠️ Registration mode should only be used by authorized personnel
- Consider adding additional authentication before enabling registration mode
- All registrations are logged on the backend
- Registration mode auto-times out after 5 minutes for security

---

## Backend Requirements

The backend must support tag registration. When a new (unregistered) tag is scanned, the backend should:

1. Check if tag exists in database
2. If not found, create new entry
3. Return success response
4. Log the registration event

See backend API documentation for full details.
