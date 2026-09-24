# 1 ON 1 Showdown Faisalabad — Official Tournament Platform

A full-stack tournament management platform for the Faisalabad 1v1 Football Showdown.  
**Frontend** hosted on Netlify · **Backend + Database** hosted on Render.

---

## Architecture

```
Browser  ──→  Netlify (index.html, /assets/*)
               │
               │  /api/* proxy (same-origin, zero CORS)
               ▼
             Render Web Service  (Node.js / Express)
               │
               ▼
             Render PostgreSQL  (faisalabad_1v1)
```

---

## Production Deployment (Netlify + Render)

### Step 1 — Push to GitHub

Make sure your code is committed and pushed to a GitHub repository.

```powershell
git add .
git commit -m "ready for deploy"
git push origin main
```

---

### Step 2 — Deploy Backend on Render

1. Go to **https://dashboard.render.com** → **New** → **Blueprint**
2. Connect your GitHub repo — Render detects `render.yaml` automatically
3. Render will create:
   - **Web service** `1v1-faisalabad-api` (Node.js)
   - **PostgreSQL database** `1v1-faisalabad-db`
4. In the Render dashboard, fill in the **secret environment variables** (marked `sync: false`):

| Variable | Value |
|---|---|
| `CORS_ORIGINS` | Your Netlify URL (fill in **after** Netlify deploy, see Step 4) |
| `TOURNAMENT_API_KEY` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SEED_ADMIN_EMAIL` | `towncleats@gmail.com` (your admin Gmail) |
| `SEED_ADMIN_PASSWORD` | A strong password — this is your **Admin Panel login** |

5. Click **Apply / Deploy**
6. The build command automatically runs:
   - `npm ci` — installs packages
   - `node backend/db/migrate.js` — creates all database tables
   - `node backend/db/seed.js` — creates your admin user
7. Wait for **"Live"** status on the Render dashboard
8. **Copy the service URL** — it looks like `https://1v1-faisalabad-api.onrender.com`

> **Free tier note:** Render free web services sleep after 15 minutes of inactivity and take ~30s to wake up on the first request. Upgrade to **Starter ($7/mo)** for always-on. The free Postgres DB expires after **90 days** — upgrade to Starter DB ($7/mo) for persistent storage.

---

### Step 3 — Deploy Frontend on Netlify

1. Go to **https://app.netlify.com** → **Add new site** → **Import an existing project**
2. Connect your GitHub repo
3. Netlify auto-detects `netlify.toml`. The settings are:
   - **Base directory:** *(leave blank)*
   - **Build command:** `node scripts/inject-api-url.js`
   - **Publish directory:** `frontend`
4. Before the first deploy, go to **Site configuration → Environment variables** and add:

| Variable | Value |
|---|---|
| `API_URL` | Your Render service URL, e.g. `https://1v1-faisalabad-api.onrender.com` |

5. Click **Deploy site**
6. **Copy your Netlify URL** — it looks like `https://1v1-showdown.netlify.app`

---

### Step 4 — Connect Backend CORS to Netlify

1. Go back to **Render dashboard** → your web service → **Environment**
2. Set `CORS_ORIGINS` = your Netlify URL (e.g. `https://1v1-showdown.netlify.app`)
3. Click **Save Changes** — Render redeploys automatically

---

### Step 5 — Verify Everything Works

1. Open your Netlify URL in a browser
2. The site should load with the tournament homepage
3. Click **Player Login** — enter your `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`
4. You should land on the **Admin Panel** — you can now add players, schedule matches, etc.

If the page loads but login fails, check:
- `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are set correctly in Render
- The Render build log shows `Seeded development admin: ...` without errors
- `CORS_ORIGINS` in Render matches your exact Netlify URL (no trailing slash)

---

## Custom Domain (Optional)

1. In Netlify: **Domain management** → **Add custom domain** → enter your domain
2. Follow Netlify's DNS instructions to point your domain to Netlify
3. Netlify provisions a free HTTPS certificate automatically
4. Update `CORS_ORIGINS` in Render to use your custom domain instead of `.netlify.app`

---

## How the Admin Creates Players

Since public self-registration is **disabled**, the workflow is:

1. Admin logs into the Admin Panel
2. Go to **Manage Players** → **Add New Player**
3. Fill in the player's name, Gmail address, phone, keeper preference
4. Set a **Login Password** (min 8 characters)
5. Save — the player is created in the database with login credentials
6. **Share** the Gmail + password with the player via WhatsApp or SMS
7. Player visits the site → **Player Login** → enters their credentials → accesses their dashboard

---

## Local Development

```powershell
# 1. Clone and install
npm install

# 2. Copy env file and fill in values
Copy-Item .env.example .env
# Edit .env: set POSTGRES_PASSWORD, TOURNAMENT_API_KEY, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD

# 3. Start local PostgreSQL (requires Docker)
docker compose up -d postgres

# 4. Run database migrations
npm run db:migrate

# 5. Create the admin user
npm run db:seed

# 6. Start the backend (serves both API and frontend)
npm run dev
# Open http://localhost:4000
```

---

## Environment Variables Reference

### Render (Backend)

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `APP_ENV` | Yes | `production` |
| `API_PORT` | Yes | `4000` |
| `DATABASE_URL` | Yes | Auto-injected by Render |
| `DATABASE_SSL` | Yes | `true` |
| `DATABASE_POOL_MAX` | Yes | `5` |
| `CORS_ORIGINS` | Yes | Your Netlify URL |
| `TOURNAMENT_API_KEY` | Yes | Random 32-byte hex key |
| `SEED_ADMIN_EMAIL` | Yes | Admin login email |
| `SEED_ADMIN_PASSWORD` | Yes | Admin login password |
| `SMTP_HOST` | No | Gmail SMTP for email notifications |
| `SMTP_PORT` | No | `587` |
| `SMTP_USER` | No | Gmail address |
| `SMTP_PASS` | No | Gmail App Password |
| `ADMIN_WHATSAPP` | No | `923045534884` |

### Netlify (Frontend Build)

| Variable | Required | Description |
|---|---|---|
| `API_URL` | Yes | Your Render service URL |

---

## Project Structure

```
├── frontend/
│   ├── index.html       # Full single-page app (served by Netlify)
│   ├── UI.html          # Identical copy (served by Render's static file server)
│   └── assets/          # Logo and poster images
├── backend/
│   ├── server.js        # Express API (all routes)
│   ├── auth.js          # Password hashing, sessions
│   ├── db/
│   │   ├── index.js     # PostgreSQL pool
│   │   ├── migrate.js   # Migration runner
│   │   ├── seed.js      # Admin user seeder
│   │   ├── store.js     # In-memory fallback store
│   │   └── migrations/  # SQL migration files (001–008)
│   └── ...
├── scripts/
│   └── inject-api-url.js  # Netlify build: replaces __API_URL__ in HTML
├── netlify.toml           # Netlify build + proxy + headers config
├── render.yaml            # Render one-click deploy config
└── .env.example           # Template for local development
```
