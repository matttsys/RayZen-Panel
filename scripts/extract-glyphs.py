#!/usr/bin/env python3
"""Extracts Material Symbols outlines into the inline icon tables the pages ship.

Why this exists

The panel and proxy-ip pages used to embed a Material Symbols woff2 subset as a base64
data URI. That worked, and it cost 6,414 B plus 1,542 B of page gzip, but it had a
failure mode nothing in the build could see: the glyph name *was* the element's text, so
a name absent from the subset rendered as the literal word `content_copy` on a live page.

The outlines are inline SVG now. This script is how they got there, and how a new icon
gets added: the woff2 files in `src/assets/fonts/` are kept as source assets, never
shipped, and this reads the outlines out of them.

Usage

    node scripts/fetch-icon-fonts.js      # only if subsets.json gained a name
    python3 scripts/extract-glyphs.py     # writes the tables to stdout
    npm test && npm run size

Why a 96-unit grid

Measured at the 24px these are drawn at, over the whole panel table:

    grid    gzipped   worst rounding error
      24     3,388 B   0.500 px
      48     4,085 B   0.250 px
      96     4,535 B   0.125 px
     240     5,130 B   0.050 px
     960     5,893 B   0.013 px   (the font's native em)

96 is the knee: half a pixel is visible on these stroke weights and an eighth is not,
and the 1,358 B it costs over the 24 grid is affordable where the 2,505 B for 960 is not.

Requires `fonttools` and `brotli`, which are dev-only and deliberately absent from
package.json: a build never runs this.
"""
import json
import pathlib
import sys

try:
    from fontTools.misc.transform import Transform
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit('pip install fonttools brotli')

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / 'src' / 'assets' / 'fonts'

#: The coordinate grid the emitted paths use. See the module docstring for why.
GRID = 96

#: Material Symbols draws its 24dp box from y=-120 to y=840 on a 960 em, so the outline
#: has to be shifted by 120 font units as well as flipped.
BASELINE_OFFSET = 120


def ligatures(font):
    """Maps each icon name to the glyph it draws.

    Material Symbols encodes a name as a `liga` substitution over Latin letters, digits
    and `_`, so the name is recoverable from coverage plus the component list. The
    subsetter puts those lookups behind extension lookups, which is why `ExtSubTable` is
    followed rather than assumed absent.
    """
    char_for = {}
    for code, glyph in font.getBestCmap().items():
        char_for[glyph] = chr(code)

    out = {}
    for lookup in font['GSUB'].table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            inner = getattr(subtable, 'ExtSubTable', subtable)
            for first, ligs in getattr(inner, 'ligatures', {}).items():
                lead = char_for.get(first, '')
                for lig in ligs:
                    name = lead + ''.join(char_for.get(c, '') for c in lig.Component)
                    out[name] = lig.LigGlyph
    return out


def paths(page, names):
    """SVG path data for `names`, on a GRID-unit grid with y flipped."""
    font = TTFont(FONTS / f'material-symbols-{page}.woff2')
    lig = ligatures(font)
    glyphs = font.getGlyphSet()
    scale = GRID / font['head'].unitsPerEm
    shift = GRID - BASELINE_OFFSET * scale

    out = {}
    for name in sorted(names):
        if name not in lig:
            sys.exit(f'{page}: {name} is not in the subset. Add it to subsets.json first.')
        pen = SVGPathPen(glyphs, ntos=lambda value: str(int(round(value))))
        glyphs[lig[name]].draw(TransformPen(pen, Transform(scale, 0, 0, -scale, 0, shift)))
        out[name] = pen.getCommands()
    return out


def main():
    manifest = json.loads((FONTS / 'subsets.json').read_text())

    for page, entry in manifest['pages'].items():
        table = paths(page, entry['icons'])
        print(f'/* ---- {page} ---- */')
        for name, data in table.items():
            print(f"    {name}: '<path d=\"{data}\"/>',")
        print()


if __name__ == '__main__':
    main()
