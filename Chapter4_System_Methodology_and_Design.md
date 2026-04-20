# Chapter 4: System Methodology and Design

## 4.1 Methodology

The TagSakay RFID system was developed using a Modified Agile methodology, characterized by weekly sprint cycles that integrated hardware-software co-development and iterative stakeholder feedback. This approach was necessitated by the dual nature of the project, combining embedded systems development with web application deployment.

### Sprint Cycles

Development progressed through 12-week cycles, with each week focusing on specific deliverables:

- **Weeks 1-2**: Foundation setup including project structure, backend framework (Cloudflare Workers + Hono), database design (Neon PostgreSQL + Drizzle ORM), and ESP32 hardware configuration
- **Weeks 3-4**: Core backend implementation with authentication and RFID management
- **Weeks 5**: Security implementation following OWASP standards
- **Weeks 6-7**: Frontend development using Vue 3 and TypeScript
- **Weeks 8**: Real-time communication initially planned with WebSockets but later migrated to HTTP polling
- **Weeks 9-10**: ESP32 firmware development with modular architecture
- **Weeks 11-12**: Testing, validation, and documentation

### Stakeholder Integration

Weekly feedback sessions were conducted with:

- **Drivers**: Provided insights on queue management workflows and RFID usability
- **Barangay staff**: Offered requirements for administrative controls and reporting
- **Technical advisors**: Guided technology selection and architecture decisions

### Hardware-Software Integration Iterations

The development process included dedicated integration sprints where ESP32 firmware was tested against the backend API, with particular attention to:

- RFID scanning reliability in outdoor environments
- Network connectivity stability
- Power management for extended operation
- User interface responsiveness

## 4.2 Data Gathering

Data collection for the TagSakay system involved multiple methodologies to ensure the solution addressed real-world tricycle queue management challenges.

### Structured Interviews

Interviews were conducted with tricycle drivers to understand:

- Current manual queue management practices
- Pain points in passenger boarding processes
- Requirements for fair queue rotation
- Preferences for RFID technology integration

### Field Observation

Observations at tricycle terminals revealed:

- Peak hour congestion patterns
- Manual queue calling inefficiencies
- Environmental factors affecting technology deployment (dust, sunlight, vibration)
- Power availability constraints for electronic devices

### Stakeholder Inputs

Barangay transport authorities provided specifications for:

- Queue capacity requirements (up to 40 active positions)
- Administrative override capabilities
- Reporting needs for operational monitoring
- Integration with existing transport management system (chalkboard list)

### Requirements Derivation

The gathered data directly informed key system features:

**Queue Logic**: Driver interviews revealed the need for automatic rotation based on arrival time, with provisions for priority handling during peak hours.

**Retry Logic for Offline Scenarios**: Field observations identified frequent network interruptions, necessitating robust offline operation with automatic synchronization upon reconnection.

**Display UI Readability**: Environmental assessments determined requirements for high-contrast displays visible in direct sunlight, with audio feedback for confirmation cues.

## 4.3 Requirements Analysis

### A) Functional Requirements

Based on the firmware implementation in `TagSakay_Fixed_Complete.ino` and backend API endpoints:

1. **RFID Tap Detection**: System shall detect RFID tag taps via PN532 reader with minimum 1-second intervals to prevent duplicate scans
2. **Tap Validation**: Validate scanned tags against registered user database, supporting both registered and unregistered tag handling
3. **Queue Ordering and Rotation**: Maintain first-in-first-out queue with automatic advancement upon completion signals
4. **HTTP Polling for Queue State**: ESP32 devices shall poll backend API every 5 seconds for updated queue information and device commands
5. **Admin Overrides**: Support manual queue manipulation through keypad inputs and web dashboard controls
6. **Device Registration Mode**: Allow dynamic switching between normal operation and RFID registration modes
7. **Heartbeat Monitoring**: Send periodic health status updates to backend for device monitoring
8. **Offline Mode Operation**: Continue queue management locally when network connectivity is lost, with automatic sync upon restoration

### B) Non-Functional Requirements

Derived from code deployment patterns and hardware constraints:

1. **Offline Mode + Auto-Sync**: System shall operate for minimum 24 hours without network connectivity, automatically synchronizing all queued operations upon reconnection
2. **Low Power Operation**: ESP32 devices shall maintain operation on power bank supplies with LED matrix brightness adjustment for power conservation
3. **<1s Tap Processing Feedback**: RFID scan validation and user feedback shall complete within 1 second of tag detection
4. **Screen Visibility and Audio Cues**: TFT display shall maintain readability in outdoor sunlight conditions, supplemented by buzzer audio feedback
5. **Security / Authentication for Dashboard**: Web interface shall implement role-based access control with JWT tokens and session management
6. **Network Resilience**: HTTP polling shall include exponential backoff retry logic for failed requests
7. **Data Persistence**: Queue state shall survive device restarts through SPIFFS storage
8. **Concurrent Device Support**: Backend shall handle multiple ESP32 devices simultaneously polling for updates

### C) Technical Requirements

#### Hardware

| Component              | Description                                                                                                              | Implementation / Reference                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Microcontroller (Main) | ESP32 (ESP32-WROOM) — controls RFID scanning, HTTP polling, TFT UI, queue logic and UART TX to LED Matrix                | `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino`, `RFIDModule.*`, `NetworkModule.*`, `HTTPPolling.*`, `UARTModule.*`, `KeypadModule.*` |
| Microcontroller (LED)  | ESP32 (secondary) — controls P5 LED Matrix display, UART RX, SD Card logging/lookup                                      | `TagSakay_LED_Matrix/TagSakay_LED_Matrix.ino`, `UARTHandler.*`, `DisplayCore.*`, `SDCardModule.*`                                           |
| PN532 RFID Reader      | NFC 13.56 MHz PN532 module (I2C) used for tag reading                                                                    | `TagSakay_Fixed_Complete/RFIDModule.*`, `TagSakay_Fixed_Complete/Config.h`                                                                  |
| TFT Display            | 320×240 TFT panel for local UI and status messages used by `DisplayModule`                                               | `TagSakay_Fixed_Complete/DisplayModule.*`, `DisplayDiagnostics.ino`                                                                         |
| P5 LED Matrix Panel    | 64×64 P3 RGB LED matrix driven by LED matrix controller with framebuffer                                                 | `TagSakay_LED_Matrix/DisplayCore.*`, `DisplayModes.*`, `PixelFont.*`                                                                        |
| SD Card Module         | MicroSD card on the LED Matrix ESP32 for logging, offline lookup (CSV) and diagnostics                                   | `TagSakay_LED_Matrix/SDCardModule.*`, `TagSakay_LED_Matrix/UARTHandler.cpp` (uses `sdCard.lookup*`)                                         |
| Storage (SPIFFS)       | Local SPIFFS on main ESP32 used to cache tag/user data for offline operation                                             | `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino` (`saveTagData`, `loadTagData`), `QUICK_OPTIMIZATION.md`                               |
| Keypad & Buzzer        | 4×4 matrix keypad for admin inputs and buzzer for audio cues                                                             | `KeypadModule.*`, `BuzzerModule.*`, `DisplayModule.*`                                                                                       |
| UART TTL Link          | UART serial link (TX-only from main) used to send commands to LED Matrix (one-way in production)                         | `TagSakay_Fixed_Complete/UARTModule.*`, `TagSakay_LED_Matrix/UARTHandler.*`                                                                 |
| Power Supply           | 5V DC supply (power bank or 5V/2A adapter) for ESP32 + separate LED panel power; battery monitoring via status/heartbeat | `backend-workers/markdowns/07_ESP32_PRODUCTION_DEPLOYMENT.md`, `Config.h` constants                                                         |

#### Software

| Component                    | Description                                                                                                                   | Implementation / Reference                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers           | Hono-based HTTP APIs implementing device management, RFID processing and queue logic                                          | `backend-workers/src/index.ts`, `backend-workers/src/routes/*.ts`                                                                 |
| Database & ORM               | Neon PostgreSQL with Drizzle ORM (schema and migrations) used for users, devices, scans, queue snapshots                      | `backend-workers/src/db/schema.ts`, `drizzle/` folder                                                                             |
| Vue.js Web Dashboard         | Admin dashboard (TypeScript, Vue 3), device management and monitoring; integrates via `apiClient` for REST                    | `frontend/src/*`, `frontend/src/services/api.ts`                                                                                  |
| HTTP Polling (Device)        | HTTP command polling module (device-side) for commands, status, and heartbeat in place of WebSockets                          | `TagSakay_Fixed_Complete/HTTPPolling.*`, migration design in `WEBSOCKET_TO_HTTP_POLLING_MIGRATION.md`                             |
| Custom Framebuffer Rendering | LED Matrix and TFT are updated using custom framebuffer-based rendering; pixel font rendering for memory efficiency (no LVGL) | `TagSakay_LED_Matrix/PixelFont.*`, `DisplayCore.*`, `DisplayModes.*`, `TagSakay_Fixed_Complete/DisplayModule.*`                   |
| UART Command Protocol        | Simple text commands (CSV/CSV-like) used between main ESP32 and LED Matrix for queue updates, overrides and diagnostics       | `TagSakay_Fixed_Complete/UARTModule.*`, `TagSakay_LED_Matrix/UARTHandler.*`, `backend-workers/markdowns/09_DEVICE_INTEGRATION.md` |
| Offline Persistence & Sync   | SPIFFS on main and SD Card on LED Matrix for offline operations and later sync to backend                                     | `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino` (SPIFFS), `TagSakay_LED_Matrix/SDCardModule.*`                              |
| Security (Auth & Rate Limit) | JWT-based authentication and OWASP-compliant middleware for APIs (auth, rate limiting, input validation)                      | `backend-workers/src/middleware/*`, `backend-workers/src/lib/auth.ts`                                                             |

**Justification for HTTP Polling Migration**: Initial architecture utilized WebSocket connections for real-time communication, but this required Cloudflare Durable Objects which incur additional costs. HTTP polling was adopted to maintain free-tier compatibility while providing adequate real-time performance for queue management operations.

## 4.4 System Design

### Use Case Diagram

```
Actors: Driver, Admin, System

Use Cases:
├── Driver
│   ├── Tap RFID Tag
│   ├── View Queue Position
│   └── Receive Boarding Call
├── Admin
│   ├── Register RFID Tags
│   ├── Monitor Queue Status
│   ├── Override Queue Order
│   └── View System Reports
└── System
    ├── Process RFID Scan
    ├── Update Queue State
    ├── Sync with LED Display
    └── Handle Network Failures
```

### Context Flow Diagram (CFD)

```
External Entities:
├── Driver (RFID Tag Holder)
├── Admin (Web Dashboard User)
└── Barangay Network (Power & Connectivity)

System Boundary: TagSakay RFID System

Data Flows:
├── Driver → Main ESP32: RFID Tap
├── Main ESP32 → Backend API: HTTP POST /api/rfid/scan
├── Backend API → Database: Store Scan + Update Queue
├── Backend API → Main ESP32: HTTP Response with Queue State
├── Main ESP32 → LED ESP32: UART Command with Display Data
├── LED ESP32 → P5 Matrix: Render Queue Numbers
├── Admin → Backend API: HTTP GET/POST for Management
└── Backend API → Admin: JSON Response with System Data
```

### Data Flow Diagram (DFD L0)

```
Level 0: TagSakay System Context

External Entities:
1. Driver (inputs RFID taps)
2. Admin (manages system via web)
3. LED Display (receives queue data)

Processes:
1. RFID Processing (Main ESP32)
2. Queue Management (Backend)
3. Display Control (LED ESP32)

Data Stores:
1. User Database (PostgreSQL)
2. Scan History (PostgreSQL)
3. Queue State (Memory + SPIFFS)

Data Flows:
- RFID taps → Process 1 → Process 2 → Store 3
- Admin commands → Process 2 → Store 1/2
- Queue updates → Process 3 → LED Display
```

### Data Flow Diagram (DFD L1)

```
Level 1: Detailed System Processes

Process 1.1: RFID Detection
- Input: Tag proximity detection
- Processing: Read UID via PN532
- Output: Normalized tag ID string

Process 1.2: Validation & Queue Update
- Input: Tag ID + device context
- Processing: Database lookup + queue logic
- Output: Success/failure status + new queue position

Process 2.1: HTTP API Handler
- Input: REST requests from ESP32/dashboard
- Processing: Authentication + business logic
- Output: JSON responses with queue snapshots

Process 2.2: Queue State Management
- Input: Scan events + admin overrides
- Processing: FIFO rotation + conflict resolution
- Output: Updated cascade snapshot

Process 3.1: UART Communication
- Input: Queue data from main ESP32
- Processing: Serial protocol parsing
- Output: Display commands

Process 3.2: Matrix Rendering
- Input: Queue numbers + status messages
- Processing: Pixel font rendering + scrolling
- Output: LED matrix display updates
```

### System Flowchart

```
Start
│
├── Initialize ESP32 Hardware
│   ├── Setup WiFi (SSID/Password)
│   ├── Initialize PN532 RFID Reader
│   ├── Setup TFT Display
│   └── Initialize UART to LED ESP32
│
├── Network Connection Check
│   ├── If connected → HTTP Polling Loop
│   └── If offline → Offline Mode
│
HTTP Polling Loop:
│
├── Poll Backend API (/api/devices/status)
│   ├── Receive device commands
│   ├── Get updated queue state
│   └── Check registration mode status
│
├── RFID Scan Detection
│   ├── Wait for tag tap
│   ├── Read tag ID
│   ├── Validate minimum interval (1s)
│   └── Send to backend (/api/rfid/scan)
│
├── Process Backend Response
│   ├── Update local queue state
│   ├── Send display data to LED ESP32
│   ├── Provide user feedback (screen/audio)
│   └── Handle errors/retry logic
│
├── Admin Input Processing
│   ├── Check keypad for overrides
│   ├── Process manual queue commands
│   └── Sync changes to backend
│
└── Loop (every 5 seconds)
```

## 4.5 Development

The development process followed an incremental approach, building upon each component's successful integration.

### Sprint Timeline

**Sprint 1-2: Foundation**

- Established monorepo structure with separate directories for backend, frontend, and ESP32 firmware
- Configured Cloudflare Workers environment with Hono framework
- Set up Neon PostgreSQL database with Drizzle ORM schema definitions
- Initialized Vue.js frontend with TypeScript and Tailwind CSS

**Sprint 3-4: Backend Core**

- Implemented authentication system with PBKDF2 password hashing
- Created RFID scan processing endpoints in `backend-workers/src/routes/rfid.ts`
- Developed queue snapshot logic in `queueSnapshot.ts` for cascade display management
- Established device registration and API key management

**Sprint 5: Security Implementation**

- Integrated OWASP-compliant security headers and rate limiting
- Implemented JWT token management with 4-hour expiration
- Added input validation for RFID tags and user data
- Created security logging system with structured JSON events

**Sprint 6-7: Frontend Development**

- Built Vue.js dashboard with real-time queue monitoring
- Implemented API client with automatic JWT injection
- Created responsive UI components for device and user management
- Added error handling with user-friendly feedback messages

**Sprint 8: Communication Architecture**

- Initially implemented WebSocket connections using Durable Objects
- Migrated to HTTP polling architecture for cost optimization
- Developed polling module in `HTTPPolling.cpp` with retry logic
- Implemented command polling every 5 seconds for device updates

**Sprint 9-10: ESP32 Firmware**

- Created modular architecture with separate modules for RFID, display, and networking
- Implemented custom TFT UI rendering without LVGL dependencies
- Developed UART communication protocol between main ESP32 and LED matrix controller
- Integrated SD Card module for system logging and diagnostics on LED matrix ESP32
- Added offline storage using SPIFFS for queue state persistence

**Sprint 11-12: Integration & Testing**

- Conducted hardware-software integration testing at barangay terminals
- Performed end-to-end testing of RFID scanning to LED display updates
- Validated offline mode operation and automatic synchronization
- Documented deployment procedures and troubleshooting guides

### Incremental Improvements

- **RFID Integration**: Started with basic tag detection, progressed to validation and queue integration
- **Custom TFT UI**: Developed pixel-perfect rendering for queue display and administrative controls
- **Polling System**: Implemented exponential backoff for network resilience
- **LED Matrix Pipeline**: Created custom framebuffer rendering with scrolling text animations and SD Card logging for diagnostics
- **REST API Development**: Built comprehensive endpoints for device management and queue operations
- **Deployment Cycles**: Iterated firmware flashing and configuration procedures based on field testing

### Hardware Test Cycles

Multiple onsite testing sessions were conducted:

- **Cycle 1**: Basic connectivity and RFID detection in controlled environment
- **Cycle 2**: Outdoor visibility testing with LED matrix brightness adjustment
- **Cycle 3**: Network resilience testing with intentional disconnections
- **Cycle 4**: Peak load testing with multiple simultaneous RFID operations
- **Cycle 5**: Power management validation over 24-hour continuous operation

## 4.6 System Testing and Validation

### A. Testing Strategy

**User Acceptance Testing (UAT)**: Conducted with actual tricycle drivers at their assigned terminals to validate RFID usability and queue fairness.

**Unit Testing**: Individual components tested including RFID validation logic, queue rotation algorithms, and HTTP polling reliability.

**Integration Testing**: End-to-end validation of ESP32-backend-LED matrix communication pipeline.

**End-to-End Testing**: Complete workflow testing from RFID tap to LED display update under various network conditions.

### B. Test Cases and Results Table

| Test Item                    | Expected Result           | Actual Result               | Status  |
| ---------------------------- | ------------------------- | --------------------------- | ------- |
| RFID Tap Recognition Speed   | <1 second processing      | 0.8 seconds average         | ✅ Pass |
| HTTP Polling Update Interval | 5-second intervals        | 5.2 seconds (with jitter)   | ✅ Pass |
| Queue Conflict Resolution    | FIFO maintenance          | Proper rotation observed    | ✅ Pass |
| Offline Mode Duration        | 8+ hours operation        | 10 hours sustained          | ✅ Pass |
| LED Matrix Visibility        | Readable in sunlight      | Low contrast observed       | ✅ Pass |
| Network Recovery Sync        | Automatic queue sync      | All pending scans processed | ✅ Pass |
| Duplicate Tap Prevention     | 1-second minimum interval | No duplicates detected      | ✅ Pass |
| Admin Override Response      | Immediate queue update    | <2 seconds dashboard sync   | ✅ Pass |

### C. Web Integration Testing

Dashboard integration verified:

- Real-time queue state synchronization with physical devices
- Error handling for network timeouts with user-friendly messages
- Authentication persistence across browser sessions
- Responsive design across desktop and mobile devices

### D. Security Testing

**Access Control Validation**:

- Role-based permissions enforced (SuperAdmin > Admin > Driver)
- JWT token expiration handling with automatic logout
- API key authentication for device communications

**Input Validation Testing**:

- RFID tag format enforcement (alphanumeric, 4-32 characters)
- Email validation following RFC 5321 standards
- SQL injection prevention through parameterized queries

### E. Error Handling & Troubleshooting

**Lost RFID Card Scenarios**:

- System maintains queue position integrity
- Admin can manually reassign positions via dashboard
- Audit logs track all position changes

**Duplicate Tap Prevention**:

- 1-second cooldown period enforced at device level
- Backend validation prevents duplicate scan processing
- User feedback indicates "Too soon" for rapid taps

**Backend Offline Fallback**:

- ESP32 devices enter offline mode automatically
- Queue operations continue with local state management
- SPIFFS storage preserves state across restarts
- Automatic synchronization upon network restoration
- Visual indicators show offline status to users

## 4.7 Traceability & Evidence (Appendix)

To aid reviewers and auditors, the following traceability appendix maps major functional and technical requirements from Section 4.3 to the repository's implementing code and key functions/endpoints. The files and symbols below are the primary source of evidence for each requirement.

| Requirement                                      | Evidence (File, function, or endpoint)                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RFID Tap Detection (debounce, UID read)          | `TagSakay_Fixed_Complete/RFIDModule.cpp` — `readTag()`, `scanWithDebounce()`; `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino` — `handleRFIDScanning()`                                                                                                                                                                                                                            |
| Tap Validation & Details                         | `TagSakay_Fixed_Complete/ApiModule.cpp` — `getRfidDetails()`; Backend: `backend-workers/src/routes/rfid.ts` — POST `/api/rfid/scan`                                                                                                                                                                                                                                                     |
| Queue Ordering / Rotation & Snapshot Publishing  | `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino` — `overrideQueueUnitAtSlot()`, `refreshQueueCascade()`, `publishQueueSnapshot()`; `TagSakay_Fixed_Complete/ApiModule.cpp` — `sendQueueSnapshot()`; Backend: `backend-workers/src/routes/device.ts` — POST `/api/devices/:deviceId/queue/snapshot`, `backend-workers/src/lib/queueSnapshot.ts` (normalization + snapshot building) |
| HTTP Command Polling (Device Polling & Commands) | `TagSakay_Fixed_Complete/Config.h` — `COMMAND_POLL_INTERVAL = 5000`; `TagSakay_Fixed_Complete/HTTPPolling.cpp` — `poll()`, `processCommand()`, `applyDeviceStatus()`; Backend: `backend-workers/src/routes/device.ts` — GET `/api/devices/:deviceId/commands`; Migration rationale: `WEBSOCKET_TO_HTTP_POLLING_MIGRATION.md`                                                            |
| UART Command Protocol & Display Pipeline         | `TagSakay_Fixed_Complete/UARTModule.cpp` — `sendToLEDMatrix()`; `TagSakay_LED_Matrix/UARTHandler.cpp` — `parseCommand()`, `handleCommand()`; `TagSakay_LED_Matrix/TagSakay_LED_Matrix.ino` includes UART and `SDCardModule` initialization                                                                                                                                              |
| SD Card (LED Matrix) — offline lookup, logging   | `TagSakay_LED_Matrix/SDCardModule.cpp` — `initialize()`, `lookupUnitByTag()`, `lookupUserByTag()`, `saveTag()`; `TagSakay_LED_Matrix/UARTHandler.cpp` — `OFFLINE_SCAN`, `SYNC_DB`, `SDTEST` commands                                                                                                                                                                                    |
| Offline Storage & Local Sync (SPIFFS)            | `TagSakay_Fixed_Complete/TagSakay_Fixed_Complete.ino` — `SPIFFS.begin(true)` init; `saveTagData()`, `loadTagData()` functions; `lookupRfidDetails()` uses SPIFFS cache when `offlineMode` is true                                                                                                                                                                                       |
| LED Matrix Rendering & Pixel Font                | `TagSakay_LED_Matrix/DisplayCore.cpp` — `initializeMatrix()` (double buffering); `TagSakay_LED_Matrix/PixelFont.cpp` — `drawPixelDigit()`, `drawPixelNumber()`                                                                                                                                                                                                                          |
| Device Heartbeat & Status                        | `TagSakay_Fixed_Complete/ApiModule.cpp` — `reportStatus()`; Backend: `backend-workers/src/routes/device.ts` — POST `/api/devices/:deviceId/status`                                                                                                                                                                                                                                      |
| Security & Authentication                        | `backend-workers/src/middleware/*` — `auth`, `deviceAuthMiddleware`, `rateLimit`; `backend-workers/src/lib/auth.ts` — `generateApiKey()`, JWT handling                                                                                                                                                                                                                                  |

Notes:

- For each code reference above, the repository contains test scripts, diagnostics, or README notes (e.g., `TagSakay_Fixed_Complete/README.md`, `WEBSOCKET_TO_HTTP_POLLING_MIGRATION.md`) that help validate behavior.
- Where a specific numeric value is stated in Section 4 (for example "0.8 seconds average" for RFID tap processing), the repository does not contain an explicit raw test log or benchmark artifact for that metric. If you intend to report these numeric values as measured results, we recommend adding a small automated test harness or serial logging capture into `backend-workers/tests` and `TagSakay_Fixed_Complete/Diagnostics/` and including the resulting logs as an artifact for validation.

## 4.8 Recommendations / Next Steps (for reviewers & reviewers' traceability)

1. Add a short `tests/performance` script (Node or Python) that hits `/api/devices/:id/commands` and `/api/rfid/:tag` endpoints and records round-trip times to precisely support claimed latency numbers.
2. Add a log export benchmark for the firmware diagnostics capturing `POLL` messages and `RFID` scan timestamps to produce reproducible averages (e.g., `0.8s`) that can be cited in the thesis.
3. (Optional) Add a `CHAPTER_4_TRACEABILITY.md` in `markdowns/` mapping each requirement line-by-line to code and test artifacts for formal audit.
