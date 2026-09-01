/**
 * Types for scripts/make-favicon.mjs.
 *
 * The build scripts are plain ESM JavaScript by design: they run under `node` with no
 * compile step. `tests/golden/brand.test.ts` imports the icon pipeline from this one so
 * it can re-derive the committed asset instead of trusting it, and under `strict` an
 * untyped import is an error. Declaring the four exported functions here keeps the
 * script untranspiled while giving the test real types.
 */
export interface DecodedImage {
    width: number;
    height: number;
    /** Flat RGBA bytes, 4 per pixel, row-major from the top. */
    rgba: Buffer;
}

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

/** The brand navy the icon is composited onto. */
export declare const BACKGROUND: Rgb;

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG. Throws on anything else. */
export declare function decodePng(buffer: Buffer): DecodedImage;

/** Box-downsamples to `size` x `size`, averaging in premultiplied space. */
export declare function downsample(image: DecodedImage, size: number): DecodedImage;

/** Composites the mark onto `background` inside a rounded square. */
export declare function composite(image: DecodedImage, background: Rgb): DecodedImage;

/** Wraps RGBA in a single-image 32-bit ICO. */
export declare function encodeIco(image: DecodedImage): Buffer;

/** decode -> downsample -> composite -> encode, as the committed asset was produced. */
export declare function buildFavicon(pngBuffer: Buffer, size?: number, background?: Rgb): Buffer;
