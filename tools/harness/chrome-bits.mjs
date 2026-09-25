// Help Center chrome: avatar menu (the user's signed-in markup, injected open),
// footer logo wordmark, and the footer language <select>.
// Usage: node chrome-bits.mjs <variant> <url> <shotName>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const [variant = "after", url, shot] = process.argv.slice(2);
const MENU = readFileSync(`${here}/fixtures/me-menu.html`, "utf8");
const browser = await launch({ extPath: `${here}/ext-${variant}`.split("/").join(String.fromCharCode(92)), port: 9560 + Math.floor(Math.random() * 30), profileRoot: here });
const pg = await browser.newPage();
await pg.send("Page.bringToFront");
await pg.goto(url, 3000);

function probe(menuHtml) {
  const parse = (v) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(v || "");
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = ({ r, g, b }) => { const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const effBg = (el) => { for (let n = el; n && n !== document; n = n.parentElement) { const bg = parse(getComputedStyle(n).backgroundColor); if (bg && bg.a > 0.5) return bg; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const ratio = (fgs, bg) => { const fg = parse(fgs); const c = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }; const [h, l] = [lum(c), lum(bg)].sort((a, b) => b - a); return +((h + 0.05) / (l + 0.05)).toFixed(2); };

  // Avatar menu: signed out there is a "Sign in" button instead, so mount the
  // signed-in container LinkedIn renders, with the menu open.
  const header = document.querySelector(".global-header nav, .site-navigation");
  const wrap = document.createElement("div");
  wrap.className = "dropdown__container me-menu";
  wrap.innerHTML = menuHtml;
  header.append(wrap);
  const menu = wrap.querySelector(".me-menu__dropdown-menu");
  Object.assign(menu.style, { display: "block", position: "fixed", right: "24px", top: "64px", width: "280px", zIndex: 9999 });
  const rows = [...menu.querySelectorAll("h3, p, a, h4")].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== "none")
    .map((e) => ({ t: e.textContent.trim().slice(0, 26), k: ratio(getComputedStyle(e).color, effBg(e)), fg: getComputedStyle(e).color }));
  const mcs = getComputedStyle(menu); const menuInfo = { border: mcs.borderTopWidth + " " + mcs.borderTopStyle + " " + mcs.borderTopColor, outline: mcs.outlineStyle + " " + mcs.outlineColor, shadow: mcs.boxShadow, bg: mcs.backgroundColor, min: Math.min(...rows.map((r) => r.k)), rows };

  const logo = document.querySelector('.global-footer li-icon[type="linkedin-logo"]');
  const textPaths = logo ? [...logo.querySelectorAll(".linkedin-text path, .linkedin-text rect")] : [];
  const footerBg = effBg(logo || document.body);
  const logoInfo = logo ? { svg: !!logo.querySelector("svg"), textParts: textPaths.length, fill: textPaths[0] && getComputedStyle(textPaths[0]).fill, vsFooter: textPaths[0] ? ratio(getComputedStyle(textPaths[0]).fill, footerBg) : null, groups: [...new Set([...logo.querySelectorAll("[class]")].map((e) => e.getAttribute("class")))].slice(0, 6) } : null;

  const sel = document.querySelector(".language-switcher__form-select");
  const opt = sel && sel.querySelector("option");
  const selectInfo = sel ? { select: `${getComputedStyle(sel).color} on ${getComputedStyle(sel).backgroundColor} scheme=${getComputedStyle(sel).colorScheme}`, option: `${getComputedStyle(opt).color} on ${getComputedStyle(opt).backgroundColor}`, optionRatio: ratio(getComputedStyle(opt).color, parse(getComputedStyle(opt).backgroundColor)) } : null;
  return { menu: menuInfo, logo: logoInfo, select: selectInfo };
}

const r = await pg.eval(`(${probe.toString()})(${JSON.stringify(MENU)})`);
console.log("menu edge:", r.menu.border, "| outline", r.menu.outline, "| shadow", r.menu.shadow); console.log("avatar menu:", "bg", r.menu.bg, "| lowest", r.menu.min, "|", r.menu.rows.map((x) => `«${x.t}» ${x.k}`).join("  "));
console.log("footer logo:", JSON.stringify(r.logo));
console.log("language select:", JSON.stringify(r.select));
if (shot) {
  const m = await pg.send("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: 960, y: 40, width: 320, height: 300, scale: 2 } });
  writeFileSync(`${here}/out-${variant}/${shot}-menu.jpg`, Buffer.from(m.data, "base64"));
  const lm = await pg.send("Page.getLayoutMetrics");
  const f = await pg.send("Page.captureScreenshot", { format: "jpeg", quality: 70, captureBeyondViewport: true, clip: { x: 0, y: Math.max(0, lm.cssContentSize.height - 140), width: 1280, height: 140, scale: 0.8 } });
  writeFileSync(`${here}/out-${variant}/${shot}-footer.jpg`, Buffer.from(f.data, "base64"));
}
await browser.close();
