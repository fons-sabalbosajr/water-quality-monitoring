# Hostinger KVM 2 VPS Deployment Guide

Target server example:

```text
Ubuntu 24.04 LTS
Public IPv4: 72.61.125.232
App path: /water-quality-monitoring/
```

This guide keeps EMBR3-WQMS isolated from other systems on the VPS by using its own directories, backend port, PM2 process name, and Nginx location blocks.

## Directory Plan

Use these directories:

```bash
/opt/embr3/water-quality-monitoring/app        # source checkout
/var/www/embr3/water-quality-monitoring        # built frontend files
/var/log/embr3/water-quality-monitoring        # optional app logs
/etc/nginx/sites-available/embr3-wqms.conf     # nginx config
```

Use backend port `5002` to avoid colliding with other apps.

## 1. System Packages

```bash
sudo apt update
sudo apt install -y nginx git curl build-essential
```

Install Node.js 22 LTS-compatible packages:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Install PM2:

```bash
sudo npm install -g pm2
```

Install MongoDB if this VPS will host its own database. If you use MongoDB Atlas or another existing MongoDB server, skip local MongoDB and set `MONGO_URI` accordingly.

## 2. Create App Directories

```bash
sudo mkdir -p /opt/embr3/water-quality-monitoring
sudo mkdir -p /var/www/embr3/water-quality-monitoring
sudo mkdir -p /var/log/embr3/water-quality-monitoring
```

If deploying as root, ownership changes are optional. If using a deploy user:

```bash
sudo chown -R $USER:$USER /opt/embr3/water-quality-monitoring
sudo chown -R $USER:$USER /var/www/embr3/water-quality-monitoring
sudo chown -R $USER:$USER /var/log/embr3/water-quality-monitoring
```

## 3. Upload or Clone the App

Place the project at:

```bash
/opt/embr3/water-quality-monitoring/app
```

Example:

```bash
cd /opt/embr3/water-quality-monitoring
git clone <your-repository-url> app
cd app
```

If you upload files manually, keep the same layout:

```text
app/front-end
app/server
app/scripts
```

## 4. Backend Environment

Create:

```bash
nano /opt/embr3/water-quality-monitoring/app/server/.env
```

Example:

```env
NODE_ENV=production
PORT=5002
MONGO_URI=mongodb://127.0.0.1:27017/embr3_wqms
JWT_SECRET=replace-with-a-long-random-secret
MAPTILER_API_KEY=replace-if-available
```

> AI forecasting now runs entirely in the browser using a Prophet-style additive
> model (linear trend + seasonal decomposition + widening confidence band). No
> external AI API key is required. The legacy `GEMINI_API_KEY` / `GEMINI_MODEL`
> variables are optional and only affect the `/api/water/forecast/status`
> diagnostic endpoint — they are not needed for forecasts to work.

If email features are used:

```env
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=user@example.com
EMAIL_PASS=secret
EMAIL_FROM="EMBR3-WQMS <user@example.com>"
```

## 5. Install Dependencies and Build

Backend:

```bash
cd /opt/embr3/water-quality-monitoring/app/server
npm ci
```

Frontend:

```bash
cd /opt/embr3/water-quality-monitoring/app/front-end
npm ci
VITE_API_BASE_URL=/water-quality-monitoring/api npm run build
```

If terrain and OSM buildings should be enabled in Cesium tools, build with a Cesium Ion token:

```bash
VITE_API_BASE_URL=/water-quality-monitoring/api VITE_CESIUM_ION_TOKEN=your-ion-token npm run build
```

Copy the built frontend to its own web root:

```bash
rsync -a --delete dist/ /var/www/embr3/water-quality-monitoring/
```

## 6. Start Backend with PM2

```bash
cd /opt/embr3/water-quality-monitoring/app/server
pm2 start server.js --name embr3-wqms-api
pm2 save
pm2 startup
```

Follow the command printed by `pm2 startup`.

Check status:

```bash
pm2 status
pm2 logs embr3-wqms-api
```

## 7. Nginx Configuration

Create:

```bash
sudo nano /etc/nginx/sites-available/embr3-wqms.conf
```

Use a dedicated subpath so other systems can continue using their own directories and ports:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 72.61.125.232;

    root /var/www/html;

    location = /water-quality-monitoring {
        return 301 /water-quality-monitoring/;
    }

    location /water-quality-monitoring/api/ {
        proxy_pass http://127.0.0.1:5002/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /water-quality-monitoring/ {
        alias /var/www/embr3/water-quality-monitoring/;
        try_files $uri $uri/ /water-quality-monitoring/index.html;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/embr3-wqms.conf /etc/nginx/sites-enabled/embr3-wqms.conf
sudo nginx -t
sudo systemctl reload nginx
```

If an existing Nginx server block already handles the same IP or domain, merge only the three `location` blocks into that existing server block instead of creating a duplicate `server_name`.

## 8. Firewall

Keep the backend port private. Only expose Nginx:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Do not open port `5002` publicly unless there is a specific operational need.

## 9. Health Checks

Backend through Nginx:

```bash
curl http://72.61.125.232/water-quality-monitoring/api/health
```

Frontend:

```bash
curl -I http://72.61.125.232/water-quality-monitoring/
```

Expected:

```text
HTTP/1.1 200 OK
```

## 10. Updates

```bash
cd /opt/embr3/water-quality-monitoring/app
git pull

cd server
npm ci
pm2 restart embr3-wqms-api

cd ../front-end
npm ci
VITE_API_BASE_URL=/water-quality-monitoring/api npm run build
rsync -a --delete dist/ /var/www/embr3/water-quality-monitoring/

sudo nginx -t
sudo systemctl reload nginx
```

## 11. Troubleshooting

If API calls return HTML or `Unexpected token '<'`, Nginx is serving the React app for an API route. Confirm this block exists before the frontend fallback:

```nginx
location /water-quality-monitoring/api/ {
    proxy_pass http://127.0.0.1:5002/api/;
}
```

If the 3D map does not show MapTiler imagery:

- Confirm `MAPTILER_API_KEY` exists in `server/.env`.
- Restart PM2: `pm2 restart embr3-wqms-api`.
- Check `GET /water-quality-monitoring/api/water/maptiler-key` after login.

If forecast features fail:

- AI forecasts are computed client-side (in-browser), so they do not depend on
  any server AI key. Confirm the dashboard, public dashboard, and tabular
  forecast panels render without backend AI configuration.
- The forecast horizon (1–3 months) is set in **Developer Manager → AI Forecast**
  and applies immediately across all forecast charts and menus.
- The legacy `GEMINI_API_KEY` only affects the optional
  `/water-quality-monitoring/api/water/forecast/status` diagnostic.

If MongoDB fails:

```bash
pm2 logs embr3-wqms-api
systemctl status mongod
```

If another app already uses `/api`, this app should still work because production frontend calls `/water-quality-monitoring/api`, and Nginx proxies only that subpath to the WQMS backend.
