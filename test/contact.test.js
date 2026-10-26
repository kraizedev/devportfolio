"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp, createRateLimiter, LIMITS } = require("../server");

function makeApp(options) {
  const settings = options || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-"));
  const app = createApp({
    dbPath: path.join(dir, "contact.sqlite"),
    windowMs: settings.windowMs === undefined ? 60000 : settings.windowMs,
    max: settings.max === undefined ? 20 : settings.max,
    now: settings.now,
  });
  return {
    app: app,
    cleanup: function () {
      if (app.locals.db) app.locals.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function rows(app) {
  return app.locals.db.prepare("SELECT name, email, message FROM contacts ORDER BY id").all();
}

function validBody(extra) {
  return Object.assign(
    {
      name: "Test Name",
      email: "test@example.com",
      message: "Hello from the test.",
      gotcha: "",
    },
    extra || {}
  );
}

test("GET /api/health returns ok", async function () {
  const ctx = makeApp();
  try {
    const res = await request(ctx.app).get("/api/health");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.deepEqual(res.body, { ok: true });
  } finally {
    ctx.cleanup();
  }
});

test("a valid contact is stored with HTML escaped", async function () {
  const ctx = makeApp();
  try {
    const res = await request(ctx.app)
      .post("/api/contact")
      .send(validBody({ name: "Tom & <Jen>", message: 'Say "hello"' }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    const saved = rows(ctx.app);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, "Tom &amp; &lt;Jen&gt;");
    assert.equal(saved[0].email, "test@example.com");
    assert.equal(saved[0].message, "Say &quot;hello&quot;");
  } finally {
    ctx.cleanup();
  }
});

test("validation rejects bad contact fields and stores nothing", async function () {
  const ctx = makeApp();
  try {
    const cases = [
      [{ email: "test@example.com", message: "Hello" }, "Name is required."],
      [validBody({ name: "   " }), "Name is required."],
      [validBody({ name: "A".repeat(LIMITS.name + 1) }), "Name must be 100 characters or fewer."],
      [validBody({ name: 12 }), "Invalid request."],
      [validBody({ email: "" }), "Email is required."],
      [validBody({ email: "not-an-email" }), "Email is not valid."],
      [validBody({ email: "a".repeat(LIMITS.email) + "@b.co" }), "Email must be 254 characters or fewer."],
      [validBody({ message: "" }), "Message is required."],
      [validBody({ message: "M".repeat(LIMITS.message + 1) }), "Message must be 5000 characters or fewer."],
      [validBody({ name: "Line\nbreak" }), "Invalid request."],
    ];

    for (const entry of cases) {
      const res = await request(ctx.app).post("/api/contact").send(entry[0]);
      assert.equal(res.status, 400, JSON.stringify(entry[0]));
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, entry[1]);
    }

    assert.equal(rows(ctx.app).length, 0);

    const broken = await request(ctx.app)
      .post("/api/contact")
      .set("Content-Type", "application/json")
      .send("{");
    assert.equal(broken.status, 400);
    assert.equal(broken.body.error, "Invalid request.");
    assert.equal(rows(ctx.app).length, 0);
  } finally {
    ctx.cleanup();
  }
});

test("a filled honeypot is rejected and not stored", async function () {
  const ctx = makeApp();
  try {
    const spaced = await request(ctx.app).post("/api/contact").send(validBody({ gotcha: "  " }));
    assert.equal(spaced.status, 400);
    assert.equal(spaced.body.ok, false);
    assert.equal(spaced.body.error, "Unable to send this message.");

    const filled = await request(ctx.app)
      .post("/api/contact")
      .send(validBody({ gotcha: "https://example.com" }));
    assert.equal(filled.status, 400);
    assert.equal(filled.body.error, "Unable to send this message.");
    assert.equal(rows(ctx.app).length, 0);
  } finally {
    ctx.cleanup();
  }
});

test("an empty honeypot is accepted", async function () {
  const ctx = makeApp();
  try {
    const res = await request(ctx.app).post("/api/contact").send(validBody({ gotcha: "" }));
    assert.equal(res.status, 200);
    assert.equal(rows(ctx.app).length, 1);
  } finally {
    ctx.cleanup();
  }
});

test("contact posts are rate limited per IP", async function () {
  const ctx = makeApp({ max: 2, windowMs: 60000 });
  try {
    const first = await request(ctx.app).post("/api/contact").send(validBody());
    const second = await request(ctx.app).post("/api/contact").send(validBody());
    const third = await request(ctx.app).post("/api/contact").send(validBody());
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.equal(third.body.ok, false);
    assert.equal(third.body.error, "Too many messages. Try again later.");
    assert.match(third.headers["retry-after"], /^[1-9][0-9]*$/);
    assert.equal(rows(ctx.app).length, 2);
  } finally {
    ctx.cleanup();
  }
});

test("rate limit buckets are separate per IP and expire", function () {
  let now = 1_000;
  const allow = createRateLimiter({ windowMs: 1000, max: 1, now: function () { return now; } });
  assert.equal(allow("203.0.113.1").ok, true);
  assert.equal(allow("203.0.113.1").ok, false);
  assert.equal(allow("203.0.113.2").ok, true);
  now = 2000;
  assert.equal(allow("203.0.113.1").ok, true);
});

test("the homepage keeps the existing page and the mailto fallback", async function () {
  const ctx = makeApp();
  try {
    const res = await request(ctx.app).get("/");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    assert.match(res.headers["content-security-policy"], /style-src-attr 'unsafe-inline'/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(String(res.headers["content-security-policy"]).includes("upgrade-insecure-requests"), false);
    assert.match(res.text, /Unofficial spec ad\. Not affiliated with or endorsed by Xiaomi\./);
    assert.match(res.text, /Made with AI\. All people shown are AI-generated\./);
    assert.match(res.text, /Happy Alley/);
    assert.match(res.text, /Kevin MacLeod/);
    assert.match(res.text, /<a href="mailto:EMAIL_PENDING">Work with me<\/a>/);
    assert.match(res.text, /id="contact-form"/);
    assert.match(res.text, /name="gotcha"/);
    assert.match(res.text, /action="\/api\/contact"/);
    assert.match(res.text, /assets\/js\/contact\.js/);
  } finally {
    ctx.cleanup();
  }
});

test("an unknown path returns the existing 404 page", async function () {
  const ctx = makeApp();
  try {
    const res = await request(ctx.app).get("/not-a-page");
    assert.equal(res.status, 404);
    assert.match(res.text, /Out of frame\./);
    assert.match(res.text, /Back to the portfolio/);
    assert.match(res.text, /\/assets\/css\/base\.css/);
  } finally {
    ctx.cleanup();
  }
});
