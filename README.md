# Newsletter Mailer

A minimal, self-hosted newsletter admin panel. Reads subscribers from Google Sheets, sends beautiful emails via [Resend](https://resend.com), and lets you customize everything with your own branding.

**Built by the team at [Scrollypedia](https://scrollypedia.ai)** — [learn more](https://scrollypedia.ai/apps/newsletter-mailer) about why we built this.

### Admin UI — compose, preview, and send

![Admin UI](screenshots/admin-ui.png)

### Email Preview — see exactly how it renders

![Email Preview](screenshots/email-preview.png)

---

## Features

- Compose newsletters with a clean admin UI
- **Formatting toolbar** — insert headings, bold, code, links, images, callouts, and dividers with one click
- **Live preview** — see your newsletter rendered in real-time as you type
- **Image support** — embed images with `![alt](url)` syntax
- **Newsletter templates** — save and reuse your best layouts
- **Scheduling** — pick a date and time to send later; scheduled jobs survive server restarts
- Live email preview before sending
- Save drafts, manage newsletter history
- Auto-save to localStorage — drafts persist across page refreshes
- Subscriber list pulled from Google Sheets
- Fully customizable branding via environment variables — colors, logo, CTAs, footer text
- No database required (drafts and templates saved as JSON)

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A [Resend](https://resend.com) account (free tier: 100 emails/day, 3,000/month)
- A Google Cloud project with the Sheets API enabled
- A Google Sheet with your subscriber list

## Quick Start

```bash
git clone https://github.com/scrollypedia/newsletter-mailer.git
cd newsletter-mailer
npm install
cp .env.example .env
```

Fill in your `.env` (see [Configuration](#configuration) below), then:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

---

## Configuration

All configuration lives in a single `.env` file. Copy the example to get started:

```bash
cp .env.example .env
```

### 1. Resend (email sending)

1. Sign up at [resend.com](https://resend.com) (free tier available)
2. Go to **Domains** → add and verify your sending domain (e.g. `example.com`)
3. Go to **API Keys** → create one → paste into `RESEND_API_KEY`
4. Set `FROM_EMAIL` to match your verified domain, e.g. `Newsletter <updates@example.com>`

> **Note:** On the free tier you can also use the built-in `onboarding@resend.dev` address for testing before verifying your own domain.

### 2. Google Sheets (subscriber list)

**A. Create a Service Account:**

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Search for **Google Sheets API** and click **Enable**
4. Go to **IAM & Admin → Service Accounts → Create Service Account**
5. Give it any name (e.g. `newsletter-reader`), skip optional steps
6. Click the service account → **Keys → Add Key → Create new key → JSON**
7. Download the JSON key file

**B. Fill in your `.env`:**

From the downloaded JSON file, copy these two fields:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"
```

> **Important:** The private key must be wrapped in **double quotes** in your `.env` file. Keep the `\n` escape sequences as-is — do not replace them with actual newlines.

**C. Share your Google Sheet:**

- Open your Google Sheet → click **Share**
- Add the service account email (the `client_email` from the JSON) with **Viewer** access

**D. Get your Sheet ID:**

Your Sheet URL looks like: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`

Copy the ID between `/d/` and `/edit` and set:

```bash
GOOGLE_SHEET_ID=your_sheet_id_here
```

**E. Sheet range (optional):**

By default the app reads columns A through C from `Sheet1`. If your data is in a different sheet or range:

```bash
GOOGLE_SHEET_RANGE=Sheet1!A:C
```

### 3. Google Sheet Format

Your sheet needs a header row with these columns:

| timestamp | email | subscribe |
|-----------|-------|-----------|
| 2026-01-01 | user@example.com | true |
| 2026-01-02 | user2@example.com | false |

The `subscribe` column accepts: `true`, `yes`, `1`, `subscribe`, or `subscribed`.
Any other value (e.g. `false`, `no`, `unsubscribe`) = excluded from sends.

> **Tip:** You can connect a Google Form to this sheet so new subscribers are added automatically.

### 4. Branding

Customize the admin UI and sent emails entirely from your `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAND_NAME` | `My Newsletter` | Shown in the header, email logo, and footer |
| `BRAND_URL` | `https://example.com` | Your website — used in email links and CTA button |
| `BRAND_COLOR` | `#4f46e5` | Primary brand color (hex) for UI and emails |
| `BRAND_LOGO_LETTER` | *(first letter of name)* | Single character for the logo badge |
| `CTA_TEXT` | `Read More →` | Call-to-action button label in emails |
| `SECONDARY_URL` | *(empty)* | Optional second button link (e.g. YouTube channel) |
| `SECONDARY_LABEL` | *(empty)* | Label for the secondary button |
| `FOOTER_TEXT` | `You subscribed at {{BRAND_URL}}...` | Email footer text. Use `{{BRAND_URL}}` as a placeholder. |
| `FROM_EMAIL` | `Newsletter <updates@example.com>` | Sender address (must match a verified Resend domain) |
| `PORT` | `3000` | Server port |

---

## Usage

1. Open [http://localhost:3000](http://localhost:3000)
2. Your active subscribers appear in the sidebar (pulled from Google Sheets)
3. Compose your newsletter using the editor — use the **formatting toolbar** or type the syntax directly
4. Toggle **Live Preview** to see your content rendered in real-time
5. Click **Preview** to see the full email as recipients will receive it
6. **Save as Template** to reuse the layout later, or load a saved template from **Templates**
7. Send immediately with **Send Newsletter**, or pick a date/time and click **Schedule**
8. Drafts auto-save to localStorage and past newsletters are tracked in the sidebar

### Body Formatting

The compose editor supports a lightweight formatting syntax. Use the **formatting toolbar** to insert these, or type them directly:

```
## Section Heading
Creates an uppercase colored heading with a divider line.

**Bold text** renders as bold in the email.

`inline code` renders with a code background.

[Link text](https://example.com) creates a clickable link.

![Alt text](https://example.com/image.png)
Embeds an image (block-level, centered).

→ This is a callout block
Renders as a highlighted box with a colored left border.
You can also use -> instead of →.

1. **Numbered Item Title**
Description text below the title.
Renders as a styled numbered card.

---
Horizontal divider line.
```

Separate blocks with a blank line between them.

---

## Deployment

This is a standard Node.js app. Deploy anywhere that runs Node:

- **Railway / Render / Fly.io** — connect your repo and set the env vars in the dashboard
- **VPS / Droplet** — clone, `npm install`, set `.env`, run with `pm2 start server.js` or similar
- **Docker** — wrap in a simple Dockerfile (Node 18 alpine + `npm ci` + `CMD ["node", "server.js"]`)

The app stores drafts in a local `data/` directory as JSON. For persistent storage on ephemeral platforms (Railway, Render), mount a volume at `./data`.

---

## Project Structure

```
├── server.js            # Express server, API routes, email template builder, scheduler
├── public/
│   └── index.html       # Admin UI (single-page app)
├── data/
│   ├── newsletters.json # Auto-created — saved drafts & sent history
│   └── templates.json   # Auto-created — saved newsletter templates
├── screenshots/         # README screenshots
├── .env.example         # Template for all configuration
└── package.json
```

## License

MIT — see [LICENSE](LICENSE).
