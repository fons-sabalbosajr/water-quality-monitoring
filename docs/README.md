# EMBR3 Water Quality Monitoring System (EMBR3-WQMS)

EMBR3-WQMS is a full-stack web application for managing, visualizing, and analyzing water quality monitoring data across Region III waterbodies. It is developed for internal operational use and supports data entry workflows, published-year selection, interactive charts, forecast analytics, and a Cesium-powered 3D waterbody map.

---

## Features

| Feature | Description |
|---|---|
| Dashboard | Summary cards, parameter gauges, monthly trend charts, Pearson correlation, and station coverage view for the active published year |
| Tabular Results | Editable WQM data table for 2026 (live draft) and read-only views for 2024–2025 workbook-backed datasets |
| Visualizations | Non-3D Recharts analytics including box plots, heatmaps, radar charts, bar comparisons, and forecast charts with OLS trend lines and RMSE uncertainty bands |
| Waterbody Profile | Detailed per-waterbody parameter summaries and station breakdowns |
| Cesium 3D Map | Interactive 3D globe with station pin billboards, waterbody labels, MapTiler hybrid imagery, and optional Cesium Ion terrain |
| User Management | JWT-based authentication with role-based access (user, developer, admin) |
| Settings | Visualization year selection, user access controls, station assignment map, and app preferences |
| Password Reset | Email-based forgot-password and reset-password flows via Nodemailer |

---

## Technology Stack

### Frontend

| Package | Version | Purpose |
|---|---|---|
| React | 19 | UI framework |
| Vite | 8 | Build tool and dev server |
| React Router | 7 | Client-side routing |
| Ant Design | 6 | UI component library |
| Recharts | 3 | Chart rendering |
| CesiumJS | 1.141 | 3D globe and geospatial map |
| Axios | 1 | HTTP client |
| crypto-js | 4 | Encrypted local storage |
| read-excel-file | 9 | Client-side workbook parsing |

### Backend

| Package | Version | Purpose |
|---|---|---|
| Node.js | 22 LTS | Runtime |
| Express | 5 | REST API framework |
| MongoDB / Mongoose | 9 | Database and ODM |
| bcryptjs | 3 | Password hashing |
| jsonwebtoken | 9 | JWT authentication |
| Nodemailer | 8 | Email delivery |
| read-excel-file | 9 | Server-side workbook import |
| dotenv | 17 | Environment config |

---

## Project Layout

```
water-quality-monitoring/
├── front-end/              # React 19 + Vite client
│   ├── src/
│   │   ├── App.jsx         # Root router and protected route shell
│   │   ├── api/            # Axios instance (API base URL config)
│   │   ├── components/     # CesiumStationMap, ProtectedRoute, Icons
│   │   ├── context/        # AuthContext, ThemeContext
│   │   ├── data/           # wqm2026.json — editable 2026 draft data
│   │   ├── pages/          # All route-level page components
│   │   └── utils/          # Data helpers, station workbook, wqmData, wqmSheets
│   ├── public/cesium/      # Cesium static assets (workers, widgets, assets)
│   └── docs/               # Source Excel workbooks (wqm2024–2026, wqm_stations)
├── server/                 # Express API
│   ├── config/             # DB connection, Nodemailer
│   ├── middleware/         # Auth and admin middleware
│   ├── models/             # Mongoose models (User, WqmDataset, AppSetting)
│   ├── routes/             # auth, waterQuality, admin
│   ├── templates/          # Email templates
│   └── utils/              # wqmWorkbook parser
├── scripts/                # Local workbook extraction helpers
└── docs/                   # Project documentation (this folder)
```

---

## Local Development

### Prerequisites

- Node.js 22 LTS
- MongoDB (local instance or Atlas connection string)
- Git

### Install dependencies

```bash
# Frontend
cd front-end
npm install

# Backend
cd ../server
npm install
```

### Configure the backend

Create `server/.env`:

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/embr3_wqms
JWT_SECRET=change-this-secret

# Optional — 3D map imagery
MAPTILER_API_KEY=your-maptiler-key

# Optional — AI forecast endpoints
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash

# Optional — email features
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=user@example.com
EMAIL_PASS=secret
EMAIL_FROM="EMBR3-WQMS <user@example.com>"
```

### Configure the frontend (optional for local dev)

Create `front-end/.env`:

```env
VITE_HOST=127.0.0.1
VITE_PORT=5173
VITE_API_TARGET=http://localhost:5000
VITE_CESIUM_ION_TOKEN=optional-for-terrain
```

### Run the application

Open two terminals:

```bash
# Terminal 1 — backend
cd server
npm run dev

# Terminal 2 — frontend
cd front-end
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build and lint check

```bash
cd front-end
npm run lint
npm run build
```

---

## Environment Variables Reference

### Backend (`server/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | Yes | Server port (default `5000`) |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Secret for signing JWTs |
| `MAPTILER_API_KEY` | No | MapTiler API key for 3D map imagery |
| `GEMINI_API_KEY` | No | Google AI key for AI forecast features |
| `GEMINI_MODEL` | No | Gemini model name (default `gemini-2.5-flash`) |
| `EMAIL_HOST` | No | SMTP host for password reset emails |
| `EMAIL_PORT` | No | SMTP port |
| `EMAIL_USER` | No | SMTP username |
| `EMAIL_PASS` | No | SMTP password |
| `EMAIL_FROM` | No | Sender display name and address |

### Frontend (`front-end/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Production | API subpath (e.g. `/water-quality-monitoring/api`) |
| `VITE_API_TARGET` | Dev proxy only | Backend origin for Vite proxy |
| `VITE_CESIUM_ION_TOKEN` | No | Cesium Ion token for terrain and buildings |

---

## API Health Check

```bash
curl http://localhost:5000/api/health
```

Expected response:

```json
{ "status": "OK", "message": "Water Quality Monitoring API is running" }
```

---

## Related Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data flow, component map |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Hostinger KVM VPS deployment guide |
| [USER_GUIDE_WQM_DATA.md](../USER_GUIDE_WQM_DATA.md) | End-user guide for editing WQM data |
| [DEVELOPER.md](../DEVELOPER.md) | Developer conventions and operating notes |
