// StaySathi — backend for hostel / PG / flat / apartment owners.
// Express + JSON-file datastore (no native deps, runs anywhere).
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 5050;

store.load();
const db = store.db;
if (!db.secret) { db.secret = crypto.randomBytes(32).toString('hex'); store.save(); }

app.use(express.json({ limit: '15mb' }));

// permissive CORS so the Vite dev server / mobile shells can call us
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// health check — used by the Docker HEALTHCHECK, Render/Railway/Fly probes and
// load balancers. Cheap, unauthenticated, performs no DB writes.
const STARTED_AT = Date.now();
app.get(['/health', '/healthz', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round((Date.now() - STARTED_AT) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0'
  });
});

/* ---------------- auth helpers ---------------- */

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}
function makeToken(userId) {
  const payload = `${userId}.${Date.now() + 1000 * 60 * 60 * 24 * 30}`; // 30 days
  const sig = crypto.createHmac('sha256', db.secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}
function readToken(token) {
  try {
    const raw = Buffer.from(token, 'base64url').toString();
    const [userId, exp, sig] = raw.split('.');
    const check = crypto.createHmac('sha256', db.secret).update(`${userId}.${exp}`).digest('hex');
    if (sig !== check || Date.now() > Number(exp)) return null;
    return userId;
  } catch { return null; }
}
// login check only — used by /api/me and admin routes so a blocked owner can
// still see WHY they are blocked
function authAny(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const userId = readToken(token);
  const user = userId && db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Please login again' });
  req.user = user;
  next();
}

function isReadonly(u) {
  if (u.role === 'admin') return false;
  if (u.plan === 'premium') return u.planExpiresAt ? new Date(u.planExpiresAt) < new Date() : false;
  return u.trialEndsAt ? new Date(u.trialEndsAt) < new Date() : false;
}
function userAccess(u) {
  const readonly = isReadonly(u);
  const status = u.status || 'active';
  let daysLeft = null;
  const until = u.plan === 'premium' ? u.planExpiresAt : u.trialEndsAt;
  if (until) daysLeft = Math.ceil((new Date(until) - Date.now()) / 86400000);
  return { status, readonly, daysLeft, plan: u.plan || 'free' };
}

// full guard: logged in + approved + not blocked; writes need an active plan/trial
function auth(req, res, next) {
  authAny(req, res, () => {
    const u = req.user;
    if (u.role === 'admin') return next();
    const status = u.status || 'active';
    if (status === 'blocked') return res.status(403).json({ error: 'Your account has been blocked. Please contact support.', code: 'blocked' });
    if (status === 'pending') return res.status(403).json({ error: 'Your account is waiting for admin approval.', code: 'pending' });
    if (status === 'rejected') return res.status(403).json({ error: 'Your account was not approved. Please contact support.', code: 'blocked' });
    if (req.method !== 'GET' && isReadonly(u)) {
      return res.status(403).json({ error: 'Your plan has expired — the app is in read-only mode. Upgrade to continue.', code: 'readonly' });
    }
    next();
  });
}

function adminOnly(req, res, next) {
  authAny(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
    next();
  });
}

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return { ...rest, access: userAccess(u) };
}
function logActivity(ownerId, propertyId, icon, text) {
  db.activities.unshift({ id: store.id('act'), ownerId, propertyId: propertyId || null, icon, text, createdAt: new Date().toISOString() });
  if (db.activities.length > 500) db.activities.length = 500;
  store.save();
}
function ensurePortalToken(tenant) {
  if (!tenant.portalToken) {
    tenant.portalToken = crypto.randomBytes(12).toString('base64url');
    store.save();
  }
  return tenant.portalToken;
}

/* ---------------- dues engine (money ledger) ---------------- */
// Billing cycles are anchored to the tenant's JOIN DAY: a fresh rent charge
// (rent + maintenance) is raised every month on that day, starting from the
// join date. Money received is applied to the OLDEST charge first (FIFO), so
// a partial payment always clears previous dues before the current month —
// and a half-paid month stays visibly pending instead of showing "cleared".
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en', { month: 'short', year: '2-digit' });
}

// start date of the tenant's Nth billing cycle (day clamped to month length)
function cycleStart(join, index) {
  const d = new Date(join.getFullYear(), join.getMonth() + index, 1);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(join.getDate(), daysInMonth));
  return d;
}

// every charge the tenant has accrued so far: opening balance (imported old
// dues) + one rent charge per started billing cycle up to today / leave date
function tenantCharges(tenant, now = new Date()) {
  const join = new Date(`${tenant.joinDate}T00:00:00`);
  if (isNaN(join) || join > now) return [];
  let end = now;
  if (tenant.leaveDate) {
    const leave = new Date(`${tenant.leaveDate}T23:59:59`);
    if (!isNaN(leave) && leave < end) end = leave;
  }
  const charges = [];
  const opening = Number(tenant.openingDue) || 0;
  if (opening > 0) {
    charges.push({ month: 'opening', label: 'Old balance', amount: opening, opening: true });
  }
  const perCycle = (Number(tenant.rent) || 0) + (Number(tenant.maintenance) || 0);
  for (let i = 0; i < 1200; i++) {
    const start = cycleStart(join, i);
    if (start > end) break;
    charges.push({ month: monthKey(start), label: monthLabel(monthKey(start)), amount: perCycle, start });
  }
  return charges;
}

function tenantPaidTotal(tenant) {
  return db.payments
    .filter(p => p.tenantId === tenant.id && (p.type || 'rent') === 'rent')
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
}

function tenantDues(tenant, now = new Date()) {
  const charges = tenantCharges(tenant, now);
  const totalPaid = tenantPaidTotal(tenant);
  let pool = totalPaid;
  const breakdown = charges.map(c => {
    const applied = Math.min(pool, c.amount);
    pool -= applied;
    const due = c.amount - applied;
    return {
      month: c.month, label: c.label, opening: !!c.opening,
      charged: c.amount, paid: applied, due,
      status: due <= 0 ? 'paid' : applied > 0 ? 'partial' : 'due'
    };
  });
  const totalCharged = charges.reduce((a, c) => a + c.amount, 0);
  const dueAmount = Math.max(0, totalCharged - totalPaid);
  const creditBalance = Math.max(0, totalPaid - totalCharged); // wallet / extra paid
  const last = breakdown[breakdown.length - 1];
  const currentDue = last && !last.opening ? last.due : 0;
  const previousDue = dueAmount - currentDue; // arrears carried into this month
  return {
    dueAmount, creditBalance, previousDue, currentDue,
    currentMonth: last && !last.opening ? last.month : monthKey(now),
    totalCharged, totalPaid,
    monthsStayed: breakdown.filter(b => !b.opening).length,
    unpaidMonths: breakdown.filter(b => b.due > 0).map(b => b.opening ? 'old balance' : b.month),
    breakdown: breakdown.slice(-13)
  };
}

/* ---------------- notifications ---------------- */

function notify(ownerId, propertyId, kind, icon, text, dedupeKey = null) {
  if (dedupeKey && db.notifications.some(n => n.ownerId === ownerId && n.dedupeKey === dedupeKey)) return;
  db.notifications.unshift({
    id: store.id('ntf'), ownerId, propertyId: propertyId || null,
    kind, icon, text, dedupeKey, read: false, createdAt: new Date().toISOString()
  });
  if (db.notifications.length > 800) db.notifications.length = 800;
  store.save();
}

/* ---------------- stats helpers ---------------- */

function propertyStats(prop) {
  const beds = db.beds.filter(b => b.propertyId === prop.id);
  const occupied = beds.filter(b => b.tenantId).length;
  const tenants = db.tenants.filter(t => t.propertyId === prop.id && t.status === 'active');
  let dueAmount = 0, dueTenants = 0;
  const mk = monthKey(new Date());
  let collectedThisMonth = 0;
  for (const t of tenants) {
    const d = tenantDues(t);
    if (d.dueAmount > 0) { dueAmount += d.dueAmount; dueTenants++; }
  }
  for (const p of db.payments.filter(p => p.propertyId === prop.id)) {
    if ((p.date || '').startsWith(mk)) collectedThisMonth += Number(p.amount) || 0;
  }
  const openComplaints = db.complaints.filter(c => c.propertyId === prop.id && c.status !== 'resolved').length;
  return {
    totalBeds: beds.length,
    occupied,
    vacant: beds.length - occupied,
    tenants: tenants.length,
    dueAmount,
    dueTenants,
    collectedThisMonth,
    openComplaints,
    floors: db.floors.filter(f => f.propertyId === prop.id).length
  };
}

function publicProperty(p) {
  const { pinHash, ...rest } = p;
  return { ...rest, hasPin: !!pinHash, stats: propertyStats(p) };
}

/* ---------------- auth routes ---------------- */

app.get('/api/ping', (req, res) => res.json({ ok: true, app: 'StaySathi', time: new Date().toISOString() }));

app.post('/api/auth/signup', (req, res) => {
  const { name, phone, password, email, businessType, language } = req.body || {};
  if (!name || !phone || !password) return res.status(400).json({ error: 'Name, phone and password are required' });
  if (String(phone).replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Enter a valid 10 digit phone number' });
  if (String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  if (db.users.find(u => u.phone === String(phone))) return res.status(409).json({ error: 'This phone number is already registered. Please login.' });
  const settings = db.settings || {};
  const trialDays = Number(settings.trialDays) || 30;
  const user = {
    id: store.id('usr'),
    name: String(name).trim(),
    phone: String(phone),
    email: email || '',
    businessType: businessType || 'hostel',
    language: language || 'en',
    plan: 'free',
    role: 'owner',
    status: settings.autoApprove === false ? 'pending' : 'active',
    trialEndsAt: new Date(Date.now() + trialDays * 86400000).toISOString(),
    planExpiresAt: null,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  logActivity(user.id, null, '🎉', `Welcome to StaySathi, ${user.name}!`);
  for (const admin of db.users.filter(u => u.role === 'admin')) {
    notify(admin.id, null, 'signup', '🆕', `New owner signed up: ${user.name} (${user.phone})${user.status === 'pending' ? ' — waiting for approval' : ''}`);
  }
  store.saveNow();
  res.json({ token: makeToken(user.id), user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body || {};
  const user = db.users.find(u => u.phone === String(phone));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong phone number or password' });
  }
  res.json({ token: makeToken(user.id), user: publicUser(user) });
});

app.get('/api/me', authAny, (req, res) => res.json({ user: publicUser(req.user) }));

app.put('/api/me', auth, (req, res) => {
  const { name, email, language, businessType } = req.body || {};
  if (name) req.user.name = String(name).trim();
  if (email !== undefined) req.user.email = email;
  if (language) req.user.language = language;
  if (businessType) req.user.businessType = businessType;
  store.save();
  res.json({ user: publicUser(req.user) });
});

/* ---------------- overview ---------------- */

app.get('/api/overview', auth, (req, res) => {
  const props = db.properties.filter(p => p.ownerId === req.user.id);
  const list = props.map(publicProperty);
  const totals = list.reduce((a, p) => ({
    properties: a.properties + 1,
    beds: a.beds + p.stats.totalBeds,
    occupied: a.occupied + p.stats.occupied,
    tenants: a.tenants + p.stats.tenants,
    dueAmount: a.dueAmount + p.stats.dueAmount,
    dueTenants: a.dueTenants + p.stats.dueTenants,
    collectedThisMonth: a.collectedThisMonth + p.stats.collectedThisMonth,
    openComplaints: a.openComplaints + p.stats.openComplaints
  }), { properties: 0, beds: 0, occupied: 0, tenants: 0, dueAmount: 0, dueTenants: 0, collectedThisMonth: 0, openComplaints: 0 });
  res.json({
    properties: list, totals,
    activities: db.activities.filter(a => a.ownerId === req.user.id).slice(0, 20),
    unreadNotifications: db.notifications.filter(n => n.ownerId === req.user.id && !n.read).length
  });
});

/* ---------------- properties ---------------- */

function ownProperty(req, res) {
  const prop = db.properties.find(p => p.id === req.params.id && p.ownerId === req.user.id);
  if (!prop) { res.status(404).json({ error: 'Property not found' }); return null; }
  return prop;
}

app.post('/api/properties', auth, (req, res) => {
  const { name, type, address, city, color, icon, pin, floorCount } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Property name is required' });
  const prop = {
    id: store.id('prp'),
    ownerId: req.user.id,
    name: String(name).trim(),
    type: type || 'hostel',
    address: address || '',
    city: city || '',
    color: color || '#6C5CE7',
    icon: icon || '🏠',
    pinHash: pin ? hashPassword(pin) : null,
    createdAt: new Date().toISOString()
  };
  db.properties.push(prop);
  const n = Math.min(Math.max(Number(floorCount) || 1, 1), 30);
  for (let i = 0; i < n; i++) {
    db.floors.push({ id: store.id('flr'), propertyId: prop.id, name: i === 0 ? 'Ground Floor' : `Floor ${i}`, order: i });
  }
  logActivity(req.user.id, prop.id, '🏠', `Added new property "${prop.name}"`);
  store.saveNow();
  res.json({ property: publicProperty(prop) });
});

app.put('/api/properties/:id', auth, (req, res) => {
  const prop = ownProperty(req, res); if (!prop) return;
  const { name, type, address, city, color, icon } = req.body || {};
  if (name) prop.name = String(name).trim();
  if (type) prop.type = type;
  if (address !== undefined) prop.address = address;
  if (city !== undefined) prop.city = city;
  if (color) prop.color = color;
  if (icon) prop.icon = icon;
  store.save();
  res.json({ property: publicProperty(prop) });
});

app.post('/api/properties/:id/set-pin', auth, (req, res) => {
  const prop = ownProperty(req, res); if (!prop) return;
  const { pin } = req.body || {};
  prop.pinHash = pin ? hashPassword(pin) : null;
  store.save();
  res.json({ property: publicProperty(prop) });
});

app.post('/api/properties/:id/verify-pin', auth, (req, res) => {
  const prop = ownProperty(req, res); if (!prop) return;
  if (!prop.pinHash) return res.json({ ok: true });
  if (verifyPassword(req.body?.pin, prop.pinHash)) return res.json({ ok: true });
  res.status(403).json({ error: 'Wrong PIN' });
});

app.delete('/api/properties/:id', auth, (req, res) => {
  const prop = ownProperty(req, res); if (!prop) return;
  const pid = prop.id;
  db.properties.splice(db.properties.indexOf(prop), 1);
  for (const key of ['floors', 'rooms', 'beds', 'tenants', 'payments', 'expenses', 'complaints', 'notices', 'staff', 'salaryPayments', 'meters', 'paymentClaims']) {
    db[key] = (db[key] || []).filter(x => x.propertyId !== pid);
  }
  logActivity(req.user.id, null, '🗑️', `Deleted property "${prop.name}"`);
  store.saveNow();
  res.json({ ok: true });
});

// full tree for the bubble navigator: floors → rooms → beds (+tenant summary)
app.get('/api/properties/:id/tree', auth, (req, res) => {
  const prop = ownProperty(req, res); if (!prop) return;
  const floors = db.floors.filter(f => f.propertyId === prop.id).sort((a, b) => a.order - b.order).map(floor => {
    const rooms = db.rooms.filter(r => r.floorId === floor.id).map(room => {
      const beds = db.beds.filter(b => b.roomId === room.id).map(bed => {
        const tenant = bed.tenantId ? db.tenants.find(t => t.id === bed.tenantId) : null;
        let dues = null;
        if (tenant) dues = tenantDues(tenant);
        return {
          ...bed,
          tenant: tenant ? {
            id: tenant.id, name: tenant.name, phone: tenant.phone, rent: tenant.rent,
            deposit: tenant.deposit, joinDate: tenant.joinDate, occupation: tenant.occupation,
            kycStatus: tenant.kycStatus, photo: tenant.photo || null, dues
          } : null
        };
      });
      const occupied = beds.filter(b => b.tenant).length;
      const hasDue = beds.some(b => b.tenant && b.tenant.dues.dueAmount > 0);
      return { ...room, beds, occupied, capacity: beds.length, hasDue };
    });
    return { ...floor, rooms, totalBeds: rooms.reduce((a, r) => a + r.beds.length, 0), occupied: rooms.reduce((a, r) => a + r.occupied, 0) };
  });
  res.json({ property: publicProperty(prop), floors });
});

/* ---------------- floors / rooms / beds ---------------- */

app.post('/api/properties/:id/floors', auth, (req, res) => {
  const prop = ownProperty(req, res); if (!prop) return;
  const existing = db.floors.filter(f => f.propertyId === prop.id);
  const floor = {
    id: store.id('flr'), propertyId: prop.id,
    name: req.body?.name || `Floor ${existing.length}`,
    order: existing.length
  };
  db.floors.push(floor);
  store.save();
  res.json({ floor });
});

app.delete('/api/floors/:id', auth, (req, res) => {
  const floor = db.floors.find(f => f.id === req.params.id);
  const prop = floor && db.properties.find(p => p.id === floor.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Floor not found' });
  const roomIds = db.rooms.filter(r => r.floorId === floor.id).map(r => r.id);
  const occupied = db.beds.some(b => roomIds.includes(b.roomId) && b.tenantId);
  if (occupied) return res.status(400).json({ error: 'Vacate all tenants on this floor first' });
  db.floors = db.floors.filter(f => f.id !== floor.id);
  db.rooms = db.rooms.filter(r => r.floorId !== floor.id);
  db.beds = db.beds.filter(b => !roomIds.includes(b.roomId));
  store.saveNow();
  res.json({ ok: true });
});

app.post('/api/floors/:id/rooms', auth, (req, res) => {
  const floor = db.floors.find(f => f.id === req.params.id);
  const prop = floor && db.properties.find(p => p.id === floor.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Floor not found' });
  const { name, capacity, rent } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Room name/number is required' });
  const cap = Math.min(Math.max(Number(capacity) || 1, 1), 20);
  const room = {
    id: store.id('rom'), propertyId: prop.id, floorId: floor.id,
    name: String(name).trim(), capacity: cap, rent: Number(rent) || 0,
    createdAt: new Date().toISOString()
  };
  db.rooms.push(room);
  for (let i = 0; i < cap; i++) {
    db.beds.push({ id: store.id('bed'), roomId: room.id, floorId: floor.id, propertyId: prop.id, name: `Bed ${i + 1}`, tenantId: null });
  }
  logActivity(req.user.id, prop.id, '🚪', `Added room ${room.name} (${cap} beds) in ${prop.name}`);
  store.saveNow();
  res.json({ room });
});

app.put('/api/rooms/:id', auth, (req, res) => {
  const room = db.rooms.find(r => r.id === req.params.id);
  const prop = room && db.properties.find(p => p.id === room.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Room not found' });
  const { name, rent, capacity } = req.body || {};
  if (name) room.name = String(name).trim();
  if (rent !== undefined) room.rent = Number(rent) || 0;
  if (capacity !== undefined) {
    const cap = Math.min(Math.max(Number(capacity) || 1, 1), 20);
    const beds = db.beds.filter(b => b.roomId === room.id);
    if (cap > beds.length) {
      for (let i = beds.length; i < cap; i++) db.beds.push({ id: store.id('bed'), roomId: room.id, floorId: room.floorId, propertyId: room.propertyId, name: `Bed ${i + 1}`, tenantId: null });
    } else if (cap < beds.length) {
      const removable = beds.filter(b => !b.tenantId).slice(0, beds.length - cap);
      if (beds.length - removable.length > cap) return res.status(400).json({ error: 'Cannot reduce beds below number of tenants' });
      const ids = new Set(removable.map(b => b.id));
      db.beds = db.beds.filter(b => !ids.has(b.id));
    }
    room.capacity = cap;
  }
  store.saveNow();
  res.json({ room });
});

app.delete('/api/rooms/:id', auth, (req, res) => {
  const room = db.rooms.find(r => r.id === req.params.id);
  const prop = room && db.properties.find(p => p.id === room.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Room not found' });
  if (db.beds.some(b => b.roomId === room.id && b.tenantId)) return res.status(400).json({ error: 'Vacate tenants from this room first' });
  db.rooms = db.rooms.filter(r => r.id !== room.id);
  db.beds = db.beds.filter(b => b.roomId !== room.id);
  store.saveNow();
  res.json({ ok: true });
});

/* ---------------- tenants ---------------- */

app.post('/api/beds/:id/assign', auth, (req, res) => {
  const bed = db.beds.find(b => b.id === req.params.id);
  const prop = bed && db.properties.find(p => p.id === bed.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Bed not found' });
  if (bed.tenantId) return res.status(400).json({ error: 'This bed is already occupied' });
  const { name, phone, rent, deposit, joinDate, occupation, aadhaar, photo, notes, maintenance, openingDue } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Tenant name and phone are required' });
  const room = db.rooms.find(r => r.id === bed.roomId);
  const tenant = {
    id: store.id('tnt'),
    propertyId: prop.id, bedId: bed.id, roomId: bed.roomId, floorId: bed.floorId,
    name: String(name).trim(), phone: String(phone),
    rent: Number(rent) || room?.rent || 0,
    deposit: Number(deposit) || 0,
    maintenance: Number(maintenance) || 0,
    openingDue: Number(openingDue) || 0,
    joinDate: joinDate || new Date().toISOString().slice(0, 10),
    leaveDate: null,
    occupation: occupation || '', aadhaar: aadhaar || '', photo: photo || null,
    notes: notes || '',
    kycStatus: 'pending',
    kycDocs: [],
    status: 'active',
    portalToken: crypto.randomBytes(12).toString('base64url'),
    createdAt: new Date().toISOString()
  };
  db.tenants.push(tenant);
  bed.tenantId = tenant.id;
  logActivity(req.user.id, prop.id, '🧑', `${tenant.name} joined ${prop.name} — ${room?.name || ''} / ${bed.name}`);
  store.saveNow();
  res.json({ tenant });
});

app.put('/api/tenants/:id', auth, (req, res) => {
  const tenant = db.tenants.find(t => t.id === req.params.id);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Tenant not found' });
  const fields = ['name', 'phone', 'occupation', 'aadhaar', 'photo', 'notes', 'joinDate', 'leaveDate'];
  for (const f of fields) if (req.body?.[f] !== undefined) tenant[f] = req.body[f];
  if (req.body?.rent !== undefined) tenant.rent = Number(req.body.rent) || 0;
  if (req.body?.deposit !== undefined) tenant.deposit = Number(req.body.deposit) || 0;
  if (req.body?.maintenance !== undefined) tenant.maintenance = Number(req.body.maintenance) || 0;
  if (req.body?.openingDue !== undefined) tenant.openingDue = Number(req.body.openingDue) || 0;
  store.save();
  res.json({ tenant: { ...tenant, dues: tenantDues(tenant) } });
});

app.post('/api/tenants/:id/vacate', auth, (req, res) => {
  const tenant = db.tenants.find(t => t.id === req.params.id);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Tenant not found' });
  tenant.status = 'vacated';
  tenant.vacatedAt = new Date().toISOString();
  if (!tenant.leaveDate) tenant.leaveDate = new Date().toISOString().slice(0, 10); // stop billing today
  const bed = db.beds.find(b => b.id === tenant.bedId);
  if (bed && bed.tenantId === tenant.id) bed.tenantId = null;
  logActivity(req.user.id, prop.id, '👋', `${tenant.name} vacated from ${prop.name}`);
  store.saveNow();
  res.json({ ok: true });
});

// move tenant to another (vacant) bed, possibly another property
app.post('/api/tenants/:id/move', auth, (req, res) => {
  const tenant = db.tenants.find(t => t.id === req.params.id);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Tenant not found' });
  const target = db.beds.find(b => b.id === req.body?.bedId);
  const targetProp = target && db.properties.find(p => p.id === target.propertyId && p.ownerId === req.user.id);
  if (!targetProp) return res.status(404).json({ error: 'Target bed not found' });
  if (target.tenantId) return res.status(400).json({ error: 'Target bed is occupied' });
  const old = db.beds.find(b => b.id === tenant.bedId);
  if (old) old.tenantId = null;
  target.tenantId = tenant.id;
  Object.assign(tenant, { bedId: target.id, roomId: target.roomId, floorId: target.floorId, propertyId: target.propertyId });
  logActivity(req.user.id, targetProp.id, '🔀', `${tenant.name} moved to ${targetProp.name}`);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/tenants', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  let list = db.tenants.filter(t => myProps.has(t.propertyId));
  if (req.query.propertyId) list = list.filter(t => t.propertyId === req.query.propertyId);
  if (req.query.status) list = list.filter(t => t.status === req.query.status);
  const withInfo = list.map(t => {
    const room = db.rooms.find(r => r.id === t.roomId);
    const propItem = db.properties.find(p => p.id === t.propertyId);
    return { ...t, dues: t.status === 'active' ? tenantDues(t) : null, roomName: room?.name || '', propertyName: propItem?.name || '' };
  });
  res.json({ tenants: withInfo });
});

/* ---------------- payments & dues ---------------- */

app.post('/api/payments', auth, (req, res) => {
  const tenant = db.tenants.find(t => t.id === req.body?.tenantId);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Tenant not found' });
  const { amount, mode, note, date, type } = req.body || {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const payType = type === 'advance' ? 'advance' : 'rent';
  const before = payType === 'rent' ? tenantDues(tenant) : null;
  const receiptNo = 'R' + Date.now().toString().slice(-8);
  const payment = {
    id: store.id('pay'),
    tenantId: tenant.id, propertyId: tenant.propertyId,
    tenantName: tenant.name,
    amount: Number(amount),
    type: payType,
    mode: mode || 'cash',
    note: note || '',
    date: date || new Date().toISOString().slice(0, 10),
    receiptNo,
    createdAt: new Date().toISOString()
  };
  db.payments.push(payment);
  if (payType === 'advance') {
    tenant.deposit = (Number(tenant.deposit) || 0) + payment.amount;
    logActivity(req.user.id, prop.id, '🏦', `₹${payment.amount} advance received from ${tenant.name}`);
    notify(req.user.id, prop.id, 'payment', '🏦', `Advance received: ₹${payment.amount} from ${tenant.name}`);
    store.saveNow();
    return res.json({ payment, tenant });
  }
  const dues = tenantDues(tenant);
  // remember how the money landed so the receipt can say "₹X still pending"
  payment.clearedOldDues = Math.min(payment.amount, before.previousDue);
  payment.balanceAfter = dues.dueAmount;
  logActivity(req.user.id, prop.id, '💰',
    `₹${payment.amount} rent received from ${tenant.name} (${payment.mode.toUpperCase()})${dues.dueAmount > 0 ? ` — ₹${dues.dueAmount} still pending` : ' — all clear'}`);
  notify(req.user.id, prop.id, 'payment', '💰',
    `Payment received: ₹${payment.amount} from ${tenant.name}${dues.dueAmount > 0 ? ` (₹${dues.dueAmount} still pending)` : ''}`);
  store.saveNow();
  res.json({ payment, dues });
});

app.delete('/api/payments/:id', auth, (req, res) => {
  const pay = db.payments.find(p => p.id === req.params.id);
  const prop = pay && db.properties.find(p => p.id === pay.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Payment not found' });
  db.payments = db.payments.filter(p => p.id !== pay.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/payments', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  let list = db.payments.filter(p => myProps.has(p.propertyId));
  if (req.query.propertyId) list = list.filter(p => p.propertyId === req.query.propertyId);
  if (req.query.tenantId) list = list.filter(p => p.tenantId === req.query.tenantId);
  if (req.query.month) list = list.filter(p => (p.date || '').startsWith(req.query.month));
  list = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({ payments: list.slice(0, 300) });
});

app.get('/api/dues', auth, (req, res) => {
  const myProps = db.properties.filter(p => p.ownerId === req.user.id);
  const propFilter = req.query.propertyId;
  const rows = [];
  for (const t of db.tenants.filter(t => t.status === 'active' && myProps.some(p => p.id === t.propertyId))) {
    if (propFilter && t.propertyId !== propFilter) continue;
    const d = tenantDues(t);
    if (d.dueAmount > 0) {
      const propItem = myProps.find(p => p.id === t.propertyId);
      const room = db.rooms.find(r => r.id === t.roomId);
      rows.push({ tenant: t, dues: d, propertyName: propItem?.name, roomName: room?.name });
    }
  }
  rows.sort((a, b) => b.dues.dueAmount - a.dues.dueAmount);
  res.json({ dues: rows });
});

// reminder text for WhatsApp / SMS — frontend opens wa.me link
app.get('/api/tenants/:id/reminder', auth, (req, res) => {
  const tenant = db.tenants.find(t => t.id === req.params.id);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Tenant not found' });
  const d = tenantDues(tenant);
  const text = `Namaste ${tenant.name} 🙏\nThis is a friendly rent reminder from ${prop.name}.\nPending: ₹${d.dueAmount} (${d.unpaidMonths.join(', ')})\nPlease pay at your earliest convenience. Thank you!\n— ${req.user.name}, StaySathi`;
  logActivity(req.user.id, prop.id, '🔔', `Rent reminder sent to ${tenant.name}`);
  res.json({ text, phone: tenant.phone, dueAmount: d.dueAmount });
});

/* ---------------- KYC ---------------- */
// A tenant's KYC is only "done" when at least one ID document is actually
// uploaded — by the tenant through their portal link, or by the owner.
// Status flow: pending → submitted (doc uploaded) → verified (owner checked).

function ownTenant(req, res) {
  const tenant = db.tenants.find(t => t.id === req.params.id);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) { res.status(404).json({ error: 'Tenant not found' }); return null; }
  return { tenant, prop };
}

function addKycDoc(tenant, { docType, idNumber, image, uploadedBy }) {
  tenant.kycDocs = tenant.kycDocs || [];
  if (tenant.kycDocs.length >= 3) return { error: 'Maximum 3 documents per tenant. Delete one first.' };
  if (!image) return { error: 'Attach a photo/scan of the document' };
  const doc = {
    id: store.id('kyc'),
    docType: docType || 'aadhaar',
    idNumber: String(idNumber || '').slice(0, 40),
    image, uploadedBy,
    createdAt: new Date().toISOString()
  };
  tenant.kycDocs.push(doc);
  if (tenant.kycStatus !== 'verified') tenant.kycStatus = 'submitted';
  return { doc };
}

app.post('/api/tenants/:id/kyc-docs', auth, (req, res) => {
  const own = ownTenant(req, res); if (!own) return;
  const out = addKycDoc(own.tenant, { ...req.body, uploadedBy: 'owner' });
  if (out.error) return res.status(400).json({ error: out.error });
  logActivity(req.user.id, own.prop.id, '🪪', `KYC document (${out.doc.docType}) added for ${own.tenant.name}`);
  store.saveNow();
  res.json({ doc: out.doc, kycStatus: own.tenant.kycStatus });
});

// doc images are heavy; the list endpoints send metadata only and the image
// is fetched one at a time on demand
app.get('/api/tenants/:id/kyc-docs/:docId/image', auth, (req, res) => {
  const own = ownTenant(req, res); if (!own) return;
  const doc = (own.tenant.kycDocs || []).find(d => d.id === req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json({ image: doc.image, docType: doc.docType, idNumber: doc.idNumber });
});

app.delete('/api/tenants/:id/kyc-docs/:docId', auth, (req, res) => {
  const own = ownTenant(req, res); if (!own) return;
  const t = own.tenant;
  t.kycDocs = (t.kycDocs || []).filter(d => d.id !== req.params.docId);
  if (t.kycDocs.length === 0) t.kycStatus = 'pending'; // no proof left = not done
  store.saveNow();
  res.json({ ok: true, kycStatus: t.kycStatus });
});

app.post('/api/tenants/:id/kyc-status', auth, (req, res) => {
  const own = ownTenant(req, res); if (!own) return;
  const t = own.tenant;
  const status = req.body?.status;
  if (!['pending', 'submitted', 'verified', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid KYC status' });
  }
  if (status === 'verified' && !(t.kycDocs || []).length) {
    return res.status(400).json({ error: 'Upload an ID proof first — KYC can only be marked done after a document is uploaded' });
  }
  t.kycStatus = status;
  logActivity(req.user.id, own.prop.id, '🪪', `KYC ${status} for ${t.name}`);
  store.saveNow();
  res.json({ kycStatus: t.kycStatus });
});

// bulk view / export of KYC records across properties
app.get('/api/kyc-records', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  const rows = db.tenants.filter(t => myProps.has(t.propertyId) && t.status === 'active').map(t => {
    const room = db.rooms.find(r => r.id === t.roomId);
    const propItem = db.properties.find(p => p.id === t.propertyId);
    return {
      id: t.id, name: t.name, phone: t.phone,
      propertyName: propItem?.name || '', roomName: room?.name || '',
      kycStatus: t.kycStatus || 'pending',
      docs: (t.kycDocs || []).map(d => ({ id: d.id, docType: d.docType, idNumber: d.idNumber, uploadedBy: d.uploadedBy, createdAt: d.createdAt }))
    };
  });
  res.json({ records: rows });
});

/* ---------------- tenant portal (public, token-based) ---------------- */

// owner generates / fetches the share link for a tenant
app.get('/api/tenants/:id/portal-link', auth, (req, res) => {
  const tenant = db.tenants.find(t => t.id === req.params.id);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Tenant not found' });
  const token = ensurePortalToken(tenant);
  res.json({ token, path: `/portal/${token}`, phone: tenant.phone });
});

function portalTenant(req, res) {
  const tenant = db.tenants.find(t => t.portalToken && t.portalToken === req.params.token);
  if (!tenant || tenant.status !== 'active') {
    res.status(404).json({ error: 'This link is no longer active. Ask your owner for a new one.' });
    return null;
  }
  return tenant;
}

app.get('/api/portal/:token', (req, res) => {
  const tenant = portalTenant(req, res); if (!tenant) return;
  const prop = db.properties.find(p => p.id === tenant.propertyId);
  const owner = prop && db.users.find(u => u.id === prop.ownerId);
  const room = db.rooms.find(r => r.id === tenant.roomId);
  const dues = tenantDues(tenant);
  const payments = db.payments.filter(p => p.tenantId === tenant.id)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 60);
  const notices = db.notices
    .filter(n => n.ownerId === prop?.ownerId && (!n.propertyId || n.propertyId === tenant.propertyId))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 20);
  const complaints = db.complaints.filter(c => c.tenantId === tenant.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({
    tenant: {
      name: tenant.name, phone: tenant.phone, rent: tenant.rent, deposit: tenant.deposit,
      maintenance: tenant.maintenance || 0,
      joinDate: tenant.joinDate, kycStatus: tenant.kycStatus || 'pending',
      kycDocs: (tenant.kycDocs || []).map(d => ({ id: d.id, docType: d.docType, idNumber: d.idNumber, uploadedBy: d.uploadedBy, createdAt: d.createdAt }))
    },
    property: prop ? { name: prop.name, icon: prop.icon, city: prop.city, type: prop.type } : null,
    owner: owner ? { name: owner.name, phone: owner.phone } : null,
    roomName: room?.name || '', dues, payments, notices, complaints
  });
});

// tenant uploads their own ID proof — this is what marks KYC as done
app.post('/api/portal/:token/kyc', (req, res) => {
  const tenant = portalTenant(req, res); if (!tenant) return;
  const { docType, idNumber, image, fullName, address } = req.body || {};
  const out = addKycDoc(tenant, { docType, idNumber, image, uploadedBy: 'tenant' });
  if (out.error) return res.status(400).json({ error: out.error });
  if (fullName) tenant.kycName = String(fullName).slice(0, 80);
  if (address) tenant.kycAddress = String(address).slice(0, 300);
  const prop = db.properties.find(p => p.id === tenant.propertyId);
  if (prop) {
    logActivity(prop.ownerId, prop.id, '🪪', `${tenant.name} uploaded KYC document (${out.doc.docType}) — verify it`);
    notify(prop.ownerId, prop.id, 'kyc', '🪪', `${tenant.name} submitted KYC (${out.doc.docType}) — tap to verify`);
  }
  store.saveNow();
  res.json({ ok: true, kycStatus: tenant.kycStatus });
});

app.post('/api/portal/:token/complaints', (req, res) => {
  const tenant = portalTenant(req, res); if (!tenant) return;
  const { category, text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Describe the complaint' });
  const prop = db.properties.find(p => p.id === tenant.propertyId);
  const room = db.rooms.find(r => r.id === tenant.roomId);
  const complaint = {
    id: store.id('cmp'), propertyId: tenant.propertyId, tenantId: tenant.id,
    category: category || 'other', text: String(text).slice(0, 1000),
    tenantName: tenant.name, roomName: room?.name || '',
    status: 'open', source: 'portal', createdAt: new Date().toISOString()
  };
  db.complaints.push(complaint);
  if (prop) {
    logActivity(prop.ownerId, prop.id, '🛠️', `${tenant.name} raised a complaint (${complaint.category}) at ${prop.name}`);
    notify(prop.ownerId, prop.id, 'complaint', '🛠️', `New complaint from ${tenant.name} (${complaint.category}): ${complaint.text.slice(0, 80)}`);
  }
  store.saveNow();
  res.json({ complaint });
});

// tenant says "I have paid" → owner sees it in the activity feed and can record it
app.post('/api/portal/:token/paid-claim', (req, res) => {
  const tenant = portalTenant(req, res); if (!tenant) return;
  const prop = db.properties.find(p => p.id === tenant.propertyId);
  const amount = Number(req.body?.amount) || 0;
  const note = String(req.body?.note || '').slice(0, 200);
  const screenshot = req.body?.screenshot || null; // UPI payment proof
  if (amount <= 0) return res.status(400).json({ error: 'Enter the amount you paid' });
  db.paymentClaims = db.paymentClaims || [];
  db.paymentClaims.unshift({
    id: store.id('clm'), tenantId: tenant.id, propertyId: tenant.propertyId,
    tenantName: tenant.name, amount, note, screenshot, status: 'open',
    createdAt: new Date().toISOString()
  });
  if (db.paymentClaims.length > 300) db.paymentClaims.length = 300;
  if (prop) {
    logActivity(prop.ownerId, prop.id, '💸',
      `${tenant.name} says they paid ₹${amount}${note ? ` (${note})` : ''} — verify & record it`);
    notify(prop.ownerId, prop.id, 'claim', '💸',
      `${tenant.name} requests to record a payment of ₹${amount}${screenshot ? ' (screenshot attached)' : ''}`);
  }
  store.saveNow();
  res.json({ ok: true });
});

/* ---------------- first-time setup wizard ---------------- */
// Creates a property with floors, auto-numbered rooms and beds in one shot.
app.post('/api/setup', auth, (req, res) => {
  const { name, type, city, address, color, icon, pin, floors, roomsPerFloor, bedsPerRoom, rent } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Give your property a name' });
  const nFloors = Math.min(Math.max(Number(floors) || 1, 1), 30);
  const nRooms = Math.min(Math.max(Number(roomsPerFloor) || 0, 0), 40);
  const nBeds = Math.min(Math.max(Number(bedsPerRoom) || 1, 1), 20);
  const roomRent = Number(rent) || 0;
  const prop = {
    id: store.id('prp'), ownerId: req.user.id,
    name: String(name).trim(), type: type || 'hostel',
    address: address || '', city: city || '',
    color: color || '#6C5CE7', icon: icon || '🏠',
    pinHash: pin ? hashPassword(pin) : null,
    createdAt: new Date().toISOString()
  };
  db.properties.push(prop);
  let roomsCreated = 0, bedsCreated = 0;
  for (let f = 0; f < nFloors; f++) {
    const floor = { id: store.id('flr'), propertyId: prop.id, name: f === 0 ? 'Ground Floor' : `Floor ${f}`, order: f };
    db.floors.push(floor);
    for (let r = 1; r <= nRooms; r++) {
      const roomName = f === 0 ? `G${String(r).padStart(2, '0')}` : `${f}${String(r).padStart(2, '0')}`;
      const room = {
        id: store.id('rom'), propertyId: prop.id, floorId: floor.id,
        name: roomName, capacity: nBeds, rent: roomRent, createdAt: new Date().toISOString()
      };
      db.rooms.push(room);
      roomsCreated++;
      for (let b = 0; b < nBeds; b++) {
        db.beds.push({ id: store.id('bed'), roomId: room.id, floorId: floor.id, propertyId: prop.id, name: `Bed ${b + 1}`, tenantId: null });
        bedsCreated++;
      }
    }
  }
  logActivity(req.user.id, prop.id, '🪄', `Setup complete: ${prop.name} — ${nFloors} floors, ${roomsCreated} rooms, ${bedsCreated} beds`);
  store.saveNow();
  res.json({ property: publicProperty(prop), roomsCreated, bedsCreated });
});

/* ---------------- smart import (Excel / photo register) ---------------- */
// The client parses the sheet/photo and sends normalized rows; this endpoint
// creates any missing floors/rooms/beds and fills tenants with rent, advance
// and old dues in one transaction-like pass.
app.post('/api/properties/:id/import', auth, (req, res) => {
  const prop = ownProperty(req, res); if (!prop) return;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows to import' });
  const summary = { floorsCreated: 0, roomsCreated: 0, bedsCreated: 0, tenantsCreated: 0, skipped: 0 };
  const today = new Date().toISOString().slice(0, 10);

  const floorFor = (raw, roomName) => {
    let label = String(raw ?? '').trim();
    if (!label && /^\d{3,}$/.test(roomName)) label = roomName[0]; // 101 → floor 1
    if (/^\d+$/.test(label)) label = Number(label) === 0 ? 'Ground Floor' : `Floor ${Number(label)}`;
    if (!label) label = 'Ground Floor';
    let floor = db.floors.find(f => f.propertyId === prop.id && f.name.toLowerCase() === label.toLowerCase());
    if (!floor) {
      floor = { id: store.id('flr'), propertyId: prop.id, name: label, order: db.floors.filter(f => f.propertyId === prop.id).length };
      db.floors.push(floor);
      summary.floorsCreated++;
    }
    return floor;
  };

  for (const raw of rows) {
    const roomName = String(raw.room ?? '').trim();
    if (!roomName) { summary.skipped++; continue; }
    const floor = floorFor(raw.floor, roomName);
    let room = db.rooms.find(r => r.propertyId === prop.id && r.name.toLowerCase() === roomName.toLowerCase());
    if (!room) {
      room = {
        id: store.id('rom'), propertyId: prop.id, floorId: floor.id,
        name: roomName, capacity: 0, rent: Number(raw.rent) || 0, createdAt: new Date().toISOString()
      };
      db.rooms.push(room);
      summary.roomsCreated++;
    }
    // find the requested bed, else the first vacant one, else grow the room
    const roomBeds = () => db.beds.filter(b => b.roomId === room.id);
    let bed = null;
    const wantBed = String(raw.bed ?? '').trim();
    if (wantBed) {
      const label = /^\d+$/.test(wantBed) ? `Bed ${wantBed}` : wantBed;
      bed = roomBeds().find(b => b.name.toLowerCase() === label.toLowerCase());
    }
    if (!bed) bed = roomBeds().find(b => !b.tenantId);
    if (!bed || (bed.tenantId && String(raw.name ?? '').trim())) {
      bed = { id: store.id('bed'), roomId: room.id, floorId: floor.id, propertyId: prop.id, name: wantBed && /^\d+$/.test(wantBed) ? `Bed ${wantBed}` : `Bed ${roomBeds().length + 1}`, tenantId: null };
      db.beds.push(bed);
      summary.bedsCreated++;
    }
    room.capacity = Math.max(room.capacity, roomBeds().length);

    const name = String(raw.name ?? '').trim();
    if (!name) continue; // vacant room/bed row — structure only
    if (bed.tenantId) { summary.skipped++; continue; }
    const tenant = {
      id: store.id('tnt'),
      propertyId: prop.id, bedId: bed.id, roomId: room.id, floorId: floor.id,
      name, phone: String(raw.phone ?? '').replace(/\D/g, '').slice(-12),
      rent: Number(raw.rent) || room.rent || 0,
      deposit: Number(raw.advance) || 0,
      maintenance: Number(raw.maintenance) || 0,
      openingDue: Math.max(0, Number(raw.due) || 0),
      joinDate: raw.joinDate || today,
      leaveDate: null,
      occupation: String(raw.occupation ?? ''), aadhaar: String(raw.aadhaar ?? ''),
      photo: null, notes: 'Imported', kycStatus: 'pending', kycDocs: [],
      status: 'active', portalToken: crypto.randomBytes(12).toString('base64url'),
      createdAt: new Date().toISOString()
    };
    db.tenants.push(tenant);
    bed.tenantId = tenant.id;
    summary.tenantsCreated++;
  }
  logActivity(req.user.id, prop.id, '📥',
    `Smart import: ${summary.tenantsCreated} tenants, ${summary.roomsCreated} rooms, ${summary.bedsCreated} beds added to ${prop.name}`);
  store.saveNow();
  res.json({ summary });
});

/* ---------------- notifications ---------------- */

app.get('/api/notifications', auth, (req, res) => {
  // synthesize once-a-month rent-due reminders so the owner never misses them
  const mk = monthKey(new Date());
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  for (const t of db.tenants.filter(t => t.status === 'active' && myProps.has(t.propertyId))) {
    const d = tenantDues(t);
    if (d.dueAmount > 0) {
      notify(req.user.id, t.propertyId, 'due', '⏰',
        `Rent due: ${t.name} owes ₹${d.dueAmount}${d.previousDue > 0 ? ` (₹${d.previousDue} old dues)` : ''}`,
        `due:${t.id}:${mk}`);
    }
  }
  const list = db.notifications.filter(n => n.ownerId === req.user.id).slice(0, 100);
  res.json({ notifications: list, unread: list.filter(n => !n.read).length });
});

app.post('/api/notifications/read', auth, (req, res) => {
  const ids = req.body?.ids;
  for (const n of db.notifications) {
    if (n.ownerId !== req.user.id) continue;
    if (!ids || ids.includes(n.id)) n.read = true;
  }
  store.save();
  res.json({ ok: true });
});

/* ---------------- tenant payment claims (owner review) ---------------- */

app.get('/api/payment-claims', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  const list = (db.paymentClaims || []).filter(c => myProps.has(c.propertyId));
  res.json({ claims: list });
});

app.post('/api/payment-claims/:id/resolve', auth, (req, res) => {
  const claim = (db.paymentClaims || []).find(c => c.id === req.params.id);
  const prop = claim && db.properties.find(p => p.id === claim.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Claim not found' });
  claim.status = req.body?.accept ? 'accepted' : 'dismissed';
  claim.resolvedAt = new Date().toISOString();
  store.saveNow();
  res.json({ claim });
});

/* ---------------- expenses ---------------- */

app.post('/api/expenses', auth, (req, res) => {
  const prop = db.properties.find(p => p.id === req.body?.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const { category, amount, note, date } = req.body || {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const expense = {
    id: store.id('exp'), propertyId: prop.id,
    category: category || 'other', amount: Number(amount), note: note || '',
    date: date || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString()
  };
  db.expenses.push(expense);
  logActivity(req.user.id, prop.id, '🧾', `₹${expense.amount} spent on ${expense.category} at ${prop.name}`);
  store.saveNow();
  res.json({ expense });
});

app.delete('/api/expenses/:id', auth, (req, res) => {
  const exp = db.expenses.find(e => e.id === req.params.id);
  const prop = exp && db.properties.find(p => p.id === exp.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Expense not found' });
  db.expenses = db.expenses.filter(e => e.id !== exp.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/expenses', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  let list = db.expenses.filter(e => myProps.has(e.propertyId));
  if (req.query.propertyId) list = list.filter(e => e.propertyId === req.query.propertyId);
  if (req.query.month) list = list.filter(e => (e.date || '').startsWith(req.query.month));
  list = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({ expenses: list.slice(0, 300) });
});

/* ---------------- complaints ---------------- */

app.post('/api/complaints', auth, (req, res) => {
  const prop = db.properties.find(p => p.id === req.body?.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const { category, text, tenantName, roomName } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Describe the complaint' });
  const complaint = {
    id: store.id('cmp'), propertyId: prop.id,
    category: category || 'other', text, tenantName: tenantName || '', roomName: roomName || '',
    status: 'open', createdAt: new Date().toISOString()
  };
  db.complaints.push(complaint);
  logActivity(req.user.id, prop.id, '🛠️', `New complaint at ${prop.name}: ${category || 'other'}`);
  store.saveNow();
  res.json({ complaint });
});

app.put('/api/complaints/:id', auth, (req, res) => {
  const c = db.complaints.find(x => x.id === req.params.id);
  const prop = c && db.properties.find(p => p.id === c.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Complaint not found' });
  if (req.body?.status) c.status = req.body.status;
  if (c.status === 'resolved') c.resolvedAt = new Date().toISOString();
  store.save();
  res.json({ complaint: c });
});

app.delete('/api/complaints/:id', auth, (req, res) => {
  const c = db.complaints.find(x => x.id === req.params.id);
  const prop = c && db.properties.find(p => p.id === c.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Complaint not found' });
  db.complaints = db.complaints.filter(x => x.id !== c.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/complaints', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  let list = db.complaints.filter(c => myProps.has(c.propertyId));
  if (req.query.propertyId) list = list.filter(c => c.propertyId === req.query.propertyId);
  list = [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ complaints: list.map(c => ({ ...c, propertyName: db.properties.find(p => p.id === c.propertyId)?.name })) });
});

/* ---------------- notices ---------------- */

app.post('/api/notices', auth, (req, res) => {
  const { propertyId, text } = req.body || {};
  if (propertyId) {
    const prop = db.properties.find(p => p.id === propertyId && p.ownerId === req.user.id);
    if (!prop) return res.status(404).json({ error: 'Property not found' });
  }
  if (!text) return res.status(400).json({ error: 'Notice text is required' });
  const notice = { id: store.id('ntc'), ownerId: req.user.id, propertyId: propertyId || null, text, createdAt: new Date().toISOString() };
  db.notices.push(notice);
  logActivity(req.user.id, propertyId, '📢', `Notice posted: ${text.slice(0, 60)}`);
  store.saveNow();
  res.json({ notice });
});

app.delete('/api/notices/:id', auth, (req, res) => {
  const n = db.notices.find(x => x.id === req.params.id && x.ownerId === req.user.id);
  if (!n) return res.status(404).json({ error: 'Notice not found' });
  db.notices = db.notices.filter(x => x.id !== n.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/notices', auth, (req, res) => {
  const list = db.notices.filter(n => n.ownerId === req.user.id)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ notices: list.map(n => ({ ...n, propertyName: n.propertyId ? db.properties.find(p => p.id === n.propertyId)?.name : null })) });
});

/* ---------------- staff ---------------- */

app.post('/api/staff', auth, (req, res) => {
  const prop = db.properties.find(p => p.id === req.body?.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const { name, role, phone, salary, joinDate } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Staff name is required' });
  const member = {
    id: store.id('stf'), propertyId: prop.id,
    name: String(name).trim(), role: role || 'helper', phone: phone || '',
    salary: Number(salary) || 0, joinDate: joinDate || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString()
  };
  db.staff.push(member);
  logActivity(req.user.id, prop.id, '🧹', `Staff added: ${member.name} (${member.role}) at ${prop.name}`);
  store.saveNow();
  res.json({ staff: member });
});

app.put('/api/staff/:id', auth, (req, res) => {
  const s = db.staff.find(x => x.id === req.params.id);
  const prop = s && db.properties.find(p => p.id === s.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Staff not found' });
  const { name, role, phone, salary, joinDate } = req.body || {};
  if (name) s.name = String(name).trim();
  if (role) s.role = role;
  if (phone !== undefined) s.phone = phone;
  if (salary !== undefined) s.salary = Number(salary) || 0;
  if (joinDate) s.joinDate = joinDate;
  store.save();
  res.json({ staff: s });
});

app.delete('/api/staff/:id', auth, (req, res) => {
  const s = db.staff.find(x => x.id === req.params.id);
  const prop = s && db.properties.find(p => p.id === s.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Staff not found' });
  db.staff = db.staff.filter(x => x.id !== s.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/staff', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  let list = db.staff.filter(s => myProps.has(s.propertyId));
  if (req.query.propertyId) list = list.filter(s => s.propertyId === req.query.propertyId);
  const mk = monthKey(new Date());
  res.json({
    staff: list.map(s => {
      const pays = (db.salaryPayments || []).filter(x => x.staffId === s.id);
      const paidThisMonth = pays.filter(x => x.month === mk).reduce((a, x) => a + (Number(x.amount) || 0), 0);
      const last = pays.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      return {
        ...s,
        propertyName: db.properties.find(p => p.id === s.propertyId)?.name,
        paidThisMonth,
        lastPaidDate: last?.date || null
      };
    })
  });
});

/* ---------------- staff salary payments ---------------- */
// A salary payment is stored twice on purpose: as a salaryPayments row (per
// staff member, per month — powers the "paid / due" chip and history) and as
// an expense with category "salary" so it automatically shows up in the
// expenses list, monthly totals and income-vs-expense reports.

app.post('/api/staff/:id/pay-salary', auth, (req, res) => {
  const s = db.staff.find(x => x.id === req.params.id);
  const prop = s && db.properties.find(p => p.id === s.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Staff not found' });
  const { amount, month, mode, note, date } = req.body || {};
  const amt = Number(amount) || 0;
  if (amt <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const mk = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : monthKey(new Date());
  const payDate = date || new Date().toISOString().slice(0, 10);
  const payment = {
    id: store.id('sal'),
    staffId: s.id, propertyId: s.propertyId,
    staffName: s.name, role: s.role,
    amount: amt, month: mk,
    mode: mode || 'cash', note: note || '',
    date: payDate,
    createdAt: new Date().toISOString()
  };
  db.salaryPayments.push(payment);
  const expense = {
    id: store.id('exp'), propertyId: s.propertyId,
    category: 'salary', amount: amt,
    note: `${s.name} (${s.role}) — ${monthLabel(mk)}`,
    salaryPaymentId: payment.id,
    date: payDate, createdAt: new Date().toISOString()
  };
  db.expenses.push(expense);
  const totalForMonth = db.salaryPayments
    .filter(x => x.staffId === s.id && x.month === mk)
    .reduce((a, x) => a + (Number(x.amount) || 0), 0);
  logActivity(req.user.id, prop.id, '👛',
    `₹${amt} salary paid to ${s.name} (${s.role}) for ${monthLabel(mk)}${totalForMonth < (Number(s.salary) || 0) ? ` — ₹${(Number(s.salary) || 0) - totalForMonth} still due` : ''}`);
  store.saveNow();
  res.json({ payment, paidThisMonth: totalForMonth });
});

app.get('/api/salary-payments', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  let list = (db.salaryPayments || []).filter(x => myProps.has(x.propertyId));
  if (req.query.propertyId) list = list.filter(x => x.propertyId === req.query.propertyId);
  if (req.query.staffId) list = list.filter(x => x.staffId === req.query.staffId);
  if (req.query.month) list = list.filter(x => x.month === req.query.month);
  list = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({
    payments: list.slice(0, 300).map(x => ({
      ...x,
      monthLabel: monthLabel(x.month),
      propertyName: db.properties.find(p => p.id === x.propertyId)?.name
    }))
  });
});

app.delete('/api/salary-payments/:id', auth, (req, res) => {
  const pay = (db.salaryPayments || []).find(x => x.id === req.params.id);
  const prop = pay && db.properties.find(p => p.id === pay.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Payment not found' });
  db.salaryPayments = db.salaryPayments.filter(x => x.id !== pay.id);
  db.expenses = db.expenses.filter(e => e.salaryPaymentId !== pay.id); // keep books in sync
  store.saveNow();
  res.json({ ok: true });
});

/* ---------------- electricity meters ---------------- */

app.post('/api/meters', auth, (req, res) => {
  const prop = db.properties.find(p => p.id === req.body?.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const { label, reading, prevReading, ratePerUnit, date } = req.body || {};
  if (!label || reading === undefined) return res.status(400).json({ error: 'Meter label and reading are required' });
  const units = Math.max(0, (Number(reading) || 0) - (Number(prevReading) || 0));
  const entry = {
    id: store.id('mtr'), propertyId: prop.id,
    label, reading: Number(reading), prevReading: Number(prevReading) || 0,
    units, ratePerUnit: Number(ratePerUnit) || 0, bill: Math.round(units * (Number(ratePerUnit) || 0)),
    date: date || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString()
  };
  db.meters.push(entry);
  logActivity(req.user.id, prop.id, '⚡', `Meter "${label}" reading ${entry.reading} (${units} units) at ${prop.name}`);
  store.saveNow();
  res.json({ meter: entry });
});

app.delete('/api/meters/:id', auth, (req, res) => {
  const m = db.meters.find(x => x.id === req.params.id);
  const prop = m && db.properties.find(p => p.id === m.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Reading not found' });
  db.meters = db.meters.filter(x => x.id !== m.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/meters', auth, (req, res) => {
  const myProps = new Set(db.properties.filter(p => p.ownerId === req.user.id).map(p => p.id));
  let list = db.meters.filter(m => myProps.has(m.propertyId));
  if (req.query.propertyId) list = list.filter(m => m.propertyId === req.query.propertyId);
  list = [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json({ meters: list.map(m => ({ ...m, propertyName: db.properties.find(p => p.id === m.propertyId)?.name })) });
});

/* ---------------- reports ---------------- */

app.get('/api/reports', auth, (req, res) => {
  const myProps = db.properties.filter(p => p.ownerId === req.user.id);
  const propFilter = req.query.propertyId;
  const ids = new Set(myProps.filter(p => !propFilter || p.id === propFilter).map(p => p.id));
  const now = new Date();
  const inScope = (x) => ids.has(x.propertyId);

  // income vs expense, last 6 months
  const series = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = monthKey(d);
    const income = db.payments.filter(p => inScope(p) && (p.date || '').startsWith(mk)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const expense = db.expenses.filter(e => inScope(e) && (e.date || '').startsWith(mk)).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    series.push({ month: mk, label: d.toLocaleString('en', { month: 'short' }), income, expense, profit: income - expense });
  }

  const byCategory = {};
  const mkNow = monthKey(now);
  for (const e of db.expenses.filter(e => inScope(e) && (e.date || '').startsWith(mkNow))) {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  }

  // occupancy
  const beds = db.beds.filter(inScope);
  const occupied = beds.filter(b => b.tenantId).length;
  const occupancy = {
    beds: beds.length, occupied, vacant: beds.length - occupied,
    rate: beds.length ? Math.round(occupied / beds.length * 100) : 0
  };

  // rent charged vs collected per month (paid vs pending trend, last 6 months)
  const tenants = db.tenants.filter(inScope);
  const charged = {}; // month → total rent raised that month
  for (const t of tenants) {
    for (const c of tenantCharges(t, now)) {
      if (c.opening) { continue; }
      charged[c.month] = (charged[c.month] || 0) + c.amount;
    }
  }
  const rentSeries = series.map(s => {
    const collected = db.payments.filter(p => inScope(p) && (p.type || 'rent') === 'rent' && (p.date || '').startsWith(s.month))
      .reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const due = charged[s.month] || 0;
    return { month: s.month, label: s.label, charged: due, collected, pending: Math.max(0, due - collected) };
  });

  // revenue trend, last 12 months (all money in)
  const revenue = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = monthKey(d);
    revenue.push({
      month: mk, label: d.toLocaleString('en', { month: 'short' }),
      amount: db.payments.filter(p => inScope(p) && (p.date || '').startsWith(mk)).reduce((a, p) => a + (Number(p.amount) || 0), 0)
    });
  }

  // floor-wise: occupancy + this month's collection + open dues per floor
  const floors = db.floors.filter(inScope).sort((a, b) => a.order - b.order).map(f => {
    const fBeds = db.beds.filter(b => b.floorId === f.id);
    const fTenants = db.tenants.filter(t => t.floorId === f.id && t.status === 'active');
    const tIds = new Set(fTenants.map(t => t.id));
    const collected = db.payments.filter(p => tIds.has(p.tenantId) && (p.date || '').startsWith(mkNow))
      .reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const dueAmount = fTenants.reduce((a, t) => a + tenantDues(t).dueAmount, 0);
    const propItem = myProps.find(p => p.id === f.propertyId);
    return {
      id: f.id, name: f.name, propertyName: propItem?.name || '',
      beds: fBeds.length, occupied: fBeds.filter(b => b.tenantId).length,
      collected, dueAmount
    };
  }).filter(f => f.beds > 0);

  res.json({ series, expenseByCategory: byCategory, occupancy, rentSeries, revenue, floors });
});

app.get('/api/activities', auth, (req, res) => {
  res.json({ activities: db.activities.filter(a => a.ownerId === req.user.id).slice(0, 50) });
});

/* ---------------- admin (special user) ---------------- */

function adminUserRow(u) {
  const props = db.properties.filter(p => p.ownerId === u.id);
  const propIds = new Set(props.map(p => p.id));
  const beds = db.beds.filter(b => propIds.has(b.propertyId));
  const tenants = db.tenants.filter(t => propIds.has(t.propertyId) && t.status === 'active');
  const mk = monthKey(new Date());
  const collectedThisMonth = db.payments
    .filter(p => propIds.has(p.propertyId) && (p.date || '').startsWith(mk))
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const lastActivity = db.activities.find(a => a.ownerId === u.id)?.createdAt || u.createdAt;
  return {
    ...publicUser(u),
    stats: {
      properties: props.length, beds: beds.length,
      occupied: beds.filter(b => b.tenantId).length,
      tenants: tenants.length, collectedThisMonth, lastActivity
    }
  };
}

app.get('/api/admin/users', adminOnly, (req, res) => {
  res.json({
    users: db.users.filter(u => u.role !== 'admin').map(adminUserRow),
    settings: db.settings || { autoApprove: true, trialDays: 30 }
  });
});

// approve / reject / block / unblock / change plan / extend trial — one endpoint
app.put('/api/admin/users/:id', adminOnly, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id && x.role !== 'admin');
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { status, plan, trialEndsAt, planExpiresAt, name, phone, email } = req.body || {};
  if (status && ['active', 'pending', 'blocked', 'rejected'].includes(status)) u.status = status;
  if (plan && ['free', 'premium'].includes(plan)) u.plan = plan;
  if (trialEndsAt !== undefined) u.trialEndsAt = trialEndsAt;
  if (planExpiresAt !== undefined) u.planExpiresAt = planExpiresAt;
  if (name) u.name = String(name).trim();
  if (phone) u.phone = String(phone);
  if (email !== undefined) u.email = email;
  if (status === 'active') notify(u.id, null, 'account', '✅', 'Your account has been approved. Welcome to StaySathi!');
  if (plan === 'premium') notify(u.id, null, 'account', '⭐', 'Your plan was upgraded to Premium. Enjoy!');
  store.saveNow();
  res.json({ user: adminUserRow(u) });
});

app.post('/api/admin/users/:id/reset-password', adminOnly, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id && x.role !== 'admin');
  if (!u) return res.status(404).json({ error: 'User not found' });
  const pw = req.body?.password;
  if (!pw || String(pw).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  u.passwordHash = hashPassword(pw);
  store.saveNow();
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', adminOnly, (req, res) => {
  const u = db.users.find(x => x.id === req.params.id && x.role !== 'admin');
  if (!u) return res.status(404).json({ error: 'User not found' });
  const propIds = new Set(db.properties.filter(p => p.ownerId === u.id).map(p => p.id));
  db.users = db.users.filter(x => x.id !== u.id);
  db.properties = db.properties.filter(p => p.ownerId !== u.id);
  for (const key of ['floors', 'rooms', 'beds', 'tenants', 'payments', 'expenses', 'complaints', 'staff', 'salaryPayments', 'meters', 'paymentClaims']) {
    db[key] = (db[key] || []).filter(x => !propIds.has(x.propertyId));
  }
  db.notices = db.notices.filter(n => n.ownerId !== u.id);
  db.activities = db.activities.filter(a => a.ownerId !== u.id);
  db.notifications = db.notifications.filter(n => n.ownerId !== u.id);
  store.saveNow();
  res.json({ ok: true });
});

app.get('/api/admin/stats', adminOnly, (req, res) => {
  const owners = db.users.filter(u => u.role !== 'admin');
  const now = new Date();
  const signups = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = monthKey(d);
    signups.push({
      month: mk, label: d.toLocaleString('en', { month: 'short' }),
      count: owners.filter(u => (u.createdAt || '').startsWith(mk)).length
    });
  }
  res.json({
    totals: {
      users: owners.length,
      active: owners.filter(u => (u.status || 'active') === 'active').length,
      pending: owners.filter(u => u.status === 'pending').length,
      blocked: owners.filter(u => u.status === 'blocked' || u.status === 'rejected').length,
      premium: owners.filter(u => u.plan === 'premium').length,
      properties: db.properties.length,
      beds: db.beds.length,
      tenants: db.tenants.filter(t => t.status === 'active').length,
      paymentsRecorded: db.payments.length
    },
    signups
  });
});

app.put('/api/admin/settings', adminOnly, (req, res) => {
  db.settings = db.settings || { autoApprove: true, trialDays: 30 };
  if (req.body?.autoApprove !== undefined) db.settings.autoApprove = !!req.body.autoApprove;
  if (req.body?.trialDays !== undefined) db.settings.trialDays = Math.max(1, Number(req.body.trialDays) || 30);
  store.saveNow();
  res.json({ settings: db.settings });
});

/* ---------------- demo seed ---------------- */

// platform admin — approves owners, manages plans, fixes data
function seedAdmin() {
  if (db.users.find(u => u.role === 'admin')) return;
  db.users.push({
    id: store.id('usr'), name: 'StaySathi Admin', phone: process.env.ADMIN_PHONE || '9999999999',
    email: 'admin@staysathi.in', businessType: 'hostel', language: 'en',
    plan: 'premium', role: 'admin', status: 'active', trialEndsAt: null, planExpiresAt: null,
    passwordHash: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
    createdAt: new Date().toISOString()
  });
  store.saveNow();
  console.log(`Seeded admin account: phone ${process.env.ADMIN_PHONE || '9999999999'} / password ${process.env.ADMIN_PASSWORD ? '(from env)' : 'admin123'}`);
}
seedAdmin();

function seedDemo() {
  if (db.users.find(u => u.phone === '9876543210')) return;
  const owner = {
    id: store.id('usr'), name: 'Ramesh Kumar', phone: '9876543210', email: 'demo@staysathi.in',
    businessType: 'hostel', language: 'en', plan: 'premium', role: 'owner', status: 'active',
    trialEndsAt: null, planExpiresAt: null,
    passwordHash: hashPassword('demo123'), createdAt: new Date().toISOString()
  };
  db.users.push(owner);

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const monthsAgo = (n, day = 5) => iso(new Date(today.getFullYear(), today.getMonth() - n, day));

  const tenantNames = [
    ['Suresh Babu', '9000000001'], ['Anil Reddy', '9000000002'], ['Kiran Rao', '9000000003'],
    ['Mahesh Goud', '9000000004'], ['Ravi Teja', '9000000005'], ['Vijay Kumar', '9000000006'],
    ['Srinivas N', '9000000007'], ['Praveen K', '9000000008'], ['Naresh Y', '9000000009'],
    ['Harish P', '9000000010'], ['Lokesh M', '9000000011'], ['Charan D', '9000000012'],
    ['Sandeep V', '9000000013'], ['Manoj T', '9000000014'], ['Ajay S', '9000000015'],
    ['Bharath R', '9000000016'], ['Nikhil G', '9000000017'], ['Sai Krishna', '9000000018']
  ];
  let ti = 0;

  const defs = [
    { name: 'Sri Sai Boys Hostel', type: 'hostel', icon: '🏨', color: '#6C5CE7', city: 'Hyderabad', pin: '1234', floors: 3, roomsPerFloor: 3, cap: 3, rent: 6500, tenantBudget: 10 },
    { name: 'Lakshmi Ladies PG', type: 'pg', icon: '🏡', color: '#00B894', city: 'Hyderabad', pin: null, floors: 2, roomsPerFloor: 3, cap: 2, rent: 8000, tenantBudget: 5 },
    { name: 'Green View Flats', type: 'flat', icon: '🏢', color: '#E17055', city: 'Secunderabad', pin: null, floors: 4, roomsPerFloor: 2, cap: 1, rent: 15000, tenantBudget: 3 }
  ];

  for (const def of defs) {
    let propTenants = 0;
    const prop = {
      id: store.id('prp'), ownerId: owner.id, name: def.name, type: def.type,
      address: 'Street 4, Madhapur', city: def.city, color: def.color, icon: def.icon,
      pinHash: def.pin ? hashPassword(def.pin) : null, createdAt: new Date().toISOString()
    };
    db.properties.push(prop);
    for (let f = 0; f < def.floors; f++) {
      const floor = { id: store.id('flr'), propertyId: prop.id, name: f === 0 ? 'Ground Floor' : `Floor ${f}`, order: f };
      db.floors.push(floor);
      for (let r = 0; r < def.roomsPerFloor; r++) {
        const room = {
          id: store.id('rom'), propertyId: prop.id, floorId: floor.id,
          name: `${f}0${r + 1}`, capacity: def.cap, rent: def.rent, createdAt: new Date().toISOString()
        };
        db.rooms.push(room);
        for (let b = 0; b < def.cap; b++) {
          const bed = { id: store.id('bed'), roomId: room.id, floorId: floor.id, propertyId: prop.id, name: `Bed ${b + 1}`, tenantId: null };
          db.beds.push(bed);
          // occupy roughly 70% of beds
          if (ti < tenantNames.length && propTenants < def.tenantBudget && (b + r + f) % 3 !== 2) {
            const [tn, tp] = tenantNames[ti++];
            propTenants++;
            const joinedMonths = 1 + ((ti * 7) % 5); // 1..5 months ago
            const tenant = {
              id: store.id('tnt'), propertyId: prop.id, bedId: bed.id, roomId: room.id, floorId: floor.id,
              name: tn, phone: tp, rent: def.rent, deposit: def.rent, maintenance: 0, openingDue: 0,
              joinDate: monthsAgo(joinedMonths), leaveDate: null,
              occupation: ['Student', 'Software Engineer', 'Shop Owner', 'Nurse'][ti % 4],
              aadhaar: '', photo: null, notes: '', kycStatus: 'pending', kycDocs: [],
              status: 'active', portalToken: crypto.randomBytes(12).toString('base64url'),
              createdAt: new Date().toISOString()
            };
            db.tenants.push(tenant);
            bed.tenantId = tenant.id;
            // pay all months except the most recent 0-2; every 4th tenant only
            // half-pays the last one so partial dues show up in the demo
            const unpaidTail = ti % 3; // 0,1,2
            const months = tenantCharges(tenant).filter(c => !c.opening).map(c => c.month);
            const paid = months.slice(0, Math.max(0, months.length - unpaidTail));
            for (let mi = 0; mi < paid.length; mi++) {
              const mk = paid[mi];
              const half = ti % 4 === 0 && mi === paid.length - 1;
              db.payments.push({
                id: store.id('pay'), tenantId: tenant.id, propertyId: prop.id, tenantName: tenant.name,
                amount: half ? Math.round(tenant.rent / 2) : tenant.rent, type: 'rent',
                mode: ti % 2 ? 'upi' : 'cash', note: half ? 'Partial payment' : '',
                date: `${mk}-06`, receiptNo: 'R' + Math.floor(100000 + Math.random() * 899999),
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      }
    }
    // expenses for last 3 months
    const cats = [['electricity', 3200], ['water', 900], ['groceries', 7800], ['maintenance', 1500], ['wifi', 1200]];
    for (let m = 0; m < 3; m++) {
      for (const [cat, amt] of cats.slice(0, 3 + (m % 3))) {
        db.expenses.push({
          id: store.id('exp'), propertyId: prop.id, category: cat,
          amount: amt + m * 100, note: '', date: monthsAgo(m, 10), createdAt: new Date().toISOString()
        });
      }
    }
    const demoStaff = [
      { id: store.id('stf'), propertyId: prop.id, name: 'Lakshmamma', role: 'cook', phone: '9111111111', salary: 9000, joinDate: monthsAgo(8), createdAt: new Date().toISOString() },
      { id: store.id('stf'), propertyId: prop.id, name: 'Yadaiah', role: 'watchman', phone: '9222222222', salary: 8000, joinDate: monthsAgo(11), createdAt: new Date().toISOString() }
    ];
    db.staff.push(...demoStaff);
    // last month's salaries were paid — this month is still due, so the demo
    // shows both the "paid" and "due" states of the salary feature
    for (const s of demoStaff) {
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const mk = monthKey(lastMonth);
      const payDate = monthsAgo(1, 3);
      const pay = {
        id: store.id('sal'), staffId: s.id, propertyId: prop.id,
        staffName: s.name, role: s.role, amount: s.salary, month: mk,
        mode: 'cash', note: '', date: payDate, createdAt: new Date().toISOString()
      };
      db.salaryPayments.push(pay);
      db.expenses.push({
        id: store.id('exp'), propertyId: prop.id, category: 'salary', amount: s.salary,
        note: `${s.name} (${s.role}) — ${monthLabel(mk)}`, salaryPaymentId: pay.id,
        date: payDate, createdAt: new Date().toISOString()
      });
    }
    db.complaints.push({ id: store.id('cmp'), propertyId: prop.id, category: 'plumbing', text: 'Bathroom tap leaking on first floor', tenantName: 'Suresh Babu', roomName: '101', status: 'open', createdAt: new Date().toISOString() });
    db.complaints.push({ id: store.id('cmp'), propertyId: prop.id, category: 'wifi', text: 'WiFi very slow at night', tenantName: 'Kiran Rao', roomName: '102', status: 'resolved', createdAt: monthsAgo(1), resolvedAt: new Date().toISOString() });
    db.meters.push({ id: store.id('mtr'), propertyId: prop.id, label: 'Main Meter', reading: 4520, prevReading: 4210, units: 310, ratePerUnit: 8, bill: 2480, date: monthsAgo(0, 2), createdAt: new Date().toISOString() });
    db.notices.push({ id: store.id('ntc'), ownerId: owner.id, propertyId: prop.id, text: 'Water tank cleaning this Sunday 10 AM. Please store water in advance.', createdAt: new Date().toISOString() });
  }
  logActivity(owner.id, null, '🎉', 'Demo data ready — explore StaySathi!');
  store.saveNow();
  console.log('Seeded demo account: phone 9876543210 / password demo123 (PIN for Sri Sai Boys Hostel: 1234)');
}
seedDemo();

/* ---------------- static frontend (production build) ---------------- */

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), err => { if (err) next(); });
});

app.listen(PORT, () => console.log(`StaySathi server running on http://localhost:${PORT}`));
