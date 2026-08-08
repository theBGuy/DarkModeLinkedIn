// Generates ../dark.css from tokens-light.json — a snapshot of the ~900 CSS custom
// properties LinkedIn defines on :root (captured live from linkedin.com; see README).
// Strategy: perceptual lightness inversion in OKLCh (hue preserved) so every
// text/background token pair flips together and keeps its contrast relationship,
// plus exact anchors for brand surfaces so the result matches LinkedIn's own
// native dark mode (canvas #000, cards #1b1f23, action blue #70b5f9).
//
// Usage: node tools/generate-theme.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "tokens-light.json"), "utf8"));

// ---------- sRGB <-> OKLCh ----------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab(r, g, b) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToSrgb);
}

const inGamut = (rgb) => rgb.every((c) => c >= -0.0001 && c <= 1.0001);

// Reduce chroma until the color fits in sRGB (binary search).
function oklchToRgbClamped(L, C, h) {
  const toRgb = (c) => oklabToRgb(L, c * Math.cos(h), c * Math.sin(h));
  let rgb = toRgb(C);
  if (!inGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(toRgb(mid))) lo = mid;
      else hi = mid;
    }
    rgb = toRgb(lo);
  }
  return rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
}

// ---------- color parsing ----------
// Hex and rgb() must be matched by ONE regex in ONE pass. Two chained
// .replace() calls would let the second re-scan text the first just wrote, and
// since fmt() emits rgba() for translucent colors, every hex-with-alpha value
// would be inverted twice and come back out roughly where it started.
// Lengths are pinned to the four CSS-valid ones, longest first, so #rrggbbaa
// cannot be mis-read as #rrggbb followed by stray digits.
const COLOR_RE =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/gi;

function parseHex(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
}

const fmt = ({ r, g, b, a }) =>
  a >= 1
    ? `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`
    : `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})`;

// ---------- the inversion ----------
// Exact anchors: LinkedIn's own dark-mode values for its most recognizable colors.
const ANCHORS = new Map([
  ["#0a66c2", "#70b5f9"], // action blue -> dark-mode action blue
  ["#004182", "#a8d4ff"], // action blue hover (darker) -> lighter
  ["#09344f", "#cfe3f7"],
  ["#f4f2ee", "#000000"], // page canvas
  ["#f3f2ef", "#000000"],
  ["#057642", "#7fc15e"], // success green
  ["#b24020", "#ff9c7a"], // error/negative accent seen in light palette
]);

const SURFACE_NAME = /container|surface|background|card/;
const CANVAS_NAME = /canvas/;

function invertColor({ r, g, b, a }, tokenName) {
  if (a === 0) return null; // transparent stays transparent
  const key = fmt({ r, g, b, a: 1 });
  if (ANCHORS.has(key)) {
    const anchored = parseHex(ANCHORS.get(key));
    return { ...anchored, a };
  }
  const { L, a: A, b: B } = rgbToOklab(r / 255, g / 255, b / 255);
  const C = Math.hypot(A, B);
  const h = Math.atan2(B, A);

  let newL;
  if (C < 0.02) {
    // Achromatic: white-ish surfaces get LinkedIn's dark card color instead of
    // pure black; canvases go black; everything else mirrors lightness.
    if (L > 0.93 && SURFACE_NAME.test(tokenName) && !CANVAS_NAME.test(tokenName)) {
      const card = parseHex("#1b1f23");
      return { ...card, a };
    }
    if (L > 0.93 && CANVAS_NAME.test(tokenName)) return { r: 0, g: 0, b: 0, a };
    newL = Math.min(0.97, Math.max(0.05, 1 - L));
  } else {
    // Chromatic: mirror then lighten (^0.65) — mid-lightness accents must get
    // LIGHTER on dark backgrounds to keep contrast, not merely mirrored.
    newL = Math.min(0.97, Math.max(0.1, (1 - L) ** 0.65));
  }
  const [nr, ng, nb] = oklchToRgbClamped(newL, C, h);
  return { r: nr, g: ng, b: nb, a };
}

function transformValue(name, value) {
  // Tokens whose name says "dark"/"on-dark" already encode a dark-context value.
  if (/-dark\b|on-dark/.test(name)) return null;
  let touched = false;
  const out = value.replace(COLOR_RE, (m, r, g, b, a) => {
    const parsed =
      m[0] === "#" ? parseHex(m) : { r: +r, g: +g, b: +b, a: a === undefined ? 1 : +a };
    const inv = invertColor(parsed, name);
    if (!inv) return m;
    touched = true;
    return fmt(inv);
  });
  return touched ? out : null;
}

// ---------- contrast repair ----------
// Mirroring lightness preserves a pair's contrast only when one side is near an
// extreme. A mid-gray like #666 mirrors to another mid-gray and ends up
// illegible on a dark surface, so foreground tokens get a second pass that
// pushes lightness away from their real backdrop until they clear WCAG.

const CARD = { r: 27, g: 31, b: 35, a: 1 }; // #1b1f23, the more demanding of the
// two surfaces for light text (black canvas gives strictly more contrast)

const composite = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const relLum = ({ r, g, b }) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const parseColor = (v) => {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
};

// Ink is painted on the "-container" of the same family, so that is what its
// contrast must be measured against — white-on-blue button ink judged against
// the page surface gets "corrected" in exactly the wrong direction.
//
// "-label" pairs even bare: --color-label-current really does sit on
// --color-container-current. "-icon" does NOT. The bare --color-icon-* family
// is the page-level icon color, and --color-icon-brand / --color-container-brand
// are the same swatch under two names, so pairing them asks a color to contrast
// with itself. Only a component-prefixed icon (--color-button-icon-primary)
// names something it sits inside.
const PREFIX_LEN = "--color".length;

const pairedBackdrop = (name, darkTokens) => {
  for (const [role, allowBare] of [["-label", true], ["-icon", false]]) {
    const at = name.indexOf(role);
    if (at < 0) continue;
    if (!allowBare && at <= PREFIX_LEN) continue;
    const containerName = name.replace(role, "-container");
    // Identical light values prove the two names describe one swatch rather
    // than ink and the surface under it.
    if (!darkTokens[containerName] || tokens[name] === tokens[containerName]) continue;
    return darkTokens[containerName];
  }
  return null;
};

const FOREGROUND_NAME = /-(text|label|link|icon)/;
const NON_TEXT_NAME = /icon|border|divider|separator|outline/;
// "loading" joins "disabled" here: both are transient, deliberately faded
// states that WCAG exempts, and forcing them opaque would erase the affordance.
const EXEMPT_NAME = /disabled|loading|placeholder|-on-dark|shadow|scrim|overlay/;

function repairContrast(name, darkValue, lightValue, darkTokens) {
  if (!FOREGROUND_NAME.test(name) || EXEMPT_NAME.test(name)) return darkValue;

  const fg = parseColor(darkValue);
  if (!fg || fg.a === 0) return darkValue;

  // Role check: a token that was LIGHT in the light theme is a surface being
  // painted behind text, not the text itself, whatever its name says
  // (--color-text-highlight is the highlighter swatch, not the ink).
  const light = parseColor(lightValue);
  if (light) {
    const { L } = rgbToOklab(light.r / 255, light.g / 255, light.b / 255);
    if (L > 0.75 && !pairedBackdrop(name, darkTokens)) return darkValue;
  }

  const backdropRaw = pairedBackdrop(name, darkTokens);
  const backdrop = (backdropRaw && parseColor(backdropRaw)) || CARD;
  const bg = backdrop.a < 1 ? composite(backdrop, CARD) : backdrop;

  const target = NON_TEXT_NAME.test(name) ? 3 : 4.5;
  if (contrast(composite(fg, bg), bg) >= target) return darkValue;

  const { L, a: A, b: B } = rgbToOklab(fg.r / 255, fg.g / 255, fg.b / 255);
  const C = Math.hypot(A, B);
  const h = Math.atan2(B, A);

  const at = (nl) => {
    const [r, g, b] = oklchToRgbClamped(nl, C, h);
    const cand = { r, g, b, a: fg.a };
    return { cand, ratio: contrast(composite(cand, bg), bg) };
  };

  // Search both directions. Which one helps is NOT a property of the backdrop
  // alone: against a mid-lightness surface, dark ink and light ink can both
  // work, and guessing from a fixed threshold sends nearly-black text toward
  // white where it ends up worse. Take the smallest shift that clears the
  // target; if neither direction can, keep whichever reads best.
  let best = null;
  let fallback = { cand: fg, ratio: contrast(composite(fg, bg), bg) };
  for (let step = 1; step <= 100 && !best; step++) {
    for (const nl of [L + step * 0.01, L - step * 0.01]) {
      if (nl < 0 || nl > 1) continue;
      const tried = at(nl);
      if (tried.ratio >= target) {
        best = tried.cand;
        break;
      }
      if (tried.ratio > fallback.ratio) fallback = tried;
    }
  }

  // Translucent ink can be lightness-capped: once it is pure black or white,
  // only solidity is left. Safe for text, never for the non-text tokens above,
  // whose transparency IS the design.
  if (!best && fg.a < 1 && !NON_TEXT_NAME.test(name)) {
    for (let a = fallback.cand.a; a <= 1.0001; a += 0.02) {
      const cand = { ...fallback.cand, a: Math.min(1, +a.toFixed(3)) };
      if (contrast(composite(cand, bg), bg) >= target) {
        best = cand;
        break;
      }
    }
  }
  return fmt(best ?? fallback.cand);
}

// ---------- emit ----------
const darkTokens = {};
for (const [name, value] of Object.entries(tokens)) {
  if (!name.startsWith("--color") && !name.startsWith("--reactions-color")) continue;
  const dark = transformValue(name, value);
  if (dark !== null && dark !== value) darkTokens[name] = dark;
}

// White ink with no container token — the badge count, attachment chip labels —
// sits on a saturated surface LinkedIn paints from its own stylesheet, not from
// a custom property, so we cannot darken that surface to match. Flipping only
// the ink would put black text on a red notification badge. Keep it white.
const isOrphanWhiteInk = (name) => {
  if (!FOREGROUND_NAME.test(name) || EXEMPT_NAME.test(name)) return false;
  if (!/^(#fff(fff)?|rgba?\(255,\s*255,\s*255)/i.test(tokens[name] || "")) return false;
  return !pairedBackdrop(name, darkTokens);
};

const lines = [];
let repaired = 0;
let preserved = 0;
for (const [name, dark] of Object.entries(darkTokens)) {
  if (isOrphanWhiteInk(name)) {
    preserved++;
    lines.push(`  ${name}: ${tokens[name]} !important;`);
    continue;
  }
  const fixed = repairContrast(name, dark, tokens[name], darkTokens);
  if (fixed !== dark) repaired++;
  lines.push(`  ${name}: ${fixed} !important;`);
}
const count = lines.length;

const header = `/* dark.css — generated by tools/generate-theme.mjs. DO NOT EDIT the token
 * block by hand; edit the generator or extras.css and re-run. */
`;

const tokenBlock = `html[data-dmli="dark"] {\n${lines.join("\n")}\n}\n`;

let extras = "";
try {
  extras = readFileSync(join(here, "extras.css"), "utf8");
} catch {}

writeFileSync(join(here, "..", "dark.css"), header + tokenBlock + "\n" + extras);
console.log(
  `dark.css written: ${count} token overrides ` +
    `(${repaired} adjusted for contrast, ${preserved} white ink preserved)` +
    (extras ? " + extras.css" : ""),
);
