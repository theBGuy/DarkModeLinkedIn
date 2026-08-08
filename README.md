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

LinkedIn runs **three** different front-ends, and they need different treatments.
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
alone does nothing. Both names come from LinkedIn's own bundle:

```js
{light:"theme--light", dark:"theme--dark", system:"theme--system"}
{light:{theme:"#ui-theme"}, dark:{theme:"#ui-theme-dark"}}
```

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
so Chrome has it before first paint, but every rule is scoped to
`html[data-dmli="dark"]` and therefore inert until `content.js` opts in.
`chrome.storage` only resolves asynchronously — too late to beat first paint —
so the chosen mode is mirrored into the page's own `localStorage` under
`__dmli_mode`, which can be read synchronously at `document_start`.
`chrome.storage` remains the source of truth and repairs the mirror on load.

**Recoloring is the only strategy that can make a page worse,** because it
inverts text against surfaces it may not control. So it runs only where no
native switch exists, and afterwards `content.js` reads the rendered page back:
it samples up to 60 real text nodes against their effective backgrounds, and if
more than a quarter fall below 3:1 it removes the recoloring entirely and leaves
the page alone. That check is what stops a front-end nobody anticipated from
ending up with white text on white cards; the popup reports it rather than
looking broken.

**Only one strategy is ever active.** Each `apply()` clears the other two first,
so a guess made before `<body>` existed can't linger and fight the one that
actually works.

**The observer is coalesced to one run per frame.** `apply()` can itself change a
class, which would re-trigger the observer watching for LinkedIn changing one —
a mutation loop that starves the microtask queue and freezes the tab. It also
keeps this cheap on an SPA that touches classes constantly.

**Artwork stays readable.** Sections whose `::after` paints a full-color
illustration keep their light-mode text colors — white copy over LinkedIn's
light hero art would be invisible.

## Verification

Driven against a real Chrome 149 with the extension loaded over the
`Extensions.loadUnpacked` CDP domain (Chrome removed `--load-extension` in M137).
37 assertions pass across the three front-ends.

The signed-in pages — notifications, messaging, profile and company pages — were
confirmed working on a real logged-in account, which is the one thing these
harnesses cannot reach.

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

**Not covered by the harnesses:** anything requiring a logged-in account. Those
pages are confirmed by hand instead (see above); there is no automated coverage
of them, so a LinkedIn change there will surface as a bug report rather than a
failing test.

## Layout

```
manifest.json              MV3 manifest
content.js                 strategy pick: native switch vs. recoloring
dark.css                   GENERATED — token overrides + extras.css (guest only)
popup/                     toolbar popup (mode switch + live status)
icons/                     GENERATED — crescent mark
tools/build.mjs            validates + zips the publishable package
tools/generate-theme.mjs   OKLCh token inverter
tools/tokens-light.json    snapshot of the guest pages' :root tokens
tools/extras.css           handwritten rules for hardcoded colors
tools/generate-icons.mjs   dependency-free PNG encoder
```

Everything under `tools/` is build-time only and is never packaged. The project
has no dependencies; the theme generator, the PNG encoder, and the ZIP writer
are all built on Node's standard library.
