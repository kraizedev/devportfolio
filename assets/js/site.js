/* site.js: no dependencies. (1) YouTube click-to-load facade, (2) hero loop
   with reduced-motion fallback + pause button, (3) optional subtle reveals. */
(function () {
  "use strict";
  var doc = document.documentElement;
  doc.classList.add("js");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 1. YouTube facade: <div class="yt" data-yt-id="VIDEO_ID" data-title="..."> */
  function isPending(id) { return !id || /PENDING/i.test(id); }
  document.querySelectorAll(".yt").forEach(function (el) {
    var id = el.getAttribute("data-yt-id");
    var title = el.getAttribute("data-title") || "Video";
    var btn = el.querySelector(".yt-play");
    if (isPending(id)) { el.classList.add("is-pending"); if (btn) btn.disabled = true; return; }
    if (!el.querySelector("img")) {
      var img = document.createElement("img");
      img.src = el.getAttribute("data-poster") || "https://i.ytimg.com/vi/" + encodeURIComponent(id) + "/hqdefault.jpg";
      img.alt = ""; img.loading = "lazy"; img.decoding = "async";
      el.insertBefore(img, el.firstChild);
    }
    if (btn) btn.addEventListener("click", function () {
      var f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0&playsinline=1";
      f.title = title;
      f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      f.allowFullscreen = true;
      f.referrerPolicy = "strict-origin-when-cross-origin";
      el.innerHTML = ""; el.appendChild(f); f.focus();
    });
  });

  /* 2. Hero loop: no autoplay attribute in HTML; JS plays only if motion is OK. */
  var hero = document.querySelector("[data-hero-media]");
  if (hero) {
    var v = hero.querySelector("video");
    var toggle = hero.querySelector(".hero-toggle");
    if (v) {
      v.muted = true;
      v.addEventListener("loadeddata", function () { hero.classList.add("is-ready"); });
      if (!reduce) {
        var p = v.play(); if (p && p.catch) p.catch(function () {});
      } else {
        v.removeAttribute("loop"); v.preload = "none";
      }
      if (toggle) toggle.addEventListener("click", function () {
        if (v.paused) { v.play(); toggle.textContent = "Pause"; toggle.setAttribute("aria-pressed", "false"); }
        else { v.pause(); toggle.textContent = "Play"; toggle.setAttribute("aria-pressed", "true"); }
      });
      if (reduce && toggle) { toggle.textContent = "Play"; toggle.setAttribute("aria-pressed", "true"); }
      // poster loads even with reduced motion -> show it once available
      if (v.poster) { var i = new Image(); i.onload = function () { hero.classList.add("is-ready"); }; i.src = v.poster; }
    }
  }

  /* 3. Reveals (only elements with data-reveal) */
  var items = document.querySelectorAll("[data-reveal]");
  if (!reduce && "IntersectionObserver" in window && items.length) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -10% 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else { items.forEach(function (el) { el.classList.add("is-visible"); }); }
})();

/* 4. Before/after compare: native <input type="range"> drives --pos.
   Keyboard (arrows/Home/End/PageUp/PageDown) comes free with the range input. */
(function () {
  document.querySelectorAll("[data-compare]").forEach(function (box) {
    var r = box.querySelector(".compare-range");
    if (!r) return;
    function set() {
      box.style.setProperty("--pos", r.value + "%");
      var L = box.getAttribute("data-left") || "approved still", R = box.getAttribute("data-right") || "final frame";
      r.setAttribute("aria-valuetext", "Divider at " + r.value + "%: " + L + " on the left, " + R + " on the right");
    }
    r.addEventListener("input", set);
    set();
  });
})();

/* ===== v4 layer (pairs with cinema.css). Vanilla, no dependencies. ===== */
(function () {
  "use strict";
  var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
  var reduce = mq("(prefers-reduced-motion: reduce)");
  var finePointer = mq("(hover: hover) and (pointer: fine)");

  /* 5. Hook A/B/C switcher: buttons with aria-pressed swap the panels (works with keyboard; no motion) */
  document.querySelectorAll("[data-hooks]").forEach(function (box) {
    var tabs = box.querySelectorAll(".hook-tab");
    box.classList.add("is-enhanced");
    tabs.forEach(function (t) { var pn = document.getElementById(t.getAttribute("aria-controls")); if (pn) pn.hidden = t.getAttribute("aria-pressed") !== "true"; });
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute("aria-pressed", on ? "true" : "false");
          var panel = document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !on;
        });
      });
    });
  });

  /* 6. Pinned "storyboard to screen": wide screens + motion OK only */
  var story = document.querySelector("[data-story]");
  if (story) {
    var steps = story.querySelectorAll(".story-step");
    var bar = story.querySelector(".story-progress");
    var ticking = false, active = 0;
    var update = function () {
      ticking = false;
      if (!story.classList.contains("is-pinned")) return;
      var r = story.getBoundingClientRect();
      var total = r.height - window.innerHeight;
      var p = Math.min(1, Math.max(0, -r.top / total));
      var i = Math.min(steps.length - 1, Math.floor(p * steps.length));
      if (i !== active) { steps[active].classList.remove("is-active"); steps[i].classList.add("is-active"); active = i; }
      if (bar) bar.style.setProperty("--p", p.toFixed(3));
    };
    var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    var setMode = function () {
      var pin = !reduce && window.innerWidth >= 900 && window.innerHeight >= 600 && window.innerHeight <= 1600; // very tall = full-page capture, not a real screen
      story.classList.toggle("is-pinned", pin);
      if (!pin) steps.forEach(function (s) { s.classList.remove("is-active"); });
      else { steps.forEach(function (s, k) { s.classList.toggle("is-active", k === active); }); update(); }
    };
    setMode();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { setMode(); onScroll(); });
  }

  /* 7. Compare slider: one auto-sweep when it first scrolls into view (stops on any user input) */
  var cmp = document.querySelector("[data-compare]");
  if (cmp && !reduce && "IntersectionObserver" in window) {
    var range = cmp.querySelector(".compare-range");
    var cancelled = false;
    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) { range.addEventListener(ev, function () { cancelled = true; cmp.classList.remove("is-sweeping"); }, { passive: true }); });
    var sweep = function () {
      var keys = [[0, 50], [550, 78], [1150, 22], [1700, 50]], t0 = performance.now();
      cmp.classList.add("is-sweeping");
      var ease = function (x) { return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
      var frame = function (now) {
        if (cancelled) return;
        var t = now - t0, k = 1;
        while (k < keys.length - 1 && t > keys[k][0]) k++;
        var a = keys[k - 1], b = keys[k];
        var x = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
        range.value = Math.round(a[1] + (b[1] - a[1]) * ease(x));
        cmp.style.setProperty("--pos", range.value + "%");
        if (t < keys[keys.length - 1][0]) requestAnimationFrame(frame);
        else { range.dispatchEvent(new Event("input")); setTimeout(function () { cmp.classList.remove("is-sweeping"); }, 400); }
      };
      requestAnimationFrame(frame);
    };
    var cio = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { cio.disconnect(); setTimeout(sweep, 250); }
    }, { threshold: 0.6 });
    cio.observe(cmp);
  }

  /* 8. Tiles: PLAY badge (touch / keyboard) + following PLAY cursor (fine pointers) */
  var tiles = document.querySelectorAll(".yt");
  tiles.forEach(function (el) {
    if (el.querySelector(".play-badge")) return;
    var b = document.createElement("span");
    var soon = el.classList.contains("is-pending");
    b.className = "play-badge" + (soon ? " is-soon" : "");
    b.setAttribute("aria-hidden", "true");
    b.textContent = soon ? "SOON" : "PLAY";
    el.appendChild(b);
  });
  if (finePointer && !reduce && tiles.length) {
    var cur = document.createElement("div");
    cur.className = "play-cursor"; cur.setAttribute("aria-hidden", "true");
    document.body.appendChild(cur);
    document.documentElement.classList.add("has-play-cursor");
    var x = -200, y = -200, cx = x, cy = y, raf = null;
    var loop = function () {
      cx += (x - cx) * 0.25; cy += (y - cy) * 0.25;
      cur.style.transform = "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0) scale(.4)";
      raf = Math.abs(x - cx) + Math.abs(y - cy) > 0.5 ? requestAnimationFrame(loop) : null;
    };
    tiles.forEach(function (el) {
      el.addEventListener("pointerenter", function (e) {
        if (el.querySelector("iframe")) return;
        var soon = el.classList.contains("is-pending");
        cur.textContent = soon ? "SOON" : "PLAY";
        cur.classList.toggle("is-soon", soon);
        x = cx = e.clientX; y = cy = e.clientY; loop();
        cur.classList.add("is-on");
      });
      el.addEventListener("pointermove", function (e) { x = e.clientX; y = e.clientY; if (!raf) raf = requestAnimationFrame(loop); });
      el.addEventListener("pointerleave", function () { cur.classList.remove("is-on"); });
      el.addEventListener("click", function () { cur.classList.remove("is-on"); });
    });
  }

  /* 9. Magnetic CTAs: fine pointers only, max ~8px pull */
  if (finePointer && !reduce) {
    document.querySelectorAll("[data-magnetic]").forEach(function (btn) {
      btn.addEventListener("pointermove", function (e) {
        var r = btn.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        btn.style.setProperty("--mx", (dx * 8).toFixed(1) + "px");
        btn.style.setProperty("--my", (dy * 6).toFixed(1) + "px");
      });
      btn.addEventListener("pointerleave", function () { btn.style.setProperty("--mx", "0px"); btn.style.setProperty("--my", "0px"); });
    });
  }
})();
