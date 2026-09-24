# 1 ON 1 Showdown Faisalabad — Official Tournament Platform

A full-stack tournament management platform for the Faisalabad 1v1 Football Showdown.  
**Frontend** → Netlify (free, no card) · **Backend** → Railway (free, no card) · **Database** → Neon (free, no card)

---

## Architecture

```
Browser  ──→  Netlify  (index.html, static assets)
               │
               │  /api/* proxy — same domain, zero CORS
               ▼
             Railway  (Node.js / Express backend)
               │
               ▼
             Neon  (PostgreSQL database — persistent, survives restarts)
```

---

## Production Deployment — No Card Required

### Overview
| Service | Purpose | Cost | Card? |
|---|---|---|---|
| **GitHub** | Code hosting | Free | No |
| **Neon** | PostgreSQL database | Free | No |
| **Railway** | Node.js backend | Free | No |
| **Netlify** | Frontend (HTML) | Free | No |

---

## STEP 1 — Create the Database on Neon

1. Go to **https://neon.tech** → **Sign Up** with Google or GitHub (no card)
2. Click **Create Project**
   - **Project name:** `1v1-showdown`
   - **Region:** `AWS ap-southeast-1` (Singapore — closest to Pakistan)
   - Click **Create project**
3. On the dashboard you'll see a **Connection string** — click **Copy**
   - It looks like: `postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
4. **Save this string** — you'll need it in Step 2

---

## STEP 2 — Deploy Backend on Railway

1. Go to **https://railway.app** → **Login with GitHub** (no card)
2. Click **New Project → Deploy from GitHub repo**
3. Select `marehman-exe/1v1-showdown-faisalabad`
4. Railway detects `railway.toml` automatically
5. Click on the created service → go to **Variables** tab → add these:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ENV` | `production` |
| `API_PORT` | `4000` |
| `DATABASE_URL` | *(paste the Neon connection string from Step 1)* |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `5` |
| `CORS_ORIGINS` | *(leave blank for now — fill after Step 3)* |
| `TOURNAMENT_API_KEY` | `showdown2026securekey` |
| `SEED_ADMIN_EMAIL` | `towncleats@gmail.com` |
| `SEED_ADMIN_PASSWORD` | *(your chosen Admin Panel password)* |

6. Click **Deploy** — Railway runs `npm ci`, migrations, and seeds the admin user
7. Once deployed, go to **Settings → Networking → Generate Domain**
8. **Copy the Railway URL** — looks like `https://1v1-showdown-faisalabad.up.railway.app`

---

## STEP 3 — Deploy Frontend on Netlify

1. Go to **https://app.netlify.com** → **Add new site → Import an existing project → GitHub**
2. Select `marehman-exe/1v1-showdown-faisalabad`
3. Netlify reads `netlify.toml` automatically — settings are pre-filled
4. Before deploying, go to **Environment variables** and add:

| Variable | Value |
|---|---|
| `API_URL` | Your Railway URL from Step 2 (e.g. `https://1v1-showdown-faisalabad.up.railway.app`) |

5. Click **Deploy site**
6. **Copy your Netlify URL** — looks like `https://1v1-showdown.netlify.app`

---

## STEP 4 — Connect CORS

1. Go back to **Railway → your service → Variables**
2. Set `CORS_ORIGINS` = your Netlify URL (e.g. `https://1v1-showdown.netlify.app`)
3. Railway redeploys automatically

---

## STEP 5 — Test

1. Open your Netlify URL in the browser
2. Click **Player Login**
3. Enter `towncleats@gmail.com` + your admin password
4. You should land on the **Admin Panel**
5. Go to **Manage Players → Add New Player** — add a player, set their password
6. Log out → log back in as that player to confirm it works

---

## How Admin Creates Players (No Public Registration)

1. Admin logs in → **Admin Panel → Manage Players → Add New Player**
2. Fill in name, Gmail, phone, goalkeeper preference
3. Set a **Login Password** (min 8 characters)
4. Click **Save Player & Credentials**
5. **WhatsApp or SMS the player** their Gmail + password
6. Player visits the Netlify URL → **Player Login** → enters credentials → sees their dashboard

---

## Local Development

```powershell
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your values
Copy-Item .env.example .env
# Edit .env — set DATABASE_URL (from Neon), SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD

# 3. Run database migrations
npm run db:migrate

# 4. Seed the admin user
npm run db:seed

# 5. Start the backend (serves API + frontend on port 4000)
npm run dev
# Open http://localhost:4000
```

---

## Environment Variables Reference

### Railway / Backend

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `APP_ENV` | Yes | `production` |
| `API_PORT` | Yes | `4000` |
| `DATABASE_URL` | Yes | Neon connection string |
| `DATABASE_SSL` | Yes | `true` |
| `DATABASE_POOL_MAX` | Yes | `5` |
| `CORS_ORIGINS` | Yes | Your Netlify URL |
| `TOURNAMENT_API_KEY` | Yes | Any secret string |
| `SEED_ADMIN_EMAIL` | Yes | Admin login email |
| `SEED_ADMIN_PASSWORD` | Yes | Admin login password |
| `SMTP_HOST` | No | `smtp.gmail.com` (for email alerts) |
| `SMTP_PORT` | No | `587` |
| `SMTP_USER` | No | Your Gmail |
| `SMTP_PASS` | No | Gmail App Password |
| `ADMIN_WHATSAPP` | No | `923045534884` |

### Netlify / Frontend Build

| Variable | Required | Description |
|---|---|---|
| `API_URL` | Yes | Your Railway service URL |

---

## Project Structure

```
├── frontend/
│   ├── index.html          # Full single-page app (Netlify)
│   ├── UI.html             # Identical copy (Railway static fallback)
│   └── assets/             # Logo and poster images
├── backend/
│   ├── server.js           # Express API — all routes
│   ├── auth.js             # Password hashing, sessions
│   ├── db/
│   │   ├── index.js        # PostgreSQL pool (Neon-compatible)
│   │   ├── migrate.js      # Migration runner
│   │   ├── seed.js         # Admin user seeder
│   │   ├── store.js        # In-memory fallback (offline mode)
│   │   └── migrations/     # SQL files 001–008
│   └── ...
├── scripts/
│   └── inject-api-url.js   # Netlify build: injects API_URL into HTML
├── railway.toml            # Railway deployment config
├── netlify.toml            # Netlify build + proxy + headers
├── render.yaml             # Render deployment config (alternative)
└── .env.example            # Local development template
```
