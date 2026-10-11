# paulwarnick.me

The personal site of **Paul Warnick**, Technical Team Lead at Ford Motor Company.

**[paulwarnick.me](https://paulwarnick.me)**

It's a one-page site that covers who I am at work and outside of it, with my travel and outdoor photography at its center. Everything here is plain HTML, CSS and JavaScript. It has no framework, no third-party code and no build step to host it.

## What's on the page

- **Hero:** Half Dome at sunset behind my name, cropped separately for wide screens and for phones held upright.
- **About:** a short intro.
- **Experience:** a timeline from my first internship to today, plus education and the tools I use every day.
- **Hobbies and Interests:** a short intro, then one gallery of 49 photos from my travels. The first 23 show up front, with the rest one click away. Location captions appear on hover and in the full-screen viewer.

## How it's built

### Photo gallery

The gallery uses **justified rows**, the layout photo sites use: every photo keeps its own shape, and each row fills the full width. It's pure CSS. Each photo's `flex-grow` is proportional to its aspect ratio, so the photos in a row land at the same height. Panoramas end up with a row to themselves, and portrait shots fill the rows between them.

- **Captions** slide up on hover (or keyboard focus) and show under the photo in the full-screen viewer.
- **Photo order** spreads similar shots apart, so no two snow, coast or sunset photos sit side by side or stacked.
- **The last row** stretches to the edge when it's nearly full and keeps its natural size when it isn't, measured in JavaScript so it works at every screen width.

### Full-screen viewer

[`assets/js/lightbox.js`](assets/js/lightbox.js) is a small, dependency-free photo viewer:

- Opens by growing the photo out of its thumbnail and shrinks back into place on close (a FLIP animation).
- Swipe or drag sideways to move between photos, and down to close. On a keyboard, use the arrow keys and Escape.
- Shows the already-loaded thumbnail instantly, swaps in the full-size file once it's decoded, and preloads the photos on either side.
- Built on the native `<dialog>` element, so focus is trapped while it's open and returns to the photo you came from.
- Respects "reduce motion", queues fast clicks instead of dropping them, and can't get stuck if the browser pauses animations.
- Without JavaScript, every thumbnail is still a plain link to the full photo.

### Photo pipeline

Originals never leave my computer. [`scripts/process-photos.ps1`](scripts/process-photos.ps1) prepares them using only the imaging library built into Windows:

- Reads iPhone HEIC files through Windows' own HEIF decoder, as well as JPG, PNG and TIFF.
- Turns phone photos upright.
- Resizes each photo to 800 and 1600 pixels wide, plus 2400 for panoramas (portraits at 1600 are already taller than any screen). Resampling is high quality, and nothing is ever upscaled.
- Re-encodes every file from a fresh canvas, so **no metadata survives** (GPS location, camera details or timestamps). The script checks every output and stops if anything slipped through.
- Records each photo's size and average colour. The page uses the colour as a placeholder tone while the photo loads, and the size to reserve its space so nothing jumps around.
- Makes the hero straight from the original, so a panorama stays sharp: a 16:10 crop for wide screens, a 9:16 crop for phones, and the 1200 × 630 link-preview image with my name on it. `-HeroOnly` remakes just those.

[`scripts/build.mjs`](scripts/build.mjs) then turns [`content/photos.json`](content/photos.json) (the photo order, alt text, location captions, how many photos show before "Show all", and which photo goes behind my name and where to centre its crops) into the gallery markup in `index.html`. Hosting needs no build step.

### Details

- **Light and dark themes** follow the device setting, with a toggle that remembers your choice and no flash on load.
- **Accessibility:** semantic landmarks, a skip link, visible focus styles, alt text on every photo, colour contrast checked in both themes, and reduced-motion support.
- **Performance:** responsive images with `srcset` and `sizes`, lazy loading below the fold, reserved image dimensions, and two variable fonts.
- **Typography:** Fraunces (a soft serif) for headings and Inter for text.
- **Sharing:** Open Graph tags for link previews, and schema.org `Person` data for search.

## Project layout

```
index.html                 the page
404.html                   "off the trail" page
assets/css/site.css        all styles (design tokens, light and dark themes)
assets/js/site.js          header, menu, theme toggle, scroll reveals
assets/js/lightbox.js      full-screen photo viewer
assets/img/                favicon and social preview image
content/photos.json        hero, gallery order, alt text and captions
assets/photos/             web-ready photos (generated)
photos/                    my originals (git-ignored, never published)
scripts/process-photos.ps1 convert, resize and strip metadata from the originals
scripts/build.mjs          write the gallery into index.html
scripts/serve.mjs          tiny local preview server
```

## Running it locally

Requires [Node.js](https://nodejs.org) and nothing else:

```bash
node scripts/serve.mjs
```

Then open http://localhost:4321.

## Adding photos

1. Put originals in `photos/`. HEIC straight from an iPhone is fine. The folder is git-ignored, so originals stay local.
2. Process them:
   ```bash
   powershell -NoProfile -File scripts/process-photos.ps1
   ```
3. Add each new photo to the gallery list in `content/photos.json` with its alt text (and a caption if you like), then rebuild:
   ```bash
   node scripts/build.mjs
   ```

## Hosting

GitHub Pages serves the repository root on the custom domain `paulwarnick.me`.

---

© Paul Warnick. The writing and photos are mine, so please ask before reusing them.
