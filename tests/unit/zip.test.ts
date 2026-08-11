/**
 * ZIP writer tests.
 *
 * The point of these is not that the function returns bytes; it is that the bytes
 * are a *valid archive*. `src/cores/zip.ts` replaced `jszip`, so the only thing
 * standing between a 28 KB bundle saving and a broken WireGuard download is
 * evidence that real readers accept the output.
 *
 * So the central test writes an archive to disk and extracts it with the system
 * `unzip`, which is an independent implementation of the format. Structural
 * assertions (signatures, CRC, offsets) catch *why* something is wrong; the
 * round-trip catches *that* it is wrong, including in the ways we did not think to
 * assert.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zipStore } from '@cores/zip';

/** Reads a little-endian u32 at `offset`. */
const u32 = (bytes: Uint8Array, offset: number): number =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

const u16 = (bytes: Uint8Array, offset: number): number =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);

/** Extracts with the system `unzip`, returning name -> content. */
function extract(archive: Uint8Array): Record<string, string> {
    const dir = mkdtempSync(join(tmpdir(), 'rayzen-zip-'));

    try {
        const path = join(dir, 'archive.zip');
        writeFileSync(path, archive);

        // `-o` overwrite, `-q` quiet. A non-zero exit throws, which is the
        // assertion: unzip rejects a malformed archive.
        execFileSync('unzip', ['-oq', path, '-d', join(dir, 'out')], { stdio: 'pipe' });

        const outDir = join(dir, 'out');
        const result: Record<string, string> = {};
        for (const name of readdirSync(outDir)) {
            result[name] = readFileSync(join(outDir, name), 'utf8');
        }

        return result;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('crc32', () => {
    // The canonical check value from the CRC-32 specification. If this passes, the
    // table and the reflection are both right, which is most of what can go wrong.
    it('produces the standard check value for "123456789"', () => {
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    });

    it('is 0 for empty input', () => {
        expect(crc32(new Uint8Array(0))).toBe(0);
    });

    it('produces the known value for "The quick brown fox jumps over the lazy dog"', () => {
        expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(
            0x414fa339
        );
    });
});

describe('zipStore structure', () => {
    const entries = [
        { name: 'RayZen-Warp-1.conf', content: '[Interface]\nPrivateKey = aaa\n' },
        { name: 'RayZen-Warp-2.conf', content: '[Interface]\nPrivateKey = bbb\n' }
    ];

    it('starts with the local file header signature', () => {
        expect(u32(zipStore(entries), 0)).toBe(0x04034b50);
    });

    it('ends with the end-of-central-directory record', () => {
        const archive = zipStore(entries);
        expect(u32(archive, archive.length - 22)).toBe(0x06054b50);
    });

    it('records the entry count in both EOCD fields', () => {
        const archive = zipStore(entries);
        const eocd = archive.length - 22;
        expect(u16(archive, eocd + 8)).toBe(2);
        expect(u16(archive, eocd + 10)).toBe(2);
    });

    it('points the central directory offset at a central header signature', () => {
        const archive = zipStore(entries);
        const eocd = archive.length - 22;
        const centralStart = u32(archive, eocd + 16);
        expect(u32(archive, centralStart)).toBe(0x02014b50);
    });

    it('records a central directory size that reaches exactly the EOCD', () => {
        const archive = zipStore(entries);
        const eocd = archive.length - 22;
        expect(u32(archive, eocd + 12) + u32(archive, eocd + 16)).toBe(eocd);
    });

    it('stores entries uncompressed, with equal compressed and uncompressed sizes', () => {
        const archive = zipStore(entries);
        expect(u16(archive, 8)).toBe(0); // compression method
        expect(u32(archive, 18)).toBe(u32(archive, 22));
    });

    it('is byte-reproducible, so goldens can assert a length', () => {
        expect(Array.from(zipStore(entries))).toEqual(Array.from(zipStore(entries)));
    });

    it('produces a valid empty archive', () => {
        const archive = zipStore([]);
        expect(archive.length).toBe(22);
        expect(u32(archive, 0)).toBe(0x06054b50);
    });
});

describe('zipStore round trip through system unzip', () => {
    it('extracts two WireGuard configs with byte-identical contents', () => {
        const entries = [
            {
                name: 'RayZen-Warp-1.conf',
                content:
                    '[Interface]\nPrivateKey = AAAA\nAddress = 172.16.0.2/32\nMTU = 1280\n\n' +
                    '[Peer]\nPublicKey = BBBB\nAllowedIPs = 0.0.0.0/0, ::/0\n' +
                    'Endpoint = engage.cloudflareclient.com:2408\nPersistentKeepalive = 25'
            },
            {
                name: 'RayZen-Warp-2.conf',
                content: '[Interface]\nPrivateKey = CCCC\n\n[Peer]\nPublicKey = DDDD'
            }
        ];

        const extracted = extract(zipStore(entries));

        expect(Object.keys(extracted).sort()).toEqual(['RayZen-Warp-1.conf', 'RayZen-Warp-2.conf']);
        expect(extracted['RayZen-Warp-1.conf']).toBe(entries[0].content);
        expect(extracted['RayZen-Warp-2.conf']).toBe(entries[1].content);
    });

    it('survives a single entry', () => {
        const extracted = extract(zipStore([{ name: 'only.conf', content: 'x' }]));
        expect(extracted['only.conf']).toBe('x');
    });

    it('survives content containing bytes that could be mistaken for signatures', () => {
        // 'PK\x03\x04' inside a body is exactly the case a naive reader gets wrong,
        // and exactly the case correct offsets make harmless.
        const content = 'PK\u0003\u0004 not a header\nPK\u0005\u0006 also not';
        const extracted = extract(zipStore([{ name: 'tricky.conf', content }]));
        expect(extracted['tricky.conf']).toBe(content);
    });
});

describe('zipStore rejects what it does not support', () => {
    it('rejects a non-ASCII entry name rather than emitting an ambiguous one', () => {
        expect(() => zipStore([{ name: 'کانفیگ.conf', content: 'x' }])).toThrow(/printable ASCII/);
    });

    it('rejects a control character in an entry name', () => {
        expect(() => zipStore([{ name: 'bad\u0000name.conf', content: 'x' }])).toThrow(/printable ASCII/);
    });
});
