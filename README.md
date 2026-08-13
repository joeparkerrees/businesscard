# Digital business card

A full-bleed, non-scrolling page: a point-cloud sculpture of my face that
responds to the phone's gyroscope, over the contact details and QR codes
needed to hand something over at a conference.

**Live:** https://joeparkerrees.co.uk/card

**Deployed from `newportfolio`, not from here.** A path on `joeparkerrees.co.uk`
has to be served by the Vercel deploy that owns the domain, so the card ships
as a standalone static page in `newportfolio/public/card` alongside the
existing `public/tools` pages. This repo is the development source; changes
have to be copied across and committed there to go live.

## Adding the face scan

The page looks for `models/face.glb` on load. If it isn't there it falls back
to a procedural head, so the card is never broken — drop the scan in and it
takes over on the next load. Nothing else needs to change.

```sh
cp ~/wherever/my-scan.glb models/face.glb
```

The loader normalises whatever it's given: it merges every mesh in the file,
centres it on the origin, and scales it to a fixed height, so the scan's own
units and offset don't matter. It then samples the surface by triangle area
rather than reusing the mesh's vertices — scan meshes are unevenly
tessellated, so raw vertices clump in high-detail regions and leave flat areas
bare.

Two things it does *not* guess:

- **Orientation.** If the face loads in sideways or facing away, set
  `MODEL_ROTATION` at the top of `card.js` (radians).
- **Draco compression.** The Draco decoder isn't vendored, so export
  uncompressed. If the file is Draco-compressed the load fails and you get the
  procedural head with an error in the console.

## Why it's built this way

- **Static, no framework.** The page has to load on conference wifi.
  Everything is vendored locally, including three.js — a CDN request is one
  more thing that can fail in a room with 2000 people on one access point.
- **Design tokens are hand-ported** from the `newportfolio` design system
  rather than imported, so this stays a flat static site instead of pulling in
  Next.js and Sanity. Octave throughout.
- **QR codes are baked at build time** into SVG, so no QR library ships.
- **Fonts are subsetted to woff2** (105KB → 7.9KB).

## Structure

| File | Purpose |
| --- | --- |
| `index.html` | Markup, metadata, import map |
| `styles.css` | Design tokens ported from the portfolio |
| `card.js` | Point cloud, scan loader, gyroscope, drag fallback, haptics |
| `models/face.glb` | The scan (absent → procedural fallback) |
| `scripts/gen-qr.py` | Regenerates both QR codes and the vCard |
| `vendor/` | three.js and the loaders it needs |

`vendor/` mirrors three's own `examples/jsm` layout — `GLTFLoader` reaches
sideways for `../utils/BufferGeometryUtils.js`, so `loaders/`, `utils/` and
`math/` have to stay siblings.

## The foil badge

The seal top-right is a holographic foil effect driven by the *same* tilt
values as the sculpture, so the two read as one physical object rather than as
two effects sharing a screen.

Three oversized layers sit on a dark base and are moved by `transform` rather
than `background-position` — transforms stay on the compositor, whereas
background-position repaints the gradient every frame. Each layer travels at a
different rate; the parallax between the colour bands, the diffraction grating
and the specular hotspot is most of what sells it as foil.

The colour is a *single* stripe with two faint companions, not a repeating
band. Repeating it made the period land unpredictably against the badge, so
the whole disc read as a rainbow sticker; one stripe sits centred at rest and
sweeps cleanly off either edge as you tilt. The dark gaps are black stops
rather than transparent ones — under `screen`, black leaves the base
untouched.

## Haptics

Android and desktop Chrome get real feedback through `navigator.vibrate`.

**iOS Safari does not implement `navigator.vibrate` and has no haptics API.**
The only lever a web page has is that toggling an `<input type="checkbox"
switch>` produces system haptic feedback on iOS 17.4+, so that's what the
offscreen `#haptic-switch` is for. It rides on a UI control rather than an
API, it may not fire outside a direct user gesture, and it could stop working
in any Safari release. The page degrades silently to no haptics.

Feedback fires on: granting motion access, switching QR, tapping the email,
and as a detent when the face swings back through front-on.

## Deploying

The card lives at `newportfolio/public/card`. To ship a change, copy the files
across and commit them there:

```sh
D=../newportfolio/public/card
cp index.html styles.css card.js favicon.svg qr-*.svg *.vcf "$D"/
cp -r vendor fonts models "$D"/
```

Then rewrite the asset paths to absolute, because they differ between the two
locations — see below.

### Absolute paths

In `newportfolio` every asset reference is `/card/…` rather than relative.
This matters: at `/card` with no trailing slash, a relative URL resolves
against the domain root and every asset 404s. `next.config.ts` serves
`index.html` for both `/card` and `/card/` via a rewrite rather than
redirecting to the trailing-slash form, which would fight Next's own
trailing-slash normalisation and can loop.

### The URL

`CARD_URL` in `scripts/gen-qr.py` must match where the card is actually
served. After changing it:

```sh
python3 scripts/gen-qr.py
```

## Local development

The gyroscope needs a secure context, so `file://` will not work. Serve it:

```sh
python3 -m http.server 8000
```

`localhost` counts as secure, but testing the gyroscope from another device on
your network needs real HTTPS — easiest is to push and test the deployed URL.

## Gyroscope notes

- iOS 13+ requires `DeviceOrientationEvent.requestPermission()`, called from
  inside a user gesture. That's what the "Tilt to look around" button is for;
  it cannot be triggered on page load.
- If tilt direction feels inverted, flip `GAMMA_SIGN` / `BETA_SIGN` at the top
  of `card.js`.
- The card assumes portrait. In landscape, `beta` and `gamma` swap roles and
  the mapping will feel wrong.
