#!/usr/bin/env python3
"""Generate Zetamac PWA icons (pure stdlib — no Pillow needed).

Draws a white "Z" on a full-bleed blue square. Full-bleed = safe for both
iOS squircle masking and Android maskable icons.
"""
import zlib, struct, os

BG = (0, 122, 255)      # iOS blue
FG = (255, 255, 255)    # white glyph


def make_png(path, size):
    g = size * 0.52                 # glyph box ~52% of the icon
    gx0 = (size - g) / 2; gx1 = gx0 + g
    gy0 = (size - g) / 2; gy1 = gy0 + g
    t = g * 0.205                   # stroke thickness
    band = t * 0.80                 # diagonal half-width (horizontal)

    raw = bytearray()
    for y in range(size):
        raw.append(0)               # PNG filter byte (none)
        yc = y + 0.5
        in_box_y = gy0 <= yc <= gy1
        on_bar = in_box_y and (yc < gy0 + t or yc > gy1 - t)
        cx = gx1 - (yc - gy0) / (gy1 - gy0) * (gx1 - gx0) if in_box_y else None
        for x in range(size):
            xc = x + 0.5
            glyph = (gx0 <= xc <= gx1 and in_box_y and
                     (on_bar or abs(xc - cx) <= band))
            r, gg, b = FG if glyph else BG
            raw.append(r); raw.append(gg); raw.append(b)

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    out += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(out)
    print('wrote %s (%dx%d, %d bytes)' % (path, size, size, len(out)))


if __name__ == '__main__':
    os.makedirs('icons', exist_ok=True)
    make_png('icons/icon-512.png', 512)
    make_png('icons/icon-192.png', 192)
    make_png('icons/apple-touch-icon.png', 180)
