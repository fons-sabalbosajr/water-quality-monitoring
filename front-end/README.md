# EMBR3-WQMS Frontend

React and Vite client for EMBR3 Water Quality Monitoring System.

## Commands

```powershell
cmd /c npm install
cmd /c npm run dev
cmd /c npm run lint
cmd /c npm run build
```

## Important Paths

- `src/pages/Home.jsx` - dashboard shell and lazy-loaded visualization routing.
- `src/pages/WQM2026.jsx` - tabular WQM data view and editing.
- `src/pages/Visualizations.jsx` - analytical charts and forecast charts.
- `src/pages/Waterbody3DMap.jsx` - Cesium 3D waterbody map.
- `src/utils/wqmSheets.js` - shared WQM year and sheet logic.
- `src/utils/wqmData.js` - parameter value, unit, and station helpers.
- `docs/` - Excel workbooks used by the app.
- `public/cesium/` - copied Cesium static assets.

## API Base URL

Local development uses `/api` through the Vite proxy.

Production defaults to:

```text
/water-quality-monitoring/api
```

Override with:

```env
VITE_API_BASE_URL=/custom/path/api
```

## Build Path

The Vite base path is:

```text
/water-quality-monitoring/
```

Deploy the built `dist/` directory under the same subpath.
