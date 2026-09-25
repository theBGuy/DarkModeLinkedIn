// Audits every URL in a list with the staged extension: expands collapsibles,
// measures every visible text owner, lists leftover light surfaces, and groups
// failures by signature across pages. Usage: node sweep.mjs <variant> <urls.txt> <tag>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
import { imageBackdrops } from "./imgcheck.mjs";

const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const [variant = "after", listFile, tag = "sweep"] = process.argv.slice(2);
const urls = readFileSync(listFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9100 + Math.floor(Math.random() * 150), profileRoot: here });
const page = await browser.newPage();
// MOBILE=1: phone viewport. The collapse button also carries aria-expanded=false,
// so clicking every such button would re-close the mobile menu it just opened.
const MOBILE = !!process.env.MOBILE;
if (MOBILE) await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
// NAV=1 opens the mobile menu (which hides the page content); otherwise the
// menu buttons are left alone so the content itself is measured.
const NAV = !!process.env.NAV;
const OPEN = `(() => {
  const skip = ${NAV ? `"[data-header-collapse-navigation-button]"` : `"[data-header-collapse-navigation-button], [data-header-expand-navigation-button]"`};
  for (const b of document.querySelectorAll("button[aria-expanded='false']")) { if (!b.matches(skip)) { try { b.click(); } catch {} } }
  ${NAV ? `for (const b of document.querySelectorAll(".custom-header__nav--mobile .header-navigation__button")) { try { b.click(); } catch {} }` : ""}
  return true;
})()`;
const NAV_STATE = `(() => { const nav = document.querySelector(".custom-header__nav--mobile"); return nav ? (getComputedStyle(nav).visibility === "visible" ? "open" : "closed") : "none"; })()`;

const PROBE = `(() => {
  const parse = (v) => { const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+))?/.exec(v || ""); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
  const lum = ({ r, g, b }) => { const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const effBg = (el) => { for (let n = el; n && n !== document; n = n.parentElement) { const bg = parse(getComputedStyle(n).backgroundColor); if (bg && bg.a > 0.5) return bg; } return { r: 255, g: 255, b: 255, a: 1 }; };
  // Composite translucent ink over its backdrop before measuring.
  const ratio = (fg, bg) => { const c = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }; const [hi, lo] = [lum(c), lum(bg)].sort((a, b) => b - a); return (hi + 0.05) / (lo + 0.05); };
  const sig = (el) => { const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).filter((c) => !/^(t-|text-|font-|py-|px-|w-|block|flex|items-|z-|absolute|relative|hover:|focus:|-top)/.test(c)).slice(0, 3).join(".") : ""; const p = el.parentElement; const pc = p && typeof p.className === "string" ? p.className.trim().split(/\\s+/)[0] || p.tagName.toLowerCase() : ""; return (pc ? pc + " > " : "") + el.tagName.toLowerCase() + (cls ? "." + cls : ""); };
  const seen = new Set(); const fails = []; let total = 0, lt3 = 0, lt45 = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const el = t.parentElement; if (!el || seen.has(el) || !t.data.trim()) continue; seen.add(el);
    if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const fg = parse(cs.color); if (!fg || fg.a < 0.3) continue;
    const bg = effBg(el); const k = ratio(fg, bg); total++;
    if (k < 4.5) { lt45++; if (k < 3) lt3++; fails.push({ sig: sig(el), k: +k.toFixed(2), fg: cs.color, bg: "rgb(" + bg.r + "," + bg.g + "," + bg.b + ")", text: t.data.trim().slice(0, 30) }); }
  }
  const light = {};
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
    const bg = parse(cs.backgroundColor); if (!bg || bg.a <= 0.5 || lum(bg) < 0.35) continue;
    const r = el.getBoundingClientRect(); if (r.width * r.height < 600) continue;
    const k = sig(el) + " | " + cs.backgroundColor; light[k] = (light[k] || 0) + 1;
  }
  return { url: location.href, dmli: document.documentElement.getAttribute("data-dmli"), total, lt3, lt45, fails, light };
})()`;

const all = [];
for (const url of urls) {
  try {
    await page.send("Page.bringToFront");
    await page.goto(url, 2500);
    await page.eval(OPEN);
    await new Promise((r) => setTimeout(r, 900));
    const r = await page.eval(PROBE);
    r.nav = await page.eval(NAV_STATE);
    r.img = await imageBackdrops(page);
    all.push(r);
    console.log(`${r.url.replace("https://www.linkedin.com", "").slice(0, 52).padEnd(53)} dmli=${String(r.dmli).padEnd(4)} text=${String(r.total).padStart(4)} <3=${String(r.lt3).padStart(3)} <4.5=${String(r.lt45).padStart(3)} lightSurfaces=${Object.values(r.light).reduce((a, b) => a + b, 0)} imgText=${r.img.length} imgFail=${r.img.filter((x) => x.mean < 4.5).length} nav=${r.nav}`);
  } catch (e) {
    console.log(`${url} FAILED ${e.message}`);
  }
}
const bySig = {};
for (const r of all) for (const f of r.fails) {
  const k = `${f.sig} | ${f.fg} on ${f.bg}`;
  (bySig[k] ??= { n: 0, pages: new Set(), min: 99, ex: f.text }).n++;
  bySig[k].pages.add(r.url.replace(/^https:\/\/www\.linkedin\.com/, ""));
  bySig[k].min = Math.min(bySig[k].min, f.k);
}
console.log("\nFAILURES (<4.5) by signature:");
for (const [k, v] of Object.entries(bySig).sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(`  ${String(v.n).padStart(4)} min=${v.min} pages=${v.pages.size}  ${k}  «${v.ex}»`);
const surf = {};
for (const r of all) for (const [k, n] of Object.entries(r.light)) (surf[k] ??= { n: 0, pages: 0 }), (surf[k].n += n), surf[k].pages++;
console.log("\nIMAGE-BACKED TEXT below 4.5:1 (mean backdrop):");
for (const r of all) for (const x of r.img.filter((x) => x.mean < 4.5)) console.log(`  ${r.url.replace("https://www.linkedin.com", "")}  mean=${x.mean} p95=${x.p95} ${x.color} «${x.text}»`);
console.log("\nLIGHT SURFACES by signature:");
for (const [k, v] of Object.entries(surf).sort((a, b) => b[1].n - a[1].n).slice(0, 30)) console.log(`  ${String(v.n).padStart(4)} pages=${v.pages}  ${k}`);
writeFileSync(`${here}/out-${variant}/${tag}.json`, JSON.stringify(all, null, 2));
if (browser.exceptions.filter((e) => !/static\.licdn\.com/.test(e)).length) console.log("\nNON-LINKEDIN EXCEPTIONS:", browser.exceptions.filter((e) => !/static\.licdn\.com/.test(e)));
await browser.close();
