const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");

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

function readJson(filePath) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- Token storage (keyed by locationId) ---

function getTokens(locationId) {
  const all = readJson(TOKENS_FILE);
  return all[locationId] || null;
}

function saveTokens(locationId, tokenData) {
  const all = readJson(TOKENS_FILE);
  all[locationId] = {
    ...tokenData,
    updatedAt: new Date().toISOString(),
  };
  writeJson(TOKENS_FILE, all);
}

module.exports = {
  getTokens,
  saveTokens,
  ensureExportsDir,
  DATA_DIR,
};
