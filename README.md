A Non-Fork of the TagSakay Project from my Student Account

# TagSakay RFID Queue Management System

A comprehensive RFID-based tricycle queue management system with ESP32 integration, user management, real-time monitoring capabilities, and OWASP-compliant security.

## Project Overview

TagSakay is an RFID-based queue management system designed for tricycle transportation services. The system consists of three main components:

1. **Backend**: Cloudflare Workers with Neon PostgreSQL and OWASP security
2. **Frontend**: Vue.js web application for administration and monitoring
3. **ESP32 Firmware**: RFID scanner for physical tag scanning and registration

## Project Structure

```
tagsakay_rfid/
├── backend-workers/      # Cloudflare Workers API
│   ├── src/              # Source code
│   │   ├── controllers/  # Request handlers
│   │   ├── db/           # Drizzle schema & migrations
│   │   ├── lib/          # Utilities (auth, validation, logging)
│   │   ├── middleware/   # Hono middleware (auth, rate limiting, security)
│   │   └── routes/       # API routes
│   ├── tests/            # Integration tests
│   │   ├── rate-limit-test.js
│   │   ├── password-strength-test.js
│   │   ├── TEST_RESULTS.md
│   │   └── MANUAL_TESTING_GUIDE.md
│   ├── docs/             # API documentation
│   │   └── legacy/       # Archived legacy backend docs
│   ├── wrangler.toml     # Cloudflare configuration
│   └── drizzle.config.ts # Drizzle ORM configuration
├── frontend/             # Vue.js web application
│   ├── public/           # Static assets
│   └── src/              # Source code
│       ├── components/   # Vue components
│       ├── router/       # Vue Router configuration
│       ├── services/     # API service layer
│       └── views/        # Vue page components
└── esp32/                # ESP32 RFID scanner firmware
    └── TagSakay_RFID_Scanner/  # Arduino sketch files
```

## Features

### Backend (Cloudflare Workers - OWASP Compliant)

- **OWASP Security**: Comprehensive security implementation following OWASP Top 10 2021 guidelines
- **Password Security**: PBKDF2-SHA256 hashing with 600,000 iterations
- **JWT Authentication**: 4-hour tokens with full claim set (iss, aud, sub, iat, exp, nbf, jti)
- **Rate Limiting**: Tiered limits (5 req/min auth, 100 req/min API, 3 req/hr device registration)
- **Account Lockout**: 5 failed attempts trigger 15-minute account lock
- **Input Validation**: RFC 5321 email, RFID 4-32 alphanumeric, MAC address format
- **Security Headers**: 10 OWASP-recommended headers (CSP, HSTS, X-Frame-Options, etc.)
- **Security Logging**: 15 event types with 4 severity levels
- **Drizzle ORM**: Type-safe database queries with schema-first approach
- **Hono Framework**: Lightweight, fast web framework for Cloudflare Workers
- **Neon Database**: Serverless PostgreSQL with connection pooling

### Frontend

- **Dashboard**: Real-time system overview with key metrics
- **RFID Management**: Register and manage RFID tags
- **User Management**: Create and manage system users
- **API Key Management**: Generate and revoke API keys
- **Device Monitoring**: Track connected RFID scanners
- **Live RFID Scanning**: View real-time scan events
- **Role-Based Access Control**: Different views per user role
- **Responsive Design**: Mobile-friendly interface
- **Security UI Features**:
  - Rate limiting feedback with countdown timer
  - Account lockout warnings (15-minute notice)
  - Real-time password strength indicator (5 levels, color-coded)
  - Password match validation with visual feedback
  - Password visibility toggles
  - Client-side validation matching backend rules

### ESP32 RFID Scanner

- **RFID Scanning**: Read MIFARE RFID cards
- **API Integration**: Send scan data to backend
- **Registration Mode**: Support for registering new RFID cards
- **Status Reporting**: Regular heartbeat and status updates

## Getting Started

### Prerequisites

- Node.js (v18+)
- Neon PostgreSQL account
- Cloudflare account (for deployment)
- Arduino IDE (for ESP32 development)

### Backend Setup

1. Navigate to the backend-workers directory:

   ```bash
   cd backend-workers
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.dev.vars` file with the following variables:

   ```env
   DATABASE_URL=postgresql://user:password@host/database?sslmode=require
   JWT_SECRET=your_super_secret_jwt_key_min_32_chars
   NODE_ENV=development
   ```

4. Generate and run database migrations:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

5. Start the development server:

   ```bash
   npm run dev
   # Server runs on http://localhost:8787
   ```

6. Run tests (optional):
   ```bash
   node tests/rate-limit-test.js
   node tests/password-strength-test.js
   ```

### Frontend Setup

1. Navigate to the frontend directory:

   ```bash
   cd frontend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a .env file:

   ```env
   VITE_API_URL=http://localhost:8787/api
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## Database Management

```bash
# Navigate to backend-workers
cd backend-workers

# Generate migrations from schema changes
npm run db:generate

# Apply migrations to database
npm run db:migrate

# Push schema directly (development only)
npm run db:push

# Open Drizzle Studio (database GUI)
npm run db:studio
```

## Device Management

> **Note**: Device management features are being implemented in backend-workers. The CLI scripts from the legacy backend have been archived.

For now, use the API endpoints directly or the frontend interface for device management.

## API Testing

```bash
cd backend-workers

# Test rate limiting (5 failed attempts)
node tests/rate-limit-test.js

# Test password strength validation
node tests/password-strength-test.js

# View test results
cat tests/TEST_RESULTS.md

# Manual UI testing guide
cat tests/MANUAL_TESTING_GUIDE.md
```

## Test Accounts

> **Note**: Test accounts need to be created through the registration endpoint or frontend. The legacy seeder scripts have been removed.

Create test accounts via:

- Frontend registration page (`/register`)
- POST `/api/auth/register` endpoint
- Direct database insertion via Drizzle Studio (`npm run db:studio`)

## User Roles

- **SuperAdmin**: Full system access, can manage all users and settings
- **Admin**: Management access to users, devices and RFID tags
- **Driver**: Limited access to dashboard and personal information

## Security Features

### OWASP Compliance (Backend-Workers)

The backend-workers implementation follows OWASP Top 10 2021 guidelines:

1. **A01: Broken Access Control** - JWT with 4-hour expiration, role-based access
2. **A02: Cryptographic Failures** - PBKDF2-SHA256 (600k iterations), secure salt generation
3. **A03: Injection** - Drizzle ORM with prepared statements, input validation
4. **A04: Insecure Design** - Account lockout (5 attempts, 15 min), rate limiting
5. **A05: Security Misconfiguration** - 10 security headers, HTTPS-only (HSTS)
6. **A07: Auth Failures** - Strong passwords, account lockout, rate limiting
7. **A09: Logging Failures** - 15 event types, 4 severity levels

### Password Requirements

- Minimum 15 characters (OWASP: 8 with MFA, 15 without MFA; registration requires 15)
- Must include:
  - Uppercase letters (A-Z)
  - Lowercase letters (a-z)
  - Numbers (0-9)
  - Special characters (!@#$%^&\*)
- Real-time strength validation in UI (5 levels: Very Weak to Strong)
- Client-side validation matches backend rules

### Rate Limiting

- **Authentication**: 5 requests per minute (login, register)
- **General API**: 100 requests per minute
- **Device Registration**: 3 requests per hour
- **Account Lockout**: 5 failed attempts → 15-minute lock
- UI displays countdown timer and clear error messages

### Security Headers

- Strict-Transport-Security (HSTS)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection
- Content-Security-Policy
- Referrer-Policy
- Permissions-Policy
- Plus 3 Cloudflare defaults

## Technology Stack

### Backend

- **Runtime**: Cloudflare Workers (Edge computing)
- **Framework**: Hono (Lightweight web framework)
- **Database**: Neon PostgreSQL (Serverless)
- **ORM**: Drizzle ORM (Type-safe, schema-first)
- **Authentication**: JWT (4-hour expiration)
- **Password Hashing**: PBKDF2-SHA256 (600,000 iterations)
- **Validation**: Custom validators (RFC 5321 email, RFID, MAC)
- **Security**: Rate limiting, account lockout, security headers, logging
- **Language**: TypeScript

### Frontend

- **Framework**: Vue.js 3 (Composition API)
- **Language**: TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + DaisyUI
- **Routing**: Vue Router
- **HTTP Client**: Axios
- **State Management**: Vue Composition API (reactive refs)

### ESP32

- **Microcontroller**: ESP32-WROOM-32
- **RFID Module**: MFRC522 (13.56MHz)
- **WiFi**: Built-in ESP32 WiFi
- **Language**: C++ (Arduino framework)

## Documentation

- **API Documentation**: `/backend-workers/docs/`
- **Legacy Backend Docs**: `/backend-workers/docs/legacy/` (archived)
- **Test Results**: `/backend-workers/tests/TEST_RESULTS.md`
- **Manual Testing Guide**: `/backend-workers/tests/MANUAL_TESTING_GUIDE.md`
- **Migration Guide**: `/backend-workers/MIGRATION_SUMMARY.md`
- **Project Progress**: `/backend-workers/PROGRESS.md`
- **Copilot Instructions**: `/.github/copilot-instructions.md`

## Deployment

### Backend (Cloudflare)

```bash
cd backend-workers

# Deploy to Cloudflare Workers
npm run deploy

# Configure secrets in Cloudflare dashboard:
# - DATABASE_URL
# - JWT_SECRET
# - NODE_ENV
```

### Frontend (Static Hosting)

```bash
cd frontend

# Build for production
npm run build

# Output in dist/ directory
# Deploy to Vercel, Netlify, Cloudflare Pages, etc.
```

## Contributing

This is a private project. Please contact the maintainers for contribution guidelines.

## License

This project is proprietary and confidential.
