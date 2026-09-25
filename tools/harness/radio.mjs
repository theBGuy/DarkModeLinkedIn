import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const browser = await launch({ extPath: `${here}/ext-after`.split("/").join(String.fromCharCode(92)), port: 9690 + Math.floor(Math.random() * 20), profileRoot: here });
const pg = await browser.newPage();
await pg.send("Page.bringToFront");
await pg.goto("https://www.linkedin.com/help/linkedin/search?q=password", 2500);
console.log(JSON.stringify(await pg.eval(`(() => [...document.querySelectorAll("fieldset input[type=radio]")].slice(0, 3).map((i) => {
  const next = i.nextElementSibling; const lab = document.querySelector('label[for="' + i.id + '"]');
  const s = (el, p) => el ? getComputedStyle(el, p).boxShadow.slice(0, 70) : null;
  return { checked: i.checked, nextTag: next && next.tagName + "." + next.className, labIsNext: lab === next, nextBefore: s(next, "::before"), inputShadow: s(i), inputOutline: getComputedStyle(i).outlineColor, inputAppearance: getComputedStyle(i).appearance, inputOpacity: getComputedStyle(i).opacity, inputW: i.getBoundingClientRect().width };
}))()`), null, 1));
const r = await pg.send("Page.captureScreenshot", { format: "png", clip: await pg.eval(`(() => { const f = document.querySelector("fieldset"); const r = f.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 220), scale: 1 }; })()`) });
(await import("node:fs")).writeFileSync(`${here}/out-after/radios.png`, Buffer.from(r.data, "base64"));
await browser.close();
