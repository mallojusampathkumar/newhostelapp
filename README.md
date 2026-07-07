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
