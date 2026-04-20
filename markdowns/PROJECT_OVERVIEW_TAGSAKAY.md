1. Project Overview
Project Name:
TagSakay: RFID-Based Tricycle Queue Management System

Description:
TagSakay is an Internet of Things (IoT)-based system designed to assist tricycle terminals by providing RFID-enabled queue management, real-time monitoring, and device-assisted queue display. The system reads driver RFID tags through ESP32 devices, validates and processes queue actions through a cloud backend, and displays queue information on TFT and LED matrix interfaces. The web dashboard allows administrators to monitor queue activity, manage users, devices, and RFID records, and handle system operations remotely.

The system is designed to improve queue fairness, reduce manual errors, and support reliable operation even in unstable network environments through offline-capable storage and synchronization logic. Through automation, monitoring, and secure access control, TagSakay aims to enhance terminal operations and support transport administrators in making more efficient and informed decisions.

Author: Humphrey Myles C. Lozano

Version: 1.0

Start Date: August 8, 2025

Last Updated: April 17, 2026

Programming Languages: TypeScript, JavaScript, Vue, C++ (Arduino)

IDE: Visual Studio Code, Arduino IDE

Database/Storage: Neon PostgreSQL, SPIFFS, SD Card

Github Repository: https://github.com/ProfessorArthur/tagsakay_capstone

tagsakay_capstone/                      # Project root folder
├── .gitignore                          # Git ignore rules for the repository
├── backend-workers/                    # Cloudflare Workers backend service
│   ├── .env.example                    # Sample backend environment variables
│   ├── .gitignore                      # Git ignore rules for backend workers
│   ├── check-schema.js                 # Checks database schema consistency
│   ├── clean-db.ts                     # Cleans/reset backend database data
│   ├── drizzle.config.ts               # Drizzle ORM configuration settings
│   ├── list-devices.js                 # Lists registered devices from backend
│   ├── migrate.ts                      # Runs database migrations
│   ├── seed.ts                         # Seeds initial backend data
│   ├── src/                            # Backend application source code
│   │   ├── db/                         # Database schema and migration logic
│   │   │   ├── archive.ts              # Archive/retention database utilities
│   │   │   ├── index.ts                # Database connection and client setup
│   │   │   ├── migrate.ts              # Database migration execution logic
│   │   │   ├── schema.ts               # Database table schema definitions
│   │   │   └── syncMigrations.ts       # Synchronizes migration metadata
│   │   ├── durable-objects/            # Durable Object connection handlers
│   │   │   └── DeviceConnection.ts     # Manages per-device real-time connection state
│   │   ├── index.ts                    # Main backend app entry point
│   │   ├── lib/                        # Authentication, validation, and utility logic
│   │   │   ├── auth.ts                 # Authentication and token utilities
│   │   │   ├── email.ts                # Email sending and formatting utilities
│   │   │   ├── queueSnapshot.ts        # Builds and normalizes queue snapshots
│   │   │   ├── securityLogger.ts       # Structured security event logging
│   │   │   ├── session.ts              # Session cookie and lifecycle utilities
│   │   │   └── validation.ts           # Request and input validation helpers
│   │   ├── middleware/                 # Security and request middleware
│   │   │   ├── auth.ts                 # Authentication and authorization middleware
│   │   │   ├── customCors.ts           # Custom CORS policy middleware
│   │   │   ├── observability.ts        # Metrics and observability middleware
│   │   │   ├── rateLimit.ts            # Rate limiting and lockout middleware
│   │   │   └── security.ts             # Security headers and request hardening middleware
│   │   └── routes/                     # API route handlers
│   │       ├── apiKey.ts               # API key management endpoints
│   │       ├── auth.ts                 # Authentication endpoints
│   │       ├── device.ts               # Device registration and status endpoints
│   │       ├── rfid.ts                 # RFID scanning and tag endpoints
│   │       └── user.ts                 # User management endpoints
│   ├── test-auth.ps1                   # PowerShell auth endpoint test script
│   ├── test-rfid-template.ps1          # PowerShell RFID test template
│   ├── tests/                          # Backend test scripts
│   │   ├── live-no-device-test.js      # Backend live test without physical device
│   │   ├── optimizations-test.js       # Performance and optimization test script
│   │   ├── password-strength-test.js   # Password policy validation test script
│   │   ├── rate-limit-test.js          # Rate limit behavior test script
│   │   └── rfid-scan-test.js           # RFID scan endpoint test script
│   ├── test-users.ps1                  # PowerShell user API test script
│   ├── token.txt                       # Temporary token reference for local tests
│   ├── tsconfig.json                   # TypeScript compiler settings for backend
│   └── wrangler.toml                   # Cloudflare Wrangler worker configuration
├── frontend/                           # Vue.js admin dashboard application
│   ├── .gitignore                      # Git ignore rules for frontend app
│   ├── .vscode/                        # Frontend VS Code workspace settings
│   │   └── extensions.json             # Recommended VS Code extensions for frontend
│   ├── config-types.d.ts               # Type declarations for frontend configuration
│   ├── index.html                      # Frontend HTML shell and mount point
│   ├── postcss.config.js               # PostCSS plugin configuration
│   ├── public/                         # Static assets served by the frontend
│   │   ├── _headers                    # Static hosting response headers
│   │   ├── _redirects                  # Static hosting route redirects
│   │   ├── robots.txt                  # Search crawler directives
│   │   ├── sitemap.xml                 # Public sitemap for indexed routes
│   │   ├── tagsakay_logo.svg           # TagSakay logo asset
│   │   └── vite.svg                    # Default Vite logo asset
│   ├── src/                            # Frontend source code
│   │   ├── App.vue                     # Root application layout component
│   │   ├── assets/                     # Frontend static assets
│   │   │   └── vue.svg                 # SVG image asset
│   │   ├── components/                 # Reusable dashboard UI components
│   │   │   ├── Identicon.vue           # Displays visual user/avatar identicons
│   │   │   ├── RfidChart.vue           # Displays RFID scan statistics charts
│   │   │   ├── RfidDeviceStatus.vue    # Shows real-time RFID device status
│   │   │   ├── RfidLiveScans.vue       # Shows live RFID scan stream
│   │   │   ├── RfidQueueMatrix.vue     # Renders queue slot matrix and ordering
│   │   │   ├── RfidUnregisteredScans.vue  # Lists unregistered RFID scan events
│   │   │   ├── SidebarLayout.vue       # Provides shared sidebar page layout
│   │   │   └── ToastContainer.vue      # Renders toast notifications
│   │   ├── composables/                # Vue composable state and behavior logic
│   │   │   ├── useApiState.ts          # Manages standardized API state handling
│   │   │   ├── useDeviceService.ts     # Provides reactive device service calls
│   │   │   ├── useDeviceWebSocket.ts   # Manages device-focused WebSocket logic
│   │   │   ├── useRealTimeScans.ts     # Handles real-time RFID scan updates
│   │   │   ├── useRfidService.ts       # Provides reactive RFID service calls
│   │   │   ├── useToast.ts             # Handles toast notification state
│   │   │   ├── useUserService.ts       # Provides reactive user service calls
│   │   │   └── useWebSocket.ts         # Generic WebSocket connection composable
│   │   ├── config/                     # Environment and runtime configuration
│   │   │   └── env.ts                  # Runtime environment variable handling
│   │   ├── main.ts                     # Frontend application bootstrap file
│   │   ├── router/                     # Route definitions and navigation guards
│   │   │   └── index.ts                # Application routes and route guards
│   │   ├── services/                   # HTTP/API service modules
│   │   │   ├── api.ts                  # Base API client configuration and wrappers
│   │   │   ├── apiKey.ts               # API key management service calls
│   │   │   ├── auth.ts                 # Authentication service calls
│   │   │   ├── device.ts               # Device management service calls
│   │   │   ├── rfid.ts                 # RFID management service calls
│   │   │   ├── rfidStats.ts            # RFID analytics and stats service calls
│   │   │   ├── search.ts               # Search/query service calls
│   │   │   └── user.ts                 # User management service calls
│   │   ├── style.css                   # Global frontend stylesheet
│   │   ├── utils/                      # Client-side helper utilities
│   │   │   ├── adaptivePolling.ts      # Adaptive polling timing utilities
│   │   │   ├── chartConfig.ts          # Shared chart configuration helpers
│   │   │   ├── csv.ts                  # CSV export and parsing utilities
│   │   │   └── theme.ts                # Theme and appearance utilities
│   │   ├── views/                      # Page-level view components
│   │   │   ├── ApiKeyManagement.vue    # API key administration page
│   │   │   ├── Dashboard.vue           # Main system dashboard page
│   │   │   ├── DeviceManagement.vue    # Device management page
│   │   │   ├── DeviceRegistration.vue  # Device registration workflow page
│   │   │   ├── LandingPage.vue         # Public landing page
│   │   │   ├── Login.vue               # User login page
│   │   │   ├── NotFound.vue            # 404 not-found page
│   │   │   ├── OnboardingWizard.vue    # First-time setup wizard page
│   │   │   ├── Profile.vue             # User profile page
│   │   │   ├── Register.vue            # User registration page
│   │   │   ├── RfidCardManagement.vue  # RFID card management page
│   │   │   ├── RfidScans.vue           # RFID scan monitoring page
│   │   │   ├── Settings.vue            # System settings page
│   │   │   ├── UserManagement.vue      # User management page
│   │   │   ├── VerifyEmail.vue         # Email verification page
│   │   │   └── WebSocketTest.vue       # WebSocket diagnostics test page
│   │   └── vite-env.d.ts               # Vite environment type declarations
│   ├── tailwind.config.js              # Tailwind CSS configuration
│   ├── tsconfig.app.json               # TypeScript config for application build
│   ├── tsconfig.json                   # Base TypeScript config for frontend
│   ├── tsconfig.node.json              # TypeScript config for node tooling
│   ├── verify-config.js                # Validates frontend environment setup
│   └── vite.config.ts                  # Vite dev/build configuration
├── scripts/                            # Project utility scripts
│   └── test-login.js                   # Quick login API smoke test script
├── TagSakay_Fixed_Complete/            # Main ESP32 firmware for RFID queue control
│   ├── ApiModule.cpp                   # Implements backend API communication for ESP32
│   ├── ApiModule.h                     # Declares backend API communication interface
│   ├── BuzzerModule.h                  # Declares buzzer feedback helpers
│   ├── Config.h                        # Main ESP32 constants and configuration
│   ├── Diagnostics/                    # ESP32 diagnostics and hardware test sketches
│   │   ├── Config.h                    # Diagnostics sketch configuration values
│   │   └── DisplayDiagnostics.ino      # Display diagnostics Arduino sketch
│   ├── DisplayModule.cpp               # Implements TFT display rendering logic
│   ├── DisplayModule.h                 # Declares TFT display rendering interface
│   ├── HTTPPolling.cpp                 # Implements backend polling and command processing
│   ├── HTTPPolling.h                   # Declares HTTP polling interface
│   ├── KeypadModule.cpp                # Implements keypad input and admin controls
│   ├── KeypadModule.h                  # Declares keypad input module interface
│   ├── NetworkModule.cpp               # Implements Wi-Fi/network connection handling
│   ├── NetworkModule.h                 # Declares network module interface
│   ├── RFIDModule.cpp                  # Implements RFID scanning and debounce logic
│   ├── RFIDModule.h                    # Declares RFID module interface
│   ├── TagSakay_Fixed_Complete.ino     # Main Arduino firmware entry sketch
│   ├── UARTModule.cpp                  # Implements UART messaging to LED controller
│   └── UARTModule.h                    # Declares UART messaging interface
├── TagSakay_LED_Matrix/                # Secondary ESP32 firmware for LED matrix display
│   ├── Animations.cpp                  # Implements matrix animation effects
│   ├── Animations.h                    # Declares matrix animation routines
│   ├── Config.h                        # LED matrix firmware configuration constants
│   ├── DisplayCore.cpp                 # Implements LED matrix rendering core
│   ├── DisplayCore.h                   # Declares LED matrix rendering core interface
│   ├── DisplayModes.cpp                # Implements LED display behavior modes
│   ├── DisplayModes.h                  # Declares LED display mode interfaces
│   ├── PixelFont.cpp                   # Implements pixel font drawing routines
│   ├── PixelFont.h                     # Declares pixel font drawing interfaces
│   ├── SDCardModule.cpp                # Implements SD card read/write and lookup logic
│   ├── SDCardModule.h                  # Declares SD card module interfaces
│   ├── TagSakay_LED_Matrix.ino         # Main LED matrix controller sketch
│   ├── UARTHandler.cpp                 # Implements UART command parsing and handling
│   └── UARTHandler.h                   # Declares UART command handler interface
└── TagSakay_V4 Manuscript.pdf          # Capstone manuscript document

3. Source Code
Main App Code:
 In the TagSakay system, the backend source code is located in the /backend-workers/src folder, and the web admin application source code is in /frontend/src. These folders contain the core application logic, user interface components, route handling, services, middleware, and utilities developed using TypeScript and Vue.
The application handles system features such as RFID tap processing, queue monitoring, user and device management, and real-time operational updates through HTTP APIs and polling.
The IoT device programs are developed using C++ and are written in the Arduino IDE. These codes control RFID scanning, local queue display, HTTP polling, and LED matrix output through the files in /TagSakay_Fixed_Complete and /TagSakay_LED_Matrix.
Database:
 The system uses Neon PostgreSQL as the primary cloud database to store user records, device data, RFID logs, queue snapshots, and system configurations. It also uses SPIFFS and SD Card storage on ESP32 devices for local/offline persistence.

4. Environment Setup
A. System Requirements
Visual Studio Code
Arduino IDE
Node.js (v18+)
npm
Cloudflare account and Wrangler CLI
Neon PostgreSQL database
Git

B. Steps to Run the Application
Backend Application
1. Clone the repository
   git clone https://github.com/ProfessorArthur/tagsakay_capstone.git
2. Navigate to the project directory
   cd tagsakay_capstone
3. Navigate to backend and install dependencies
   cd backend-workers
   npm install
4. Configure backend environment variables in .dev.vars
   DATABASE_URL=your_neon_postgres_url
   JWT_SECRET=your_jwt_secret
   SESSION_SECRET=your_session_secret
   API_KEY_SALT=your_api_key_salt
5. Run migrations/seed and start backend server
   npm run migrate
   npm run seed
   npm run dev

Frontend Application
1. Navigate to frontend folder
   cd ../frontend
2. Install dependencies
   npm install
3. Configure frontend environment variable in .env
   VITE_API_URL=http://localhost:8787/api
4. Run the frontend application
   npm run dev

ESP32 Firmware
1. Open TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino in Arduino IDE
2. Set device Wi-Fi and API config in TagSakay_Fixed_Complete/Config.h
3. Compile and upload to the main ESP32 board
4. Open TagSakay_LED_Matrix/TagSakay_LED_Matrix.ino and upload to the LED controller ESP32






