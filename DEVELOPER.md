# Developer Guide

## Stack

- Frontend: React 19, Vite 8, React Router 7, Recharts, Ant Design, Cesium.
- Backend: Express 5, MongoDB via Mongoose, JWT auth, Nodemailer.
- Data sources: MongoDB `wqmdatasets` (one document per year, 2024–2026), imported from `front-end/docs/wqm2024.xlsx`, `wqm2025.xlsx`, `wqm2026.xlsx`; `wqm_stations.xlsx` for coordinates. `front-end/src/data/wqm2026.json` is only the offline fallback shown before the first sync.

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
3. Every year (2024, 2025, 2026) is served from MongoDB by `GET /api/water/wqm/:year` (and its `/public/` twin).
4. Each browser keeps an encrypted local copy stamped with the server's `importedAt`, renders it instantly, and revalidates it on mount/focus via the tiny `GET /api/water/public/wqm/:year/meta`; the full year is downloaded only when it changed. Edits (`PUT /api/water/wqm/:year`) therefore reach the public dashboard and every device.
5. If the MongoDB dataset does not exist, the backend imports the matching workbook.

App-wide settings are `AppSetting` documents: `visualizationYear`, `forecastMonths` (Forecast Horizon — `GET /api/water/public/forecast-months`, `PATCH /api/admin/settings/forecast-months`) and `veraSettings`.

### Updating a year from a new workbook

Replace `front-end/docs/wqm<year>.xlsx`, then from `server/`:

```bash
node scripts/importWqmYear.js 2026 --dry-run        # parse + report suspect values only
node scripts/importWqmYear.js 2026 --force --write-bundle
```

`--force` replaces an existing year (a JSON backup is written to `server/backups/` first — that discards edits made in the app since the last import). `--write-bundle` also refreshes the offline fallback JSON. The parser handles monthly and quarterly sheets, two-row headers, titles above or below the header, and the "Date of Sampling" row.

## VERA (assistant)

`server/utils/vera/` + `server/routes/vera.js`, UI in `front-end/src/components/vera/` (ported from the ESWMP VERA). VERA's figures always come from `tools.js`, which computes them from MongoDB with the same guidelines (`wqm.js` ↔ `wqmData.js`) and forecast engines (↔ `Visualizations.jsx`) as the dashboards — keep those in sync. The model (Gemini via `GEMINI_API_KEY`; model chosen in Developer Manager → VERA Assistant, developer only) only picks tools and phrases results; without a model, `intents.js` routes the common questions to the same tools. Data changes are proposals: a signed, single-use, user-bound token is applied by `POST /api/vera/actions/confirm` only after the admin clicks Confirm, and is rejected if the value changed in the meantime.

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
