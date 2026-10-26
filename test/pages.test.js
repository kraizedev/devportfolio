"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildPages } = require("../scripts/build-pages");

const REPO = path.join(__dirname, "..");
const SCRIPT = path.join(REPO, "scripts", "build-pages.js");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function makeTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pages-build-"));
}

test("buildPages strips the contact form in the Pages copy only", function () {
  const siteDir = path.join(makeTemp(), "_site");
  const publicIndex = path.join(REPO, "public", "index.html");
  const public404 = path.join(REPO, "public", "404.html");
  const beforeIndex = sha256(publicIndex);
  const before404 = sha256(public404);

  buildPages({ publicDir: path.join(REPO, "public"), siteDir: siteDir });

  assert.equal(sha256(publicIndex), beforeIndex);
  assert.equal(sha256(public404), before404);
  assert.match(fs.readFileSync(publicIndex, "utf8"), /id="contact-form"/);
  assert.match(fs.readFileSync(public404, "utf8"), /href="\/assets\/css\/base\.css"/);

  const index = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
  const contactAt = index.indexOf('id="contact"');
  const contact = index.slice(contactAt, index.indexOf("</section>", contactAt));

  assert.match(contact, /class="contact-lines"/);
  assert.match(contact, /<a href="mailto:EMAIL_PENDING">Work with me<\/a>/);
  assert.equal(contact.includes("<form"), false);
  assert.equal(contact.includes("contact-form"), false);
  assert.equal(contact.includes("/api/contact"), false);
  assert.equal(contact.includes("contact.js"), false);
  assert.equal(index.includes("/api/contact"), false);
  assert.equal(index.includes("assets/js/contact.js"), false);
  assert.match(index, /<meta property="og:url" content="https:\/\/PROJECT\.pages\.dev\/">/);
  assert.match(index, /<meta property="og:image" content="https:\/\/PROJECT\.pages\.dev\/assets\/img\/og-placeholder\.png">/);
  assert.match(index, /Unofficial spec ad\. Not affiliated with or endorsed by Xiaomi\./);
  assert.match(index, /Made with AI\. All people shown are AI-generated\./);
  assert.match(index, /"Happy Alley" Kevin MacLeod \(incompetech\.com\)/);

  const notFound = fs.readFileSync(path.join(siteDir, "404.html"), "utf8");
  assert.match(notFound, /href="assets\/img\/favicon\.svg"/);
  assert.match(notFound, /href="assets\/css\/base\.css"/);
  assert.match(notFound, /href="assets\/css\/theme-golden-hour\.css"/);
  assert.match(notFound, /<a href="\.\/">Back to the portfolio<\/a>/);
  assert.equal(notFound.includes('href="/'), false);
  assert.match(notFound, /Out of frame\./);

  const theme = fs.readFileSync(path.join(siteDir, "assets", "css", "theme-golden-hour.css"), "utf8");
  assert.equal(theme, fs.readFileSync(path.join(REPO, "public", "assets", "css", "theme-golden-hour.css"), "utf8"));
  assert.match(theme, /url\("\.\.\/fonts\/fraunces-latin-wght-normal\.woff2"\)/);
  assert.match(theme, /url\("data:image\/svg\+xml/);
});

test("buildPages rewrites root-absolute href, src, and url() paths", function () {
  const root = makeTemp();
  const publicDir = path.join(root, "public");
  const siteDir = path.join(root, "_site");
  fs.mkdirSync(path.join(publicDir, "assets", "css"), { recursive: true });
  fs.mkdirSync(path.join(publicDir, "assets", "js"), { recursive: true });
  fs.mkdirSync(path.join(publicDir, "nested"), { recursive: true });

  fs.writeFileSync(
    path.join(publicDir, "index.html"),
    [
      "<!DOCTYPE html><html><head>",
      '<meta property="og:url" content="https://PROJECT.pages.dev/">',
      '<meta property="og:image" content="https://PROJECT.pages.dev/assets/img/og-placeholder.png">',
      '<link rel="stylesheet" href="/assets/css/extra.css">',
      '<script src="/assets/js/extra.js" defer></script>',
      "</head><body>",
      '<a href="/#contact">Contact</a>',
      '<img src="/assets/img/favicon.svg?v=1" alt="">',
      '<form class="contact-form" id="contact-form" action="/api/contact" method="post">',
      "<input name=\"name\">",
      "</form>",
      '<p class="contact-fallback"><a href="mailto:EMAIL_PENDING">Work with me</a></p>',
      '<script src="assets/js/contact.js" defer></script>',
      "</body></html>",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(publicDir, "assets", "css", "extra.css"),
    [
      '@import url("/assets/fonts/inter-latin-wght-normal.woff2");',
      '.a{background:url("/assets/img/favicon.svg")}',
      '.b{background:url("../fonts/inter-latin-wght-normal.woff2")}',
      '.c{background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3C/svg%3E")}',
      '.d{background:url(/assets/img/og-placeholder.png)}',
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(publicDir, "assets", "js", "extra.js"),
    [
      'img.src = "/assets/img/favicon.svg";',
      'link.href = "/";',
      'var untouched = "/assets/img/favicon.svg";',
      'fetch("/api/contact", { method: "POST" });',
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(publicDir, "nested", "page.html"),
    '<a href="/">Home</a><img src="/assets/img/favicon.svg" alt="">'
  );

  buildPages({ publicDir: publicDir, siteDir: siteDir });

  const index = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
  assert.match(index, /href="assets\/css\/extra\.css"/);
  assert.match(index, /src="assets\/js\/extra\.js"/);
  assert.match(index, /href="\.\/#contact"/);
  assert.match(index, /src="assets\/img\/favicon\.svg\?v=1"/);
  assert.match(index, /mailto:EMAIL_PENDING/);
  assert.match(index, /content="https:\/\/PROJECT\.pages\.dev\/"/);
  assert.match(index, /content="https:\/\/PROJECT\.pages\.dev\/assets\/img\/og-placeholder\.png"/);
  assert.equal(index.includes("/api/contact"), false);
  assert.equal(index.includes("<form"), false);

  const css = fs.readFileSync(path.join(siteDir, "assets", "css", "extra.css"), "utf8");
  assert.match(css, /url\("\.\.\/fonts\/inter-latin-wght-normal\.woff2"\)/);
  assert.match(css, /\.a\{background:url\("\.\.\/img\/favicon\.svg"\)\}/);
  assert.match(css, /url\("\.\.\/fonts\/inter-latin-wght-normal\.woff2"\)/);
  assert.match(css, /url\("data:image\/svg\+xml,%3Csvg xmlns='http:\/\/www\.w3\.org\/2000\/svg'%3E%3C\/svg%3E"\)/);
  assert.match(css, /\.d\{background:url\("\.\.\/img\/og-placeholder\.png"\)\}/);
  assert.equal(css.includes('url("/assets/'), false);
  assert.equal(css.includes("url(/assets/"), false);

  const js = fs.readFileSync(path.join(siteDir, "assets", "js", "extra.js"), "utf8");
  assert.match(js, /img\.src = "assets\/img\/favicon\.svg";/);
  assert.match(js, /link\.href = "\.\/";/);
  assert.match(js, /var untouched = "\/assets\/img\/favicon\.svg";/);
  assert.match(js, /fetch\("\/api\/contact"/);

  const nested = fs.readFileSync(path.join(siteDir, "nested", "page.html"), "utf8");
  assert.match(nested, /href="\.\.\/"/);
  assert.match(nested, /src="\.\.\/assets\/img\/favicon\.svg"/);

  const sourceCss = fs.readFileSync(path.join(publicDir, "assets", "css", "extra.css"), "utf8");
  assert.match(sourceCss, /url\("\/assets\/img\/favicon\.svg"\)/);
});

test("the pages build fails when the contact form markup is missing", function () {
  const root = makeTemp();
  const publicDir = path.join(root, "public");
  const siteDir = path.join(root, "_site");
  fs.mkdirSync(publicDir);
  fs.writeFileSync(
    path.join(publicDir, "index.html"),
    '<p><a href="mailto:EMAIL_PENDING">Work with me</a></p>'
  );

  assert.throws(
    function () {
      buildPages({ publicDir: publicDir, siteDir: siteDir });
    },
    /Contact form markup was not found/
  );
  assert.equal(fs.existsSync(siteDir), false);

  const cli = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      PAGES_PUBLIC_DIR: publicDir,
      PAGES_SITE_DIR: siteDir,
    }),
  });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Contact form markup was not found/);
  assert.equal(fs.existsSync(siteDir), false);
});
