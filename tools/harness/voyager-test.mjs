// Voyager applier: churn at rest, on/off/auto, reset survival, dark-account restore.
// Usage: node voyager-test.mjs <before|after>
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const variant = process.argv[2] ?? "after";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const FILES = {
  "voyager.html": `${here}/../fixtures/voyager.html`,
  "voyager-dark.html": `${here}/fixtures/voyager-dark.html`,
  "voyager-link.html": `${here}/fixtures/voyager-link.html`,
  "voyager-late.html": `${here}/fixtures/voyager-late.html`,
};
const server = createServer((req, res) => {
  const f = FILES[req.url.slice(1)];
  if (!f) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "text/html" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${server.address().port}`;

const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9420 + Math.floor(Math.random() * 60), profileRoot: here });
const popup = await browser.newPage();
await popup.goto(`chrome-extension://${browser.extId}/popup/popup.html`, 300);
const setMode = async (m) => { await popup.eval(`chrome.storage.local.set({ mode: ${JSON.stringify(m)} }).then(() => true)`); await sleep(400); };

const pg = await browser.newPage();
const state = () => pg.eval(`(() => { const s = document.getElementById("ui-theme-dark"); return { cls: document.documentElement.className, sheetOn: !s.disabled && s.media !== "not all", bg: getComputedStyle(document.body).backgroundColor }; })()`);
const churn = () => pg.eval(`(async () => { let n = 0; const mo = new MutationObserver((r) => { n += r.length; }); mo.observe(document.documentElement, { attributes: true, subtree: true }); await new Promise((r) => setTimeout(r, 2000)); mo.disconnect(); return n; })()`);

await pg.send("Page.bringToFront");
await pg.goto(`${base}/voyager.html`, 1200);
let s = await state();
check("light account, on: theme--dark + dark sheet, black canvas", /theme--dark/.test(s.cls) && !/theme--light/.test(s.cls) && s.sheetOn && s.bg === "rgb(0, 0, 0)", JSON.stringify(s));
let n = await churn();
check("no attribute churn at rest", n === 0, `${n} records in 2 s`);

await setMode("off"); await pg.send("Page.bringToFront");
s = await state();
check("off: LinkedIn's theme--light restored, dark sheet off", /theme--light/.test(s.cls) && !/theme--dark/.test(s.cls) && !s.sheetOn, JSON.stringify(s));
n = await churn();
check("off: no churn at rest", n === 0, `${n} records`);

await setMode("on"); await pg.send("Page.bringToFront");
s = await state();
check("on again: dark", /theme--dark/.test(s.cls) && s.sheetOn, JSON.stringify(s));

await pg.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await setMode("auto"); await pg.send("Page.bringToFront"); await sleep(300);
s = await state();
check("auto + system light: light", /theme--light/.test(s.cls) && !s.sheetOn, JSON.stringify(s));
await pg.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await sleep(400);
s = await state();
check("auto + system dark: dark", /theme--dark/.test(s.cls) && s.sheetOn, JSON.stringify(s));
await pg.send("Emulation.setEmulatedMedia", { features: [] });
await setMode("on"); await pg.send("Page.bringToFront");

await pg.eval(`(() => { document.documentElement.classList.remove("theme--dark"); document.documentElement.classList.add("theme--light"); return true; })()`);
await sleep(300);
s = await state();
check("survives LinkedIn resetting the class", /theme--dark/.test(s.cls) && !/theme--light/.test(s.cls), JSON.stringify(s));
n = await churn();
check("settles again after the reset", n === 0, `${n} records`);

await pg.goto(`${base}/voyager-dark.html`, 1200);
s = await state();
check("dark account, on: stays dark", /theme--dark/.test(s.cls) && s.sheetOn, JSON.stringify(s));
await setMode("off"); await pg.send("Page.bringToFront");
s = await state();
check("dark account, off: LinkedIn's own dark kept", /theme--dark/.test(s.cls) && s.sheetOn, JSON.stringify(s));
await setMode("on");

// ---- real <link> sheet: LinkedIn switching the sheet off without the class ----
await pg.send("Page.bringToFront");
await pg.goto(`${base}/voyager-link.html`, 1200);
const ls = () => pg.eval(`(() => { const l = document.getElementById("ui-theme-dark"); return { cls: document.documentElement.className, disabledAttr: l.hasAttribute("disabled"), media: l.media, bg: getComputedStyle(document.body).backgroundColor }; })()`);
let L = await ls();
check("link sheet, on: enabled, black", !L.disabledAttr && L.bg === "rgb(0, 0, 0)", JSON.stringify(L));
await pg.eval(`(() => { document.getElementById("ui-theme-dark").disabled = true; return true; })()`); await sleep(300);
L = await ls(); check("LinkedIn disables the sheet: re-enabled", !L.disabledAttr && L.bg === "rgb(0, 0, 0)", JSON.stringify(L));
await pg.eval(`(() => { document.getElementById("ui-theme-dark").media = "not all"; return true; })()`); await sleep(300);
L = await ls(); check("LinkedIn sets media=not all: re-enabled", L.media === "all" && L.bg === "rgb(0, 0, 0)", JSON.stringify(L));
await pg.eval(`(() => { const o = document.getElementById("ui-theme-dark"); const n = o.cloneNode(); n.disabled = true; o.replaceWith(n); return true; })()`); await sleep(300);
L = await ls(); check("LinkedIn replaces the link: new one enabled", !L.disabledAttr && L.bg === "rgb(0, 0, 0)", JSON.stringify(L));
n = await churn(); check("link sheet: no churn at rest", n === 0, `${n} records`);
await setMode("off"); await pg.send("Page.bringToFront");
L = await ls(); check("link sheet, off: disabled again, light", L.disabledAttr && /theme--light/.test(L.cls), JSON.stringify(L));
n = await churn(); check("link sheet, off: no churn at rest", n === 0, `${n} records`);
await setMode("on");

// ---- sheet appended after load, Voyager chosen by class alone ----
await pg.send("Page.bringToFront");
await pg.goto(`${base}/voyager-late.html`, 500);
await sleep(3500);
const late = await pg.eval(`(() => { const l = document.getElementById("ui-theme-dark"); return { present: !!l, disabledAttr: l ? l.hasAttribute("disabled") : null, cls: document.documentElement.className, bg: getComputedStyle(document.body).backgroundColor }; })()`);
check("late-appended sheet: enabled, black", late.present && late.disabledAttr === false && late.bg === "rgb(0, 0, 0)", JSON.stringify(late));
n = await churn(); check("late sheet: no churn at rest", n === 0, `${n} records`);

if (browser.exceptions.length) console.log("exceptions:", browser.exceptions);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
await browser.close();
server.close();
