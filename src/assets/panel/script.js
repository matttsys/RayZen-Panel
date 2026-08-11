const defaultHttpsPorts = [443, 8443, 2053, 2083, 2087, 2096];
const defaultHttpPorts = [80, 8080, 8880, 2052, 2082, 2086, 2095];
const proxyForm = document.getElementById('configForm');
const [
    selectElements,
    numInputElements,
    inputElements,
    textareaElements,
    checkboxElements
] = [
    'select',
    'input[type=number]',
    'input:not([type=file])',
    'textarea',
    'input[type=checkbox]'
].map(query => proxyForm.querySelectorAll(query));



/* ------------------------------------------------------------------ *
 * RayZen icon language
 *
 * Material Symbols were a placeholder: they made the panel read as a generic
 * admin console, and several of them (a plain gear, a fingerprint, a bare
 * checkmark) said nothing about what the screen actually does. These are drawn
 * for RayZen: one 24x24 grid, 1.6px strokes, round caps/joins, `currentColor`
 * only, so a single icon inherits the active theme, the RTL mirror and the
 * disabled state without a second asset.
 * ------------------------------------------------------------------ */
const RZ_ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const RZ_ICON_PATHS = {
    // Overview: a signal radiating from a single point. The product in one glyph.
    overview: '<circle cx="12" cy="12" r="2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.6 19.4a10.5 10.5 0 0 1 0-14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8"/>',
    // Configuration: real controls, not a gear.
    configuration: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="17" r="2"/>',
    // Smart setup: guided intelligence.
    smart: '<path d="M12 3.5l1.6 3.9 3.9 1.6-3.9 1.6L12 14.5l-1.6-3.9L6.5 9l3.9-1.6z"/><path d="M18.5 14.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/><path d="M5.5 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L3.5 18l1.4-.6z"/>',
    // Diagnostics: continuous health monitoring, not a verified badge.
    diagnostics: '<rect x="2.8" y="4.8" width="18.4" height="13" rx="3.2"/><path d="M6.2 11.6h2.4l1.5-3.2 2.2 6.2 1.6-3h3.9"/><path d="M9 21h6M12 17.8V21"/>',
    // Clean IP: an optimised route through the cloud, at speed.
    intelligence: '<path d="M7.4 15.4a3.7 3.7 0 0 1 .5-7.36A5 5 0 0 1 17.4 9a3.2 3.2 0 0 1 .3 6.4"/><path d="M3 18.6h5M5.5 21.4h7"/><path d="M14.6 17.4l2.4 2.4 4-4.4"/>',
    // Analytics: measured movement over time.
    analytics: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7.6 16.4v-3.6M11.6 16.4v-6.6M15.6 16.4v-4.6M19.6 16.4v-8.6"/><path d="M7.2 10.6l4.4-4.2 3.8 3 4.4-4.6"/>',
    // Settings: personalisation dials.
    settings: '<circle cx="12" cy="12" r="7.4"/><path d="M12 8.4V12l2.5 1.6"/><path d="M12 2.6v1.8M12 19.6v1.8M21.4 12h-1.8M4.4 12H2.6M18.7 5.3l-1.3 1.3M6.6 17.4l-1.3 1.3M18.7 18.7l-1.3-1.3M6.6 6.6L5.3 5.3"/>',
    // Supporting-metric glyphs.
    endpoint: '<circle cx="5" cy="18" r="2.2"/><circle cx="12" cy="6" r="2.2"/><circle cx="19" cy="16" r="2.2"/><path d="M6.7 16.4l3.9-8.3M13.4 7.6l4.4 6.7M7.2 18.4h9.6"/>',
    security: '<path d="M12 3.2l7 2.8v5.4c0 4.2-2.8 7.6-7 9.4-4.2-1.8-7-5.2-7-9.4V6z"/><path d="M12 10.4v3.4"/><circle cx="12" cy="8.4" r="0.9" fill="currentColor" stroke="none"/>',
    action: '<path d="M13.2 2.8L5 13.4h5.4L9.8 21.2 18.6 10h-5.6z"/>',
    healthy: '<path d="M12 20.4C7.6 18.6 4.6 15 4.6 10.8A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.4 2.8c0 4.2-3 7.8-7.4 9.6z"/><path d="M8.4 12.2h2l1.2-2.2 1.6 3.4 1-1.2h1.6"/>',
    alert: '<path d="M12 4.2l8.4 14.6H3.6z"/><path d="M12 9.6v4"/><circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/>',
    logout: '<path d="M14.4 4.6H6.8A2.2 2.2 0 0 0 4.6 6.8v10.4a2.2 2.2 0 0 0 2.2 2.2h7.6"/><path d="M15.6 8.4L19.4 12l-3.8 3.6M19.4 12H9.6"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.4V9h-4.6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.6"/><path d="M15 5.4A2.4 2.4 0 0 0 12.6 3H6.4A3.4 3.4 0 0 0 3 6.4v6.2A2.4 2.4 0 0 0 5.4 15"/>',
    download: '<path d="M12 3.6v11"/><path d="M7.8 10.6L12 14.8l4.2-4.2"/><path d="M4.4 18.4h15.2"/>'
};
/* ------------------------------------------------------------------ *
 * Material Symbols outlines, extracted from the woff2 the panel used to embed.
 *
 * Why these are here and the font is not
 *
 * The panel shipped a 37-glyph Material Symbols subset as a base64 `@font-face`, which
 * cost 6,414 B of page gzip. These are the same outlines as paths: 4,535 B, and the
 * whole class of failure where a name absent from the subset renders as the literal
 * word `content_copy` goes with it, because a name absent from this table is a missing
 * key rather than a shipped page that reads wrong.
 *
 * Extracted from that exact woff2 by `scripts/extract-glyphs.py`, so they are the
 * glyphs the panel was already drawing rather than redrawn approximations.
 *
 * Why a 96-unit grid
 *
 * Measured across grids, at the 24px these are drawn at: the font's native 960 costs
 * 5,893 B gzipped, 24 costs 3,388 but rounds coordinates to half a pixel, which shows
 * on the thin strokes. 96 is 4,535 B and rounds to an eighth of a pixel.
 *
 * Kept separate from `RZ_ICON_PATHS` because the two are drawn differently: RayZen's
 * own icons are strokes on a 24 grid, these are fills on a 96 grid. One table with a
 * per-entry viewBox would mean every RayZen icon carried a redundant attribute.
 * ------------------------------------------------------------------ */
const RZ_GLYPH_ATTRS = 'viewBox="0 0 96 96" fill="currentColor" stroke="none"';
const RZ_GLYPH_PATHS = {
    add_circle: '<path d="M44 40V52Q44 54 45 55Q46 56 48 56Q50 56 51 55Q52 54 52 52V40H64Q66 40 67 39Q68 38 68 36Q68 34 67 33Q66 32 64 32H52V20Q52 18 51 17Q50 16 48 16Q46 16 45 17Q44 18 44 20V32H32Q30 32 29 33Q28 34 28 36Q28 38 29 39Q30 40 32 40ZM48 76Q40 76 32 73Q25 70 20 64Q14 59 11 52Q8 44 8 36Q8 28 11 20Q14 13 20 8Q25 2 32 -1Q40 -4 48 -4Q56 -4 64 -1Q71 2 76 8Q82 13 85 20Q88 28 88 36Q88 44 85 52Q82 59 76 64Q71 70 64 73Q56 76 48 76ZM48 68Q61 68 71 59Q80 49 80 36Q80 23 71 13Q61 4 48 4Q35 4 25 13Q16 23 16 36Q16 49 25 59Q35 68 48 68ZM48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Z"/>',
    cancel: '<path d="M48 42 60 53Q61 54 62 54Q64 54 65 53Q66 52 66 50Q66 49 65 48L54 36L65 24Q66 23 66 22Q66 20 65 19Q64 18 62 18Q61 18 60 19L48 30L36 19Q35 18 34 18Q32 18 31 19Q30 20 30 22Q30 23 31 24L42 36L31 48Q30 49 30 50Q30 52 31 53Q32 54 34 54Q35 54 36 53ZM48 76Q40 76 32 73Q25 70 20 64Q14 59 11 52Q8 44 8 36Q8 28 11 20Q14 13 20 8Q25 2 32 -1Q40 -4 48 -4Q56 -4 64 -1Q71 2 76 8Q82 13 85 20Q88 28 88 36Q88 44 85 52Q82 59 76 64Q71 70 64 73Q56 76 48 76ZM48 68Q61 68 71 59Q80 49 80 36Q80 23 71 13Q61 4 48 4Q35 4 25 13Q16 23 16 36Q16 49 25 59Q35 68 48 68ZM48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Z"/>',
    clock_loader_40: '<path d="M48 76Q40 76 32 73Q25 70 20 64Q14 59 11 52Q8 44 8 36Q8 28 11 20Q14 13 20 8Q25 2 32 -1Q40 -4 48 -4Q56 -4 64 -1Q71 2 76 8Q82 13 85 20Q88 28 88 36Q88 44 85 52Q82 59 76 64Q71 70 64 73Q56 76 48 76ZM48 68Q54 68 60 66Q66 63 71 59L48 36V4Q35 4 25 13Q16 23 16 36Q16 49 25 59Q35 68 48 68Z"/>',
    close: '<path d="M48 42 28 61Q27 62 26 62Q24 62 23 61Q22 60 22 58Q22 57 23 56L42 36L23 16Q22 15 22 14Q22 12 23 11Q24 10 26 10Q27 10 28 11L48 30L68 11Q69 10 70 10Q72 10 73 11Q74 12 74 14Q74 15 73 16L54 36L73 56Q74 57 74 58Q74 60 73 61Q72 62 70 62Q69 62 68 61Z"/>',
    cloud_download: '<path d="M44 37V12Q36 14 32 20Q28 26 28 32H26Q20 32 16 36Q12 40 12 46Q12 52 16 56Q20 60 26 60H74Q78 60 81 57Q84 54 84 50Q84 46 81 43Q78 40 74 40H68V32Q68 27 66 23Q64 19 60 16V7Q67 10 72 17Q76 24 76 32Q83 33 87 38Q92 43 92 50Q92 58 87 63Q82 68 74 68H26Q17 68 10 62Q4 55 4 46Q4 38 9 32Q13 26 21 25Q23 17 30 11Q36 4 44 4Q47 4 50 7Q52 9 52 12V37L56 33Q57 32 58 32Q60 32 61 33Q62 34 62 36Q62 38 61 39L51 49Q50 50 48 50Q46 50 45 49L35 39Q34 38 34 36Q34 34 35 33Q36 32 38 32Q39 32 40 33ZM48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Q48 32 48 32Z"/>',
    delete: '<path d="M28 72Q25 72 22 70Q20 67 20 64V12Q18 12 17 11Q16 10 16 8Q16 6 17 5Q18 4 20 4H36Q36 2 37 1Q38 0 40 0H56Q58 0 59 1Q60 2 60 4H76Q78 4 79 5Q80 6 80 8Q80 10 79 11Q78 12 76 12V64Q76 67 74 70Q71 72 68 72ZM68 12H28V64Q28 64 28 64Q28 64 28 64H68Q68 64 68 64Q68 64 68 64ZM44 52V24Q44 22 43 21Q42 20 40 20Q38 20 37 21Q36 22 36 24V52Q36 54 37 55Q38 56 40 56Q42 56 43 55Q44 54 44 52ZM60 52V24Q60 22 59 21Q58 20 56 20Q54 20 53 21Q52 22 52 24V52Q52 54 53 55Q54 56 56 56Q58 56 59 55Q60 54 60 52ZM28 12V64Q28 64 28 64Q28 64 28 64Q28 64 28 64Q28 64 28 64Z"/>',
    dns: '<path d="M30 12Q28 12 26 14Q24 16 24 18Q24 20 26 22Q28 24 30 24Q32 24 34 22Q36 20 36 18Q36 16 34 14Q32 12 30 12ZM30 52Q28 52 26 54Q24 56 24 58Q24 60 26 62Q28 64 30 64Q32 64 34 62Q36 60 36 58Q36 56 34 54Q32 52 30 52ZM16 0H80Q82 0 83 1Q84 2 84 4V32Q84 34 83 35Q82 36 80 36H16Q14 36 13 35Q12 34 12 32V4Q12 2 13 1Q14 0 16 0ZM20 8V28H76V8ZM16 40H80Q82 40 83 41Q84 42 84 44V72Q84 74 83 75Q82 76 80 76H16Q14 76 13 75Q12 74 12 72V44Q12 42 13 41Q14 40 16 40ZM20 48V68H76V48ZM20 8V28ZM20 48V68Z"/>',
    draft: '<path d="M24 76Q21 76 18 74Q16 71 16 68V4Q16 1 18 -2Q21 -4 24 -4H53Q54 -4 56 -3Q57 -3 58 -2L78 18Q79 19 79 20Q80 22 80 23V68Q80 71 78 74Q75 76 72 76ZM52 20V4H24Q24 4 24 4Q24 4 24 4V68Q24 68 24 68Q24 68 24 68H72Q72 68 72 68Q72 68 72 68V24H56Q54 24 53 23Q52 22 52 20ZM24 4V20Q24 22 24 23Q24 24 24 24V4V20Q24 22 24 23Q24 24 24 24V68Q24 68 24 68Q24 68 24 68Q24 68 24 68Q24 68 24 68V4Q24 4 24 4Q24 4 24 4Z"/>',
    help: '<path d="M48 60Q50 60 51 59Q53 57 53 55Q53 53 51 51Q50 50 48 50Q46 50 44 51Q43 53 43 55Q43 57 44 59Q46 60 48 60ZM48 76Q40 76 32 73Q25 70 20 64Q14 59 11 52Q8 44 8 36Q8 28 11 20Q14 13 20 8Q25 2 32 -1Q40 -4 48 -4Q56 -4 64 -1Q71 2 76 8Q82 13 85 20Q88 28 88 36Q88 44 85 52Q82 59 76 64Q71 70 64 73Q56 76 48 76ZM48 68Q61 68 71 59Q80 49 80 36Q80 23 71 13Q61 4 48 4Q35 4 25 13Q16 23 16 36Q16 49 25 59Q35 68 48 68ZM48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36ZM48 19Q51 19 53 20Q55 22 55 24Q55 27 53 28Q52 30 50 32Q48 34 46 36Q44 38 44 41Q44 43 45 44Q46 45 48 45Q49 45 50 44Q52 43 52 41Q52 39 54 37Q55 36 57 34Q59 32 61 29Q62 27 62 24Q62 18 58 15Q54 12 48 12Q45 12 41 14Q38 15 36 18Q35 20 35 21Q36 22 37 23Q38 24 40 24Q41 23 42 22Q43 20 45 20Q47 19 48 19Z"/>',
    info: '<path d="M52 52V36Q52 34 51 33Q50 32 48 32Q46 32 45 33Q44 34 44 36V52Q44 54 45 55Q46 56 48 56Q50 56 51 55Q52 54 52 52ZM52 20Q52 18 51 17Q50 16 48 16Q46 16 45 17Q44 18 44 20Q44 22 45 23Q46 24 48 24Q50 24 51 23Q52 22 52 20ZM48 76Q40 76 32 73Q25 70 20 64Q14 59 11 52Q8 44 8 36Q8 28 11 20Q14 13 20 8Q25 2 32 -1Q40 -4 48 -4Q56 -4 64 -1Q71 2 76 8Q82 13 85 20Q88 28 88 36Q88 44 85 52Q82 59 76 64Q71 70 64 73Q56 76 48 76ZM48 68Q61 68 71 59Q80 49 80 36Q80 23 71 13Q61 4 48 4Q35 4 25 13Q16 23 16 36Q16 49 25 59Q35 68 48 68ZM48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Z"/>',
    key_vertical: '<path d="M42 16Q42 13 44 10Q47 8 50 8Q53 8 56 10Q58 13 58 16Q58 19 56 22Q53 24 50 24Q47 24 44 22Q42 19 42 16ZM26 16Q26 6 33 -1Q40 -8 50 -8Q60 -8 67 -1Q74 6 74 16Q74 23 71 28Q67 34 62 37V70Q62 71 62 72Q61 73 61 73L53 81Q52 82 52 82Q51 82 50 82Q49 82 48 82Q48 82 47 81L34 68Q34 68 34 67Q33 67 33 66Q33 65 33 64Q34 64 34 63L38 58L34 52Q33 52 33 51Q33 51 33 50Q33 49 33 49Q33 48 34 48L38 42V37Q33 34 29 28Q26 23 26 16ZM34 16Q34 22 37 26Q41 30 46 32V44L42 50Q42 50 42 50Q42 50 42 50Q42 50 42 50Q42 50 42 50L48 58L42 65Q42 65 42 65Q42 65 42 65Q42 65 42 65Q42 65 42 65L50 73Q50 72 50 73Q50 73 50 73Q50 73 50 73Q50 73 50 73L54 69Q54 69 54 69Q54 69 54 69V32Q59 30 63 26Q66 22 66 16Q66 9 61 5Q57 0 50 0Q43 0 39 5Q34 9 34 16Z"/>',
    keyboard_arrow_down: '<path d="M45 47 27 28Q26 27 26 26Q26 24 27 23Q28 22 30 22Q31 22 32 23L48 38L64 23Q65 22 66 22Q68 22 69 23Q70 24 70 26Q70 27 69 28L51 47Q50 47 50 48Q49 48 48 48Q47 48 46 48Q46 47 45 47Z"/>',
    link: '<path d="M28 56Q20 56 14 50Q8 44 8 36Q8 28 14 22Q20 16 28 16H40Q42 16 43 17Q44 18 44 20Q44 22 43 23Q42 24 40 24H28Q23 24 20 28Q16 31 16 36Q16 41 20 44Q23 48 28 48H40Q42 48 43 49Q44 50 44 52Q44 54 43 55Q42 56 40 56ZM36 40Q34 40 33 39Q32 38 32 36Q32 34 33 33Q34 32 36 32H60Q62 32 63 33Q64 34 64 36Q64 38 63 39Q62 40 60 40ZM56 56Q54 56 53 55Q52 54 52 52Q52 50 53 49Q54 48 56 48H68Q73 48 76 44Q80 41 80 36Q80 31 76 28Q73 24 68 24H56Q54 24 53 23Q52 22 52 20Q52 18 53 17Q54 16 56 16H68Q76 16 82 22Q88 28 88 36Q88 44 82 50Q76 56 68 56Z"/>',
    open_in_new: '<path d="M20 72Q17 72 14 70Q12 67 12 64V8Q12 5 14 2Q17 0 20 0H44Q46 0 47 1Q48 2 48 4Q48 6 47 7Q46 8 44 8H20Q20 8 20 8Q20 8 20 8V64Q20 64 20 64Q20 64 20 64H76Q76 64 76 64Q76 64 76 64V40Q76 38 77 37Q78 36 80 36Q82 36 83 37Q84 38 84 40V64Q84 67 82 70Q79 72 76 72ZM76 14 42 48Q40 49 39 49Q37 49 36 48Q35 47 35 45Q35 44 36 42L70 8H60Q58 8 57 7Q56 6 56 4Q56 2 57 1Q58 0 60 0H80Q82 0 83 1Q84 2 84 4V24Q84 26 83 27Q82 28 80 28Q78 28 77 27Q76 26 76 24Z"/>',
    qr_code: '<path d="M12 28V4Q12 2 13 1Q14 0 16 0H40Q42 0 43 1Q44 2 44 4V28Q44 30 43 31Q42 32 40 32H16Q14 32 13 31Q12 30 12 28ZM20 24H36V8H20ZM12 68V44Q12 42 13 41Q14 40 16 40H40Q42 40 43 41Q44 42 44 44V68Q44 70 43 71Q42 72 40 72H16Q14 72 13 71Q12 70 12 68ZM20 64H36V48H20ZM52 28V4Q52 2 53 1Q54 0 56 0H80Q82 0 83 1Q84 2 84 4V28Q84 30 83 31Q82 32 80 32H56Q54 32 53 31Q52 30 52 28ZM60 24H76V8H60ZM76 72V64H84V72ZM52 48V40H60V48ZM60 56V48H68V56ZM52 64V56H60V64ZM60 72V64H68V72ZM68 64V56H76V64ZM68 48V40H76V48ZM76 56V48H84V56Z"/>',
    save: '<path d="M20 72Q17 72 14 70Q12 67 12 64V8Q12 5 14 2Q17 0 20 0H65Q66 0 68 1Q69 1 70 2L82 14Q83 15 83 16Q84 18 84 19V64Q84 67 82 70Q79 72 76 72ZM76 19 65 8H20Q20 8 20 8Q20 8 20 8V64Q20 64 20 64Q20 64 20 64H76Q76 64 76 64Q76 64 76 64ZM48 60Q53 60 56 56Q60 53 60 48Q60 43 56 40Q53 36 48 36Q43 36 40 40Q36 43 36 48Q36 53 40 56Q43 60 48 60ZM28 28H56Q58 28 59 27Q60 26 60 24V16Q60 14 59 13Q58 12 56 12H28Q26 12 25 13Q24 14 24 16V24Q24 26 25 27Q26 28 28 28ZM20 19V64Q20 64 20 64Q20 64 20 64Q20 64 20 64Q20 64 20 64V8Q20 8 20 8Q20 8 20 8Z"/>',
    settings_backup_restore: '<path d="M48 72Q35 72 26 64Q16 57 13 45Q13 43 14 42Q15 41 16 41Q18 40 19 41Q21 42 21 44Q24 53 31 58Q38 64 48 64Q60 64 68 56Q76 48 76 36Q76 24 68 16Q60 8 48 8Q41 8 35 11Q29 14 25 20H32Q34 20 35 21Q36 22 36 24Q36 26 35 27Q34 28 32 28H16Q14 28 13 27Q12 26 12 24V8Q12 6 13 5Q14 4 16 4Q18 4 19 5Q20 6 20 8V13Q25 7 32 4Q40 0 48 0Q56 0 62 3Q69 6 73 11Q78 15 81 22Q84 28 84 36Q84 44 81 50Q78 57 73 61Q69 66 62 69Q56 72 48 72ZM48 44Q45 44 42 42Q40 39 40 36Q40 33 42 30Q45 28 48 28Q51 28 54 30Q56 33 56 36Q56 39 54 42Q51 44 48 44Z"/>',
    share: '<path d="M68 76Q63 76 60 72Q56 69 56 64Q56 63 56 61L28 45Q27 46 24 47Q22 48 20 48Q15 48 12 44Q8 41 8 36Q8 31 12 28Q15 24 20 24Q22 24 24 25Q27 26 28 27L56 11Q56 10 56 9Q56 9 56 8Q56 3 60 0Q63 -4 68 -4Q73 -4 76 0Q80 3 80 8Q80 13 76 16Q73 20 68 20Q66 20 64 19Q61 18 60 17L32 33Q32 34 32 35Q32 35 32 36Q32 37 32 37Q32 38 32 39L60 55Q61 54 64 53Q66 52 68 52Q73 52 76 56Q80 59 80 64Q80 69 76 72Q73 76 68 76ZM68 68Q70 68 71 67Q72 66 72 64Q72 62 71 61Q70 60 68 60Q66 60 65 61Q64 62 64 64Q64 66 65 67Q66 68 68 68ZM20 40Q22 40 23 39Q24 38 24 36Q24 34 23 33Q22 32 20 32Q18 32 17 33Q16 34 16 36Q16 38 17 39Q18 40 20 40ZM72 8Q72 6 71 5Q70 4 68 4Q66 4 65 5Q64 6 64 8Q64 10 65 11Q66 12 68 12Q70 12 71 11Q72 10 72 8ZM68 64Q68 64 68 64Q68 64 68 64Q68 64 68 64Q68 64 68 64Q68 64 68 64Q68 64 68 64Q68 64 68 64Q68 64 68 64ZM20 36Q20 36 20 36Q20 36 20 36Q20 36 20 36Q20 36 20 36Q20 36 20 36Q20 36 20 36Q20 36 20 36Q20 36 20 36ZM68 8Q68 8 68 8Q68 8 68 8Q68 8 68 8Q68 8 68 8Q68 8 68 8Q68 8 68 8Q68 8 68 8Q68 8 68 8Z"/>',
    smart_toy: '<path d="M16 48Q11 48 8 44Q4 41 4 36Q4 31 8 28Q11 24 16 24V16Q16 13 18 10Q21 8 24 8H36Q36 3 40 0Q43 -4 48 -4Q53 -4 56 0Q60 3 60 8H72Q75 8 78 10Q80 13 80 16V24Q85 24 88 28Q92 31 92 36Q92 41 88 44Q85 48 80 48V64Q80 67 78 70Q75 72 72 72H24Q21 72 18 70Q16 67 16 64ZM36 40Q38 40 40 38Q42 36 42 34Q42 32 40 30Q38 28 36 28Q34 28 32 30Q30 32 30 34Q30 36 32 38Q34 40 36 40ZM60 40Q62 40 64 38Q66 36 66 34Q66 32 64 30Q62 28 60 28Q58 28 56 30Q54 32 54 34Q54 36 56 38Q58 40 60 40ZM36 56H60Q62 56 63 55Q64 54 64 52Q64 50 63 49Q62 48 60 48H36Q34 48 33 49Q32 50 32 52Q32 54 33 55Q34 56 36 56ZM24 64H72Q72 64 72 64Q72 64 72 64V16Q72 16 72 16Q72 16 72 16H24Q24 16 24 16Q24 16 24 16V64Q24 64 24 64Q24 64 24 64ZM48 40Q48 40 48 40Q48 40 48 40Q48 40 48 40Q48 40 48 40Q48 40 48 40Q48 40 48 40Q48 40 48 40Q48 40 48 40Z"/>',
    upgrade: '<path d="M32 68Q30 68 29 67Q28 66 28 64Q28 62 29 61Q30 60 32 60H64Q66 60 67 61Q68 62 68 64Q68 66 67 67Q66 68 64 68ZM44 48V19L36 27Q35 28 34 28Q32 28 31 27Q30 26 30 24Q30 22 31 21L45 7Q46 6 46 6Q47 6 48 6Q49 6 50 6Q50 6 51 7L65 21Q66 22 66 24Q66 26 65 27Q64 28 62 28Q61 28 60 27L52 19V48Q52 50 51 51Q50 52 48 52Q46 52 45 51Q44 50 44 48Z"/>',
    upload: '<path d="M24 68Q21 68 18 66Q16 63 16 60V52Q16 50 17 49Q18 48 20 48Q22 48 23 49Q24 50 24 52V60Q24 60 24 60Q24 60 24 60H72Q72 60 72 60Q72 60 72 60V52Q72 50 73 49Q74 48 76 48Q78 48 79 49Q80 50 80 52V60Q80 63 78 66Q75 68 72 68ZM44 19 36 27Q35 28 34 28Q32 28 31 27Q30 26 30 24Q30 22 31 21L45 7Q46 6 46 6Q47 6 48 6Q49 6 50 6Q50 6 51 7L65 21Q66 22 66 24Q66 26 65 27Q64 28 62 28Q61 28 60 27L52 19V48Q52 50 51 51Q50 52 48 52Q46 52 45 51Q44 50 44 48Z"/>',
    visibility: '<path d="M48 52Q56 52 61 47Q66 42 66 34Q66 26 61 21Q56 16 48 16Q40 16 35 21Q30 26 30 34Q30 42 35 47Q40 52 48 52ZM48 45Q44 45 40 42Q37 38 37 34Q37 30 40 26Q44 23 48 23Q52 23 56 26Q59 30 59 34Q59 38 56 42Q52 45 48 45ZM6 38Q6 37 5 36Q5 35 5 34Q5 33 5 32Q6 31 6 30Q12 18 24 11Q35 4 48 4Q61 4 72 11Q84 18 90 30Q90 31 91 32Q91 33 91 34Q91 35 91 36Q90 37 90 38Q84 50 72 57Q61 64 48 64Q35 64 24 57Q12 50 6 38ZM48 34Q48 34 48 34Q48 34 48 34Q48 34 48 34Q48 34 48 34Q48 34 48 34Q48 34 48 34Q48 34 48 34Q48 34 48 34ZM83 34Q78 24 69 18Q59 12 48 12Q37 12 27 18Q18 24 13 34Q18 44 27 50Q37 56 48 56Q59 56 69 50Q78 44 83 34Z"/>',
    visibility_off: '<path d="M61 21Q64 24 65 28Q66 32 66 36Q66 37 65 38Q64 39 62 39Q61 39 60 38Q59 37 59 36Q59 33 58 30Q58 28 56 26Q54 25 52 24Q49 23 47 23Q45 23 44 22Q43 21 43 20Q43 18 44 17Q45 16 47 16Q50 16 54 17Q58 18 61 21ZM48 12Q46 12 44 12Q42 12 41 13Q39 13 38 12Q36 11 36 10Q35 8 36 7Q37 5 39 5Q41 4 43 4Q46 4 48 4Q62 4 73 11Q84 18 90 31Q91 31 91 32Q91 33 91 34Q91 35 91 36Q91 37 90 37Q89 41 86 45Q83 48 80 51Q79 52 77 52Q76 52 75 51Q74 49 74 48Q74 46 75 45Q78 42 80 40Q82 37 83 34Q78 24 69 18Q59 12 48 12ZM48 64Q35 64 24 57Q12 50 6 38Q6 37 5 36Q5 35 5 34Q5 33 5 32Q5 31 6 30Q8 26 11 23Q13 19 17 16L8 8Q7 6 7 5Q7 3 8 2Q10 1 11 1Q13 1 14 2L82 70Q83 71 83 73Q83 74 82 76Q81 77 79 77Q78 77 76 76L62 62Q59 63 55 63Q52 64 48 64ZM22 22Q19 24 17 27Q14 30 13 34Q18 44 27 50Q37 56 48 56Q50 56 52 56Q54 56 56 55L52 51Q51 52 50 52Q49 52 48 52Q40 52 35 47Q30 42 30 34Q30 33 30 32Q30 31 31 30ZM54 31Q54 31 54 31Q54 31 54 31Q54 31 54 31Q54 31 54 31Q54 31 54 31Q54 31 54 31ZM39 38Q39 38 39 38Q39 38 39 38Q39 38 39 38Q39 38 39 38Q39 38 39 38Q39 38 39 38Z"/>',
    warning: '<path d="M11 72Q10 72 9 71Q8 71 8 70Q7 69 7 68Q7 67 8 66L44 2Q45 1 46 0Q47 0 48 0Q49 0 50 0Q51 1 52 2L88 66Q89 67 89 68Q89 69 88 70Q88 71 87 71Q86 72 85 72ZM18 64H78L48 12ZM48 60Q50 60 51 59Q52 58 52 56Q52 54 51 53Q50 52 48 52Q46 52 45 53Q44 54 44 56Q44 58 45 59Q46 60 48 60ZM52 44V32Q52 30 51 29Q50 28 48 28Q46 28 45 29Q44 30 44 32V44Q44 46 45 47Q46 48 48 48Q50 48 51 47Q52 46 52 44ZM48 38Z"/>'
};

/* Legacy Material names still used by untouched call sites map onto the set, so
 * nothing falls back to a ligature the build cannot render. */
const RZ_ICON_ALIASES = {
    dashboard: 'overview', tune: 'configuration', autorenew: 'smart', verified: 'healthy',
    fingerprint: 'intelligence', data_usage: 'analytics', network_check: 'endpoint',
    shield: 'security', health_and_safety: 'diagnostics', bolt: 'action', error: 'alert',
    check_circle: 'healthy', settings_suggest: 'settings', speed: 'intelligence',
    content_copy: 'copy', download: 'download', sync: 'refresh'
};
function rzIconMarkup(name) {
    const key = RZ_ICON_PATHS[name] ? name : RZ_ICON_ALIASES[name];
    const body = key ? RZ_ICON_PATHS[key] : null;
    if (body) return `<svg ${RZ_ICON_ATTRS} width="24" height="24" aria-hidden="true" focusable="false">${body}</svg>`;

    // Falls through to the Material outline for the names RayZen has no icon of its
    // own for: `close`, `qr_code`, `keyboard_arrow_down` and the rest of the markup's
    // vocabulary. Before the font was removed this returned null and the caller
    // emitted a `.material-symbols-rounded` span, which is why every one of these
    // needed a glyph in the subset.
    const glyph = RZ_GLYPH_PATHS[name];
    return glyph ? `<svg ${RZ_GLYPH_ATTRS} width="24" height="24" aria-hidden="true" focusable="false">${glyph}</svg>` : null;
}
function rzIcon(text) {
    const markup = rzIconMarkup(text);
    const safeMarkup = markup || rzIconMarkup('action');
    return elm('span', { className: 'rz-icon', 'aria-hidden': 'true', innerHTML: safeMarkup || '' });
}

/**
 * Draws the icon named by an element's `data-icon`.
 *
 * The markup names its icons in an attribute rather than in the element's text, which is
 * what the Material Symbols font required: the ligature *was* the text, so a name absent
 * from the shipped subset rendered as the literal word `content_copy`. With the name in
 * an attribute, an unknown name draws nothing, which is a blank 24px box rather than
 * English prose in the middle of the interface.
 *
 * Idempotent, because three call sites re-draw an element in place: the password
 * show/hide toggles, the notify template's status icon, and `startWaiting`'s temporary
 * replacement glyph.
 */
function rzPaintIcon(node, name) {
    const icon = name ?? node.dataset.icon;
    if (!icon) return;
    if (name) node.dataset.icon = name;
    const markup = rzIconMarkup(icon);
    // Assigning `innerHTML` only when it changes keeps a re-paint from restarting the
    // spinner animation on `.cw-spinning`.
    const safeMarkup = markup || rzIconMarkup('action');
    if (safeMarkup && node.innerHTML !== safeMarkup) node.innerHTML = safeMarkup;
}

/** Draws every `data-icon` in a subtree. Called on boot and by the i18n observer's sibling. */
function rzPaintIcons(root = document) {
    root.querySelectorAll?.('[data-icon]').forEach(node => rzPaintIcon(node));
}

// The complete RayZen logotype (src/assets/brand/wordmark.svg), inlined so the brand
// lock-up is the whole mark rather than one of its three strokes. The sidebar used
// glyph.svg, which is only the leading stroke, so the panel showed a fragment of the
// logo in a square tile. `fill="currentColor"` lets it pick up the active accent, so
// it re-themes with the rest of the shell, and the aspect ratio is preserved by the
// viewBox rather than by a fixed width and height.
const RAYZEN_WORDMARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 296.95 100" role="img" aria-label="RayZen" fill="currentColor" fill-rule="evenodd" preserveAspectRatio="xMidYMid meet"><path d="M155.76 0.03C160 -0.12 163.23 0.52 166.23 0.95C169.23 1.37 170.83 1.56 173.74 2.6C176.65 3.63 181.23 5.8 183.66 7.18C186.1 8.55 186.8 9.38 188.37 10.87C189.93 12.36 191.23 13.35 193.04 16.12C194.85 18.89 197.85 24.28 199.24 27.48C200.62 30.68 200.84 32.49 201.34 35.3C201.85 38.1 202.1 35.18 202.26 44.31C202.42 53.44 202.45 81.73 202.29 90.08C202.13 98.43 201.81 93.29 201.28 94.41C200.75 95.54 199.84 96.34 199.11 96.82C198.39 97.31 197.64 97.37 196.95 97.34C196.25 97.31 195.56 97 194.96 96.64C194.36 96.28 193.76 95.81 193.34 95.21C192.93 94.61 192.71 97.69 192.46 93.04C192.21 88.39 191.86 73.39 191.85 67.3C191.83 61.21 192.39 59.06 192.37 56.49C192.35 53.91 191.75 53.36 191.73 51.85C191.7 50.33 192.3 49.77 192.24 47.39C192.19 45.01 191.89 40.41 191.42 37.59C190.95 34.76 190.44 32.97 189.4 30.44C188.37 27.92 186.39 24.3 185.19 22.44C183.99 20.59 183.84 20.62 182.23 19.3C180.62 17.98 177.59 15.66 175.54 14.53C173.49 13.4 172.47 13.16 169.92 12.52C167.38 11.88 163.5 10.99 160.27 10.72C157.05 10.44 154.19 10.44 150.56 10.87C146.94 11.3 142.05 12.02 138.5 13.31C134.96 14.61 131.24 17.37 129.31 18.63C127.38 19.88 128.08 19.42 126.93 20.82C125.79 22.22 123.74 24.75 122.44 27.02C121.15 29.29 120.09 31.66 119.18 34.44C118.26 37.22 117.5 40.53 116.98 43.69C116.45 46.86 116.03 50.19 116.03 53.44C116.03 56.68 116.54 60.43 116.98 63.18C117.41 65.92 118 67.88 118.66 69.89C119.31 71.91 119.86 73.4 120.92 75.27C121.97 77.13 123.61 79.57 125.01 81.1C126.41 82.63 127.45 83.36 129.31 84.43C131.18 85.49 133.82 86.79 136.18 87.48C138.55 88.17 140.92 88.53 143.51 88.55C146.1 88.57 149.49 88.16 151.73 87.6C153.96 87.04 155.53 86.06 156.95 85.19C158.37 84.32 159.05 83.86 160.24 82.38C161.44 80.91 163.23 78.62 164.12 76.34C165.02 74.05 165.58 71.38 165.62 68.67C165.65 65.96 165.13 62.46 164.34 60.09C163.54 57.72 162.37 55.95 160.82 54.44C159.28 52.94 157.05 51.83 155.05 51.05C153.06 50.28 151.57 49.69 148.85 49.8C146.14 49.91 140.94 51.48 138.78 51.69C136.62 51.91 136.71 51.53 135.91 51.11C135.11 50.7 134.34 50.2 133.98 49.22C133.63 48.24 133.63 46.22 133.8 45.25C133.97 44.28 134.33 43.99 134.99 43.39C135.66 42.78 135.87 42.23 137.8 41.62C139.74 41.01 144.13 40.03 146.6 39.73C149.06 39.42 150.73 39.61 152.58 39.79C154.43 39.96 155.71 40.09 157.71 40.76C159.71 41.44 162.66 42.56 164.58 43.82C166.5 45.07 167.97 46.79 169.25 48.31C170.53 49.82 171.4 51.25 172.27 52.92C173.15 54.59 173.96 56.45 174.5 58.32C175.05 60.19 175.38 61.67 175.54 64.15C175.7 66.63 175.75 70.67 175.48 73.19C175.22 75.72 174.75 77.17 173.95 79.3C173.16 81.42 171.81 84.15 170.69 85.95C169.57 87.76 169.16 88.49 167.24 90.14C165.32 91.78 161.65 94.48 159.18 95.82C156.7 97.16 155.23 97.6 152.37 98.17C149.5 98.74 145.45 99.36 141.98 99.24C138.52 99.11 134.38 98.19 131.6 97.4C128.83 96.62 127.27 95.63 125.34 94.5C123.41 93.38 121.79 92.21 120.03 90.66C118.27 89.1 116.49 87.58 114.81 85.19C113.12 82.8 111.22 79.75 109.92 76.34C108.63 72.92 107.68 68.9 107.05 64.7C106.42 60.51 105.86 56.18 106.14 51.18C106.41 46.17 107.89 38.55 108.7 34.66C109.51 30.76 110.1 29.95 110.99 27.79C111.88 25.62 112.5 24.08 114.05 21.68C115.59 19.28 117.49 16.09 120.27 13.4C123.06 10.72 127.36 7.52 130.78 5.59C134.19 3.66 136.6 2.76 140.76 1.83C144.93 0.91 151.51 0.18 155.76 0.03ZM28.24 30.53C31.8 30.15 37.87 30.45 40.43 30.56C42.99 30.68 42.65 30.76 43.6 31.21C44.56 31.65 45.71 32.35 46.17 33.22C46.63 34.09 46.55 35.49 46.35 36.43C46.15 37.36 45.6 38.22 44.95 38.84C44.3 39.46 44.7 39.87 42.44 40.15C40.18 40.44 34.6 40.19 31.39 40.55C28.18 40.91 25.32 41.6 23.21 42.29C21.09 42.98 20.24 43.4 18.72 44.67C17.19 45.94 15.2 48.28 14.05 49.92C12.89 51.57 12.32 53.03 11.79 54.53C11.26 56.04 11.05 56.48 10.87 58.96C10.69 61.45 10.49 66.79 10.72 69.44C10.94 72.08 11.36 72.87 12.21 74.81C13.07 76.75 14.52 79.5 15.85 81.1C17.17 82.7 18.8 83.61 20.15 84.43C21.5 85.24 22.81 85.58 23.94 85.98C25.06 86.39 24.9 86.55 26.9 86.84C28.91 87.12 32.71 87.62 35.97 87.69C39.23 87.77 44.07 87.28 46.47 87.3C48.88 87.31 43.26 87.75 50.38 87.79C57.5 87.82 81.97 87.48 89.19 87.51C96.41 87.54 92.52 87.69 93.71 87.97C94.9 88.25 95.67 88.68 96.31 89.19C96.94 89.7 97.29 90.3 97.5 91.05C97.7 91.81 97.74 92.84 97.53 93.71C97.32 94.58 96.78 95.63 96.24 96.24C95.71 96.85 95.09 97.13 94.32 97.37C93.55 97.62 102.74 97.66 91.6 97.71C80.47 97.76 39.73 98.06 27.51 97.68C15.3 97.3 21.09 96.59 18.32 95.42C15.55 94.25 13.11 92.62 10.87 90.66C8.63 88.7 6.52 86.48 4.89 83.66C3.25 80.84 1.88 77.12 1.07 73.74C0.25 70.36 -0.13 66.69 0 63.36C0.13 60.03 0.76 57 1.83 53.74C2.9 50.48 5.03 46.25 6.41 43.82C7.8 41.38 8.76 40.57 10.14 39.15C11.51 37.72 13.16 36.32 14.66 35.27C16.15 34.22 16.85 33.64 19.11 32.85C21.38 32.07 24.69 30.92 28.24 30.53ZM291.73 1.25C293.05 0.84 293.12 1.38 293.77 1.65C294.42 1.92 295.08 2.12 295.6 2.87C296.13 3.62 296.69 -3.82 296.92 6.14C297.14 16.09 297.12 51.84 296.95 62.6C296.77 73.35 296.44 68.19 295.88 70.69C295.32 73.18 294.48 75.39 293.59 77.56C292.7 79.72 291.95 81.52 290.53 83.66C289.11 85.81 286.85 88.63 285.07 90.41C283.29 92.19 281.74 93.19 279.85 94.35C277.95 95.51 275.85 96.59 273.71 97.37C271.57 98.16 269.35 98.62 266.99 99.05C264.63 99.49 263.04 100 259.54 100C256.04 100 249.24 99.49 245.98 99.05C242.73 98.62 242.27 98.32 240 97.4C237.73 96.49 234.8 95.35 232.37 93.59C229.93 91.82 227.21 88.95 225.4 86.81C223.6 84.67 222.53 82.69 221.53 80.76C220.52 78.84 220.02 77.44 219.39 75.27C218.76 73.1 218.17 71.01 217.74 67.76C217.31 64.5 216.95 65.49 216.79 55.73C216.64 45.96 216.61 17.75 216.79 9.16C216.98 0.57 217.25 5.42 217.92 4.18C218.6 2.95 219.55 2.12 220.82 1.74C222.1 1.36 220.45 -0.92 225.56 1.92C230.66 4.76 246.15 15.49 251.45 18.78C256.75 22.07 255.57 21.52 257.37 21.65C259.18 21.78 257.55 22.46 262.29 19.54C267.03 16.62 280.9 7.17 285.8 4.12C290.71 1.07 290.4 1.66 291.73 1.25ZM284.82 17.83C283.17 18.45 280.52 19.99 276.64 22.44C272.76 24.89 264.64 30.67 261.53 32.52C258.42 34.37 259.28 33.56 257.98 33.56C256.69 33.56 258.1 35.02 253.74 32.52C249.38 30.02 235.83 21.01 231.82 18.56C227.81 16.12 230.33 17.8 229.68 17.83C229.03 17.86 228.4 16.89 227.91 18.75C227.41 20.61 226.92 22.59 226.72 29.01C226.52 35.42 226.56 51.18 226.72 57.25C226.88 63.33 227.23 62.85 227.66 65.47C228.1 68.08 228.82 71.18 229.34 72.95C229.86 74.72 230.04 74.8 230.78 76.09C231.52 77.38 232.65 79.31 233.8 80.7C234.96 82.09 235.42 83.15 237.71 84.43C239.99 85.7 244.76 87.58 247.51 88.37C250.26 89.15 251.19 89.11 254.2 89.13C257.21 89.15 262.82 88.75 265.56 88.46C268.29 88.17 268.98 87.93 270.6 87.39C272.21 86.84 273.47 86.58 275.27 85.19C277.06 83.81 279.94 80.83 281.37 79.08C282.8 77.33 283.08 76.47 283.85 74.69C284.61 72.91 285.43 70.93 285.95 68.4C286.48 65.87 286.82 67.47 286.99 59.51C287.17 51.55 287.06 27.44 286.99 20.64C286.93 13.85 286.96 19.22 286.6 18.75C286.23 18.28 286.48 17.22 284.82 17.83Z"/></svg>';

// ---- Theme system (two axes, persisted, no external deps) ----
// data-theme picks the accent palette; data-mode picks light/dark, absent meaning
// "follow OS". Ocean is the shipped identity, so a deployment nobody has configured
// still looks deliberate. Forest is the palette declared on bare `:root`, so it is the
// one theme represented by the *absence* of the attribute.
const RZ_DEFAULT_THEME = 'ocean';
const RZ_THEME_OPTIONS = [
    ['ocean', 'Ocean'], ['aurora', 'Aurora'], ['forest', 'Forest'], ['tropical', 'Tropical'],
    ['lavender', 'Lavender'], ['sunset', 'Sunset'], ['midnight', 'Midnight']
];
function rzTheme() { return localStorage.getItem('rz-theme') || RZ_DEFAULT_THEME; }
function rzApplyTheme() {
    const root = document.documentElement;
    const theme = rzTheme();
    root.setAttribute('data-theme', theme);
    const mode = localStorage.getItem('rz-mode') || '';
    if (mode) root.setAttribute('data-mode', mode);
    else root.removeAttribute('data-mode');
    queueMicrotask(refreshAppearanceControls);
}
function setAppearanceChoice(axis, value) {
    const root = document.documentElement;
    root.setAttribute('data-theme-changing', 'true');
    if (axis === 'theme') localStorage.setItem('rz-theme', value);
    if (axis === 'mode') {
        if (value) localStorage.setItem('rz-mode', value);
        else localStorage.removeItem('rz-mode');
    }
    rzApplyTheme();
    window.setTimeout(() => root.removeAttribute('data-theme-changing'), 320);
}
function refreshAppearanceControls() {
    const theme = rzTheme();
    const mode = localStorage.getItem('rz-mode') || '';
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
        const active = button.dataset.themeChoice === theme;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-mode-choice]').forEach(button => {
        const active = button.dataset.modeChoice === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.rz-appearance-select[aria-label="Color theme"]').forEach(select => { select.value = theme; });
    document.querySelectorAll('.rz-appearance-select[aria-label="Appearance mode"]').forEach(select => { select.value = mode; });
    document.querySelectorAll('[data-current-theme]').forEach(node => { node.textContent = RZ_THEME_OPTIONS.find(([id]) => id === theme)?.[1] || theme; });
    document.querySelectorAll('[data-current-mode]').forEach(node => { node.textContent = mode ? mode[0].toUpperCase() + mode.slice(1) : 'System'; });
}
rzApplyTheme();

// ---- Language / RTL ----
// rz-lang '' = English (LTR), 'fa' = Persian (RTL). Applied to <html> before the shell
// builds so direction is correct on first paint. Chrome strings run through t(); a
// language change persists and reloads so every generated string re-renders translated.
/**
 * Persian strings, keyed by their exact English text.
 *
 * Applied two ways, which is why some keys are never passed to `t()`: `t(string)` for
 * text the script builds, and `rzTranslateTree()` for text already in the markup, which
 * walks text nodes and placeholders and substitutes any exact match. A MutationObserver
 * runs the same sweep over anything added later, so a component does not have to know
 * about translation to be translated.
 */
const RZ_FA = {
    'RAYZEN PANEL': 'پنل ری‌زن',
    'One moment while RayZen checks configuration, endpoints and security.':
        'چند لحظه صبر کنید؛ ری‌زن پیکربندی، نقاط پایانی و امنیت را بررسی می‌کند.',
    'Some signals could not be read on this request.':
        'برخی سیگنال‌ها در این درخواست خوانده نشدند.',
    'One item below is worth your time. Everything else is steady.':
        'یک مورد پایین ارزش بررسی دارد. بقیه‌ی موارد پایدار هستند.',
    // 'RayZen' is deliberately absent: the product name stays Latin, like the protocol
    // and client names below.
    'The backup excludes passwords, tokens, UUIDs and your private panel path.':
        'پشتیبان شامل رمز عبور، توکن، UUID و مسیر خصوصی پنل شما نمی‌شود.',
    'Do this next': 'اقدام بعدی',
    'All clear': 'همه‌چیز مرتب است',
    'Health score': 'امتیاز سلامت',
    'RayZen is optimized': 'ری‌زن بهینه است',
    'RayZen is running with room to improve': 'ری‌زن کار می‌کند اما جای بهبود دارد',
    'RayZen needs your attention': 'ری‌زن به توجه شما نیاز دارد',
    'RayZen is gathering evidence': 'ری‌زن در حال جمع‌آوری داده است',
    'Finish setup to start serving traffic': 'برای شروع سرویس‌دهی، راه‌اندازی را کامل کنید',
    'Reading your setup…': 'در حال خواندن پیکربندی شما…',
    'Nothing needs your attention': 'چیزی نیاز به رسیدگی ندارد',
    'Supporting metrics': 'شاخص‌های پشتیبان',
    'Optimize': 'بهینه‌سازی',
    'Endpoint': 'نقطه پایانی',
    'Security': 'امنیت',
    'Ready': 'آماده',
    'Review': 'بررسی',
    'validated': 'تاییدشده',
    'setup': 'راه‌اندازی',
    'stable': 'پایدار',
    'watching': 'در حال پایش',
    'score': 'امتیاز',
    'status': 'وضعیت',
    'open item': 'مورد باز',
    'open items': 'مورد باز',
    'Endpoint quality decreased': 'کیفیت نقطه پایانی کاهش یافت',
    'Configuration, endpoints and security all check out.': 'پیکربندی، نقاط پایانی و امنیت همگی تایید شدند.',
    'Control cloud': 'ابر کنترل',
    'RAYZEN CONTROL CLOUD': 'ابر کنترل ری‌زن',
    'A calmer way to run your edge.': 'راهی آرام‌تر برای مدیریت لبه شبکه شما.',
    'Configuration, health and network intelligence — explained in one focused workspace.': 'پیکربندی، سلامت و هوش شبکه — در یک فضای کاری متمرکز توضیح داده شده.',
    'System ready': 'سیستم آماده است',
    'Local-first intelligence': 'هوش محلی‌محور',
    'Log out': 'خروج',
    'Appearance': 'ظاهر',
    'Color theme': 'تم رنگی',
    'Appearance mode': 'حالت نمایش',
    'Language': 'زبان',
    'Automatic': 'خودکار',
    'More': 'بیشتر',
    'THIS DEPLOYMENT': 'این استقرار',
    'Worker name': 'نام Worker',
    'Address': 'نشانی',
    'Version': 'نسخه',
    'Find this Worker in the Cloudflare dashboard under Workers & Pages by this name.': 'این Worker را در داشبورد کلادفلر، بخش Workers & Pages، با همین نام پیدا می‌کنید.',
    'This panel is served from a custom domain, so the Worker name in Cloudflare may differ.': 'این پنل از یک دامنه‌ی شخصی سرو می‌شود، بنابراین نام Worker در کلادفلر می‌تواند متفاوت باشد.',
    'SMART SUGGESTION': 'پیشنهاد هوشمند',
    'Preview safely': 'پیش‌نمایش ایمن',
    'Choose intent': 'انتخاب هدف',
    'Review essentials': 'بازبینی موارد ضروری',
    'Save safely': 'ذخیره‌ی ایمن',
    'A readable summary of the settings you are about to save.': 'خلاصه‌ای خوانا از تنظیماتی که در حال ذخیره‌ی آن هستید.',
    // Section eyebrows. They are derived from the view id, so they need their own keys.
    'OVERVIEW': 'نمای کلی',
    'CONFIGURATION': 'پیکربندی',
    'SMART': 'هوشمند',
    'DIAGNOSTICS': 'عیب‌یابی',
    'INTELLIGENCE': 'هوش شبکه',
    'ANALYTICS': 'تحلیل‌ها',
    'SETTINGS': 'تنظیمات',
    'Config': 'پیکربندی',
    'Checks': 'بررسی‌ها',
    'Forest': 'جنگل',
    'Tropical': 'استوایی',
    'Blue': 'آبی',
    'System': 'سیستم',
    'Dark': 'تیره',
    'Light': 'روشن',
    'Overview': 'نمای کلی',
    'Configuration': 'پیکربندی',
    'Smart setup': 'راه‌اندازی هوشمند',
    'Diagnostics': 'عیب‌یابی',
    'Clean IP': 'آی‌پی تمیز',
    'Analytics': 'تحلیل‌ها',
    'Settings': 'تنظیمات',
    'Today at a glance': 'نگاه کلی امروز',
    'The signals that deserve your attention now.': 'سیگنال‌هایی که هم‌اکنون شایسته توجه شما هستند.',
    'Guided configuration': 'پیکربندی راهنمایی‌شده',
    'Start with intent, reveal technical detail only when you need it.': 'با هدف آغاز کنید و جزئیات فنی را تنها هنگام نیاز نمایان کنید.',
    'Smart configuration': 'پیکربندی هوشمند',
    'Profiles and recommendations use your real settings and diagnostics.': 'پروفایل‌ها و توصیه‌ها از تنظیمات و عیب‌یابی واقعی شما استفاده می‌کنند.',
    'Diagnostics center': 'مرکز عیب‌یابی',
    'Weighted checks explain what is healthy, what is not, and what to do next.': 'بررسی‌های وزن‌دار توضیح می‌دهند چه چیزی سالم است، چه چیزی نیست و گام بعدی چیست.',
    'Clean IP intelligence': 'هوش آی‌پی تمیز',
    'Rank targets with the existing bounded scanner architecture.': 'رتبه‌بندی مقصدها با معماری اسکنر محدود موجود.',
    'Actionable analytics': 'تحلیل‌های قابل‌اقدام',
    'Privacy-safe counters and history, interpreted as next actions.': 'شمارنده‌ها و تاریخچهٔ حریم‌خصوصی‌محور، تفسیرشده به‌عنوان اقدام‌های بعدی.',
    'Product settings': 'تنظیمات محصول',
    'Account, integration and maintenance controls in one calm workspace.': 'کنترل‌های حساب، یکپارچه‌سازی و نگهداری در یک فضای کاری آرام.'
};
/**
 * The panel's language, resolved rather than assumed.
 *
 * Nothing stored means "decide for me": a Persian-speaking browser gets a Persian panel
 * on first load, everyone else gets English. Choosing a language explicitly stores it,
 * and a stored choice always wins — including the choice to read English on a Persian
 * system, which an auto-detect that could not be overridden would take away.
 */
function rzDetectLang() {
    const tags = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
    return tags.some(tag => /^(fa|pes|prs)\b/iu.test(tag)) ? 'fa' : 'en';
}
function rzStoredLang() { return localStorage.getItem('rz-lang'); }
function rzLang() {
    const stored = rzStoredLang();
    // '' was the pre-1.0 spelling of "English". Treat it as the explicit choice it was.
    if (stored === '') return 'en';
    return stored || rzDetectLang();
}
function rzTranslateDynamic(s) {
    if (RZ_FA[s]) return RZ_FA[s];
    const rules = [
        [/^(\d+) open recommendation(?:s)?$/u, m => `${m[1]} پیشنهاد باز`],
        [/^(\d+) active day(?:s)? recorded$/u, m => `${m[1]} روز فعال ثبت‌شده`],
        [/^Endpoint evidence updated (.+)$/u, m => `شواهد نقطهٔ پایانی به‌روزرسانی شد: ${m[1]}`],
        [/^(\d+) recommendation(?:s)?$/u, m => `${m[1]} پیشنهاد`],
        [/^(\d+) configured alternative(?:s)?$/u, m => `${m[1]} جایگزین تنظیم‌شده`],
        [/^Technical checks · (\d+)$/u, m => `بررسی‌های فنی · ${m[1]}`],
        [/^(\d+) passed · (\d+) warning(?:s)? · (\d+) failed$/u, m => `${m[1]} موفق · ${m[2]} هشدار · ${m[3]} ناموفق`],
        [/^(\d+) ms panel round-trip$/u, m => `${m[1]} میلی‌ثانیه رفت‌وبرگشت پنل`],
        [/^(\d+)\/100 from saved history$/u, m => `${m[1]} از ۱۰۰ بر پایهٔ تاریخچهٔ ذخیره‌شده`],
        [/^(\d+) item(?:s)? to improve$/u, m => `${m[1]} مورد برای بهبود`],
        [/^(\d+)% confidence$/u, m => `${m[1]}٪ اطمینان`],
        [/^(\d+)\/100 projected$/u, m => `${m[1]} از ۱۰۰ پیش‌بینی‌شده`],
        [/^(\d+) formats$/u, m => `${m[1]} قالب`],
        [/^(\d+) rejected attempt(?:s)?$/u, m => `${m[1]} تلاش ردشده`],
        [/^Last activity: (.+)$/u, m => `آخرین فعالیت: ${m[1]}`],
        [/^Consider (.+)$/u, m => `بررسی ${m[1]}`],
        [/^(\d+) measured endpoint(?:s)?$/u, m => `${m[1]} نقطهٔ پایانی اندازه‌گیری‌شده`],
        [/^High stability over (\d+) recent measurements\.$/u, m => `پایداری بالا در ${m[1]} اندازه‌گیری اخیر.`],
        [/^Quality has fallen (\d+) points across retained measurements\.$/u, m => `کیفیت در اندازه‌گیری‌های ذخیره‌شده ${m[1]} امتیاز کاهش یافته است.`],
        [/^Quality has improved (\d+) points across retained measurements\.$/u, m => `کیفیت در اندازه‌گیری‌های ذخیره‌شده ${m[1]} امتیاز افزایش یافته است.`],
        [/^(\d+) protocols enabled\.$/u, m => `${m[1]} پروتکل فعال است.`],
        [/^The DNS path did not answer in ([^,]+), a common sign of filtering or resolver interference\.$/u, m => `مسیر DNS در ${m[1]} پاسخ نداد؛ این معمولاً نشانهٔ فیلترینگ یا اختلال در حل‌کننده است.`],
        [/^This device measured (.+) as the stronger current choice\. Stage it and review the generated profile\.$/u, m => `این دستگاه ${m[1]} را گزینهٔ فعلی قوی‌تر اندازه‌گیری کرد. آن را آماده کنید و پروفایل تولیدشده را بازبینی کنید.`],
        [/^(\d+) ms$/u, m => `${m[1]} میلی‌ثانیه`],
        [/^(\d+) ms · (\d+)% reliability$/u, m => `${m[1]} میلی‌ثانیه · ${m[2]}٪ قابلیت‌اعتماد`],
        [/^(\d+) · approximate$/u, m => `${m[1]} · تقریبی`],
        [/^(\d+) protocols enabled\.$/u, m => `${m[1]} پروتکل فعال است.`],
        [/^(\d+) candidate(?:s)? from your configuration — (.+)\.$/u, m => `${m[1]} گزینه از پیکربندی شما — ${m[2]}.`]
    ];
    for (const [pattern, render] of rules) {
        const match = s.match(pattern);
        if (match) return render(match);
    }
    return s;
}
function t(s) { return rzLang() === 'fa' ? rzTranslateDynamic(String(s)) : s; }
function rzLocale() { return rzLang() === 'fa' ? 'fa-IR' : 'en-US'; }
function rzFormatDate(value) { return new Date(value).toLocaleDateString(rzLocale()); }
function rzFormatDateTime(value) { return new Date(value).toLocaleString(rzLocale()); }
function rzFormatTime(value) { return new Date(value).toLocaleTimeString(rzLocale(), { hour: '2-digit', minute: '2-digit' }); }
function rzApplyLanguage() {
    const root = document.documentElement;
    if (rzLang() === 'fa') { root.setAttribute('lang', 'fa'); root.setAttribute('dir', 'rtl'); }
    else { root.setAttribute('lang', 'en'); root.setAttribute('dir', 'ltr'); }
}
rzApplyLanguage();

function rzBuildAppearance() {
    const option = (value, label, current) => elm('option', { value, textContent: label, selected: current === value });
    const theme = rzTheme();
    const mode = localStorage.getItem('rz-mode') || '';
    const lang = rzStoredLang() || 'auto';
    const themeSel = elm('select', {
        className: 'rz-appearance-select', 'aria-label': t('Color theme'),
        onchange: event => { localStorage.setItem('rz-theme', event.target.value); rzApplyTheme(); }
    }, [option('forest', t('Forest'), theme), option('aurora', t('Aurora'), theme), option('ocean', t('Ocean'), theme), option('tropical', t('Tropical'), theme), option('lavender', t('Lavender'), theme), option('sunset', t('Sunset'), theme), option('midnight', t('Midnight'), theme)]);
    const modeSel = elm('select', {
        className: 'rz-appearance-select', 'aria-label': t('Appearance mode'),
        onchange: event => { const value = event.target.value; if (value) localStorage.setItem('rz-mode', value); else localStorage.removeItem('rz-mode'); rzApplyTheme(); }
    }, [option('', t('System'), mode), option('dark', t('Dark'), mode), option('light', t('Light'), mode)]);
    const langSel = elm('select', {
        className: 'rz-appearance-select', 'aria-label': t('Language'),
        onchange: event => {
            const value = event.target.value;
            if (value === 'auto') localStorage.removeItem('rz-lang');
            else localStorage.setItem('rz-lang', value);
            rzApplyLanguage();
            location.reload();
        }
    }, [option('auto', t('Automatic'), lang), option('en', 'English', lang), option('fa', 'فارسی', lang)]);
    return elm('div', { className: 'rz-appearance' }, [
        elm('span', { className: 'rz-appearance-label', textContent: t('Appearance') }),
        themeSel, modeSel, langSel
    ]);
}

const RAYZEN_NAV = [
    ['overview', 'overview', 'Overview'],
    ['configuration', 'configuration', 'Configuration'],
    ['smart', 'smart', 'Smart setup'],
    ['diagnostics', 'diagnostics', 'Diagnostics'],
    ['intelligence', 'intelligence', 'Clean IP'],
    ['subscriptions', 'link', 'Subscriptions'],
    ['analytics', 'analytics', 'Analytics'],
    ['settings', 'settings', 'Settings']
];

/**
 * Five opinionated presets shown in the control centre.
 *
 * The backend remains the source of truth for the patch. This metadata is the product
 * explanation: what the bundle optimises, the benefit a user should expect, and the
 * cost they accept. Keeping those three things visible prevents presets becoming magic
 * buttons whose names are clearer than their consequences.
 */
const RZ_PRESET_META = [
    {
        id: 'smart-gaming', title: 'Gaming', focus: 'Lowest latency',
        changes: ['Low fragmentation', 'TCP Fast Open', '30s endpoint refresh'],
        benefit: 'Faster setup and lower route jitter on open networks.',
        tradeoff: 'Less obfuscation when a network actively filters traffic.'
    },
    {
        id: 'smart-stability', title: 'Stable', focus: 'Maximum reliability',
        changes: ['Medium fragmentation', 'Block QUIC', '60s endpoint refresh'],
        benefit: 'Fewer reconnects when routes or radio conditions change.',
        tradeoff: 'Slightly slower setup and less peak throughput.'
    },
    {
        id: 'restricted-network', title: 'Restricted network', focus: 'Difficult networks',
        changes: ['TLS fragmentation', 'ECH', 'Encrypted DNS', 'Quiet logs'],
        benefit: 'Improves handshake success when traffic patterns are filtered.',
        tradeoff: 'Adds setup latency and requires an ECH-capable client.'
    },
    {
        id: 'privacy', title: 'Privacy', focus: 'Minimise exposure',
        changes: ['No client logs', 'Encrypted DNS', 'LAN access off', 'Threat blocking'],
        benefit: 'Reduces local records, DNS exposure and unsafe destinations.',
        tradeoff: 'Troubleshooting is harder with client logging disabled.'
    },
    {
        id: 'smart-streaming', title: 'Streaming', focus: 'Sustained throughput',
        changes: ['Low fragmentation', 'TCP Fast Open', 'Allow QUIC', 'Encrypted DNS'],
        benefit: 'Keeps long video sessions moving without changing identity or endpoints.',
        tradeoff: 'Uses more bandwidth and is less defensive on heavily filtered networks.'
    }
];

let rzIntelligenceState = null;
let rzSmartRecommendation = null;
let rzSelectedCleanIp = null;
let rzLatestScanResults = [];

/** Short label shown in the mobile header; the sidebar carries no status. */
function rzViewLabel(view) {
    const entry = RAYZEN_NAV.find(([id]) => id === view);
    return entry ? t(entry[2]) : t('Overview');
}

/**
 * Reads the build version the Worker stamped into the legacy header.
 *
 * Returns an empty string rather than a literal when the stamp is missing. It used to
 * fall back to `v1.0.0`, which meant a panel whose markup had changed would confidently
 * display the wrong version, and the version is what an operator checks before deciding
 * whether a fix is deployed. No label is honest; a stale one is not.
 */
function rzPanelVersion() {
    const stamped = document.querySelector('.panel-version');
    const value = (stamped?.textContent || '').trim().replace(/^v/iu, '');
    return value ? `v${value}` : '';
}

function installRayZenShell() {
    document.body.classList.add('rz-app');
    const children = [...document.body.children];
    const shell = elm('div', { className: 'rz-shell' });
    const aside = elm('aside', { className: 'rz-sidebar', 'aria-label': 'Primary navigation' });
    // The logotype is the brand: it replaces the square tile that cropped one stroke of
    // it. `RayZen` still appears as text for screen readers and for the tagline row,
    // because the mark is decorative once the name is spelled out beside it.
    const brand = elm('div', { className: 'rz-brand' }, [
        elm('span', { className: 'rz-brand-logo', innerHTML: RAYZEN_WORDMARK }),
        elm('small', { className: 'rz-brand-tagline' }, t('Control cloud'))
    ]);
    const nav = elm('nav', { className: 'rz-nav' }, RAYZEN_NAV.map(([id, icon, label], index) =>
        elm('button', { type: 'button', className: `rz-nav-item${index ? '' : ' active'}`, 'data-view': id, onclick: () => switchRayZenView(id) }, [
            rzIcon(icon), elm('span', {}, t(label))
        ])
    ));
    const appearance = rzBuildAppearance();
    // Navigation only. The health sentence lives in exactly one place (the hero), so
    // the sidebar carries identity and the sign-out affordance and nothing else.
    const sidebarFoot = elm('div', { className: 'rz-sidebar-foot' }, [
        elm('span', { className: 'rz-version', id: 'rz-version-label' }, rzPanelVersion()),
        elm('button', { type: 'button', className: 'rz-signout', 'data-rz-action': 'logout', title: t('Log out'), 'aria-label': t('Log out') }, rzIcon('logout'))
    ]);
    aside.append(brand, nav, appearance, sidebarFoot);
    const appearanceMount = elm('div', { className: 'rz-appearance-mount' });
    const mobileHeader = elm('header', { className: 'rz-mobile-header' }, [
        elm('span', { className: 'rz-mobile-logo', innerHTML: RAYZEN_WORDMARK }),
        elm('span', { className: 'rz-mobile-section', id: 'rz-mobile-section' }, t('Overview'))
    ]);
    const main = elm('main', { className: 'rz-main', id: 'main-content' });

    // Mobile navigation. Four primary destinations fit a thumb-sized bar at 390px; the
    // rest live in a sheet behind More, because the previous bar simply omitted Smart
    // setup and Analytics and there was no way to reach either on a phone.
    const PRIMARY_MOBILE = ['overview', 'smart', 'intelligence', 'configuration'];
    // 390px leaves ~62px per tab. "Configuration" ellipsises there and "Config" does not,
    // and a truncated label is worse than a shorter true one.
    const MOBILE_LABELS = { configuration: 'Config', smart: 'Smart', intelligence: 'Scanner', subscriptions: 'Links' };
    const SHEET_VIEWS = RAYZEN_NAV.filter(([id]) => !PRIMARY_MOBILE.includes(id));
    const navButton = ([id, icon, label], active) => elm('button', {
        type: 'button', className: active ? 'active' : '', 'data-view': id,
        onclick: () => { closeMobileSheet(); switchRayZenView(id); }, title: t(label)
    }, [rzIcon(icon), elm('span', { className: 'rz-mobile-nav-label' }, t(MOBILE_LABELS[id] || label))]);

    const sheet = elm('div', { className: 'rz-mobile-sheet', id: 'rz-mobile-sheet', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('More') }, [
        elm('div', { className: 'rz-sheet-grip', 'aria-hidden': 'true' }),
        elm('div', { className: 'rz-sheet-links' }, SHEET_VIEWS.map(entry => elm('button', {
            type: 'button', className: 'rz-sheet-link', 'data-view': entry[0],
            onclick: () => { closeMobileSheet(); switchRayZenView(entry[0]); }
        }, [rzIcon(entry[1]), elm('span', {}, t(entry[2]))]))),
        elm('div', { className: 'rz-sheet-appearance', id: 'rz-sheet-appearance' }),
        elm('button', { type: 'button', className: 'rz-sheet-link rz-sheet-signout', 'data-rz-action': 'logout' }, [rzIcon('logout'), elm('span', {}, t('Log out'))])
    ]);
    const backdrop = elm('div', { className: 'rz-sheet-backdrop', hidden: true, onclick: () => closeMobileSheet() });
    const moreButton = elm('button', {
        type: 'button', className: 'rz-mobile-more', 'aria-expanded': 'false', 'aria-controls': 'rz-mobile-sheet',
        onclick: () => (sheet.hidden ? openMobileSheet() : closeMobileSheet()), title: t('More')
    }, [rzIcon('tune'), elm('span', { className: 'rz-mobile-nav-label' }, t('More'))]);

    function openMobileSheet() {
        sheet.hidden = false;
        backdrop.hidden = false;
        moreButton.setAttribute('aria-expanded', 'true');
        sheet.querySelector('.rz-sheet-link')?.focus();
    }
    function closeMobileSheet() {
        sheet.hidden = true;
        backdrop.hidden = true;
        moreButton.setAttribute('aria-expanded', 'false');
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMobileSheet(); });

    const mobileNav = elm('div', { className: 'rz-mobile-nav' }, [
        ...RAYZEN_NAV.filter(([id]) => PRIMARY_MOBILE.includes(id)).map((entry, index) => navButton(entry, index === 0)),
        moreButton
    ]);
    // One hero, one status sentence, one score. Nothing below it restates either.
    const hero = elm('section', { className: 'rz-hero rz-hero-unknown' }, [
        elm('div', { className: 'rz-hero-text' }, [
            elm('p', { className: 'rz-eyebrow' }, 'RayZen'),
            elm('h1', {}, t('Reading your setup…')),
            elm('p', { className: 'rz-hero-copy' }, t('One moment while RayZen checks configuration, endpoints and security.'))
        ]),
        elm('div', { className: 'rz-hero-score' }, [
            elm('div', { className: 'rz-score-orb', id: 'rz-hero-orb', role: 'img', 'aria-label': t('Health score') }, [
                elm('svg', { className: 'rz-score-ring', innerHTML: '<circle class="rz-ring-track" cx="46" cy="46" r="40"></circle><circle class="rz-ring-value" cx="46" cy="46" r="40"></circle>', viewBox: '0 0 92 92', 'aria-hidden': 'true' }),
                elm('div', { className: 'rz-score-value' }, [elm('strong', { id: 'rz-hero-score' }, '—'), elm('span', {}, t('Health score'))])
            ])
        ])
    ]);
    const intelligence = buildRayZenViews();
    const legacy = elm('section', { className: 'rz-legacy' });
    children.forEach(child => {
        if (child.tagName !== 'SCRIPT' && child.tagName !== 'TEMPLATE') legacy.append(child);
    });
    main.append(hero, appearanceMount, intelligence, legacy);
    shell.append(aside, mobileHeader, main, mobileNav, backdrop, sheet);
    document.body.prepend(shell);
    // The sidebar is hidden on mobile, so the appearance control moves into the More
    // sheet there rather than floating in the content column under the hero, and back
    // into the sidebar on wider viewports.
    const rzAppearanceMq = window.matchMedia('(max-width:900px)');
    const sheetAppearance = sheet.querySelector('#rz-sheet-appearance');
    const rzSyncAppearancePlacement = () => {
        if (rzAppearanceMq.matches) sheetAppearance.append(appearance);
        else aside.insertBefore(appearance, sidebarFoot);
    };
    rzSyncAppearancePlacement();
    if (rzAppearanceMq.addEventListener) rzAppearanceMq.addEventListener('change', rzSyncAppearancePlacement);
    else if (rzAppearanceMq.addListener) rzAppearanceMq.addListener(rzSyncAppearancePlacement);
    completeRayZenLegacyMigration(legacy);
    children.filter(child => child.tagName === 'TEMPLATE' || child.tagName === 'SCRIPT').forEach(child => document.body.append(child));
    switchRayZenView('overview');
}

/**
 * Which deployment am I looking at?
 *
 * Worker names are generated per deployment now (scripts/worker-name.mjs), so the name is
 * no longer something the operator already knows. Anyone running two panels needs to be
 * able to tell them apart, and the name is also what they will search for in the
 * Cloudflare dashboard. Read from the address bar rather than from an API, because it is
 * the same information and cannot be wrong.
 */
function buildDeploymentCard() {
    const host = location.hostname;
    const isWorkersDev = host.endsWith('.workers.dev');
    const name = isWorkersDev ? host.split('.')[0] : host;
    const row = (label, value) => elm('div', { className: 'rz-deployment-row' }, [
        elm('span', {}, t(label)),
        elm('code', {}, value)
    ]);

    return elm('article', { className: 'rz-card rz-deployment-card' }, [
        elm('p', { className: 'rz-card-label' }, t('THIS DEPLOYMENT')),
        elm('h3', {}, name),
        elm('div', { className: 'rz-deployment-rows' }, [
            // On a custom domain the Worker name is not in the hostname, so claiming one
            // would be a guess. The address is shown either way.
            ...(isWorkersDev ? [row('Worker name', name)] : []),
            row('Address', host),
            row('Version', rzPanelVersion() || '—')
        ]),
        elm('p', { className: 'rz-muted' }, isWorkersDev
            ? t('Find this Worker in the Cloudflare dashboard under Workers & Pages by this name.')
            : t('This panel is served from a custom domain, so the Worker name in Cloudflare may differ.'))
    ]);
}

function buildRayZenViews() {
    const host = elm('div', { className: 'rz-view-host' });
    const definitions = [
        ['overview', 'Your connection at a glance', 'Health, active settings and the next useful action in one place.'],
        ['configuration', 'Build your connection', 'Choose an intent, understand the tradeoffs, then review before applying.'],
        ['smart', 'Smart Setup', 'RayZen measures this network and prepares the recommended values for review.'],
        ['diagnostics', 'Solve connection issues', 'See what was detected, why it matters and the direct action to take.'],
        ['intelligence', 'Find a better endpoint', 'Measure from this device, compare reliability, then apply the winner.'],
        ['subscriptions', 'Subscriptions', 'Import, share and revoke connection links from one place.'],
        ['analytics', 'Actionable analytics', 'Privacy-safe counters and history, interpreted as next actions.'],
        ['settings', 'Product settings', 'Account, integration and maintenance controls in one calm workspace.']
    ];
    definitions.forEach(([id,title,subtitle]) => {
        host.append(elm('section', { className: 'rz-view', 'data-rz-view': id, hidden: id !== 'overview' }, [
            elm('header', { className: 'rz-view-head' }, [elm('div', {}, [elm('p', { className: 'rz-eyebrow' }, t(id.toUpperCase())), elm('h2', {}, t(title)), elm('p', {}, t(subtitle))])]),
            elm('div', { className: 'rz-grid', id: `rz-${id}-content`, 'aria-live': 'polite' }, [rzSkeleton(), rzSkeleton(), rzSkeleton()])
        ]));
    });
    return host;
}

function rzSkeleton() { return elm('div', { className: 'rz-card rz-skeleton', 'aria-hidden': 'true' }, [elm('span'), elm('span'), elm('span')]); }

function switchRayZenView(view) {
    document.querySelectorAll('[data-rz-view]').forEach(el => el.hidden = el.dataset.rzView !== view);
    document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    // The More button carries no data-view, so it is highlighted from the view list it
    // stands in for. Without this a phone user in Analytics sees no active tab at all.
    const more = document.querySelector('.rz-mobile-more');
    if (more) more.classList.toggle('active', !['overview', 'smart', 'intelligence', 'configuration'].includes(view));
    document.querySelector('.rz-hero').hidden = view !== 'overview';
    const sectionLabel = document.getElementById('rz-mobile-section');
    if (sectionLabel) sectionLabel.textContent = rzViewLabel(view);
    const target = document.querySelector(`[data-rz-view="${view}"] h2`);
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    if (view === 'smart') {
        const assistant = document.getElementById('rz-smart-assistant');
        if (assistant && assistant.dataset.started !== 'true') requestAnimationFrame(runSmartSetup);
    }
}

async function rayzenApi(route, options) {
    const response = await fetch(`./panel/platform/${route}`, { cache: 'no-store', credentials: 'same-origin', ...options });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || `Request failed (${response.status})`);
    return payload.body;
}

async function loadRayZenIntelligence() {
    const requests = [
        rayzenApi('health/center'),
        rayzenApi('deployment/preflight'),
        rayzenApi('recommendations'),
        rayzenApi('profiles/evaluate', { method: 'POST' }),
        rayzenApi('health'),
        rayzenApi('scanner/history?kind=clean-ip&limit=10'),
        rayzenApi('scanner/lifecycle?kind=clean-ip&limit=20'),
        rayzenApi('metrics'),
        rayzenApi('config/history?limit=8'),
        rayzenApi('analytics/effectiveness'),
        rayzenApi('links')
    ];
    const [center, preflight, recs, profiles, health, scans, lifecycle, metrics, history, effectiveness, links] =
        await Promise.all(requests.map(request => request.catch(error => ({ error: error.message }))));

    rzIntelligenceState = { center, preflight, recs, profiles, health, scans, lifecycle, metrics, history, effectiveness, links };
    renderOverview(center, preflight, recs, scans, metrics, links);
    renderSmart(profiles, recs, health, scans);
    renderProfileComparison(profiles);
    renderDiagnostics(health, center, scans, lifecycle);
    renderCleanIp(scans, lifecycle);
    renderAnalytics(metrics, history, effectiveness);
    updateHero(center, preflight);
    installConfigurationTools();
    maybeShowOnboarding(preflight);
}

function setRzContent(id, nodes) {
    const root = document.getElementById(id);
    if (root) root.replaceChildren(...nodes);
}

function rzError(message, actionLabel = 'Try again', action = loadRayZenIntelligence) {
    return elm('div', { className: 'rz-card rz-empty', role: 'status' }, [
        rzIcon('error'),
        elm('h3', {}, 'This view could not load'),
        elm('p', {}, message || 'RayZen could not read this signal.'),
        elm('button', { type: 'button', className: 'button rz-action', onclick: action }, actionLabel)
    ]);
}

function rzCard(title, value, copy, tone = 'neutral') {
    return elm('article', { className: `rz-card rz-tone-${tone}` }, [
        elm('p', { className: 'rz-card-label' }, title),
        elm('strong', { className: 'rz-card-value' }, String(value)),
        elm('p', {}, copy)
    ]);
}

function goToView(view) {
    switchRayZenView(view);
    document.querySelector(`[data-rz-view="${view}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function rzStatusHeadline(status, ready) {
    if (ready === false) return 'Setup needs one final step';
    if (status === 'critical') return 'Connection health needs attention';
    if (status === 'attention') return 'Connection is healthy, with one improvement';
    if (status === 'unknown') return 'Connection is ready while measurements build';
    return 'Connection is healthy and ready';
}

/**
 * The overview.
 *
 * Hierarchy, deliberately: the hero states health once, one action card states the
 * single most important thing to do, and four metric tiles carry supporting numbers
 * with no sentences repeating the hero. Anything longer than a tile lives behind the
 * view it belongs to.
 */
function formBoolean(id) {
    const field = document.getElementById(id);
    if (!field) return false;
    return field.type === 'checkbox' ? field.checked : field.value === 'true';
}

function endpointBlock(address) {
    if (!address) return 'Not available';
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(address)) return `${address.split('.').slice(0, 3).join('.')}.* /24`;
    if (address.includes(':')) return `${address.split(':').slice(0, 4).join(':')}::/64`;
    return 'Hostname';
}

function resolverLabel() {
    const value = document.getElementById('remoteDNS')?.value?.trim() || '';
    if (!value) return 'Not configured';
    try { return new URL(value).hostname || value; } catch { return value; }
}

function currentConfigurationSummary() {
    const protocols = document.getElementById('protocols')?.value || '';
    const enabled = protocols.split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
    const ports = defaultHttpsPorts.filter(port => document.querySelector(`input[name="${port}"]`)?.checked);
    const clean = (document.getElementById('cleanIPs')?.value || '').split(/[\r\n,]+/u).map(value => value.trim()).filter(Boolean);
    return {
        protocol: enabled.length ? enabled.join(' + ') : 'Not configured',
        transport: ports.length ? `TLS · ${ports[0]}` : 'No TLS port',
        endpoint: clean[0] || 'Default hostname',
        cleanCount: clean.length,
        fragment: document.getElementById('fragmentMode')?.value || 'Not configured',
        ech: formBoolean('enableECH'),
        ipv6: formBoolean('enableIPv6'),
        resolver: resolverLabel()
    };
}

function latestEndpointSnapshot(scans) {
    const run = Array.isArray(scans?.runs) ? scans.runs[0] : null;
    const best = run?.best || scans?.intelligence?.recommended || null;
    return {
        address: best?.address || null,
        score: Number.isFinite(Number(best?.score)) ? Math.round(Number(best.score)) : null,
        latency: Number.isFinite(Number(best?.latencyMs ?? best?.avgLatencyMs ?? best?.latency)) ? Math.round(Number(best.latencyMs ?? best.avgLatencyMs ?? best.latency)) : null,
        reliability: Number.isFinite(Number(best?.reliability ?? best?.successRate ?? best?.success)) ? Math.round(Number(best.reliability ?? best.successRate ?? best.success) * (Number(best?.reliability ?? best?.successRate ?? best?.success) <= 1 ? 100 : 1)) : null,
        confidence: Number.isFinite(Number(scans?.intelligence?.confidence)) ? Math.round(Number(scans.intelligence.confidence)) : null,
        at: Number.isFinite(Number(run?.at)) ? Number(run.at) : null
    };
}

function overviewActionPlan(action, preflight) {
    if (preflight?.ready === false) {
        return {
            eyebrow: 'SETUP REQUIRED', title: 'Finish deployment setup',
            copy: 'One or more required deployment checks are incomplete. Review the exact blocker before changing connection settings.',
            label: 'Review blockers', tone: 'risk', run: () => showPreflightDetails(preflight)
        };
    }
    const value = String(action || '').toLowerCase();
    if (value.includes('cloudflare api token') || value.includes('deployed manually') || value.includes('manual deployment')) {
        return {
            eyebrow: 'OPERATIONAL NOTE', title: 'Updates use manual deployment',
            copy: 'This is intentional: RayZen stores no Cloudflare API token. Open Maintenance only when you are ready to deploy an update.',
            label: 'Open maintenance', tone: 'neutral', run: () => { goToView('settings'); switchSettingsTab('maintenance'); }
        };
    }
    if (value.includes('endpoint') || value.includes('clean ip') || value.includes('latency')) {
        return {
            eyebrow: 'IMPROVE ROUTING', title: action || 'Measure a stronger endpoint',
            copy: 'Run a device-side scan, compare latency and reliability, then apply the measured winner.',
            label: 'Open Clean IP', tone: 'warn', run: () => goToView('intelligence')
        };
    }
    if (value.includes('configuration') || value.includes('protocol') || value.includes('dns') || value.includes('ipv6')) {
        return {
            eyebrow: 'REVIEW SETTINGS', title: action || 'Review the active configuration',
            copy: 'Smart Setup measures the current network and prepares changes for review.',
            label: 'Run Smart Setup', tone: 'warn', run: () => goToView('smart')
        };
    }
    if (action) {
        return {
            eyebrow: 'DO THIS NEXT', title: action,
            copy: 'RayZen selected the next action with the highest likely impact based on current evidence.',
            label: 'Open Smart Setup', tone: 'warn', run: () => goToView('smart')
        };
    }
    return {
        eyebrow: 'ALL CLEAR', title: 'Your measured setup is in good shape',
        copy: 'No change is justified right now. Keep collecting endpoint measurements as network conditions change.',
        label: 'View all checks', tone: 'good', run: () => goToView('diagnostics')
    };
}

function renderOverview(center, preflight, recs, scans, metrics, links) {
    if (center.error) return setRzContent('rz-overview-content', [rzError(center.error)]);
    const actions = Array.isArray(center.nextActions) ? center.nextActions : [];
    const action = overviewActionPlan(actions[0], preflight);
    const important = elm('article', { className: `rz-focus rz-tone-${action.tone}` }, [
        elm('span', { className: 'rz-focus-icon' }, rzIcon(action.tone === 'good' ? 'healthy' : action.tone === 'neutral' ? 'info' : 'action')),
        elm('div', { className: 'rz-focus-body' }, [
            elm('p', { className: 'rz-eyebrow' }, t(action.eyebrow)),
            elm('h3', {}, t(action.title)),
            elm('p', { className: 'rz-focus-copy' }, t(action.copy))
        ]),
        elm('button', { type: 'button', className: 'rz-focus-action', onclick: action.run }, t(action.label))
    ]);
    const config = currentConfigurationSummary();
    const endpoint = latestEndpointSnapshot(scans);
    const totalRequests = document.getElementById('total-usage')?.textContent?.trim() || '—';
    const sharedProfiles = Array.isArray(links?.profiles) ? links.profiles : [];
    const activeShared = sharedProfiles.filter(profile => profile.status ? profile.status === 'active' : (profile.enabled !== false && (!profile.expiresAt || profile.expiresAt > Date.now()))).length;
    const recommendation = Array.isArray(recs) ? recs[0] : null;
    const active = elm('article', { className: 'rz-command-panel' }, [
        elm('header', { className: 'rz-command-head' }, [
            elm('div', {}, [elm('p', { className: 'rz-card-label' }, 'ACTIVE CONNECTION'), elm('h3', {}, config.protocol)]),
            elm('span', { className: `rz-live-chip rz-${preflight?.ready === false ? 'offline' : 'online'}` }, [elm('i'), preflight?.ready === false ? 'Setup incomplete' : 'Ready'])
        ]),
        elm('div', { className: 'rz-command-metrics' }, [
            commandMetric('Transport', config.transport),
            commandMetric('Latency', endpoint.latency === null ? 'Not measured' : `${endpoint.latency} ms`),
            commandMetric('Current endpoint', endpoint.address || config.endpoint),
            commandMetric('Traffic · 24h requests', totalRequests),
            commandMetric('Active shared links', String(activeShared))
        ]),
        elm('footer', { className: 'rz-command-actions' }, [
            elm('button', { type: 'button', className: 'button rz-action', onclick: () => goToView('configuration') }, [rzIcon('configuration'), 'Open configuration']),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => goToView('subscriptions') }, [rzIcon('link'), 'Open subscriptions'])
        ])
    ]);
    const recommendationPanel = elm('article', { className: 'rz-next-panel' }, [
        elm('span', { className: 'rz-next-icon' }, rzIcon(recommendation ? 'smart' : 'healthy')),
        elm('p', { className: 'rz-card-label' }, 'RECOMMENDATION'),
        elm('h3', {}, recommendation?.title || 'No immediate change needed'),
        elm('p', {}, recommendation?.evidence?.summary || recommendation?.rationale || 'Your current measurements do not justify changing a working setup.'),
        endpoint.at ? elm('small', {}, `Endpoint evidence updated ${rzFormatDateTime(endpoint.at)}`) : elm('small', {}, 'Run a device scan to add network-specific evidence.'),
        elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => goToView(recommendation ? 'smart' : 'intelligence') }, [rzIcon(recommendation ? 'smart' : 'intelligence'), recommendation ? 'Review recommendation' : 'Run a device scan'])
    ]);

    const statistics = metrics?.statistics || {};
    const footer = elm('div', { className: 'rz-overview-foot' }, [
        elm('span', {}, `${Array.isArray(recs) ? recs.length : 0} open recommendation${Array.isArray(recs) && recs.length === 1 ? '' : 's'}`),
        elm('span', {}, `${statistics.activeDays || 0} active day${statistics.activeDays === 1 ? '' : 's'} recorded`),
        elm('button', { type: 'button', className: 'button rz-secondary-action rz-compact-action', onclick: () => goToView('analytics') }, [rzIcon('analytics'), 'View measurement history'])
    ]);
    setRzContent('rz-overview-content', [important, elm('section', { className: 'rz-command-grid' }, [active, recommendationPanel]), footer]);
}

function commandMetric(label, value) {
    const metricClass = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return elm('div', { className: `rz-command-metric rz-metric-${metricClass}` }, [elm('span', {}, label), elm('strong', {}, value)]);
}

/** The hero is the only place health is written in words. */
function updateHero(center, preflight) {
    const hero = document.querySelector('.rz-hero');
    const title = document.querySelector('.rz-hero h1');
    const copy = document.querySelector('.rz-hero-copy');
    const scoreNode = document.getElementById('rz-hero-score');
    const ring = document.querySelector('.rz-ring-value');
    if (!hero) return;

    const status = center.error ? 'unknown' : (center.status || 'unknown');
    hero.className = `rz-hero rz-hero-${status}`;
    if (title) title.textContent = t(center.error ? 'RayZen control center' : rzStatusHeadline(status, preflight?.ready));
    const config = currentConfigurationSummary();
    const endpoint = latestEndpointSnapshot(rzIntelligenceState?.scans);
    const profiles = Array.isArray(rzIntelligenceState?.links?.profiles) ? rzIntelligenceState.links.profiles : [];
    const activeShared = profiles.filter(profile => profile.status ? profile.status === 'active' : (profile.enabled !== false && (!profile.expiresAt || profile.expiresAt > Date.now()))).length;
    if (copy) {
        copy.textContent = center.error
            ? t('Some signals could not be read on this request.')
            : status === 'good'
              ? t('Configuration, endpoints and security all check out.')
              : t('One item below is worth your time. Everything else is steady.');
        let facts = copy.parentElement?.querySelector('.rz-hero-facts');
        if (!facts) { facts = elm('div', { className: 'rz-hero-facts' }); copy.after(facts); }
        facts.replaceChildren(
            commandMetric('Endpoint', endpoint.address || config.endpoint),
            commandMetric('Latency', endpoint.latency === null ? 'Not measured' : `${endpoint.latency} ms`),
            commandMetric('Shared links', String(activeShared)),
            commandMetric('Scanner confidence', endpoint.confidence === null ? 'No baseline' : `${endpoint.confidence}%`)
        );
    }

    const score = typeof center.score === 'number' ? center.score : null;
    if (scoreNode) scoreNode.textContent = score === null ? '—' : String(score);
    if (ring) {
        const circumference = 2 * Math.PI * 40;
        ring.style.strokeDasharray = String(circumference);
        ring.style.strokeDashoffset = String(circumference * (1 - (score ?? 0) / 100));
    }
    const orb = document.getElementById('rz-hero-orb');
    if (orb) orb.setAttribute('aria-label', `${t('Health score')} ${score === null ? '—' : score}/100`);
}

function renderSmart(profiles, recs, health, scans) {
    const assistant = elm('article', { className: 'rz-assistant', id: 'rz-smart-assistant' }, [
        elm('header', { className: 'rz-assistant-head' }, [
            elm('span', { className: 'rz-assistant-mark' }, rzIcon('smart')),
            elm('div', {}, [
                elm('p', { className: 'rz-card-label' }, 'GUIDED ANALYSIS'),
                elm('h3', {}, 'Let RayZen prepare the right setup'),
                elm('p', {}, 'RayZen measures this panel, checks DNS, reads device endpoint history, and audits the saved configuration. It stages a recommendation; it never saves for you.')
            ]),
            elm('button', { id: 'rz-smart-run', type: 'button', className: 'button rz-action', onclick: runSmartSetup }, [rzIcon('smart'), 'Analyze connection'])
        ]),
        elm('div', { className: 'rz-assistant-tests', role: 'list' }, [
            assistantStep('network', 'Network', 'Waiting'),
            assistantStep('endpoint', 'Endpoint', 'Waiting'),
            assistantStep('dns', 'DNS', 'Waiting'),
            assistantStep('configuration', 'Configuration', 'Waiting')
        ]),
        elm('div', { className: 'rz-assistant-result', id: 'rz-assistant-result', 'aria-live': 'polite' }, [
            elm('div', { className: 'rz-assistant-preparing' }, [elm('span', { className: 'rz-spinner' }), elm('span', {}, 'Preparing the analysis…')])
        ])
    ]);
    const trust = elm('aside', { className: 'rz-smart-trust' }, [
        elm('div', { className: 'rz-smart-trust-title' }, [
            elm('p', { className: 'rz-card-label' }, 'WHAT RAYZEN LEARNS'),
            elm('h3', {}, 'Measurements, not a black box')
        ]),
        elm('p', {}, 'Repeat device scans build block-level latency and reliability history. Saved settings show which tradeoffs you chose. Recommendation outcomes are counted only in aggregate.'),
        elm('button', { type: 'button', className: 'rz-text-action', onclick: () => goToView('analytics') }, 'See the evidence history →')
    ]);
    setRzContent('rz-smart-content', [assistant, trust]);
    rzIntelligenceState = { ...(rzIntelligenceState || {}), profiles, recs, health, scans };
}

function assistantStep(id, label, detail) {
    return elm('div', { className: 'rz-assistant-step rz-pending', id: `rz-assistant-${id}`, role: 'listitem' }, [
        elm('span', { className: 'rz-assistant-step-icon' }, rzIcon('clock_loader_40')),
        elm('div', {}, [elm('strong', {}, label), elm('small', {}, detail)])
    ]);
}

function setAssistantStep(id, state, detail) {
    const row = document.getElementById(`rz-assistant-${id}`);
    if (!row) return;
    row.className = `rz-assistant-step rz-${state}`;
    row.querySelector('.rz-assistant-step-icon')?.replaceChildren(rzIcon(state === 'done' ? 'check_circle' : state === 'attention' ? 'warning' : 'clock_loader_40'));
    const small = row.querySelector('small');
    if (small) small.textContent = detail;
}

function readLastDeviceScan() {
    try {
        const value = JSON.parse(localStorage.getItem('rz-last-device-scan') || 'null');
        return value && Number.isFinite(value.at) ? value : null;
    } catch {
        return null;
    }
}

async function timedRequest(url, options = {}, timeoutMs = 6500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = performance.now();
    try {
        const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal });
        return { ok: response.ok, ms: Math.round(performance.now() - started), status: response.status };
    } catch (error) {
        return { ok: false, ms: null, status: 0, error: error.name === 'AbortError' ? 'Timed out' : error.message };
    } finally {
        clearTimeout(timer);
    }
}

async function measureLiveSignals() {
    // These measurements are independent. Running them together keeps Smart Setup
    // responsive on filtered networks, where a timeout should cost one window rather
    // than three consecutive windows.
    const [firstRoundTrip, secondRoundTrip, dns] = await Promise.all([
        timedRequest('./panel/platform/health'),
        timedRequest('./panel/platform/health'),
        timedRequest('./dns-query?name=cloudflare.com&type=A', { headers: { Accept: 'application/dns-json' } })
    ]);
    const roundTrips = [firstRoundTrip, secondRoundTrip]
        .filter(result => result.ok && result.ms !== null)
        .map(result => result.ms);
    const networkMs = roundTrips.length ? Math.round(roundTrips.reduce((sum, value) => sum + value, 0) / roundTrips.length) : null;
    const signals = { at: Date.now(), network: { ok: networkMs !== null, ms: networkMs }, dns };
    try { sessionStorage.setItem('rz-live-signals', JSON.stringify(signals)); } catch { /* optional */ }
    return signals;
}

function chooseSmartRecommendation(signals, state) {
    const device = readLastDeviceScan();
    const endpoint = latestEndpointSnapshot(state?.scans);
    const dnsFinding = state?.health?.findings?.find(finding => finding.id === 'security.dns-leak');
    const degrading = state?.scans?.intelligence?.trend === 'degrading';
    const restricted = signals.dns.ok === false || dnsFinding?.status === 'fail' || (device?.best?.success ?? 1) < 0.55;
    if (restricted) {
        return {
            id: 'restricted-network', extraPatch: { protocols: 'trojan', ports: [443] },
            reason: signals.dns.ok === false
                ? `The DNS path did not answer in ${signals.dns.ms ?? 'the timeout window'}, a common sign of filtering or resolver interference.`
                : `Only ${Math.round((device?.best?.success || 0) * 100)}% of endpoint attempts answered from this device.`
        };
    }
    if (degrading || (endpoint.score !== null && endpoint.score < 78)) {
        return {
            id: 'smart-stability', extraPatch: {},
            reason: degrading ? 'Endpoint quality is trending down across retained scans.' : `The latest endpoint scored ${endpoint.score}/100, so consistency matters more than peak speed.`
        };
    }
    const best = Array.isArray(state?.profiles) ? state.profiles.find(item => item.compatible) : null;
    return {
        id: best?.profile?.presetId || 'smart-gaming', extraPatch: {},
        reason: endpoint.latency !== null
            ? `The latest endpoint measured ${endpoint.latency} ms and no restricted-network signal was detected.`
            : 'Saved settings look good. Device data can refine this result.'
    };
}

async function runSmartSetup() {
    const assistant = document.getElementById('rz-smart-assistant');
    const result = document.getElementById('rz-assistant-result');
    const button = document.getElementById('rz-smart-run');
    if (!assistant || !result) return;
    assistant.dataset.started = 'true';
    assistant.setAttribute('aria-busy', 'true');
    if (button) {
        button.disabled = true;
        button.replaceChildren(rzIcon('clock_loader_40'), 'Analyzing…');
    }
    for (const id of ['network', 'endpoint', 'dns', 'configuration']) setAssistantStep(id, 'running', 'Checking…');
    result.replaceChildren(elm('div', { className: 'rz-assistant-preparing' }, [elm('span', { className: 'rz-spinner' }), elm('span', {}, 'Testing this connection and preparing a recommendation…')]));
    try {
        const state = rzIntelligenceState || {};
        const signals = await measureLiveSignals();
        const device = readLastDeviceScan();
        const endpoint = latestEndpointSnapshot(state.scans);
        const configIssues = state.health?.findings?.filter(finding => finding.status === 'fail' || finding.status === 'warn') || [];
        setAssistantStep('network', signals.network.ok ? 'done' : 'attention', signals.network.ok ? `${signals.network.ms} ms panel round-trip` : 'Panel round-trip unavailable');
        setAssistantStep('endpoint', device || endpoint.address ? 'done' : 'attention', device ? `${device.best.latency} ms · ${Math.round(device.best.success * 100)}% success` : endpoint.address ? `${endpoint.score}/100 from saved history` : 'Run a device scan for this network');
        setAssistantStep('dns', signals.dns.ok ? 'done' : 'attention', signals.dns.ok ? `${signals.dns.ms} ms resolver response` : 'Resolver did not answer');
        setAssistantStep('configuration', configIssues.some(item => item.status === 'fail') ? 'attention' : 'done', configIssues.length ? `${configIssues.length} item${configIssues.length === 1 ? '' : 's'} to improve` : 'No risky setting detected');

        const choice = chooseSmartRecommendation(signals, state);
        const preview = await rayzenApi('presets/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: choice.id }) });
        rzSmartRecommendation = { ...choice, preview };
        result.replaceChildren(renderSmartResult(rzSmartRecommendation, signals, device));
        rzIntelligenceState = { ...state, liveSignals: signals };
    } catch (error) {
        result.replaceChildren(elm('div', { className: 'rz-inline-error' }, [
            rzIcon('error'),
            elm('div', {}, [elm('strong', {}, 'Analysis could not finish'), elm('p', {}, error.message)]),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: runSmartSetup }, 'Try again')
        ]));
    } finally {
        assistant.removeAttribute('aria-busy');
        if (button) {
            button.disabled = false;
            button.replaceChildren(rzIcon('autorenew'), 'Analyze again');
        }
    }
}

function renderSmartResult(recommendation, signals, device) {
    const patch = { ...(recommendation.preview?.patch || {}), ...(recommendation.extraPatch || {}) };
    const config = currentConfigurationSummary();
    const protocol = String(patch.protocols || document.getElementById('protocols')?.value || config.protocol).replaceAll(',', ' + ').toUpperCase();
    const ports = Array.isArray(patch.ports) ? patch.ports.join(', ') : config.transport.replace(/^TLS · /u, '');
    const rows = [
        ['Protocol', protocol],
        ['Port', ports || 'Saved selection'],
        ['Fragment', patch.fragmentMode || config.fragment],
        ['ECH', patch.enableECH === undefined ? (config.ech ? 'Enabled' : 'Off') : (patch.enableECH ? 'Enabled' : 'Off')],
        ['DNS', patch.remoteDNS || document.getElementById('remoteDNS')?.value || 'Not configured']
    ];
    const endpoint = readLastDeviceScan()?.best;
    const detected = [
        ['Panel latency', signals.network?.ms === null ? 'Unavailable' : `${signals.network.ms} ms`],
        ['Endpoint', endpoint?.latency === undefined ? 'No device scan' : `${Math.round(endpoint.latency)} ms`],
        ['Probe success', endpoint?.success === undefined ? 'No device scan' : `${Math.round(endpoint.success * 100)}%`],
        ['DNS', signals.dns?.ok ? `${signals.dns.ms} ms` : 'Needs attention']
    ];
    return elm('section', { className: 'rz-smart-output' }, [
        elm('div', { className: 'rz-smart-output-copy' }, [
            elm('p', { className: 'rz-card-label' }, 'RECOMMENDED CONFIGURATION'),
            elm('h3', {}, recommendation.preview?.preset?.title || 'Recommended setup'),
            elm('p', {}, recommendation.reason),
            elm('div', { className: 'rz-smart-detected' }, detected.map(([label, value]) => commandMetric(label, value))),
            elm('div', { className: 'rz-confidence-note' }, [rzIcon(device ? 'healthy' : 'info'), elm('span', {}, device ? 'Grounded in this device’s endpoint scan and the current configuration.' : 'Configuration-grounded. Run a device scan to add network-specific confidence.')])
        ]),
        elm('div', { className: 'rz-smart-config' }, rows.map(([label, value]) => commandMetric(label, value))),
        elm('div', { className: 'rz-smart-output-actions' }, [
            elm('button', { type: 'button', className: 'button rz-action', onclick: stageSmartRecommendation }, [rzIcon('configuration'), 'Apply recommendation']),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => previewPreset(recommendation.id) }, [rzIcon('visibility'), 'Preview']),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => showSmartComparison(recommendation) }, [rzIcon('analytics'), 'Compare']),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => toggleSmartExplanation() }, [rzIcon('info'), 'Explain'])
        ]),
        elm('div', { className: 'rz-smart-explanation', id: 'rz-smart-explanation', hidden: true }, [
            elm('strong', {}, 'Why it fits'),
            elm('p', {}, recommendation.reason),
            elm('p', {}, device ? 'Device evidence included. Review changes before saving.' : 'Saved settings + live panel/DNS checks. A device scan adds endpoint evidence.')
        ])
    ]);
}

function toggleSmartExplanation() {
    const node = document.getElementById('rz-smart-explanation');
    if (!node) return;
    node.hidden = !node.hidden;
}

function showSmartComparison(recommendation) {
    const patch = { ...(recommendation.preview?.patch || {}), ...(recommendation.extraPatch || {}) };
    const current = currentConfigurationSummary();
    const proposed = [
        ['Protocol', current.protocol, String(patch.protocols || current.protocol).replaceAll(',', ' + ').toUpperCase()],
        ['Transport', current.transport, Array.isArray(patch.ports) ? `TLS · ${patch.ports.join(', ')}` : current.transport],
        ['Fragment', current.fragment, patch.fragmentMode || current.fragment],
        ['ECH', current.ech ? 'Enabled' : 'Off', patch.enableECH === undefined ? (current.ech ? 'Enabled' : 'Off') : (patch.enableECH ? 'Enabled' : 'Off')],
        ['Resolver', current.resolver, patch.remoteDNS || current.resolver]
    ];
    const dialog = buildDialog('Compare recommended settings', 'Nothing changes until you review and save Configuration.');
    dialog.querySelector('.rz-dialog-body')?.append(elm('div', { className: 'rz-compare-table' }, [
        elm('div', { className: 'rz-compare-head' }, [elm('strong', {}, 'Setting'), elm('strong', {}, 'Current'), elm('strong', {}, 'Recommended')]),
        ...proposed.map(([label, before, after]) => elm('div', { className: before === after ? 'rz-compare-row' : 'rz-compare-row rz-changed' }, [elm('strong', {}, label), elm('span', {}, before), elm('span', {}, after)]))
    ]));
    document.body.append(dialog);
    dialog.querySelector('.rz-dialog-close')?.focus();
}

function stageSmartRecommendation() {
    if (!rzSmartRecommendation) return;
    const patch = { ...(rzSmartRecommendation.preview?.patch || {}), ...(rzSmartRecommendation.extraPatch || {}) };
    applyPatchToForm(patch);
    goToView('configuration');
    showPreparedConfiguration(rzSmartRecommendation, patch);
}

function showPreparedConfiguration(recommendation, patch) {
    const root = document.getElementById('rz-configuration-content');
    if (!root) return;
    root.querySelector('.rz-prepared-banner')?.remove();
    const changed = Array.isArray(recommendation.preview?.changed) ? recommendation.preview.changed : Object.keys(patch);
    const title = recommendation.preview?.preset?.title || 'Recommended setup';
    const banner = elm('article', { className: 'rz-prepared-banner', role: 'status' }, [
        elm('span', { className: 'rz-prepared-icon' }, rzIcon('verified')),
        elm('div', { className: 'rz-prepared-copy' }, [
            elm('p', { className: 'rz-card-label' }, 'SMART SETUP PREPARED'),
            elm('h3', {}, `${title} is ready for review`),
            elm('p', {}, `${changed.length || Object.keys(patch).length} setting${(changed.length || Object.keys(patch).length) === 1 ? '' : 's'} ${changed.length === 1 ? 'was' : 'were'} staged. Nothing has been saved yet.`),
            changed.length ? elm('div', { className: 'rz-prepared-chips' }, changed.slice(0, 6).map(key => elm('span', {}, String(key)))) : elm('span')
        ]),
        elm('div', { className: 'rz-prepared-actions' }, [
            elm('button', { type: 'button', className: 'button rz-action', onclick: () => document.getElementById('applyButton')?.click() }, 'Save configuration'),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => document.querySelector('.rz-config-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [rzIcon('visibility'), 'Review changed fields'])
        ])
    ]);
    root.prepend(banner);
    banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderProfileComparison(profiles) {
    if (!Array.isArray(profiles) || !profiles.length) return;
    const root = document.getElementById('rz-configuration-content');
    if (!root) return;
    root.querySelector('.rz-config-recommendation')?.remove();
    const best = profiles.find(profile => profile.compatible);
    if (!best) return;
    const anchor = root.querySelector('.rz-preset-gallery') || root.firstElementChild;
    const card = elm('article', { className: 'rz-card rz-card-wide rz-config-recommendation' }, [
        elm('p', { className: 'rz-card-label' }, t('SMART SUGGESTION')),
        elm('h3', {}, best.profile.title),
        elm('p', {}, best.rationale.join(' ')),
        elm('div', { className: 'rz-score-line' }, [elm('strong', {}, `${best.score}/100 projected`), elm('span', {}, `${best.confidence}% confidence`)]),
        elm('button', { type: 'button', className: 'button rz-action', onclick: () => previewPreset(best.profile.presetId) }, t('Preview safely'))
    ]);
    if (anchor) anchor.after(card); else root.prepend(card);
}

async function previewPreset(id) {
    try {
        const body = await rayzenApi('presets/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        const meta = RZ_PRESET_META.find(item => item.id === id);
        const dialog = buildDialog(meta?.title || body.preset.title, meta?.focus || body.preset.description);
        const content = dialog.querySelector('.rz-dialog-body');
        content.append(elm('div', { className: 'rz-preset-preview' }, [
            elm('div', { className: 'rz-preset-preview-facts' }, [
                presetFact('Benefits', meta?.benefit || body.preset.description),
                presetFact('Tradeoff', meta?.tradeoff || 'Review the staged values against your client compatibility.'),
                presetFact('Changes', body.changed.length ? body.changed.join(', ') : 'Already matches your saved setup')
            ]),
            elm('div', { className: 'rz-change-list' }, Object.entries(body.patch).map(([key, value]) => commandMetric(key, Array.isArray(value) ? value.join(', ') : String(value)))),
            elm('div', { className: 'rz-dialog-actions' }, [
                elm('button', { type: 'button', className: 'rz-text-action', onclick: dialog.rzClose }, 'Cancel'),
                elm('button', { type: 'button', className: 'button rz-action', disabled: body.changed.length === 0, onclick: () => {
                    applyPatchToForm(body.patch);
                    dialog.rzClose();
                    goToView('configuration');
                    document.getElementById('applyButton')?.focus({ preventScroll: true });
                } }, body.changed.length ? 'Stage changes' : 'Already applied')
            ])
        ]));
        document.body.append(dialog);
        dialog.querySelector('.rz-dialog-close')?.focus();
    } catch (error) {
        await notify('error', 'Preview unavailable', [error.message]);
    }
}

function presetFact(label, copy) {
    return elm('div', {}, [elm('strong', {}, label), elm('p', {}, copy)]);
}

function focusRecommendedField(field) {
    if (!field) return;
    const control = document.getElementById(field);
    const details = control?.closest('details');
    if (details) details.open = true;
    control?.focus({ preventScroll: false });
}

function readLiveSignals() {
    if (rzIntelligenceState?.liveSignals) return rzIntelligenceState.liveSignals;
    try { return JSON.parse(sessionStorage.getItem('rz-live-signals') || 'null'); } catch { return null; }
}

function diagnosticsMetric(label, value, detail, tone = '') {
    return elm('div', { className: `rz-diag-metric ${tone ? `rz-${tone}` : ''}` }, [
        elm('span', {}, label), elm('strong', {}, value), elm('small', {}, detail)
    ]);
}

function diagnosticsAction(finding) {
    const routes = {
        'security.password-set': ['settings', null, 'Open account settings'],
        'security.log-level': ['configuration', 'logLevel', 'Use safer logging'],
        'security.lan-exposure': ['configuration', 'allowLANConnection', 'Review LAN access'],
        'security.dns-leak': ['configuration', 'remoteDNS', 'Fix DNS transport'],
        'config.protocols-enabled': ['configuration', 'protocols', 'Choose a protocol'],
        'config.ports-selected': ['configuration', null, 'Choose a TLS port'],
        'config.clean-addresses': ['intelligence', null, 'Scan Clean IPs'],
        'intelligence.endpoint-degradation': ['intelligence', null, 'Find a better IP'],
        'platform.version-current': ['settings', null, 'Open maintenance'],
        'platform.update-capability': ['settings', null, 'Review deployment']
    };
    const [view, field, label] = routes[finding.id] || ['configuration', null, 'Review setting'];
    return elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => {
        goToView(view);
        if (view === 'settings') switchSettingsTab(finding.id.startsWith('security') ? 'account' : 'maintenance');
        if (field) focusRecommendedField(field);
    } }, label);
}

async function runDiagnosticsTests() {
    const button = document.getElementById('rz-diag-live-test');
    if (button) button.disabled = true;
    try {
        const liveSignals = await measureLiveSignals();
        rzIntelligenceState = { ...(rzIntelligenceState || {}), liveSignals };
        renderDiagnostics(rzIntelligenceState.health, rzIntelligenceState.center, rzIntelligenceState.scans, rzIntelligenceState.lifecycle);
    } finally {
        if (button) button.disabled = false;
    }
}

function diagnosticImpact(finding) {
    const id = String(finding.id || '');
    if (id.includes('ipv6')) return 'Some restrictive or partially supported networks may connect inconsistently.';
    if (id.includes('dns')) return 'Resolver failures can prevent domains from loading even when the tunnel is connected.';
    if (id.includes('clean') || id.includes('endpoint')) return 'A weak endpoint can increase latency, reconnects and timeouts.';
    if (id.includes('protocol') || id.includes('port') || id.includes('config')) return 'Generated client profiles may be less compatible with the current network.';
    if (id.startsWith('security.') || id.startsWith('platform.auth')) return 'This setting can increase exposure or weaken access protection.';
    return finding.status === 'fail' ? 'This can prevent a reliable connection.' : 'This may reduce compatibility or performance on some networks.';
}

function technicalFindingContent(finding) {
    if (finding.status === 'pass' || finding.status === 'skip') {
        return elm('div', {}, [elm('strong', {}, finding.title), elm('p', {}, finding.detail)]);
    }
    return elm('div', { className: 'rz-finding-content' }, [
        elm('strong', {}, finding.title),
        elm('div', { className: 'rz-finding-detail-grid' }, [
            elm('div', {}, [elm('span', {}, 'Current state'), elm('p', {}, finding.detail)]),
            elm('div', {}, [elm('span', {}, 'Impact'), elm('p', {}, diagnosticImpact(finding))]),
            elm('div', {}, [elm('span', {}, 'Recommendation'), elm('p', {}, finding.remediation || 'Review the related configuration and test again.')])
        ])
    ]);
}

function renderDiagnostics(health, center, scans, lifecycle) {
    if (health.error) return setRzContent('rz-diagnostics-content', [rzError(health.error)]);
    const status = health.grade === 'poor' ? 'Critical' : health.grade === 'fair' ? 'Warning' : 'Good';
    const live = readLiveSignals();
    const device = readLastDeviceScan();
    const endpoint = latestEndpointSnapshot(scans);
    const config = currentConfigurationSummary();
    const best = device?.best || (endpoint.address ? { address: endpoint.address, latency: endpoint.latency, score: endpoint.score, success: null } : null);
    const current = (document.getElementById('cleanIPs')?.value || '').split(/[\r\n,]+/u).map(value => value.trim()).filter(Boolean);
    const reliability = device?.best ? Math.round(device.best.reliability ?? device.best.score) : endpoint.score;
    const jitter = Number.isFinite(device?.best?.jitter) ? Math.round(device.best.jitter) : null;
    const issues = health.findings.filter(finding => finding.status === 'fail' || finding.status === 'warn');
    const securityIssues = issues.filter(finding => finding.id.startsWith('security.') || finding.id.startsWith('platform.auth'));

    const summary = elm('article', { className: `rz-diagnostics-hero rz-tone-${health.grade === 'poor' ? 'risk' : health.grade === 'fair' ? 'warn' : 'good'}` }, [
        elm('div', {}, [
            elm('p', { className: 'rz-card-label' }, 'CONFIGURATION HEALTH'),
            elm('h3', {}, center?.headline || `${status} system health`),
            elm('p', {}, issues.length ? `${issues.length} recommendation${issues.length === 1 ? '' : 's'}` : (live || device ? 'No configuration changes recommended.' : 'Saved settings look good.'))
        ]),
        elm('div', { className: 'rz-diagnostics-score' }, [elm('strong', {}, `${health.score}`), elm('span', {}, '/ 100'), elm('small', {}, 'configuration score')]),
        elm('button', { id: 'rz-diag-live-test', type: 'button', className: 'button rz-action', onclick: runDiagnosticsTests }, [rzIcon('autorenew'), live ? 'Run tests again' : 'Run live tests'])
    ]);

    const successRate = device?.best?.success;
    const evidenceSource = device ? 'This device scan' : endpoint.address ? 'Retained scanner history' : 'Saved configuration';
    const operational = elm('section', { className: 'rz-diagnostics-snapshot', 'aria-label': 'Operational diagnostics' }, [
        diagnosticsMetric('Resolver', config.resolver, live?.dns?.ok ? `${live.dns.ms} ms response` : 'Saved resolver', live?.dns?.ok ? 'good' : 'unknown'),
        diagnosticsMetric('TLS mode', config.transport, 'Active client transport', config.transport === 'No TLS port' ? 'warn' : 'good'),
        diagnosticsMetric('ECH', config.ech ? 'Enabled' : 'Off', config.ech ? 'Encrypted ClientHello requested' : 'Standard TLS handshake', 'neutral'),
        diagnosticsMetric('Fragment mode', config.fragment, 'Saved transport behavior', 'neutral'),
        diagnosticsMetric('IPv6', config.ipv6 ? 'Enabled' : 'Off', 'Client routing preference', 'neutral'),
        diagnosticsMetric('Endpoint', best?.address || current[0] || 'Default hostname', endpointBlock(best?.address || current[0]), best?.address ? 'good' : 'unknown'),
        diagnosticsMetric('Latency', best?.latency === undefined || best?.latency === null ? 'Not measured' : `${Math.round(best.latency)} ms`, evidenceSource, best?.latency !== undefined ? 'good' : 'unknown'),
        diagnosticsMetric('Probe loss estimate', successRate === undefined ? 'Not measured' : `${Math.max(0, Math.round((1 - successRate) * 100))}%`, successRate === undefined ? 'Requires device scan' : 'Based on bounded probe success', successRate !== undefined && successRate < .8 ? 'warn' : 'good'),
        diagnosticsMetric('Scanner confidence', endpoint.confidence === null ? 'No baseline' : `${endpoint.confidence}%`, evidenceSource, endpoint.confidence !== null && endpoint.confidence >= 70 ? 'good' : 'unknown')
    ]);

    const connection = elm('section', { className: 'rz-diagnostic-zone rz-zone-connection' }, [
        diagnosticZoneHead('Connection', 'Live browser and device measurements', 'overview'),
        elm('div', { className: 'rz-diag-metrics' }, [
            diagnosticsMetric('Latency', device?.best?.latency !== undefined ? `${Math.round(device.best.latency)} ms` : live?.network?.ms ? `${live.network.ms} ms` : 'Not measured', device ? 'Cloudflare edge from this device' : live ? 'Panel round-trip' : 'Run live tests', device || live?.network?.ok ? 'good' : 'unknown'),
            diagnosticsMetric('Stability', jitter === null ? 'Not measured' : jitter <= 25 ? 'Stable' : 'Variable', jitter === null ? 'Needs a device scan' : `${jitter} ms jitter`, jitter !== null && jitter > 25 ? 'warn' : 'good'),
            diagnosticsMetric('Packet behavior', device?.best ? `${Math.round(device.best.success * 100)}%` : 'Not measured', device ? 'Probe attempts answered' : 'Needs a device scan', device?.best?.success >= .8 ? 'good' : 'warn'),
            diagnosticsMetric('DNS performance', live?.dns?.ok ? `${live.dns.ms} ms` : live ? 'Unavailable' : 'Not tested', live?.dns?.ok ? 'Configured resolver answered' : 'Run live tests', live?.dns?.ok ? 'good' : 'warn'),
            diagnosticsMetric('Protocols', config.protocol, 'Availability from saved configuration', config.protocol === 'Not configured' ? 'warn' : 'good')
        ]),
        elm('div', { className: 'rz-zone-actions' }, [elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => goToView('intelligence') }, device ? 'Refresh device scan' : 'Run device scan')])
    ]);

    const betterAvailable = Boolean(best?.address && !current.includes(best.address));
    const cleanIp = elm('section', { className: 'rz-diagnostic-zone' }, [
        diagnosticZoneHead('Clean IP performance', 'The endpoint your generated configurations can use', 'intelligence'),
        elm('div', { className: 'rz-current-endpoint' }, [
            elm('div', {}, [elm('span', {}, 'Current'), elm('strong', {}, current[0] || 'Default hostname'), elm('small', {}, `${current.length} configured alternative${current.length === 1 ? '' : 's'}`)]),
            elm('div', {}, [elm('span', {}, 'Best measured'), elm('strong', {}, best?.address || 'No device result'), elm('small', {}, best ? `${best.latency ?? '—'} ms · ${reliability ?? '—'}% reliability` : 'Run a scan on this device')])
        ]),
        elm('p', { className: 'rz-zone-recommendation' }, betterAvailable ? `This device measured ${best.address} as the stronger current choice. Stage it and review the generated profile.` : best ? 'Your measured winner is already in the configured Clean IP list.' : 'RayZen needs a device scan before it can recommend an IP honestly.'),
        elm('div', { className: 'rz-zone-actions' }, [
            betterAvailable
                ? elm('button', { type: 'button', className: 'button rz-action', onclick: () => rzApplyCandidateCleanIp(best.address) }, 'Apply better IP')
                : elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => goToView('intelligence') }, 'Open scanner')
        ])
    ]);

    const configuration = elm('section', { className: 'rz-diagnostic-zone' }, [
        diagnosticZoneHead('Configuration', 'What clients receive after you apply', 'configuration'),
        elm('div', { className: 'rz-config-facts' }, [
            commandMetric('Protocol', config.protocol), commandMetric('Transport', config.transport),
            commandMetric('Fragmentation', config.fragment), commandMetric('ECH', config.ech ? 'Enabled' : 'Off')
        ]),
        elm('p', { className: 'rz-zone-recommendation' }, issues.find(finding => finding.id.startsWith('config.'))?.remediation || 'The active protocol and transport pass the current validation rules.'),
        elm('div', { className: 'rz-zone-actions' }, [elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => goToView('configuration') }, 'Review configuration')])
    ]);

    const security = elm('section', { className: 'rz-diagnostic-zone' }, [
        diagnosticZoneHead('Security', 'Exposure and weak-default checks', 'security'),
        securityIssues.length
            ? elm('div', { className: 'rz-security-list' }, securityIssues.map(finding => elm('div', { className: 'rz-security-row' }, [
                rzIcon(finding.status === 'fail' ? 'error' : 'warning'),
                elm('div', {}, [elm('strong', {}, finding.title), elm('p', {}, finding.detail)]),
                diagnosticsAction(finding)
            ])))
            : elm('div', { className: 'rz-all-clear-row' }, [rzIcon('healthy'), elm('span', {}, 'No exposed or weak setting was detected.')])
    ]);

    const findings = elm('details', { className: 'rz-technical-checks' }, [
        elm('summary', {}, [elm('span', {}, `Technical checks · ${health.findings.length}`), elm('small', {}, `${health.tally.pass} passed · ${health.tally.warn} warnings · ${health.tally.fail} failed`)]),
        elm('div', { className: 'rz-technical-list' }, health.findings.map(finding => elm('article', { className: `rz-technical-row rz-${finding.status}` }, [
            rzIcon(finding.status === 'pass' ? 'check_circle' : finding.status === 'fail' ? 'error' : 'warning'),
            technicalFindingContent(finding),
            finding.status === 'pass' || finding.status === 'skip' ? elm('span') : diagnosticsAction(finding)
        ])))
    ]);
    setRzContent('rz-diagnostics-content', [summary, operational, connection, cleanIp, configuration, security, findings]);
}

function diagnosticZoneHead(title, copy, icon) {
    return elm('header', { className: 'rz-zone-head' }, [elm('span', {}, rzIcon(icon)), elm('div', {}, [elm('h3', {}, title), elm('p', {}, copy)])]);
}
function rzPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number <= 1 ? number * 100 : number)));
}

function endpointReason(lifecycle) {
    if (lifecycle.state === 'degrading') return `Quality has fallen ${Math.abs(lifecycle.scoreDelta || 0)} points across retained measurements.`;
    if (lifecycle.state === 'improving') return `Quality has improved ${Math.abs(lifecycle.scoreDelta || 0)} points across retained measurements.`;
    if (lifecycle.state === 'stable') return `High stability over ${lifecycle.observations} recent measurements.`;
    if (lifecycle.state === 'retired') return 'This endpoint has not appeared as the best choice in recent scans.';
    return 'Only one measurement exists; wait for more evidence before acting.';
}

function renderEndpointRow(endpoint) {
    return elm('article', { className: `rz-endpoint-row rz-endpoint-${endpoint.state}` }, [
        elm('div', { className: 'rz-endpoint-title' }, [
            elm('strong', {}, endpoint.address),
            elm('span', { className: `rz-trend rz-trend-${endpoint.state}` }, endpoint.state)
        ]),
        elm('div', { className: 'rz-endpoint-metrics' }, [
            elm('div', {}, [elm('span', {}, 'Score'), elm('strong', {}, `${Math.round(Number(endpoint.averageScore ?? endpoint.score ?? 0))}/100`)]),
            // Evidence, not a confidence guess: the count of retained measurements is
            // the honest signal for how much history this row rests on. A percentage
            // here would have to be invented, because per-endpoint confidence is not
            // persisted — only scores and observation counts are.
            elm('div', {}, [elm('span', {}, 'Measurements'), elm('strong', {}, `${endpoint.observations}`)]),
            elm('div', {}, [elm('span', {}, 'Trend'), elm('strong', {}, endpoint.scoreDelta === null ? 'Baseline' : `${endpoint.scoreDelta >= 0 ? '+' : ''}${endpoint.scoreDelta}`)])
        ]),
        elm('p', {}, endpointReason(endpoint))
    ]);
}

function cleanIpWorkflow() {
    return elm('div', { className: 'rz-scan-workflow', 'aria-label': 'Clean IP workflow' }, [
        elm('div', { className: 'active' }, [elm('span', {}, '1'), elm('div', {}, [elm('strong', {}, 'Measure'), elm('small', {}, 'Test from this device')])]),
        elm('div', {}, [elm('span', {}, '2'), elm('div', {}, [elm('strong', {}, 'Choose'), elm('small', {}, 'Compare reliability')])]),
        elm('div', {}, [elm('span', {}, '3'), elm('div', {}, [elm('strong', {}, 'Apply'), elm('small', {}, 'Update generated configs')])])
    ]);
}

function currentCleanIpStatus() {
    const configured = (document.getElementById('cleanIPs')?.value || '').split(/[\r\n,]+/u).map(value => value.trim()).filter(Boolean);
    const last = readLastDeviceScan();
    return elm('div', { className: 'rz-scan-current' }, [
        elm('div', {}, [elm('span', {}, 'Configured endpoint'), elm('strong', {}, configured[0] || 'Default hostname')]),
        elm('div', {}, [elm('span', {}, 'Last measured winner'), elm('strong', {}, last?.best?.address || 'No device scan yet')]),
        elm('div', {}, [elm('span', {}, 'Evidence'), elm('strong', {}, last ? `${Math.round(last.best.latency)} ms · ${Math.round(last.best.success * 100)}% success` : 'Run the recommended quick scan')])
    ]);
}

function renderCleanIp(scans, lifecycle) {
    /**
     * The device-side scan, first because it is the one that answers the question most
     * operators actually have: which Cloudflare edge is fast *from my network*. The
     * Worker-side scan below it measures something different and is kept for what it is
     * good at, checking whether a configured endpoint is alive.
     */
    const deviceScan = elm('article', { className: 'rz-card rz-card-wide' }, [
        elm('p', { className: 'rz-card-label' }, t('SCAN FROM THIS DEVICE')),
        elm('h3', {}, t('Find the fastest Cloudflare edge for your network')),
        elm('p', {}, t('Your browser measures connection latency and response consistency directly. Results describe this device and network; nothing changes until you press Apply IP.')),
        currentCleanIpStatus(),
        elm('div', { className: 'rz-scan-form' }, [
            // The counts are stated and the durations are not. Scan time depends on how
            // much of the address space this network can reach, which is the thing being
            // measured, so a fixed figure on the button would be wrong on exactly the
            // networks that matter. `scan/plan` returns an estimate once the size is
            // known, and the progress line shows it.
            elm('button', {
                type: 'button', className: 'button rz-action', 'data-rz-scan-depth': 'quick',
                onclick: () => rzRunDeviceScan('quick')
            }, [rzIcon('speed'), `${t('Quick scan')} · ${t('recommended')}`]),
            elm('button', {
                type: 'button', className: 'button rz-secondary-action', 'data-rz-scan-depth': 'deep',
                onclick: () => rzRunDeviceScan('deep')
            }, [rzIcon('fingerprint'), `${t('Deep scan')} · ${t('broader search')}`]),
            elm('button', {
                id: 'rz-device-scan-stop', type: 'button', className: 'button delete', hidden: true,
                onclick: rzStopScan
            }, [rzIcon('error'), t('Stop')])
        ]),
        elm('div', { id: 'rz-device-scan-results', 'aria-live': 'polite' })
    ]);

    const intro = elm('article', { className: 'rz-card rz-card-wide' }, [
        elm('p', { className: 'rz-card-label' }, t('CHECK CONFIGURED ENDPOINTS')),
        elm('h3', {}, t('Measure endpoints. Keep control.')),
        elm('p', {}, t('Measured from the Worker, which answers whether an endpoint is alive rather than how fast it is for you. Use the device scan above for that.')),
        elm('div', { className: 'rz-scan-form' }, [
            elm('label', { className: 'rz-scan-count' }, [
                'How many candidates?',
                elm('select', { id: 'rz-scan-count', 'aria-label': 'Number of candidates to discover' }, [
                    elm('option', { value: '5' }, '5'),
                    elm('option', { value: '10', selected: true }, '10'),
                    elm('option', { value: '20' }, '20'),
                    elm('option', { value: '40' }, '40')
                ])
            ]),
            elm('button', { type: 'button', className: 'button rz-action', onclick: discoverCleanIpCandidates }, [rzIcon('data_usage'), 'Discover candidates']),
            elm('textarea', { id: 'rz-scan-targets', placeholder: '…or paste endpoints manually, one per line', 'aria-label': 'Endpoints to scan' }),
            elm('button', { id: 'rz-scan-run', type: 'button', className: 'button rz-action', onclick: runCleanIpScan }, [rzIcon('fingerprint'), 'Measure endpoints'])
        ]),
        elm('div', { id: 'rz-candidate-info', 'aria-live': 'polite' }),
        elm('div', { id: 'rz-scan-results', 'aria-live': 'polite' })
    ]);

    // The device scan does not depend on stored history, so it stays available even
    // when the Worker-side history could not be read.
    if (scans.error || lifecycle.error) return setRzContent('rz-intelligence-content', [cleanIpWorkflow(), deviceScan, intro, rzError(scans.error || lifecycle.error)]);
    const lifecycles = Array.isArray(lifecycle.lifecycles) ? lifecycle.lifecycles : [];
    const historyConfidence = Number(scans.intelligence?.confidence || 0);
    const advice = lifecycle.advice;
    const adviceCard = elm('article', { className: `rz-card ${advice?.moveTo ? 'rz-tone-warn' : 'rz-tone-good'}` }, [
        elm('p', { className: 'rz-card-label' }, 'SUBSCRIPTION ADVICE'),
        elm('h3', {}, advice?.moveTo ? `Consider ${advice.moveTo}` : 'Keep your current endpoint'),
        elm('p', {}, advice?.reasons?.[0] || 'Run a scan to establish an endpoint history.'),
        elm('div', { className: 'rz-evidence' }, [
            elm('strong', {}, `${rzPercent(advice?.confidence)}% confidence`),
            elm('span', {}, advice?.moveTo ? 'Recommendation only — update your subscription when you decide.' : 'No switch is justified by the current evidence.')
        ])
    ]);

    const list = elm('article', { className: 'rz-card rz-card-wide' }, [
        elm('p', { className: 'rz-card-label' }, 'ENDPOINT HISTORY'),
        elm('h3', {}, lifecycles.length ? `${lifecycles.length} measured endpoint${lifecycles.length === 1 ? '' : 's'}` : 'No endpoint history yet'),
        lifecycles.length
            ? elm('div', { className: 'rz-endpoint-list' }, lifecycles.map(entry => renderEndpointRow(entry)))
            : elm('div', { className: 'rz-empty-inline' }, [rzIcon('data_usage'), elm('p', {}, 'Discover candidates above and run the first bounded scan. RayZen will show score, measurements, trend and reason here.')])
    ]);

    setRzContent('rz-intelligence-content', [cleanIpWorkflow(), deviceScan, intro, adviceCard, list]);
}

/**
 * Candidate discovery: pulls the operator's configured endpoints from the platform
 * API and pre-fills the target list. This is the discover step of the intended
 * workflow (discover → pick how many → measure → read the ranked explanation);
 * the panel never scans third-party address space on its own.
 */
async function discoverCleanIpCandidates() {
    const info = document.getElementById('rz-candidate-info');
    const count = document.getElementById('rz-scan-count')?.value || '10';
    const textarea = document.getElementById('rz-scan-targets');
    info.replaceChildren(elm('div', { className: 'rz-scan-progress' }, [elm('span', { className: 'rz-spinner' }), elm('span', {}, 'Looking for candidates…')]));
    try {
        const res = await rayzenApi(`scanner/candidates?kind=clean-ip&count=${count}`);
        const candidates = Array.isArray(res.candidates) ? res.candidates : [];
        textarea.value = candidates.join('\n');
        const sources = res.sourceCounts || {};
        const parts = Object.entries(sources).map(([key, n]) => `${n} from ${key}`);
        if (candidates.length) {
            info.replaceChildren(elm('div', { className: 'rz-candidate-found' }, [
                elm('span', {}, `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} from your configuration — ${parts.join(', ')}.`),
                elm('span', { className: 'rz-muted' }, 'Review the list, then click Measure endpoints.')
            ]));
        } else {
            info.replaceChildren(elm('div', { className: 'rz-inline-error' }, [
                rzIcon('info'),
                elm('span', {}, 'No candidates found in your configuration. Add proxy IPs or clean IPs in Settings, or paste endpoints manually below.')
            ]));
        }
    } catch (error) {
        info.replaceChildren(elm('div', { className: 'rz-inline-error' }, [rzIcon('error'), elm('span', {}, error.message)]));
    }
}

async function runCleanIpScan() {
    const root = document.getElementById('rz-scan-results');
    const button = document.getElementById('rz-scan-run');
    const addresses = document.getElementById('rz-scan-targets').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (!addresses.length) {
        root.replaceChildren(elm('div', { className: 'rz-inline-error' }, [rzIcon('info'), elm('span', {}, 'Add at least one endpoint first.') ]));
        return;
    }
    root.replaceChildren(elm('div', { className: 'rz-scan-progress' }, [elm('span', { className: 'rz-spinner' }), elm('span', {}, `Measuring ${addresses.length} endpoint${addresses.length === 1 ? '' : 's'}…`) ]));
    if (button) button.disabled = true;
    try {
        const run = await rayzenApi('scanner/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'clean-ip', addresses, attempts: 3 }) });
        const unmeasurable = run.unmeasurable || [];
        const deadCount = typeof run.dead === 'number' ? run.dead : (run.dead?.length || 0);
        const blocks = [];
        if (run.ranked.length) {
            blocks.push(elm('div', { className: 'rz-scan-section' }, [
                elm('p', { className: 'rz-card-label' }, 'MEASURED ENDPOINTS'),
                ...run.ranked.map((entry, index) => elm('div', { className: 'rz-rank' }, [
                    elm('strong', {}, `#${index + 1} ${entry.address}`),
                    elm('span', { className: 'rz-score' }, `${entry.score}/100`),
                    elm('small', {}, `${entry.verdict} · ${entry.avgLatencyMs ?? '—'} ms · ${entry.reliability}% reliable · ${entry.confidence}% confidence`),
                    elm('small', { className: 'rz-rank-reason' }, entry.reasons.join(' · '))
                ]))
            ]));
        }
        if (unmeasurable.length) {
            const diagRow = (label, value) => elm('div', { className: 'rz-diag-row' }, [elm('span', {}, label), elm('p', {}, value)]);
            blocks.push(elm('div', { className: 'rz-scan-section' }, [
                elm('p', { className: 'rz-card-label' }, 'COULD NOT MEASURE'),
                elm('p', { className: 'rz-muted' }, 'These endpoints could not be scored from the Worker runtime. This is a platform limitation, not an endpoint failure — they were never counted as dead.'),
                ...unmeasurable.map(entry => elm('div', { className: 'rz-diagnostic' }, [
                    elm('div', { className: 'rz-finding-head' }, [rzIcon('fingerprint'), elm('strong', {}, entry.address)]),
                    elm('p', { className: 'rz-muted' }, entry.problem),
                    elm('div', { className: 'rz-diag-grid' }, [
                        diagRow('Impact', entry.impact),
                        diagRow('Cause', entry.cause),
                        diagRow('Solution', entry.solution)
                    ])
                ]))
            ]));
        }
        if (deadCount) {
            blocks.push(elm('p', { className: 'rz-muted rz-scan-dead' }, `${deadCount} endpoint${deadCount === 1 ? '' : 's'} were reachable but scored too low to recommend.`));
        }
        if (!blocks.length) {
            root.replaceChildren(elm('div', { className: 'rz-inline-error' }, [rzIcon('error'), elm('span', {}, 'No endpoint responded. Check the addresses and try again later.') ]));
            return;
        }
        root.replaceChildren(...blocks);
        setTimeout(loadRayZenIntelligence, 500);
    } catch (error) {
        root.replaceChildren(elm('div', { className: 'rz-inline-error' }, [rzIcon('error'), elm('span', {}, error.message)]));
    } finally {
        if (button) button.disabled = false;
    }
}

function renderAnalyticsChart(metrics) {
    const days = Array.isArray(metrics?.snapshot?.days) ? metrics.snapshot.days.slice(-14) : [];
    if (!days.length) return elm('div', { className: 'rz-chart-empty' }, [rzIcon('analytics'), elm('strong', {}, 'No activity baseline yet'), elm('p', {}, 'RayZen will chart privacy-safe daily aggregates after the panel is used.')]);
    const points = days.map(day => {
        const counters = day.counters || {};
        return {
            day: day.day,
            sessions: Number(counters['auth.success']) || 0,
            saves: Number(counters['settings.saves']) || 0,
            recommendations: Number(counters['recommendation.accepted']) || 0
        };
    });
    const max = Math.max(1, ...points.map(point => point.sessions + point.saves + point.recommendations));
    return elm('figure', { className: 'rz-analytics-figure' }, [
        elm('figcaption', {}, [elm('div', {}, [elm('p', { className: 'rz-card-label' }, 'PANEL ACTIVITY'), elm('h3', {}, 'Daily control activity')]), elm('div', { className: 'rz-chart-legend' }, [elm('span', { className: 'rz-legend-auth' }, 'Sessions'), elm('span', { className: 'rz-legend-save' }, 'Saves'), elm('span', { className: 'rz-legend-rec' }, 'Accepted recommendations')])]),
        elm('div', { className: 'rz-chart', role: 'img', 'aria-label': 'Daily panel activity for the last fourteen active days' }, points.map(point => {
            const total = point.sessions + point.saves + point.recommendations;
            return elm('div', { className: 'rz-chart-column', title: `${point.day}: ${point.sessions} sessions, ${point.saves} saves, ${point.recommendations} accepted recommendations` }, [
                elm('div', { className: 'rz-chart-stack', style: `height:${Math.max(8, Math.round((total / max) * 100))}%` }, [
                    point.recommendations ? elm('span', { className: 'rz-bar-rec', style: `flex:${point.recommendations}` }) : elm('span'),
                    point.saves ? elm('span', { className: 'rz-bar-save', style: `flex:${point.saves}` }) : elm('span'),
                    point.sessions ? elm('span', { className: 'rz-bar-auth', style: `flex:${point.sessions}` }) : elm('span')
                ]),
                elm('small', {}, point.day.slice(5))
            ]);
        }))
    ]);
}

function renderAnalytics(metrics, history, effectiveness) {
    if (metrics.error) return setRzContent('rz-analytics-content', [rzError(metrics.error)]);
    const stats = metrics.statistics || {};
    const totals = stats.totals || {};
    const entries = Array.isArray(history) ? history : [];
    const insight = Array.isArray(metrics.insights) && metrics.insights[0];
    const rate = effectiveness?.acceptanceRate === null || effectiveness?.acceptanceRate === undefined ? '—' : `${Math.round(effectiveness.acceptanceRate * 100)}%`;
    const cards = [
        elm('article', { className: 'rz-card rz-card-wide rz-analytics-chart-card' }, [renderAnalyticsChart(metrics)]),
        rzCard('Active days', stats.activeDays || 0, `Last activity: ${stats.lastActiveDay || 'No data yet'}`),
        rzCard('Settings saved', totals['settings.saves'] || 0, `${totals['settings.rejections'] || 0} rejected attempts`),
        rzCard('Recommendation trust', rate, effectiveness?.notes?.[0] || 'RayZen waits for five decisions before showing a rate.', effectiveness?.verdict === 'trusted' ? 'good' : 'neutral'),
        elm('article', { className: 'rz-card rz-card-wide' }, [
            elm('p', { className: 'rz-card-label' }, 'WHAT SHOULD I DO?'),
            elm('h3', {}, insight?.action || 'No adverse trend requires action.'),
            elm('p', {}, insight?.detail || 'RayZen stores daily aggregate counters only — no user, IP or request-level telemetry.')
        ])
    ];
    if (entries.length) cards.push(elm('article', { className: 'rz-card rz-card-wide' }, [
        elm('p', { className: 'rz-card-label' }, 'RECENT CONFIGURATION ACTIVITY'),
        ...entries.map(entry => elm('div', { className: 'rz-history-row' }, [
            elm('div', {}, [elm('strong', {}, entry.summary), elm('small', {}, entry.attribution?.label || entry.attribution?.source || 'Manual change')]),
            elm('time', {}, rzFormatDateTime(entry.at))
        ]))
    ]));
    setRzContent('rz-analytics-content', cards);
}

function showPreflightDetails(preflight) {
    if (preflight.error) return notify('error', 'Deployment checks unavailable', [preflight.error]);
    const dialog = buildDialog('Deployment checks', preflight.ready ? 'RayZen is ready to use.' : 'Finish these items before relying on the panel.');
    const body = dialog.querySelector('.rz-dialog-body');
    body.append(elm('div', { className: 'rz-preflight-summary' }, [
        elm('strong', {}, preflight.ready ? 'Ready' : `${preflight.blocking} blocking`),
        elm('span', {}, `${preflight.warnings} warning${preflight.warnings === 1 ? '' : 's'}`)
    ]));
    preflight.checks.forEach(check => body.append(elm('button', { type: 'button', className: `rz-check-row rz-check-${check.status}`, onclick: () => openSetupCheck(check, dialog) }, [
        rzIcon(check.status === 'pass' ? 'check_circle' : check.status === 'fail' ? 'error' : check.status === 'warn' ? 'info' : 'clock_loader_40'),
        elm('span', {}, [elm('strong', {}, check.title), elm('small', {}, check.message), check.fix ? elm('small', { className: 'rz-check-fix' }, check.fix) : elm('span')])
    ])));
    document.body.append(dialog);
    dialog.querySelector('.rz-dialog-close').focus();
}

function openSetupCheck(check, dialog) {
    dialog.rzClose();
    if (check.id === 'kv.binding' || check.id === 'kv.writable') {
        notify('info', check.title, [check.message, check.fix || '', 'This binding is changed in Cloudflare, not inside RayZen.']);
        return;
    }
    const view = check.id.startsWith('transport') || check.id.startsWith('platform') ? 'settings' : 'configuration';
    goToView(view);
    if (check.id === 'auth.path') focusRecommendedField('securePath');
    if (check.id === 'proxy.identity') focusRecommendedField('vlUUID');
}

/**
 * Builds a modal dialog.
 *
 * Every dialog owns its own state: the close handler, the key handler and the focus
 * restore all close over *this* element, so two dialogs cannot interfere and closing
 * one cannot leave a listener behind that acts on the next one.
 *
 * Three behaviours a modal has to have, and did not:
 *
 *   - **Escape closes it.** `aria-modal="true"` promises a modal, and a modal that
 *     traps the pointer but ignores the keyboard is unusable without a mouse. This
 *     is a plain div rather than `<dialog>` because `showModal()` renders into the
 *     top layer, where the panel's backdrop-filter and stacking no longer apply.
 *   - **Focus moves in and stays in.** Otherwise Tab walks the page behind the
 *     backdrop, which a screen reader follows and a sighted user cannot see.
 *   - **Focus returns.** Closing puts focus back on whatever opened the dialog, so
 *     keyboard position is not lost.
 */
function buildDialog(title, subtitle) {
    const opener = document.activeElement;

    const dialog = elm('div', { className: 'rz-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
        elm('div', { className: 'rz-dialog-panel' }, [
            elm('header', { className: 'rz-dialog-head' }, [
                elm('div', {}, [elm('p', { className: 'rz-card-label' }, t('RAYZEN PANEL')), elm('h2', {}, title), elm('p', {}, subtitle)]),
                elm('button', { type: 'button', className: 'rz-dialog-close', title: t('Close'), 'aria-label': t('Close'), onclick: () => close() }, rzIcon('close'))
            ]),
            elm('div', { className: 'rz-dialog-body' })
        ])
    ]);

    const focusable = () => [...dialog.querySelectorAll(
        'button, [href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'
    )].filter(node => node.getClientRects().length > 0 && !node.disabled);

    function onKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key !== 'Tab') return;

        // Wrap at the ends rather than letting the browser walk out of the dialog.
        const nodes = focusable();
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialog.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
            event.preventDefault();
            first.focus();
        }
    }

    function close() {
        // Guarded: the backdrop, the close button and Escape can all fire, and a
        // second removal would move focus a second time.
        if (!dialog.isConnected) return;
        document.removeEventListener('keydown', onKeyDown, true);
        dialog.remove();
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }

    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    document.addEventListener('keydown', onKeyDown, true);

    // Exposed so a caller that replaces one dialog with another closes it properly
    // rather than calling `.remove()` and orphaning the key listener.
    dialog.rzClose = close;
    return dialog;
}

function maybeShowOnboarding(preflight) {
    if (preflight.error) return;
    let seen = false;
    try { seen = localStorage.getItem('rayzen-onboarding-v1') === 'complete'; } catch { seen = true; }
    if (seen || document.querySelector('.rz-dialog')) return;

    const dialog = buildDialog('Welcome to RayZen', 'Set up the essentials.');
    const body = dialog.querySelector('.rz-dialog-body');
    body.append(elm('div', { className: 'rz-onboarding-grid' }, [
        onboardingItem('1', 'Configure once', 'Identity, DNS, and routing.'),
        onboardingItem('2', 'Import one subscription', 'Import RayZen into your preferred client.'),
        onboardingItem('3', 'Measure endpoints', 'Score endpoint quality and stability.'),
        onboardingItem('4', 'Stay in control', 'Review every recommendation before applying it.')
    ]));
    body.append(elm('div', { className: 'rz-onboarding-actions' }, [
        elm('button', { type: 'button', className: 'rz-text-action', onclick: () => { markOnboardingComplete(); dialog.rzClose(); } }, 'Explore dashboard'),
        elm('button', { type: 'button', className: 'button rz-action', onclick: () => { markOnboardingComplete(); dialog.rzClose(); goToView(preflight.ready ? 'configuration' : 'overview'); if (!preflight.ready) showPreflightDetails(preflight); } }, preflight.ready ? 'Configure RayZen' : 'Finish setup')
    ]));
    document.body.append(dialog);
    dialog.querySelector('.rz-dialog-close').focus();
}

function onboardingItem(number, title, copy) {
    return elm('article', { className: 'rz-onboarding-item' }, [elm('span', {}, number), elm('div', {}, [elm('h3', {}, title), elm('p', {}, copy)])]);
}

function markOnboardingComplete() {
    try { localStorage.setItem('rayzen-onboarding-v1', 'complete'); } catch { /* private browsing: harmless */ }
}

function installConfigurationTools() {
    const root = document.getElementById('rz-configuration-content');
    if (!root || root.querySelector('.rz-config-tools')) return;
    const presetGallery = elm('section', { className: 'rz-preset-gallery', 'aria-label': 'Configuration presets' }, [
        elm('header', { className: 'rz-preset-gallery-head' }, [
            elm('div', {}, [elm('p', { className: 'rz-card-label' }, 'PROFESSIONAL PRESETS'), elm('h3', {}, 'Choose a starting point')]),
            elm('p', {}, 'Preview changes before applying them.')
        ]),
        elm('div', { className: 'rz-preset-list' }, RZ_PRESET_META.map(meta => elm('article', { className: 'rz-preset-card' }, [
            elm('div', { className: 'rz-preset-card-head' }, [elm('span', {}, rzIcon(meta.id === 'privacy' ? 'security' : meta.id === 'smart-gaming' ? 'action' : meta.id === 'restricted-network' ? 'diagnostics' : 'healthy')), elm('small', {}, meta.focus)]),
            elm('h3', {}, meta.title),
            elm('div', { className: 'rz-preset-change' }, [elm('span', {}, 'Changes'), elm('p', {}, meta.changes.join(' · '))]),
            elm('div', { className: 'rz-preset-benefit' }, [elm('strong', {}, 'Benefit'), elm('p', {}, meta.benefit)]),
            elm('div', { className: 'rz-preset-tradeoff' }, [elm('strong', {}, 'Tradeoff'), elm('p', {}, meta.tradeoff)]),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: () => previewPreset(meta.id) }, 'Preview preset')
        ])))
    ]);
    const tools = elm('section', { className: 'rz-config-tools' }, [
        elm('article', { className: 'rz-card rz-card-wide rz-subscription-guide' }, [
            elm('p', { className: 'rz-card-label' }, 'SUBSCRIPTIONS'),
            elm('h3', {}, 'Connect your client'),
            elm('p', {}, 'Copy a subscription link and import it into a compatible client.'),
            elm('div', { className: 'rz-inline-actions' }, [
                elm('button', { type: 'button', className: 'button rz-action', onclick: jumpToSubscriptions }, 'View links'),
                elm('button', { type: 'button', className: 'rz-text-action', onclick: () => goToView('intelligence') }, 'Measure endpoints')
            ])
        ]),
        elm('article', { className: 'rz-card rz-backup-card' }, [
            elm('p', { className: 'rz-card-label' }, 'SAFE BACKUP'),
            elm('h3', {}, 'Safe backup'),
            elm('p', {}, t('The backup excludes passwords, tokens, UUIDs and your private panel path.')),
            elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: downloadRayZenBackup }, [rzIcon('download'), 'Download backup'])
        ]),
        elm('article', { className: 'rz-card rz-backup-card' }, [
            elm('p', { className: 'rz-card-label' }, 'RESTORE PREVIEW'),
            elm('h3', {}, 'Restore preview'),
            elm('p', {}, 'Review compatible changes before applying them.'),
            elm('label', { className: 'button rz-secondary-action rz-file-button' }, [rzIcon('upload'), elm('span', {}, 'Choose backup'), elm('input', { type: 'file', accept: 'application/json,.json', onchange: previewRayZenRestore })])
        ])
    ]);
    const layout = root.querySelector('.rz-config-layout');
    layout?.before(presetGallery);
    layout?.after(tools);
}

function jumpToSubscriptions() {
    goToView('subscriptions');
    document.getElementById('subscriptions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------ *
 * Shared subscription links
 * ------------------------------------------------------------------ *
 *
 * The panel already had exactly one subscription link per client, and it was the
 * operator's own. Sharing it meant sharing the only link there is, so the only way to
 * cut somebody off was to change `securePath` and re-import on every device the
 * operator owns. A shared link is therefore not a convenience feature: it is the
 * difference between revoking one person and rebuilding your own setup.
 *
 * What this screen shows is deliberately narrow. It reports what the Worker measured
 * (requests seen, when, from which country) and it does not report bytes, because KV
 * loses concurrent increments by design and a quota built on it would fail open
 * silently. Calling the column "seen" rather than "requests" is the same honesty: the
 * counter is persisted at most hourly per link, so it is a lower bound.
 */

/** The kind/client catalogue from `panel/settings`, so this screen offers what the Worker serves. */
let rzSubscriptionCatalogue = null;

/** The last list read from the Worker, so a row action can re-render without a refetch. */
let rzSharedLinks = null;

/**
 * Builds the shareable URL for one link.
 *
 * Mirrors `generateSubUrl` rather than calling it: the profile path is
 * `/<securePath>/p/<token>/sub/<kind>` and the ordinary one is `/<securePath>/sub/<kind>`,
 * so sharing the builder would mean a flag inside it that every existing caller passes
 * as false. The `sing-box://` wrapper is duplicated because the client needs it in both
 * places for the same reason.
 */
function rzSharedLinkUrl(token, kind, core, label) {
    const url = new URL(`./p/${encodeURIComponent(token)}/sub/${kind}`, window.location.href);
    url.searchParams.append('app', core);
    url.hash = `RayZen ${label}`;

    if (core === 'sing-box' && kind !== 'raw') {
        return `sing-box://import-remote-profile?url=${url.href}`;
    }

    return url.href;
}

/** Reads the catalogue into `[kind, label, cores]` rows, or an empty list before settings load. */
function rzSharedLinkKinds() {
    if (!rzSubscriptionCatalogue) return [];
    return Object.entries(rzSubscriptionCatalogue).map(([kind, entry]) => [
        kind,
        entry.label,
        // Wireguard and Amnezia take a config file rather than a subscription URL, so a
        // link for them would be a link the client cannot use.
        entry.categories.map(({ core }) => core).filter(core => !['wireguard', 'amnezia'].includes(core))
    ]).filter(([, , cores]) => cores.length > 0);
}

async function renderSharedLinks() {
    const host = document.getElementById('rz-shared-links');
    if (!host) return;

    try {
        rzSharedLinks = await rayzenApi('links');
    } catch (error) {
        host.replaceChildren(elm('div', { className: 'rz-inline-error' }, [
            rzIcon('error'),
            elm('span', {}, error.message)
        ]));
        return;
    }

    paintSharedLinks();
}

function paintSharedLinks() {
    const host = document.getElementById('rz-shared-links');
    if (!host || !rzSharedLinks) return;

    const profiles = Array.isArray(rzSharedLinks.profiles) ? rzSharedLinks.profiles : [];
    const max = Number(rzSharedLinks.max) || 0;
    const atCap = profiles.length >= max;
    const activeProfiles = profiles.filter(profile => profile.status === 'active').length;
    const expiringSoon = profiles.filter(profile => profile.status === 'active' && profile.expiresAt && profile.expiresAt - Date.now() < 7 * 86400000).length;
    const observedFetches = profiles.reduce((sum, profile) => sum + (Number(profile.requests) || 0), 0);
    const latestSeen = profiles.reduce((latest, profile) => Math.max(latest, Number(profile.lastSeenAt) || 0), 0);
    const maxObserved = Math.max(1, ...profiles.map(profile => Number(profile.requests) || 0));

    const form = elm('div', { className: 'rz-share-form' }, [
        elm('label', { className: 'rz-share-field' }, [
            elm('span', {}, t('Who is this for?')),
            elm('input', {
                type: 'text', id: 'rz-share-name', maxLength: 40, autocomplete: 'off',
                placeholder: t('Phone, laptop, a friend’s name…'),
                'aria-label': t('Who is this for?')
            })
        ]),
        elm('label', { className: 'rz-share-field' }, [
            elm('span', {}, t('Stops working after')),
            elm('select', { id: 'rz-share-days', 'aria-label': t('Stops working after') }, [
                elm('option', { value: '0' }, t('Never')),
                elm('option', { value: '7' }, t('7 days')),
                elm('option', { value: '30', selected: true }, t('30 days')),
                elm('option', { value: '90' }, t('90 days')),
                elm('option', { value: '365' }, t('1 year'))
            ])
        ]),
        elm('button', {
            type: 'button', id: 'rz-share-create', className: 'button rz-action',
            disabled: atCap,
            title: atCap ? t('Revoke a link before creating another.') : '',
            onclick: createSharedLink
        }, [rzIcon('add_circle'), t('Create link')])
    ]);

    const nodes = [
        elm('p', { className: 'rz-card-label' }, t('SHARED LINKS')),
        elm('h3', {}, t('Give each person their own link')),
        elm('p', {}, t('Your own subscription links above never expire and cannot be revoked without changing your panel path. A shared link can be switched off on its own, so cutting one person off leaves everyone else working.')),
        form,
        elm('div', { className: 'rz-share-summary' }, [
            commandMetric('Active links', String(activeProfiles)),
            commandMetric('Expiring in 7 days', String(expiringSoon)),
            commandMetric('Observed fetches', String(observedFetches)),
            commandMetric('Last activity', latestSeen ? rzFormatDate(latestSeen) : 'Not used yet')
        ])
    ];

    if (atCap) {
        nodes.push(elm('div', { className: 'rz-inline-error' }, [
            rzIcon('info'),
            elm('span', {}, tf('This deployment holds the maximum of {max} shared links. Revoke one to create another.', { max }))
        ]));
    }

    nodes.push(profiles.length
        ? elm('div', { className: 'rz-share-list' }, profiles.map(profile => renderSharedLinkRow(profile, maxObserved)))
        : elm('div', { className: 'rz-empty-inline' }, [
            rzIcon('share'),
            elm('p', {}, t('No shared links yet. Create one above, then send it instead of your own subscription URL.'))
        ]));

    host.replaceChildren(...nodes);
}

/**
 * Translates a sentence that contains a value.
 *
 * Written because the first version of this screen concatenated `t('Anyone holding')`,
 * the name and `t('will stop connecting…')`. That reads correctly in English and
 * incorrectly in Persian, where the clause order differs, and it gives the translator
 * two fragments neither of which is a sentence. The whole sentence is the key, and
 * `{name}` moves to wherever the target language puts it.
 */
function tf(template, values) {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        t(template)
    );
}

/** Status wording, tone and explanation for one link. Derived from the Worker's own status. */
const RZ_LINK_STATUS = {
    active: ['Active', 'good', 'This link works right now.'],
    disabled: ['Revoked', 'risk', 'This link is switched off. Nobody holding it can connect.'],
    expired: ['Expired', 'warn', 'This link passed its expiry date and no longer works.']
};

function renderSharedLinkRow(profile, maxObserved = 1) {
    const [label, tone, explanation] = RZ_LINK_STATUS[profile.status] || RZ_LINK_STATUS.active;

    const seen = profile.lastSeenAt
        // "Seen" rather than "requests": the counter is persisted at most hourly per link,
        // so it is a lower bound and must not be presented as traffic accounting.
        ? tf('Last seen {when}', { when: rzFormatDateTime(profile.lastSeenAt) })
            + (profile.lastSeenFrom ? ` · ${profile.lastSeenFrom}` : '')
        : t('Not used yet');

    const expiry = profile.expiresAt
        ? tf(profile.status === 'expired' ? 'Expired {date}' : 'Expires {date}', { date: rzFormatDate(profile.expiresAt) })
        : t('No expiry');

    const actions = elm('div', { className: 'rz-share-actions' }, [
        elm('button', {
            type: 'button', className: 'rz-text-action',
            onclick: () => showSharedLinkTargets(profile)
        }, [rzIcon('content_copy'), elm('span', {}, t('Copy link'))]),
        elm('button', {
            type: 'button', className: 'rz-text-action',
            onclick: () => toggleSharedLink(profile)
        }, [
            rzIcon(profile.enabled ? 'error' : 'check_circle'),
            elm('span', {}, profile.enabled ? t('Revoke') : t('Re-enable'))
        ]),
        elm('button', {
            type: 'button', className: 'rz-text-action rz-share-delete',
            onclick: () => deleteSharedLink(profile)
        }, [rzIcon('delete'), elm('span', {}, t('Delete'))])
    ]);

    return elm('div', { className: 'rz-share-row' }, [
        elm('div', { className: 'rz-share-row-head' }, [
            elm('strong', {}, profile.name),
            elm('span', { className: `rz-status-chip rz-tone-${tone}` }, t(label))
        ]),
        elm('p', { className: 'rz-muted' }, explanation === RZ_LINK_STATUS.active[2] ? seen : `${t(explanation)} ${seen}`),
        elm('div', { className: 'rz-share-facts' }, [
            elm('div', {}, [elm('span', {}, t('Expiry')), elm('strong', {}, expiry)]),
            elm('div', {}, [elm('span', {}, t('Observed fetches')), elm('strong', {}, `${profile.requests} · approximate`)]),
            elm('div', {}, [elm('span', {}, t('Created')), elm('strong', {}, rzFormatDate(profile.createdAt))])
        ]),
        elm('div', { className: 'rz-share-activity', title: t('Observed subscription fetches are approximate because KV counters are persisted coarsely.') }, [
            elm('span', { style: `width:${Math.max(4, Math.round(((Number(profile.requests) || 0) / maxObserved) * 100))}%` })
        ]),
        actions
    ]);
}

async function createSharedLink() {
    const button = document.getElementById('rz-share-create');
    const name = document.getElementById('rz-share-name')?.value || '';
    const days = Number(document.getElementById('rz-share-days')?.value || 0);

    if (button) button.disabled = true;
    try {
        const created = await rayzenApi('links/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, days })
        });
        await renderSharedLinks();
        // Opened straight away, because a link nobody copied is a link nobody can use,
        // and the operator's next action after creating one is always to send it.
        showSharedLinkTargets(created);
    } catch (error) {
        notify('error', t('The link could not be created'), [error.message]);
    } finally {
        if (button) button.disabled = false;
    }
}

async function toggleSharedLink(profile) {
    if (profile.enabled) {
        const confirmed = await notify('confirm', t('Revoke this link?'), [
            tf('Anyone holding “{name}” will stop connecting within minutes. Your own links and every other shared link keep working.', { name: profile.name }),
            t('You can re-enable it later; the link keeps the same URL.')
        ]);
        if (!confirmed) return;
    }

    await updateSharedLink(profile, profile.enabled ? 'disable' : 'enable');
}

async function deleteSharedLink(profile) {
    const confirmed = await notify('confirm', t('Delete this link?'), [
        tf('“{name}” will be removed along with when it was last used. This cannot be undone.', { name: profile.name }),
        t('To stop it working while keeping the record, revoke it instead.')
    ]);
    if (!confirmed) return;

    await updateSharedLink(profile, 'delete');
}

async function updateSharedLink(profile, action) {
    try {
        await rayzenApi('links/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: profile.token, action })
        });
        await renderSharedLinks();
    } catch (error) {
        notify('error', t('The link could not be updated'), [error.message]);
    }
}

/**
 * Shows the per-client URLs for one link.
 *
 * A dialog rather than a copy button, because a subscription URL is client-specific: the
 * same link has to be `?app=xray` for v2rayNG and a `sing-box://` wrapper for sing-box,
 * and copying the wrong one produces an import failure with no explanation.
 */
function showSharedLinkTargets(profile) {
    const kinds = rzSharedLinkKinds();
    const dialog = buildDialog(
        tf('Share “{name}”', { name: profile.name }),
        t('Send one of these to the person using this link. Each is the same link for a different client.')
    );
    const body = dialog.querySelector('.rz-dialog-body');

    if (!kinds.length) {
        body.append(elm('div', { className: 'rz-inline-error' }, [
            rzIcon('info'),
            elm('span', {}, t('Subscription details are still loading. Close this and try again in a moment.'))
        ]));
    }

    if (profile.status && profile.status !== 'active') {
        body.append(elm('div', { className: 'rz-inline-error' }, [
            rzIcon('info'),
            elm('span', {}, t('This link is not currently active, so these URLs will not connect until you re-enable it.'))
        ]));
    }

    kinds.forEach(([kind, label, cores]) => {
        const rows = cores.map(core => {
            const url = rzSharedLinkUrl(profile.token, kind, core, label);
            return elm('div', { className: 'rz-share-target' }, [
                elm('div', {}, [elm('strong', {}, core), elm('small', {}, url)]),
                elm('div', { className: 'rz-share-target-actions' }, [
                    elm('button', {
                        type: 'button', className: 'rz-text-action',
                        title: t('Copy subscription URL'), 'aria-label': `${t('Copy subscription URL')} — ${label} ${core}`,
                        onclick: () => copyToClipboard(url)
                    }, rzIcon('content_copy')),
                    elm('button', {
                        type: 'button', className: 'rz-text-action',
                        title: t('Display QR code'), 'aria-label': `${t('Display QR code')} — ${label} ${core}`,
                        onclick: () => { dialog.rzClose(); showQRCode(url); }
                    }, rzIcon('qr_code'))
                ])
            ]);
        });

        body.append(elm('section', { className: 'rz-share-group' }, [
            elm('p', { className: 'rz-card-label' }, label),
            ...rows
        ]));
    });

    document.body.append(dialog);
    dialog.querySelector('.rz-dialog-close').focus();
}

async function downloadRayZenBackup() {
    try {
        const backup = await rayzenApi('backup/export');
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = elm('a', { href: url, download: `rayzen-backup-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        await notify('info', 'Backup downloaded', ['Secrets and deployment identity were excluded. Keep your subscription identity separately.']);
    } catch (error) {
        await notify('error', 'Backup unavailable', [error.message]);
    }
}

async function previewRayZenRestore(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 512 * 1024) return notify('error', 'Backup too large', ['RayZen backups must be smaller than 512 KiB.']);
    try {
        const documentValue = JSON.parse(await file.text());
        const result = await rayzenApi('backup/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(documentValue) });
        const plan = result.plan;
        if (!plan.changes.length) return notify('info', 'Nothing to restore', ['Your configuration already matches this backup.']);
        const preview = plan.changes.slice(0, 12).map(change => `${change.key}: ${String(change.from)} → ${String(change.to)}`);
        const confirmed = await notify('confirm', 'Stage restore changes?', [
            `${plan.changes.length} setting${plan.changes.length === 1 ? '' : 's'} would change.`,
            ...preview,
            ...(plan.changes.length > preview.length ? [`…and ${plan.changes.length - preview.length} more`] : []),
            plan.refusedKeys.length ? `Protected values kept: ${plan.refusedKeys.join(', ')}` : '',
            '',
            'Nothing will be saved yet.'
        ].filter(Boolean));
        if (!confirmed) return;
        applyPatchToForm(plan.patch);
        goToView('configuration');
        await notify('info', 'Restore staged', ['Review the live preview and press Save configuration to apply it.']);
    } catch (error) {
        await notify('error', 'Backup could not be restored', [error instanceof SyntaxError ? 'This is not valid JSON.' : error.message]);
    }
}

function applyPatchToForm(patch) {
    const form = document.getElementById('configForm');
    if (!form) return;
    Object.entries(patch).forEach(([key, value]) => {
        if (key === 'ports' && Array.isArray(value)) {
            [...defaultHttpPorts, ...defaultHttpsPorts].forEach(port => {
                const control = form.querySelector(`input[name="${port}"]`);
                if (control) control.checked = value.map(Number).includes(port);
            });
            return;
        }
        const control = form.elements[key];
        if (!control) return;
        if (control instanceof RadioNodeList) {
            control.value = String(value);
        } else if (control.type === 'checkbox') {
            control.checked = Boolean(value);
        } else {
            control.value = Array.isArray(value) ? value.join('\n') : String(value ?? '');
        }
        control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    updateConfigurationPreview();
    handleProxyFormChanges(true);
}


const CONFIG_GUIDANCE = {
    'Common': ['Foundation', 'DNS, access and the private panel path used by every connection.'],
    'VLESS - Trojan': ['Connection identity', 'Choose protocols and credentials. Advanced transport detail stays collapsed.'],
    'Fragment': ['Resilience', 'Tune fragmentation only when your network needs it; defaults remain the safest start.'],
    'Warp': ['WARP routing', 'Manage endpoints and account behavior without leaving the configuration workflow.'],
    'Warp Pro': ['Advanced WARP', 'Noise and mode controls for constrained networks.'],
    'Routing Rules': ['Traffic policy', 'Choose what bypasses, blocks or follows special routes.'],
    'External Configs': ['External sources', 'Bring trusted remote configurations into RayZen.'],
    'Import - Export': ['Portability', 'Back up, restore or share settings deliberately.']
};

function bindRayZenActions() {
    const run = (action, event, target) => {
        const actions = {
            'logout': () => logout(event),
            'update-panel': () => updatePanel(target),
            'open-reset-password': () => openResetPass(event),
            'delete-panel': () => deletePanel(target),
            'remove-telegram': () => removeTelegramBot(target),
            'random-path': () => randPath(),
            'random-uuid': () => randUUID(),
            'random-password': () => randPassword(),
            'renew-warp': () => renewWarpAccounts(target),
            'add-noise': () => addNoise(true),
            'import-remote': () => importRemoteSettings(event),
            'share-settings': () => shareSettings(),
            'import-file': () => importFile(),
            'export-settings': () => exportFileSettings(event),
            'reset-settings': () => resetSettings(target),
            'copy-doh': () => copyDoh(),
            'refresh-ip': () => fetchIPInfo(),
            'open-scanner': () => switchRayZenView('intelligence')
        };
        actions[action]?.();
    };
    document.addEventListener('click', event => {
        const target = event.target.closest('[data-rz-action]');
        if (target) run(target.dataset.rzAction, event, target);
    });
    document.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="button"][data-rz-action]')) {
            event.preventDefault();
            run(event.target.dataset.rzAction, event, event.target);
        }
    });
    document.addEventListener('change', event => {
        const action = event.target.dataset.rzChange;
        if (action === 'fragment-mode') handleFragmentMode();
        if (action === 'risky-rules') handleRiskyRules(event);
        if (action === 'import-file-settings') importFileSettings(event);
        if (event.target.closest('#configForm')) updateConfigurationPreview();
    });
    document.addEventListener('input', event => {
        if (event.target.closest('#configForm')) updateConfigurationPreview();
    });
    document.addEventListener('submit', event => {
        const action = event.target.dataset.rzSubmit;
        if (action === 'configuration') updateSettings(event);
        if (action === 'telegram') setupTelegramBot(event);
    });
}

function completeRayZenLegacyMigration(legacy) {
    const configRoot = document.getElementById('rz-configuration-content');
    const subscriptionsRoot = document.getElementById('rz-subscriptions-content');
    const settingsRoot = document.getElementById('rz-settings-content');
    const configForm = document.getElementById('configForm');
    const adminCard = [...legacy.children].find(node => node.querySelector?.('#telegramForm'));
    const subscriptionCard = document.getElementById('subscriptions');
    const dohCard = [...legacy.children].find(node => node.querySelector?.('#doh'));
    const utilityCard = [...legacy.children].find(node => node.querySelector?.('#resetPassModal'));
    const clientsCard = [...legacy.children].find(node => node.querySelector?.('#supported-clients'));

    if (configForm && configRoot) {
        const sections = [...configForm.querySelectorAll(':scope > .accordion-item')];
        const sectionHost = elm('div', { className: 'rz-config-sections' });
        sections.forEach((section, index) => {
            const title = section.querySelector('summary h3')?.textContent.trim() || `Section ${index + 1}`;
            const [eyebrow, copy] = CONFIG_GUIDANCE[title] || ['Configuration', 'Adjust this group when your network requires it.'];
            section.classList.add('rz-config-section');
            section.dataset.section = title;
            const summary = section.querySelector('summary');
            summary?.append(elm('span', { className: 'rz-section-meta' }, [
                elm('small', {}, eyebrow), elm('span', {}, copy)
            ]));
            const details = section.querySelector('details');
            if (details) details.open = index === 0;
            sectionHost.append(section);
        });
        const remaining = [...configForm.children];
        const actions = elm('div', { className: 'rz-config-actions' });
        remaining.forEach(node => actions.append(node));
        configForm.replaceChildren(sectionHost, actions);
        const preview = elm('aside', { className: 'rz-config-preview', 'aria-label': 'Configuration preview' }, [
            elm('p', { className: 'rz-card-label' }, t('LIVE PREVIEW')),
            elm('h3', {}, t('Connection profile')),
            elm('p', { className: 'rz-muted' }, t('A readable summary of the settings you are about to save.')),
            elm('div', { id: 'rz-config-summary' }),
            elm('div', { className: 'rz-preview-note' }, [rzIcon('verified'), elm('span', {}, 'Existing server-side validation remains the final safety check.')])
        ]);
        configRoot.classList.add('rz-config-root');
        configRoot.replaceChildren(elm('div', { className: 'rz-config-layout' }, [configForm, preview]));
        updateConfigurationPreview();
    }

    if (subscriptionsRoot && subscriptionCard) {
        subscriptionCard.classList.add('rz-native-panel', 'rz-subscription-panel');
        const heading = subscriptionCard.querySelector('h2');
        if (heading) heading.replaceChildren(rzIcon('link'), 'Subscription links');
        subscriptionsRoot.replaceChildren(subscriptionCard);
        // Directly below the operator's own links, because the distinction between "your
        // link" and "a link you hand out" only makes sense side by side. `renderPanel`
        // fills it once settings arrive; until then it holds nothing rather than a
        // skeleton, since a failed read here is not a failed panel.
        subscriptionsRoot.append(elm('article', {
            className: 'rz-card rz-card-wide rz-share-card',
            id: 'rz-shared-links',
            'aria-live': 'polite'
        }));
    }
    if (settingsRoot) {
        buildSettingsWorkspace(settingsRoot, { adminCard, utilityCard, dohCard, clientsCard });
    }
    legacy.hidden = true;
}

function settingsActionRow(title, copy, action) {
    return elm('div', { className: 'rz-settings-action-row' }, [
        elm('div', {}, [elm('strong', {}, title), elm('p', {}, copy)]), action
    ]);
}

function buildAppearanceSettingsCard() {
    const themeButtons = RZ_THEME_OPTIONS.map(([id, label]) => elm('button', {
        type: 'button',
        className: 'rz-theme-choice',
        'data-theme-choice': id,
        'aria-pressed': 'false',
        onclick: () => setAppearanceChoice('theme', id)
    }, [
        elm('span', { className: `rz-theme-swatch rz-theme-swatch-${id}`, 'aria-hidden': 'true' }),
        elm('strong', {}, t(label)),
        rzIcon('check_circle')
    ]));
    const modes = [['', 'System', 'Follow this device'], ['light', 'Light', 'Bright workspace'], ['dark', 'Dark', 'Low-light comfort']];
    const modeButtons = modes.map(([id, label, copy]) => elm('button', {
        type: 'button',
        className: 'rz-mode-choice',
        'data-mode-choice': id,
        'aria-pressed': 'false',
        onclick: () => setAppearanceChoice('mode', id)
    }, [rzIcon(id === 'dark' ? 'security' : id === 'light' ? 'healthy' : 'settings'), elm('span', {}, [elm('strong', {}, t(label)), elm('small', {}, t(copy))])]));
    const card = elm('article', { className: 'rz-settings-card rz-appearance-card' }, [
        elm('div', { className: 'rz-settings-card-heading' }, [
            elm('div', {}, [elm('p', { className: 'rz-card-label' }, t('APPEARANCE')), elm('h3', {}, t('Appearance')), elm('p', {}, t('Choose a theme and contrast mode.'))]),
            elm('div', { className: 'rz-current-appearance' }, [elm('span', { 'data-current-theme': '' }), elm('span', { 'data-current-mode': '' })])
        ]),
        elm('p', { className: 'rz-setting-label' }, t('Color theme')),
        elm('div', { className: 'rz-theme-grid', role: 'group', 'aria-label': t('Color theme') }, themeButtons),
        elm('p', { className: 'rz-setting-label' }, t('Appearance mode')),
        elm('div', { className: 'rz-mode-grid', role: 'group', 'aria-label': t('Appearance mode') }, modeButtons)
    ]);
    queueMicrotask(refreshAppearanceControls);
    return card;
}

function buildSettingsWorkspace(root, { adminCard, utilityCard, dohCard, clientsCard }) {
    // QR and password dialogs are global interactions. Keep them outside view containers
    // so opening one from Subscriptions cannot inherit a hidden Settings ancestor.
    for (const modal of [document.getElementById('qrModal'), document.getElementById('resetPassModal')]) {
        if (modal && modal.parentElement !== document.body) document.body.append(modal);
    }
    root.replaceChildren();
    root.className = 'rz-grid rz-settings-workspace';
    const definitions = [
        ['workspace', 'tune', 'Workspace'], ['telegram', 'share', 'Telegram'], ['deployment', 'cloud_download', 'Deployment'], ['account', 'security', 'Account'], ['maintenance', 'settings_backup_restore', 'Maintenance']
    ];
    const tabs = elm('div', { className: 'rz-settings-tabs', role: 'tablist', 'aria-label': 'Settings sections' }, definitions.map(([id, icon, label], index) =>
        elm('button', { type: 'button', role: 'tab', className: index ? '' : 'active', 'aria-selected': String(index === 0), 'aria-controls': `rz-settings-${id}`, 'data-settings-tab': id, onclick: () => switchSettingsTab(id) }, [rzIcon(icon), elm('span', {}, t(label))])
    ));
    const panels = Object.fromEntries(definitions.map(([id]) => [id, elm('section', { className: 'rz-settings-panel', id: `rz-settings-${id}`, role: 'tabpanel', hidden: id !== 'workspace' })]));

    panels.workspace.append(buildAppearanceSettingsCard());
    const usage = adminCard?.querySelector('.container.section');
    if (usage) {
        usage.classList.add('rz-settings-card', 'rz-usage-card');
        panels.workspace.append(usage);
    }
    if (utilityCard) {
        utilityCard.classList.add('rz-native-panel', 'rz-settings-card', 'rz-network-card');
        panels.workspace.append(utilityCard);
    }

    const telegram = adminCard?.querySelector('#telegramForm');
    if (telegram) {
        telegram.classList.add('rz-settings-card', 'rz-telegram-card');
        const details = telegram.querySelector('details');
        if (details) details.open = true;
        panels.telegram.append(telegram);
    } else {
        panels.telegram.append(elm('article', { className: 'rz-settings-card rz-empty' }, [rzIcon('smart'), elm('h3', {}, 'Telegram is unavailable'), elm('p', {}, 'This deployment did not load its Telegram controls.') ]));
    }

    panels.deployment.append(buildDeploymentCard());
    for (const card of [dohCard, clientsCard]) {
        if (card) { card.classList.add('rz-native-panel', 'rz-settings-card', 'rz-settings-utility'); panels.deployment.append(card); }
    }

    const resetPassword = document.getElementById('openResetPass');
    if (resetPassword) resetPassword.classList.add('rz-secondary-action');
    panels.account.append(elm('article', { className: 'rz-settings-card rz-account-card' }, [
        elm('div', { className: 'rz-settings-card-heading' }, [elm('div', {}, [elm('p', { className: 'rz-card-label' }, 'ACCOUNT ACCESS'), elm('h3', {}, 'Panel access'), elm('p', {}, 'Manage sign-in and session access.')]), rzIcon('verified')]),
        settingsActionRow('Panel password', 'Change your sign-in password.', resetPassword || elm('span')),
        settingsActionRow('Current session', 'Sign out of this browser.', elm('button', { type: 'button', className: 'button rz-secondary-action', 'data-rz-action': 'logout' }, [rzIcon('logout'), 'Log out']))
    ]));

    const update = document.getElementById('updatePanel');
    const remove = document.getElementById('deletePanel');
    if (update) update.classList.add('rz-secondary-action');
    panels.maintenance.append(elm('article', { className: 'rz-settings-card rz-maintenance-card' }, [
        elm('div', { className: 'rz-settings-card-heading' }, [elm('div', {}, [elm('p', { className: 'rz-card-label' }, 'MAINTENANCE'), elm('h3', {}, 'Maintenance'), elm('p', {}, 'Updates, backups, resets, and removal.')]), rzIcon('settings_backup_restore')]),
        settingsActionRow('Update RayZen', 'Install the latest available build.', update || elm('span')),
        settingsActionRow('Safe backup', 'Export settings without credentials.', elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: downloadRayZenBackup }, [rzIcon('download'), 'Download'])),
        settingsActionRow('Restore preview', 'Review a backup before restoring.', elm('label', { className: 'button rz-secondary-action rz-file-button' }, [rzIcon('upload'), elm('span', {}, 'Choose file'), elm('input', { type: 'file', accept: 'application/json,.json', onchange: previewRayZenRestore })])),
        settingsActionRow('Reset configuration', 'Restore non-identity defaults.', elm('button', { type: 'button', className: 'button rz-secondary-action', onclick: event => resetSettings(event.currentTarget) }, 'Reset settings')),
        settingsActionRow('Delete deployment', 'Permanently remove this panel.', remove || elm('span'))
    ]));

    root.append(tabs, ...definitions.map(([id]) => panels[id]));
    queueMicrotask(refreshAppearanceControls);
}

function switchSettingsTab(id) {
    document.querySelectorAll('[data-settings-tab]').forEach(tab => {
        const active = tab.dataset.settingsTab === id;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.rz-settings-panel').forEach(panel => { panel.hidden = panel.id !== `rz-settings-${id}`; });
}

function openAppearanceControls() {
    if (window.matchMedia('(max-width:900px)').matches) {
        document.querySelector('.rz-mobile-more')?.click();
        setTimeout(() => document.querySelector('#rz-sheet-appearance .rz-appearance-select')?.focus(), 50);
        return;
    }
    document.querySelector('.rz-sidebar .rz-appearance-select')?.focus();
}

function updateConfigurationPreview() {
    const root = document.getElementById('rz-config-summary');
    const form = document.getElementById('configForm');
    if (!root || !form) return;
    const value = id => form.elements[id]?.value || 'Not set';
    const ports = [...form.querySelectorAll('#tls-ports input:checked, #non-tls-ports input:checked')].map(input => input.name);
    const rows = [
        ['Protocols', value('protocols').replaceAll(',', ' + ')],
        ['Clean IP', (value('cleanIPs') || 'Default hostname').split(/[\r\n,]+/u)[0]],
        ['Remote DNS', value('remoteDNS')],
        ['Ports', ports.length ? `${ports.length} selected` : 'Use saved selection'],
        ['Fragment', value('fragmentMode')],
        ['ECH', formBoolean('enableECH') ? 'Enabled' : 'Off'],
        ['IPv6', formBoolean('enableIPv6') ? 'Enabled' : 'Off']
    ];
    root.replaceChildren(...rows.map(([label,current]) => elm('div', { className: 'rz-preview-row' }, [elm('span', {}, t(label)), elm('strong', {}, current)])), elm('div',{className:'rz-preview-actions'},[elm('button',{type:'button',className:'button rz-action',onclick:jumpToSubscriptions},[rzIcon('content_copy'),t('Copy subscription')]),elm('button',{type:'button',className:'button rz-secondary-action',onclick:jumpToSubscriptions},[rzIcon('download'),t('Import')])]));
}


// The panel markup's own strings. Keys are the exact trimmed English text from
// index.html so rzTranslateTree() can match them. Protocol, product and fingerprint
// identifiers (VLESS, Trojan, ECH, NAT64, tlshello, chrome…) stay Latin on purpose:
// Persian users read and search for them that way.
Object.assign(RZ_FA, {
 'Aurora':'شفق','Ocean':'اقیانوس','Lavender':'اسطوخودوس','Sunset':'غروب','Midnight':'نیمه‌شب','SYSTEM HEALTH':'سلامت سیستم','IMPORTANT NOW':'مهم‌ترین اقدام','Your RayZen setup is healthy':'راه‌اندازی ری‌زن سالم است','Your setup needs attention':'راه‌اندازی شما نیاز به توجه دارد','Your setup is working well':'راه‌اندازی شما به‌خوبی کار می‌کند','View diagnostics':'مشاهده عیب‌یابی','Review checks':'بررسی وضعیت‌ها','Everything important looks good':'همه موارد مهم مناسب هستند','No immediate action is required.':'اکنون اقدامی لازم نیست.','Review the recommendation before conditions change.':'پیشنهاد را پیش از تغییر شرایط بررسی کنید.','Optimize':'بهینه‌سازی','Review':'بررسی','Endpoint':'نقطه پایانی','Security':'امنیت','Setup intelligence':'هوش راه‌اندازی','score':'امتیاز','recommendation':'پیشنهاد','recommendations':'پیشنهاد','Ready to generate':'آماده تولید','Stable':'پایدار','DIAGNOSTIC STATUS':'وضعیت عیب‌یابی','PROBLEM':'مشکل','CHECK':'بررسی','Good':'خوب','Warning':'هشدار','Critical':'بحرانی','Impact':'اثر','Cause':'علت','Action':'اقدام','No impact detected.':'اثری شناسایی نشد.','Connection quality or reliability may decrease.':'کیفیت یا پایداری اتصال ممکن است کاهش یابد.','No action needed.':'اقدامی لازم نیست.','Copy subscription':'کپی اشتراک','Import':'ورود','Confidence':'اطمینان','Health, configuration and endpoint intelligence — ready when you are.':'سلامت، پیکربندی و هوش نقاط پایانی — همیشه در دسترس شما.','Your RayZen control center':'مرکز کنترل ری‌زن شما','System healthy':'سیستم سالم است','Working with suggestions':'فعال با چند پیشنهاد','Setup incomplete':'راه‌اندازی ناقص است','Needs attention':'نیاز به توجه','Try again':'تلاش دوباره','This view could not load':'این بخش بارگیری نشد','RayZen could not read this signal.':'ری‌زن نتوانست این سیگنال را بخواند.','Status':'وضعیت','Problem':'مشکل','Details':'جزئیات','Open configuration and review the related setting.':'پیکربندی را باز و تنظیم مرتبط را بررسی کنید.','Protocols':'پروتکل‌ها','Remote DNS':'دی‌ان‌اس راه دور','Ports':'درگاه‌ها','Fragment':'قطعه‌بندی','Enabled':'فعال','Off':'خاموش','Use saved selection':'استفاده از انتخاب ذخیره‌شده','selected':'انتخاب‌شده','Connection profile':'پروفایل اتصال','LIVE PREVIEW':'پیش‌نمایش زنده','Appearance':'ظاهر','Color theme':'تم رنگی','Appearance mode':'حالت نمایش','System ready':'سیستم آماده است',
 'Admin':'مدیریت','Last 24h Requests':'درخواست‌های ۲۴ ساعت گذشته','Total':'کل',
 'Update Panel':'به‌روزرسانی پنل','Update':'به‌روزرسانی','Reset Password':'بازنشانی رمز عبور','Reset':'بازنشانی','Delete Panel':'حذف پنل','Delete':'حذف',
 'Telegram Bot':'ربات Telegram','Telegram Bot Token':'توکن ربات Telegram','Telegram User ID':'شناسه کاربری Telegram','Setup':'راه‌اندازی','Remove':'حذف',
 'Proxy Settings':'تنظیمات پروکسی','Common':'عمومی',
 'Local DNS':'دی‌ان‌اس محلی','Anti Sanction DNS':'دی‌ان‌اس ضدتحریم','Fake DNS':'دی‌ان‌اس جعلی','Disabled':'غیرفعال',
 'Allow connections from LAN':'اجازه اتصال از شبکه محلی','Log Level':'سطح گزارش','Error':'خطا','Info':'اطلاعات','Debug':'اشکال‌زدایی',
 'Client compatibility':'سازگاری کلاینت','Universal (recommended)':'همگانی (پیشنهادی)','Latest cores only':'فقط هسته‌های جدید',
 'Universal generates configs every mainstream core accepts — v2rayNG, v2rayN, Streisand, Hiddify — with fragmentation on a freedom dialer and no version floor. Latest uses Xray 26 features (finalmask, happy eyeballs) and only runs on the newest cores.':'حالت همگانی کانفیگ‌هایی می‌سازد که همهٔ هسته‌های رایج می‌پذیرند — v2rayNG، v2rayN، Streisand، Hiddify — با قطعه‌بندی روی دایلر freedom و بدون تعیین حداقل نسخه. حالت «فقط هسته‌های جدید» از قابلیت‌های Xray 26 استفاده می‌کند و تنها روی جدیدترین هسته‌ها کار می‌کند.',
 'Custom Domain':'دامنه سفارشی','Underlying DoH':'DoH پایه','DNS over HTTPS':'دی‌ان‌اس روی HTTPS','VLESS UUID':'شناسه VLESS','Panel - Subscriptions Path':'مسیر پنل و اشتراک‌ها','Fallback Domain':'دامنه جایگزین',
 'VLESS - Trojan':'VLESS و Trojan','VLESS & Trojan':'VLESS و Trojan','Trojan Password':'رمز Trojan','Upstream TCP Proxy':'پروکسی TCP بالادست','Chain Proxy':'پروکسی زنجیره‌ای','Clean IPs - Domains':'آی‌پی‌ها و دامنه‌های تمیز',
 'TLS Ports':'درگاه‌های TLS','non-TLS Ports':'درگاه‌های بدون TLS','Fingerprint':'فینگرپرینت','Best Ping Interval':'بازه بهترین پینگ',
 'Proxy IP':'آی‌پی پروکسی','Mode':'حالت','Proxy IPs - Domains':'آی‌پی‌ها و دامنه‌های پروکسی','NAT64 Prefixes':'پیشوندهای NAT64',
 'ECH needs a compatible core (sing-box 1.13+ or an Xray build with ECH support). Older clients silently ignore it — leave disabled if you are unsure.':'ECH به هستهٔ سازگار نیاز دارد (sing-box نسخه ۱.۱۳ به بالا یا نسخه‌ای از Xray با پشتیبانی ECH). کلاینت‌های قدیمی‌تر بدون هیچ خطایی آن را نادیده می‌گیرند — اگر مطمئن نیستید غیرفعال بگذارید.',
 'ECH Server Name':'نام سرور ECH','Custom CDN':'CDN سفارشی','Addresses':'آدرس‌ها','Host':'هاست',
 'Config Naming':'نام‌گذاری کانفیگ‌ها','Field separator':'جداکننده فیلدها','Trailing mark (blank to disable)':'نشانه پایانی (برای غیرفعال کردن خالی بگذارید)',
 'Xray Fragment':'قطعه‌بندی Xray','Custom':'سفارشی','Low':'کم','Medium':'متوسط','High':'زیاد','Severe':'شدید',
 'Packets':'بسته‌ها','Length':'طول','Delay':'تأخیر','Max Split':'حداکثر تقسیم',
 'External Raw Configs':'کانفیگ‌های خارجی','Subscriptions':'اشتراک‌ها','Single Configs':'کانفیگ‌های تکی',
 'Warp General':'تنظیمات عمومی Warp','Endpoints':'نقاط پایانی','Reserved Bytes':'بایت‌های رزرو','Renew Warp Accounts':'تمدید حساب‌های Warp','Renew':'تمدید',
 'MahsaNG Noise':'نویز MahsaNG','Count':'تعداد','Size':'اندازه','Clash - Amnezia Noise':'نویز Clash و Amnezia','v2ray Noise':'نویز v2ray',
 "Fill in 'none', 'quic', 'random', or any HEX string like 'ee0000000108aaaa'":"مقدار 'none'، 'quic'، 'random' یا هر رشتهٔ HEX مانند 'ee0000000108aaaa' را وارد کنید",
 'Routing Rules':'قوانین مسیریابی','Preset Rules':'قوانین آماده','Bypass rules':'قوانین عبور مستقیم','Iran':'ایران','China':'چین','Russia':'روسیه',
 'Block rules':'قوانین مسدودسازی','Ads.':'تبلیغات','Porn':'محتوای غیراخلاقی','Malware':'بدافزار','Phishing':'فیشینگ','Cryptominers':'استخراج‌کنندگان رمزارز',
 'Custom Rules':'قوانین سفارشی','Bypass IPs - Domains':'آی‌پی‌ها و دامنه‌های عبور مستقیم','Block IPs - Domains':'آی‌پی‌ها و دامنه‌های مسدود',
 'Sanction Rules':'قوانین تحریم','Google AIs':'هوش مصنوعی Google','Bypass Domains':'دامنه‌های عبور مستقیم',
 'Import - Export':'ورود و خروجی','Remote Settings':'تنظیمات راه دور','Remote URL':'نشانی راه دور','Import Remote':'دریافت از راه دور',
 'Share Yours':'اشتراک‌گذاری تنظیمات شما','Share':'اشتراک‌گذاری','File Settings':'تنظیمات فایل','Import File':'دریافت از فایل','Export File':'خروجی فایل','Export':'خروجی',
 'Apply':'اعمال','Reset panel settings to default':'بازگرداندن تنظیمات پنل به حالت پیش‌فرض','Ok':'تایید','Cancel':'انصراف',
 'Cloudflare Email':'ایمیل Cloudflare','New Password':'رمز عبور جدید','Confirm Password':'تکرار رمز عبور','Save':'ذخیره',
 'My IP':'آی‌پی من','Information':'اطلاعات','Cloudflare targets':'مقصدهای Cloudflare','Other targets':'سایر مقصدها','Country':'کشور','City':'شهر','ISP':'سرویس‌دهندهٔ اینترنت',
 'Supported Clients':'کلاینت‌های پشتیبانی‌شده','Client':'کلاینت','Minimum Requirement':'حداقل نسخهٔ لازم','Get Latest':'دریافت آخرین نسخه','Sort supported clients by name':'مرتب‌سازی کلاینت‌ها بر اساس نام','Sort supported clients by minimum requirement':'مرتب‌سازی کلاینت‌ها بر اساس حداقل نسخه','Sort supported clients by source':'مرتب‌سازی کلاینت‌ها بر اساس منبع','No supported clients are available.':'کلاینت پشتیبانی‌شده‌ای در دسترس نیست.',
 'Scanner':'اسکنر','Proxy IPs':'آی‌پی‌های پروکسی','Close':'بستن'
});

// Shared subscription links. Client core names (xray, sing-box, clash) stay Latin, as
// every protocol and product name in this dictionary does.
//
// Sentences that carry a value are one key with a `{placeholder}`, not two fragments
// concatenated around it: Persian puts the clauses in a different order, so a fragment
// pair cannot be translated correctly no matter what the translator writes.
Object.assign(RZ_FA, {
 'SHARED LINKS':'لینک‌های اشتراکی',
 'Give each person their own link':'به هر فرد لینک اختصاصی بدهید',
 'Your own subscription links above never expire and cannot be revoked without changing your panel path. A shared link can be switched off on its own, so cutting one person off leaves everyone else working.':'لینک‌های اشتراک خودتان در بالا هیچ‌گاه منقضی نمی‌شوند و بدون تغییر مسیر پنل قابل لغو نیستند. یک لینک اشتراکی را می‌توان به‌تنهایی خاموش کرد، بنابراین قطع دسترسی یک نفر روی بقیه اثری ندارد.',
 'Who is this for?':'این لینک برای چه کسی است؟',
 'Phone, laptop, a friend’s name…':'گوشی، لپ‌تاپ، نام یک دوست…',
 'Stops working after':'پایان اعتبار پس از',
 'Never':'هرگز',
 '7 days':'۷ روز',
 '30 days':'۳۰ روز',
 '90 days':'۹۰ روز',
 '1 year':'۱ سال',
 'Create link':'ساخت لینک',
 'Revoke a link before creating another.':'برای ساخت لینک جدید، یکی از لینک‌ها را لغو کنید.',
 'This deployment holds the maximum of {max} shared links. Revoke one to create another.':'این استقرار حداکثر {max} لینک اشتراکی را نگه می‌دارد. برای ساخت لینک جدید یکی را لغو کنید.',
 'No shared links yet. Create one above, then send it instead of your own subscription URL.':'هنوز لینک اشتراکی ندارید. یکی در بالا بسازید و به‌جای نشانی اشتراک خودتان آن را بفرستید.',
 'Active':'فعال',
 'Revoked':'لغو‌شده',
 'This link works right now.':'این لینک در حال حاضر کار می‌کند.',
 'This link is switched off. Nobody holding it can connect.':'این لینک خاموش است. هیچ‌کس با آن نمی‌تواند متصل شود.',
 'This link passed its expiry date and no longer works.':'تاریخ اعتبار این لینک گذشته و دیگر کار نمی‌کند.',
 'Last seen {when}':'آخرین استفاده {when}',
 'Not used yet':'هنوز استفاده نشده',
 'Expires {date}':'انقضا {date}',
 'Expired {date}':'منقضی‌شده در {date}',
 'No expiry':'بدون انقضا',
 'Expiry':'انقضا',
 'Fetches seen':'دریافت‌های ثبت‌شده',
 'Created':'ساخته‌شده',
 'Copy link':'کپی لینک',
 'Revoke':'لغو',
 'Re-enable':'فعال‌سازی دوباره',
 'Revoke this link?':'این لینک لغو شود؟',
 'Anyone holding “{name}” will stop connecting within minutes. Your own links and every other shared link keep working.':'هر کسی که «{name}» را دارد، در چند دقیقه دسترسی‌اش قطع می‌شود. لینک‌های خودتان و سایر لینک‌های اشتراکی کار می‌کنند.',
 'You can re-enable it later; the link keeps the same URL.':'می‌توانید بعداً دوباره فعالش کنید؛ نشانی لینک تغییر نمی‌کند.',
 'Delete this link?':'این لینک حذف شود؟',
 '“{name}” will be removed along with when it was last used. This cannot be undone.':'«{name}» همراه با زمان آخرین استفاده حذف می‌شود. این کار بازگشت‌پذیر نیست.',
 'To stop it working while keeping the record, revoke it instead.':'اگر می‌خواهید کار نکند اما سابقه‌اش بماند، به‌جای حذف آن را لغو کنید.',
 'The link could not be created':'لینک ساخته نشد',
 'The link could not be updated':'لینک به‌روزرسانی نشد',
 'Share “{name}”':'اشتراک «{name}»',
 'Send one of these to the person using this link. Each is the same link for a different client.':'یکی از این‌ها را برای فرد استفاده‌کننده بفرستید. همه یک لینک هستند، برای کلاینت‌های مختلف.',
 'Subscription details are still loading. Close this and try again in a moment.':'جزئیات اشتراک هنوز بارگیری می‌شود. این پنجره را ببندید و کمی بعد دوباره تلاش کنید.',
 'This link is not currently active, so these URLs will not connect until you re-enable it.':'این لینک فعال نیست، بنابراین این نشانی‌ها تا زمانی که دوباره فعالش نکنید متصل نمی‌شوند.',
 'Copy subscription URL':'کپی نشانی اشتراک',
 'Display QR code':'نمایش کد QR'
});

// Device-side scanner vocabulary. Cloudflare, ISP and the address notation stay
// Latin, as protocol and product names do elsewhere in this dictionary.
Object.assign(RZ_FA, {
 'SCAN FROM THIS DEVICE':'اسکن از این دستگاه',
 'Find the fastest Cloudflare edge for your network':'سریع‌ترین لبهٔ Cloudflare را برای شبکهٔ خود پیدا کنید',
 'Quick scan':'اسکن سریع',
 'Deep scan':'اسکن عمیق',
 'Quick':'سریع',
 'Deep':'عمیق',
 'Stop':'توقف',
 'addresses':'آدرس',
 'Preparing…':'در حال آماده‌سازی…',
 'Measuring':'در حال اندازه‌گیری',
 'addresses from your device':'آدرس از دستگاه شما',
 'control':'شاهد',
 'measured':'اندازه‌گیری‌شده',
 'reachable':'قابل دسترس',
 'elapsed':'زمان صرف‌شده',
 'median score':'میانهٔ امتیاز',
 'median':'میانه',
 'score':'امتیاز',
 'answered':'پاسخ‌داده',
 'jitter':'نوسان',
 'ms':'میلی‌ثانیه',
 's':'ثانیه',
 'FASTEST FROM YOUR NETWORK':'سریع‌ترین از شبکهٔ شما',
 'RANKED ADDRESSES':'آدرس‌های رتبه‌بندی‌شده',
 'BEST ADDRESS BLOCKS':'بهترین بلوک‌های آدرس',
 'An individual address can be withdrawn at any time; the block it belongs to is a more stable statement about what your ISP routes well. Later scans start with the blocks that have performed best here.':'یک آدرس مشخص ممکن است هر زمان از دسترس خارج شود؛ بلوکی که به آن تعلق دارد بیان پایدارتری از مسیرهایی است که سرویس‌دهندهٔ شما خوب هدایت می‌کند. اسکن‌های بعدی از بلوک‌هایی آغاز می‌شوند که اینجا بهترین عملکرد را داشته‌اند.',
 'Copy address':'کپی آدرس',
 'Address copied':'آدرس کپی شد',
 'Could not copy':'کپی انجام نشد',
 'Stage top five as clean IPs':'پنج مورد برتر به‌عنوان آی‌پی تمیز آماده شود',
 'Staged for review':'آماده برای بازبینی',
 'addresses were placed in the Clean IP field.':'آدرس در فیلد آی‌پی تمیز قرار گرفت.',
 'Nothing is saved until you press Save configuration.':'تا زمانی که ذخیرهٔ پیکربندی را نزنید چیزی ذخیره نمی‌شود.',
 'Configuration form not loaded':'فرم پیکربندی بارگیری نشده است',
 'Open Configuration first, then run the scan again.':'ابتدا پیکربندی را باز کنید، سپس اسکن را دوباره اجرا کنید.',
 'Stopped early, so this covers only part of the address space.':'پیش از پایان متوقف شد، بنابراین تنها بخشی از فضای آدرس را پوشش می‌دهد.',
 'addresses returned a real response instead of refusing the connection, which means something on the path answered for them. They are excluded.':'آدرس به‌جای رد کردن اتصال پاسخ واقعی دادند، یعنی چیزی در مسیر به‌جای آن‌ها پاسخ داده است. این‌ها از نتایج حذف شده‌اند.',
 'No address responded from this network. That is itself a finding: this connection reaches no Cloudflare edge directly.':'هیچ آدرسی از این شبکه پاسخ نداد. این خودش یک یافته است: این اتصال به هیچ لبهٔ Cloudflare به‌طور مستقیم نمی‌رسد.',
 'CHECK CONFIGURED ENDPOINTS':'بررسی نقاط پایانی تنظیم‌شده',
 'Measure endpoints. Keep control.':'نقاط پایانی را اندازه بگیرید. کنترل را در دست داشته باشید.',
 'Measured from the Worker, which answers whether an endpoint is alive rather than how fast it is for you. Use the device scan above for that.':'از Worker اندازه‌گیری می‌شود و پاسخ می‌دهد که یک نقطهٔ پایانی فعال است یا نه، نه اینکه برای شما چقدر سریع است. برای آن از اسکن دستگاه در بالا استفاده کنید.',
 'excellent':'عالی',
 'good':'خوب',
 'usable':'قابل استفاده',
 'slow':'کند',
 'unreachable':'غیرقابل دسترس',
 'intercepted':'دستکاری‌شده',
 'LEARNED ACROSS SCANS':'آموخته‌شده در طول اسکن‌ها',
 'scans over':'اسکن در طول',
 'days':'روز',
 'confidence':'اطمینان',
 'MEASURED RECOMMENDATIONS':'پیشنهادهای اندازه‌گیری‌شده',
 'Optimize my connection':'بهینه‌سازی اتصال من',
 'Uses only what has been measured on this deployment: device scans, diagnostics and your own settings. If nothing has been measured it says so rather than guessing.':'تنها از آنچه روی این استقرار اندازه‌گیری شده استفاده می‌کند: اسکن‌های دستگاه، عیب‌یابی و تنظیمات خودتان. اگر چیزی اندازه‌گیری نشده باشد، همین را می‌گوید و حدس نمی‌زند.',
 'Check what the evidence supports':'بررسی کن شواهد چه چیزی را تأیید می‌کند',
 'Checking what the measurements support…':'در حال بررسی آنچه اندازه‌گیری‌ها تأیید می‌کنند…',
 'Based on':'بر پایهٔ',
 'Nothing needs changing on the evidence available.':'بر پایهٔ شواهد موجود چیزی نیاز به تغییر ندارد.',
 'Run a device scan above, then check again.':'ابتدا اسکن دستگاه را در بالا اجرا کنید، سپس دوباره بررسی کنید.',
 'Stage this':'آماده‌سازی این مورد',
 'Open Configuration first, then try again.':'ابتدا پیکربندی را باز کنید، سپس دوباره تلاش کنید.',
 'USER CONTROLLED':'زیر کنترل کاربر',
 'RayZen recommends. You decide.':'ری‌زن پیشنهاد می‌دهد. شما تصمیم می‌گیرید.',
 'The profiles below are rule-based suggestions from your saved settings, not measurements. Reviewing one only stages a change in the configuration form; it never switches an endpoint or edits a subscription silently.':'پروفایل‌های زیر پیشنهادهایی بر پایهٔ قاعده از تنظیمات ذخیره‌شدهٔ شما هستند، نه اندازه‌گیری. بازبینی هر یک تنها تغییری را در فرم پیکربندی آماده می‌کند و هرگز به‌طور خودکار نقطهٔ پایانی را عوض یا اشتراکی را ویرایش نمی‌کند.',
 'high':'بالا',
 'medium':'متوسط',
 'low':'پایین',
 'Apply IP':'اعمال آی‌پی',
 'Save IP':'ذخیره آی‌پی',
 'Copy':'کپی'
});

Object.assign(RZ_FA, {
 'English':'انگلیسی',
 'Smart':'هوشمند',
 'Connection is healthy, with one improvement':'اتصال سالم است و یک مورد برای بهبود دارد',
 'Connection health needs attention':'سلامت اتصال نیاز به بررسی دارد',
 'Connection is ready while measurements build':'اتصال آماده است؛ داده‌های اندازه‌گیری در حال تکمیل‌اند',
 'Connection is healthy and ready':'اتصال سالم و آماده است',
 'Setup needs one final step':'راه‌اندازی یک گام دیگر نیاز دارد',
 'LATENCY':'تأخیر',
 'SHARED LINKS':'لینک‌های اشتراکی',
 'SCANNER CONFIDENCE':'اطمینان اسکنر',
 'Your connection at a glance':'وضعیت اتصال در یک نگاه',
 'Health, active settings and the next useful action in one place.':'سلامت، تنظیمات فعال و اقدام بعدی در یک نمای واحد.',
 'DO THIS NEXT':'اقدام پیشنهادی بعدی',
 'Run a device scan':'اسکن دستگاه را اجرا کنید',
 'RayZen selected the next action with the highest likely impact based on current evidence.':'ری‌زن بر پایهٔ شواهد فعلی، مؤثرترین اقدام بعدی را انتخاب کرده است.',
 'Open Smart Setup':'باز کردن راه‌اندازی هوشمند',
 'ACTIVE CONNECTION':'اتصال فعال',
 'TRANSPORT':'انتقال',
 'CURRENT ENDPOINT':'نقطهٔ پایانی فعلی',
 'TRAFFIC · 24H REQUESTS':'ترافیک · درخواست‌های ۲۴ ساعت',
 'ACTIVE SHARED LINKS':'لینک‌های اشتراکی فعال',
 'Open configuration':'باز کردن پیکربندی',
 'Open subscriptions':'باز کردن اشتراک‌ها',
 'RECOMMENDATION':'پیشنهاد',
 'Apply the Balanced preset':'اعمال پروفایل متعادل',
 'Sensible defaults for a working connection.':'تنظیمات پایهٔ منطقی برای یک اتصال پایدار.',
 'Review recommendation':'بررسی پیشنهاد',
 'View measurement history':'مشاهدهٔ تاریخچهٔ اندازه‌گیری',
 'Run a device scan to add network-specific evidence.':'برای افزودن شواهد مخصوص این شبکه، اسکن دستگاه را اجرا کنید.',
 'Solve connection issues':'رفع مشکلات اتصال',
 'See what was detected, why it matters and the direct action to take.':'ببینید چه چیزی شناسایی شده، چرا مهم است و چه اقدامی باید انجام دهید.',
 'CONFIGURATION HEALTH':'سلامت پیکربندی',
 'CONFIGURATION SCORE':'امتیاز پیکربندی',
 'Run live tests':'اجرای آزمون‌های زنده',
 'RESOLVER':'حل‌کنندهٔ DNS',
 'Saved resolver':'حل‌کنندهٔ ذخیره‌شده',
 'TLS MODE':'حالت TLS',
 'Active client transport':'انتقال فعال کلاینت',
 'ECH':'ECH',
 'Standard TLS handshake':'دست‌دهی استاندارد TLS',
 'FRAGMENT MODE':'حالت قطعه‌بندی',
 'Saved transport behavior':'رفتار انتقال ذخیره‌شده',
 'IPV6':'IPv6',
 'Client routing preference':'ترجیح مسیریابی کلاینت',
 'Retained scanner history':'تاریخچهٔ ذخیره‌شدهٔ اسکنر',
 'PROBE LOSS ESTIMATE':'برآورد عدم پاسخ پروب',
 'Not measured':'اندازه‌گیری نشده',
 'Requires device scan':'نیازمند اسکن دستگاه',
 'Connection':'اتصال',
 'Live browser and device measurements':'اندازه‌گیری زندهٔ مرورگر و دستگاه',
 'STABILITY':'پایداری',
 'Stable':'پایدار',
 'Variable':'متغیر',
 'Needs a device scan':'نیازمند اسکن دستگاه',
 'PACKET BEHAVIOR':'رفتار بسته‌ها',
 'Probe attempts answered':'پروب‌های پاسخ‌داده‌شده',
 'DNS PERFORMANCE':'کارایی DNS',
 'Not tested':'آزمایش نشده',
 'Unavailable':'در دسترس نیست',
 'Configured resolver answered':'حل‌کنندهٔ تنظیم‌شده پاسخ داد',
 'Protocols':'پروتکل‌ها',
 'Availability from saved configuration':'دسترس‌پذیری بر پایهٔ پیکربندی ذخیره‌شده',
 'Refresh device scan':'تازه‌سازی اسکن دستگاه',
 'Clean IP performance':'عملکرد آی‌پی تمیز',
 'The endpoint your generated configurations can use':'نقطه‌ای که پیکربندی‌های تولیدشده می‌توانند استفاده کنند',
 'Current':'فعلی',
 'Default hostname':'نام میزبان پیش‌فرض',
 'Best measured':'بهترین اندازه‌گیری',
 'No device result':'نتیجه‌ای از دستگاه موجود نیست',
 'Run a scan on this device':'روی این دستگاه اسکن اجرا کنید',
 'Your measured winner is already in the configured Clean IP list.':'بهترین نتیجهٔ اندازه‌گیری‌شده همین حالا در فهرست آی‌پی‌های تمیز قرار دارد.',
 'RayZen needs a device scan before it can recommend an IP honestly.':'ری‌زن پیش از پیشنهاد قابل اتکای آی‌پی به یک اسکن دستگاه نیاز دارد.',
 'Apply better IP':'اعمال آی‌پی بهتر',
 'Open scanner':'باز کردن اسکنر',
 'What clients receive after you apply':'آنچه کلاینت‌ها پس از اعمال دریافت می‌کنند',
 'PROTOCOL':'پروتکل',
 'FRAGMENTATION':'قطعه‌بندی',
 'The active protocol and transport pass the current validation rules.':'پروتکل و انتقال فعال از قوانین اعتبارسنجی فعلی عبور می‌کنند.',
 'Run the device scanner and stage the strongest address.':'اسکنر دستگاه را اجرا و بهترین آدرس را برای بازبینی آماده کنید.',
 'Review configuration':'بررسی پیکربندی',
 'Exposure and weak-default checks':'بررسی سطح افشا و تنظیمات پیش‌فرض ضعیف',
 'No exposed or weak setting was detected.':'هیچ تنظیم افشاشده یا ضعیفی شناسایی نشد.',
 'Score':'امتیاز',
 'Measurements':'اندازه‌گیری‌ها',
 'Trend':'روند',
 'Baseline':'خط مبنا',
 'This endpoint has not appeared as the best choice in recent scans.':'این نقطهٔ پایانی در اسکن‌های اخیر به‌عنوان بهترین انتخاب ظاهر نشده است.',
 'Only one measurement exists; wait for more evidence before acting.':'فقط یک اندازه‌گیری وجود دارد؛ پیش از اقدام منتظر شواهد بیشتری بمانید.',
 'Smart Setup':'راه‌اندازی هوشمند',
 'RayZen measures this network and prepares the recommended values for review.':'ری‌زن این شبکه را اندازه‌گیری می‌کند و مقادیر پیشنهادی را برای بازبینی آماده می‌کند.',
 'GUIDED ANALYSIS':'تحلیل هدایت‌شده',
 'Let RayZen prepare the right setup':'اجازه دهید ری‌زن تنظیم مناسب را آماده کند',
 'RayZen measures this panel, checks DNS, reads device endpoint history, and audits the saved configuration. It stages a recommendation; it never saves for you.':'ری‌زن پنل را اندازه‌گیری می‌کند، DNS و تاریخچهٔ نقاط پایانی دستگاه را می‌سنجد و پیکربندی ذخیره‌شده را بررسی می‌کند. پیشنهاد را آماده می‌کند اما هرگز بدون تأیید شما ذخیره نمی‌کند.',
 'Analyze again':'تحلیل دوباره',
 'Network':'شبکه',
 'DNS':'DNS',
 'Resolver did not answer':'حل‌کننده پاسخ نداد',
 'RECOMMENDED CONFIGURATION':'پیکربندی پیشنهادی',
 'Recommended setup':'تنظیم پیشنهادی',
 'PANEL LATENCY':'تأخیر پنل',
 'No device scan':'اسکن دستگاه موجود نیست',
 'PROBE SUCCESS':'موفقیت پروب',
 'Configuration-grounded. Run a device scan to add network-specific confidence.':'پیشنهاد بر پایهٔ پیکربندی است. برای اطمینان مخصوص این شبکه، اسکن دستگاه را اجرا کنید.',
 'PORT':'درگاه',
 'Apply recommendation':'اعمال پیشنهاد',
 'Preview':'پیش‌نمایش',
 'Compare':'مقایسه',
 'Explain':'توضیح',
 'Hide explanation':'پنهان کردن توضیح',
 'WHAT RAYZEN LEARNS':'ری‌زن چه چیزی یاد می‌گیرد',
 'Measurements, not a black box':'اندازه‌گیری واقعی، نه جعبهٔ سیاه',
 'Repeat device scans build block-level latency and reliability history. Saved settings show which tradeoffs you chose. Recommendation outcomes are counted only in aggregate.':'اسکن‌های تکرارشوندهٔ دستگاه، تاریخچهٔ تأخیر و قابلیت‌اعتماد در سطح بلوک می‌سازند. تنظیمات ذخیره‌شده مصالحه‌های انتخابی شما را نشان می‌دهند و نتیجهٔ پیشنهادها فقط به‌صورت تجمیعی شمارش می‌شود.',
 'See the evidence history →':'مشاهدهٔ تاریخچهٔ شواهد ←',
 'Build your connection':'اتصال خود را بسازید',
 'Choose an intent, understand the tradeoffs, then review before applying.':'یک پروفایل انتخاب یا تنظیمات اصلی را دقیق کنید؛ همهٔ تغییرات آماده‌شده را پیش از ذخیره بازبینی کنید.',
 'PROFESSIONAL PRESETS':'پروفایل‌های حرفه‌ای',
 'Choose a starting point':'با هدف شروع کنید، نه با ده‌ها فیلد',
 'Preview changes before applying them.':'هر پروفایل مجموعه‌ای قابل بازبینی از تغییرات است؛ هویت، اطلاعات ورود و نقاط پایانی انتخاب‌شده حفظ می‌شوند.',
 'Lowest latency':'کمترین تأخیر',
 'Gaming':'بازی',
 'CHANGES':'تغییرات',
 'BENEFIT':'مزیت',
 'TRADEOFF':'ملاحظه',
 'Low fragmentation · TCP Fast Open · 30s endpoint refresh':'قطعه‌بندی کم · TCP Fast Open · تازه‌سازی نقطهٔ پایانی هر ۳۰ ثانیه',
 'Faster setup and lower route jitter on open networks.':'راه‌اندازی سریع‌تر و نوسان مسیر کمتر در شبکه‌های باز.',
 'Less obfuscation when a network actively filters traffic.':'پنهان‌سازی کمتر در شبکه‌هایی که ترافیک را فعالانه فیلتر می‌کنند.',
 'Preview preset':'پیش‌نمایش پروفایل',
 'Maximum reliability':'بیشترین پایداری',
 'Medium fragmentation · Block QUIC · 60s endpoint refresh':'قطعه‌بندی متوسط · مسدودسازی QUIC · تازه‌سازی هر ۶۰ ثانیه',
 'Fewer reconnects when routes or radio conditions change.':'اتصال مجدد کمتر هنگام تغییر مسیر یا شرایط رادیویی.',
 'Slightly slower setup and less peak throughput.':'راه‌اندازی کمی کندتر و اوج توان عملیاتی کمتر.',
 'Difficult networks':'شبکه‌های دشوار',
 'Restricted network':'شبکهٔ محدود',
 'Restricted Network':'شبکهٔ محدود',
 'TLS fragmentation · ECH · Encrypted DNS · Quiet logs':'قطعه‌بندی TLS · ECH · DNS رمزگذاری‌شده · گزارش‌گیری محدود',
 'Improves handshake success when traffic patterns are filtered.':'در شبکه‌های فیلترکننده، شانس موفقیت دست‌دهی را افزایش می‌دهد.',
 'Adds setup latency and requires an ECH-capable client.':'به زمان راه‌اندازی می‌افزاید و به کلاینت سازگار با ECH نیاز دارد.',
 'Minimise exposure':'کاهش سطح افشا',
 'Privacy':'حریم خصوصی',
 'No client logs · Encrypted DNS · LAN access off · Threat blocking':'بدون گزارش کلاینت · DNS رمزگذاری‌شده · LAN غیرفعال · مسدودسازی تهدیدها',
 'Reduces local records, DNS exposure and unsafe destinations.':'ردپای محلی، افشای DNS و مقصدهای ناامن را کاهش می‌دهد.',
 'Troubleshooting is harder with client logging disabled.':'با غیرفعال بودن گزارش کلاینت، عیب‌یابی دشوارتر است.',
 'Sustained throughput':'توان عملیاتی پایدار',
 'Streaming':'پخش جریانی',
 'Low fragmentation · TCP Fast Open · Allow QUIC · Encrypted DNS':'قطعه‌بندی کم · TCP Fast Open · مجاز بودن QUIC · DNS رمزگذاری‌شده',
 'Keeps long video sessions moving without changing identity or endpoints.':'جلسه‌های طولانی ویدئو را بدون تغییر هویت یا نقاط پایانی پایدار نگه می‌دارد.',
 'Uses more bandwidth and is less defensive on heavily filtered networks.':'پهنای‌باند بیشتری مصرف می‌کند و در شبکه‌های شدیداً فیلترشده محافظه‌کاری کمتری دارد.',
 'Foundation':'پایه',
 'DNS, access and the private panel path used by every connection.':'DNS، دسترسی و مسیر خصوصی پنل که همهٔ اتصال‌ها استفاده می‌کنند.',
 'Connection identity':'هویت اتصال',
 'Choose protocols and credentials. Advanced transport detail stays collapsed.':'پروتکل‌ها و اطلاعات ورود را انتخاب کنید؛ جزئیات پیشرفتهٔ انتقال تا زمان نیاز بسته می‌ماند.',
 'Adjust this group when your network requires it.':'این بخش را فقط وقتی شبکه‌تان نیاز دارد تغییر دهید.',
 'Traffic policy':'سیاست ترافیک',
 'Choose what bypasses, blocks or follows special routes.':'مشخص کنید چه چیزی عبور مستقیم داشته باشد، مسدود شود یا مسیر ویژه را دنبال کند.',
 'Portability':'قابلیت انتقال',
 'Back up, restore or share settings deliberately.':'پشتیبان‌گیری، بازیابی و اشتراک تنظیمات را آگاهانه انجام دهید.',
 'Not set':'تنظیم نشده',
 'Existing server-side validation remains the final safety check.':'اعتبارسنجی سمت سرور همچنان آخرین کنترل ایمنی است.',
 'SUBSCRIPTIONS':'اشتراک‌ها چگونه کار می‌کنند',
 'Connect your client':'یک لینک، چند پیکربندی',
 'Copy a subscription link and import it into a compatible client.':'یک کلاینت سازگار انتخاب کنید، لینک اشتراک را کپی و در v2rayNG، sing-box، Hiddify یا کلاینت پشتیبانی‌شدهٔ دیگری وارد کنید. تغییرات RayZen محتوای لینک را عوض می‌کند و کلاینت با تازه‌سازی اشتراک به‌روز می‌شود.',
 'View links':'نمایش لینک‌های اشتراک',
 'Measure endpoints':'اندازه‌گیری نقاط پایانی',
 'SAFE BACKUP':'پشتیبان ایمن',
 'Safe backup':'پیش از تغییر بزرگ پشتیبان بگیرید',
 'Download backup':'دریافت پشتیبان',
 'RESTORE PREVIEW':'پیش‌نمایش بازیابی',
 'Restore preview':'ابتدا همهٔ تغییرات را ببینید',
 'Review compatible changes before applying them.':'یک پشتیبان RayZen انتخاب کنید. پنل تنظیمات سازگار را در فرم آماده می‌کند و بدون تأیید شما ذخیره نمی‌کند.',
 'Choose backup':'انتخاب پشتیبان',
 'Maximum Stability':'بیشترین پایداری',
 'Current settings are already close to the stability profile.':'تنظیمات فعلی همین حالا به پروفایل پایداری نزدیک‌اند.',
 'Find a better endpoint':'نقطهٔ پایانی بهتری پیدا کنید',
 'Measure from this device, compare reliability, then apply the winner.':'از این دستگاه اندازه بگیرید، قابلیت‌اعتماد را مقایسه کنید و سپس بهترین گزینه را اعمال کنید.',
 'Measure':'اندازه‌گیری',
 'Test from this device':'آزمایش از این دستگاه',
 'Choose':'انتخاب',
 'Compare reliability':'مقایسهٔ قابلیت‌اعتماد',
 'Apply':'اعمال',
 'Update generated configs':'به‌روزرسانی پیکربندی‌های تولیدشده',
 'Your browser measures connection latency and response consistency directly. Results describe this device and network; nothing changes until you press Apply IP.':'مرورگر شما تأخیر اتصال و ثبات پاسخ را مستقیماً اندازه می‌گیرد. نتیجه مربوط به همین دستگاه و شبکه است و تا زمانی که «اعمال آی‌پی» را نزنید چیزی تغییر نمی‌کند.',
 'CONFIGURED ENDPOINT':'نقطهٔ پایانی تنظیم‌شده',
 'LAST MEASURED WINNER':'بهترین نتیجهٔ آخرین اندازه‌گیری',
 'No device scan yet':'هنوز اسکن دستگاهی انجام نشده',
 'EVIDENCE':'شواهد',
 'Run the recommended quick scan':'اسکن سریع پیشنهادی را اجرا کنید',
 'recommended':'پیشنهادی',
 'broader search':'جست‌وجوی گسترده‌تر',
 'How many candidates?':'چند گزینه بررسی شود؟',
 'Number of candidates to discover':'تعداد گزینه‌ها برای کشف',
 'Discover candidates':'کشف گزینه‌ها',
 '…or paste endpoints manually, one per line':'…یا نقاط پایانی را دستی، هر خط یکی، وارد کنید',
 'Endpoints to scan':'نقاط پایانی برای اسکن',
 'SUBSCRIPTION ADVICE':'پیشنهاد برای اشتراک',
 'Keep your current endpoint':'نقطهٔ پایانی فعلی را حفظ کنید',
 'Run a scan to establish an endpoint history.':'برای ساخت تاریخچهٔ نقطهٔ پایانی، یک اسکن اجرا کنید.',
 'Recommendation only — update your subscription when you decide.':'این فقط یک پیشنهاد است؛ هر زمان تصمیم گرفتید اشتراک را به‌روزرسانی کنید.',
 'No switch is justified by the current evidence.':'شواهد فعلی تغییر نقطهٔ پایانی را توجیه نمی‌کند.',
 'ENDPOINT HISTORY':'تاریخچهٔ نقاط پایانی',
 'No endpoint history yet':'هنوز تاریخچه‌ای از نقاط پایانی وجود ندارد',
 'Discover candidates above and run the first bounded scan. RayZen will show score, measurements, trend and reason here.':'در بالا گزینه‌ها را کشف و نخستین اسکن محدود را اجرا کنید. ری‌زن امتیاز، اندازه‌گیری‌ها، روند و دلیل را اینجا نمایش می‌دهد.',
 'SUBSCRIPTIONS':'اشتراک‌ها',
 'Import, share and revoke connection links from one place.':'لینک‌های اتصال را از یک جا وارد، به‌اشتراک و لغو کنید.',
 'Subscription links':'لینک‌های اشتراک',
 'RECOMMENDED START':'شروع پیشنهادی',
 'Start with Normal':'از حالت عادی شروع کنید',
 'Best compatibility.':'بهترین سازگاری.',
 'Desktop + mobile':'دسکتاپ + موبایل',
 'Refreshes in your client':'در کلاینت تازه‌سازی می‌شود',
 'Uses your saved configuration':'از پیکربندی ذخیره‌شدهٔ شما استفاده می‌کند',
 'Show QR':'نمایش QR',
 'Download':'دریافت',
 'Normal':'عادی',
 'Best first choice':'بهترین انتخاب برای شروع',
 'RECOMMENDED':'پیشنهادی',
 'Balanced compatibility for everyday use.':'سازگاری متعادل برای استفادهٔ روزمره.',
 'Tradeoff: Use this unless a specific network or client needs another format.':'ملاحظه: مگر اینکه شبکه یا کلاینت خاصی قالب دیگری بخواهد، از این گزینه استفاده کنید.',
 'Remote subscription':'اشتراک راه‌دور',
 'EASIEST':'ساده‌ترین',
 'COMPATIBLE CLIENTS':'کلاینت‌های سازگار',
 'Extra resistance':'مقاومت بیشتر',
 'RESTRICTED NETWORKS':'شبکه‌های محدود',
 'Raw':'خام',
 'Direct config list':'فهرست مستقیم پیکربندی',
 'ADVANCED':'پیشرفته',
 'Cloudflare egress':'خروجی Cloudflare',
 'WARP ROUTING':'مسیریابی WARP',
 'WARP with advanced clients':'WARP برای کلاینت‌های پیشرفته',
 'SPECIALIZED':'تخصصی',
 'ACTIVE LINKS':'لینک‌های فعال',
 'EXPIRING IN 7 DAYS':'در حال انقضا تا ۷ روز',
 'OBSERVED FETCHES':'دریافت‌های مشاهده‌شده',
 'LAST ACTIVITY':'آخرین فعالیت',
 'Observed fetches':'دریافت‌های مشاهده‌شده',
 'approximate':'تقریبی',
 'PANEL ACTIVITY':'فعالیت پنل',
 'Daily control activity':'فعالیت روزانهٔ مدیریت',
 'Sessions':'جلسه‌ها',
 'Saves':'ذخیره‌ها',
 'Accepted recommendations':'پیشنهادهای پذیرفته‌شده',
 'Active days':'روزهای فعال',
 'Last activity':'آخرین فعالیت',
 'Settings saved':'تنظیمات ذخیره‌شده',
 'Recommendation trust':'اعتماد به پیشنهادها',
 'Recommendations have enough feedback to show a directional acceptance rate.':'برای نمایش روند نرخ پذیرش پیشنهادها، بازخورد کافی وجود دارد.',
 'WHAT SHOULD I DO?':'چه کاری انجام دهم؟',
 'Keep the current profile and rescan after network changes.':'پروفایل فعلی را نگه دارید و پس از تغییر شبکه دوباره اسکن کنید.',
 'No adverse trend has crossed a threshold.':'هیچ روند نامطلوبی از آستانه عبور نکرده است.',
 'RECENT CONFIGURATION ACTIVITY':'فعالیت اخیر پیکربندی',
 'Configuration saved':'پیکربندی ذخیره شد',
 'Balanced preset':'پروفایل متعادل',
 'Clean IP staged':'آی‌پی تمیز برای بازبینی آماده شد',
 'Device scan':'اسکن دستگاه',
 'Workspace':'فضای کاری',
 'Telegram':'تلگرام',
 'Deployment':'استقرار',
 'Account':'حساب',
 'Maintenance':'نگهداری',
 'APPEARANCE':'ظاهر',
 'Appearance':'RayZen را مطابق فضای کاری خود تنظیم کنید',
 'Choose a theme and contrast mode.':'تم و کنتراست در سراسر RayZen یکپارچه اعمال می‌شوند.',
 'Follow this device':'پیروی از دستگاه',
 'Bright workspace':'فضای کاری روشن',
 'Low-light comfort':'مناسب نور کم',
 'Aurora':'شفق',
 'Ocean':'اقیانوس',
 'Lavender':'اسطوخودوس',
 'Sunset':'غروب',
 'Midnight':'نیمه‌شب'
});


Object.assign(RZ_FA, {
 'Latency':'تأخیر',
 'Shared links':'لینک‌های اشتراکی',
 'Scanner confidence':'اطمینان اسکنر',
 'Transport':'انتقال',
 'Current endpoint':'نقطهٔ پایانی فعلی',
 'Traffic · 24h requests':'ترافیک · درخواست‌های ۲۴ ساعت',
 'Active shared links':'لینک‌های اشتراکی فعال',
 'configuration score':'امتیاز پیکربندی',
 'Resolver':'حل‌کنندهٔ DNS',
 'TLS mode':'حالت TLS',
 'Fragment mode':'حالت قطعه‌بندی',
 'Probe loss estimate':'برآورد عدم پاسخ پروب',
 'Stability':'پایداری',
 'Packet behavior':'رفتار بسته‌ها',
 'DNS performance':'کارایی DNS',
 'Run device scan':'اجرای اسکن دستگاه',
 'Protocol':'پروتکل',
 'Fragmentation':'قطعه‌بندی',
 'KV namespace':'فضای نام KV',
 'A KV namespace is bound.':'یک فضای نام KV به این استقرار متصل است.',
 'Panel password':'رمز عبور پنل',
 'The panel requires a password.':'پنل با رمز عبور محافظت می‌شود.',
 'Remote DNS transport':'انتقال DNS راه‌دور',
 'Remote DNS uses an encrypted transport.':'DNS راه‌دور از انتقال رمزگذاری‌شده استفاده می‌کند.',
 'Protocols enabled':'پروتکل‌های فعال',
 'Clean IP coverage':'پوشش آی‌پی تمیز',
 'Current state':'وضعیت فعلی',
 'No measured Clean IP is selected.':'هیچ آی‌پی تمیز اندازه‌گیری‌شده‌ای انتخاب نشده است.',
 'A weak endpoint can increase latency, reconnects and timeouts.':'یک نقطهٔ پایانی ضعیف می‌تواند تأخیر، اتصال مجدد و زمان‌انتظار را افزایش دهد.',
 'Recommendation':'پیشنهاد',
 'Scan Clean IPs':'اسکن آی‌پی‌های تمیز',
 'IPv6 is enabled.':'IPv6 فعال است.',
 'Panel latency':'تأخیر پنل',
 'Probe success':'موفقیت پروب',
 'Port':'درگاه',
 'Changes':'تغییرات',
 'Benefit':'مزیت',
 'Tradeoff':'ملاحظه',
 'Configured endpoint':'نقطهٔ پایانی تنظیم‌شده',
 'Last measured winner':'بهترین نتیجهٔ آخرین اندازه‌گیری',
 'Evidence':'شواهد',
 'Best retained reliability score.':'بهترین امتیاز قابلیت‌اعتماد در تاریخچهٔ ذخیره‌شده.',
 'Recommended start':'شروع پیشنهادی',
 'Recommended':'پیشنهادی',
 'Tradeoff:':'ملاحظه:',
 'Use this unless a specific network or client needs another format.':'مگر اینکه شبکه یا کلاینت خاصی قالب دیگری بخواهد، از این گزینه استفاده کنید.',
 'Easiest':'ساده‌ترین',
 'Compatible clients':'کلاینت‌های سازگار',
 'Restricted networks':'شبکه‌های محدود',
 'Adds fragmentation for networks that interfere with ordinary TLS traffic.':'برای شبکه‌هایی که در ترافیک عادی TLS اختلال ایجاد می‌کنند، قطعه‌بندی اضافه می‌کند.',
 'Can trade a little speed for compatibility.':'برای سازگاری بیشتر ممکن است کمی از سرعت کم کند.',
 'Advanced':'پیشرفته',
 'Provides raw links for clients that manage individual configurations themselves.':'لینک‌های خام را برای کلاینت‌هایی ارائه می‌کند که پیکربندی‌های جداگانه را خودشان مدیریت می‌کنند.',
 'Client refresh varies.':'روش تازه‌سازی بسته به کلاینت متفاوت است.',
 'File import':'ورود فایل',
 'Download file':'دریافت فایل',
 'WARP routing':'مسیریابی WARP',
 'Routes compatible profiles through the deployment-specific WARP account.':'پروفایل‌های سازگار را از حساب WARP اختصاصی همین استقرار عبور می‌دهد.',
 'Useful when destination routing matters more than minimum latency.':'وقتی مسیریابی مقصد از کمترین تأخیر مهم‌تر است، مفید است.',
 'Specialized':'تخصصی',
 'Formats WARP profiles for specialized Xray, Clash and Amnezia clients.':'پروفایل‌های WARP را برای کلاینت‌های تخصصی Xray، Clash و Amnezia قالب‌بندی می‌کند.',
 'Requires explicit client support.':'به پشتیبانی صریح کلاینت نیاز دارد.',
 'Active links':'لینک‌های فعال',
 'Expiring in 7 days':'در حال انقضا تا ۷ روز',
 'Random':'تصادفی',
 'String':'رشته',
 'Hex':'هگز',
 'Array':'آرایه',
 'Packet':'بسته'
});


Object.assign(RZ_FA, {
 'Not configured':'پیکربندی نشده',
 'No TLS port':'درگاه TLS تنظیم نشده',
 'Encrypted ClientHello requested':'ClientHello رمزگذاری‌شده درخواست شده',
 'custom':'سفارشی',
 'Custom':'سفارشی',
 'random':'تصادفی',
 'Randomized':'تصادفی‌شده',
 'randomized':'تصادفی‌شده',
 'No device scan':'اسکن دستگاه انجام نشده',
 'No baseline':'خط مبنا موجود نیست',
 'Default hostname':'نام میزبان پیش‌فرض',
 'Requires device scan':'نیازمند اسکن دستگاه',
 'Based on bounded probe success':'بر پایهٔ موفقیت پروب محدود',
 'Retained scanner history':'تاریخچهٔ ذخیره‌شدهٔ اسکنر',
 'Client routing preference':'ترجیح مسیریابی کلاینت',
 'Active client transport':'انتقال فعال کلاینت',
 'Saved transport behavior':'رفتار انتقال ذخیره‌شده',
 'Observed subscription fetches are approximate because KV counters are persisted coarsely.':'تعداد دریافت‌های مشاهده‌شدهٔ اشتراک تقریبی است، چون شمارنده‌های KV با دقت محدود ذخیره می‌شوند.',
 'Apply selected IP':'اعمال آی‌پی انتخاب‌شده',
 'formats':'قالب',
});

Object.assign(RZ_FA, {
 'ACCOUNT ACCESS':'دسترسی حساب',
 'Panel access':'از این پنل مدیریت محافظت کنید',
 'Manage sign-in and session access.':'اقدام‌های حساب فقط دسترسی پنل را تغییر می‌دهند. لینک‌های اشتراک موجود تا زمانی که آن‌ها را لغو نکنید به کار ادامه می‌دهند.',
 'Change your sign-in password.':'رمز عبور را بدون تغییر نشانی‌های اشتراک عوض کنید.',
 'Current session':'جلسهٔ فعلی',
 'Sign out of this browser.':'از این مرورگر خارج شوید. اشتراک‌های فعال همچنان کار می‌کنند.',
 'MAINTENANCE':'نگهداری',
 'Maintenance':'پیش از اقدام‌های پراثر پشتیبان بگیرید',
 'Updates, backups, resets, and removal.':'همهٔ اقدام‌های مخرب یا مربوط به استقرار، صریح و قابل بازبینی باقی می‌مانند.',
 'Update RayZen':'به‌روزرسانی RayZen',
 'Install the latest available build.':'وقتی به‌روزرسانی موجود است، آخرین نسخه را مستقر کنید.',
 'Safe backup':'پشتیبان ایمن',
 'Export settings without credentials.':'تنظیمات را بدون اطلاعات ورود یا هویت استقرار دریافت می‌کند.',
 'Restore preview':'پیش‌نمایش بازیابی',
 'Review a backup before restoring.':'پشتیبان JSON را پیش از بازیابی بررسی کنید.',
 'Choose file':'انتخاب فایل',
 'Reset configuration':'بازنشانی پیکربندی',
 'Restore non-identity defaults.':'تنظیمات غیرهویتی را به مقدارهای پیش‌فرض بازمی‌گرداند.',
 'Reset settings':'بازنشانی تنظیمات',
 'Delete deployment':'حذف استقرار',
 'Permanently remove this panel.':'این پنل را برای همیشه حذف می‌کند. این اقدام نیازمند تأیید است.',
 'Set up the essentials.':'موارد ضروری را تنظیم کنید.',
 'Identity, DNS, and routing.':'هویت، DNS و مسیریابی.',
 'Import RayZen into your preferred client.':'RayZen را در کلاینت دلخواه خود وارد کنید.',
 'Score endpoint quality and stability.':'کیفیت و پایداری نقاط پایانی را ارزیابی کنید.',
 'Review every recommendation before applying it.':'هر پیشنهاد را پیش از اعمال بررسی کنید.',
 'Choose a starting point':'یک نقطه شروع انتخاب کنید',
 'Preview changes before applying them.':'تغییرات را پیش از اعمال ببینید.',
 'SUBSCRIPTIONS':'اشتراک‌ها',
 'Connect your client':'کلاینت خود را متصل کنید',
 'Copy a subscription link and import it into a compatible client.':'یک لینک اشتراک را کپی و در کلاینت سازگار وارد کنید.',
 'View links':'مشاهده لینک‌ها',
 'Safe backup':'پشتیبان ایمن',
 'Restore preview':'پیش‌نمایش بازیابی',
 'Review compatible changes before applying them.':'تغییرات سازگار را پیش از اعمال بررسی کنید.',
 'Appearance':'ظاهر',
 'Choose a theme and contrast mode.':'تم و حالت کنتراست را انتخاب کنید.',
 'Panel access':'دسترسی پنل',
 'Manage sign-in and session access.':'ورود و دسترسی جلسه را مدیریت کنید.',
 'Change your sign-in password.':'رمز ورود خود را تغییر دهید.',
 'Sign out of this browser.':'از این مرورگر خارج شوید.',
 'Maintenance':'نگهداری',
 'Updates, backups, resets, and removal.':'به‌روزرسانی، پشتیبان‌گیری، بازنشانی و حذف.',
 'Install the latest available build.':'آخرین نسخه موجود را نصب کنید.',
 'Export settings without credentials.':'تنظیمات را بدون اطلاعات ورود صادر کنید.',
 'Review a backup before restoring.':'پشتیبان را پیش از بازیابی بررسی کنید.',
 'Restore non-identity defaults.':'تنظیمات غیرهویتی را به پیش‌فرض بازگردانید.',
 'Permanently remove this panel.':'این پنل را برای همیشه حذف کنید.',
 'GitHub':'گیت‌هاب',
 'Official Website':'وب‌سایت رسمی'
});



Object.assign(RZ_FA, {
 'Smart Setup measures the current network and prepares changes for review.':'راه‌اندازی هوشمند شبکهٔ فعلی را اندازه‌گیری و تغییرات را برای بازبینی آماده می‌کند.',
 'Saved settings look good. Device data can refine this result.':'تنظیمات ذخیره‌شده مناسب است. داده‌های دستگاه می‌تواند این نتیجه را دقیق‌تر کند.',
 'Why it fits':'چرا مناسب است',
 'Device evidence included. Review changes before saving.':'داده‌های دستگاه لحاظ شده است. تغییرات را پیش از ذخیره بررسی کنید.',
 'Saved settings + live panel/DNS checks. A device scan adds endpoint evidence.':'تنظیمات ذخیره‌شده و بررسی زندهٔ پنل/DNS مبنا هستند. اسکن دستگاه دادهٔ endpoint را اضافه می‌کند.',
 'No configuration changes recommended.':'هیچ تغییر پیکربندی پیشنهاد نمی‌شود.',
 'Saved settings look good.':'تنظیمات ذخیره‌شده مناسب است.'
});

const RZ_FA_DIGITS='۰۱۲۳۴۵۶۷۸۹';
function rzPersianDigits(value){const text=String(value);return text.replace(/\d/g,(d,index)=>/[A-Za-z]/u.test(text[index-1]||'')||/[A-Za-z]/u.test(text[index+1]||'')?d:RZ_FA_DIGITS[Number(d)]);}
function rzKeepLatinNumerals(node,value){
    const parent=node?.parentElement;
    if(!parent)return false;
    if(parent.closest('code,pre,[data-rz-latin],.rz-deployment-row,.rz-endpoint-title,.rz-rank,.rz-preview-row'))return true;
    const text=String(value).trim();
    return /^(?:https?:\/\/|wss?:\/\/)/iu.test(text) || /^(?:\d{1,3}\.){3}(?:\d{1,3}|\*)/u.test(text) || /^[0-9a-f:]+\/\d+$/iu.test(text) || (!/[\u0600-\u06ff]/u.test(text) && /[A-Za-z]/u.test(text) && /\d/u.test(text));
}
function rzTranslateTextNode(node){if(rzLang()!=='fa'||!node||node.nodeType!==Node.TEXT_NODE||node.parentElement?.closest('script,style'))return;const raw=node.nodeValue||'';const trimmed=raw.trim();if(!trimmed)return;const translated=t(trimmed);const localized=rzKeepLatinNumerals(node,translated)?translated:rzPersianDigits(translated);if(localized!==trimmed)node.nodeValue=raw.replace(trimmed,localized);}
function rzTranslateAttributes(root){if(rzLang()!=='fa'||!root?.querySelectorAll)return;const nodes=[...(root.matches?.('[placeholder],[title],[aria-label]')?[root]:[]),...root.querySelectorAll('[placeholder],[title],[aria-label]')];for(const el of nodes){for(const attr of ['placeholder','title','aria-label']){const value=el.getAttribute(attr);if(!value)continue;const translated=t(value);if(translated!==value)el.setAttribute(attr,translated);}}}
function rzTranslateTree(root=document.body){if(rzLang()!=='fa'||!root)return;if(root.nodeType===Node.TEXT_NODE){rzTranslateTextNode(root);return;}const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode())rzTranslateTextNode(walker.currentNode);rzTranslateAttributes(root);}
const rzI18nObserver=new MutationObserver(records=>{if(rzLang()!=='fa')return;for(const record of records){if(record.type==='characterData')rzTranslateTextNode(record.target);for(const node of record.addedNodes)rzTranslateTree(node);}});

/**
 * Draws markup icons as they appear.
 *
 * Separate from the i18n observer because it runs regardless of language, and because
 * the shell moves the whole legacy markup into new parents during boot. A one-shot pass
 * would draw the icons and then `completeRayZenLegacyMigration` would reparent nodes
 * that already had their SVG, which is fine, but a card built later from a template
 * (the notify modal) would arrive undrawn.
 */
const rzIconObserver = new MutationObserver(records => {
    for (const record of records) {
        for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.dataset?.icon) rzPaintIcon(node);
            rzPaintIcons(node);
        }
    }
});

installRayZenShell();
bindRayZenActions();
rzPaintIcons();
rzTranslateTree();
rzI18nObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
rzIconObserver.observe(document.body, { childList: true, subtree: true });

async function bootRayZen() {
    await getUsage();
    fetchIPInfo();
    await initPanel();
    await loadRayZenIntelligence();
}

bootRayZen();


async function initPanel(settings, tgSettings, subscriptions, clients) {
    try {
        if (!settings) {
            const nocache = Date.now();
            const res = await fetch(`./panel/settings?nocache=${nocache}`, { cache: 'no-store' });
            const { success, status, message, body } = await res.json();

            if (status === 401 && !body.isPassSet) {
                const closeBtn = document.querySelector('.modal-close');
                openResetPass();
                closeBtn.style.visibility = 'hidden';
            }

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            settings = body.proxySettings;
            tgSettings = body.telegramSettings;
            subscriptions = body.subscriptions;
            clients = body.clients;
            checkVersion(settings.panelVersion);
        }

        renderPanel(settings, tgSettings, subscriptions, clients);
    } catch (error) {
        console.error('Panel initiation error:', error);
    }
}

async function getUsage() {
    try {
        const nocache = Date.now();
        const res = await fetch(`./panel/usage?nocache=${nocache}`, { cache: 'no-store' });
        const { success, status, message, body } = await res.json();

        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        const { available, total, worker } = body;
        const totalReq = document.getElementById('total-usage');
        const totalPct = document.getElementById('total-pct');
        const panelReq = document.getElementById('panel-usage');
        const panelPct = document.getElementById('panel-pct');

        if (available === false) {
            totalReq.textContent = '—';
            panelReq.textContent = '—';
            totalPct.textContent = '—';
            panelPct.textContent = '—';
            return;
        }

        totalReq.textContent = total.toLocaleString(rzLocale());
        totalReq.style.fontSize = 'larger';
        const totalPctVal = Math.ceil(Number(total) / 100000 * 100);
        totalPct.textContent = totalPctVal;
        if (totalPctVal > 80) totalPct.style.color = 'var(--color-icon-red)';

        panelReq.textContent = worker.toLocaleString(rzLocale());
        panelReq.style.fontSize = 'larger';
        const panelPctVal = Math.ceil(Number(worker) / 100000 * 100);
        panelPct.textContent = panelPctVal;
        if (panelPctVal > 80) panelPct.style.color = 'var(--color-icon-red)';
    } catch (error) {
        console.warn('Usage data is unavailable:', error.message || error);
    }
}

async function checkVersion(panelVersion) {
    try {
        // Until a signed release feed exists, this reports the running build only.
        const res = await fetch('./panel/version', {
            cache: 'no-store'
        });

        if (!res.ok) {
            throw new Error(`status ${res.status}`);
        }

        // `respond()` wraps every payload as { success, status, message, body }, so the
        // version lives one level down. Reading `pkg.version` yielded undefined and threw
        // inside isNewerVersion on every panel load.
        const { success, message, body } = await res.json();

        if (!success) {
            throw new Error(message || 'version check failed');
        }

        const latest = body?.version;
        if (!latest) {
            throw new Error('version check returned no version');
        }

        const updateAvailable = isNewerVersion(latest, panelVersion);
        if (updateAvailable) {
            globalThis.latestVersion = latest;
            const upgradeBtn = document.getElementById('updatePanel');
            upgradeBtn.disabled = false;
        }
    } catch (error) {
        console.warn('Release information is unavailable:', error.message || error);
    }
}

function isNewerVersion(latest, current) {
    const lv = latest.split('.').map(Number);
    const cv = current.split('.').map(Number);

    for (let i = 0; i < Math.max(lv.length, cv.length); i++) {
        const l = lv[i] ?? 0;
        const c = cv[i] ?? 0;
        if (l > c) return true;
        if (l < c) return false;
    }

    return false;
}

function renderPanel(proxySettings, tgSettings, subscriptions, clients) {
    const {
        securePath,
        ports,
        xrayUdpNoises,
        remoteSettings
    } = proxySettings;

    const path = encodeURIComponent(securePath);
    if (path !== window.location.pathname.split('/')[1]) {
        setTimeout(() => {
            window.location.href = `../${path}/panel`;
        }, 1000);
    }

    const dohUrl = new URL(`./dns-query`, window.location.href);
    document.getElementById('doh').textContent = dohUrl.href;
    document.getElementById('fetchSettingsBtn').disabled = !remoteSettings;

    // A settings document written by an older build has no value for a select added
    // since. Leaving the markup's own default selected is right; assigning `undefined`
    // blanks the control and then saves the blank back.
    selectElements.forEach(elm => {
        const value = proxySettings[elm.id];
        if (value !== undefined && value !== null) elm.value = value;
    });
    checkboxElements.forEach(elm => elm.checked = proxySettings[elm.id]);
    inputElements.forEach(elm => elm.value = proxySettings[elm.id] || '');
    textareaElements.forEach(elm => {
        const key = elm.id;
        const element = document.getElementById(key);
        const value = proxySettings[key]?.join('\r\n');
        const rowsCount = proxySettings[key].length;
        element.style.height = 'auto';
        if (rowsCount) element.rows = rowsCount;
        element.value = value;
        elm.addEventListener('input', () => {
            elm.style.height = 'auto';
            elm.style.height = `${elm.scrollHeight}px`;
        });
    });

    renderPorts(ports.map(Number));
    renderNoises(xrayUdpNoises);
    renderSubscriptions(subscriptions);
    renderClients(clients);
    // Kept so the shared-link builder can offer the same kind/client pairs the ordinary
    // subscription table offers, rather than a second hardcoded list that drifts from
    // `subscriptions` in src/settings/settings.ts the next time a client is added.
    rzSubscriptionCatalogue = subscriptions || null;
    renderSharedLinks();

    globalThis.initialFormData = new FormData(proxyForm);
    handleProxyFormChanges();
    proxyForm.addEventListener('input', handleProxyFormChanges);
    proxyForm.addEventListener('change', handleProxyFormChanges);
    handleFragmentMode();

    if (tgSettings) {
        const tgForm = document.getElementById('telegramForm');
        handleTgFormChanges(tgSettings);
        tgForm.addEventListener('input', () => handleTgFormChanges());

        for (const key in tgSettings) {
            tgForm.elements[key].value = tgSettings[key];
        }
    }
}

function hasFormDataChanged() {
    const formDataToObject = (formData) => Object.fromEntries(formData.entries());
    const configForm = document.getElementById('configForm');
    const currentFormData = new FormData(configForm);

    const initialFormDataObj = formDataToObject(globalThis.initialFormData);
    const currentFormDataObj = formDataToObject(currentFormData);

    return JSON.stringify(initialFormDataObj) !== JSON.stringify(currentFormDataObj);
}

function handleProxyFormChanges(force = false) {
    const applyButton = document.getElementById('applyButton');
    const isChanged = hasFormDataChanged();
    applyButton.disabled = force ? false : !isChanged;
}

function handleTgFormChanges(settings) {
    const userId = document.getElementById('telegramUserId');
    const token = document.getElementById('telegramBotToken');
    const setupBtn = document.getElementById('setup-telegram');
    const removeBtn = document.getElementById('remove-telegram');

    if (settings) {
        const { telegramUserId, telegramBotToken } = settings;
        removeBtn.disabled = !telegramUserId && !telegramBotToken;
        setupBtn.disabled = true;

        userId.value = telegramUserId;
        token.value = telegramBotToken;

        return;
    }

    setupBtn.disabled = !userId.value.trim() || !token.value.trim();
}

async function getIpDetails(ip) {
    try {
        const response = await fetch('./panel/my-ip', { method: 'POST', body: ip });
        const { success, status, message, body } = await response.json();

        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        return body;
    } catch (error) {
        console.warn('IP details are unavailable:', error.message || error)
    }
}

async function fetchIPInfo() {
    const icons = startWaiting(null, 'refresh-geo-location', '');

    const updateUI = (ip = '-', country = '-', countryCode = '-', city = '-', isp = '-', cfIP) => {
        const flag = countryCode !== '-' ? String.fromCodePoint(...[...countryCode].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '';
        const updateContent = (id, content) => document.getElementById(id).textContent = content;
        updateContent(cfIP ? 'cf-ip' : 'ip', ip);
        updateContent(cfIP ? 'cf-country' : 'country', `${flag} ${country}`);
        updateContent(cfIP ? 'cf-city' : 'city', city);
        updateContent(cfIP ? 'cf-isp' : 'isp', isp);
    };

    const nocache = Date.now();
    const othersPromise = fetch(`https://ipv4.geojs.io/v1/ip.json?nocache=${nocache}`, { cache: 'no-store' })
        .then(async res => {
            if (!res.ok) throw new Error(`Fetch Other targets IP failed.`);
            const { ip } = await res.json();
            const { country, countryCode, city, isp } = await getIpDetails(ip);
            updateUI(ip, country, countryCode, city, isp);
        });

    const cfPromise = fetch(`https://ipv4.icanhazip.com/?nocache=${nocache}`, { cache: 'no-store' })
        .then(async res => {
            if (!res.ok) throw new Error(`Fetch Cloudflare targets IP failed.`);
            const ip = await res.text();
            const { country, countryCode, city, isp } = await getIpDetails(ip.trim());
            updateUI(ip, country, countryCode, city, isp, true);
        });

    const results = await Promise.allSettled([othersPromise, cfPromise]);
    results.forEach(result => {
        if (result.status === 'rejected') console.warn('External IP lookup is unavailable:', result.reason?.message || result.reason);
    });

    stopWaiting(icons);
}

function generateSubUrl(type, core, tag) {
    const url = new URL(`./sub/${type}`, window.location.href);
    url.searchParams.append('app', core);
    url.hash = `RayZen ${tag}`;

    if (core === 'sing-box' && type !== 'raw') {
        return `sing-box://import-remote-profile?url=${url.href}`;
    }

    return url.href;
}

async function generateQRCode(data) {
    const url = new URL('./qrcode', window.location.href);
    url.searchParams.set('data', data);
    url.searchParams.set('nocache', Date.now().toString());

    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) {
        throw new Error(`status ${res.status}`);
    }

    const blob = await res.blob();

    return elm('img', {
        id: 'qr',
        className: 'qrcode',
        src: URL.createObjectURL(blob)
    });
}

function showQRCode(subUrl) {
    const url = new URL(subUrl);
    const modal = document.getElementById('qrModal');
    const close = modal.querySelector('.modal-close');
    const container = document.getElementById('qrcode-container');

    let qrcodeTitle = document.getElementById('qrcodeTitle');
    qrcodeTitle.textContent = decodeURIComponent(url.hash).replace('#', '');

    close.onclick = () => {
        modal.hidden = true;
        container.lastElementChild.remove();
        window.onclick = null;
    };

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.hidden = true;
            container.lastElementChild.remove();
        }
    }

    generateQRCode(subUrl).then(qr => {
        container.appendChild(qr);
        modal.hidden = false;
    });
}

function copyToClipboard(url) {
    navigator.clipboard.writeText(url)
        .then(() => notify('info', 'Copied to clipboard', [url]))
        .catch(error => console.error('Failed to copy:', error));
}

function copyDoh() {
    const url = document.getElementById('doh').textContent;
    copyToClipboard(url);
}

async function dlUrl(subUrl) {
    const url = new URL(subUrl);
    window.location.href = url.protocol === 'sing-box:' ? url.searchParams.get('url') : subUrl;
}

async function exportFileSettings(event) {
    if (hasFormDataChanged()) {
        notify('error', 'Export settings', ['Please apply unsaved changes first.']);
        return;
    }

    const icons = startWaiting(event.target, '', 'refresh');
    const url = new URL('./sub/share-settings', window.location.href);
    window.location.href = url.href;
    stopWaiting(icons);
}

function importFile() {
    const input = document.getElementById('fileInput');
    input.value = '';
    input.click();
}

async function importFileSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = atob(text);
        const newSettings = JSON.parse(data);
        const currentSettings = validateSettings();
        const settings = { ...currentSettings, ...newSettings };

        renderPanel(settings);
        handleProxyFormChanges(true);

        notify('success', 'Import settings', [
            'Settings imported successfully!',
            'Please first REVIEW new settings and then apply, specially ROUTING settings.'
        ]);
    } catch (error) {
        console.error('Import settings error:', error);
        notify('error', 'Import settings', ['Failed to get settings from file.']);
    }
}

async function importRemoteSettings(event) {
    if (hasFormDataChanged()) {
        notify('error', 'Import settings', ['Please apply unsaved changes first.']);
        return;
    }

    const icons = startWaiting(event.target, '', 'refresh');
    const remote = document.getElementById('remoteSettings').value.trim();
    const currentSettings = validateSettings();

    try {
        const newSettings = await fetchSettings(remote);
        const settings = { ...currentSettings, ...newSettings };

        renderPanel(settings);
        handleProxyFormChanges(true);

        notify('success', 'Import settings', [
            'Settings imported successfully!',
            'Please first REVIEW new settings and then apply, specially ROUTING settings.'
        ]);
    } catch (error) {
        console.error('Import settings error:', error);
        notify('error', 'Import settings', ['Failed to get settings from remote.']);
    } finally {
        stopWaiting(icons);
    }
}

function shareSettings() {
    const url = new URL('./sub/share-settings', window.location.href);
    copyToClipboard(url);
}

/**
 * Fetches a settings document from another deployment.
 *
 * The fetch is routed through `backup/import-remote` rather than done from the
 * browser because the panel page's CSP restricts `connect-src` to `'self'`: a
 * direct cross-origin fetch of the remote URL is blocked by the very policy that
 * protects the page. The Worker performs the fetch server-side (authenticated,
 * https-only, size-capped) and the browser only talks to its own origin.
 */
async function fetchSettings(remoteUrl) {
    const result = await rayzenApi('backup/import-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: remoteUrl })
    });
    return result.settings;
}

async function renewWarpAccounts(btn) {
    const confirm = await notify('confirm', 'Renew Warp Accounts', ['Are you sure?'])
    if (!confirm) return;
    const icons = startWaiting(btn, '', '');

    try {
        const response = await fetch('./panel/update-warp', { method: 'POST', credentials: 'include' });
        const { success, status, message } = await response.json();

        if (!success) {
            notify('error', 'Renew Warp Accounts', ['An error occured, Please try again later.']);
            throw new Error(`status ${status} - ${message}`);
        }

        notify('success', 'Renew Warp Accounts', ['Warp accounts updated successfully!']);
    } catch (error) {
        console.error('Updating Warp configs error:', error)
        notify('error', 'Renew Warp Accounts', ['Failed to renew Warp accounts.']);
    } finally {
        stopWaiting(icons);
    }
}

async function handleRiskyRules(event) {
    if (event.target.checked) {
        const proceed = await notify('confirm', 'Geo asset files', [
            "v2ray users should set Geo Assets to Chocolate4U and download assets, otherwise configs won't connect.",
            'Proceed anyway?'
        ]);

        if (!proceed) {
            event.target.checked = false;
            return;
        }
    }
}

function handleFragmentMode() {
    const fragmentMode = document.getElementById('fragmentMode').value;
    const formDataObj = Object.fromEntries(globalThis.initialFormData.entries());
    const inputs = [
        'fragmentLengthMin',
        'fragmentLengthMax',
        'fragmentDelayMin',
        'fragmentDelayMax'
    ];

    const configs = {
        low: [100, 200, 1, 1],
        medium: [50, 100, 1, 5],
        high: [10, 20, 10, 20],
        severe: [1, 5, 1, 5],
        custom: inputs.map(id => formDataObj[id])
    };

    inputs.forEach((id, index) => {
        const elm = document.getElementById(id);
        elm.value = configs[fragmentMode][index];
        fragmentMode !== 'custom'
            ? elm.setAttribute('readonly', 'true')
            : elm.removeAttribute('readonly');
    });
}

async function resetSettings(btn) {
    const confirm = await notify(
        'confirm',
        'Reset panel settings',
        [
            'This will reset all settings except:',
            '+ VLESS UUID',
            '+ Trojan password',
            '+ Panel - Subscriptions path\n',
            'Are you sure?'
        ]
    );

    if (!confirm) return;
    const icons = startWaiting(btn, '', '', false);

    try {
        const res = await fetch('./panel/reset-settings', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });

        const { success, status, message, body } = await res.json();
        if (!success) {
            throw new Error(`status ${status} - ${message}`);
        }

        notify(
            'success',
            'Reset panel settings',
            ['Please update your subscriptions.']
        );

        renderPanel(body);
    } catch (error) {
        console.error('Reseting settings error:', error);
    } finally {
        stopWaiting(icons);
    }
}

function updateSettings(event, data) {
    event.preventDefault();
    event.stopPropagation();

    const validatedForm = validateSettings();
    if (!validatedForm) return false;
    const form = data ?? validatedForm;

    const icons = startWaiting(null, 'applyButton', 'refresh');

    fetch('./panel/update-settings', {
        method: 'PUT',
        body: JSON.stringify(form),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(({ success, status, message, body: errors }) => {
            if (status === 401) {
                notify(
                    'error',
                    'Apply settings',
                    ['Session expired! Please login and try again.']
                );
                window.location.href = './login';
            }

            if (!success) {
                errors.forEach(error => {
                    notify('error', error.field, error.message);
                });
                throw new Error(`status ${status} - ${message}`);
            }

            notify(
                'success',
                'Apply settings',
                ['Please update your subscriptions.']
            );

            renderPanel(form);
        })
        .catch(error => console.error('Update settings error:', error))
        .finally(() => stopWaiting(icons));
}

function setupTelegramBot(event) {
    event.preventDefault();
    event.stopPropagation();

    const formData = new FormData(event.target);
    const form = Object.fromEntries(formData.entries());

    const setupBtn = document.getElementById('setup-telegram');
    const icons = startWaiting(setupBtn, '', 'refresh');

    fetch('./telegram/setup', {
        method: 'PUT',
        body: JSON.stringify(form),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(res => res.json())
        .then(({ success, status, message, body }) => {
            if (status === 401) {
                notify(
                    'error',
                    'Setup Telegram bot',
                    ['Session expired! Please login and try again.']
                );
                window.location.href = './login';
            }

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            handleTgFormChanges(body);
            notify(
                'success',
                'Setup Telegram bot',
                ['Telegram bot is ready to use.']
            );
        })
        .catch(error => console.error('Setup Telegram bot error:', error))
        .finally(() => {
            stopWaiting(icons);
            setupBtn.disabled = true;
        });
}

function removeTelegramBot(btn) {
    const icons = startWaiting(btn, '', 'refresh');

    fetch('./telegram/remove', { method: 'POST', credentials: 'include' })
        .then(res => res.json())
        .then(({ success, status, message, body }) => {
            if (status === 401) {
                notify(
                    'error',
                    'Remove Telegram bot',
                    ['Session expired! Please login and try again.']
                );
                window.location.href = './login';
            }

            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            handleTgFormChanges(body);
            notify(
                'success',
                'Remove Telegram bot',
                ['Telegram bot removed successfully!']
            );
        })
        .catch(error => console.error('Remove Telegram bot error:', error))
        .finally(() => stopWaiting(icons));
}

function validateSettings() {
    const configForm = document.getElementById('configForm');
    const formData = new FormData(configForm);

    const fields = [
        'udpXrayNoiseMode',
        'udpXrayNoisePacket',
        'udpXrayNoiseDelayMin',
        'udpXrayNoiseDelayMax',
        'udpXrayNoiseCount'
    ].map(field => formData.getAll(field));

    const form = Object.fromEntries(formData.entries());
    const [modes, packets, delaysMin, delaysMax, counts] = fields;

    form.xrayUdpNoises = modes.map((mode, index) => ({
        type: mode,
        packet: packets[index],
        delay: `${delaysMin[index]}-${delaysMax[index]}`,
        count: counts[index]
    }));

    form.ports = [
        ...defaultHttpPorts,
        ...defaultHttpsPorts
    ].filter(port => formData.has(port.toString()));

    checkboxElements.forEach(elm => {
        form[elm.id] = formData.has(elm.id);
    });

    selectElements.forEach(elm => {
        let value = form[elm.id];
        if (value === 'true') value = true;
        if (value === 'false') value = false;
        form[elm.id] = value;
    });

    inputElements.forEach(elm => {
        if (typeof form[elm.id] === 'string') {
            form[elm.id] = form[elm.id].trim();
        }
    });

    numInputElements.forEach(elm => {
        form[elm.id] = Number(form[elm.id].trim());
    });

    textareaElements.forEach(elm => {
        const key = elm.id;
        const value = form[key];
        form[key] = value?.split('\n').map(val => val.trim()).filter(Boolean) || [];
    });

    return form;
}

function logout(event) {
    event.preventDefault();
    fetch('./panel/logout', { method: 'GET', credentials: 'same-origin' })
        .then(response => response.json())
        .then(({ success, status, message }) => {
            if (!success) {
                throw new Error(`status ${status} - ${message}`);
            }

            window.location.href = './login';
        })
        .catch(error => console.error('Logout error:', error));
}

function openResetPass(event) {
    const modal = document.getElementById('resetPassModal');
    const close = modal.querySelector('.modal-close');
    const showHides = modal.querySelectorAll('.show-hide');
    const title = modal.querySelector('.modal-title');
    const form = modal.querySelector('.config-form');
    const username = document.getElementById('usernameContainer');
    if (!event) {
        title.textContent = 'Set Password';
        username.hidden = false;
        username.setAttribute('required', 'true');
    }

    close.onclick = () => modal.hidden = true;
    form.onsubmit = resetPassword;
    showHides.forEach(elm => {
        elm.onclick = () => {
            const input = elm.previousElementSibling;
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            // Redrawn rather than retextured: the eye is an SVG now, so assigning
            // `textContent` would replace the icon with the word `visibility`.
            rzPaintIcon(elm, isPassword ? 'visibility' : 'visibility_off');
        }
    });

    modal.hidden = false;
}

function resetPassword(event) {
    event.preventDefault();
    const username = document.getElementById('username').value.trim().toLowerCase();
    const passwordError = document.getElementById('passwordError');
    const password = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();

    if (password !== confirmPassword) {
        passwordError.textContent = 'Passwords do not match';
        return false;
    }

    const valid = /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
    if (!valid) {
        passwordError.textContent = 'Must contain at least one capital letter, one number, and be at least 8 characters long.';
        return false;
    }

    fetch('./panel/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        credentials: 'same-origin',
        body: JSON.stringify({
            username,
            password
        })
    })
        .then(response => response.json())
        .then(({ success, status, message }) => {
            if (!success) {
                passwordError.textContent = message;
                throw new Error(`status ${status} - ${message}`);
            }

            notify('success', 'Reset password', ['Password changed successfully!']);
            window.location.href = './login';
        })
        .catch(error => console.error('Reset password error:', error));
}

function genNoisePacket(mode, packet) {
    switch (mode.value) {
        case 'base64':
            packet.value = randBase64(32, 64);
            break;
        case 'rand':
            packet.value = '50-100';
            break;
        case 'hex':
            packet.value = randHex(32, 64);
            break;
        case 'array':
            packet.value = randArray(32, 64);
            break;
        case 'str': {
            const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            packet.value = randString(charset, 32, 64);
        }
    }

    handleProxyFormChanges();
}

function randUUID() {
    const uuid = document.getElementById('vlUUID');
    uuid.value = crypto.randomUUID();
    handleProxyFormChanges();
}

function randString(charset, minLen, maxLen) {
    return [...randBytes(minLen, maxLen)]
        .map(byte => charset[byte % charset.length])
        .join('');
}

function randArray(minLen, maxLen) {
    const length = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    const array = Array.from({ length }, () => Math.floor(Math.random() * 256));
    const field = array.map(String).join(',');

    return field;
}

function randBytes(minBytes, maxBytes) {
    const bytes = Math.floor(Math.random() * (maxBytes - minBytes + 1)) + minBytes;
    const array = new Uint8Array(bytes);
    crypto.getRandomValues(array);

    return array;
}

function randHex(minBytes, maxBytes) {
    return [...randBytes(minBytes, maxBytes)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function randBase64(minBytes, maxBytes) {
    return btoa(String.fromCharCode(...randBytes(minBytes, maxBytes)));
}

function randPassword() {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&*_-+;:,.';
    const trPass = document.getElementById('trPass');
    trPass.value = randString(charset, 16, 32);
    handleProxyFormChanges();
}

function randPath() {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const securePath = document.getElementById('securePath');
    securePath.value = randString(charset, 16, 32);
    handleProxyFormChanges();
}

async function updatePanel(btn) {
    const confirm = await notify('confirm', 'Update RayZen Panel', [
        `Version ${globalThis.latestVersion} is now available!`,
        `Please review the release notes carefully before updating.`,
        'Are you sure?'
    ]);

    if (!confirm) return;
    const icons = startWaiting(btn, '', 'refresh');

    fetch('./panel/update-panel', { method: 'POST' })
        .then(res => res.json())
        .then(({ success, status, message }) => {
            if (!success) throw new Error(`status ${status} - ${message}`);
            notify('success', 'Update panel', ['Your panel upgraded successfully!']);
            setTimeout(() => {
                location.reload();
            }, 3000);
        })
        .catch(error => {
            notify('error', 'Update panel', ['Failed to update your RayZen Panel, please try again.']);
            console.error('Update panel error:', error)
        })
        .finally(() => stopWaiting(icons));
}

async function deletePanel(btn) {
    const confirm = await notify('confirm', 'Delete RayZen Panel', [
        'This will permanently delete your panel from your Cloudflare account',
        'Are you sure?'
    ]);

    if (!confirm) return;
    const icons = startWaiting(btn, '', 'refresh');

    fetch('./panel/delete-panel', { method: 'POST' })
        .then(res => res.json())
        .then(({ success, status, message }) => {
            if (!success) throw new Error(`status ${status} - ${message}`);
            notify('success', 'Delete panel', ['Your panel deleted successfully!']);
        })
        .catch(error => {
            notify('error', 'Delete panel', ['Failed to delete your RayZen Panel, please try again.']);
            console.error('Delete panel error:', error)
        })
        .finally(() => stopWaiting(icons));
}

function notify(type, title, text) {
    return new Promise(resolve => {
        const fragment = document.getElementById('message-template').content.cloneNode(true);
        const modal = fragment.querySelector('.modal');
        modal.hidden = false;

        modal.querySelector('.message-title').textContent = title;
        modal.querySelector('.message-text').textContent = text.join('\n');

        const icon = modal.querySelector('.message-icon');
        const isOk = type === 'success' || type === 'info';
        const isConfirm = type === 'confirm';

        rzPaintIcon(icon, isOk ? 'check_circle' : isConfirm ? 'help' : 'error');
        icon.style.color = isOk ? 'var(--color-icon-green)' : 'var(--color-icon-red)';

        const okBtn = modal.querySelector('.message-ok-btn');
        const cancelBtn = modal.querySelector('.message-cancel-btn');
        const closeBtn = modal.querySelector('.modal-close');

        // Per-modal state. `dismiss` is idempotent because three paths can reach it,
        // and an `info` modal also has a timer racing them: without the guard, a user
        // who closes one before it expires gets `resolve` called twice and, worse,
        // `focus()` called on an element the next modal has already replaced.
        let settled = false;
        let timer = null;
        const opener = document.activeElement;

        const handle = value => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            document.removeEventListener('keydown', onKeyDown, true);
            modal.remove();
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
            resolve(value);
        };

        // Escape dismisses, as it does for `.rz-dialog`. A confirm resolves false,
        // because cancelling is the safe reading of "the user pressed Escape".
        function onKeyDown(event) {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            handle(type === 'confirm' ? false : null);
        }
        document.addEventListener('keydown', onKeyDown, true);

        if (type === 'confirm') {
            cancelBtn.onclick = () => handle(false);
        } else {
            cancelBtn.style.display = 'none';
        }

        if (type === 'info') {
            okBtn.style.display = 'none';
        } else {
            okBtn.onclick = () => handle(true);
        }

        closeBtn.onclick = () => handle(false);
        document.body.appendChild(fragment);

        // Focus the first *visible* control, so the keyboard lands inside the modal
        // rather than on the button that opened it. An `info` modal hides its Ok
        // button, and focusing a `display:none` element silently does nothing, which
        // is how this looked correct while leaving focus behind the backdrop.
        const firstFocusable = [okBtn, cancelBtn, closeBtn]
            .find(node => node && node.getClientRects().length > 0);
        firstFocusable?.focus();

        if (type === 'info') {
            // Auto-dismissed, because an informational modal that demands a click for
            // every copied link is worse than no confirmation at all. Through `handle`
            // rather than removing the node directly, so the key listener is detached
            // and a manual close beforehand cannot be resolved twice.
            timer = setTimeout(() => handle(null), 1600);
        }
    });
}

/**
 * Puts a button into a spinning state, optionally swapping its glyph.
 *
 * The glyph is now an SVG, so the swap is a redraw and the restore compares the recorded
 * name rather than the element's text. Comparing text would always differ (an SVG's
 * `textContent` is empty), so the restore fired on every stop and reset the icon of a
 * button whose glyph was never swapped.
 */
function startWaiting(button, id, customIcon, cw = true) {
    document.body.classList.add('is-loading');
    const btn = button ?? document.getElementById(id);
    const icon = btn.querySelector('span');
    const initIcon = icon.dataset.icon ?? '';
    if (customIcon) rzPaintIcon(icon, customIcon);
    icon.classList.add(`${cw ? 'cw' : 'ccw'}-spinning`);
    return { icon, initIcon };
}

function stopWaiting(icons) {
    document.body.classList.remove('is-loading');
    const { icon, initIcon } = icons;
    icon.classList.remove('cw-spinning');
    icon.classList.remove('ccw-spinning');
    if (initIcon && initIcon !== icon.dataset.icon) rzPaintIcon(icon, initIcon);
}

/**
 * Device-side scan: the panel half of the protocol.
 *
 * The measurement runs in a sandboxed iframe (`src/assets/probe/`), because the CSP
 * that lets a page connect to arbitrary Cloudflare addresses must not also apply to the
 * page holding this deployment's credentials. This module owns the frame's lifecycle and
 * the message exchange; everything it learns comes back over `postMessage`.
 *
 * The whole flow, in order:
 *
 *   1. ask the Worker for a candidate list  (`scan/plan`)
 *   2. hand the addresses to the frame      (postMessage)
 *   3. relay progress into the UI           (postMessage, every 5 addresses)
 *   4. send the measurements back to be scored and stored (`scan/record`)
 *
 * Scoring deliberately happens in the Worker rather than here: the ranking rules belong
 * somewhere unit-testable, and a score computed in the page could be rewritten by
 * anyone who can edit a request.
 */

/**
 * Calls a `scan/*` route.
 *
 * Separate from `rayzenApi`, which prefixes `./panel/platform/`. The scan routes sit
 * beside `panel` rather than under it, because the measurement frame needs its own CSP
 * page class and that is selected per top-level route in `src/worker.ts`.
 */
async function rzScanApi(route, body) {
    const response = await fetch(`./scan/${route}`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
        throw new Error(payload.message || `Request failed (${response.status})`);
    }
    return payload.body;
}

/** The frame, created once per panel session and reused across scans. */
let rzProbeFrame = null;
let rzProbeReady = null;

/** The scan in flight, so Stop has something to address. */
let rzScanInFlight = null;

/**
 * Creates the measurement frame and resolves once it announces itself.
 *
 * `sandbox="allow-scripts"` without `allow-same-origin` is the point of the whole
 * design: the frame runs in an opaque origin, so it cannot read this page's DOM,
 * cookies or storage even though it is served from the same host.
 *
 * The timeout is not defensive padding. If the frame fails to load, the alternative is
 * a scan that hangs with a spinner forever, which is indistinguishable from a slow
 * network and much harder to report.
 */
function rzEnsureProbe() {
    if (rzProbeReady) return rzProbeReady;

    rzProbeReady = new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('title', 'RayZen measurement frame');
        frame.setAttribute('aria-hidden', 'true');
        frame.src = './scan/frame';
        frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('The measurement frame did not load.'));
        }, 10000);

        function onMessage(event) {
            if (event.source !== frame.contentWindow) return;
            if (!event.data || event.data.type !== 'rz-probe-ready') return;
            clearTimeout(timer);
            window.removeEventListener('message', onMessage);
            rzProbeFrame = frame;
            resolve(frame);
        }

        function cleanup() {
            window.removeEventListener('message', onMessage);
            frame.remove();
            rzProbeReady = null;
        }

        window.addEventListener('message', onMessage);
        document.body.append(frame);
    });

    return rzProbeReady;
}

/**
 * Runs one scan through the frame.
 *
 * Messages are filtered on `event.source` as well as the request id. The frame's origin
 * is opaque, so it cannot be checked by origin string; comparing against the
 * `contentWindow` this page created is the check that actually holds.
 */
function rzMeasure(addresses, handlers) {
    return new Promise((resolve, reject) => {
        rzEnsureProbe().then(frame => {
            const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

            const finish = (fn, value) => {
                window.removeEventListener('message', onMessage);
                rzScanInFlight = null;
                fn(value);
            };

            function onMessage(event) {
                if (event.source !== frame.contentWindow) return;
                const data = event.data;
                if (!data || data.id !== id) return;

                if (data.type === 'rz-scan-control') handlers.onControl?.(data.control);
                else if (data.type === 'rz-scan-progress') handlers.onProgress?.(data);
                else if (data.type === 'rz-scan-done') finish(resolve, data);
                else if (data.type === 'rz-scan-error') finish(reject, rzScanError(data));
            }

            window.addEventListener('message', onMessage);
            rzScanInFlight = {
                id,
                stop: () => frame.contentWindow.postMessage({ type: 'rz-scan-stop', id }, '*')
            };
            frame.contentWindow.postMessage({ type: 'rz-scan', id, addresses }, '*');
        }, reject);
    });
}

/**
 * Turns a frame error code into something an operator can act on.
 *
 * `not-separated` is the one that matters. It means the two control probes came back
 * indistinguishable, which happens when a policy blocks the requests: they then reject
 * instantly and every address measures about 0 ms. Saying "the measurement is blocked"
 * is the only honest response, because the alternative is a ranked list of noise.
 */
function rzScanError(data) {
    const messages = {
        'no-addresses': 'No candidate addresses were generated.',
        intercepted: 'Something on this network answers for every address, so no measurement here describes Cloudflare. A captive portal or a filtering proxy will do this.',
        'no-connectivity': 'No address responded at all, including the control. Check that this device is online.',
        'not-separated': 'The measurement could not distinguish a reachable address from an unreachable one, so the results would be meaningless. Scanning was stopped rather than reporting them.'
    };
    return new Error(messages[data.error] || `Measurement failed: ${data.error}`);
}

/** Stops the scan in flight. Takes effect within one address, not at the end. */
function rzStopScan() {
    rzScanInFlight?.stop();
}

function rzScanDepthLabel(depth) {
    return depth === 'deep' ? t('Deep') : t('Quick');
}

/**
 * The full scan, driven from the button.
 *
 * Progress is rendered from the frame's reports rather than estimated, so the bar
 * reflects addresses actually measured. A Deep scan takes about thirty-six seconds on a
 * normal connection, which is why Stop exists and why the estimate is shown up front.
 */
async function rzRunDeviceScan(depth) {
    const root = document.getElementById('rz-device-scan-results');
    const runButtons = [...document.querySelectorAll('[data-rz-scan-depth]')];
    const stopButton = document.getElementById('rz-device-scan-stop');
    if (!root) return;

    const setBusy = busy => {
        runButtons.forEach(button => { button.disabled = busy; });
        if (stopButton) stopButton.hidden = !busy;
    };

    setBusy(true);
    const bar = elm('div', { className: 'rz-progress-bar' }, elm('span', { style: 'width:0%' }));
    const label = elm('p', { className: 'rz-muted' }, t('Preparing…'));
    root.replaceChildren(elm('div', { className: 'rz-scan-live' }, [label, bar]));

    try {
        const plan = await rzScanApi('plan', { depth });

        label.textContent = `${t('Measuring')} ${plan.count} ${t('addresses from your device')} · ~${plan.estimateSeconds}${t('s')}`;

        // What earlier scans taught, stated before the results arrive so the operator can
        // see the scan is not starting from scratch, and can judge whether the history is
        // worth trusting yet.
        if (plan.learning?.summary) {
            root.firstChild.append(elm('p', { className: 'rz-muted rz-scan-learning' }, plan.learning.summary));
        }

        const outcome = await rzMeasure(plan.addresses, {
            onControl: control => {
                if (!control.usable) return;
                // Stated once, up front: it is the evidence that the numbers below are
                // real, and it is cheap to show.
                label.textContent = `${t('Measuring')} ${plan.count} ${t('addresses from your device')}`
                    + ` · ${t('control')} ${control.reachableMs}${t('ms')}`;
            },
            onProgress: progress => {
                const percent = Math.round((progress.done / progress.total) * 100);
                bar.firstChild.style.width = `${percent}%`;
                label.textContent = `${progress.done} / ${progress.total} ${t('measured')} · ${percent}%`;
            }
        });

        const scored = await rzScanApi('record', {
            depth,
            results: outcome.results,
            elapsed: outcome.elapsed,
            stopped: outcome.stopped
        });

        rzRenderDeviceScan(root, scored, outcome, depth);
    } catch (error) {
        root.replaceChildren(elm('div', { className: 'rz-inline-error' }, [
            rzIcon('error'),
            elm('span', {}, error.message)
        ]));
    } finally {
        setBusy(false);
    }
}

/** Renders a finished scan: the winner, the ranked list, and the block rollup. */
function rzRenderDeviceScan(root, scored, outcome, depth) {
    const results = Array.isArray(scored.results) ? scored.results : [];
    const reachable = results.filter(result => result.score > 0);

    if (!reachable.length) {
        root.replaceChildren(elm('div', { className: 'rz-inline-error' }, [
            rzIcon('info'),
            elm('span', {}, t('No address responded from this network. That is itself a finding: this connection reaches no Cloudflare edge directly.'))
        ]));
        return;
    }

    const best = scored.best;
    const testedAt = Date.now();
    rzLatestScanResults = reachable.slice(0, 30);
    rzSelectedCleanIp = best.address;
    try {
        localStorage.setItem('rz-last-device-scan', JSON.stringify({
            at: testedAt,
            depth,
            best: {
                address: best.address,
                latency: Math.round(best.latency),
                success: best.success,
                jitter: Math.round(best.jitter),
                score: best.score,
                reliability: best.score
            },
            results: reachable.slice(0, 20).map(result => ({
                address: result.address,
                latency: Math.round(result.latency),
                success: result.success,
                jitter: Math.round(result.jitter),
                score: result.score
            }))
        }));
    } catch { /* device history is an enhancement; the server summary is already saved */ }
    const summary = elm('div', { className: 'rz-scan-summary' }, [
        elm('div', {}, [
            elm('p', { className: 'rz-card-label' }, t('FASTEST FROM YOUR NETWORK')),
            elm('strong', { className: 'rz-scan-winner' }, best.address),
            elm('span', { className: 'rz-muted rz-scan-selection-note' },
                `${Math.round(best.latency)}${t('ms')} · ${Math.round(best.success * 100)}% success · ${best.score}% reliability`)
        ]),
        elm('div', { className: 'rz-scan-actions' }, [
            elm('button', {
                id: 'rz-apply-selected-ip', type: 'button', className: 'button rz-action',
                onclick: rzApplySelectedCleanIp
            }, [rzIcon('settings'), t('Apply selected IP')]),
            elm('button', {
                type: 'button', className: 'button rz-secondary-action',
                onclick: rzSaveSelectedCleanIp
            }, [rzIcon('download'), t('Save IP')]),
            elm('button', {
                type: 'button', className: 'rz-text-action',
                onclick: () => rzCopy(rzSelectedCleanIp || best.address, t('Address copied'))
            }, [rzIcon('content_copy'), t('Copy')])
        ])
    ]);

    // The counts, stated plainly. A scan that measured 1000 addresses and found 90
    // reachable has said something important about this network, and hiding that behind
    // a ranked list would waste it.
    const stats = elm('div', { className: 'rz-scan-stats' }, [
        rzStat(`${results.length}`, t('measured')),
        rzStat(`${reachable.length}`, t('reachable')),
        rzStat(`${Math.round((outcome.elapsed || 0) / 1000)}${t('s')}`, t('elapsed')),
        rzStat(scored.medianScore === null ? '—' : `${scored.medianScore}`, t('median score'))
    ]);

    const ranked = elm('div', { className: 'rz-scan-section rz-result-section' }, [
        elm('div', { className: 'rz-result-heading' }, [
            elm('div', {}, [elm('p', { className: 'rz-card-label' }, t('RANKED ADDRESSES')), elm('h3', {}, 'Choose the endpoint to use')]),
            elm('small', {}, 'Select changes the candidate. Apply IP updates the active Clean IP configuration; Save IP keeps a device-local favourite.')
        ]),
        elm('div', { className: 'rz-result-columns', 'aria-hidden': 'true' }, ['IP', 'Latency', 'Success', 'Reliability', 'Last tested'].map(label => elm('span', {}, label))),
        elm('div', { className: 'rz-result-list', role: 'radiogroup', 'aria-label': 'Clean IP scan results' }, reachable.slice(0, 15).map((result, index) =>
            cleanIpResultRow(result, index, testedAt)
        ))
    ]);

    const blocks = Array.isArray(scored.blocks) ? scored.blocks.filter(block => block.reachable > 0) : [];
    const blockSection = blocks.length
        ? elm('div', { className: 'rz-scan-section' }, [
            elm('p', { className: 'rz-card-label' }, t('BEST ADDRESS BLOCKS')),
            elm('p', { className: 'rz-muted' }, t('An individual address can be withdrawn at any time; the block it belongs to is a more stable statement about what your ISP routes well. Later scans start with the blocks that have performed best here.')),
            ...blocks.slice(0, 6).map(block => elm('div', { className: 'rz-rank' }, [
                elm('strong', {}, block.block),
                elm('span', { className: 'rz-score' }, `${block.medianScore}/100`),
                elm('small', {}, `${block.reachable}/${block.measured} ${t('reachable')} · ${t('median')} ${block.medianLatency}${t('ms')}`)
            ]))
        ])
        : elm('span');

    const notes = [];
    if (outcome.stopped) {
        notes.push(t('Stopped early, so this covers only part of the address space.'));
    }
    if (scored.intercepted > 0) {
        notes.push(`${scored.intercepted} ${t('addresses returned a real response instead of refusing the connection, which means something on the path answered for them. They are excluded.')}`);
    }
    const noteBlock = notes.length
        ? elm('div', { className: 'rz-scan-notes' }, notes.map(note => elm('p', { className: 'rz-muted' }, note)))
        : elm('span');

    root.replaceChildren(elm('div', {}, [summary, stats, ranked, blockSection, learningSection(scored), noteBlock]));
}

function cleanIpResultRow(result, index, testedAt) {
    const selected = result.address === rzSelectedCleanIp;
    return elm('button', {
        type: 'button', className: `rz-result-row${selected ? ' selected' : ''}`,
        role: 'radio', 'aria-checked': String(selected), 'data-address': result.address,
        onclick: () => rzSelectCleanIp(result.address)
    }, [
        elm('span', { className: 'rz-result-address' }, [elm('i'), elm('strong', {}, result.address), elm('small', {}, `#${index + 1} · ${result.verdict}`)]),
        elm('span', { 'data-label': 'Latency' }, `${Math.round(result.latency)} ms`),
        elm('span', { 'data-label': 'Success' }, `${Math.round(result.success * 100)}%`),
        elm('span', { 'data-label': 'Reliability' }, `${result.score}%`),
        elm('span', { 'data-label': 'Last tested' }, rzFormatTime(testedAt))
    ]);
}

function rzSelectCleanIp(address) {
    rzSelectedCleanIp = address;
    document.querySelectorAll('.rz-result-row').forEach(row => {
        const selected = row.dataset.address === address;
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-checked', String(selected));
    });
    const winner = document.querySelector('.rz-scan-winner');
    if (winner) winner.textContent = address;
    const selected = rzLatestScanResults.find(result => result.address === address);
    const selectionNote = document.querySelector('.rz-scan-selection-note');
    if (selectionNote && selected) selectionNote.textContent = `${Math.round(selected.latency)} ms · ${Math.round(selected.success * 100)}% success · ${selected.score}% reliability`;
    const apply = document.getElementById('rz-apply-selected-ip');
    if (apply) apply.replaceChildren(rzIcon('settings'), t('Apply selected IP'));
}

function rzApplySelectedCleanIp() {
    if (!rzSelectedCleanIp) return;
    const selected = rzLatestScanResults.find(result => result.address === rzSelectedCleanIp);
    rzUseAsCleanIp([rzSelectedCleanIp]);
    const apply = document.getElementById('applyButton');
    if (apply) {
        apply.click();
        notify('info', 'Clean IP applied', [`${rzSelectedCleanIp}${selected ? ` · ${Math.round(selected.latency)} ms` : ''}`, 'Generated subscriptions now use this endpoint after clients refresh.']);
    }
}

function rzApplyCandidateCleanIp(address) {
    rzSelectedCleanIp = address;
    rzApplySelectedCleanIp();
}

function rzSaveSelectedCleanIp() {
    if (!rzSelectedCleanIp) return;
    try {
        const saved = JSON.parse(localStorage.getItem('rz-saved-clean-ips') || '[]');
        const next = [...new Set([rzSelectedCleanIp, ...(Array.isArray(saved) ? saved : [])])].slice(0, 20);
        localStorage.setItem('rz-saved-clean-ips', JSON.stringify(next));
        notify('info', 'IP saved on this device', [rzSelectedCleanIp, 'Use Apply IP when you want generated configurations to switch to it.']);
    } catch {
        notify('error', 'IP could not be saved', ['Private storage is unavailable in this browser.']);
    }
}

/**
 * What the deployment has learned across scans, as opposed to what this scan found.
 *
 * Separate from the block rollup above it, which is this run only. The distinction
 * matters: one scan's ranking is a snapshot, and the accumulated view is the thing that
 * justifies calling it learning. Confidence is shown per row rather than averaged away,
 * because a confident 70 is more actionable than an unconfident 95.
 */
function learningSection(scored) {
    const learned = Array.isArray(scored.learning?.blocks) ? scored.learning.blocks : [];
    if (!learned.length) return elm('span');

    return elm('div', { className: 'rz-scan-section' }, [
        elm('p', { className: 'rz-card-label' }, t('LEARNED ACROSS SCANS')),
        elm('p', { className: 'rz-muted' }, scored.learning.summary || ''),
        ...learned.map(entry => elm('div', { className: 'rz-rank' }, [
            elm('strong', {}, entry.block),
            elm('span', { className: 'rz-score' }, `${entry.score}/100`),
            elm('small', {}, `${entry.latency}${t('ms')} · `
                + `${entry.observations} ${t('scans over')} ${entry.days} ${t('days')} · `
                + `${rzPercent(entry.confidence)}% ${t('confidence')} · ${t(entry.trend)}`)
        ]))
    ]);
}

function rzStat(value, label) {
    return elm('div', { className: 'rz-scan-stat' }, [
        elm('strong', {}, value),
        elm('span', {}, label)
    ]);
}

/** Copies text and confirms it, because a copy with no feedback is indistinguishable from a no-op. */
function rzCopy(text, message) {
    navigator.clipboard?.writeText(text)
        .then(() => notify('info', message, [text]))
        .catch(() => notify('error', t('Could not copy'), [text]));
}

/**
 * Stages addresses into the clean-IP field without saving.
 *
 * Staging rather than saving, for the same reason every other recommendation in the
 * panel stages: the operator reviews and presses Save. A scanner that silently rewrote
 * the live configuration would be the one feature in RayZen that changes settings
 * behind your back.
 */
function rzUseAsCleanIp(addresses) {
    const field = document.getElementById('cleanIPs');
    if (!field) {
        notify('error', t('Configuration form not loaded'), [t('Open Configuration first, then run the scan again.')]);
        return;
    }
    field.value = addresses.join(',');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    goToView('configuration');
    notify('info', t('Staged for review'), [
        `${addresses.length} ${t('addresses were placed in the Clean IP field.')}`,
        t('Nothing is saved until you press Save configuration.')
    ]);
}

function elm(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
        if (name.startsWith('data-') || name.startsWith('aria-') || name === 'role') {
            node.setAttribute(name, String(value));
        } else {
            node[name] = value;
        }
    }
    node.append(...[].concat(children));
    return node;
}

/**
 * The pre-RayZen icon constructor, still used by the subscription table, the noise rows
 * and the client list.
 *
 * Now an alias for `rzIcon` rather than a font span. Kept as its own name because those
 * three call sites pass Material names (`qr_code`, `content_copy`) that `rzIcon` resolves
 * through the alias table and the extracted-glyph table, so renaming them at every site
 * would be churn with no behaviour change.
 */
const createIcon = (text) => rzIcon(text);

function createFormControl(labelText, action) {
    const label = elm('span', { textContent: labelText }, action ? createIcon('refresh') : []);
    const control = elm('div', { className: 'form-control' }, [label, elm('div')]);

    return control;
}

async function deleteNoise(event) {
    const confirm = await notify('confirm', 'Delete UDP noise', ['Are you sure?']);
    if (!confirm) return;

    event.target.closest('.inner-container').remove();
    handleProxyFormChanges();
}

function addNoise(isManual, noiseIndex, udpNoise) {
    const index = noiseIndex
        ? noiseIndex
        : document.getElementById('noises').childElementCount;

    const noise = udpNoise || {
        type: 'rand',
        packet: '50-100',
        delay: '1-5',
        count: 5
    };

    const heading = elm('h4', { textContent: `Noise ${index + 1}` });
    const headerDiv = elm('div', { className: 'header-container' }, heading);

    if (index !== 0) {
        const deleteBtn = elm('button', {
            type: 'button',
            className: 'delete-noise',
            'aria-label': `Delete noise ${index + 1}`,
            onclick: deleteNoise
        }, createIcon('delete'));
        headerDiv.appendChild(deleteBtn);
    }

    const modeOptions = [
        ['base64', 'Base64'],
        ['rand', 'Random'],
        ['str', 'String'],
        ['hex', 'Hex'],
        ['array', 'Array']
    ].map(([value, label]) => elm('option', { value, textContent: label, selected: noise.type === value }));

    const modeSelect = elm('select', { name: 'udpXrayNoiseMode', 'aria-label': `Noise ${index + 1} mode` }, modeOptions);
    const modeControl = createFormControl('Mode');

    const selectWrapper = modeControl.querySelector('div');
    selectWrapper.className = 'select-wrapper';
    selectWrapper.append(modeSelect, createIcon('keyboard_arrow_down'))

    const packetInput = elm('input', { type: 'text', name: 'udpXrayNoisePacket', value: noise.packet, 'aria-label': `Noise ${index + 1} packet` });
    const packetControl = createFormControl('Packet', true);
    packetControl.querySelector('div').appendChild(packetInput);
    // `createFormControl(label, true)` appends the refresh icon inside the label. The
    // selector was `.material-symbols-rounded`, which stopped matching when icons became
    // SVG spans, so the regenerate button silently lost its click handler.
    const generateBtn = packetControl.querySelector('.rz-icon');

    modeSelect.onchange = generateBtn.onclick = () => genNoisePacket(modeSelect, packetInput);

    const countInput = elm('input', {
        type: 'number', name: 'udpXrayNoiseCount', value: String(noise.count), min: '1', required: true, 'aria-label': `Noise ${index + 1} count`
    });
    const countControl = createFormControl('Count');
    countControl.querySelector('div').appendChild(countInput);

    const [delayMin, delayMax] = noise.delay.split('-');
    const delayMinInput = elm('input', { type: 'number', name: 'udpXrayNoiseDelayMin', value: delayMin, min: '1', required: true, 'aria-label': `Noise ${index + 1} minimum delay` });
    const delayMaxInput = elm('input', { type: 'number', name: 'udpXrayNoiseDelayMax', value: delayMax, min: '1', required: true, 'aria-label': `Noise ${index + 1} maximum delay` });
    const minMaxDiv = elm('div', { className: 'min-max' }, [delayMinInput, elm('span', { textContent: ' - ' }), delayMaxInput]);
    const delayControl = createFormControl('Delay');
    delayControl.querySelector('div').appendChild(minMaxDiv);

    const section = elm('div', { className: 'section' }, [modeControl, packetControl, countControl, delayControl]);
    const container = elm('div', { className: 'inner-container' }, [headerDiv, section]);

    document.getElementById('noises').append(container);
    if (isManual) handleProxyFormChanges(true);
}

function renderPorts(ports) {
    let noneTlsPortsBlock = document.createDocumentFragment();
    let tlsPortsBlock = document.createDocumentFragment();

    const totalPorts = [
        ...(window.origin.includes('workers.dev') ? defaultHttpPorts : []),
        ...defaultHttpsPorts
    ];

    totalPorts.forEach(port => {
        const isChecked = ports.includes(port);
        const isHttpsPort = defaultHttpsPorts.includes(port);

        const checkbox = elm('input', {
            type: 'checkbox',
            name: String(port),
            value: 'true',
            checked: isChecked,
            'aria-label': `${isHttpsPort ? 'TLS' : 'non-TLS'} port ${port}`
        });

        const label = elm('span', { textContent: String(port) });
        const wrapper = elm('div', { className: 'checkbox-wrapper' }, [checkbox, label]);

        if (isHttpsPort) {
            tlsPortsBlock.appendChild(wrapper);
        } else {
            noneTlsPortsBlock.appendChild(wrapper);
        }
    });

    const tlsContainer = document.getElementById('tls-ports');
    tlsContainer.replaceChildren();
    tlsContainer.appendChild(tlsPortsBlock);

    const nonTlsContainer = document.getElementById('non-tls-ports');
    if (noneTlsPortsBlock.childElementCount > 0) {
        nonTlsContainer.replaceChildren();
        nonTlsContainer.appendChild(noneTlsPortsBlock);
        document.getElementById('none-tls').hidden = false;
    }
}

function renderNoises(xrayUdpNoises) {
    document.getElementById('noises').replaceChildren();
    xrayUdpNoises.forEach((noise, index) => {
        addNoise(false, index, noise);
    });
}

function subscriptionMeta(type) {
    const catalogue = {
        normal: ['Recommended', 'Best first choice', 'Balanced compatibility for everyday use.', 'Use this unless a specific network or client needs another format.', 'verified'],
        fragment: ['Restricted networks', 'Extra resistance', 'Adds fragmentation for networks that interfere with ordinary TLS traffic.', 'Can trade a little speed for compatibility.', 'security'],
        raw: ['Advanced', 'Direct config list', 'Provides raw links for clients that manage individual configurations themselves.', 'Client refresh varies.', 'configuration'],
        warp: ['WARP routing', 'Cloudflare egress', 'Routes compatible profiles through the deployment-specific WARP account.', 'Useful when destination routing matters more than minimum latency.', 'overview'],
        'warp-pro': ['Specialized', 'WARP with advanced clients', 'Formats WARP profiles for specialized Xray, Clash and Amnezia clients.', 'Requires explicit client support.', 'action']
    };
    return catalogue[type] || ['Available', 'Subscription format', 'A compatible RayZen subscription.', 'Choose the client core you already use.', 'link'];
}

function subscriptionAction(label, icon, onclick, primary = false) {
    return elm('button', { type: 'button', className: primary ? 'button rz-action rz-sub-action' : 'button rz-secondary-action rz-sub-action', onclick }, [rzIcon(icon), elm('span', {}, t(label))]);
}

function renderSubscriptions(subscriptions) {
    if (!subscriptions) return;
    const host = document.getElementById('subscriptions');
    host.querySelectorAll(':scope > .accordion-item, :scope > .rz-subscription-guide, :scope > .rz-subscription-flow').forEach(item => item.remove());
    const normal = subscriptions.normal;
    const first = normal?.categories?.[0];
    if (first) {
        const url = generateSubUrl('normal', first.core, normal.label);
        host.append(elm('section', { className: 'rz-subscription-guide' }, [
            elm('div', { className: 'rz-sub-guide-copy' }, [
                elm('span', { className: 'rz-sub-badge' }, [rzIcon('verified'), t('Recommended start')]),
                elm('h3', {}, t('Start with Normal')),
                elm('p', {}, t('Best compatibility.')),
                elm('div', { className: 'rz-sub-guide-facts' }, [
                    elm('span', {}, [rzIcon('overview'), t('Desktop + mobile')]),
                    elm('span', {}, [rzIcon('refresh'), t('Refreshes in your client')]),
                    elm('span', {}, [rzIcon('tune'), t('Uses your saved configuration')])
                ])
            ]),
            elm('div', { className: 'rz-sub-guide-actions' }, [
                subscriptionAction('Show QR', 'qr_code', () => showQRCode(url), true),
                subscriptionAction('Copy link', 'content_copy', () => copyToClipboard(url)),
                subscriptionAction('Download', 'download', () => dlUrl(url))
            ])
        ]));
    }
    for (const [type, { label, categories }] of Object.entries(subscriptions)) {
        const [badge, title, copy, tradeoff, icon] = subscriptionMeta(type);
        const headerCopy = elm('div', { className: 'rz-subscription-summary-copy' }, [
            elm('span', { className: 'rz-subscription-icon' }, rzIcon(icon)),
            elm('span', {}, [elm('strong', {}, t(label)), elm('small', {}, t(title))])
        ]);
        const summary = elm('summary', {}, [headerCopy, elm('span', { className: 'rz-subscription-summary-meta' }, [elm('small', {}, `${categories.length} ${t('formats')}`), elm('span', { className: type === 'normal' ? 'rz-sub-badge' : 'rz-sub-tag' }, t(badge)), rzIcon('keyboard_arrow_down')])]);
        const section = elm('details', { open: type === 'normal' }, summary);
        const intro = elm('div', { className: 'rz-subscription-intro' }, [elm('p', {}, t(copy)), elm('p', {}, [elm('strong', {}, `${t('Tradeoff')}: `), t(tradeoff)])]);
        const options = elm('div', { className: 'rz-subscription-options' }, categories.map(({ core, clients }, index) => {
            const url = generateSubUrl(type, core, label);
            const wgCore = ['wireguard', 'amnezia'].includes(core);
            const actions = [];
            if (!wgCore) {
                actions.push(subscriptionAction('Show QR', 'qr_code', () => showQRCode(url), type === 'normal' && index === 0));
                actions.push(subscriptionAction('Copy link', 'content_copy', () => copyToClipboard(url)));
            }
            if (type !== 'raw') actions.push(subscriptionAction(wgCore ? 'Download file' : 'Download', 'download', () => dlUrl(url), wgCore));
            return elm('article', { className: 'rz-subscription-option' }, [
                elm('div', { className: 'rz-sub-option-heading' }, [
                    elm('div', {}, [elm('span', { className: 'rz-core-label' }, core.replaceAll('-', ' ')), elm('h4', {}, wgCore ? t('File import') : t('Remote subscription'))]),
                    type === 'normal' && index === 0 ? elm('span', { className: 'rz-sub-tag rz-sub-tag-good' }, t('Easiest')) : elm('span')
                ]),
                elm('p', { className: 'rz-sub-option-label' }, t('Compatible clients')),
                elm('div', { className: 'rz-client-chips' }, clients.map(client => elm('span', {}, [rzIcon('verified'), client]))),
                elm('div', { className: 'rz-sub-option-actions' }, actions)
            ]);
        }));
        section.append(intro, options);
        host.append(elm('div', { className: 'accordion-item rz-subscription-group' }, section));
    }
}

let rzSupportedClients = [];
let rzClientSort = { key: 'name', direction: 1 };

function rzSortSupportedClients(key) {
    if (rzClientSort.key === key) rzClientSort.direction *= -1;
    else rzClientSort = { key, direction: 1 };
    renderClients();
}

function renderClients(clients) {
    if (Array.isArray(clients)) rzSupportedClients = [...clients];
    const body = document.getElementById('supported-clients');
    if (!body) return;
    body.replaceChildren();

    document.querySelectorAll('[data-client-sort]').forEach(button => {
        const th = button.closest('th');
        const active = button.dataset.clientSort === rzClientSort.key;
        th?.setAttribute('aria-sort', active ? (rzClientSort.direction > 0 ? 'ascending' : 'descending') : 'none');
        button.classList.toggle('active', active);
        button.onclick = () => rzSortSupportedClients(button.dataset.clientSort);
    });

    if (!rzSupportedClients.length) {
        body.append(elm('tr', { className: 'rz-table-empty' }, [elm('td', { colSpan: 3 }, t('No supported clients are available.'))]));
        return;
    }

    const value = (client, key) => String(client?.[key] ?? '').toLocaleLowerCase();
    const sorted = [...rzSupportedClients].sort((a, b) => value(a, rzClientSort.key).localeCompare(value(b, rzClientSort.key), rzLocale(), { numeric: true }) * rzClientSort.direction);
    sorted.forEach(client => {
        const name = elm('td', { scope: 'col', textContent: client.name });
        const minVer = elm('td', { scope: 'col', textContent: client.minVer });
        const source = elm('span', { textContent: client.source });
        const dlBtn = elm('a', {
            href: atob(client.b64Url),
            target: '_blank',
            rel: 'noopener noreferrer',
            'aria-label': `${t('Get Latest')}: ${client.name}`
        }, createIcon('download'));
        const download = elm('td', {}, [source, dlBtn]);
        body.appendChild(elm('tr', {}, [name, minVer, download]));
    });
}
