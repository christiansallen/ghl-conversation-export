const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DATA_DIR = path.join(__dirname, "../../data");

// --- PostgreSQL for token storage (persists across deploys) ---

let pool = null;
let dbReady = false;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  pool
    .query(
      `CREATE TABLE IF NOT EXISTS tokens (
        location_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`
    )
    .then(() => {
      dbReady = true;
      console.log("Token storage: PostgreSQL ready");
    })
    .catch((err) => {
      console.error("PostgreSQL init failed, falling back to file storage:", err.message);
      pool = null;
    });
} else {
  console.log("Token storage: file-based (no DATABASE_URL set)");
}

// --- File-based fallback (for local dev) ---

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureExportsDir() {
  const exportsDir = path.join(DATA_DIR, "exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  return exportsDir;
}

const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");

function readJson(filePath) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- Token storage ---

async function getTokens(locationId) {
  if (pool) {
    const { rows } = await pool.query(
      "SELECT data FROM tokens WHERE location_id = $1",
      [locationId]
    );
    return rows.length > 0 ? rows[0].data : null;
  }

  // File fallback
  const all = readJson(TOKENS_FILE);
  return all[locationId] || null;
}

async function saveTokens(locationId, tokenData) {
  const data = { ...tokenData, updatedAt: new Date().toISOString() };

  if (pool) {
    await pool.query(
      `INSERT INTO tokens (location_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (location_id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [locationId, JSON.stringify(data)]
    );
  }

  // Always write to file too (for local dev and as backup)
  try {
    const all = readJson(TOKENS_FILE);
    all[locationId] = data;
    writeJson(TOKENS_FILE, all);
  } catch (err) {
    // File write may fail on Railway, that's OK if we have DB
    if (!pool) throw err;
  }
}

module.exports = {
  getTokens,
  saveTokens,
  ensureExportsDir,
  DATA_DIR,
};
