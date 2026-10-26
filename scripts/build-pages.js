"use strict";

const fs = require("fs");
const path = require("path");

const TEXT_EXTENSIONS = new Set([".html", ".css", ".js"]);

function buildPages(options) {
  const settings = options || {};
  const root = path.join(__dirname, "..");
  const publicDir = path.resolve(
    settings.publicDir || process.env.PAGES_PUBLIC_DIR || path.join(root, "public")
  );
  const siteDir = path.resolve(
    settings.siteDir || process.env.PAGES_SITE_DIR || path.join(root, "_site")
  );

  if (siteDir === publicDir || siteDir.startsWith(publicDir + path.sep)) {
    throw new Error("Pages output directory must not be inside public/.");
  }

  const indexPath = path.join(publicDir, "index.html");
  let indexHtml;
  try {
    indexHtml = fs.readFileSync(indexPath, "utf8");
  } catch (error) {
    throw new Error(
      "Contact form markup was not found in index.html. Refusing to publish a Pages preview that might still post to /api/contact."
    );
  }

  const stripped = removeContactForm(indexHtml);

  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.cpSync(publicDir, siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, "index.html"), stripped);

  const files = walk(siteDir);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    const rel = path.relative(siteDir, file).split(path.sep).join("/");
    const raw = fs.readFileSync(file, "utf8");
    const next = rewriteRootPaths(raw, rel, ext);
    if (next !== raw) fs.writeFileSync(file, next);
  }

  return { siteDir: siteDir };
}

function removeContactForm(html) {
  let start = findContactFormStart(html);
  if (start < 0) {
    throw new Error(
      "Contact form markup was not found in index.html. Refusing to publish a Pages preview that might still post to /api/contact."
    );
  }

  const lineStart = html.lastIndexOf("\n", start - 1) + 1;
  if (/^[ \t]*$/.test(html.slice(lineStart, start))) start = lineStart;

  const closeAt = html.indexOf("</form>", start);
  if (closeAt < 0) {
    throw new Error(
      "Contact form markup was not found in index.html. Refusing to publish a Pages preview that might still post to /api/contact."
    );
  }

  let after = closeAt + "</form>".length;
  if (html.charAt(after) === "\r") after += 1;
  if (html.charAt(after) === "\n") after += 1;

  let next = html.slice(0, start) + html.slice(after);
  next = next.replace(
    /^[ \t]*<script\b[^>]*\bsrc\s*=\s*(["'])(?:\.\/)?assets\/js\/contact\.js\1[^>]*>\s*<\/script>[ \t]*\r?\n?/m,
    ""
  );

  if (
    next.includes("/api/contact") ||
    /<script\b[^>]*contact\.js/i.test(next) ||
    /id\s*=\s*["']contact-form["']/.test(next) ||
    /<form\b[^>]*\bcontact-form\b/i.test(next)
  ) {
    throw new Error("Contact form removal left a reference to the form or /api/contact in index.html.");
  }
  if (!next.includes("mailto:EMAIL_PENDING")) {
    throw new Error("Contact form removal dropped the mailto:EMAIL_PENDING fallback.");
  }
  return next;
}

function findContactFormStart(html) {
  const tags = /<form\b[^>]*>/gi;
  let match;
  while ((match = tags.exec(html))) {
    const tag = match[0];
    if (
      /\bid\s*=\s*["']contact-form["']/.test(tag) ||
      /\bclass\s*=\s*["'][^"']*\bcontact-form\b/.test(tag)
    ) {
      return match.index;
    }
  }
  return -1;
}

function walk(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = walk(full);
      for (let j = 0; j < nested.length; j++) files.push(nested[j]);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function rewriteRootPaths(content, fromFile, ext) {
  let next = rewriteCssUrls(content, fromFile);
  if (ext === ".html") next = rewriteHtmlAttributes(next, fromFile);
  if (ext === ".js") next = rewriteJsAssignments(next);
  return next;
}

function isRootAbsolute(value) {
  return value.startsWith("/") && !value.startsWith("//");
}

function toRelative(rootUrl, fromFile) {
  const query = rootUrl.indexOf("?");
  const hash = rootUrl.indexOf("#");
  let end = rootUrl.length;
  if (query !== -1) end = Math.min(end, query);
  if (hash !== -1) end = Math.min(end, hash);
  const pathname = rootUrl.slice(0, end);
  const suffix = rootUrl.slice(end);
  if (!isRootAbsolute(pathname)) return rootUrl;

  const fromDir = path.posix.dirname(fromFile);
  const target = pathname === "/" ? "." : pathname.replace(/^\/+/, "");
  let relative = path.posix.relative(fromDir, target);
  if (relative === "") relative = ".";
  if (pathname === "/" || pathname.endsWith("/")) {
    if (relative === ".") relative = "./";
    else if (!relative.endsWith("/")) relative += "/";
  }
  return relative + suffix;
}

function rewriteHtmlAttributes(html, fromFile) {
  return html.replace(
    /\b(href|src)(\s*=\s*)(["'])([^"']*)\3/gi,
    function (match, attr, equals, quote, value) {
      if (!isRootAbsolute(value)) return match;
      return attr + equals + quote + toRelative(value, fromFile) + quote;
    }
  );
}

// DOM src/href assignments resolve against the page. This site loads its
// scripts from the root page, so those strings are rewritten from there.
function rewriteJsAssignments(js) {
  return js.replace(
    /\b(src|href)(\s*=\s*)(["'])([^"']*)\3/g,
    function (match, attr, equals, quote, value) {
      if (!isRootAbsolute(value)) return match;
      return attr + equals + quote + toRelative(value, "index.html") + quote;
    }
  );
}

function rewriteCssUrls(css, fromFile) {
  let out = "";
  let cursor = 0;
  const lower = css.toLowerCase();
  while (cursor < css.length) {
    const idx = lower.indexOf("url(", cursor);
    if (idx === -1) {
      out += css.slice(cursor);
      break;
    }
    out += css.slice(cursor, idx);
    let j = idx + 4;
    while (j < css.length && /\s/.test(css.charAt(j))) j += 1;
    const quote = css.charAt(j) === '"' || css.charAt(j) === "'" ? css.charAt(j) : "";
    if (quote) j += 1;
    const valueStart = j;
    if (quote) {
      while (j < css.length && css.charAt(j) !== quote) j += 1;
    } else {
      while (j < css.length && css.charAt(j) !== ")") j += 1;
    }
    const rawValue = css.slice(valueStart, j);
    if (quote && css.charAt(j) === quote) j += 1;
    while (j < css.length && /\s/.test(css.charAt(j))) j += 1;
    if (css.charAt(j) !== ")") {
      out += css.slice(idx, j);
      cursor = j;
      continue;
    }
    j += 1;
    const trimmed = rawValue.trim();
    if (!isRootAbsolute(trimmed)) {
      out += css.slice(idx, j);
    } else {
      out += 'url("' + toRelative(trimmed, fromFile) + '")';
    }
    cursor = j;
  }
  return out;
}

if (require.main === module) {
  try {
    const result = buildPages();
    console.log("Wrote " + result.siteDir);
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}

module.exports = { buildPages };
