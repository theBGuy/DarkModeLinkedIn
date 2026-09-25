// Mode switching, popup state, and mutation-loop checks on a live help article.
// Usage: node modes.mjs <before|after>   (ext-<variant> staged by run.mjs)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");
const variant = process.argv[2] ?? "after";
const HELP = "https://www.linkedin.com/help/linkedin/answer/a1339364";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await launch({ extPath: `${here}/ext-${variant}`.replace(/\//g, "\\"), port: 9500 + Math.floor(Math.random() * 150), profileRoot: here });

// ---- DOM contract the loop guard relies on ----
const blank = await browser.newPage();
const records = await blank.eval(`(async () => {
  const d = document.createElement("div"); d.className = "a b"; document.body.append(d);
  const out = {};
  for (const [name, op] of [["add-existing", () => d.classList.add("a")], ["remove-absent", () => d.classList.remove("zzz")], ["removeAttribute-absent", () => d.removeAttribute("data-x")], ["setAttribute-same", () => { d.setAttribute("data-y", "1"); }]]) {
    if (name === "setAttribute-same") d.setAttribute("data-y", "1");
    const recs = [];
    const mo = new MutationObserver((r) => recs.push(...r));
    mo.observe(d, { attributes: true });
    op();
    await new Promise((r) => setTimeout(r, 0));
    mo.disconnect();
    out[name] = recs.length;
  }
  return out;
})()`);
console.log("DOM mutation records for no-op writes:", JSON.stringify(records));

// ---- help article ----
const help = await browser.newPage();
await help.goto(HELP, 3000);
const state = () => help.eval(`({ cls: (document.body.className.match(/hue-web-color-scheme--\\w+/g) || []).join(" "), patch: document.documentElement.getAttribute("data-dmli-hue"), dmli: document.documentElement.getAttribute("data-dmli"), bg: getComputedStyle(document.body).backgroundColor })`);
let s = await state();
check("on: body switched to hue dark", s.cls === "hue-web-color-scheme--dark", JSON.stringify(s));
check("on: patch attribute set, recolor absent", s.patch === "dark" && s.dmli === null);

// Mutation loop: count attribute records on <html>/<body> over 2 s at rest.
const countMutations = (pg) => pg.eval(`(async () => {
  let n = 0; const mo = new MutationObserver((r) => { n += r.length; });
  mo.observe(document.documentElement, { attributes: true }); mo.observe(document.body, { attributes: true });
  await new Promise((r) => setTimeout(r, 2000)); mo.disconnect(); return n;
})()`);
const helpMut = await countMutations(help);
check("no attribute churn at rest on the help article", helpMut === 0, `${helpMut} records in 2 s`);

// Popup context drives storage exactly like the real popup does.
const popup = await browser.newPage();
await popup.goto(`chrome-extension://${browser.extId}/popup/popup.html`, 500);
const setMode = async (mode) => {
  await popup.eval(`chrome.storage.local.set({ mode: ${JSON.stringify(mode)} }).then(() => true)`);
  await sleep(400);
};
const getState = () => popup.eval(`(async () => {
  const out = [];
  for (const t of await chrome.tabs.query({})) {
    try { const r = await chrome.tabs.sendMessage(t.id, { type: "dmli:get-state" }); if (r) out.push(r); } catch {}
  }
  return out;
})()`);

let gs = await getState();
check("get-state reports hue, applied", gs.some((r) => r.strategy === "hue" && r.applied === true && r.mode === "on"), JSON.stringify(gs));

await setMode("off");
s = await state();
check("off: LinkedIn's light scheme restored", s.cls === "hue-web-color-scheme--light", JSON.stringify(s));
check("off: patch attribute removed", s.patch === null);
gs = await getState();
check("get-state off: hue, not applied", gs.some((r) => r.strategy === "hue" && r.applied === false && r.mode === "off"), JSON.stringify(gs));

await setMode("on");
s = await state();
check("on again: dark", s.cls === "hue-web-color-scheme--dark" && s.patch === "dark", JSON.stringify(s));

await help.send("Page.bringToFront");
await help.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await setMode("auto");
s = await state();
check("auto + system light: light", s.cls === "hue-web-color-scheme--light" && s.patch === null, JSON.stringify(s));
await help.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
await sleep(400);
s = await state();
check("auto + system dark: dark", s.cls === "hue-web-color-scheme--dark" && s.patch === "dark", JSON.stringify(s));
await setMode("on");

// LinkedIn resetting its own class (rehydration) must be put back.
await help.send("Page.bringToFront");
await help.eval(`(() => { document.body.classList.remove("hue-web-color-scheme--dark"); document.body.classList.add("hue-web-color-scheme--light"); return true; })()`);
await sleep(300);
s = await state();
check("survives LinkedIn resetting the scheme class", s.cls === "hue-web-color-scheme--dark", JSON.stringify(s));

// Reload: the localStorage mirror must theme before first paint, no recolor flash kept.
await help.goto(HELP, 1500);
s = await state();
check("after reload: dark, no recolor attribute", s.cls === "hue-web-color-scheme--dark" && s.dmli === null, JSON.stringify(s));

// ---- Voyager fixture churn, for comparison (pre-existing applier) ----
const { createServer } = await import("node:http");
const { readFileSync } = await import("node:fs");
const server = createServer((req, res) => {
  try { res.writeHead(200, { "content-type": "text/html" }); res.end(readFileSync(`${here}/../fixtures/voyager.html`)); } catch { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const vy = await browser.newPage();
await vy.goto(`http://localhost:${server.address().port}/voyager.html`, 1500);
await vy.send("Page.bringToFront");
const vyMut = await countMutations(vy);
console.log(`INFO  voyager fixture attribute churn at rest: ${vyMut} records in 2 s`);
server.close();

if (browser.exceptions.filter((e) => !/static\.licdn\.com/.test(e)).length) console.log("extension/page exceptions:", browser.exceptions);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
await browser.close();
