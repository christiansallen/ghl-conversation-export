const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const ghl = require("./services/ghl");
const store = require("./services/store");
const conversations = require("./services/conversations");
const pdf = require("./services/pdf");

const app = express();

app.use(express.json());

// --- Job store (in-memory, auto-expires after 1 hour) ---

const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

function createJob(contactId, locationId) {
  const id = crypto.randomUUID();
  const job = {
    id,
    contactId,
    locationId,
    status: "processing",
    progress: { phase: "starting", detail: "" },
    createdAt: Date.now(),
    filePath: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      // Delete PDF file if it exists
      if (job.filePath && fs.existsSync(job.filePath)) {
        fs.unlinkSync(job.filePath);
      }
      jobs.delete(id);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupJobs, 5 * 60 * 1000);

// --- Health check ---

app.get("/", (_req, res) => {
  res.json({ status: "ok", app: "ghl-conversation-export" });
});

// --- OAuth ---

app.get("/oauth/authorize", (_req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: `${config.appUrl}/oauth/callback`,
    client_id: config.ghl.clientId,
    scope: config.ghl.scopes,
  });
  res.redirect(
    `https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params}`
  );
});

app.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "Missing authorization code" });

  try {
    const data = await ghl.exchangeCodeForTokens(code);
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Installed</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .icon{width:64px;height:64px;background:#e8f5e9;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:24px}
  .icon svg{width:32px;height:32px;color:#4caf50}
  h1{font-size:24px;font-weight:700;color:#1a1a1a;margin-bottom:8px}
  p{font-size:16px;color:#666;line-height:1.5}
  .location{margin-top:16px;padding:12px 16px;background:#f5f5f5;border-radius:8px;font-size:14px;color:#888;font-family:monospace}
  .next{margin-top:24px;font-size:14px;color:#999}
</style></head><body>
<div class="card">
  <div class="icon"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
  <h1>App Installed</h1>
  <p>Conversation Export has been successfully installed on this account.</p>
  <div class="location">Location: ${data.locationId}</div>
  <p class="next">You can close this tab and access the app from your GHL sidebar.</p>
</div>
</body></html>`);
  } catch (err) {
    const errData = err.response?.data;
    const errMsg = errData ? JSON.stringify(errData) : err.message;
    console.error("OAuth callback error:", errMsg);
    console.error("Redirect URI used:", `${config.appUrl}/oauth/callback`);
    console.error("Client ID used:", config.ghl.clientId ? `${config.ghl.clientId.slice(0, 8)}...` : "MISSING");
    res.status(500).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Installation Failed</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:48px;max-width:520px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .icon{width:64px;height:64px;background:#ffeaea;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:24px}
  .icon svg{width:32px;height:32px;color:#e53935}
  h1{font-size:24px;font-weight:700;color:#1a1a1a;margin-bottom:8px}
  p{font-size:16px;color:#666;line-height:1.5}
  .error-detail{margin-top:20px;padding:12px 16px;background:#f5f5f5;border-radius:8px;font-size:13px;color:#888;font-family:monospace;text-align:left;word-break:break-all}
</style></head><body>
<div class="card">
  <div class="icon"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></div>
  <h1>Installation Failed</h1>
  <p>Something went wrong while installing the app. Please try again or contact support.</p>
  <div class="error-detail">${errMsg}</div>
</div>
</body></html>`);
  }
});

// --- SSO ---

app.post("/sso", (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "Missing SSO key" });

  try {
    const data = ghl.decryptSSOData(key);
    res.json(data);
  } catch (err) {
    console.error("SSO decryption error:", err.message);
    res.status(400).json({ error: "Invalid SSO key" });
  }
});

// --- Embedded app page ---

app.get("/app", (_req, res) => {
  res.sendFile(path.join(__dirname, "views", "app.html"));
});

// --- API: Contact search ---

app.get("/api/contacts/search", async (req, res) => {
  const { q, locationId } = req.query;
  if (!locationId) return res.status(400).json({ error: "Missing locationId" });
  if (!q || q.trim().length < 3) return res.status(400).json({ error: "Query too short" });

  try {
    const { data } = await ghl.apiCall(
      locationId,
      "GET",
      `${config.ghl.apiDomain}/contacts/?locationId=${locationId}&query=${encodeURIComponent(q.trim())}&limit=10`
    );

    const contacts = (data.contacts || []).map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "No Name",
      email: c.email || null,
      phone: c.phone || null,
    }));

    res.json({ contacts });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error("Contact search error:", detail);
    res.status(500).json({ error: "Failed to search contacts", detail });
  }
});

// --- API: Contact date range ---

app.get("/api/contacts/:contactId/date-range", async (req, res) => {
  const { locationId } = req.query;
  const { contactId } = req.params;
  if (!locationId) return res.status(400).json({ error: "Missing locationId" });

  try {
    const convos = await conversations.fetchAllConversations(locationId, contactId);

    if (convos.length === 0) {
      return res.json({ startDate: null, endDate: null });
    }

    // Collect all dates from conversation metadata
    const dates = [];
    for (const c of convos) {
      if (c.dateAdded) dates.push(new Date(c.dateAdded));
      if (c.lastMessageDate) dates.push(new Date(c.lastMessageDate));
      if (c.dateUpdated) dates.push(new Date(c.dateUpdated));
    }

    if (dates.length === 0) {
      return res.json({ startDate: null, endDate: null });
    }

    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));

    res.json({
      startDate: min.toISOString().split("T")[0],
      endDate: max.toISOString().split("T")[0],
    });
  } catch (err) {
    console.error("Date range error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch date range" });
  }
});

// --- API: Start export ---

app.post("/api/export", async (req, res) => {
  const { contactId, locationId, contactName, contactEmail, contactPhone, startDate, endDate } = req.body;
  if (!contactId || !locationId) {
    return res.status(400).json({ error: "Missing contactId or locationId" });
  }

  const job = createJob(contactId, locationId);
  res.json({ jobId: job.id });

  // Run export async
  runExport(job, {
    name: contactName || "Unknown",
    email: contactEmail || null,
    phone: contactPhone || null,
  }, { startDate: startDate || null, endDate: endDate || null }).catch((err) => {
    console.error(`Export job ${job.id} failed:`, err);
    job.status = "failed";
    job.error = err.message;
  });
});

async function runExport(job, contact, dateRange = {}) {
  try {
    // Fetch all messages
    let messages = await conversations.fetchContactHistory(
      job.locationId,
      job.contactId,
      (progress) => {
        job.progress = progress;
      }
    );

    // Filter by date range if specified
    if (dateRange.startDate) {
      const start = new Date(dateRange.startDate);
      start.setHours(0, 0, 0, 0);
      messages = messages.filter((m) => new Date(m.dateAdded) >= start);
    }
    if (dateRange.endDate) {
      const end = new Date(dateRange.endDate);
      end.setHours(23, 59, 59, 999);
      messages = messages.filter((m) => new Date(m.dateAdded) <= end);
    }

    job.progress = { phase: "generating_pdf", totalMessages: messages.length };

    // Generate PDF
    const exportsDir = store.ensureExportsDir();
    const safeName = (contact.name || "export").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeName}_${job.id.slice(0, 8)}.pdf`;
    const filePath = path.join(exportsDir, filename);

    await pdf.generatePDF(contact, messages, filePath);

    job.filePath = filePath;
    job.filename = filename;
    job.status = "complete";
    job.progress = {
      phase: "complete",
      totalMessages: messages.length,
    };

    console.log(`Export complete: ${filename} (${messages.length} messages)`);
  } catch (err) {
    job.status = "failed";
    job.error = err.message;
    throw err;
  }
}

// --- API: Check export status ---

app.get("/api/export/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    filename: job.filename || null,
  });
});

// --- API: Download PDF ---

app.get("/api/export/:jobId/download", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "complete") return res.status(400).json({ error: "Export not ready" });
  if (!job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.download(job.filePath, job.filename);
});

// --- Start ---

app.listen(config.port, () => {
  console.log(`GHL Conversation Export running on port ${config.port}`);
  console.log(`OAuth: ${config.appUrl}/oauth/authorize`);
  console.log(`App: ${config.appUrl}/app`);
});
