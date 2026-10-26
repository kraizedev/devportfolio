"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { DatabaseSync } = require("node:sqlite");

const PUBLIC_DIR = path.join(__dirname, "public");
const NOT_FOUND_PAGE = path.join(PUBLIC_DIR, "404.html");

const LIMITS = {
  name: 100,
  email: 254,
  message: 5000,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readPositiveInt(raw, fallback, label) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(label + " must be a positive integer");
  }
  return value;
}

function readPort() {
  const port = readPositiveInt(process.env.PORT, 3000, "PORT");
  if (port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  return port;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function own(body, key) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  return body[key];
}

function requireText(value, label, max) {
  if (value === undefined || value === null) return { error: label + " is required." };
  if (typeof value !== "string" || value.includes("\0")) return { error: "Invalid request." };
  const trimmed = value.trim();
  if (trimmed === "") return { error: label + " is required." };
  if (trimmed.length > max) return { error: label + " must be " + max + " characters or fewer." };
  return { value: trimmed };
}

function validateContact(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid request." };
  }

  const honeypot = own(body, "gotcha");
  if (honeypot !== undefined && honeypot !== null) {
    if (typeof honeypot !== "string" || honeypot !== "") {
      return { error: "Unable to send this message." };
    }
  }

  const name = requireText(own(body, "name"), "Name", LIMITS.name);
  if (name.error) return name;
  if (/[\r\n]/.test(name.value)) return { error: "Invalid request." };

  const email = requireText(own(body, "email"), "Email", LIMITS.email);
  if (email.error) return email;
  if (!EMAIL_PATTERN.test(email.value)) return { error: "Email is not valid." };

  const message = requireText(own(body, "message"), "Message", LIMITS.message);
  if (message.error) return message;

  return {
    value: {
      name: escapeHtml(name.value),
      email: escapeHtml(email.value),
      message: escapeHtml(message.value),
    },
  };
}

function createRateLimiter(options) {
  const windowMs = options.windowMs;
  const max = options.max;
  const now = options.now || Date.now;
  const hits = new Map();

  return function allow(ip) {
    const at = now();
    const recent = (hits.get(ip) || []).filter(function (stamp) {
      return at - stamp < windowMs;
    });
    if (recent.length >= max) {
      hits.set(ip, recent);
      const retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - at) / 1000));
      return { ok: false, retryAfter: retryAfter };
    }
    recent.push(at);
    hits.set(ip, recent);
    return { ok: true };
  };
}

function openDatabase(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA busy_timeout = 3000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS contacts (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "name TEXT NOT NULL," +
      "email TEXT NOT NULL," +
      "message TEXT NOT NULL," +
      "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))" +
      ")"
  );
  return db;
}

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function createApp(options) {
  const settings = options || {};
  const dbPath = settings.dbPath || process.env.DB_PATH || path.join("data", "contact.sqlite");
  const windowMs =
    settings.windowMs !== undefined
      ? settings.windowMs
      : readPositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 900000, "RATE_LIMIT_WINDOW_MS");
  const max =
    settings.max !== undefined
      ? settings.max
      : readPositiveInt(process.env.RATE_LIMIT_MAX, 5, "RATE_LIMIT_MAX");

  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("RATE_LIMIT_WINDOW_MS must be a positive integer");
  }
  if (!Number.isInteger(max) || max < 1) {
    throw new Error("RATE_LIMIT_MAX must be a positive integer");
  }

  const db = settings.db || openDatabase(dbPath);
  const insertContact = db.prepare("INSERT INTO contacts (name, email, message) VALUES (?, ?, ?)");
  const allow = settings.allow || createRateLimiter({ windowMs: windowMs, max: max, now: settings.now });

  const app = express();
  app.disable("x-powered-by");
  app.locals.db = db;

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'self'"],
          "object-src": ["'none'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "style-src-attr": ["'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https://i.ytimg.com"],
          "font-src": ["'self'"],
          "media-src": ["'self'"],
          "connect-src": ["'self'"],
          "frame-src": ["https://www.youtube-nocookie.com"],
          "upgrade-insecure-requests": null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use("/api", function (req, res, next) {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  app.get("/api/health", function (req, res) {
    res.json({ ok: true });
  });

  app.post("/api/contact", function (req, res) {
    const limit = allow(clientIp(req));
    if (!limit.ok) {
      res.set("Retry-After", String(limit.retryAfter));
      return res.status(429).json({ ok: false, error: "Too many messages. Try again later." });
    }

    const result = validateContact(req.body);
    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    insertContact.run(result.value.name, result.value.email, result.value.message);
    return res.status(200).json({ ok: true });
  });

  app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status === 413) {
      return res.status(413).json({ ok: false, error: "Message is too large." });
    }
    if (status === 400 || err.type === "entity.parse.failed") {
      return res.status(400).json({ ok: false, error: "Invalid request." });
    }
    console.error(err.message);
    return res.status(500).json({ ok: false, error: "Something went wrong." });
  });

  app.use(
    express.static(PUBLIC_DIR, {
      index: "index.html",
      dotfiles: "ignore",
      fallthrough: true,
    })
  );

  app.use(function (req, res) {
    res.status(404).sendFile(NOT_FOUND_PAGE);
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = readPort();
  const server = app.listen(port, function () {
    console.log("Listening on http://localhost:" + port);
  });

  function shutdown() {
    server.close(function () {
      if (app.locals.db) app.locals.db.close();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = {
  LIMITS,
  createApp,
  createRateLimiter,
  escapeHtml,
  validateContact,
};
