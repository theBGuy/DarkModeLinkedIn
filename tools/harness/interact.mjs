// Opens the Help Center's popups (search suggestions, product picker, footer
// menu) and measures the text inside each against its effective background.
// Usage: node interact.mjs <variant> <url> [shotName]
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const [variant = "after", url = "https://www.linkedin.com/help/linkedin", shot] = process.argv.slice(2);
const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9760 + Math.floor(Math.random() * 30), profileRoot: here });
const pg = await browser.newPage();
await pg.send("Page.bringToFront");
await pg.goto(url, 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT = (sel) => `(() => {
  const parse = (v) => { const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+))?/.exec(v || ""); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
  const lum = ({ r, g, b }) => { const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const effBg = (el) => { for (let n = el; n && n !== document; n = n.parentElement) { const bg = parse(getComputedStyle(n).backgroundColor); if (bg && bg.a > 0.5) return bg; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const out = [];
  for (const root of document.querySelectorAll(${JSON.stringify(sel)})) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const el = t.parentElement; if (!t.data.trim()) continue;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || cs.visibility === "hidden" || +cs.opacity === 0) continue;
      const fg = parse(cs.color); const bg = effBg(el);
      const c = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const [hi, lo] = [lum(c), lum(bg)].sort((a, b) => b - a);
      out.push({ text: t.data.trim().slice(0, 28), k: +((hi + 0.05) / (lo + 0.05)).toFixed(2), fg: cs.color, bg: "rgb(" + bg.r + "," + bg.g + "," + bg.b + ")" });
    }
  }
  return out;
})()`;
const report = (label, rows) => {
  const bad = rows.filter((x) => x.k < 4.5);
  const lo = rows.reduce((m, r) => (!m || r.k < m.k ? r : m), null);
  console.log(`${label.padEnd(26)} visible text=${rows.length} below4.5=${bad.length}${lo ? `  lowest «${lo.text}» ${lo.fg} on ${lo.bg} = ${lo.k}` : ""}`);
  for (const b of bad.slice(0, 4)) console.log(`     FAIL «${b.text}» ${b.fg} on ${b.bg} = ${b.k}`);
};

// 1. search suggestions: type into the first visible search input
const box = await pg.eval(`(() => { const i = [...document.querySelectorAll("input.site-search__input")].find((x) => x.getBoundingClientRect().width > 0); if (!i) return null; i.focus(); const r = i.getBoundingClientRect(); return { id: i.id, x: r.left + 10, y: r.top + r.height / 2 }; })()`);
if (box) {
  await pg.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await pg.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  for (const ch of "password") {
    await pg.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch, code: "Key" + ch.toUpperCase(), windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
    await pg.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code: "Key" + ch.toUpperCase(), windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) });
    await sleep(80);
  }
  await sleep(2000);
  console.log("typeahead state:", JSON.stringify(await pg.eval(`(() => { const i = document.getElementById(${JSON.stringify(box.id)}); const lb = document.querySelectorAll("[id^=typeahead-listbox]"); return { value: i.value, expanded: i.getAttribute("aria-expanded"), listboxes: [...lb].map((l) => l.id + ":" + l.children.length + ":" + getComputedStyle(l).display) }; })()`)));
  report("search suggestions", await pg.eval(AUDIT(`[id^="typeahead-listbox"], .typeahead__listbox, [role="listbox"]:not([aria-hidden="true"])`)));
  await pg.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}
// 2. product picker
await pg.eval(`(() => { const b = [...document.querySelectorAll(".site-search-product-selector__trigger")].find((x) => x.getBoundingClientRect().width > 0); b && b.click(); return !!b; })()`);
await sleep(500);
report("product picker", await pg.eval(AUDIT(`.site-search-product-selector__menu[aria-hidden="false"], .site-search-product-selector__menu.dropdown__menu--open, .dropdown__menu--open`)));
await pg.eval(`(() => { document.body.click(); return true; })()`);
// 3. footer "Privacy and Terms"
await pg.eval(`(() => { const b = document.querySelector(".privacy-dropdown__trigger"); b && b.scrollIntoView(); b && b.click(); return !!b; })()`);
await sleep(500);
report("footer privacy menu", await pg.eval(AUDIT(`.global-footer .dropdown__menu`)));
report("footer (all)", await pg.eval(AUDIT(`.global-footer`)));
if (shot) {
  const m = await pg.send("Page.getLayoutMetrics");
  const r = await pg.send("Page.captureScreenshot", { format: "jpeg", quality: 55, captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, m.cssContentSize.height - 500), width: 1280, height: 500, scale: 0.6 } });
  writeFileSync(`${here}/out-${variant}/${shot}.jpg`, Buffer.from(r.data, "base64"));
}
await browser.close();
