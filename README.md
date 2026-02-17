# GHL Conversation Export

One-click PDF export of GoHighLevel conversation history. Built for legal discovery, compliance, and client handoffs.

## What it does

- Embeds as a Custom Page inside GHL via SSO
- Search for any contact by name, email, or phone
- Exports their complete conversation history (SMS, email, calls, WhatsApp, etc.) as a single PDF
- Downloads directly in the browser — no email, no CSV

## Setup

```bash
npm install
cp .env.example .env
# Fill in your GHL app credentials in .env
npm run dev
```

### Required Scopes

```
conversations.readonly
conversations/message.readonly
contacts.readonly
```

### Marketplace Portal Config

1. Create your app at https://marketplace.gohighlevel.com
2. Set **Redirect URI** to `https://your-domain.com/oauth/callback`
3. Set **Custom Page URL** to `https://your-domain.com/app`
4. Generate an **SSO Key** in Advanced Settings > Auth
5. Add the three scopes listed above
6. No webhook or trigger URLs needed

## Architecture

```
src/
  index.js                  # Express routes (OAuth, SSO, API, app page)
  config.js                 # Environment config
  services/
    ghl.js                  # OAuth token management + authenticated API calls
    store.js                # File-based token storage
    conversations.js        # Paginated GHL conversation/message fetching
    pdf.js                  # PDFKit document builder
  views/
    app.html                # Embedded frontend (SSO, search, export, download)
data/                       # Runtime (gitignored)
  tokens.json
  exports/                  # Temporary PDF files, auto-cleaned after 1 hour
```

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Health check |
| `GET` | `/oauth/authorize` | Start OAuth flow |
| `GET` | `/oauth/callback` | Exchange code for tokens |
| `POST` | `/sso` | Decrypt SSO payload |
| `GET` | `/app` | Serve embedded frontend |
| `GET` | `/api/contacts/search` | Search contacts |
| `POST` | `/api/export` | Start async export job |
| `GET` | `/api/export/:jobId` | Poll job status |
| `GET` | `/api/export/:jobId/download` | Download PDF |

## Local Development

1. Run `npm run dev`
2. Use [ngrok](https://ngrok.com) to expose your local server
3. Update your marketplace app URLs to point to the ngrok URL
4. Install the app on a test sub-account via `/oauth/authorize`
5. Open the Custom Page in GHL to test the full flow
