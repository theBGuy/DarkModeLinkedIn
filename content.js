"use strict";

// LinkedIn runs THREE front-ends, and treating one like another is what breaks
// pages, so the strategy is chosen from what the document exposes and is then
// checked against the page it produced.
//
//   1. The SDUI app (profile, jobs, messaging, login) ships a full dark theme
//      under [data-color-scheme="dark"] — 357 token declarations plus dark
//      variants of every inline SVG. We flip that attribute on <body>.
//
//   2. Voyager, the older Ember app (notifications, parts of the feed), keys
//      its theme off a "theme--dark" class AND a separate #ui-theme-dark
//      stylesheet. Both come straight from LinkedIn's own bundle:
//        {light:"theme--light", dark:"theme--dark", system:"theme--system"}
//        {light:{theme:"#ui-theme"}, dark:{theme:"#ui-theme-dark"}}
//
//   3. The signed-out guest pages have no dark theme at all, but do expose a
//      readable --color-* vocabulary, so those we recolor ourselves via
//      dark.css.
//
// Recoloring is the last resort and the only strategy that can make a page
// WORSE (it inverts text against surfaces it may not control). It therefore
// runs only where no native switch exists, and a legibility check revokes it
// if the page it produced has unreadable text.
(() => {
  const INVERT_ATTR = "data-dmli";
  const SDUI_ATTR = "data-color-scheme";
  const VOYAGER_DARK = "theme--dark";
  const VOYAGER_CLASSES = ["theme--light", "theme--dark", "theme--system"];
  const STORAGE_KEY = "mode";
  const MIRROR_KEY = "__dmli_mode";
  const MODES = new Set(["on", "off", "auto"]);
  const DEFAULT_MODE = "on";

  const root = document.documentElement;
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");

  const readMirror = () => {
    try {
      const v = localStorage.getItem(MIRROR_KEY);
      return MODES.has(v) ? v : null;
    } catch {
      return null;
    }
  };
  const writeMirror = (mode) => {
    try {
      localStorage.setItem(MIRROR_KEY, mode);
    } catch {
      /* sandboxed frame or site-data blocked */
    }
  };

  let currentMode = readMirror() ?? DEFAULT_MODE;
  const wantsDark = () => currentMode === "on" || (currentMode === "auto" && darkQuery.matches);

  let strategy = "pending";
  let recolorRevoked = false;
  let writing = false;
  const original = { sdui: null, voyagerClasses: null };

  // ---- strategy detection ----
  const sduiHost = () => (document.body?.hasAttribute(SDUI_ATTR) ? document.body : null);
  const voyagerLink = () => document.getElementById("ui-theme-dark");
  const voyagerHost = () => {
    for (const el of [root, document.body]) {
      if (el && VOYAGER_CLASSES.some((c) => el.classList.contains(c))) return el;
    }
    return voyagerLink() ? root : null;
  };

  function detect() {
    if (sduiHost()) return "sdui";
    if (voyagerHost()) return "voyager";
    if (!document.body) return "pending";
    return recolorRevoked ? "unsupported" : "recolor";
  }

  // ---- appliers ----
  function applySdui(on) {
    const host = sduiHost();
    if (!host) return;
    if (original.sdui === null) original.sdui = host.getAttribute(SDUI_ATTR);
    const next = on ? "dark" : original.sdui ?? "light";
    if (host.getAttribute(SDUI_ATTR) === next) return;
    writing = true;
    host.setAttribute(SDUI_ATTR, next);
    writing = false;
  }

  function applyVoyager(on) {
    const host = voyagerHost();
    if (!host) return;
    if (original.voyagerClasses === null) {
      original.voyagerClasses = VOYAGER_CLASSES.filter((c) => host.classList.contains(c));
    }
    writing = true;
    // The dark rules live in their own stylesheet, which LinkedIn leaves
    // disabled while the account is set to light; the class alone does nothing.
    const link = voyagerLink();
    if (link) {
      if (on) {
        link.disabled = false;
        if (link.media === "not all") link.media = "all";
      } else {
        link.disabled = original.voyagerClasses.includes(VOYAGER_DARK) ? false : true;
      }
    }
    if (on) {
      host.classList.remove("theme--light", "theme--system");
      host.classList.add(VOYAGER_DARK);
    } else {
      host.classList.remove(VOYAGER_DARK);
      for (const c of original.voyagerClasses) host.classList.add(c);
    }
    writing = false;
  }

  function applyRecolor(on) {
    if (on) root.setAttribute(INVERT_ATTR, "dark");
    else root.removeAttribute(INVERT_ATTR);
  }

  function apply() {
    strategy = detect();
    const on = wantsDark();

    // Only the chosen strategy may be active; leftovers from a previous guess
    // would fight the one that actually works.
    if (strategy !== "recolor") applyRecolor(false);
    if (strategy !== "sdui") applySdui(false);
    if (strategy !== "voyager") applyVoyager(false);

    if (strategy === "sdui") applySdui(on);
    else if (strategy === "voyager") applyVoyager(on);
    else if (strategy === "recolor") applyRecolor(on);
  }

  // ---- legibility check ----
  // The one failure this extension must never ship is text the same colour as
  // the surface behind it. Recoloring is the only strategy that can cause it,
  // so after it runs we read the page back and revoke it if the result is
  // unreadable — whatever front-end LinkedIn invents next.
  const luminance = (r, g, b) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parseRgb = (v) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(v || "");
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };

  function effectiveBackground(el) {
    for (let node = el; node && node !== document; node = node.parentElement) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function checkLegibility() {
    if (strategy !== "recolor" || !wantsDark()) return;
    let sampled = 0;
    let illegible = 0;
    const nodes = document.querySelectorAll("p, span, h1, h2, h3, a, li, button, td");
    for (const el of nodes) {
      if (sampled >= 60) break;
      if (!el.textContent?.trim() || el.childElementCount > 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 8) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      const fg = parseRgb(cs.color);
      if (!fg || fg.a < 0.5) continue;
      const bg = effectiveBackground(el);
      const [hi, lo] = [luminance(fg.r, fg.g, fg.b), luminance(bg.r, bg.g, bg.b)].sort((a, b) => b - a);
      sampled++;
      if ((hi + 0.05) / (lo + 0.05) < 2) illegible++;
    }
    // A quarter of sampled text being near-invisible means the recolouring is
    // fighting surfaces it does not control, not that one element is off.
    if (sampled >= 8 && illegible / sampled > 0.25) {
      recolorRevoked = true;
      applyRecolor(false);
      strategy = "unsupported";
    }
  }

  // ---- lifecycle ----
  const setMode = (mode) => {
    if (!MODES.has(mode)) return;
    currentMode = mode;
    writeMirror(mode);
    recolorRevoked = false; // give the page another chance after a real change
    apply();
    checkLegibility();
  };

  // apply() can itself change a class, which would re-trigger the observers
  // watching for LinkedIn changing one — a mutation loop that starves the
  // microtask queue and freezes the tab. Coalescing to one run per frame breaks
  // the cycle and keeps this cheap on an SPA that touches classes constantly.
  let queued = false;
  const scheduleApply = () => {
    if (writing || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply();
    });
  };

  const start = () => {
    apply();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { attributes: true, attributeFilter: [SDUI_ATTR, "class"] });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  };

  if (document.body) start();
  else new MutationObserver((_m, obs) => {
    if (!document.body) return;
    obs.disconnect();
    start();
  }).observe(root, { childList: true });

  // Stylesheets and SPA content arrive after the first apply(), so verify once
  // the page has actually rendered something to measure.
  addEventListener("DOMContentLoaded", () => { apply(); checkLegibility(); });
  addEventListener("load", () => {
    apply();
    checkLegibility();
    setTimeout(checkLegibility, 1500);
  });

  chrome.storage.local.get(STORAGE_KEY, (stored) => {
    if (chrome.runtime.lastError) return;
    setMode(MODES.has(stored?.[STORAGE_KEY]) ? stored[STORAGE_KEY] : DEFAULT_MODE);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue;
    setMode(MODES.has(next) ? next : DEFAULT_MODE);
  });

  darkQuery.addEventListener("change", () => {
    if (currentMode === "auto") { apply(); checkLegibility(); }
  });

  if (window.top === window) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== "dmli:get-state") return false;
      const applied =
        strategy === "sdui" ? sduiHost()?.getAttribute(SDUI_ATTR) === "dark"
        : strategy === "voyager" ? !!voyagerHost()?.classList.contains(VOYAGER_DARK)
        : strategy === "recolor" ? root.getAttribute(INVERT_ATTR) === "dark"
        : false;
      sendResponse({ mode: currentMode, strategy, applied });
      return false;
    });
  }
})();
