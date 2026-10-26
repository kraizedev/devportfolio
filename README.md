# devportfolio

This is the portfolio site of Kris Belen. It is a draft preview with placeholders. PLACEHOLDER, PENDING and DRAFT labels are intentional until the real clips and stills are approved.

The fonts Fraunces and Inter are self-hosted under the SIL OFL licence. The licence files are in `public/assets/fonts`.

The site is a static front end plus a small Node.js back end. The back end stores contact-form submissions in a local SQLite file. It does not send email and it does not call any external service.

## Structure

- `public/` — the site (pages, CSS, JavaScript, fonts, images)
- `server.js` — Express server
- `test/contact.test.js` — API tests
- `data/` — SQLite database, created on first save and git-ignored
- `.env.example` — environment variable names and sample values

## Run locally

Requires Node.js 22 LTS. This project uses the built-in `node:sqlite` module. On Node 22 that module prints an experimental warning; the server still runs.

```bash
cp .env.example .env
npm install
npm start
```

`npm run dev` restarts the server when `server.js` changes. Pages and CSS are read from `public/` on each request.

The server listens on `PORT` (default 3000). Open `http://localhost:3000/`.

## Test

```bash
npm test
```

Tests use Node's built-in test runner and a temporary SQLite file. They cover contact validation, the honeypot, and the per-IP rate limit.

## API

### `GET /api/health`

Returns `200` and `{"ok":true}`.

### `POST /api/contact`

Accepts JSON or URL-encoded form fields:

| Field | Required | Rules |
| --- | --- | --- |
| `name` | yes | Text, 1–100 characters after trimming. No line breaks. |
| `email` | yes | Text, one email address, up to 254 characters. |
| `message` | yes | Text, 1–5000 characters after trimming. |
| `gotcha` | no | Honeypot. Leave it empty. Any other value is rejected and not saved. |

A valid submission returns `200` and `{"ok":true}`. The name, email, and message are HTML-escaped and then saved to the SQLite file at `DB_PATH`. Nothing is emailed.

Invalid input returns `400` and `{"ok":false,"error":"..."}`. The error is one of:

- `Invalid request.`
- `Name is required.`
- `Name must be 100 characters or fewer.`
- `Email is required.`
- `Email is not valid.`
- `Email must be 254 characters or fewer.`
- `Message is required.`
- `Message must be 5000 characters or fewer.`
- `Unable to send this message.` (honeypot)
- `Message is too large.` (`413`, body over 64kb)

Too many requests from the same direct client address return `429`, `Retry-After`, and `{"ok":false,"error":"Too many messages. Try again later."}`. The limit is `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` milliseconds. Every POST counts, including rejected ones. The limit uses the socket address. `X-Forwarded-For` is not trusted.

The contact section on the home page posts with `fetch` and keeps `mailto:EMAIL_PENDING` as a fallback link. `EMAIL_PENDING` is still a placeholder.

## Environment

See `.env.example`. Copy it to `.env`. Do not commit `.env`.

- `PORT` — HTTP port
- `DB_PATH` — SQLite file path
- `RATE_LIMIT_WINDOW_MS` — rate-limit window in milliseconds
- `RATE_LIMIT_MAX` — requests allowed per client address in that window

`data/` is git-ignored.

## Hosting

GitHub Pages cannot run this back end. Pages only serves static files, so `POST /api/contact` would not work there.

Hosting is not decided yet. This repository does not enable GitHub Pages, set a custom domain, or deploy anywhere.
