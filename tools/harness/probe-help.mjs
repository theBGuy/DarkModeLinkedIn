// Deep probe of a help article under the staged extension: expands every
// collapsible, measures ::before markers, then re-runs the full audit.
// Usage: node probe-help.mjs <before|after> [url]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");
const variant = process.argv[2] ?? "after";
const url = process.argv[3] ?? "https://www.linkedin.com/help/linkedin/answer/a1339364";
const ext = `${here}/ext-${variant}`; // staged by run.mjs
const audit = readFileSync(`${here}/audit.js`, "utf8");

const browser = await launch({ extPath: ext.replace(/\//g, "\\"), port: 9700 + Math.floor(Math.random() * 200), profileRoot: here });
const page = await browser.newPage();
await page.goto(url, 3000);

const markers = await page.eval(`(() => {
  const out = [];
  for (const li of [...document.querySelectorAll(".article-content__ordered-list-item, .article-content__rich-text ol li")].slice(0, 3)) {
    const b = getComputedStyle(li, "::before");
    out.push({ content: b.content, color: b.color, bg: b.backgroundColor });
  }
  const trig = document.querySelector(".collapsible__trigger");
  const t = trig && getComputedStyle(trig);
  return { markers: out, trigger: t && { color: t.color, bg: t.backgroundColor } };
})()`);
console.log(JSON.stringify(markers));

await page.eval(`(() => { for (const b of document.querySelectorAll(".collapsible__trigger[aria-expanded='false']")) b.click(); return true; })()`);
await new Promise((r) => setTimeout(r, 800));
const r = await page.eval(audit);
console.log(`expanded: audit<2=${r.audit.below2} <3=${r.audit.below3} <4.5=${r.audit.below45} of ${r.audit.total}`);
const byKind = {};
for (const w of r.worst) byKind[`${w.el} ${w.fg} on ${w.bg}`] = (byKind[`${w.el} ${w.fg} on ${w.bg}`] ?? 0) + 1;
console.log(byKind);
const tables = await page.eval(`(() => {
  const t = document.querySelector(".artdeco-table--striped");
  if (!t) return null;
  const cell = t.querySelector("td"); const a = t.querySelector("a"); const even = t.querySelector("tbody tr:nth-child(even)");
  const c = (el) => el && { color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor };
  const w = t.closest(".article-content__rich-text-table"); return { wrapperShadow: w && getComputedStyle(w).boxShadow, tableShadow: getComputedStyle(t).boxShadow, table: c(t), cell: c(cell), evenRow: c(even), link: c(a), th: c(t.querySelector("th")) };
})()`);
console.log(JSON.stringify(tables));
await page.shot(`${here}/out-${variant}/help-expanded.jpg`, { fullPage: true, scale: 0.5 });
writeFileSync(`${here}/out-${variant}/help-expanded.json`, JSON.stringify({ markers, r, tables }, null, 2));
if (browser.exceptions.length) console.log("exceptions:", browser.exceptions.length);
await browser.close();
