"use strict";

// LinkedIn runs FOUR front-ends, and treating one like another is what breaks
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
//   3. Help Center articles use the "hue" design system, which ships 748 dark
//      token declarations under .hue-web-color-scheme--dark but renders
//      <body> with --light. We swap the scheme class; the 481 tokens the light
//      block defines beyond the dark one are all declared on
//      .hue-web-theme--classic too, so nothing else is lost.
//
//   4. The signed-out guest pages have no dark theme at all, but do expose a
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
  const HUE_LIGHT = "hue-web-color-scheme--light";
  const HUE_DARK = "hue-web-color-scheme--dark";
  const HUE_PATCH_ATTR = "data-dmli-hue";
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
  const original = { sdui: null, voyagerClasses: null, hue: null };

  // ---- strategy detection ----
  const sduiHost = () => (document.body?.hasAttribute(SDUI_ATTR) ? document.body : null);
  const voyagerLink = () => document.getElementById("ui-theme-dark");
  const voyagerHost = () => {
    for (const el of [root, document.body]) {
      if (el && VOYAGER_CLASSES.some((c) => el.classList.contains(c))) return el;
    }
    return voyagerLink() ? root : null;
  };
  // <body> only: that is where LinkedIn puts the scheme class, and the patch
  // selectors in dark.css need it below the <html> that carries HUE_PATCH_ATTR.
  const hueHost = () => {
    const body = document.body;
    return body && (body.classList.contains(HUE_LIGHT) || body.classList.contains(HUE_DARK)) ? body : null;
  };

  // Hue is checked after the other native switches so a page already themed
  // through one of them keeps it; hue only claims pages that would otherwise
  // fall through to recoloring.
  function detect() {
    if (sduiHost()) return "sdui";
    if (voyagerHost()) return "voyager";
    if (hueHost()) return "hue";
    if (!document.body) return "pending";
    return recolorRevoked ? "unsupported" : "recolor";
  }

  // ---- appliers ----
  // Every applier skips writes the page already matches (see scheduleApply);
  // setAttribute with an unchanged value still queues a mutation.
  function setRootFlag(name, on) {
    if (!on) root.removeAttribute(name);
    else if (root.getAttribute(name) !== "dark") root.setAttribute(name, "dark");
  }

  function applySdui(on) {
    const host = sduiHost();
    if (!host) return;
    if (original.sdui === null) original.sdui = host.getAttribute(SDUI_ATTR);
    const next = on ? "dark" : original.sdui ?? "light";
    if (host.getAttribute(SDUI_ATTR) === next) return;
    host.setAttribute(SDUI_ATTR, next);
  }

  function applyVoyager(on) {
    const host = voyagerHost();
    if (!host) return;
    const originals = (original.voyagerClasses ??= VOYAGER_CLASSES.filter((c) => host.classList.contains(c)));
    // The dark rules live in their own stylesheet, which LinkedIn leaves
    // disabled while the account is set to light; the class alone does nothing.
    const link = voyagerLink();
    if (link) {
      const disabled = on ? false : !originals.includes(VOYAGER_DARK);
      if (link.disabled !== disabled) link.disabled = disabled;
      if (on && link.media === "not all") link.media = "all";
    }
    // Every write is skipped when the classes already match (see applyHue).
    const cl = host.classList;
    if (on) {
      if (cl.contains("theme--light") || cl.contains("theme--system") || !cl.contains(VOYAGER_DARK)) {
        cl.remove("theme--light", "theme--system");
        cl.add(VOYAGER_DARK);
      }
    } else if (
      (cl.contains(VOYAGER_DARK) && !originals.includes(VOYAGER_DARK)) ||
      originals.some((c) => !cl.contains(c))
    ) {
      cl.remove(VOYAGER_DARK);
      for (const c of originals) cl.add(c);
    }
  }

  function applyHue(on) {
    const host = hueHost();
    // dark.css patches gaps in LinkedIn's own hue dark palette under this
    // attribute. It tracks our mode, not the class, so it also applies when
    // LinkedIn already rendered the page dark.
    setRootFlag(HUE_PATCH_ATTR, on && !!host);
    if (!host) return;
    if (original.hue === null) original.hue = host.classList.contains(HUE_DARK) ? HUE_DARK : HUE_LIGHT;
    const next = on ? HUE_DARK : original.hue;
    const prev = next === HUE_DARK ? HUE_LIGHT : HUE_DARK;
    // classList writes queue a mutation even when nothing changes, and the
    // class observer would answer it with another apply() every frame.
    if (host.classList.contains(next) && !host.classList.contains(prev)) return;
    host.classList.remove(prev);
    host.classList.add(next);
  }

  function applyRecolor(on) {
    setRootFlag(INVERT_ATTR, on);
  }

  function apply() {
    strategy = detect();
    const on = wantsDark();

    // Only the chosen strategy may be active; leftovers from a previous guess
    // would fight the one that actually works.
    if (strategy !== "recolor") applyRecolor(false);
    if (strategy !== "sdui") applySdui(false);
    if (strategy !== "voyager") applyVoyager(false);
    if (strategy !== "hue") applyHue(false);

    if (strategy === "sdui") applySdui(on);
    else if (strategy === "voyager") {
      applyVoyager(on);
      watchVoyagerSheet();
    } else if (strategy === "hue") applyHue(on);
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
    if (strategy !== "recolor" || !wantsDark() || !document.body) return;
    let sampled = 0;
    let illegible = 0;
    // Sample whatever element owns each text node rather than a tag list: body
    // copy sits in <div>s and in paragraphs that also hold <strong> or <a>,
    // which a tag allowlist that skips parents never measures.
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text && sampled < 60; text = walker.nextNode()) {
      const el = text.parentElement;
      if (!el || seen.has(el) || !text.data.trim()) continue;
      seen.add(el);
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
  // Our own writes still cost one extra frame (records arrive after the write
  // returns, so no flag can suppress them); that run finds nothing to change
  // only because every applier skips writes the page already matches.
  let queued = false;
  const scheduleApply = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply();
    });
  };
  const observer = new MutationObserver(scheduleApply);

  // Voyager's dark rules live in a stylesheet LinkedIn can add late, switch off,
  // or swap out without touching the class, so on those pages <head> and the
  // sheet's disabled/media attributes are watched too; nothing else would put
  // it back. A sheet disabled only through its CSSOM object leaves no record
  // and waits for the next apply().
  let headWatched = false;
  let watchedSheet = null;
  function watchVoyagerSheet() {
    if (!headWatched && document.head) {
      observer.observe(document.head, { childList: true });
      headWatched = true;
    }
    const link = voyagerLink();
    if (!link || link === watchedSheet) return;
    watchedSheet = link;
    observer.observe(link, { attributes: true, attributeFilter: ["disabled", "media"] });
  }

  const start = () => {
    apply();
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
        : strategy === "hue" ? !!hueHost()?.classList.contains(HUE_DARK)
        : strategy === "recolor" ? root.getAttribute(INVERT_ATTR) === "dark"
        : false;
      sendResponse({ mode: currentMode, strategy, applied });
      return false;
    });
  }
})();
