const PDFDocument = require("pdfkit");
const { convert } = require("html-to-text");
const fs = require("fs");

// Colors
const BLUE = "#2563eb";
const GREEN = "#16a34a";
const GRAY = "#6b7280";
const LIGHT_GRAY = "#e5e7eb";
const DARK = "#111827";

// Layout
const MARGIN = 50;
const PAGE_WIDTH = 612; // Letter
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 35;
const CONTENT_BOTTOM = FOOTER_Y - 15;

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatFullDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function channelLabel(type) {
  if (!type || typeof type !== "string") return "Message";
  const map = {
    TYPE_SMS: "SMS",
    TYPE_EMAIL: "Email",
    TYPE_CALL: "Call",
    TYPE_WHATSAPP: "WhatsApp",
    TYPE_FB_MESSENGER: "Facebook",
    TYPE_IG_DM: "Instagram",
    TYPE_LIVE_CHAT: "Live Chat",
    TYPE_CUSTOM_SMS: "SMS",
    TYPE_CUSTOM_EMAIL: "Email",
  };
  if (map[type]) return map[type];
  if (type.startsWith("TYPE_"))
    return type.replace("TYPE_", "").replace(/_/g, " ");
  return type;
}

function messageTypeLabel(msg) {
  if (msg.messageType === "CALL") return "Call";
  return channelLabel(msg.type) || channelLabel(msg.contentType) || "Message";
}

function stripHtml(html) {
  if (!html) return "";
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    ],
  });
}

/**
 * Generate a PDF from contact info and messages.
 */
function generatePDF(contact, messages, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `Conversation Export - ${contact.name || "Unknown"}`,
        Author: "GoHighLevel Conversation Export",
        Creator: "ghl-conversation-export",
      },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const exportDate = formatFullDate(new Date().toISOString());
    const ctx = { pageNum: 1, exportDate };

    // --- Cover page ---
    renderCoverPage(doc, contact, messages);

    // --- Messages ---
    if (messages.length > 0) {
      newPage(doc, ctx);
      renderMessages(doc, messages, ctx);
    }

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

function newPage(doc, ctx) {
  doc.addPage();
  ctx.pageNum++;
  doc.y = MARGIN;
}

function checkPageBreak(doc, ctx, needed) {
  if (doc.y + needed > PAGE_HEIGHT - MARGIN - 30) {
    newPage(doc, ctx);
    return true;
  }
  return false;
}

function renderCoverPage(doc, contact, messages) {
  doc.moveDown(4);
  doc.fontSize(28).font("Helvetica-Bold").fillColor(DARK);
  doc.text("CONVERSATION EXPORT", MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    align: "center",
  });

  doc.moveDown(1);

  doc
    .moveTo(MARGIN + 100, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN - 100, doc.y)
    .strokeColor(LIGHT_GRAY)
    .lineWidth(2)
    .stroke();

  doc.moveDown(2);

  doc.fontSize(12).font("Helvetica").fillColor(GRAY);
  doc.text("Contact", MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    align: "center",
  });
  doc.moveDown(0.3);
  doc.fontSize(20).font("Helvetica-Bold").fillColor(DARK);
  doc.text(contact.name || "Unknown Contact", MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    align: "center",
  });

  doc.moveDown(1);

  doc.fontSize(11).font("Helvetica").fillColor(GRAY);
  if (contact.email) {
    doc.text(`Email: ${contact.email}`, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
    doc.moveDown(0.3);
  }
  if (contact.phone) {
    doc.text(`Phone: ${contact.phone}`, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
    doc.moveDown(0.3);
  }

  doc.moveDown(2);

  doc
    .moveTo(MARGIN + 80, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN - 80, doc.y)
    .strokeColor(LIGHT_GRAY)
    .lineWidth(1)
    .stroke();
  doc.moveDown(1.5);

  const stats = getMessageStats(messages);
  const statsData = [
    { label: "Total Messages", value: messages.length.toLocaleString() },
    { label: "Date Range", value: stats.dateRange },
    {
      label: "Export Date",
      value: formatFullDate(new Date().toISOString()),
    },
  ];

  for (const stat of statsData) {
    doc.fontSize(10).font("Helvetica").fillColor(GRAY);
    doc.text(stat.label, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
    doc.moveDown(0.2);
    doc.fontSize(14).font("Helvetica-Bold").fillColor(DARK);
    doc.text(stat.value, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
    doc.moveDown(1);
  }

  if (stats.channels.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica").fillColor(GRAY);
    doc.text("Channels: " + stats.channels.join(", "), MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
  }
}

function getMessageStats(messages) {
  if (messages.length === 0) {
    return { dateRange: "N/A", channels: [] };
  }
  const first = messages[0];
  const last = messages[messages.length - 1];
  const dateRange = `${formatDate(first.dateAdded)} – ${formatDate(last.dateAdded)}`;
  const channelSet = new Set();
  for (const msg of messages) {
    channelSet.add(messageTypeLabel(msg));
  }
  return { dateRange, channels: [...channelSet] };
}

function renderMessages(doc, messages, ctx) {
  for (let i = 0; i < messages.length; i++) {
    renderMessage(doc, messages[i], i, ctx);
  }
}

function renderMessage(doc, msg, index, ctx) {
  const isOutbound = msg.direction === "outbound";
  const dirColor = isOutbound ? BLUE : GREEN;
  const dirLabel = isOutbound ? "OUTBOUND" : "INBOUND";
  const channel = messageTypeLabel(msg);
  const date = formatDate(msg.dateAdded);
  const time = formatTime(msg.dateAdded);

  checkPageBreak(doc, ctx, 60);

  // Separator line
  if (index > 0 && doc.y > MARGIN + 10) {
    doc.moveDown(0.5);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(PAGE_WIDTH - MARGIN, doc.y)
      .strokeColor(LIGHT_GRAY)
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.5);
  }

  // Header
  doc.fontSize(9).font("Helvetica-Bold").fillColor(dirColor);
  doc.text(`[${dirLabel}]`, MARGIN, doc.y, { continued: true });
  doc.font("Helvetica").fillColor(GRAY);
  doc.text(`   ${date}  ${time}  -  ${channel}`, { continued: false });
  doc.moveDown(0.3);

  // Body
  if (msg.messageType === "CALL" || channel === "Call") {
    renderCallMessage(doc, msg);
  } else if (channel === "Email") {
    renderEmailMessage(doc, msg);
  } else {
    renderTextMessage(doc, msg);
  }

  doc.moveDown(0.3);
}

function renderTextMessage(doc, msg) {
  const body = getMessageBody(msg);
  if (!body) return;

  doc.fontSize(10).font("Helvetica").fillColor(DARK);
  doc.text(body, MARGIN + 10, doc.y, {
    width: CONTENT_WIDTH - 20,
    lineGap: 2,
  });
  renderAttachments(doc, msg);
}

function renderEmailMessage(doc, msg) {
  if (msg.subject) {
    doc.fontSize(10).font("Helvetica-Bold").fillColor(DARK);
    doc.text(`Subject: ${msg.subject}`, MARGIN + 10, doc.y, {
      width: CONTENT_WIDTH - 20,
    });
    doc.moveDown(0.2);
  }

  if (msg.from || msg.to) {
    doc.fontSize(9).font("Helvetica").fillColor(GRAY);
    const fromTo = [msg.from, msg.to].filter(Boolean).join(" → ");
    doc.text(fromTo, MARGIN + 10, doc.y, { width: CONTENT_WIDTH - 20 });
    doc.moveDown(0.2);

    doc
      .moveTo(MARGIN + 10, doc.y)
      .lineTo(MARGIN + 210, doc.y)
      .dash(3, { space: 3 })
      .strokeColor(LIGHT_GRAY)
      .lineWidth(0.5)
      .stroke();
    doc.undash();
    doc.moveDown(0.3);
  }

  let body = "";
  if (msg.html || msg.body) {
    body = stripHtml(msg.html || msg.body);
  } else if (msg.text) {
    body = msg.text;
  }

  if (body) {
    const maxChars = 3000;
    const truncated = body.length > maxChars;
    const displayBody = truncated ? body.substring(0, maxChars) : body;

    doc.fontSize(10).font("Helvetica").fillColor(DARK);
    doc.text(displayBody, MARGIN + 10, doc.y, {
      width: CONTENT_WIDTH - 20,
      lineGap: 2,
    });

    if (truncated) {
      doc.moveDown(0.2);
      doc.fontSize(9).font("Helvetica-Oblique").fillColor(GRAY);
      doc.text(
        "[Email truncated — full content exceeds display limit]",
        MARGIN + 10,
        doc.y,
        { width: CONTENT_WIDTH - 20 }
      );
    }
  }

  renderAttachments(doc, msg);
}

function renderCallMessage(doc, msg) {
  doc.fontSize(10).font("Helvetica").fillColor(DARK);

  const parts = [];
  if (msg.callDuration) {
    parts.push(`Duration: ${formatDuration(msg.callDuration)}`);
  }
  if (msg.callStatus || msg.status) {
    parts.push(`Status: ${msg.callStatus || msg.status}`);
  }

  if (parts.length > 0) {
    doc.text(parts.join("  |  "), MARGIN + 10, doc.y, {
      width: CONTENT_WIDTH - 20,
    });
    doc.moveDown(0.2);
  }

  if (msg.transcription) {
    const transcriptText =
      typeof msg.transcription === "string"
        ? msg.transcription
        : JSON.stringify(msg.transcription);

    doc.fontSize(9).font("Helvetica-Oblique").fillColor(GRAY);
    doc.text("Transcription:", MARGIN + 10, doc.y, {
      width: CONTENT_WIDTH - 20,
    });
    doc.moveDown(0.1);
    doc.fontSize(10).font("Helvetica").fillColor(DARK);

    const maxChars = 2000;
    const truncated = transcriptText.length > maxChars;
    const displayText = truncated
      ? transcriptText.substring(0, maxChars)
      : transcriptText;

    doc.text(
      `"${displayText}${truncated ? "..." : ""}"`,
      MARGIN + 10,
      doc.y,
      { width: CONTENT_WIDTH - 20, lineGap: 2 }
    );
  }
}

function renderAttachments(doc, msg) {
  const attachments = msg.attachments || [];
  if (attachments.length === 0) return;

  doc.moveDown(0.2);
  doc.fontSize(9).font("Helvetica-Oblique").fillColor(GRAY);
  for (const att of attachments) {
    const name =
      typeof att === "string"
        ? att.split("/").pop()
        : att.name || att.url || "attachment";
    doc.text(`[attachment: ${name}]`, MARGIN + 10, doc.y, {
      width: CONTENT_WIDTH - 20,
    });
  }
}

function getMessageBody(msg) {
  return msg.body || msg.text || msg.message || "";
}

module.exports = { generatePDF };
