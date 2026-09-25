// Contact form fields and signed-in-only panels on the non-hue Help Center template.
// Usage: node forms.mjs <variant>
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url)).split(String.fromCharCode(92)).join("/");
const browser = await launch({ extPath: `${here}/ext-${process.argv[2] ?? "after"}`.split("/").join(String.fromCharCode(92)), port: 9600 + Math.floor(Math.random() * 30), profileRoot: here });
const pg = await browser.newPage();

// Helpers shipped into the page as a function body, so no regex escaping passes
// through template literals.
function lib() {
  const parse = (v) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/.exec(v || "");
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const effBg = (el) => {
    for (let n = el; n && n !== document; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };
  const ratio = (fgs, bg) => {
    const fg = parse(fgs);
    const c = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const [h, l] = [lum(c), lum(bg)].sort((a, b) => b - a);
    return +((h + 0.05) / (l + 0.05)).toFixed(2);
  };
  return { effBg, ratio };
}

function checkForm() {
  const { effBg, ratio } = LIB();
  const dmli = document.documentElement.getAttribute("data-dmli");
  const fields = [...document.querySelectorAll("main input:not([type=hidden]):not([type=radio]):not([type=checkbox]), main textarea, main select")]
    .filter((f) => f.getBoundingClientRect().width > 0);
  const rows = fields.map((f) => {
    const cs = getComputedStyle(f);
    const bg = effBg(f);
    return { tag: f.tagName.toLowerCase(), text: ratio(cs.color, bg), border: ratio(cs.borderTopColor, bg), placeholder: ratio(getComputedStyle(f, "::placeholder").color, bg), fg: cs.color, bd: cs.borderTopColor, bg: `rgb(${bg.r},${bg.g},${bg.b})` };
  });
  const min = (k) => (rows.length ? Math.min(...rows.map((r) => r[k])) : null);
  const labels = [...document.querySelectorAll("main label")].filter((l) => l.getBoundingClientRect().width > 0).map((l) => ratio(getComputedStyle(l).color, effBg(l)));
  return { dmli, fields: rows.length, minText: min("text"), minBorder: min("border"), minPlaceholder: min("placeholder"), minLabel: labels.length ? Math.min(...labels) : null, sample: rows[0] };
}

function checkPanels() {
  const { effBg, ratio } = LIB();
  const box = document.createElement("div");
  box.innerHTML =
    '<div class="ai-summarized-result__content"><span class="ai-summarized-result__disclosure">AI-generated</span><p class="ai-summarized-result__content-summary-text">Summary text</p>' +
    '<button class="ai-summarized-result__view-more-button plain-button">View more</button><span class="ai-summarized-result__separator">|</span>' +
    '<h4 class="ai-summarized-result__sources-title t-black">Sources</h4><a class="ai-summarized-result__source-link" href="#">Source one</a>' +
    '<button class="ai-summarized-result__feedback-button">Helpful</button><span class="ai-summarized-result__feedback-completed">Thanks for the feedback</span></div>' +
    '<form class="ai-summarized-feedback-form"><h4 class="t-black">Was this helpful?</h4><button class="ai-summarized-feedback-form__dismiss-button" type="button">Dismiss</button>' +
    '<input type="checkbox" class="ai-summarized-feedback-form__feedback-option-input" id="o1"><label for="o1" class="ai-summarized-feedback-form__feedback-option-label">Inaccurate</label>' +
    '<input type="checkbox" checked class="ai-summarized-feedback-form__feedback-option-input" id="o2"><label for="o2" class="ai-summarized-feedback-form__feedback-option-label">Helpful</label>' +
    '<textarea class="ai-summarized-feedback-form__feedback-textarea">typed feedback</textarea><span class="ai-summarized-feedback-form__feedback-textarea-character-count">14/500</span>' +
    '<button class="ai-summarized-feedback-form__submit-button" type="button">Submit</button></form>' +
    '<div class="premium-upsell-banner"><h3 class="t-black">Try Premium</h3><p class="t-black">Subtitle</p><ul><li>Value prop</li></ul><p class="premium-upsell-banner__value-prop-subheader">Subheader</p>' +
    '<span class="premium-upsell-banner__social-proof-text">Millions use Premium</span><a class="premium-upsell-banner__primary-cta">Try now</a><a class="premium-upsell-banner__secondary-cta">Learn more</a><span class="premium-upsell-banner__footer-text">Cancel anytime</span></div>' +
    '<div class="support-card support-card--sticky artdeco-card"><div class="artdeco-card__header"><h2 class="artdeco-card__title">Card title</h2></div><h4 class="support-card__header">Chat with support</h4><p class="support-card__description">Get answers</p><a class="artdeco-button artdeco-button--secondary">Chat</a></div>';
  document.querySelector("main").prepend(box);
  const out = [...box.querySelectorAll("h2, h3, h4, p, li, label, button, a, span, textarea")].map((el) => {
    const cs = getComputedStyle(el);
    const bg = effBg(el);
    return { el: `${el.tagName.toLowerCase()}.${(el.className || "").split(" ")[0]}`, k: ratio(cs.color, bg), fg: cs.color, bg: `rgb(${bg.r},${bg.g},${bg.b})` };
  });
  const panels = [...box.children].map((p) => `${p.className.split(" ")[0]}=${getComputedStyle(p).backgroundColor}`);
  return { min: Math.min(...out.map((o) => o.k)), panels, worst: out.sort((a, b) => a.k - b.k).slice(0, 3) };
}

const run = (fn) => pg.eval(`(() => { const LIB = ${lib.toString()}; return (${fn.toString()})(); })()`);

await pg.send("Page.bringToFront");
await pg.goto("https://www.linkedin.com/help/linkedin/ask/TS-DCR", 4000);
console.log("contact form:", JSON.stringify(await run(checkForm), null, 1));
await pg.goto("https://www.linkedin.com/help/linkedin/search?q=password", 2500);
console.log("injected panels:", JSON.stringify(await run(checkPanels), null, 1));
await browser.close();
