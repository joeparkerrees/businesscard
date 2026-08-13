# Digital business card

A full-bleed, non-scrolling page: a cube relief of my face that responds to
the phone's gyroscope, over the contact details and QR codes needed to hand
something over at a conference.

**Live:** https://joeparkerrees.co.uk/card

**Deployed from `newportfolio`, not from here.** A path on `joeparkerrees.co.uk`
has to be served by the Vercel deploy that owns the domain, so the card ships
as a standalone static page in `newportfolio/public/card` alongside the
existing `public/tools` pages. This repo is the development source; changes
have to be copied across and committed there to go live.

## The cube sculpture

A relief: one cube per cell of a 96×96 grid, each pushed toward the viewer by
its cell's brightness. Adapted from the p5 sketch that drew a `box()` per pixel
inside a nested loop — up to 10,000 immediate-mode draw calls a frame, which is
why that version ran at 24fps and needed Safari-specific tuning. Here it's a
single `InstancedMesh`: one draw call, with the tilt-driven explosion riding on
the instance matrices.

The p5 original drove its explosion off mouse distance from centre. On a phone
the honest equivalent is how far you've tilted, so holding the phone level
gives a flat relief and tipping it bursts the cubes apart.

### Changing the photo

```sh
python3 scripts/gen-relief.py source/portrait.jpg
```

That bakes `relief.png` — RGB is height, alpha is the subject mask — so the
page ships no image-processing code and decodes a 96×96 file rather than a
full-resolution photograph. It also writes `relief-preview.png`, scaled up, so
the keying can be eyeballed.

The background is keyed on green dominance (skin, blonde hair and a maroon
jumper are all red-dominant against a green backdrop), with candidates
flood-filled inward from the frame edge rather than removed wherever they
match — keying on colour alone punches holes anywhere the subject happens to be
greenish or dark, and requiring a connection to the border keeps eye sockets
and a dark collar intact.

**It wants a portrait on a flat green backdrop.** The relief currently ships
from `joe.webp`, cropped to the head — a stand-in shot against a mint wall and
a dark doorway, so a few stray cubes survive the key at the right-hand edge.
A proper green-screen frame keys cleanly and those disappear.

Tuning knobs at the top of the script: `GRID`, `GREEN_MARGIN`, `DARK_CUTOFF`,
and the `BLACK_POINT` / `WHITE_POINT` contrast range.

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
| `card.js` | Cube relief, gyroscope, drag fallback, parallax, haptics |
| `relief.png` | Baked height + mask data for the sculpture |
| `scripts/gen-qr.py` | Regenerates both QR codes and the vCard |
| `scripts/gen-relief.py` | Bakes relief.png from a portrait |
| `scripts/sync-to-portfolio.sh` | Copies into newportfolio, rewriting asset paths |
| `vendor/` | three.js, vendored |

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

The card lives at `newportfolio/public/card`. One command syncs it:

```sh
scripts/sync-to-portfolio.sh [path-to-newportfolio]
```

Then commit and push in the portfolio repo. The script also rewrites the asset
paths, which differ between the two locations — see below — and fails loudly
rather than shipping a page whose assets 404 in production.

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
