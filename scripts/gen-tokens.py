"""Generates the unified RayZen design-token block.

The accent and status values are solved for contrast by palette.py rather than
chosen by eye, so the generated CSS carries verified numbers and a new theme cannot
be added with an unreadable accent.
"""
import colorsys

def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def hexs(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c))) for c in rgb)

def unhex(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def hsl(hue, sat, light):
    return tuple(c * 255 for c in colorsys.hls_to_rgb(hue / 360, light / 100, sat / 100))

def mix(fg, bg, pct):
    """sRGB mix, matching what color-mix(in srgb, fg pct%, bg) produces."""
    k = pct / 100
    return tuple(fg[i] * k + bg[i] * (1 - k) for i in range(3))


# Every `-soft` fill in the stylesheet is this proportion of its own color mixed into
# the surface. The accent has to stay readable on it, which is a *stricter* constraint
# than the surface alone: a chip is accent-colored text on an accent-tinted pill.
SOFT_MIX = 14

# Solved against 4.6, not 4.5. The requirement is 4.5, and solving exactly to it left
# tropical at 4.4996 once the browser had rounded the mix to 8-bit channels, which
# reads as a pass in the generator and a fail in the product. The margin absorbs that.
TARGET = 4.6


def solve(hue, sat, bg, target, lighten):
    """Lightness that clears `target` against the surface *and* its own soft fill.

    Solving against the surface alone is what left the nav item at 4.06:1 and the
    status chip at 4.38:1 in light mode: both are colored text on a tinted fill, and
    the tint moves the background toward the text. Requiring both means the value is
    readable wherever the token is actually used.
    """
    steps = range(50, 100) if lighten else range(50, 0, -1)
    for l in steps:
        rgb = hsl(hue, sat, l)
        soft = mix(rgb, bg, SOFT_MIX)
        if ratio(rgb, bg) >= target and ratio(rgb, soft) >= target:
            return rgb
    return hsl(hue, sat, 99 if lighten else 1)

LIGHT = {
    'canvas': '#f6f2ea', 'canvas_alt': '#efe8dc', 'surface': '#fffdf8',
    'elevated': '#ffffff', 'soft': '#efe8dc', 'line': '#e0d6c4',
    'ink': '#2a2620', 'ink_2': '#5a5347', 'muted': '#736a5c',
}
DARK = {
    'canvas': '#0f1e17', 'canvas_alt': '#1e2c24', 'surface': '#17251d',
    'elevated': '#1c2b22', 'soft': '#22322a', 'line': '#33453b',
    'ink': '#f2efe9', 'ink_2': '#cdd8d0', 'muted': '#9fb1a5',
}

THEMES = {
    'forest': (152, 42), 'aurora': (162, 34), 'ocean': (191, 52),
    'midnight': (222, 26), 'lavender': (263, 22), 'sunset': (18, 40),
    'tropical': (178, 62),
}
STATUS = {'success': (152, 46), 'warning': (33, 62), 'danger': (5, 58)}

def accents(hue, sat, mode):
    surface = unhex(LIGHT['surface'] if mode == 'light' else DARK['surface'])
    lighten = mode == 'dark'
    base = solve(hue, sat, surface, TARGET, lighten)
    # Hover moves further from the surface so it is visibly distinct in both modes.
    hb, lb, sb = colorsys.rgb_to_hls(*[c / 255 for c in base])
    step = 0.09 if lighten else -0.07
    hover = tuple(c * 255 for c in colorsys.hls_to_rgb(hb, min(0.97, max(0.05, lb + step)), sb))
    return base, hover

def report():
    rows = []
    for name, (hue, sat) in THEMES.items():
        for mode in ('light', 'dark'):
            base, hover = accents(hue, sat, mode)
            surface = unhex(LIGHT['surface'] if mode == 'light' else DARK['surface'])
            rows.append((name, mode, hexs(base), ratio(base, surface)))
    return rows

def emit():
    out = []
    a = out.append
    a('/*')
    a(' * RayZen design tokens.')
    a(' *')
    a(' * One layer, three axes. Everything visual in this stylesheet reads a semantic')
    a(' * token from this block; no component names a color of its own. That is enforced')
    a(' * by tests/golden/design-tokens.test.ts, which fails on a raw hex outside this')
    a(' * block and on any token used but never defined.')
    a(' *')
    a(' * The axes')
    a(' *')
    a(' *   1. Theme   (data-theme): forest | aurora | ocean | midnight | lavender |')
    a(' *      sunset | tropical. Sets the accent ramp only.')
    a(' *   2. Mode    (data-mode):  light | dark, following the OS when unset. Sets the')
    a(' *      neutral ramp and re-solves the accent, because one accent value cannot be')
    a(' *      readable on both a near-white and a near-black surface.')
    a(' *   3. Density and motion, which are mode-independent.')
    a(' *')
    a(' * Why the accents look arbitrary')
    a(' *')
    a(' * They are not chosen, they are solved. Each theme is declared as a hue and a')
    a(' * chroma intent, and the lightness is the first value that clears 4.6:1 against')
    a(' * that mode\'s surface (scripts/gen-tokens.py). Before this, every theme accent')
    a(' * failed contrast in dark mode: forest text sat at 2.65:1 on the dark surface,')
    a(' * and the three status colors were defined once for light mode and inherited')
    a(' * unchanged into dark, where they measured 2.58, 3.61 and 3.05:1. Solving for the')
    a(' * constraint means a future theme cannot reintroduce that by eye.')
    a(' *')
    a(' * Two naming families, one source')
    a(' *')
    a(' * `--color-*` and `--rz-*` both exist because the panel grew in two passes, and')
    a(' * 373 call sites read one or the other. Renaming them all would be churn with no')
    a(' * user-visible effect, so both are aliased onto the same primitives below. There')
    a(' * is exactly one definition of any given color; the two families are views of it.')
    a(' */')
    a('')

    def ramp(mode, d):
        m = []
        m.append(f'    color-scheme: {mode};')
        m.append('')
        m.append('    /* Neutral ramp */')
        m.append(f"    --rz-p-canvas: {d['canvas']};")
        m.append(f"    --rz-p-canvas-alt: {d['canvas_alt']};")
        m.append(f"    --rz-p-surface: {d['surface']};")
        m.append(f"    --rz-p-elevated: {d['elevated']};")
        m.append(f"    --rz-p-soft: {d['soft']};")
        m.append(f"    --rz-p-line: {d['line']};")
        m.append(f"    --rz-p-ink: {d['ink']};")
        m.append(f"    --rz-p-ink-2: {d['ink_2']};")
        m.append(f"    --rz-p-muted: {d['muted']};")
        m.append('')
        m.append('    /* Status ramp, solved against this mode\'s surface */')
        for name, (hue, sat) in STATUS.items():
            surface = unhex(d['surface'])
            base = solve(hue, sat, surface, TARGET, mode == 'dark')
            m.append(f'    --rz-p-{name}: {hexs(base)};  /* {ratio(base, surface):.2f}:1 on surface */')
        m.append('')
        m.append('    /* Shadow tint follows the mode: warm and shallow on light, deep on dark */')
        if mode == 'light':
            m.append('    --rz-p-shadow-1: 0 1px 2px rgba(40, 30, 20, 0.05);')
            m.append('    --rz-p-shadow-2: 0 1px 2px rgba(40, 30, 20, 0.05), 0 12px 34px rgba(40, 30, 20, 0.09);')
            m.append('    --rz-p-shadow-ambient: rgba(90, 70, 50, 0.22);')
        else:
            m.append('    --rz-p-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);')
            m.append('    --rz-p-shadow-2: 0 1px 2px rgba(0, 0, 0, 0.4), 0 16px 40px rgba(0, 0, 0, 0.5);')
            m.append('    --rz-p-shadow-ambient: rgba(0, 0, 0, 0.55);')
        return m

    def theme_accents(mode):
        m = []
        for name, (hue, sat) in THEMES.items():
            base, hover = accents(hue, sat, mode)
            surface = unhex(LIGHT['surface'] if mode == 'light' else DARK['surface'])
            sel = ':root' if name == 'forest' else f':root[data-theme="{name}"]'
            if mode == 'light':
                m.append(f'{sel}:not([data-mode="dark"]) {{')
            else:
                m.append(f'{sel}[data-mode="dark"] {{')
            m.append(f'    --rz-p-accent: {hexs(base)};  /* {ratio(base, surface):.2f}:1 */')
            m.append(f'    --rz-p-accent-hover: {hexs(hover)};')
            m.append('}')
        return m

    a('/* ---- Mode: light is the default, dark is explicit or OS-driven ---- */')
    a(':root {')
    out.extend(ramp('light', LIGHT))
    a('}')
    a('')
    a(':root[data-mode="dark"] {')
    out.extend(ramp('dark', DARK))
    a('}')
    a('')
    a('/* Follow the OS when the operator has not chosen a mode. */')
    a('@media (prefers-color-scheme: dark) {')
    a('    :root:not([data-mode]) {')
    for line in ramp('dark', DARK):
        a('    ' + line if line else '')
    a('    }')
    a('}')
    a('')
    a('/* ---- Theme: accent ramp per theme, re-solved per mode ---- */')
    a('/* Forest is the default identity, so it is declared on bare :root. */')
    out.extend(theme_accents('light'))
    a('')
    out.extend(theme_accents('dark'))
    a('')
    a('/* Dark accents also apply when the OS asks for dark and no mode is pinned. */')
    a('@media (prefers-color-scheme: dark) {')
    for name, (hue, sat) in THEMES.items():
        base, hover = accents(hue, sat, 'dark')
        sel = ':root:not([data-mode])' if name == 'forest' else f':root[data-theme="{name}"]:not([data-mode])'
        a(f'    {sel} {{ --rz-p-accent: {hexs(base)}; --rz-p-accent-hover: {hexs(hover)}; }}')
    a('}')
    a('')

    a("""/* ---- Semantic layer: the only names components may read ---- */
:root {
    /* Surfaces, back to front */
    --rz-canvas: var(--rz-p-canvas);
    --rz-canvas-alt: var(--rz-p-canvas-alt);
    --rz-surface: var(--rz-p-surface);
    --rz-surface-soft: var(--rz-p-soft);
    --rz-elevated: var(--rz-p-elevated);

    /* Lines and text */
    --rz-line: var(--rz-p-line);
    --rz-ink: var(--rz-p-ink);
    --rz-ink-2: var(--rz-p-ink-2);
    --rz-muted: var(--rz-p-muted);

    /* Accent */
    --rz-primary: var(--rz-p-accent);
    --rz-primary-hover: var(--rz-p-accent-hover);
    --rz-brand: var(--rz-p-accent);
    --rz-accent: var(--rz-p-accent);
    --rz-primary-soft: color-mix(in srgb, var(--rz-p-accent) 14%, var(--rz-p-surface));
    --rz-primary-focus: color-mix(in srgb, var(--rz-p-accent) 32%, transparent);

    /* Status. `-soft` is derived from the same primitive, so a theme or mode change
       cannot leave the fill and the text disagreeing. */
    --rz-good: var(--rz-p-success);
    --rz-good-soft: color-mix(in srgb, var(--rz-p-success) 14%, var(--rz-p-surface));
    --rz-warn: var(--rz-p-warning);
    --rz-warn-soft: color-mix(in srgb, var(--rz-p-warning) 14%, var(--rz-p-surface));
    --rz-risk: var(--rz-p-danger);
    --rz-risk-soft: color-mix(in srgb, var(--rz-p-danger) 14%, var(--rz-p-surface));

    --rz-shadow: var(--rz-p-shadow-2);
    --rz-shadow-1: var(--rz-p-shadow-1);

    /* ---- The `--color-*` and `--accent*` family: the same values under the names
       the first panel pass used. Aliases, not a second source of truth. ---- */
    --accent: var(--rz-p-accent);
    --accent-hover: var(--rz-p-accent-hover);
    --accent-focus: var(--rz-primary-focus);
    --accent-soft: var(--rz-primary-soft);

    --surface-gradient: linear-gradient(160deg, var(--rz-p-canvas) 0%, var(--rz-p-canvas-alt) 100%);
    --surface-card: var(--rz-p-surface);
    --surface-input: var(--rz-p-elevated);
    --surface-modal: var(--rz-p-surface);
    --line-color: var(--rz-p-line);
    --ink-primary: var(--rz-p-ink);
    --ink-secondary: var(--rz-p-ink-2);
    --ink-muted: var(--rz-p-muted);
    --shadow-ambient: var(--rz-p-shadow-ambient);

    --color-bg-main: var(--surface-gradient);
    --color-bg-card: var(--surface-card);
    --color-bg-input: var(--surface-input);
    --color-bg-modal: var(--surface-modal);
    --color-bg-btn: var(--rz-primary-soft);

    --color-border-ui: var(--rz-line);
    --color-border-accent: color-mix(in srgb, var(--rz-p-accent) 30%, transparent);

    --color-icon-green: var(--rz-p-success);
    --color-icon-red: var(--rz-p-danger);

    --color-text-primary: var(--rz-ink);
    --color-text-secondary: var(--rz-ink-2);
    --color-text-muted: var(--rz-muted);
    --color-text-btn: var(--rz-primary-hover);

    --color-brand-primary: var(--rz-p-accent);
    --color-brand-hover: var(--rz-p-accent-hover);
    --color-brand-light-focus: var(--rz-primary-focus);

    /* ---- Structure: independent of theme and mode ---- */
    --radius-card: 1.5rem;
    --radius-ui: 0.75rem;
    --radius-btn: 1rem;

    --space-xs: 0.25rem;
    --space-sm: 0.5rem;
    --space-md: 0.85rem;
    --space-lg: 1rem;
    --space-xl: 1.5rem;

    --font-size-xs: 0.75rem;
    --font-size-sm: 0.875rem;
    --font-size-base: 1rem;
    --font-size-lg: 1.7rem;
    --font-size-xlg: 2rem;

    --line-height-xs: 1rem;
    --line-height-sm: 1.25rem;
    --line-height-lg: 2rem;

    --shadow-header: 0.125rem 0.125rem 0.25rem var(--shadow-ambient);
    --shadow-icon: 0.125rem 0.125rem 0.2rem var(--shadow-ambient);
    --shadow-card: var(--rz-p-shadow-2);
    --shadow-input: inset 0 1px 2px color-mix(in srgb, var(--shadow-ambient), transparent 55%);
    --shadow-input-focus: 0 0 0 3px var(--rz-primary-focus);

    --transition-standard: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}""")
    return '\n'.join(out)

if __name__ == '__main__':
    import sys
    if '--report' in sys.argv:
        for name, mode, hx, r in report():
            print(f'{name:9s} {mode:5s} {hx} {r:.2f}:1')
    else:
        print(emit())
