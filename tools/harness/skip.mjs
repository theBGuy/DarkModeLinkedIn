import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
import { decodePng, relLum } from "./png.mjs";
const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const browser = await launch({ extPath: `${here}/ext-after`.split("/").join(String.fromCharCode(92)), port: 9640 + Math.floor(Math.random() * 20), profileRoot: here });
const pg = await browser.newPage();
await pg.send("Page.bringToFront");
await pg.goto("https://www.linkedin.com/help/learning/answer/a705966", 2500);
// Real keyboard focus: Tab from the top of the document.
await pg.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
await pg.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
await new Promise((r) => setTimeout(r, 500));
const info = await pg.eval(`(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return { text: a.textContent.trim(), top: r.top, h: r.height, w: r.width, left: r.left, color: cs.color, bg: cs.backgroundColor, border: cs.borderColor, shadow: cs.boxShadow.slice(0, 60), menuBg: getComputedStyle(a.closest(".accessibility-menu")).backgroundColor, menuH: a.closest(".accessibility-menu").getBoundingClientRect().height }; })()`);
console.log(JSON.stringify(info));
if (info.w > 0 && info.top >= 0) {
  const shot = await pg.send("Page.captureScreenshot", { format: "png", clip: { x: info.left, y: info.top, width: info.w, height: info.h, scale: 1 } });
  const { px, bpp, width, height } = decodePng(Buffer.from(shot.data, "base64"));
  const ls = []; for (let p = 0; p < width * height; p++) ls.push(relLum(px[p * bpp], px[p * bpp + 1], px[p * bpp + 2]));
  ls.sort((a, b) => a - b);
  const lo = ls[Math.floor(ls.length * 0.05)], hi = ls[Math.floor(ls.length * 0.98)];
  console.log(`focused skip link pixels: darkest(5%)=${lo.toFixed(3)} brightest(98%)=${hi.toFixed(3)} text-vs-backdrop ratio=${((hi + 0.05) / (lo + 0.05)).toFixed(2)}`);
}
await browser.close();
