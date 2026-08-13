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

Defaults to source/portrait.jpg. Re-run it after swapping the photo.
"""

import pathlib
import sys
from collections import deque

from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Grid resolution. Every filled cell becomes a cube, so this squares fast:
# 96 gives up to ~9k cubes before masking, which is comfortable on a phone.
GRID = 96

# Background keying. The portrait is shot on a flat green backdrop, and skin,
# blonde hair and a maroon jumper are all red-dominant, so green dominance
# separates subject from ground cleanly without a chroma-key library.
GREEN_MARGIN = 4      # how much greener than red a pixel must be to count as bg
DARK_CUTOFF = 46      # near-black pixels at the frame edge are also background

# Pull the tonal range out to the full 0–1 span. Photographs rarely use it all,
# and unused range is lost relief depth.
BLACK_POINT = 0.10
WHITE_POINT = 0.94


def load_square(path: pathlib.Path) -> Image.Image:
    """Load and centre-crop to a square, then downsample to the grid."""
    im = Image.open(path).convert("RGB")
    side = min(im.size)
    left = (im.width - side) // 2
    top = (im.height - side) // 2
    im = im.crop((left, top, left + side, top + side))
    # BOX averages the source pixels falling into each cell, which is what we
    # want — each cube should represent its whole cell, not one sampled pixel.
    return im.resize((GRID, GRID), Image.BOX)


def background_mask(px: list[tuple[int, int, int]]) -> list[bool]:
    """True where the pixel is background.

    Keying on colour alone punches holes anywhere the subject happens to be
    greenish or dark, so candidates are flood-filled from the frame edge
    instead: only background that actually connects to the border is removed,
    and an eye socket or a dark collar in the middle of the subject survives.
    """
    def is_candidate(i: int) -> bool:
        r, g, b = px[i]
        if g > r + GREEN_MARGIN and g > b + GREEN_MARGIN:
            return True
        return max(r, g, b) < DARK_CUTOFF

    bg = [False] * (GRID * GRID)
    queue = deque()

    for i in range(GRID * GRID):
        x, y = i % GRID, i // GRID
        on_border = x == 0 or y == 0 or x == GRID - 1 or y == GRID - 1
        if on_border and is_candidate(i):
            bg[i] = True
            queue.append(i)

    while queue:
        i = queue.popleft()
        x, y = i % GRID, i // GRID
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < GRID and 0 <= ny < GRID):
                continue
            j = ny * GRID + nx
            if not bg[j] and is_candidate(j):
                bg[j] = True
                queue.append(j)

    return bg


def despeckle(bg: list[bool]) -> list[bool]:
    """Drop isolated subject cells, which read as floating grit in 3D."""
    out = list(bg)
    for i in range(GRID * GRID):
        if bg[i]:
            continue
        x, y = i % GRID, i // GRID
        neighbours = 0
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < GRID and 0 <= ny < GRID and not bg[ny * GRID + nx]:
                neighbours += 1
        if neighbours <= 1:
            out[i] = True
    return out


def main() -> None:
    src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "source" / "portrait.jpg"
    if not src.exists():
        sys.exit(f"No source image at {src}")

    colour = load_square(src)
    px = list(colour.getdata())

    bg = despeckle(background_mask(px))

    grey = ImageOps.grayscale(colour)
    lum = list(grey.getdata())

    span = max(WHITE_POINT - BLACK_POINT, 1e-6)
    out = Image.new("RGBA", (GRID, GRID))
    pixels = []
    for i, value in enumerate(lum):
        if bg[i]:
            pixels.append((0, 0, 0, 0))
            continue
        n = (value / 255.0 - BLACK_POINT) / span
        n = min(1.0, max(0.0, n))
        v = round(n * 255)
        pixels.append((v, v, v, 255))

    out.putdata(pixels)
    dest = ROOT / "relief.png"
    out.save(dest, optimize=True)

    kept = sum(1 for p in pixels if p[3])
    print(f"{dest.name}: {GRID}x{GRID}, {kept} cubes, {dest.stat().st_size} bytes")

    # A scaled-up preview, purely so the keying can be eyeballed.
    preview = out.resize((GRID * 4, GRID * 4), Image.NEAREST)
    flat = Image.new("RGB", preview.size, (251, 254, 252))
    flat.paste(preview, (0, 0), preview)
    flat.save(ROOT / "relief-preview.png")


if __name__ == "__main__":
    main()
