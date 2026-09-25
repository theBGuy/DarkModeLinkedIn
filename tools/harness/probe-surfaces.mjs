// Lists hardcoded light surfaces and dark ink left on a recolored page, grouped
// by class signature, so each can be traced to the stylesheet rule that paints it.
// Usage: node probe-surfaces.mjs <before|after> <url> [url...]
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const [variant = "after", ...urls] = process.argv.slice(2);
const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9800 + Math.floor(Math.random() * 150), profileRoot: here });
const page = await browser.newPage();
const out = {};
for (const url of urls) {
  await page.send("Page.bringToFront");
  await page.goto(url, 3000);
  // Open every collapsible so hidden panels are measured too.
  await page.eval(`(() => { for (const b of document.querySelectorAll("[aria-expanded='false']")) { try { b.click(); } catch {} } return true; })()`);
  await new Promise((r) => setTimeout(r, 800));
  const r = await page.eval(`(() => {
    const lum = (c) => { const m = /rgba?\\(([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+))?/.exec(c || ""); if (!m) return null;
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return { L: 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]), a: m[4] === undefined ? 1 : +m[4] }; };
    const sig = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).join(".") : "");
    const surfaces = {}, inks = {};
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      const bg = lum(cs.backgroundColor);
      if (bg && bg.a > 0.5 && bg.L > 0.4 && r.width * r.height > 400) {
        const k = sig(el).slice(0, 110) + " | bg " + cs.backgroundColor;
        surfaces[k] = (surfaces[k] || 0) + 1;
      }
      const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
      const fg = lum(cs.color);
      if (ownsText && fg && fg.L < 0.2 && r.width >= 12) {
        const k = sig(el).slice(0, 110) + " | color " + cs.color;
        inks[k] = (inks[k] || 0) + 1;
      }
    }
    return { url: location.href, dmli: document.documentElement.getAttribute("data-dmli"), surfaces, inks };
  })()`);
  out[url] = r;
  console.log("==", r.url, "dmli=" + r.dmli);
  console.log(" SURFACES (light, opaque):");
  for (const [k, n] of Object.entries(r.surfaces).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log("   " + String(n).padStart(3) + "  " + k);
  console.log(" DARK INK:");
  for (const [k, n] of Object.entries(r.inks).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log("   " + String(n).padStart(3) + "  " + k);
}
writeFileSync(`${here}/out-${variant}/surfaces.json`, JSON.stringify(out, null, 2));
await browser.close();
