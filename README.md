# jamienachbar.com

Static site. Three files do the work:

- `index.html` — text only, no images, no framework
- `css/site.css` — monochrome styles, no preprocessor step
- `js/site.js` — the type engine

Run it locally:

```sh
npm run dev            # python3 -m http.server on :8080
PORT=3000 npm run dev  # or another port
```

## The type engine

On load every character is scrambled and resolves in a wave, like a split-flap
board flipping into place. The length of that sequence is `LOAD_STRETCH` in
`site.js` (2 = about ten seconds end to end, with the first screen readable
after three or four). After that:

- **Corruption falls off from the cursor.** Characters within ~100px are always
  correct; the further away, the more of them decay into lookalikes (`A`→`4`,
  `S`→`5`, `o`→`0`), so the text stays legible. Beyond the halo (~430px) the
  rate keeps climbing with distance, so the far reaches of the page are the
  most thoroughly scrambled.
- **Length damps corruption.** Long paragraphs decay at roughly half the rate
  of short labels (see `lenScale` in `splitBlock`).
- **Words decay as clusters.** Each word gets a random bias, so sentences keep
  a readable rhythm instead of uniform noise.
- **A letter never becomes another Latin letter.** Decay targets are digits and
  symbols with the same skeleton (`4`/a, `5`/s, `0`/o), the same letter with a
  diacritic (`á`/a), or the same shape in another script (`м`/m, `К`/K). So a word
  can look damaged, but it is never misspelled into a different word.
- **Letters drift** a fraction of a pixel (only on short blocks and the hero).

The background is a field of characters at random depths: further ones are
blurrier and dimmer, all of them start bright and fade out over their lifetime,
drift slowly, and keep swapping to new characters — fastest when they are far
from the cursor. Any character you get close to stops drifting and rotating,
stops changing, sharpens, and holds its light.

## Favicon

`img/favicon.svg` is a white `J` on black; `img/fav-icon.png` is the same tile
rasterised to 32×32 for browsers without SVG icon support. Both are strictly
monochrome. Once the page is running, JS draws that tile into a 64×64 canvas and
points the icon at it, so the favicon occasionally flips to a punctuation glyph
and back — a tiny version of the split-flap. It stays static under
`prefers-reduced-motion`, when the tab is hidden, and without JavaScript.

## Details that matter

- Each character is a fixed-width (`1ch`) inline block, so swapping glyphs never
  reflows the page and positions can be cached in document space.
- Words are wrapped in `display: inline-block` boxes so a corrupt glyph can never
  break a word across lines.
- **Copying a selection yields the real text.** A `copy` handler rebuilds plain text
  from each glyph's `data-real`, keeps block breaks, and briefly settles the copied
  words as visual confirmation.
- `prefers-reduced-motion: reduce` skips the whole engine: no spans, no dust, no
  cursor ring, just clean text. The same is true without JavaScript.
- Screen readers get the real text via `aria-label` on each block; the glyph
  spans are `aria-hidden`.

## Legacy files

`scss/`, `css/style.css`, `css/bootstrap.min.css`, `js/jquery*`, `vendors/` and
the old images are leftovers from the previous template. Nothing references
them; they are kept only so the old version can be restored from git history.
