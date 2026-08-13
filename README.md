# Digital business card

A single static page: a point-cloud head that responds to the phone's
gyroscope, plus the contact details and QR codes needed to hand something over
at a conference.

**Live:** https://joeparkerrees.github.io/businesscard/

## Why it's built this way

- **Static, no framework.** The page has to load on conference wifi. Everything
  is vendored locally, including three.js — a CDN request is one more thing
  that can fail in a room with 2000 people on one access point.
- **Design tokens are hand-ported** from the `newportfolio` design system
  rather than imported, so this stays a flat static site instead of pulling in
  Next.js and Sanity.
- **QR codes are baked at build time** into SVG, so no QR library ships to the
  browser.
- **Fonts are subsetted to woff2** (105KB → 7.9KB, 173KB → 11.1KB).

## Structure

| File | Purpose |
| --- | --- |
| `index.html` | Markup and metadata |
| `styles.css` | Design tokens ported from the portfolio |
| `card.js` | Point cloud, gyroscope handling, drag fallback |
| `scripts/gen-qr.py` | Regenerates both QR codes and the vCard |
| `vendor/` | three.js, vendored |

## Swapping in a real face

The head is currently procedural — an evenly-sampled sphere displaced into a
head-ish silhouette by `shapeHead()` in `card.js`. It is deliberately built as
a point cloud so that the render path is the one a real scan will use.

To replace it, change `buildHeadGeometry()` to return a `BufferGeometry` of
positions from the scan. Nothing else needs to change. Roughly:

1. Scan with Polycam / RealityScan / Scaniverse, export GLB.
2. Sample points off the mesh surface, or load the GLB's own vertices.
3. Normalise so the head is about 2 units tall and centred on the origin, with
   +Z facing the camera.

Keep the point count in the region of 20–30k; the shader fades points by depth,
which is what gives the cloud its volume on a light background.

## Changing the URL

The primary QR points at `CARD_URL` in `scripts/gen-qr.py`. After changing it:

```sh
python3 scripts/gen-qr.py
```

## Local development

The gyroscope needs a secure context, so `file://` will not work. Serve it:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Note that `localhost` counts as secure, but
testing the gyroscope from another device on your network needs real HTTPS —
easiest is to push and test against the deployed URL.

## Gyroscope notes

- iOS 13+ requires `DeviceOrientationEvent.requestPermission()`, called from
  inside a user gesture. That's what the "Tilt to look around" button is for;
  it cannot be triggered on page load.
- If tilt direction feels inverted, flip `GAMMA_SIGN` / `BETA_SIGN` at the top
  of `card.js`.
- The card assumes portrait. In landscape, `beta` and `gamma` swap roles and
  the mapping will feel wrong.
