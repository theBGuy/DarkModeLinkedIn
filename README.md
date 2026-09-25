# Dark Mode for LinkedIn

A Chrome (MV3) extension that gives LinkedIn a dark theme built from LinkedIn's
own design tokens, so the result keeps their visual hierarchy instead of looking
like an inverted screenshot.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open or reload a LinkedIn tab.

Click the toolbar icon to switch between **On**, **Match system**, and **Off**.
The setting syncs across every open LinkedIn tab immediately.

## How it works

LinkedIn runs **four** different front-ends, and they need different treatments.
Getting this wrong is what leaves a page half-themed — or unreadable — so
`content.js` picks a strategy from what the document actually exposes, not from
the URL, and then checks the result.

### The signed-in app (SDUI) — flip their switch

The feed, profile, messaging, and login pages already ship a complete dark
theme. Their stylesheet carries **357 dark token declarations** under
`[data-color-scheme="dark"]`, plus `color-scheme: dark` and a dark variant of
every inline SVG (LinkedIn embeds both and gates them on
`--svgDisplayLight` / `--svgDisplayDark`). It is switched off, not absent.

So on these pages the extension changes exactly one thing: `data-color-scheme`
on `<body>`, from `light` to `dark`. Nothing is inverted or guessed — you get
LinkedIn's real dark palette, their dark artwork, their shadows. Turning the
extension off restores whatever value LinkedIn had, rather than assuming
`light`. Their app re-renders and can reset the attribute during rehydration or
client-side navigation, so a `MutationObserver` puts it back.

This front-end can't be recolored the way the guest pages are: its class names
and design tokens are all content-hashed (`._7320b751`, `var(--_1a12480c)`), so
there is no stable vocabulary to override.

### Voyager — flip a different switch

Notifications and parts of the feed still run LinkedIn's older Ember app. It
keys its theme off a `theme--dark` class **and** a separate `#ui-theme-dark`
stylesheet, which is disabled while the account is set to light — so the class
alone does nothing. LinkedIn can also add that stylesheet late, switch it off,
or swap it out without touching the class, so the extension watches `<head>`
and the stylesheet's `disabled` and `media` attributes as well as the class. A
sheet switched off only through script, with no attribute change, leaves
nothing to watch and waits for the next class change. Both names come from
LinkedIn's own bundle:

```js
{light:"theme--light", dark:"theme--dark", system:"theme--system"}
{light:{theme:"#ui-theme"}, dark:{theme:"#ui-theme-dark"}}
```

### Help Center articles — flip a third switch

Help articles (`/help/<product>/answer/…`) are built on LinkedIn's "hue" design
system. `<body>` carries `hue-web-theme--classic hue-web-color-scheme--light`,
and the page's stylesheet ships **748 dark token declarations** under
`.hue-web-color-scheme--dark`, so the extension swaps that one class. The light
block defines 481 more tokens than the dark one, but every one of them is also
declared on `.hue-web-theme--classic`, which stays, so the swap loses nothing.
Hue is checked after the other two switches, so it only claims pages that would
otherwise fall through to recoloring.

LinkedIn's own dark palette for these pages has gaps. `extras.css` fills them
with LinkedIn's hue dark tokens; the footer rules reuse the same palette as
literal values, with the bottom row one step darker than the slate:

- The classic theme never colors the collapsible "Available within…" headings,
  so they fall back to the browser's black button text. The mercado theme does
  color them.
- The dark rule changes the numbered-step digit but not the disc behind it.
- The data tables are artdeco tables that hardcode a white background.
- An older stylesheet pins tab labels ("Desktop / Mobile") to black under the
  tab button LinkedIn does color.
- The side-rail support and sign-in cards take their text from the older
  `--artdeco-reset-*` tokens, which the hue dark theme never redefines.
- LinkedIn's link blue reaches only 4.4:1 on its own note-callout gold, and its
  footer stays white.

Those rules are scoped to `html[data-dmli-hue="dark"]`, an attribute
`content.js` sets only while it has the hue theme switched on, so turning the
extension off leaves LinkedIn's page untouched.

### Help Center home, search, and topic pages — recolor them in the article palette

The Help Center's home, search results, product hubs, and topic lists are a
different template, with no dark theme at all. Their `<body>` carries
`data-in-hueify-scope="false"` and no `hue-web-*` classes, and their colors are
hardcoded. They go through the recoloring strategy, and a section of
`extras.css` scoped to that attribute paints them in the same palette LinkedIn
uses for its dark articles: slate `#283e4a`, `#344a57` cards, white text,
`#98d8f4` links. Moving between a topic list and an article therefore reads as
one site. The blue header and its white search box are left as LinkedIn draws
them on the articles. The search suggestions and product picker open as white
dropdowns, so text resets are confined to `<main>` and the footer, and the
header's white popups keep dark ink.

A few pieces of chrome are shared by both Help Center templates and are handled
on both:

- The avatar menu becomes a dark card in the same palette.
- The footer's LinkedIn wordmark turns white. Its paths carry a hardcoded
  `fill="#000000"` attribute; LinkedIn's own fill rules for the logo apply only
  in the old IE high-contrast mode.
- The footer's language `<select>` gets opaque dark options. Left transparent,
  Chrome's native popup draws a white list under the select's white text.

### The guest pages — recolor them

Signed-out `linkedin.com` is a separate, older front-end with no dark theme at
all. It does expose a readable token vocabulary — roughly 900 custom properties
on `:root` (`--color-background-canvas`, `--color-text`,
`--color-button-container-*`, …). Rather than blanket-inverting with a filter,
which wrecks photos, avatars, and brand logos, the extension overrides those
tokens and lets LinkedIn's own stylesheets repaint themselves.

That recoloring is two layers:

- **The generated layer.** `tools/generate-theme.mjs` reads a snapshot of the
  real tokens (`tools/tokens-light.json`, captured from a live linkedin.com
  session) and converts each color in OKLCh: lightness is mirrored while hue is
  preserved, so text/background pairs flip together and keep their contrast
  relationship. Chromatic accents are lightened rather than merely mirrored,
  because a mid-lightness accent must get *brighter* to stay legible on a dark
  surface. A small `ANCHORS` map pins the colors people recognize to LinkedIn's
  real dark-mode values — action blue `#0a66c2` → `#70b5f9`, canvas → `#000`,
  cards → `#1b1f23`. Out-of-gamut results have their chroma reduced by binary
  search instead of being clipped per channel, which would shift the hue.
- **The handwritten layer.** `tools/extras.css` covers surfaces that hardcode
  colors instead of using tokens. These were found by sweeping LinkedIn's
  stylesheet for literal light/dark declarations and by inspecting the live
  page, not guessed.

The legal pages (`/legal/*`, `/legal/l/*`) and `/accessibility` load the same
guest stylesheet, but their content is LinkedIn's "Lithograph" CMS template
(`<div id="lithograph-app">`). It takes a few colors from the guest tokens and
hardcodes the rest, some in per-page stylesheets, so the token layer alone would
invert its callout and list text onto surfaces that stay white. `extras.css`
covers it in a section scoped by `body:has(#lithograph-app)`, so no other guest
page is touched:

- It overrides the template's `--artdeco-reset-*` text and link tokens.
- It resets text color broadly inside `#lithograph-app`, so per-page `color:
  black` rules can't leak through. Links are left out, so buttons keep their own
  ink; classless anchors, which are exactly the links, get the dark-mode blue.
- Each pastel surface (callouts, policy cards, banner backdrops, striped table
  rows) becomes an OKLCh tint of the same hue at lightness 0.29.
- A full-width light banner paints its pale backdrop as an image behind the
  headline, so the image is dimmed rather than recolored. Photo banners, which
  are already light-on-dark, keep LinkedIn's white headline.

Both are concatenated into `dark.css`. To change the theme, edit the generator
or `extras.css` and re-run:

```sh
node tools/generate-theme.mjs   # rewrites dark.css
node tools/generate-icons.mjs   # rewrites icons/*.png
```

Never hand-edit `dark.css`; the token block is overwritten on every run.

## Packaging for the Web Store

```sh
node tools/build.mjs        # → dist/dark-mode-for-linkedin-<version>.zip
```

Bump `version` in `manifest.json` first, then upload the zip at the
[developer console](https://chrome.google.com/webstore/devconsole).

The script regenerates `dark.css` and the icons before packaging, so a stale
asset cannot ship. It then refuses to build on anything the Web Store rejects at
submission: a malformed `version`, a name over 75 characters or a description
over 132, a manifest that isn't v3, or a reference to a file that doesn't exist.

The file list is *derived from the manifest* rather than filtered from the
directory — it walks icons, content scripts, and web-accessible resources, and
reads `popup.html` to pick up its own stylesheet and script. An allowlist can
leak a stray file into a release; a reachability walk cannot. Anything in the
tree that the manifest can't reach is reported as a note, so you find out at
build time rather than after upload. `tools/`, `dist/`, and `README.md` never
ship.

Builds are reproducible: entries are sorted and stamped with the fixed ZIP epoch
rather than the current time, so the same sources always produce a
byte-identical archive.

## Design notes

**No flash of light content.** `dark.css` ships as a content-script stylesheet,
so Chrome has it before first paint, but every rule is scoped to an attribute
`content.js` sets on `<html>` — `data-dmli="dark"` for recoloring,
`data-dmli-hue="dark"` for the Help Center patches — and is therefore inert
until `content.js` opts in.
`chrome.storage` only resolves asynchronously — too late to beat first paint —
so the chosen mode is mirrored into the page's own `localStorage` under
`__dmli_mode`, which can be read synchronously at `document_start`.
`chrome.storage` remains the source of truth and repairs the mirror on load.

**Recoloring is the only strategy that can make a page worse,** because it
inverts text against surfaces it may not control. So it runs only where no
native switch exists, and afterwards `content.js` reads the rendered page back:
it samples up to 60 real text nodes against their effective backgrounds, and if
more than a quarter fall below 2:1 it removes the recoloring entirely and leaves
the page alone. It measures whichever element owns each text node, so body copy
counts even when it sits in a `<div>` or shares its paragraph with a `<strong>`
or a link. That check is what stops a front-end nobody anticipated from ending
up with white text on white cards; the popup reports it rather than looking
broken.

**Only one strategy is ever active.** Each `apply()` clears the others first,
so a guess made before `<body>` existed can't linger and fight the one that
actually works.

**The observer is coalesced to one run per frame.** `apply()` can itself change a
class, which would re-trigger the observer watching for LinkedIn changing one —
a mutation loop that starves the microtask queue and freezes the tab. It also
keeps this cheap on an SPA that touches classes constantly. Coalescing alone
still leaves one run per frame, forever, if `apply()` writes on every run, since
`classList.add` of a class already present still queues a mutation. So every
strategy skips any write the page already matches, and the page settles after
its first frame.

**Artwork stays readable.** Sections whose `::after` paints a full-color
illustration keep their light-mode text colors — white copy over LinkedIn's
light hero art would be invisible.

## Verification

Driven against a real Chrome 149 with the extension loaded over the
`Extensions.loadUnpacked` CDP domain (Chrome removed `--load-extension` in M137).
37 assertions pass across the three front-ends.

The signed-in pages — notifications, messaging, profile and company pages — were
confirmed working on a real logged-in account, which is the one thing these
harnesses cannot reach. After the change that stops rewriting the page at rest,
notifications and the feed were confirmed again signed in. So were the Help
Center's signed-in pieces: the avatar menu, the footer logo, and the language
list, which Chrome draws natively where no screenshot can reach.

On the **signed-in app shell** (reached at `/uas/login`, which runs the same
front-end as the feed and profile): `data-color-scheme` flips to `dark`, the
recoloring layer withdraws, computed `color-scheme` becomes `dark`, the dark SVG
variants switch on (`--svgDisplayDark: block`), turning the extension off
restores LinkedIn's own value, and the theme survives the attribute being reset
underneath it.

The **packaged artifact** is verified too, not just the source tree: the built
zip is extracted with an independent unzip implementation, checked for a
root-level `manifest.json` and byte-identical contents with nothing from
`tools/` leaked in, then loaded into Chrome from the extracted directory and
confirmed to theme LinkedIn. Each of the build's seven validation rules is
exercised against a deliberately broken manifest to confirm it actually rejects.

On the **guest homepage**: the recoloring layer applies, no native attribute is
invented, the canvas resolves to `rgb(0, 0, 0)` and the nav to `rgb(27, 31, 35)`.
The theme is present immediately after a reload with the canvas already black
(no flash), mode changes sync into an already-open tab, **Match system** follows
an emulated OS change in both directions, and the page hands over to the native
strategy the moment a `data-color-scheme` attribute appears. The popup's radio
group takes focus, moves on ArrowDown, persists the choice, and shows a 2px
focus ring. The extension loads with no errors on `chrome://extensions`.

The generated palette's contrast is audited against each token's *real* backdrop
— a `-label` token is measured on the `-container` it is painted on, not on the
page. Of 213 foreground tokens, 6 land below their WCAG target: five transient
button-`loading` labels and one decorative blockquote rule, all capped by an
alpha LinkedIn itself chose, and all still higher-contrast than the same token
in LinkedIn's light theme. Body text lands at 12.5:1 on cards and 15.4:1 on the
canvas; links at 7.6:1. (This applies to the guest pages only; the app uses
LinkedIn's own audited palette.)

The **Voyager path and the safety net** are covered against stand-in pages built
to match those front-ends, since reaching the real ones needs a login: the
Voyager stand-in gets `theme--dark`, has its `#ui-theme-dark` stylesheet enabled
and goes black without the recoloring layer being used; a page with no native
switch and hardcoded white cards has its recoloring revoked and is left readable.
In those runs `content.js` and `dark.css` are injected at `document_start` with
only `chrome.*` stubbed, so the real code runs at the real timing.

The **Help Center** is public, so it is driven signed-out against the live site
(Chrome 153, extension loaded unpacked). On two article pages the body switches
to `hue-web-color-scheme--dark` with no recoloring. Every visible text element is
measured against its effective background: 0 of 53 falls below 4.5:1 on one page
and 0 of 20 on the other, and 0 of 196 with the collapsible tables expanded.
Off, On, and **Match system** in both directions all switch the page and restore
LinkedIn's own class. The popup reports LinkedIn's own dark theme. The theme
survives LinkedIn resetting the class, is present straight after a reload, and
the page settles with no attribute writes at rest. Stand-ins cover the class
arriving after load and a page with no other markers. The same run re-checks
`/login`, the guest homepage, the jobs page, the signed-out authwall, and the
Voyager and revocation stand-ins, all unchanged.

The rest of the Help Center is covered by crawling it from every product's home
(the crawl stopped at a 500-page cap). Two groups were swept with every
collapsible expanded:

- **Non-article pages:** all 105 distinct ones the crawl found (homes, product
  hubs, topic lists), plus five search-results pages and the contact form. The
  crawl's 126 URLs include 21 old topic ids that redirect to one of the 105.
  Every page stays themed rather than revoked. Of their 8,305 visible text
  elements none falls below 3:1. The only five below 4.5:1 are the search
  filter's disabled "Apply" button, which is deliberately dimmed.
- **Articles:** 42, chosen so tabs, collapsibles, callouts, tables, images and
  video each appear several times. None of their 3,612 text elements falls
  below 4.5:1.

The popups are measured open as well. The search suggestions are opened by
typing with real key events, and the product picker and the footer's "Privacy
and Terms" menu by clicking. On home, topic and article pages alike, the lowest
text in any of them is at 5.14:1.

The contact form (`/help/*/ask/…`) shares the template. Typed text, field borders
and placeholders on it measure at least 11.2:1, 5.2:1 and 6.4:1. Some panels only
render for signed-in or feature-gated visitors: the search AI summary and its
feedback form, the premium upsell banner, and the sticky chat card. They are
checked by inserting LinkedIn's own class names into a live page, and every
text element clears 4.5:1 except a decorative "|" separator. The avatar menu is
checked the same way, using the signed-in markup, on article, topic, contact and
home pages. Its lowest text is 5.5:1. On all four, the footer wordmark and the
language options measure 11.2:1 against the footer.

The **legal pages** are swept the same way, with every collapsible expanded. The
set is found by crawling: start from LinkedIn's legal navigation, follow every
`/legal` and `/accessibility` link, and stop when a round finds no new page on the
Lithograph template. That gives 42 pages. None of their 7,920 visible text
elements falls below 4.5:1, down from 58 of 340 below 2:1 on the privacy policy
alone. Text drawn over an image can't be judged from background colors, so any
text whose box overlaps an image, 64 elements, is also measured by its pixels:
the text is hidden, its box screenshotted, and the ink compared with the
backdrop actually painted there. Averaged over each box, all clear 4.5:1, the
lowest at 4.59:1. Some of those boxes only sit beside an image. Under a few
photo banners, where LinkedIn draws its own white headline on its own darkened
photo, the brightest 5% of backdrop pixels come to 4.2:1. That is still above
the 3:1 minimum for large text.

At phone width, ten of the pages were re-checked the same way, pixel check
included, with the same result. On the six that have a mobile menu, the open
menu was checked too, and its icon reads at about 6:1. The only light surfaces
left are the skip link and the footer's highlighted language, both with dark
text.

**Nothing rewrites the page at rest.** Over two idle seconds the Voyager stand-in
sees 0 attribute writes while on and while off, down from about 400 each. So do
`/login` and the Help Center. On the Voyager stand-in, On, Off, and **Match
system** in both directions switch correctly. It survives LinkedIn resetting the
class. For an account already set to dark, turning the extension off keeps
LinkedIn's own dark theme. A stand-in with a real `<link>` covers LinkedIn
disabling the dark stylesheet, setting it to `media="not all"`, and replacing
it: each time it is back on when checked 300 ms later, and the page settles again.
With the stylesheet watch removed, all three of those checks fail. Another
stand-in only adds the stylesheet after load; it is switched on too, and that
check fails if `<head>` is watched only once a stylesheet exists.

**Not covered by the harnesses:** anything requiring a logged-in account. Those
pages are confirmed by hand instead (see above); there is no automated coverage
of them, so a LinkedIn change there will surface as a bug report rather than a
failing test.

## Layout

```
manifest.json              MV3 manifest
content.js                 strategy pick: native switch vs. recoloring
dark.css                   GENERATED — token overrides + extras.css (guest pages, Help Center patches)
popup/                     toolbar popup (mode switch + live status)
icons/                     GENERATED — crescent mark
tools/build.mjs            validates + zips the publishable package
tools/generate-theme.mjs   OKLCh token inverter
tools/tokens-light.json    snapshot of the guest pages' :root tokens
tools/extras.css           handwritten rules for hardcoded colors
tools/generate-icons.mjs   dependency-free PNG encoder
tools/harness/             live Chrome test harness (see tools/harness/README.md)
```

Everything under `tools/` is build-time only and is never packaged. The project
has no dependencies; the theme generator, the PNG encoder, the ZIP writer, and
the test harness are all built on Node's standard library.
