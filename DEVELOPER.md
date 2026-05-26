# Developer Guide

## Stack

- Frontend: React 19, Vite 8, React Router 7, Recharts, Ant Design, Cesium.
- Backend: Express 5, MongoDB via Mongoose, JWT auth, Nodemailer.
- Data sources: `front-end/src/data/wqm2026.json` for the editable 2026 baseline and `front-end/docs/wqm2024.xlsx`, `wqm2025.xlsx`, `wqm2026.xlsx`, `wqm_stations.xlsx` for workbook-backed data.

## Important Paths

- `front-end/src/App.jsx` - app routing and protected route shell.
- `front-end/src/pages/Home.jsx` - main dashboard shell, sidebar, lazy-loaded visualization views.
- `front-end/src/pages/WQM2026.jsx` - tabular WQM data editing surface for 2024, 2025, and 2026 views.
- `front-end/src/pages/Visualizations.jsx` - non-3D charts, including forecast charts.
- `front-end/src/pages/Waterbody3DMap.jsx` - Cesium 3D map, station pins, waterbody labels, MapTiler integration.
- `front-end/src/utils/wqmSheets.js` - shared published-year and sheet selection logic.
- `front-end/src/utils/wqmData.js` - parameter normalization, station filtering, values, units, and status helpers.
- `front-end/src/api/axios.js` - API client. Production uses `/water-quality-monitoring/api` by default.
- `server/server.js` - Express app bootstrap and route mounting.
- `server/routes/waterQuality.js` - WQM year endpoints, workbook import, forecast status, MapTiler key endpoint.
- `server/utils/wqmWorkbook.js` - workbook parser.

## Data Flow

The app uses a shared published WQM year:

1. Frontend asks `GET /api/water/visualization-year`.
2. The backend reads `AppSetting` key `visualizationYear`.
3. For 2026, the frontend uses local editable draft data.
4. For 2024 and 2025, the frontend asks `GET /api/water/wqm/:year`.
5. If the MongoDB dataset does not exist, the backend imports the matching workbook.

For production subpath deployment, the frontend API base changes to `/water-quality-monitoring/api`, and Nginx should proxy that path to the backend `/api` routes.

## Cesium Map Notes

`Waterbody3DMap.jsx` uses:

- MapTiler hybrid tiles when `MAPTILER_API_KEY` is configured.
- OpenStreetMap tiles as fallback.
- Cesium station pin billboards plus pulsing point markers.
- Waterbody label entities generated from matched station coordinates.
- Built-in Cesium scene mode, home, fullscreen, and navigation help tools.
- Optional world terrain and OSM buildings through `VITE_CESIUM_ION_TOKEN`.

Avoid dynamic ellipse geometry for marker pulse effects. Cesium can stop rendering if animated ellipse axes evaluate inconsistently. Use point or billboard properties for animated marker effects.

Do not add polyline routes between station coordinates unless the product requirement changes.

## Forecast Chart Notes

Forecast charts are local technical forecasts built from monthly station data using ordinary least squares and RMSE uncertainty bands. The app intentionally renders only the first few forecast cards on initial load and defers the rest behind a "show more" control.

This is important because Recharts mounts one SVG tree per parameter chart; rendering all parameter charts at once can make the forecast tab feel slow.

## Environment Variables

Backend:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/embr3_wqms
JWT_SECRET=change-this-secret
MAPTILER_API_KEY=optional-maptiler-key
GEMINI_API_KEY=optional-google-ai-key
GEMINI_MODEL=gemini-2.5-flash
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=
```

Frontend:

```env
VITE_HOST=127.0.0.1
VITE_PORT=5173
VITE_API_TARGET=http://localhost:5000
VITE_API_BASE_URL=/water-quality-monitoring/api
VITE_CESIUM_ION_TOKEN=optional-token-for-terrain-and-buildings
```

`VITE_API_BASE_URL` is optional locally. In production it is useful when deploying behind a subpath.

## Commands

Frontend:

```powershell
cd front-end
cmd /c npm run dev
cmd /c npm run lint
cmd /c npm run build
cmd /c npm run preview
```

Backend:

```powershell
cd server
cmd /c npm run dev
cmd /c npm start
```

## Development Rules

- Keep WQM year selection centralized in `wqmSheets.js`.
- Keep parameter names normalized through `wqmData.js` helpers.
- Do not parse workbook data with ad hoc string slicing when `wqmWorkbook.js` or `xlsx` helpers can do it.
- Keep Cesium static assets in `front-end/public/cesium`.
- Keep generated Cesium public files excluded from ESLint.
- Run `cmd /c npm run lint` and `cmd /c npm run build` before deployment.
