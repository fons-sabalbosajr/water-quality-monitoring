# EMBR3 Water Quality Monitoring System

EMBR3-WQMS is a React, Vite, Express, and MongoDB application for Region III water quality monitoring workflows. It includes dashboard summaries, WQM tabular data management, visual analytics, forecast charts, user management, published-year selection, and a Cesium 3D waterbody map.

## Project Layout

- `front-end/` - React 19 client, Vite build, Cesium assets, WQM workbook assets, UI pages.
- `server/` - Express API, authentication, admin routes, WQM workbook import, forecast and MapTiler configuration endpoints.
- `scripts/` - local workbook extraction helpers.
- `front-end/docs/` - source Excel workbooks used by the client and import parser.

## Local Development

Install dependencies separately:

```powershell
cd front-end
cmd /c npm install

cd ..\server
cmd /c npm install
```

Create `server/.env`:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/embr3_wqms
JWT_SECRET=change-this-secret
MAPTILER_API_KEY=your-maptiler-key
GEMINI_API_KEY=optional-google-ai-key
GEMINI_MODEL=gemini-2.5-flash
```

Run the backend:

```powershell
cd server
cmd /c npm run dev
```

Run the frontend:

```powershell
cd front-end
cmd /c npm run dev
```

The Vite app uses the base path `/water-quality-monitoring/`.

## Verification

From `front-end/`:

```powershell
cmd /c npm run lint
cmd /c npm run build
```

From `server/`:

```powershell
cmd /c npm start
```

Then check:

```text
GET /api/health
```

## Main Documentation

- [DEVELOPER.md](DEVELOPER.md) - code architecture, conventions, and operating notes.
- [USER_GUIDE_WQM_DATA.md](USER_GUIDE_WQM_DATA.md) - end-user guide for editing and modifying WQM data.
- [DEPLOYMENT_HOSTINGER_KVM.md](DEPLOYMENT_HOSTINGER_KVM.md) - Hostinger KVM 2 VPS deployment guide with isolated directories.
