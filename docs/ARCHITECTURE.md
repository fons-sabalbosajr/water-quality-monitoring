# EMBR3-WQMS Application Architecture

This document describes the system architecture, component responsibilities, and data flows for the EMBR3 Water Quality Monitoring System.

---

## High-Level Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                              │
│                                                                      │
│  React 19 + Vite SPA served from /water-quality-monitoring/         │
│                                                                      │
│  ┌───────────┐  ┌────────────────┐  ┌─────────────────────────────┐ │
│  │  Auth     │  │  Pages / Views │  │  Cesium 3D Map              │ │
│  │  Context  │  │  (React Router)│  │  (WebGL / CesiumJS)         │ │
│  └───────────┘  └────────────────┘  └─────────────────────────────┘ │
│                         │  Axios                                     │
└─────────────────────────┼────────────────────────────────────────────┘
                           │  HTTPS / subpath proxy
┌──────────────────────────▼────────────────────────────────────────────┐
│                     Nginx (Reverse Proxy)                             │
│                                                                       │
│  /water-quality-monitoring/        → static files                    │
│  /water-quality-monitoring/api/    → proxy → Express :5002           │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────────────┐
│                  Express API (Node.js, port 5002)                     │
│                                                                       │
│  /api/auth      — register, login, forgot/reset password             │
│  /api/water     — WQM datasets, visualization year, MapTiler key,    │
│                   forecast status                                     │
│  /api/admin     — user management, app settings                      │
│  /api/health    — liveness check                                      │
│                           │                                           │
│  ┌────────────────────────▼──────────────────────────┐               │
│  │           MongoDB (embr3_wqms database)           │               │
│  │                                                   │               │
│  │  users         WqmDataset        AppSetting       │               │
│  └───────────────────────────────────────────────────┘               │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### Routing (`App.jsx`)

```
/                   → Welcome (public)
/login              → Login (public)
/register           → Register (public)
/forgot-password    → ForgotPassword (public)
/reset-password     → ResetPassword (public)
/home               → Home (protected) — main application shell
```

All pages under `/home` are protected by `ProtectedRoute` which reads from `AuthContext`.

### Page and Component Map

```
src/
├── App.jsx                       Root router, lazy imports
├── context/
│   ├── AuthContext.jsx           JWT decode, user state, login/logout
│   └── ThemeContext.jsx          Light/dark theme preference
├── api/
│   └── axios.js                  Axios instance with base URL and interceptors
├── components/
│   ├── CesiumStationMap.jsx      Reusable station map component (Cesium viewer)
│   ├── ProtectedRoute.jsx        Auth guard wrapper
│   └── Icons.jsx                 Shared icon set
├── pages/
│   ├── Welcome.jsx               Landing page
│   ├── Login.jsx                 Sign-in form
│   ├── Register.jsx              Self-registration form
│   ├── ForgotPassword.jsx        Email request form
│   ├── ResetPassword.jsx         Token-based password reset form
│   ├── Home.jsx                  App shell — sidebar, dashboard, lazy view loader
│   ├── WQM2026.jsx               Tabular WQM data editor (2024/2025/2026)
│   ├── Visualizations.jsx        Charts: box plots, heatmaps, radar, forecasts
│   ├── WaterbodyProfile.jsx      Per-waterbody parameter summaries
│   ├── Waterbody3DMap.jsx        Cesium 3D globe with station pins
│   └── Settings.jsx              Users, access controls, app settings
└── utils/
    ├── wqmSheets.js              Published-year and sheet selection (shared source of truth)
    ├── wqmData.js                Parameter normalization, station filtering, unit helpers
    ├── stationWorkbook.js        Station workbook loader and coordinate parser
    ├── wqmData.js                Value extraction and status classification
    ├── encryptedStorage.js       AES-encrypted localStorage wrapper
    └── appLog.js                 Client-side logging utility
```

### State Management

The application does not use a global state library. State is managed through:

- `AuthContext` — authenticated user, token, role
- `ThemeContext` — theme preference persisted to `localStorage`
- Component-level `useState` / `useEffect` — page-specific data and UI state
- Encrypted `localStorage` — access settings, user preferences, cached overrides

### API Client (`api/axios.js`)

- Base URL is `/water-quality-monitoring/api` in production (set via `VITE_API_BASE_URL`)
- Falls back to `http://localhost:5000/api` for local development
- Attaches JWT `Authorization: Bearer <token>` header via request interceptor
- Handles 401 responses by clearing auth state

---

## Backend Architecture

### Entry Point (`server/server.js`)

- Loads `.env` from `server/`, project root, and `front-end/` (priority order)
- Connects to MongoDB via `config/db.js`
- Mounts route modules under `/api/auth`, `/api/water`, `/api/admin`
- Binds to `0.0.0.0` on the configured port for LAN and VPS accessibility

### Routes

| Route Module | Path | Key Endpoints |
|---|---|---|
| `auth.js` | `/api/auth` | `POST /register`, `POST /login`, `POST /forgot-password`, `POST /reset-password` |
| `waterQuality.js` | `/api/water` | `GET /wqm/:year`, `GET/POST /visualization-year`, `GET /maptiler-key`, `GET /forecast-status` |
| `admin.js` | `/api/admin` | `GET /users`, `PATCH /users/:id`, `DELETE /users/:id`, `GET/POST /app-settings` |

### Middleware

| Middleware | File | Purpose |
|---|---|---|
| Auth guard | `authMiddleware.js` | Verifies JWT on protected routes |
| Admin guard | `adminMiddleware.js` | Restricts admin routes to admin/developer roles |

### Models

| Model | Collection | Description |
|---|---|---|
| `User` | `users` | Account with hashed password, role, status, reset token |
| `WqmDataset` | `wqmdatasets` | Full WQM year dataset imported from workbook |
| `AppSetting` | `appsettings` | Key-value app config (e.g. `visualizationYear`) |

### Workbook Import (`utils/wqmWorkbook.js`)

When a year's dataset does not exist in MongoDB, the backend reads the corresponding `.xlsx` file from `front-end/docs/` and parses it using `read-excel-file`. The parsed data is stored as a `WqmDataset` document. Subsequent requests for that year read directly from MongoDB.

---

## Data Flow

### Published Year Selection

```
User selects year in Settings
        │
        ▼
POST /api/water/visualization-year  (admin only)
        │
        ▼
AppSetting { key: 'visualizationYear', value: '2025' } saved in MongoDB
        │
        ▼
All connected clients read GET /api/water/visualization-year on next load
```

### WQM Data for 2024 / 2025

```
Frontend requests GET /api/water/wqm/2025
        │
        ▼
Backend checks WqmDataset collection for year 2025
        │
    Not found? ──► Parse wqm2025.xlsx from front-end/docs/
        │               └─► Store as WqmDataset document
        │
    Found? ──────────────────────────────────────────────────────┐
        │                                                         │
        └─────────────────────────────────────────────────────────▼
                        Return dataset JSON to frontend
```

### WQM Data for 2026 (Editable Draft)

```
Frontend loads src/data/wqm2026.json directly (no API call)
        │
        ▼
User edits record via WQM2026.jsx
        │
        ▼
PATCH /api/water/wqm/2026/:id   ──► Update in MongoDB
        │
        ▼
Frontend re-fetches and re-renders table
```

### 3D Map Rendering

```
Waterbody3DMap.jsx mounts CesiumViewer
        │
        ├── Loads station coordinates from stationWorkbook.js
        │       └── Parses wqm_stations.xlsx from front-end/docs/
        │
        ├── Fetches GET /api/water/maptiler-key (auth required)
        │       └── Returns MAPTILER_API_KEY from server .env
        │
        ├── Applies MapTiler hybrid tile provider (or OSM fallback)
        │
        └── Renders station pin billboards and waterbody label entities
```

---

## Authentication Flow

```
User submits login form
        │
POST /api/auth/login
        │
Backend verifies password with bcrypt
        │
Returns { token, user: { id, email, role, name } }
        │
Frontend stores token in AuthContext + localStorage
        │
Subsequent requests attach Authorization: Bearer <token>
        │
Middleware verifies JWT signature and expiry on every protected route
```

---

## Deployment Architecture (Production)

```
Internet
    │
    ▼
Nginx (port 80 / 443)
    │
    ├── /water-quality-monitoring/         → serves static React build
    │       /var/www/embr3/water-quality-monitoring/
    │
    └── /water-quality-monitoring/api/    → proxy to Express :5002
            /opt/embr3/water-quality-monitoring/app/server/
                    managed by PM2 (process name: embr3-wqms-api)
```

---

## Security Considerations

- Passwords are hashed with `bcryptjs` before storage; plaintext passwords are never persisted.
- JWTs are short-lived and signed with `JWT_SECRET`. The secret must be a long, randomly generated string in production.
- The backend port (`5002`) is not exposed to the public internet; only Nginx proxies traffic to it.
- API keys (`MAPTILER_API_KEY`, `GEMINI_API_KEY`) are server-side only and never sent to the client directly — the frontend requests them through authenticated API endpoints.
- Email reset tokens are single-use and time-limited.
- `crypto-js` encrypts sensitive values in `localStorage` to reduce XSS exposure surface.
- CORS is restricted to the frontend origin(s) configured at startup.

---

## Performance Notes

- Cesium static assets (`public/cesium/`) are served directly by Nginx, not bundled by Vite.
- Forecast charts are lazy-rendered — only the first few cards mount on initial tab load; the rest are deferred behind a "show more" control to avoid mounting hundreds of Recharts SVG trees simultaneously.
- Workbook data for 2024 and 2025 is imported to MongoDB once and cached; subsequent reads are database-only.
- React pages that are heavy (Cesium map, Visualizations) are code-split with `React.lazy()` and only bundled when the user navigates to them.
