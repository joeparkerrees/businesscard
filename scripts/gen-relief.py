#!/usr/bin/env python3
"""Turn a portrait into the cube sculpture's source data.

The card renders one cube per cell of a low-res grid: the cell's brightness
drives how far the cube pushes toward the viewer, so a photograph becomes a
relief. This script does the expensive part once, at build time, and emits a
tiny RGBA PNG:

    RGB   = height (luminance of the subject, contrast-normalised)
    alpha = mask   (0 where the background was keyed out)

Usage:
    python3 scripts/gen-relief.py [source-image]

Defaults to source/portrait.webp. Re-run it after swapping the photo.
"""

import pathlib
import sys
from collections import deque

from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "source" / "portrait.webp"

# Longest grid dimension. The short side follows the subject's aspect, so a
# tall head gets a tall grid rather than a square one padded with background.
# Every filled cell becomes a cube; 96 keeps the count comfortable on a phone.
GRID = 128

# Background keying. The portrait is shot on a flat green backdrop, and skin,
# blonde hair and a dark red jumper are all red-dominant, so green dominance
# separates subject from ground without a chroma-key library.
GREEN_MARGIN = 4

# Dark pixels connected to the frame edge count as background too. Set above
# the jumper (which reads rgb(36,27,23)) and below the darkest part of the
# face, so the crop comes out as a head rather than a head on a torso — the
# jumper is a flat dark mass that adds no relief and swamps the framing.
DARK_CUTOFF = 50

# Framing. The subject is auto-cropped to its own bounding box plus this much
# padding (as a fraction of the longer side), then squared — so the relief is
# framed on the person rather than on however the photo happened to be shot.
PAD = 0.10

# Contrast. Black and white points are taken from percentiles of the subject's
# own luminance rather than fixed values: a photograph rarely uses the full
# range, and unused range is lost relief depth.
BLACK_PCT = 2.0
WHITE_PCT = 98.0


def is_background(r: int, g: int, b: int) -> bool:
    if g > r + GREEN_MARGIN and g > b + GREEN_MARGIN:
        return True
    return max(r, g, b) < DARK_CUTOFF


def flood_background(px, w: int, h: int) -> list[bool]:
    """True where the pixel is background.

    Keying on colour alone punches holes anywhere the subject happens to be
    greenish or dark, so candidates are flood-filled from the frame edge
    instead: only background that actually connects to the border is removed,
    and an eye socket or a dark collar in the middle of the subject survives.
    """
    bg = [False] * (w * h)
    queue = deque()

    for i in range(w * h):
        x, y = i % w, i // w
        if (x == 0 or y == 0 or x == w - 1 or y == h - 1) and is_background(*px[i]):
            bg[i] = True
            queue.append(i)

    while queue:
        i = queue.popleft()
        x, y = i % w, i // w
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h):
                continue
            j = ny * w + nx
            if not bg[j] and is_background(*px[j]):
                bg[j] = True
                queue.append(j)

    return bg


def subject_box(im: Image.Image, probe: int = 192) -> tuple[int, int, int, int]:
    """Find the subject's padded bounding box, in source pixels.

    Deliberately not squared. A head is much taller than it is wide, so
    squaring the crop spends most of the grid on empty background — on this
    portrait it put only 2.3k of 9.2k cells on the face. The grid takes the
    subject's aspect instead and every cube lands on him.
    """
    small = im.resize((probe, probe), Image.BOX)
    bg = despeckle(flood_background(list(small.getdata()), probe, probe), probe, probe)

    xs = sorted(i % probe for i, is_bg in enumerate(bg) if not is_bg)
    ys = sorted(i // probe for i, is_bg in enumerate(bg) if not is_bg)
    if not xs:
        raise SystemExit("Keying removed the entire image — check GREEN_MARGIN/DARK_CUTOFF")

    # Percentile bounds, not min/max: a handful of stray cells that survive the
    # key at the frame edge would otherwise drag the box out to nearly the full
    # image and leave the head sitting small in the middle of it.
    sx, sy = im.width / probe, im.height / probe
    left, right = percentile(xs, 0.5) * sx, (percentile(xs, 99.5) + 1) * sx
    top, bottom = percentile(ys, 0.5) * sy, (percentile(ys, 99.5) + 1) * sy

    pad_x = (right - left) * PAD
    pad_y = (bottom - top) * PAD
    x0 = round(max(left - pad_x, 0))
    y0 = round(max(top - pad_y, 0))
    x1 = round(min(right + pad_x, im.width))
    y1 = round(min(bottom + pad_y, im.height))
    return x0, y0, x1, y1


def percentile(values: list[int], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct / 100.0
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def despeckle(bg: list[bool], w: int, h: int) -> list[bool]:
    """Drop isolated subject cells, which read as floating grit in 3D."""
    out = list(bg)
    for i in range(w * h):
        if bg[i]:
            continue
        x, y = i % w, i // w
        neighbours = sum(
            1
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            if 0 <= x + dx < w and 0 <= y + dy < h and not bg[(y + dy) * w + (x + dx)]
        )
        if neighbours <= 1:
            out[i] = True
    return out


def main() -> None:
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        sys.exit(f"No source image at {src}")

    full = Image.open(src).convert("RGB")
    box = subject_box(full)
    print(f"source {full.width}x{full.height} → subject box {box}")

    # BOX averages the source pixels falling into each cell, which is what we
    # want: each cube represents its whole cell, not one sampled pixel.
    crop = full.crop(box)
    if crop.width >= crop.height:
        gw, gh = GRID, max(1, round(GRID * crop.height / crop.width))
    else:
        gw, gh = max(1, round(GRID * crop.width / crop.height)), GRID
    colour = crop.resize((gw, gh), Image.BOX)
    px = list(colour.getdata())
    bg = despeckle(flood_background(px, gw, gh), gw, gh)

    lum = list(ImageOps.grayscale(colour).getdata())
    subject = [v for i, v in enumerate(lum) if not bg[i]]
    black = percentile(subject, BLACK_PCT)
    white = percentile(subject, WHITE_PCT)
    span = max(white - black, 1.0)
    print(f"contrast: black={black:.0f} white={white:.0f} over {len(subject)} cells")

    out = Image.new("RGBA", (gw, gh))
    pixels = []
    for i, value in enumerate(lum):
        if bg[i]:
            pixels.append((0, 0, 0, 0))
            continue
        n = min(1.0, max(0.0, (value - black) / span))
        v = round(n * 255)
        pixels.append((v, v, v, 255))

    out.putdata(pixels)
    dest = ROOT / "relief.png"
    out.save(dest, optimize=True)
    print(f"{dest.name}: {gw}x{gh}, {len(subject)} cubes, {dest.stat().st_size} bytes")

    # A scaled-up preview, purely so the keying can be eyeballed.
    preview = out.resize((gw * 4, gh * 4), Image.NEAREST)
    flat = Image.new("RGB", preview.size, (0, 34, 10))
    flat.paste(preview, (0, 0), preview)
    flat.save(ROOT / "relief-preview.png")


if __name__ == "__main__":
    main()
