# EMBR3-WQMS Deployment Guide — Hostinger KVM VPS

This guide deploys the EMBR3 Water Quality Monitoring System on the Hostinger KVM VPS **without touching any of the other applications already running on the same server**.

---

## Target Server

```
OS:      Ubuntu 24.04.4 LTS
IP:      72.61.125.232
App URL: http://72.61.125.232/water-quality-monitoring/
```

### Already Running on This Server (Do Not Modify)

The following PM2 processes must remain untouched throughout this deployment:

| PM2 ID | Name | Port |
|---|---|---|
| 9 | aqm-api | — |
| 16 | chordline-api | — |
| 18 | embr3-eswmp-api | — |
| 8 | embr3-hr-api | — |
| 19 | embr3-iis-api | — |
| 11 | embr3-ocsm-api | — |
| 10 | racatom-api | — |

This app uses:
- **PM2 name:** `embr3-wqms-api`
- **Backend port:** `5002` (verify it is not used by any existing app before proceeding)
- **App path:** `/opt/embr3/water-quality-monitoring/`
- **Web root:** `/var/www/embr3/water-quality-monitoring/`
- **Nginx config:** `/etc/nginx/sites-available/embr3-wqms.conf`

---

## Step 0 — Verify Port Availability

Before starting, confirm port `5002` is free:

```bash
ss -tlnp | grep 5002
```

If the output is empty, the port is available. If it is in use, change `PORT=5002` to another unused port in Step 4 and update the Nginx proxy config in Step 7.

---

## Step 1 — System Packages

Node.js 22 LTS and PM2 should already be installed from previous app deployments. Verify:

```bash
node -v
npm -v
pm2 -v
```

If Node.js is not yet installed:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

If PM2 is not yet installed:

```bash
sudo npm install -g pm2
```

Nginx should also be present. If not:

```bash
sudo apt update
sudo apt install -y nginx
```

---

## Step 2 — Create App Directories

These directories are isolated from all other apps:

```bash
mkdir -p /opt/embr3/water-quality-monitoring
mkdir -p /var/www/embr3/water-quality-monitoring
mkdir -p /var/log/embr3/water-quality-monitoring
```

---

## Step 3 — Clone the Repository

```bash
cd /opt/embr3/water-quality-monitoring
git clone https://github.com/fons-sabalbosajr/water-quality-monitoring.git app
cd app
```

Directory layout after clone:

```
/opt/embr3/water-quality-monitoring/app/
├── front-end/
├── server/
├── scripts/
└── docs/
```

---

## Step 4 — Configure Backend Environment

```bash
nano /opt/embr3/water-quality-monitoring/app/server/.env
```

Paste and fill in the values:

```env
NODE_ENV=production
PORT=5002
MONGO_URI=mongodb://127.0.0.1:27017/embr3_wqms
JWT_SECRET=replace-with-a-long-random-secret

# Optional — 3D map imagery
MAPTILER_API_KEY=replace-if-available

# Optional — AI forecast features
GEMINI_API_KEY=optional-google-ai-key
GEMINI_MODEL=gemini-2.5-flash

# Optional — email password reset
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=user@example.com
EMAIL_PASS=secret
EMAIL_FROM="EMBR3-WQMS <user@example.com>"
```

> **Tip:** Generate a strong `JWT_SECRET` with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

---

## Step 5 — Install Dependencies

**Backend:**

```bash
cd /opt/embr3/water-quality-monitoring/app/server
npm ci
```

**Frontend:**

```bash
cd /opt/embr3/water-quality-monitoring/app/front-end
npm ci
```

---

## Step 6 — Build the Frontend

Build with the production subpath:

```bash
cd /opt/embr3/water-quality-monitoring/app/front-end
VITE_API_BASE_URL=/water-quality-monitoring/api npm run build
```

If Cesium Ion terrain and OSM buildings should be enabled, include the token:

```bash
VITE_API_BASE_URL=/water-quality-monitoring/api \
VITE_CESIUM_ION_TOKEN=your-ion-token \
npm run build
```

Copy the build output to the web root:

```bash
rsync -a --delete dist/ /var/www/embr3/water-quality-monitoring/
```

---

## Step 7 — Configure Nginx

Check if an existing server block already handles `server_name 72.61.125.232`.

```bash
grep -r "server_name" /etc/nginx/sites-enabled/
```

### Option A — No existing block for this IP

Create a new config file:

```bash
nano /etc/nginx/sites-available/embr3-wqms.conf
```

Paste:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 72.61.125.232;

    root /var/www/html;

    # Redirect bare path to trailing slash
    location = /water-quality-monitoring {
        return 301 /water-quality-monitoring/;
    }

    # API proxy — must appear before the frontend location
    location /water-quality-monitoring/api/ {
        proxy_pass         http://127.0.0.1:5002/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Frontend static files
    location /water-quality-monitoring/ {
        alias /var/www/embr3/water-quality-monitoring/;
        try_files $uri $uri/ /water-quality-monitoring/index.html;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/embr3-wqms.conf \
           /etc/nginx/sites-enabled/embr3-wqms.conf
sudo nginx -t
sudo systemctl reload nginx
```

### Option B — An existing server block already uses this IP

Do **not** create a second `server { ... }` block with the same `server_name`. Instead, open the existing config:

```bash
# Find which config file owns the existing server block
grep -rl "server_name 72.61.125.232" /etc/nginx/sites-enabled/
```

Add only the three `location` blocks from Option A inside the existing `server { ... }` block. Do not change the existing `root`, `listen`, or other `location` entries.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 8 — Start the Backend with PM2

```bash
cd /opt/embr3/water-quality-monitoring/app/server
pm2 start server.js --name embr3-wqms-api
pm2 save
```

If this is the first PM2 app on this server, also run:

```bash
pm2 startup
```

Follow the exact command that `pm2 startup` prints. Since other PM2 apps are already running and saved, `pm2 save` will include this new process in the saved list without removing the others.

Verify the new process is running alongside the existing ones:

```bash
pm2 status
```

You should see `embr3-wqms-api` with status `online` while all other processes remain unchanged.

---

## Step 9 — Health Check

Test the API through Nginx:

```bash
curl http://72.61.125.232/water-quality-monitoring/api/health
```

Expected:

```json
{ "status": "OK", "message": "Water Quality Monitoring API is running" }
```

Test the frontend:

```bash
curl -I http://72.61.125.232/water-quality-monitoring/
```

Expected:

```
HTTP/1.1 200 OK
```

Open in a browser:

```
http://72.61.125.232/water-quality-monitoring/
```

---

## Step 10 — Firewall

The backend port `5002` must **not** be exposed publicly. Only expose Nginx:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

If UFW was already enabled by another app's deployment, just verify port `5002` is not listed as allowed.

---

## Updating the App

Pull the latest code and rebuild:

```bash
cd /opt/embr3/water-quality-monitoring/app
git pull

# Update backend
cd server
npm ci
pm2 restart embr3-wqms-api

# Rebuild frontend
cd ../front-end
npm ci
VITE_API_BASE_URL=/water-quality-monitoring/api npm run build
rsync -a --delete dist/ /var/www/embr3/water-quality-monitoring/

# Reload Nginx (no config change needed for code updates)
sudo nginx -t
sudo systemctl reload nginx
```

---

## Logs

```bash
# Live logs for this app only
pm2 logs embr3-wqms-api

# Tail recent log lines
pm2 logs embr3-wqms-api --lines 100

# Nginx access / error logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

---

## Troubleshooting

### API calls return HTML or `Unexpected token '<'`

Nginx is serving the React app for API routes. Confirm the API location block exists **before** the frontend location block in the server config:

```nginx
location /water-quality-monitoring/api/ {
    proxy_pass http://127.0.0.1:5002/api/;
}
```

Then reload Nginx.

### 3D map shows no MapTiler imagery

- Confirm `MAPTILER_API_KEY` is set in `server/.env`.
- Restart: `pm2 restart embr3-wqms-api`
- After logging in, test: `GET /water-quality-monitoring/api/water/maptiler-key`

### MongoDB connection errors

```bash
pm2 logs embr3-wqms-api
systemctl status mongod
```

If MongoDB is not installed locally and you are using Atlas, verify the `MONGO_URI` value in `server/.env` and that the VPS IP is whitelisted in the Atlas network access list.

### Port conflict

```bash
ss -tlnp | grep 5002
```

If another process owns port `5002`, update `PORT` in `server/.env` and the `proxy_pass` address in the Nginx config, then restart both:

```bash
pm2 restart embr3-wqms-api
sudo systemctl reload nginx
```

### Accidentally modified another PM2 process

Restore from the last saved PM2 list:

```bash
pm2 resurrect
```

---

## Quick Reference

| Item | Value |
|---|---|
| GitHub repo | https://github.com/fons-sabalbosajr/water-quality-monitoring.git |
| App clone path | `/opt/embr3/water-quality-monitoring/app` |
| Web root | `/var/www/embr3/water-quality-monitoring/` |
| Backend port | `5002` |
| PM2 process name | `embr3-wqms-api` |
| Nginx config | `/etc/nginx/sites-available/embr3-wqms.conf` |
| App URL | `http://72.61.125.232/water-quality-monitoring/` |
| API health | `http://72.61.125.232/water-quality-monitoring/api/health` |
