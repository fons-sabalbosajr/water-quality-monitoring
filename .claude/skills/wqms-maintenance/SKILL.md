---
name: wqms-maintenance
description: Regular maintenance pass for the EMB R3 Water Quality Monitoring System (Express/Mongoose API + React/Vite/antd SPA). Dependency audit, backend health, table/data-loading performance, and responsive UI checks, with the project's known traps and accepted findings. Use when the user says "run maintenance", "check the app", "audit dependencies", "npm audit", "do the health pass", or asks about vulnerabilities/performance in this repo.
---

# WQMS Maintenance Routine

Project-specific pass for this repo. Two npm packages: `server/` (Express 5 +
Mongoose 9, CommonJS) and `front-end/` (React 19 + Vite + antd v6, ESM).

**Inspect before changing. Report findings, then fix root causes.** Do not
"fix" by suppressing a warning or pinning around a symptom.

---

## 0. Baseline — run this first

Everything below is verified working on this repo. Run from the repo root.

```bash
# Server
cd server && npm audit && npm test

# Front-end
cd front-end && npm audit && npm test && npx eslint src/ && npx vite build
```

Compare against the last known-good baseline before deciding anything is new:

| Check | Known-good |
|---|---|
| `server` audit | 3 high — one dev-only chain (`nodemon` → `chokidar` → `braces`), no patched `braces` exists. Accepted, see §1.1 |
| `server` tests | 32 passing (`tests/validateSheets`, `wqmWorkbook`, `vera`) |
| `front-end` audit | 0 vulnerabilities |
| `front-end` tests | 61 passing (`src/utils/*.test.js`, `src/context/*.test.js`) |
| `front-end` lint | 15 problems (10 errors, 5 warnings) — all pre-existing, see §5 |
| `front-end` build | succeeds; `CesiumStationMap` chunk ~4MB (lazy-loaded, expected) |

A lint count *above* 16 means the change under review introduced something.
Below 16 is an improvement. Never report the raw count as if it were all new.

---

## 1. Dependency audit

Run `npm audit` in **both** packages. Then, for each finding:

1. **Identify the dependency path** — `npm ls <pkg>` — before touching anything.
   Distinguish a direct dependency from a transitive one, and a runtime
   dependency from a `devDependencies`-only chain.
2. **Check whether the advisory is actually reachable in this app** (see §1.2).
3. Prefer, in order: bump the direct dep → add an `overrides` entry → upgrade
   the parent that pulls in the vulnerable transitive → accept and document.
4. Re-run the full §0 baseline afterwards. **An override can break the build
   without failing the audit** — this has already happened once here (§1.1).

### 1.1 Traps specific to this repo

**An `overrides` pin can itself become the vulnerability.**
`server/package.json` pinned `brace-expansion: 5.0.6`, and a later advisory
covered `<= 5.0.7` — so the pin was holding the tree *on* the vulnerable
version. Every audit, re-check the pinned versions in both `overrides` blocks,
not just the resolved tree.

**`brace-expansion` majors are not interchangeable.**
`brace-expansion` 5.x changed its export shape. `minimatch` 3.x expects the 1.x
CommonJS shape and dies with `TypeError: expand is not a function` — which
surfaces as ESLint crashing, *not* as a build failure. There is no patched 1.x.
The fix is to upgrade whatever still depends on `minimatch` 3.x (here: ESLint —
v10+ uses `minimatch` ^10), then override `brace-expansion` to `^5.0.8`.

After any `brace-expansion` / `minimatch` change, **run ESLint and confirm it
prints results rather than a stack trace.** `npx eslint src/` exits 0 on an
internal crash, so a bare exit-code check will not catch this.

**`npm audit fix` can DOWNGRADE `nodemon` to 1.x.** The only "fix" npm offers for
the `braces` advisory is `nodemon@1.14.10`, which drags in ~12 *more* advisories
(old chokidar, got, cross-spawn, update-notifier). This happened on 2026-10-06 and
turned 3 findings into 15. Keep `nodemon` at ^3; accept the dev-only `braces` chain.

**Overrides pin floors, so raise them.** Both `overrides` blocks hold caret floors
(`brace-expansion`, `qs`, `dompurify`, `proxy-addr`, `@xmldom/xmldom` …). When an
advisory lands above a floor, bump the floor to the patched version.

**`npm audit fix --force` on `react-router` proposes a downgrade.** It suggests
`react-router-dom@7.11.0`, moving backwards ~7 minors. Do not accept it.

### 1.2 Reachability

Advisories are scored for the general case. Check whether the vulnerable code
path exists here before treating a "high" as urgent:

- This SPA is **client-only** — `BrowserRouter`, no RSC, no SSR, no data-router
  (`createBrowserRouter`/`RouterProvider`), no loaders or actions.
  Confirm with:
  ```bash
  grep -rn "createBrowserRouter\|RouterProvider\|loader:\|action:\|renderToString" front-end/src/
  ```
- `devDependencies`-only chains (ESLint, Vite plugins) do not ship to the
  browser and do not run in production. Still fix them, but do not treat a
  linter DoS as a production incident.

Reachability is a reason to **deprioritise**, never a reason to skip a fix that
is available and safe.

---

## 2. Backend health (`server/`)

Check, in this order:

- **Startup config** — `server.js` validates `MONGO_URI` and `JWT_SECRET` at
  boot and warns when `JWT_SECRET` is under 32 chars. If that warning is
  printing, the secret needs rotating; say so explicitly.
- **CORS** — the allowlist is built from `CLIENT_URL` + `CORS_ORIGINS` plus
  built-in dev hosts. A new deployment origin must be added to env, not
  hardcoded.
- **Auth** — `middleware/authMiddleware.js` re-checks `status === 'approved'`
  on every request and caches users for 15s. Any new route that mutates a user
  **must** call `invalidateUser(id)`, or a suspension will lag by up to 15s.
- **CRUD writes** — every write to `WqmDataset` must pass through
  `utils/validateSheets.js`. An empty or malformed `sheets` array silently
  replaces a whole monitoring year.
- **Conditional requests** — `GET /api/water/wqm/:year` and its `/public/`
  twin return `304` via ETag on `importedAt`. Verify with:
  ```bash
  curl -sD - -o /dev/null http://localhost:5000/api/water/public/wqm/2025 | grep -i etag
  curl -so /dev/null -w "%{http_code} %{size_download}\n" -H 'If-None-Match: <etag>' <same url>
  ```
  Expect `304 0`. If it returns `200` with a full body, the ETag path regressed.
- **Rate limiting** — `routes/auth.js` throttles login/register (10 per 15 min)
  and forgot-password (5). It is **in-process**: if the app is ever scaled to
  more than one Node instance, the effective limit multiplies and it must move
  to Redis.
- **Indexes** — never set both `unique: true` and `index: true` on the same
  Mongoose field; it builds the index twice and warns.

There is **no socket/WebSocket layer** in this project. Cross-view realtime
updates run on `window` `CustomEvent`s (`wqm:drafts-updated`,
`wqms:visualization-year`, `wqms:access-settings`, `wqms:waterbody-profile-settings`,
`wqms:log`) plus cross-tab `storage` events. If asked to "check sockets", check
that event bus — and say plainly that no sockets exist rather than inventing them.

---

## 3. Data loading & tables (front-end)

The recurring performance failures in this codebase, all of which have bitten
before:

**Controlled `pageSize` breaks the page-size selector.**
antd merges a supplied `pagination` object *over* its internal state, so a
literal `pagination={{ pageSize: 10 }}` is rebuilt every render and overwrites
the user's choice — the dropdown moves but the row count does not. Every table
must use `useTablePagination(id)` from `src/utils/tablePagination.js`. Audit with:

```bash
grep -rn "pagination={{" front-end/src/
```

Any hit that sets `pageSize` inline is a bug.

**Never put side effects inside a `setState` updater.** React may invoke an
updater twice (StrictMode does in dev). Storage writes, `api.put`, and
`logActivity` inside `setSheets(...)` produced duplicate MongoDB writes and
duplicate log entries per edit. Compute the next value, then commit state and
side effects separately.

**Never silence `react-hooks/exhaustive-deps` on a `useMemo` that builds antd
columns.** Cell renderers close over event handlers; pinning the memo to a
narrow dep list freezes them on their first-render closures. This shipped once
here: `columns` was memoised on `[canEditYear]`, so the row buttons kept calling
a first-render `openStationModal` that had captured `modalParams === []` (the
list is empty until sheets load). Clicking Edit then built a station draft with
no parameters while the modal still rendered inputs for every real parameter,
and the first keystroke threw
`Cannot read properties of undefined (reading 'monthly')`.
If a memo needs a disable comment to be "correct", the handlers are the thing to
stabilise — wrap them in `useCallback` and list them.

**Readers and writers must agree on optionality.** The same bug was only a
*crash* because the row renderers read `draft.params?.[param]?.monthly` with
optional chaining while the writer assumed the key existed. If a read is
optional, the corresponding write must create-on-demand. The pure draft helpers
now live in `src/utils/stationDraft.js` with tests in `stationDraft.test.js` —
put new draft logic there rather than inline in the component, so it is
reachable from `npm test`.

**Never tick a clock in a high-level component.** A 1s `setInterval` calling
`setState` at the top of a page re-renders every chart, table, and map beneath
it. Clocks belong in a `memo`'d leaf component.

**Watch identity churn.** Helpers that return a fresh array/object on each call
invalidate every downstream `useMemo`. `getStations`, `getReadableStations`
(WeakMap-cached) and `getStoredWqmSheets` (stable fallback) must keep returning
stable references. Hooks returning `{ ... }` literals must be `useMemo`'d.

**Check for duplicate network calls.** `usePublishedWqmYear` and
`fetchYearSheets` in `src/utils/wqmSheets.js` dedupe via a module-level store
and an in-flight request map. If a new view fetches a year directly with
`api.get`, route it through `fetchYearSheets` instead.

**Public routes must use public endpoints.** `/public-dashboard` is
unauthenticated; it passes `{ isPublic: true }` so the hooks hit
`/api/water/public/*`. A protected endpoint on that route 401s on every visit.

**`rowKey` must be genuinely unique.** `stnNo` is user-editable and duplicates
occur; keys are composed as `` `${sheet.key}:${stnNo}:${index}` ``.

**`scroll={{ x: "max-content" }}` guarantees a horizontal scrollbar.** It sizes
the table to its widest possible content, so it can never shrink to fit. Use a
numeric minimum (the sum of the column minimums) instead, and give free-text
columns `ellipsis: true` with a `minWidth`. A global rule in `index.css`
stretches the inner table to `width: 100%` so the columns share the container.

**Never nest scroll regions.** A modal body that scrolls *and* an inner table
with its own `scroll.y` makes the wheel jump between them and can push the
footer out of reach. Pick one: the modal body scrolls (with a sticky table
header), or the table scrolls inside a non-scrolling body. `.ant-modal-content`
is globally a flex column with a `max-height`, so the header and footer stay
pinned.

**Cesium: never put a cheap prop in the viewer-creation dependency array.**
`birdseye` only changes camera pitch, but it sat in that array, so toggling it
tore down and rebuilt the whole WebGL context. Anything that is not a genuine
viewer-construction option belongs in a ref. The memory budget
(`tileCacheSize`, `maximumScreenSpaceError`, `preloadAncestors/Siblings`,
`resolutionScale`, and `applyTilesetMemoryBudget` for OSM Buildings) is set
right after construction — Cesium's defaults assume a full-screen globe app and
are far too generous for an embedded station map.

**React context lives in component-free modules.** `createContext()` is in
`context/authStore.js` / `context/themeStore.js`; the providers are separate
`.jsx` files. When context creation shares a file with its provider, Fast
Refresh re-runs the module on edit and mints a *new* context object — the
mounted provider keeps publishing to the old one, every consumer silently gets
the default, and `useAuth` throws "must be used inside an <AuthProvider>" on a
correctly nested tree. Import hooks from the **store**, never from the provider,
and never re-add `eslint-disable react-refresh/only-export-components`.
`context/contextModules.test.js` enforces all of this statically.

**Animations use `useReveal` (`src/utils/useReveal.js`).** One-shot, unobserves
after firing, transform/opacity only, cancels in-flight animations on unmount,
and skips entirely under `prefers-reduced-motion`. Do not hand-roll another
IntersectionObserver reveal — the landing page previously had one that never
unobserved, so its callback ran on every scroll for the life of the page.

**Recharts colours cannot come from CSS variables.** `stroke="var(--border)"`
is silently ignored — SVG presentation attributes do not resolve `var()`, so
the element falls back to its default paint in *both* themes. Use
`useChartTheme()` from `src/utils/chartTheme.js`; the raw tokens and WCAG
contrast helpers live in `chartPalette.js` and are covered by
`chartPalette.test.js`.

---

## 4. Frontend UI & responsiveness

- **Typography** — `--app-font-family` / `--app-font-mono` / `--app-font-size`
  in `src/index.css` are the single source of truth. `Home.css`,
  `PublicDashboard.css`, and the antd `ConfigProvider` token in `App.jsx` all
  reference it. Adding a raw `font-family:` anywhere else re-introduces the
  page-to-page inconsistency that was just fixed. Note: **`Inter` is named
  first but is not installed** — everything currently resolves to the system
  stack. Installing `@fontsource/inter` would activate it everywhere at once.
- **Viewport height** — use `100dvh` (with a `100vh` line above it as
  fallback). Bare `100vh` causes phantom scroll on mobile.
- **Overflow** — grid/flex children need `min-width: 0`, or long station IDs
  push the page sideways. Wide content scrolls inside its own container; the
  body must never scroll horizontally.
- **Card uniformity** — `.ant-card` is globally `height: 100%` + column flex.
  Custom card grids need `align-items: stretch` and `height: 100%` on children.
- **antd v6** — `destroyOnClose` is deprecated; use `destroyOnHidden`. Check
  the console for deprecation warnings after any antd bump.
- **Breakpoints are inconsistent** (18 distinct values: 760/768/780,
  640/576, 900/980, 1024/1080/1180…). CSS custom properties cannot be used in
  media queries, so consolidating means a manual rewrite of ~10k lines of CSS.
  Do not start that as part of a routine pass — flag it and move on.

---

## 5. Accepted findings — do not re-litigate

Re-check these only when the surrounding facts change.

- **16 ESLint problems in `front-end/src/`.** Unused vars plus
  `set-state-in-effect` in `Settings.jsx`, `Visualizations.jsx`,
  `Waterbody3DMap.jsx`, and one React Compiler memoization bailout at
  `Settings.jsx:~2460`. Pre-existing; fixing them means changing logic with no
  reported defect. Leave unless the user asks.
- **`normalizeParamName` has no rule for `DO`.** A column headed exactly
  `DO (mg/L)` works; `Dissolved Oxygen` or `DO, mg/L` falls through as a raw
  string and will not join the DO series. Changing this alters how existing
  data is interpreted — it is the user's call, not a routine fix.
- **`CesiumStationMap` chunk is ~4MB** (~1.1MB gzipped). Lazy-loaded, so it
  does not block first paint. First open of the 3D map is slow by design.
- **`react-router` requires Node >= 22.22.0.** Local Node is 22.18.0, so
  `npm install` prints an `EBADENGINE` warning. It installs and builds fine,
  but **production must run Node >= 22.22.0**, and `npm ci --engine-strict`
  will fail below that. Re-check the deploy target's Node version.

---

## 6. Reporting

Report in this order, and keep it concrete — file, line, and the actual
consequence, never generic advice:

1. **Problems found** (table: area · file · issue · impact)
2. **Fixes made**
3. **Files changed**
4. **Verification** — paste the real §0 output; never claim a check passed
   without running it
5. **Remaining risks** — including anything deliberately left alone and why
6. **Tests added or updated**

If something was skipped or could not be verified, say so plainly. A
maintenance pass that overstates its coverage is worse than one that reports a
gap.
