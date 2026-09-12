"""Build the app's icon set from one source image.

Run this, not an image editor, if the icon ever changes: the four delivered
sizes are not just resizes of each other, because Android and iOS each mangle a
naive icon in their own way.

    python3 make_icons.py tools/icon-source.png .

What comes out, and why each one exists:

  icon-512.png, icon-192.png   the PWA icons, transparent corners kept
  icon-maskable-512.png        Android crops adaptive icons to a circle, which
                               would cut the pencil and the document's corners
                               off. The artwork is scaled into the 80% safe zone
                               on a full-bleed field of its OWN background blue,
                               so the rounded-square edge vanishes into the
                               field instead of showing as a seam.
  apple-touch-icon.png         iOS ignores transparency and paints unset pixels
                               BLACK, then applies its own rounded mask. This
                               one is flattened onto the same blue at full
                               bleed, so iOS rounds the corners itself.
  favicon-32.png, -16.png      browser tab

Two clean-ups are applied to the source first, both of which turned out to
matter for the file this was written against:

  * Its alpha is 253/254 almost everywhere rather than 255 -- the icon is about
    1% translucent, which is an export artifact, not a design. Left alone it
    also wrecks PNG compression: the alpha channel carries more entropy than
    the artwork does, and a flat six-colour icon lands at 230 KB.
  * Its "flat" colours are dithered -- 9,600 distinct colours in that same
    six-colour design. Quantising to a palette collapses them without touching
    the antialiased edges enough to see at any size the icon is drawn at.

Together those take the set from 426 KB to 32 KB, which matters because the
service worker precaches all of it onto every trainee's device.
"""
import sys
from collections import Counter
from PIL import Image

SAFE_ZONE = 0.80          # maskable: fraction of the canvas Android is sure to show
OPAQUE_AT = 250           # alpha at or above this is meant to be solid
CLEAR_AT = 5              # alpha at or below this is meant to be nothing
PALETTE = 256             # palette entries; the artwork really uses about six,
                          # the rest go to antialiased edges


def square_master(path):
    """The artwork, trimmed of its transparent margin onto a square canvas, so
    the rounded square fills the icon the way an app icon is normally drawn."""
    im = Image.open(path).convert('RGBA')
    art = im.crop(im.getbbox())
    side = max(art.size)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
    return out


def clean_alpha(img):
    """Snap the near-solid interior to fully solid and the near-empty margin to
    fully empty, leaving the genuine antialiasing at the rounded corners alone."""
    alpha = img.getchannel('A').point(
        lambda v: 255 if v >= OPAQUE_AT else (0 if v <= CLEAR_AT else v))
    out = img.copy()
    out.putalpha(alpha)
    return out


def field_colour(img):
    """The background blue, taken from a ring just inside the artwork's edge.
    Sampling the commonest colour overall would return the white of the
    document sheet, which covers more of the icon than the background does."""
    w, h = img.size
    band = max(4, min(w, h) // 28)
    ring = [img.getpixel((x, y))[:3]
            for y in range(h) for x in range(w)
            if min(x, y, w - 1 - x, h - 1 - y) < band and img.getpixel((x, y))[3] >= OPAQUE_AT]
    return Counter(ring).most_common(1)[0][0]


def compress(img, colours=PALETTE):
    """Quantise to a palette PNG (PNG8 + tRNS): 8 bits per pixel instead of 32.

    This is where the size actually comes from. Keeping the image in RGBA and
    merely reducing the colour count saves almost nothing, because the file
    still stores four full channels per pixel -- the 512px icon lands at 211 KB
    that way and at 13 KB as a palette, for a mean error of 1.5/255 that is
    invisible at every size this icon is ever drawn at. FASTOCTREE is used
    because it is the one PIL quantiser that carries the alpha channel into the
    palette, which the transparent corners need."""
    return img.convert('RGBA').quantize(colors=colours, method=Image.Quantize.FASTOCTREE)


def build(source, outdir):
    master = clean_alpha(square_master(source))
    blue = field_colour(master)
    print(f'source {source} -> {master.size[0]}px master, field blue '
          '#%02X%02X%02X' % blue)

    def at(size):
        return master.resize((size, size), Image.LANCZOS)

    written = []

    for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'),
                       (32, 'favicon-32.png'), (16, 'favicon-16.png')]:
        compress(at(size)).save(f'{outdir}/{name}', optimize=True, compress_level=9)
        written.append(name)

    def full_bleed(canvas, art_size):
        """The artwork centred at art_size on an opaque field of its own blue.

        alpha_composite, NOT paste-with-mask: paste blends the source's alpha
        into the destination as well as its colour, so the artwork's
        antialiased edge dragged the supposedly-opaque field down to alpha 191.
        Both full-bleed icons exist precisely so the platform is never handed a
        transparent pixel, so getting this wrong defeats the point of them --
        hence one helper rather than the same three lines written twice."""
        base = Image.new('RGBA', (canvas, canvas), blue + (255,))
        layer = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        art = at(art_size)
        layer.paste(art, ((canvas - art_size) // 2, (canvas - art_size) // 2))
        return Image.alpha_composite(base, layer)

    compress(full_bleed(512, round(512 * SAFE_ZONE))).save(
        f'{outdir}/icon-maskable-512.png', optimize=True, compress_level=9)
    written.append('icon-maskable-512.png')

    # (MEDIANCUT looks like the better quantiser for images with no alpha to
    # carry, but it spends palette entries on the +/-1 noise across the large
    # flat blue field and multiplies the file size; the octree groups those.)
    compress(full_bleed(180, 180)).save(
        f'{outdir}/apple-touch-icon.png', optimize=True, compress_level=9)
    written.append('apple-touch-icon.png')

    return written, blue


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else 'tools/icon-source.png'
    out = sys.argv[2] if len(sys.argv) > 2 else '.'
    import os
    names, _ = build(src, out)
    total = 0
    for n in names:
        kb = os.path.getsize(f'{out}/{n}') / 1024
        total += kb
        print(f'  {n:24s} {kb:7.1f} KB')
    print(f'  {"total":24s} {total:7.1f} KB')
