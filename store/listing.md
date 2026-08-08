# Chrome Web Store listing

Copy-paste source for the developer console. Character limits are the Store's
own; `tools/build.mjs` fails the build if the manifest exceeds them.

## Assets in this folder

| Asset | Size | Where it appears |
|---|---|---|
| `screenshot-1280x800.png` | 1280×800 | Listing screenshot carousel (at least one required) |
| `small-tile-440x280.png` | 440×280 | Search results and category grids |
| `marquee-1400x560.png` | 1400×560 | Featured placements (optional, needed to be eligible) |
| `../icons/icon128.png` | 128×128 | Store icon |

Regenerate with `node tools/generate-store-assets.mjs`. The screenshot is cropped
from whatever PNG sits in `screenshots/`; its crop and privacy redaction are
defined in source-pixel coordinates at the top of that script, so replacing the
screenshot means re-measuring those two rectangles.

## Name (max 75)

```
Dark Mode for LinkedIn
```

## Summary (max 132 — this is the manifest `description`)

```
A dark theme for LinkedIn, built from LinkedIn's own design tokens. Toggle it on or off, or follow your system theme.
```

## Category

Productivity

## Detailed description

```
Turn LinkedIn dark, without the glare — and without wrecking the page.

Most dark mode extensions invert everything with a filter. Photos come out
looking like negatives, profile pictures go strange, and company logos turn into
smudges. This one takes a different approach: it works with LinkedIn's own
design system instead of painting over it.

WHY IT LOOKS RIGHT

LinkedIn already has a proper dark theme built into its signed-in pages. It is
just switched off. On those pages this extension flips that switch and nothing
else, so what you get is LinkedIn's real dark mode — their palette, their dark
artwork, their shadows. Not an approximation.

The signed-out pages have no dark theme at all. There, the extension recolours
them using the colour variables LinkedIn's stylesheet is already built from, so
headings, body text, links and buttons keep the contrast they were designed
with. Every colour was checked against its real background, not guessed.

Your photos, avatars and company logos keep their true colours throughout.

IT KNOWS WHEN TO STOP

LinkedIn is not one website — different sections are built on different
front-ends, and they need different handling. The extension works out which one
a page uses, then checks the result actually reads properly. If a page can't be
themed safely it leaves that page completely alone rather than handing you white
text on a white card, and the popup tells you so.

FEATURES

• Three modes: On, Off, or Match system — follows your OS light/dark setting
• No white flash while pages load
• Changes apply instantly to every LinkedIn tab you have open
• Photos, avatars and logos keep their real colours
• Popup is fully keyboard accessible
• Turning it off restores LinkedIn exactly as it was

PRIVACY

Nothing is collected. No analytics, no account, no tracking, and no network
requests of any kind. The only thing stored is which of the three modes you
picked. It runs on linkedin.com and nowhere else.
```

## Privacy form

### Single purpose (max 1,000)

```
This extension applies a dark colour theme to LinkedIn. That is its only
function. It changes how linkedin.com is displayed and does nothing else: it
does not read, collect, store or transmit page content, and it does not run on
any other website.
```

### storage justification (max 1,000)

```
The extension stores exactly one value: which of three display modes the user
picked in the popup ("on", "off", or "match system"). This is needed so the
choice survives a browser restart and stays consistent across every open
LinkedIn tab, rather than resetting on each page load. No page content, browsing
history, or personal data is stored, and nothing is sent anywhere.
```

### Host permission justification (max 1,000)

```
The extension's single purpose is theming LinkedIn, which requires applying a
stylesheet and a small script to LinkedIn pages themselves — there is no other
way to change how a page is displayed. The match pattern is limited to
*://*.linkedin.com/* and no other host is requested.

The script only reads which of LinkedIn's front-ends a page uses and sets a
theme attribute accordingly, then checks that the result is legible. It does not
read, collect or transmit page content, and makes no network requests.
```

### Are you using remote code?

**No, I am not using remote code.**

Everything executed ships inside the package: `content.js`, `popup/popup.js`,
`popup/popup.html`, `dark.css` and the icons. There are no remote script tags,
no `eval` or `new Function`, no string-argument timers, no dynamic `import()`,
no WebAssembly, and no network requests at all. The only `<script src>` in the
package is `popup/popup.html` referencing its own bundled `popup.js`.

> If the form currently has "Yes" selected, change it. Answering yes triggers a
> deeper review and delays publishing for code this extension does not have.

### Data disclosures

Answer **No** to every data-collection category, and tick all three
certification checkboxes. The extension makes no network requests and transmits
nothing.

## A note on permissions

`activeTab` was deliberately removed. The popup asks the current tab which theme
it applied by messaging the content script over a tab id, which needs no extra
permission. `activeTab` would only have made one fallback message slightly more
specific, and the Store rejects permissions that are not required by the single
purpose.
