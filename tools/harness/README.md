# Live test harness

Drives a real Chrome with the extension loaded and measures LinkedIn as it is
actually rendered. It checks text contrast, which theming strategy ran, mode
switching, and whether the page settles without attribute writes. Nothing here
ships: `tools/` is outside the manifest's reach, so `tools/build.mjs` never
packages it.

Everything runs signed out against public pages, plus local stand-in pages
for front-ends that need a login. Anything signed-in-only still needs a person
to check it.

## Setup

- Node 22 or newer. It uses the global `WebSocket` and `fetch`, with no
  dependencies.
- Chrome at the default Windows path, or set `CHROME_PATH`. `--load-extension`
  was removed in Chrome 137, so `cdp.mjs` starts Chrome with
  `--enable-unsafe-extension-debugging` and loads the extension through the CDP
  `Extensions.loadUnpacked` command.
- Run the scripts from this folder. They write generated output next to
  themselves (`ext-*/`, `out-*/`, throwaway `prof-*/` Chrome profiles,
  `help-crawl.json`), all of which is gitignored.

## Staging the extension

```sh
node run.mjs after               # stage the working tree as ext-after/, then run the regression pages
BASE_REF=<ref> node run.mjs before  # stage a git ref as ext-before/ for a before/after comparison
```

`run.mjs` copies the extension and adds an `http://localhost/*` match, so the
local fixtures get the content script. Plain `file://` pages never would. Most
other scripts load the staged `ext-<variant>/` folder, so stage first.

## Scripts

| Script | What it checks |
|---|---|
| `run.mjs` | The regression pages: Help Center, guest pages, `/login`, legal, and the local stand-ins. For each it prints the strategy markers and a full-page contrast audit. |
| `sweep.mjs <variant> <list> <tag>` | Audits every URL in a list with collapsibles expanded. It groups failures by element and color, lists leftover light surfaces, and pixel-checks text drawn over images. `MOBILE=1` switches to a phone viewport; `NAV=1` also opens the mobile menu. |
| `modes.mjs` | Help Center article: On, Off, Match system both ways, popup state, LinkedIn resetting the class, reload, and attribute writes at rest. |
| `voyager-test.mjs` | Voyager stand-ins: modes, idle writes, dark-account restore, and the dark stylesheet being disabled, set to `media="not all"`, replaced, or added late. |
| `sdui-test.mjs` | `/login`: on, off, reset, idle writes. |
| `interact.mjs <variant> <url>` | Opens the search suggestions (real key events), product picker and footer menu, and reports the lowest contrast in each. |
| `forms.mjs` | The Help Center contact form fields, and the signed-in-only search panels injected with LinkedIn's own class names. |
| `chrome-bits.mjs <variant> <url> [shot]` | The avatar menu (a signed-in markup fixture, injected open), the footer wordmark, and the language `<select>`. |
| `crawl-help.mjs [max]` | Crawls the Help Center from every product home and records each page's template and components in `help-crawl.json`. |
| `hubs.mjs`, `shots.mjs`, `mobile-nav.mjs`, `banners.mjs`, `probe-*.mjs`, `lang-sel.mjs`, `radio.mjs`, `skip.mjs`, `logo.mjs`, `edge.mjs` | Narrower probes kept from past investigations: popup state per page, screenshots, element ancestry, and specific widgets. |

Shared pieces: `cdp.mjs` (Chrome launcher and CDP session), `audit.js` (the
in-page contrast audit), `png.mjs` (a minimal PNG decoder), and `imgcheck.mjs`
(the text-over-image pixel check). `lists/` holds the URL sets used so far, and
`fixtures/` holds the stand-in pages.

## Pitfalls

- A tab that isn't in front runs neither `requestAnimationFrame` nor
  `matchMedia` change events. Call `Page.bringToFront` before checks that
  depend on them.
- Contrast measured against `background-color` can't see images. That is what
  `imgcheck.mjs` is for.
- Measure popups and controls at rest, focused, and hovered. Clicking
  everything only shows one of those states.
- Injected markup keeps its `autofocus` attribute, so Chrome's focus ring can
  look like a border bug.
- Don't re-stage `ext-*` while a sweep is using it. For parallel runs, put the
  `cd` inside each background job.
- LinkedIn changes these pages without notice. Re-measure before trusting an
  old number.
