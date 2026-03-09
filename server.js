require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const { Resend } = require('resend');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Branding config (from env) ──────────────────────────
function getBrandConfig() {
  const name = process.env.BRAND_NAME || 'My Newsletter';
  const url = process.env.BRAND_URL || 'https://example.com';
  const color = process.env.BRAND_COLOR || '#4f46e5';
  const logoLetter = process.env.BRAND_LOGO_LETTER || name.charAt(0).toUpperCase();
  const ctaText = process.env.CTA_TEXT || 'Read More →';
  const secondaryUrl = process.env.SECONDARY_URL || '';
  const secondaryLabel = process.env.SECONDARY_LABEL || '';
  const footerText = (process.env.FOOTER_TEXT || 'You subscribed at {{BRAND_URL}} · Unsubscribe? Reply to this email.')
    .replace(/\{\{BRAND_URL\}\}/g, url);

  // Derive lighter shades from the brand color for email accents
  const colorLight = process.env.BRAND_COLOR_LIGHT || '#eef2ff';
  const colorBorder = process.env.BRAND_COLOR_BORDER || '#c7d2fe';

  return { name, url, color, colorLight, colorBorder, logoLetter, ctaText, secondaryUrl, secondaryLabel, footerText };
}

// Expose branding config to the frontend
app.get('/api/config', (req, res) => {
  res.json(getBrandConfig());
});

// Newsletter persistence helpers
const DATA_DIR = path.join(__dirname, 'data');
const NL_FILE = path.join(DATA_DIR, 'newsletters.json');

function loadNewsletters() {
  try {
    return JSON.parse(fs.readFileSync(NL_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveNewsletters(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(NL_FILE, JSON.stringify(list, null, 2));
}

// Google Sheets auth via service account
function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Shared function to fetch active subscribers
async function getActiveSubscribers() {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A:C',
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return { subscribers: [], total: 0, active: 0 };

  const headers = rows[0].map(h => h.toLowerCase().trim());
  const timestampIdx = headers.findIndex(h => h.includes('timestamp'));
  const emailIdx = headers.findIndex(h => h.includes('email'));
  const subscribeIdx = headers.findIndex(h => h.includes('subscribe'));

  const all = rows.slice(1).map(row => ({
    timestamp: row[timestampIdx] || '',
    email: row[emailIdx] || '',
    subscribed: (row[subscribeIdx] || '').toLowerCase().trim(),
  }));

  const active = all.filter(r => {
    const val = r.subscribed;
    return val === 'true' || val === 'yes' || val === '1' || val === 'subscribe' || val === 'subscribed';
  });

  return { subscribers: active, total: all.length, active: active.length };
}

// GET /api/subscribers — fetch active subscribers from Google Sheets
app.get('/api/subscribers', async (req, res) => {
  try {
    const data = await getActiveSubscribers();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/send — send email to all active subscribers
app.post('/api/send', async (req, res) => {
  const { subject, body, previewText, preview, id: draftId } = req.body;

  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and body are required' });
  }

  try {
    // Fetch active subscribers directly
    const { subscribers } = await getActiveSubscribers();

    if (!subscribers || subscribers.length === 0) {
      return res.status(400).json({ error: 'No active subscribers found' });
    }

    if (preview) {
      return res.json({ preview: true, count: subscribers.length, emails: subscribers.map(s => s.email) });
    }

    const brand = getBrandConfig();

    // Send to each subscriber
    const results = [];
    for (const sub of subscribers) {
      const result = await resend.emails.send({
        from: process.env.FROM_EMAIL || `${brand.name} <updates@example.com>`,
        to: sub.email,
        subject,
        html: buildEmailHtml(subject, body, previewText, brand),
      });
      results.push({ email: sub.email, id: result.data?.id, error: result.error });
    }

    const sent = results.filter(r => !r.error).length;
    const failed = results.filter(r => r.error).length;

    // Auto-save as sent newsletter
    const now = new Date().toISOString();
    const list = loadNewsletters();
    const existingIdx = draftId ? list.findIndex(n => n.id === draftId) : -1;
    if (existingIdx !== -1) {
      list[existingIdx].subject = subject;
      list[existingIdx].previewText = previewText || '';
      list[existingIdx].body = body;
      list[existingIdx].status = 'sent';
      list[existingIdx].updatedAt = now;
      list[existingIdx].sentAt = now;
      list[existingIdx].sentTo = sent;
    } else {
      list.push({
        id: String(Date.now()),
        subject,
        previewText: previewText || '',
        body,
        status: 'sent',
        createdAt: now,
        updatedAt: now,
        sentAt: now,
        sentTo: sent,
      });
    }
    saveNewsletters(list);

    res.json({ sent, failed, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/newsletters — list all saved newsletters
app.get('/api/newsletters', (req, res) => {
  const list = loadNewsletters().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(list);
});

// POST /api/newsletters — save a new draft
app.post('/api/newsletters', (req, res) => {
  const { subject, previewText, body } = req.body;
  const now = new Date().toISOString();
  const newsletter = {
    id: String(Date.now()),
    subject: subject || '',
    previewText: previewText || '',
    body: body || '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    sentTo: 0,
  };
  const list = loadNewsletters();
  list.push(newsletter);
  saveNewsletters(list);
  res.json(newsletter);
});

// PUT /api/newsletters/:id — update an existing draft
app.put('/api/newsletters/:id', (req, res) => {
  const { subject, previewText, body } = req.body;
  const list = loadNewsletters();
  const idx = list.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Newsletter not found' });
  list[idx].subject = subject ?? list[idx].subject;
  list[idx].previewText = previewText ?? list[idx].previewText;
  list[idx].body = body ?? list[idx].body;
  list[idx].updatedAt = new Date().toISOString();
  saveNewsletters(list);
  res.json(list[idx]);
});

// DELETE /api/newsletters/:id — delete a newsletter
app.delete('/api/newsletters/:id', (req, res) => {
  const list = loadNewsletters();
  const idx = list.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Newsletter not found' });
  const removed = list.splice(idx, 1)[0];
  saveNewsletters(list);
  res.json({ deleted: removed.id });
});

// Build clean email HTML — uses brand config from env
function buildEmailHtml(subject, body, previewText = '', brand) {
  const b = brand || getBrandConfig();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const COLOR = b.color;
  const COLOR_LIGHT = b.colorLight;
  const COLOR_BORDER = b.colorBorder;

  const renderInline = (text) => text
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#0f172a;font-weight:600">$1</strong>')
    .replace(/`(.*?)`/g, `<code style="font-family:'Courier New',monospace;font-size:12px;background:#f1f5f9;color:${COLOR};padding:2px 5px;border-radius:3px;border:1px solid #e2e8f0">$1</code>`)
    .replace(/\[(.*?)\]\((.*?)\)/g, `<a href="$2" style="color:${COLOR};text-decoration:underline;text-decoration-color:#a5b4fc">$1</a>`);

  const paragraphs = body.split('\n\n').filter(p => p.trim()).map(p => {
    const line = p.trim();

    // ## Section heading
    if (line.startsWith('## ')) {
      return `<tr><td style="padding:28px 0 12px">
        <p style="margin:0;font-family:helvetica,arial,sans-serif;font-size:11px;font-weight:600;color:${COLOR};letter-spacing:0.1em;text-transform:uppercase">${line.slice(3)}</p>
        <div style="margin-top:6px;height:1px;background:${COLOR_BORDER}"></div>
      </td></tr>`;
    }

    // Numbered item: "1. **Title**\nBody"
    const numMatch = line.match(/^(\d+)\.\s+\*\*(.*?)\*\*\n?([\s\S]*)/);
    if (numMatch) {
      const [, num, title, rest] = numMatch;
      return `<tr><td style="padding:0 0 16px">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid ${COLOR_BORDER};overflow:hidden">
          <tr>
            <td width="48" valign="top" style="padding:16px 0 16px 16px;background:${COLOR_LIGHT}">
              <table cellpadding="0" cellspacing="0"><tr><td style="width:28px;height:28px;background:${COLOR};border-radius:50%;text-align:center;vertical-align:middle">
                <span style="font-family:helvetica,arial,sans-serif;font-size:12px;font-weight:700;color:#ffffff;line-height:28px">${num}</span>
              </td></tr></table>
            </td>
            <td style="padding:16px 20px;background:#ffffff">
              <p style="margin:0 0 5px;font-family:helvetica,arial,sans-serif;font-size:15px;font-weight:600;color:#0f172a;line-height:1.4">${renderInline(title)}</p>
              ${rest.trim() ? `<p style="margin:0;font-family:helvetica,arial,sans-serif;font-size:14px;color:#475569;line-height:1.7">${renderInline(rest.trim().replace(/\n/g,'<br>'))}</p>` : ''}
            </td>
          </tr>
        </table>
      </td></tr>`;
    }

    // → callout
    if (line.startsWith('→ ') || line.startsWith('-> ')) {
      const text = line.startsWith('-> ') ? line.slice(3) : line.slice(2);
      return `<tr><td style="padding:0 0 16px">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR_LIGHT};border-left:3px solid ${COLOR};border-radius:0 6px 6px 0">
          <tr><td style="padding:12px 16px">
            <p style="margin:0;font-family:helvetica,arial,sans-serif;font-size:14px;color:#312e81;line-height:1.65">${renderInline(text)}</p>
          </td></tr>
        </table>
      </td></tr>`;
    }

    // Divider
    if (line === '---') {
      return `<tr><td style="padding:8px 0 20px"><div style="height:1px;background:#f1f5f9"></div></td></tr>`;
    }

    // Regular paragraph
    return `<tr><td style="padding:0 0 16px">
      <p style="margin:0;font-family:helvetica,arial,sans-serif;font-size:15px;color:#334155;line-height:1.75">${renderInline(line.replace(/\n/g,'<br>'))}</p>
    </td></tr>`;
  }).join('');

  // Build secondary button HTML only if configured
  const secondaryBtnHtml = b.secondaryUrl ? `
              <td style="padding-left:10px">
                <table cellpadding="0" cellspacing="0"><tr><td style="background:#ffffff;border-radius:7px;border:1px solid ${COLOR_BORDER}">
                  <a href="${b.secondaryUrl}" style="display:inline-block;padding:11px 22px;font-family:helvetica,arial,sans-serif;font-size:13px;font-weight:600;color:${COLOR};text-decoration:none">${b.secondaryLabel}</a>
                </td></tr></table>
              </td>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;-webkit-font-smoothing:antialiased">
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${previewText}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc">
    <tr><td align="center" style="padding:40px 16px 64px">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Meta bar -->
        <tr><td style="padding-bottom:16px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><span style="font-family:'Courier New',monospace;font-size:10px;color:#94a3b8">${dateStr}</span></td>
          </tr></table>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">

          <!-- Top color bar -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="height:4px;background:${COLOR}"></td></tr>
          </table>

          <!-- Logo header -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:24px 40px">
              <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td valign="middle">
                  <a href="${b.url}" style="text-decoration:none">
                    <table cellpadding="0" cellspacing="0"><tr>
                      <td style="width:36px;height:36px;background:${COLOR};border-radius:9px;text-align:center;vertical-align:middle">
                        <span style="font-family:helvetica,arial,sans-serif;font-size:18px;font-weight:700;color:#ffffff;line-height:36px">${b.logoLetter}</span>
                      </td>
                      <td style="padding-left:10px;vertical-align:middle">
                        <span style="font-family:helvetica,arial,sans-serif;font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-0.02em">${b.name}</span>
                      </td>
                    </tr></table>
                  </a>
                </td>
                <td align="right" valign="middle">
                  <a href="${b.url}" style="font-family:helvetica,arial,sans-serif;font-size:12px;color:#94a3b8;text-decoration:none">View online →</a>
                </td>
              </tr></table>
            </td></tr>
          </table>

          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:0 40px"><div style="height:1px;background:#f1f5f9"></div></td></tr>
          </table>

          <!-- Subject -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:28px 40px 0">
              <h1 style="margin:0 0 6px;font-family:helvetica,arial,sans-serif;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;letter-spacing:-0.02em">${subject}</h1>
              <p style="margin:0;font-family:helvetica,arial,sans-serif;font-size:12px;color:#94a3b8">From the ${b.name} team</p>
            </td></tr>
          </table>

          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:20px 40px 0"><div style="height:1px;background:#f1f5f9"></div></td></tr>
          </table>

          <!-- Body -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:24px 40px 8px">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${paragraphs}
              </table>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:8px 40px 36px">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="background:${COLOR};border-radius:7px">
                  <a href="${b.url}" style="display:inline-block;padding:11px 22px;font-family:helvetica,arial,sans-serif;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none">${b.ctaText}</a>
                </td>${secondaryBtnHtml}
              </tr></table>
            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 4px 0">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td>
              <span style="font-family:helvetica,arial,sans-serif;font-size:12px;font-weight:700;color:#cbd5e1">${b.name}</span>
            </td>
            <td align="right">
              <span style="font-family:helvetica,arial,sans-serif;font-size:11px;color:#cbd5e1">${b.footerText}</span>
            </td>
          </tr></table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Validate required env vars before starting
const required = ['RESEND_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`\nMissing required environment variables: ${missing.join(', ')}`);
  console.error('   Copy .env.example to .env and fill in the values.\n');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const brand = getBrandConfig();
app.listen(PORT, () => {
  console.log(`\n${brand.name} Mailer running at http://localhost:${PORT}\n`);
});
