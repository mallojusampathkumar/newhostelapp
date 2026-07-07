// Tiny JSON-file datastore. Keeps everything in memory, persists to disk
// with a short debounce so rapid writes don't thrash the filesystem.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = {
  users: [],
  properties: [],
  floors: [],
  rooms: [],
  beds: [],
  tenants: [],
  payments: [],
  expenses: [],
  complaints: [],
  notices: [],
  staff: [],
  meters: [],
  activities: [],
  secret: null
};

let db;

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
      return db;
    } catch {
      // corrupt file — start fresh but keep a backup
      fs.copyFileSync(DB_FILE, DB_FILE + '.bak.' + Date.now());
    }
  }
  db = JSON.parse(JSON.stringify(EMPTY));
  return db;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  }, 150);
}

function saveNow() {
  clearTimeout(saveTimer);
  fs.writeFileSync(DB_FILE, JSON.stringify(db));
}

let counter = 0;
function id(prefix) {
  counter = (counter + 1) % 10000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

module.exports = { load, save, saveNow, id, get db() { return db; } };
