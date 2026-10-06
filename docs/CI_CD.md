# CI/CD — EMBR3 Water Quality Monitoring System

Pipeline: `.github/workflows/ci-cd.yml` (GitHub Actions).
Server step: `scripts/deploy/remote-deploy.sh`.
Production: Hostinger KVM 2 VPS `embr3.onlinesystems` (72.61.125.232), served at
<https://embr3-onlinesystems.cloud/water-quality-monitoring/>.

## What runs when

| Trigger | Jobs |
|---|---|
| Any push, any pull request | **API** — `npm ci`, `npm test`, `npm audit --omit=dev --audit-level=high` (blocking) · **Front-end** — `npm ci`, `npm test`, ESLint (report only), `npm audit` (report only), production build |
| Push to `main`, or *Run workflow* | the two jobs above, then **Deploy** — only if both pass |

The deploy ships **the exact bundle CI built and tested**. Nothing is built on the server except the API's production dependencies (`npm ci --omit=dev`).

## How a deploy works

1. CI packages a release: built front-end (`web/`), API source without `node_modules`/`.env`/tests (`server/`), the WQM workbooks (`docs/`), and the commit SHA.
2. The tarball and `remote-deploy.sh` are copied to the VPS over SSH and run.
3. `remote-deploy.sh`:
   - **Pre-flight** — aborts *before changing anything* if `APP_DIR/server/.env`, `WEB_ROOT`, Node ≥ 20, `rsync` or the PM2 process are missing.
   - **Backup** — snapshots the current API code, web root and workbooks to `/opt/embr3/water-quality-monitoring/deploy-backups/<timestamp>` (last 5 kept).
   - Updates the API code (never touches `server/.env`), runs `npm ci --omit=dev`, reloads PM2.
   - **Health gate** — waits for `GET /api/health` to report `"db":"connected"`. If it fails, the previous API code is restored and restarted automatically and the deploy fails.
   - Publishes the new front-end **only after** the API is healthy, and records the revision in `APP_DIR/DEPLOYED_REVISION`.
4. CI smoke-tests the public URL: health, a route added by this release, and that the page references the bundle CI just built.

These paths were rehearsed on Linux (normal deploy, failed health → rollback, failed pre-flight → no change) before the pipeline was enabled.

## One-time setup

### 1. Deploy key on the VPS

Create a dedicated key pair (do not reuse a personal key):

```bash
ssh-keygen -t ed25519 -C "github-actions-wqms-deploy" -f wqms_deploy -N ""
```

Install `wqms_deploy.pub` for root on the VPS **in `/root/.ssh/authorized_keys2`**:

```bash
printf '%s\n' '<contents of wqms_deploy.pub>' > /root/.ssh/authorized_keys2 && chmod 600 /root/.ssh/authorized_keys2 && ssh-keygen -lf /root/.ssh/authorized_keys2
```

Why `authorized_keys2` (sshd reads both files): the hPanel **Browser terminal**
logs in by appending a temporary, expiring RSA key to `authorized_keys` *without
a trailing newline*, so a key appended after it is glued onto that line and
silently rejected. The Hostinger API's "attach public key" also did not reach
this VPS (no action was recorded). The production deploy key is installed this
way since 2026-10-06.

### 2. GitHub secrets — *Settings → Secrets and variables → Actions*

| Secret | Value |
|---|---|
| `VPS_HOST` | `72.61.125.232` |
| `VPS_USER` | the SSH user that owns the app and PM2 process (e.g. `root`) |
| `VPS_SSH_KEY` | contents of the **private** key `wqms_deploy` |
| `VPS_KNOWN_HOSTS` | *optional, recommended*: output of `ssh-keyscan 72.61.125.232` — pins the host key |
| `VITE_CESIUM_ION_TOKEN` | *optional*: Cesium ion token for terrain/buildings in the 3D maps |

Optional **variables** (only if the server differs from `DEPLOYMENT_HOSTINGER_KVM.md`):
`APP_DIR`, `WEB_ROOT`, `PM2_NAME`, `VPS_PORT`, `PUBLIC_URL`.

### 3. Optional approval gate

*Settings → Environments → production → Required reviewers* makes every production deploy wait for a click.

### 4. Server environment (`server/.env` on the VPS — never in Git)

Already required: `NODE_ENV`, `PORT`, `MONGO_URI`, `JWT_SECRET` (≥ 32 random characters).
For VERA's AI mode add `GEMINI_API_KEY` (and optionally `VERA_MODEL`, default `gemini-3.5-flash`); without it VERA runs in rule-based mode.

## Everyday use

- **Deploy**: merge or push to `main`. Watch *Actions → CI/CD*.
- **Re-deploy / deploy manually**: *Actions → CI/CD → Run workflow* on `main`.
- **Roll back**: revert the commit on `main` (the pipeline deploys the revert), or on the VPS restore a snapshot from `deploy-backups/` and `pm2 reload embr3-wqms-api`.
- **Data**: deploys never touch MongoDB. New workbooks are loaded with `node scripts/importWqmYear.js <year>` (see `DEVELOPER.md`).

## Production facts (verified 2026-10-06)

- `APP_DIR=/opt/embr3/water-quality-monitoring/app`, `WEB_ROOT=/var/www/embr3/water-quality-monitoring`, PM2 process `embr3-wqms-api` (API on port 5007, MongoDB Atlas `erms-cluster`) — the pipeline defaults.
- The VPS hosts **seven** PM2 apps (HR, IIS, OCSM, AQM, …). The deploy reloads only `embr3-wqms-api`. Do **not** run `pm2 update` to clear the "In-memory PM2 is out-of-date" warning without a maintenance window — it restarts every app.
- PM2's daemon runs apps on **Node 20.20** (system Node is 22.22). The API supports Node ≥ 20.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy job fails at *Check deploy configuration* | add the missing secrets listed in the error |
| `Permission denied (publickey)` | the public key is not in the deploy user's `authorized_keys`, or `VPS_USER` is wrong |
| `ABORT: PM2 process ... not found` | set the `PM2_NAME` variable to the name in `pm2 ls` |
| `ABORT: ... /server/.env is missing` | set `APP_DIR` to the real checkout path |
| Health check fails, rolled back | `pm2 logs embr3-wqms-api` on the VPS — usually a missing `.env` value |
| Smoke test fails on the bundle check | a CDN/proxy cache; purge it, then re-run |
