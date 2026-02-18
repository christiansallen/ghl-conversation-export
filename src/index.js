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
  if (!q || q.trim().length < 2) return res.status(400).json({ error: "Query too short" });

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
    console.error("Contact search error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to search contacts" });
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

// --- API: Demo export (sample data, no GHL needed) ---

app.post("/api/demo-export", (_req, res) => {
  const job = createJob("demo", "demo");
  res.json({ jobId: job.id });

  runDemoExport(job).catch((err) => {
    console.error(`Demo export job ${job.id} failed:`, err);
    job.status = "failed";
    job.error = err.message;
  });
});

async function runDemoExport(job) {
  const contact = {
    name: "Sarah Mitchell",
    email: "sarah.mitchell@example.com",
    phone: "+1 (555) 847-2930",
  };

  // Simulate progress phases with delays
  job.progress = { phase: "conversations", count: 3 };
  await new Promise((r) => setTimeout(r, 800));

  job.progress = { phase: "fetching_messages", totalConversations: 3, completedConversations: 1, totalMessages: 12 };
  await new Promise((r) => setTimeout(r, 600));
  job.progress = { phase: "fetching_messages", totalConversations: 3, completedConversations: 2, totalMessages: 24 };
  await new Promise((r) => setTimeout(r, 600));
  job.progress = { phase: "fetching_messages", totalConversations: 3, completedConversations: 3, totalMessages: 37 };
  await new Promise((r) => setTimeout(r, 400));

  job.progress = { phase: "transcriptions", total: 2, completed: 1 };
  await new Promise((r) => setTimeout(r, 500));
  job.progress = { phase: "transcriptions", total: 2, completed: 2 };
  await new Promise((r) => setTimeout(r, 300));

  job.progress = { phase: "generating_pdf", totalMessages: 37 };

  const messages = getDemoMessages();
  const exportsDir = store.ensureExportsDir();
  const filename = `Sarah_Mitchell_demo.pdf`;
  const filePath = path.join(exportsDir, filename);

  await pdf.generatePDF(contact, messages, filePath);

  job.filePath = filePath;
  job.filename = filename;
  job.status = "complete";
  job.progress = { phase: "complete", totalMessages: messages.length };
  console.log(`Demo export complete: ${filename}`);
}

function getDemoMessages() {
  return [
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-03T14:15:00Z",
      body: "Hi Sarah, this is Dr. Thompson's office. Just a reminder about your appointment tomorrow at 2:00 PM. Please reply YES to confirm or call us to reschedule.",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-03T14:22:00Z",
      body: "YES - confirmed! Thank you for the reminder. Should I bring anything?",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-03T14:25:00Z",
      body: "Great, you're all set! Just bring your insurance card and photo ID. See you tomorrow!",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-03T14:26:00Z",
      body: "Perfect, see you then!",
    },
    {
      direction: "outbound",
      messageType: "Email",
      type: "TYPE_EMAIL",
      dateAdded: "2024-01-05T09:00:00Z",
      subject: "Your Visit Summary - January 4, 2024",
      from: "office@thompsonmedical.com",
      to: "sarah.mitchell@example.com",
      html: "<p>Dear Sarah,</p><p>Thank you for visiting Thompson Medical Group yesterday. Here is a summary of your visit:</p><ul><li><strong>Provider:</strong> Dr. James Thompson, MD</li><li><strong>Visit Type:</strong> Annual Wellness Exam</li><li><strong>Date:</strong> January 4, 2024</li></ul><p>Based on our discussion, we recommend the following next steps:</p><ol><li>Schedule a follow-up blood work appointment within the next 2 weeks</li><li>Continue current medication as prescribed</li><li>Increase daily water intake to 8 glasses per day</li></ol><p>Your lab results should be available within 5-7 business days. We will notify you via this email when they are ready.</p><p>If you have any questions or concerns, please don't hesitate to reach out.</p><p>Best regards,<br>Thompson Medical Group<br>(555) 847-1000</p>",
    },
    {
      direction: "inbound",
      messageType: "Email",
      type: "TYPE_EMAIL",
      dateAdded: "2024-01-05T11:30:00Z",
      subject: "Re: Your Visit Summary - January 4, 2024",
      from: "sarah.mitchell@example.com",
      to: "office@thompsonmedical.com",
      html: "<p>Thank you for sending this over! Quick question - for the blood work, do I need to fast beforehand? Also, can I schedule that through the patient portal or should I call?</p><p>Thanks,<br>Sarah</p>",
    },
    {
      direction: "outbound",
      messageType: "Email",
      type: "TYPE_EMAIL",
      dateAdded: "2024-01-05T13:15:00Z",
      subject: "Re: Your Visit Summary - January 4, 2024",
      from: "office@thompsonmedical.com",
      to: "sarah.mitchell@example.com",
      html: "<p>Hi Sarah,</p><p>Yes, please fast for 12 hours before the blood work (water is fine). You can schedule through the patient portal under \"Lab Appointments\" or call us at (555) 847-1000.</p><p>Best,<br>Front Desk Team</p>",
    },
    {
      direction: "inbound",
      messageType: "CALL",
      type: "TYPE_CALL",
      dateAdded: "2024-01-08T11:30:00Z",
      callDuration: 272,
      status: "completed",
      callStatus: "completed",
      transcription: "Hi, this is Sarah Mitchell calling. I'm trying to schedule my blood work appointment that Dr. Thompson ordered. I was wondering if you have anything available this Thursday or Friday morning? I need to fast beforehand so morning would work best for me... Yes, Thursday at 8 AM works perfectly. And this is at the main office on Oak Street, right? Great. Do I need to check in at the front desk or go directly to the lab? OK, front desk first, got it. Thank you so much!",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-10T08:00:00Z",
      body: "Hi Sarah, reminder: your blood work appointment is tomorrow (Thu, Jan 11) at 8:00 AM. Remember to fast for 12 hours before - water is OK. See you then!",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-10T08:05:00Z",
      body: "Thank you! I'll be there. Already set my alarm",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-11T09:30:00Z",
      body: "Thanks for coming in today, Sarah! Your lab results will be ready in 5-7 business days. We'll send them to you as soon as they're in.",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-11T09:35:00Z",
      body: "Thanks! The process was super quick. Looking forward to the results.",
    },
    {
      direction: "outbound",
      messageType: "Email",
      type: "TYPE_EMAIL",
      dateAdded: "2024-01-18T10:00:00Z",
      subject: "Your Lab Results Are Ready",
      from: "office@thompsonmedical.com",
      to: "sarah.mitchell@example.com",
      html: "<p>Dear Sarah,</p><p>Your lab results from January 11 are now available. Here is a summary:</p><table border='1' cellpadding='8' cellspacing='0' style='border-collapse:collapse'><tr><th>Test</th><th>Result</th><th>Reference Range</th></tr><tr><td>Complete Blood Count</td><td>Normal</td><td>-</td></tr><tr><td>Comprehensive Metabolic Panel</td><td>Normal</td><td>-</td></tr><tr><td>Lipid Panel - Total Cholesterol</td><td>210 mg/dL</td><td>&lt;200 mg/dL</td></tr><tr><td>Lipid Panel - HDL</td><td>62 mg/dL</td><td>&gt;40 mg/dL</td></tr><tr><td>Lipid Panel - LDL</td><td>128 mg/dL</td><td>&lt;100 mg/dL</td></tr><tr><td>Thyroid (TSH)</td><td>2.1 mIU/L</td><td>0.4-4.0 mIU/L</td></tr><tr><td>Vitamin D</td><td>28 ng/mL</td><td>30-100 ng/mL</td></tr></table><p>Most results are within normal range. Dr. Thompson has noted that your cholesterol is slightly elevated and your Vitamin D is slightly low. He recommends:</p><ul><li>Consider dietary adjustments to reduce LDL cholesterol</li><li>Start a Vitamin D3 supplement (2000 IU daily)</li><li>Recheck levels in 6 months</li></ul><p>Full detailed results are available in your patient portal. If you'd like to discuss these results with Dr. Thompson, please schedule a follow-up appointment.</p><p>Best regards,<br>Thompson Medical Group</p>",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-18T10:45:00Z",
      body: "Just got the lab results email. Everything looks good except the cholesterol and vitamin D. Can I schedule a quick phone call with Dr. Thompson to discuss?",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-18T11:00:00Z",
      body: "Of course! Dr. Thompson has a phone consultation slot available this Friday (Jan 19) at 3:30 PM. Would that work for you?",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-18T11:02:00Z",
      body: "Friday at 3:30 works great!",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-18T11:05:00Z",
      body: "You're booked! Dr. Thompson will call you at (555) 847-2930 on Friday at 3:30 PM.",
    },
    {
      direction: "outbound",
      messageType: "CALL",
      type: "TYPE_CALL",
      dateAdded: "2024-01-19T15:30:00Z",
      callDuration: 485,
      status: "completed",
      callStatus: "completed",
      transcription: "Hi Sarah, this is Dr. Thompson. I'm calling about your lab results. Overall everything looks really good. Your CBC and metabolic panel are perfectly normal, thyroid is great. The two things I want to address are the cholesterol and vitamin D. Your total cholesterol at 210 is just slightly above the ideal range, and your LDL at 128 is a bit high. Now, this isn't alarming at your age, but I'd like to see us bring those numbers down. I'd recommend focusing on reducing saturated fats - things like red meat, full-fat dairy, fried foods. Adding more omega-3 rich foods like salmon, walnuts, and flaxseed can also help. For the vitamin D, at 28 you're just slightly below the optimal range. I'd recommend picking up a Vitamin D3 supplement, 2000 IU daily, you can find it at any pharmacy. Take it with a meal that has some fat in it for better absorption. Let's recheck both in about 6 months. Sound good? Great, any other questions? OK, take care Sarah!",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-19T16:00:00Z",
      body: "Thank you Dr. Thompson! That was really helpful. I'll pick up the vitamin D supplement today and start making those diet changes. See you in 6 months!",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-01-19T16:05:00Z",
      body: "Sounds like a plan, Sarah! We'll send you a reminder when it's time to schedule your 6-month follow-up. Don't hesitate to reach out if you have any questions in the meantime.",
    },
    {
      direction: "outbound",
      messageType: "Email",
      type: "TYPE_EMAIL",
      dateAdded: "2024-01-19T16:30:00Z",
      subject: "Phone Consultation Summary - Dr. Thompson",
      from: "office@thompsonmedical.com",
      to: "sarah.mitchell@example.com",
      html: "<p>Dear Sarah,</p><p>Here is a summary of your phone consultation with Dr. Thompson today:</p><p><strong>Recommendations:</strong></p><ul><li>Reduce saturated fat intake (red meat, full-fat dairy, fried foods)</li><li>Increase omega-3 foods (salmon, walnuts, flaxseed)</li><li>Start Vitamin D3 supplement - 2000 IU daily with a meal</li><li>Recheck cholesterol and Vitamin D in 6 months (July 2024)</li></ul><p>A reminder will be sent when it's time to schedule your follow-up appointment.</p><p>Best regards,<br>Thompson Medical Group</p>",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-15T09:00:00Z",
      body: "Hi Sarah! It's been about 6 months since your last blood work. Dr. Thompson recommends scheduling a follow-up to recheck your cholesterol and Vitamin D levels. Would you like to book an appointment?",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-15T10:30:00Z",
      body: "Yes! I've been taking the vitamin D and eating way better. Excited to see if the numbers improved. Do you have anything available early next week?",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-15T10:35:00Z",
      body: "That's great to hear! We have Tuesday June 18 at 7:30 AM available for fasting blood work. Same 12-hour fast, water is fine. Want me to book it?",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-15T10:36:00Z",
      body: "Yes please!",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-15T10:40:00Z",
      body: "Done! You're booked for Tuesday, June 18 at 7:30 AM. Remember to fast for 12 hours beforehand. We'll send a reminder the day before.",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-17T08:00:00Z",
      body: "Hi Sarah, reminder: blood work tomorrow (Tue, June 18) at 7:30 AM. Fast for 12 hours - water is OK. See you in the morning!",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-17T08:10:00Z",
      body: "Got it, thanks!",
    },
    {
      direction: "outbound",
      messageType: "Email",
      type: "TYPE_EMAIL",
      dateAdded: "2024-06-25T10:00:00Z",
      subject: "Follow-Up Lab Results - June 2024",
      from: "office@thompsonmedical.com",
      to: "sarah.mitchell@example.com",
      html: "<p>Dear Sarah,</p><p>Great news! Your follow-up lab results show significant improvement:</p><table border='1' cellpadding='8' cellspacing='0' style='border-collapse:collapse'><tr><th>Test</th><th>Jan 2024</th><th>Jun 2024</th><th>Reference Range</th></tr><tr><td>Total Cholesterol</td><td>210 mg/dL</td><td>192 mg/dL</td><td>&lt;200 mg/dL</td></tr><tr><td>LDL</td><td>128 mg/dL</td><td>108 mg/dL</td><td>&lt;100 mg/dL</td></tr><tr><td>HDL</td><td>62 mg/dL</td><td>65 mg/dL</td><td>&gt;40 mg/dL</td></tr><tr><td>Vitamin D</td><td>28 ng/mL</td><td>45 ng/mL</td><td>30-100 ng/mL</td></tr></table><p>Your total cholesterol is now within the normal range, and your Vitamin D has improved significantly! LDL is still slightly above optimal but trending in the right direction. Dr. Thompson recommends continuing your current diet and supplement routine.</p><p>Next check-up: Annual wellness exam in January 2025.</p><p>Keep up the great work!</p><p>Best regards,<br>Thompson Medical Group</p>",
    },
    {
      direction: "inbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-25T10:30:00Z",
      body: "This is amazing!! So happy to see those numbers come down. The diet changes have been easier than I expected honestly. Thank you all so much for the support!",
    },
    {
      direction: "outbound",
      messageType: "SMS",
      type: "TYPE_SMS",
      dateAdded: "2024-06-25T10:35:00Z",
      body: "We're so proud of your progress, Sarah! Keep it up and we'll see you in January for your annual wellness exam. Have a wonderful summer!",
    },
  ];
}

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
