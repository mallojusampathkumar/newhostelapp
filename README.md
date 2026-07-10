# 🏠 StaySathi — Hostel · PG · Flat · Apartment Manager

**Your property, your language, one tap.**

StaySathi is a full-stack property management app built for Indian hostel owners, PG owners,
flat owners and similar businesses. It is designed so that **even a first-time smartphone user
can run their business with it** — everything is big, colourful, icon-driven bubbles instead of
menus and tables.

## ✨ The Bubble Interface

The whole app works like tapping bubbles:

```
🙍 Owner bubble
   └── 🏨 Property bubbles (one per hostel/building, PIN-lockable 🔒)
         └── 🪜 Floor bubbles
               └── 🚪 Room bubbles  (🟢 has space · 🔵 full · 🔴 rent due)
                     └── 🛏️ Bed bubbles (🟢 vacant · 🧑 tenant, with paid/pending status)
                           └── Tenant card → Collect rent · WhatsApp remind · Call · Vacate
```

A property can be locked with a **4-digit PIN** — the app shows a big phone-style PIN pad
every time that property is opened.

## 🚀 Features

| Area | What you get |
|------|--------------|
| 🫧 Navigation | Bubble drill-down: property → floor → room → bed → tenant |
| 🔒 Privacy | Optional per-property PIN with on-screen PIN pad |
| 🧑 Tenants | Add/edit/vacate/move tenants, deposits, KYC (Aadhaar/ID) status |
| 💰 Rent | Automatic month-wise dues engine, multi-month collection, cash/UPI/bank, receipts |
| 📲 Reminders | One-tap polite WhatsApp rent reminder with pending months & amount |
| 🧾 Expenses | Electricity, water, groceries, repairs, WiFi, salary categories |
| 📊 Reports | 6-month income vs expense chart, monthly profit |
| 🛠️ Complaints | Log, track (open → working → solved) |
| 📢 Notice board | Post notices per property or for all |
| 🧹 Staff | Cook/watchman/cleaner/warden with salaries |
| ⚡ Meters | Electricity meter readings with automatic bill calculation |
| 🕓 Activity | Live feed of everything that happens |
| 🎬 Tutorials | Built-in animated "how to use" guides for every core action |
| 🗣️ Languages | English, हिंदी, తెలుగు, தமிழ், ಕನ್ನಡ, मराठी — switch anytime |
| 🎨 Themes | 6 live themes — Daylight, Midnight (dark), Ocean, Sunset, Forest, Royal (dark) — synced to your profile |
| 🔍 Global search | Spotlight-style search (`/` or Ctrl+K): find any tenant by name, phone or room and act instantly |
| 🤖 Sathi insights | Daily greeting, animated collection-rate ring, occupancy and a smart "what to do next" tip |
| 🎉 Celebrations | Confetti when rent is collected, animated count-up money figures, shimmer loading skeletons |

## 🏃 Run it

```bash
npm run setup    # installs server + client deps
npm run build    # builds the React frontend
npm start        # serves API + app on http://localhost:5050
```

For development with hot reload:

```bash
npm run dev:server   # API on :5050
npm run dev:client   # Vite dev server on :5173 (proxies /api)
```

### Demo account

The server seeds a ready-to-explore demo on first start:

- **Phone:** `9876543210`  ·  **Password:** `demo123`
- 3 properties (hostel + ladies PG + flats), floors, rooms, beds, 18 tenants,
  months of payments, expenses, complaints, staff, meter readings
- The first property (**Sri Sai Boys Hostel**) is PIN-locked — PIN **1234**

## 🧱 Tech

- **Backend:** Node.js + Express, JSON-file datastore (zero native dependencies),
  scrypt-hashed passwords & PINs, HMAC session tokens — `server/`
- **Frontend:** React 18 + Vite, hand-rolled glassmorphism design system,
  no UI framework — `client/`
- The Express server also serves the built frontend, so one process runs the whole site.

## 🚢 Deployment & DevOps

The whole app ships as **one container** — Express serves both the API and the
built React frontend. Data is a JSON file, so the only production requirement is
a **persistent volume** mounted at `DATA_DIR` (defaults to `/data` in the image);
without it, the filesystem is ephemeral and data is lost on restart.

### Configuration (env vars)

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `5050` | Host injects its own; app respects it |
| `DATA_DIR` | `server/data` | Point at a mounted volume in prod (e.g. `/data`) |
| `ADMIN_PHONE` | `9999999999` | Seeded admin — **change in prod** |
| `ADMIN_PASSWORD` | `admin123` | Seeded admin — **change in prod** |
| `APP_VERSION` | `1.0.0` | Reported by `GET /health`; CI sets it to the commit SHA |

Copy `.env.example` → `.env` for local runs. `.env` is gitignored.

### Health check

`GET /health` (aliases `/healthz`, `/api/health`) → `{"status":"ok",...}`.
Used by the Docker `HEALTHCHECK` and by Render/Fly/Railway probes.

### Run with Docker (local, production-parity)

```bash
docker compose up --build      # http://localhost:5050
```

Data persists in the `staysathi-data` named volume across restarts.

### Deploy to a host (data-safe, cheap)

| Host | IaC file | Persistence |
|------|----------|-------------|
| **Render** (recommended) | `render.yaml` | 1 GB disk at `/data` |
| **Fly.io** (cheapest) | `fly.toml` | Fly volume at `/data` |

**Render:** New + → Blueprint → pick this repo. Set `ADMIN_PHONE` /
`ADMIN_PASSWORD` as secret env vars in the dashboard. Auto-deploys on push.

**Fly.io:**

```bash
fly launch --no-deploy
fly volume create staysathi_data --size 1 --region sin
fly secrets set ADMIN_PHONE=... ADMIN_PASSWORD=...
fly deploy
```

> ⚠️ Truly-free tiers (Render free, Vercel, Netlify) use ephemeral or read-only
> disks and will silently lose data with the JSON store. Use a host with a
> persistent volume, or migrate the datastore to Postgres first.

### CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** — on every push/PR: installs deps, builds the
  frontend, boots the server and asserts `/health`, then builds the Docker image
  and smoke-tests the running container.
- **`.github/workflows/deploy.yml`** — on push to `main`: builds and pushes a
  versioned image to **GHCR** (`ghcr.io/<owner>/<repo>`), then triggers a Render
  deploy if a `RENDER_DEPLOY_HOOK_URL` secret is set.

### Repo layout (DevOps additions)

```
Dockerfile              multi-stage build (client → slim runtime, non-root, healthcheck)
.dockerignore
docker-compose.yml      local run + persistent volume
render.yaml             Render blueprint (IaC) with 1 GB disk
fly.toml                Fly.io config with volume
.env.example            documented configuration
.github/workflows/      ci.yml + deploy.yml
```
