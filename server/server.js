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
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const userId = readToken(token);
  const user = userId && db.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Please login again' });
  req.user = user;
  next();
}
function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
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

/* ---------------- dues engine ---------------- */
// A tenant owes rent for every month from their join month up to the current
// month (based on their monthly due day). Paid months are matched by `month`
// tags on payments ("YYYY-MM").
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

function expectedMonths(tenant, now = new Date()) {
  const join = new Date(tenant.joinDate);
  if (isNaN(join) || join > now) return [];
  const months = [];
  const cur = new Date(join.getFullYear(), join.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cur <= last) {
    months.push(monthKey(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function tenantDues(tenant) {
  const months = expectedMonths(tenant);
  const paidMonths = new Set(
    db.payments.filter(p => p.tenantId === tenant.id).flatMap(p => p.months || [])
  );
  const unpaid = months.filter(m => !paidMonths.has(m));
  return {
    unpaidMonths: unpaid,
    dueAmount: unpaid.length * (Number(tenant.rent) || 0),
    monthsStayed: months.length
  };
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
  const user = {
    id: store.id('usr'),
    name: String(name).trim(),
    phone: String(phone),
    email: email || '',
    businessType: businessType || 'hostel',
    language: language || 'en',
    plan: 'free',
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  logActivity(user.id, null, '🎉', `Welcome to StaySathi, ${user.name}!`);
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

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

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
  res.json({ properties: list, totals, activities: db.activities.filter(a => a.ownerId === req.user.id).slice(0, 20) });
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
  for (const key of ['floors', 'rooms', 'beds', 'tenants', 'payments', 'expenses', 'complaints', 'notices', 'staff', 'meters']) {
    db[key] = db[key].filter(x => x.propertyId !== pid);
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
  const { name, phone, rent, deposit, joinDate, occupation, aadhaar, photo, notes } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Tenant name and phone are required' });
  const room = db.rooms.find(r => r.id === bed.roomId);
  const tenant = {
    id: store.id('tnt'),
    propertyId: prop.id, bedId: bed.id, roomId: bed.roomId, floorId: bed.floorId,
    name: String(name).trim(), phone: String(phone),
    rent: Number(rent) || room?.rent || 0,
    deposit: Number(deposit) || 0,
    joinDate: joinDate || new Date().toISOString().slice(0, 10),
    occupation: occupation || '', aadhaar: aadhaar || '', photo: photo || null,
    notes: notes || '',
    kycStatus: aadhaar ? 'submitted' : 'pending',
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
  const fields = ['name', 'phone', 'occupation', 'aadhaar', 'photo', 'notes', 'joinDate', 'kycStatus'];
  for (const f of fields) if (req.body?.[f] !== undefined) tenant[f] = req.body[f];
  if (req.body?.rent !== undefined) tenant.rent = Number(req.body.rent) || 0;
  if (req.body?.deposit !== undefined) tenant.deposit = Number(req.body.deposit) || 0;
  store.save();
  res.json({ tenant });
});

app.post('/api/tenants/:id/vacate', auth, (req, res) => {
  const tenant = db.tenants.find(t => t.id === req.params.id);
  const prop = tenant && db.properties.find(p => p.id === tenant.propertyId && p.ownerId === req.user.id);
  if (!prop) return res.status(404).json({ error: 'Tenant not found' });
  tenant.status = 'vacated';
  tenant.vacatedAt = new Date().toISOString();
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
  const { amount, months, mode, note, date } = req.body || {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  const receiptNo = 'R' + Date.now().toString().slice(-8);
  const payment = {
    id: store.id('pay'),
    tenantId: tenant.id, propertyId: tenant.propertyId,
    tenantName: tenant.name,
    amount: Number(amount),
    months: Array.isArray(months) && months.length ? months : [monthKey(new Date())],
    mode: mode || 'cash',
    note: note || '',
    date: date || new Date().toISOString().slice(0, 10),
    receiptNo,
    createdAt: new Date().toISOString()
  };
  db.payments.push(payment);
  logActivity(req.user.id, prop.id, '💰', `₹${payment.amount} rent received from ${tenant.name} (${payment.mode.toUpperCase()})`);
  store.saveNow();
  res.json({ payment });
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
      joinDate: tenant.joinDate, kycStatus: tenant.kycStatus
    },
    property: prop ? { name: prop.name, icon: prop.icon, city: prop.city, type: prop.type } : null,
    owner: owner ? { name: owner.name, phone: owner.phone } : null,
    roomName: room?.name || '', dues, payments, notices, complaints
  });
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
  if (prop) logActivity(prop.ownerId, prop.id, '🛠️', `${tenant.name} raised a complaint (${complaint.category}) at ${prop.name}`);
  store.saveNow();
  res.json({ complaint });
});

// tenant says "I have paid" → owner sees it in the activity feed and can record it
app.post('/api/portal/:token/paid-claim', (req, res) => {
  const tenant = portalTenant(req, res); if (!tenant) return;
  const prop = db.properties.find(p => p.id === tenant.propertyId);
  const amount = Number(req.body?.amount) || 0;
  const note = String(req.body?.note || '').slice(0, 200);
  if (amount <= 0) return res.status(400).json({ error: 'Enter the amount you paid' });
  if (prop) {
    logActivity(prop.ownerId, prop.id, '💸',
      `${tenant.name} says they paid ₹${amount}${note ? ` (${note})` : ''} — verify & record it`);
  }
  store.saveNow();
  res.json({ ok: true });
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
  res.json({ staff: list.map(s => ({ ...s, propertyName: db.properties.find(p => p.id === s.propertyId)?.name })) });
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
  const series = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = monthKey(d);
    const income = db.payments.filter(p => ids.has(p.propertyId) && (p.date || '').startsWith(mk)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const expense = db.expenses.filter(e => ids.has(e.propertyId) && (e.date || '').startsWith(mk)).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    series.push({ month: mk, label: d.toLocaleString('en', { month: 'short' }), income, expense, profit: income - expense });
  }
  const byCategory = {};
  const mkNow = monthKey(now);
  for (const e of db.expenses.filter(e => ids.has(e.propertyId) && (e.date || '').startsWith(mkNow))) {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  }
  res.json({ series, expenseByCategory: byCategory });
});

app.get('/api/activities', auth, (req, res) => {
  res.json({ activities: db.activities.filter(a => a.ownerId === req.user.id).slice(0, 50) });
});

/* ---------------- demo seed ---------------- */

function seedDemo() {
  if (db.users.find(u => u.phone === '9876543210')) return;
  const owner = {
    id: store.id('usr'), name: 'Ramesh Kumar', phone: '9876543210', email: 'demo@staysathi.in',
    businessType: 'hostel', language: 'en', plan: 'premium',
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
              name: tn, phone: tp, rent: def.rent, deposit: def.rent, joinDate: monthsAgo(joinedMonths),
              occupation: ['Student', 'Software Engineer', 'Shop Owner', 'Nurse'][ti % 4],
              aadhaar: '', photo: null, notes: '', kycStatus: ti % 3 === 0 ? 'pending' : 'verified',
              status: 'active', portalToken: crypto.randomBytes(12).toString('base64url'),
              createdAt: new Date().toISOString()
            };
            db.tenants.push(tenant);
            bed.tenantId = tenant.id;
            // pay all months except leave the most recent 0-2 months unpaid
            const unpaidTail = ti % 3; // 0,1,2
            const months = expectedMonths(tenant);
            const paid = months.slice(0, Math.max(0, months.length - unpaidTail));
            for (const mk of paid) {
              db.payments.push({
                id: store.id('pay'), tenantId: tenant.id, propertyId: prop.id, tenantName: tenant.name,
                amount: tenant.rent, months: [mk], mode: ti % 2 ? 'upi' : 'cash', note: '',
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
    db.staff.push({ id: store.id('stf'), propertyId: prop.id, name: 'Lakshmamma', role: 'cook', phone: '9111111111', salary: 9000, joinDate: monthsAgo(8), createdAt: new Date().toISOString() });
    db.staff.push({ id: store.id('stf'), propertyId: prop.id, name: 'Yadaiah', role: 'watchman', phone: '9222222222', salary: 8000, joinDate: monthsAgo(11), createdAt: new Date().toISOString() });
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
