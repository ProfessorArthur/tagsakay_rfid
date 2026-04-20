# 🔌 TagSakay Backend API Routes

Complete reference of all API endpoints in your Cloudflare Workers backend.

---

## 📋 Base URLs

**Development:**

```
http://localhost:8787
```

**Production:**

```
https://tagsakay-api-production.maskedmyles.workers.dev
```

**With Custom Domain (when set up):**

```
https://api.tagsakay.com
```

---

## 🔑 Authentication

Most endpoints require a JWT token. Include in header:

```
Authorization: Bearer <JWT_TOKEN>
```

**To get a token:**

1. Register: `POST /api/auth/register`
2. Login: `POST /api/auth/login`
3. Refresh: `POST /api/auth/refresh`

---

## 📑 Complete Routes Reference

### 🔐 **AUTH ROUTES** (`/api/auth`)

#### **POST /api/auth/login**

Login with email and password, receive JWT token.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!@#"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "expiresIn": "4h",
    "user": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "role": "driver"
    }
  }
}
```

**Rate Limited:** 5 requests per minute per IP
**Possible Errors:**

- 400: Invalid email or password format
- 401: Invalid credentials
- 429: Account locked (5 failed attempts)
- 403: Account inactive

---

#### **POST /api/auth/register**

Create new user account.

**Request:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!@#",
  "role": "driver",
  "rfidTag": "ABC12345"
}
```

**Password Requirements:**

-- Minimum 15 characters

- Must include uppercase, lowercase, number, special char
- For accounts without MFA: minimum 15 characters recommended

**Request Fields:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| name | string | Yes | 2-100 characters |
| email | string | Yes | Valid RFC 5321 format |
| password | string | Yes | Min 15 chars (strong required) |
| role | enum | No | superadmin, admin, driver (default: driver) |
| rfidTag | string | No | 4-32 alphanumeric characters |

**Response (201 Created):**

```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "expiresIn": "4h",
    "user": {
      "id": 2,
      "name": "John Doe",
      "email": "john@example.com",
      "role": "driver"
    }
  }
}
```

**Rate Limited:** 5 requests per minute per IP
**Possible Errors:**

- 400: Validation failed (password too weak, email invalid, etc.)
- 409: Email already exists

---

#### **POST /api/auth/refresh**

Refresh JWT token before expiration.

**Request:**

```
Authorization: Bearer <OLD_TOKEN>
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "user": {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "role": "driver"
    }
  }
}
```

**Possible Errors:**

- 401: Token invalid or expired
- 404: User not found
- 403: Account inactive

---

#### **POST /api/auth/logout**

Logout current user (client-side token removal).

**Request:**

```
Authorization: Bearer <TOKEN>
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Logout successful",
  "data": {
    "loggedOut": true
  }
}
```

---

### 👥 **USER ROUTES** (`/api/users`)

#### **GET /api/users**

List all users (Admin only).

**Authorization:** Bearer token, role: admin or superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Admin User",
      "email": "admin@tagsakay.com",
      "role": "superadmin",
      "rfidTag": "ABC12345",
      "isActive": true,
      "createdAt": "2025-01-01T00:00:00Z"
    },
    {
      "id": 2,
      "name": "Driver One",
      "email": "driver@example.com",
      "role": "driver",
      "rfidTag": "XYZ98765",
      "isActive": true,
      "createdAt": "2025-01-02T12:30:00Z"
    }
  ]
}
```

**Possible Errors:**

- 401: Unauthorized (no token)
- 403: Forbidden (insufficient role)

---

#### **GET /api/users/:id**

Get user by ID.

**Authorization:** Bearer token (can view own profile, admins can view any)

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "role": "driver",
    "rfidTag": "ABC12345",
    "isActive": true,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-15T10:30:00Z"
  }
}
```

**Possible Errors:**

- 401: Unauthorized
- 404: User not found

---

#### **POST /api/users**

Create new user (Admin only).

**Authorization:** Bearer token, role: admin or superadmin

**Request:**

```json
{
  "name": "New User",
  "email": "newuser@example.com",
  "password": "SecurePass123!@#",
  "role": "driver",
  "rfidTag": "NEW12345",
  "isActive": true
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "id": 3,
    "name": "New User",
    "email": "newuser@example.com",
    "role": "driver",
    "rfidTag": "NEW12345",
    "isActive": true,
    "createdAt": "2025-01-20T15:45:00Z"
  }
}
```

**Possible Errors:**

- 400: Validation failed
- 403: Forbidden (insufficient role)
- 409: Email already exists

---

#### **PUT /api/users/:id**

Update user (Admin only, or user updating own password).

**Authorization:** Bearer token

**Request:**

```json
{
  "name": "Updated Name",
  "email": "newemail@example.com",
  "password": "NewSecurePass123!@#",
  "role": "admin",
  "isActive": true
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "User updated successfully",
  "data": {
    "id": 1,
    "name": "Updated Name",
    "email": "newemail@example.com",
    "role": "admin",
    "isActive": true,
    "updatedAt": "2025-01-20T16:00:00Z"
  }
}
```

**Possible Errors:**

- 400: Validation failed
- 403: Forbidden
- 404: User not found

---

#### **DELETE /api/users/:id**

Delete user (Superadmin only).

**Authorization:** Bearer token, role: superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

**Possible Errors:**

- 403: Forbidden (insufficient role)
- 404: User not found

---

### 🏷️ **RFID TAG ROUTES** (`/api/rfid`)

#### **GET /api/rfid**

List all registered RFID tags (Admin only).

**Authorization:** Bearer token, role: admin or superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "id": "tag-001",
      "tagId": "ABC12345",
      "userId": 1,
      "isActive": true,
      "lastScanned": "2025-01-20T14:30:00Z",
      "deviceId": "ESP32-001",
      "registeredBy": 1,
      "metadata": { "color": "blue", "location": "vehicle-1" },
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-20T14:30:00Z"
    }
  ]
}
```

---

#### **GET /api/rfid/:tagId**

Get specific RFID tag details.

**Authorization:** Bearer token

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "tag-001",
    "tagId": "ABC12345",
    "userId": 1,
    "isActive": true,
    "lastScanned": "2025-01-20T14:30:00Z",
    "deviceId": "ESP32-001",
    "registeredBy": 1,
    "metadata": {},
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-20T14:30:00Z"
  }
}
```

---

#### **POST /api/rfid/register**

Register new RFID tag.

**Authorization:** Bearer token

**Request:**

```json
{
  "tagId": "ABC12345",
  "userId": 1,
  "metadata": {
    "color": "blue",
    "location": "vehicle-1"
  }
}
```

**Validation:**

- tagId: 4-32 alphanumeric characters
- userId: Must exist in database

**Response (201 Created):**

```json
{
  "success": true,
  "message": "RFID tag registered successfully",
  "data": {
    "id": "tag-001",
    "tagId": "ABC12345",
    "userId": 1,
    "isActive": true,
    "createdAt": "2025-01-20T16:00:00Z"
  }
}
```

**Possible Errors:**

- 400: Invalid tagId format
- 409: RFID tag already registered

---

#### **POST /api/rfid/scan**

Log RFID scan event (Device auth only, ESP32).

**Authorization:** Device API Key

**Request:**

```json
{
  "tagId": "ABC12345",
  "deviceId": "ESP32-001",
  "eventType": "entry",
  "location": "Gate 1"
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "message": "Scan recorded",
  "data": {
    "id": "scan-12345",
    "rfidTagId": "ABC12345",
    "deviceId": "ESP32-001",
    "userId": 1,
    "eventType": "entry",
    "location": "Gate 1",
    "status": "success",
    "scanTime": "2025-01-20T16:05:00Z"
  }
}
```

**Rate Limited:** 3 requests per hour per device

---

#### **PUT /api/rfid/:tagId/status**

Update RFID tag active status.

**Authorization:** Bearer token, role: admin or superadmin

**Request:**

```json
{
  "isActive": false
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "RFID tag status updated",
  "data": {
    "id": "tag-001",
    "tagId": "ABC12345",
    "isActive": false,
    "updatedAt": "2025-01-20T16:10:00Z"
  }
}
```

---

#### **DELETE /api/rfid/:tagId**

Delete RFID tag (Superadmin only).

**Authorization:** Bearer token, role: superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "message": "RFID tag deleted successfully"
}
```

---

#### **GET /api/rfid/scans/unregistered**

Get recently scanned but unregistered RFID tags.

**Authorization:** Bearer token

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "id": "scan-unreg-001",
      "rfidTagId": "UNKNOWN001",
      "deviceId": "ESP32-001",
      "userId": null,
      "eventType": "unknown",
      "scanTime": "2025-01-20T16:15:00Z",
      "status": "unauthorized"
    }
  ]
}
```

---

### 🔧 **DEVICE ROUTES** (`/api/devices`)

#### **POST /api/devices/register**

Register new ESP32 device.

**Authorization:** Bearer token, role: admin or superadmin

**Request:**

```json
{
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "location": "Gate 1",
  "name": "Main Entrance Scanner"
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "message": "Device registered successfully",
  "data": {
    "device": {
      "id": 42,
      "deviceId": "AABBCCDDEEFF",
      "macAddress": "AA:BB:CC:DD:EE:FF",
      "name": "Main Entrance Scanner",
      "location": "Gate 1",
      "isActive": true
    },
    "apiKey": "sk_device_abc123xyz..."
  }
}
```

**Note:** API key is returned ONLY on creation. Store securely!

---

#### **GET /api/devices**

List all registered devices (Admin only).

**Authorization:** Bearer token, role: admin or superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Retrieved 4 devices",
  "data": {
    "devices": [
      {
        "id": 42,
        "deviceId": "AABBCCDDEEFF",
        "macAddress": "AA:BB:CC:DD:EE:FF",
        "name": "Main Entrance Scanner",
        "location": "Gate 1",
        "isActive": true,
        "registrationMode": false,
        "scanMode": false,
        "lastSeen": "2025-01-20T16:25:00Z",
        "createdAt": "2025-01-20T16:20:00Z"
      }
    ],
    "total": 4
  }
}
```

---

#### **GET /api/devices/active**

List only active devices.

**Authorization:** Bearer token, role: admin or superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Retrieved 2 active devices",
  "data": {
    "devices": [
      {
        "deviceId": "AABBCCDDEEFF",
        "name": "Main Entrance Scanner",
        "isActive": true,
        "registrationMode": false,
        "scanMode": false,
        "lastSeen": "2025-01-20T16:25:00Z"
      }
    ],
    "total": 2
  }
}
```

---

#### **GET /api/devices/:deviceId**

Get device details.

**Authorization:** Bearer token

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": 42,
    "deviceId": "AABBCCDDEEFF",
    "macAddress": "AA:BB:CC:DD:EE:FF",
    "name": "Main Entrance Scanner",
    "location": "Gate 1",
    "isActive": true,
    "registrationMode": false,
    "scanMode": false,
    "pendingRegistrationTagId": "",
    "lastSeen": "2025-01-20T16:25:00Z",
    "createdAt": "2025-01-20T16:20:00Z",
    "updatedAt": "2025-01-20T16:25:00Z"
  }
}
```

---

#### **PUT /api/devices/:deviceId**

Update device settings (Admin only).

**Authorization:** Bearer token, role: admin or superadmin

**Request:**

```json
{
  "location": "Gate 2",
  "name": "Back Door Scanner",
  "isActive": true
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Device updated successfully",
  "data": {
    "device": {
      "id": 42,
      "deviceId": "AABBCCDDEEFF",
      "location": "Gate 2",
      "name": "Back Door Scanner",
      "isActive": true
    }
  }
}
```

---

#### **DELETE /api/devices/:deviceId**

Remove a device (Admin only).

**Authorization:** Bearer token, role: admin or superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Device removed successfully",
  "data": {
    "device": {
      "id": 42,
      "deviceId": "AABBCCDDEEFF",
      "name": "Main Entrance Scanner"
    }
  }
}
```

---

#### **POST /api/devices/:deviceId/heartbeat**

Device heartbeat ping (Device auth only).

**Authorization:** Device API Key

**Request:**

```json
{
  "status": "online",
  "temperature": 45,
  "uptime": 3600
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Heartbeat received",
  "data": {
    "lastHeartbeat": "2025-01-20T16:35:00Z",
    "status": "online"
  }
}
```

**Rate Limited:** 1 request per minute per device

---

#### **POST /api/devices/:deviceId/mode**

Enable or disable registration/scan modes.

**Authorization:** Bearer token, role: admin or superadmin

**Request:**

```json
{
  "registrationMode": true,
  "scanMode": false,
  "pendingRegistrationTagId": "ABC123"
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Device mode updated successfully",
  "data": {
    "device": {
      "deviceId": "AABBCCDDEEFF",
      "registrationMode": true,
      "scanMode": false,
      "pendingRegistrationTagId": "ABC123"
    }
  }
}
```

---

### 🔑 **API KEY ROUTES** (`/api/keys`)

#### **POST /api/keys**

Create new API key for device.

**Authorization:** Bearer token, role: admin or superadmin

**Request:**

```json
{
  "name": "Main Gate Key",
  "deviceId": "ESP32-001",
  "macAddress": "AA:BB:CC:DD:EE:FF",
  "description": "API key for main gate scanner",
  "permissions": ["scan", "register"]
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "message": "API key created",
  "data": {
    "id": "key-001",
    "name": "Main Gate Key",
    "deviceId": "ESP32-001",
    "prefix": "sk_device",
    "key": "sk_device_xxxxxxxxxx_secret", // Only returned once!
    "permissions": ["scan", "register"],
    "isActive": true,
    "createdAt": "2025-01-20T16:40:00Z"
  }
}
```

**⚠️ Important:** Full API key is ONLY returned on creation. Store securely!

---

#### **GET /api/keys**

List all API keys (Admin only).

**Authorization:** Bearer token, role: admin or superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "id": "key-001",
      "name": "Main Gate Key",
      "deviceId": "ESP32-001",
      "prefix": "sk_device",
      "permissions": ["scan", "register"],
      "lastUsed": "2025-01-20T16:30:00Z",
      "isActive": true,
      "createdAt": "2025-01-20T16:40:00Z"
    }
  ]
}
```

---

#### **GET /api/keys/:id**

Get specific API key (without full secret).

**Authorization:** Bearer token, role: admin or superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "id": "key-001",
    "name": "Main Gate Key",
    "deviceId": "ESP32-001",
    "prefix": "sk_device",
    "permissions": ["scan", "register"],
    "lastUsed": "2025-01-20T16:30:00Z",
    "isActive": true,
    "createdAt": "2025-01-20T16:40:00Z"
  }
}
```

---

#### **PUT /api/keys/:id**

Update API key settings.

**Authorization:** Bearer token, role: admin or superadmin

**Request:**

```json
{
  "name": "Updated Key Name",
  "permissions": ["scan"],
  "isActive": true
}
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "API key updated",
  "data": {
    "id": "key-001",
    "name": "Updated Key Name",
    "permissions": ["scan"],
    "isActive": true,
    "updatedAt": "2025-01-20T16:45:00Z"
  }
}
```

---

#### **DELETE /api/keys/:id**

Revoke/delete API key (Superadmin only).

**Authorization:** Bearer token, role: superadmin

**Response (200 OK):**

```json
{
  "success": true,
  "message": "API key deleted successfully"
}
```

---

### 🌐 **UTILITY ROUTES**

#### **GET /**

Health check / API info.

**Response (200 OK):**

```json
{
  "success": true,
  "message": "TagSakay API is running on Cloudflare Workers",
  "version": "2.0.0",
  "timestamp": "2025-01-20T16:50:00Z"
}
```

---

#### **GET /health**

Detailed health check.

**Response (200 OK):**

```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2025-01-20T16:50:00Z"
}
```

---

#### **GET /ws/device**

WebSocket endpoint for ESP32 devices (Experimental).

**Parameters:**

- `deviceId` (required): Device identifier

**Connection:**

```
ws://localhost:8787/ws/device?deviceId=ESP32-001
```

---

## 📊 Rate Limiting

| Endpoint                     | Limit | Window                  |
| ---------------------------- | ----- | ----------------------- |
| `/api/auth/login`            | 5     | Per minute              |
| `/api/auth/register`         | 5     | Per minute              |
| `/api/rfid/scan`             | 3     | Per hour (per device)   |
| `/api/devices/:id/heartbeat` | 1     | Per minute (per device) |
| General API                  | 100   | Per minute              |

**Rate Limit Response (429):**

```json
{
  "success": false,
  "message": "Too many requests",
  "retryAfter": "60 seconds"
}
```

---

## 🔒 Authorization Levels

### **Public Routes (No Auth Required)**

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /`
- `GET /health`

### **User Auth Required**

- Most RFID and user management endpoints
- Requires: `Authorization: Bearer <JWT_TOKEN>`

### **Device Auth Required**

- `/api/rfid/scan`
- `/api/devices/:id/heartbeat`
- Requires: `Authorization: Bearer <API_KEY>` (device API key)

### **Role-Based Access**

- **Admin**: User management, device management
- **Superadmin**: Delete operations, system configuration
- **Driver**: View own profile, access RFID scans

---

## 🛠️ Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error message",
  "errors": ["Validation error 1", "Validation error 2"],
  "retryAfter": "Optional: time to retry"
}
```

### Common HTTP Status Codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 200  | Success                              |
| 201  | Created                              |
| 400  | Validation error                     |
| 401  | Unauthorized (no auth)               |
| 403  | Forbidden (insufficient permissions) |
| 404  | Not found                            |
| 409  | Conflict (resource already exists)   |
| 429  | Too many requests (rate limited)     |
| 500  | Server error                         |

---

## 📝 Example: Complete Login Flow

```bash
# 1. Register new user
curl -X POST https://tagsakay-api-production.maskedmyles.workers.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "SecurePass123!@#",
    "role": "driver"
  }'

# Response includes: token, user object

# 2. Login with credentials
curl -X POST https://tagsakay-api-production.maskedmyles.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123!@#"
  }'

# 3. Use token to get user profile
curl -X GET https://tagsakay-api-production.maskedmyles.workers.dev/api/users/1 \
  -H "Authorization: Bearer <TOKEN_FROM_LOGIN>"

# 4. Refresh token before expiration
curl -X POST https://tagsakay-api-production.maskedmyles.workers.dev/api/auth/refresh \
  -H "Authorization: Bearer <TOKEN_THAT_MAY_EXPIRE_SOON>"
```

---

## 🔌 WebSocket (Experimental)

**Endpoint:** `/ws/device?deviceId=ESP32-001`

**Usage:**

```javascript
// Connect
const ws = new WebSocket("ws://localhost:8787/ws/device?deviceId=ESP32-001");

// Send data
ws.send(JSON.stringify({ type: "scan", tagId: "ABC12345" }));

// Receive updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Device update:", data);
};
```

---

## 📚 Useful Tips

1. **Store API Keys Securely:** Never commit to Git, use environment variables
2. **Token Expiration:** JWT tokens expire after 4 hours, use refresh endpoint
3. **Device Keys:** Create new API key for each device, rotate regularly
4. **Rate Limiting:** Account lockout triggers after 5 failed login attempts
5. **CORS Enabled:** Requests from frontend domains allowed automatically

---

## 🔗 Related Documentation

- Backend Deployment: `BACKEND_WORKERS_DEPLOYMENT.md`
- Architecture: `02_ARCHITECTURE.md`
- Development: `03_DEVELOPMENT.md`
- Security: See `securityLogger.ts` and `middleware/`

---

**Version:** 2.0.0  
**Last Updated:** 2025-01-20  
**API Base:** https://tagsakay-api-production.maskedmyles.workers.dev
