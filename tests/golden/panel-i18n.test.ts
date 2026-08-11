/**
 * The panel's Persian translation, checked statically.
 *
 * The panel translates two ways and both fail silently. `t(string)` looks a key up when
 * the script builds text; `rzTranslateTree()` walks text nodes and placeholders and
 * substitutes any exact match, including in markup added later, via a MutationObserver.
 *
 * So a missing entry is not an error. It is an English word in the middle of a Persian
 * sentence, which nobody notices unless they read Persian and happen to open that
 * screen. These tests make the gap countable instead.
 *
 * The bar is deliberately a ratchet rather than "everything": protocol, client and
 * vendor names are Latin on purpose, because Persian users read and search for them
 * that way. What is asserted is that coverage does not regress, and that no string the
 * script explicitly asks to translate is missing a translation.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, '..', '..', 'src', 'assets', 'panel', 'script.js');
const script = readFileSync(SCRIPT, 'utf8');

/** The dictionary literal plus every `Object.assign(RZ_FA, {...})` block. */
function dictionaryBlocks(): string[] {
    const blocks: string[] = [];
    const starts = [
        script.indexOf('const RZ_FA = {'),
        ...[...script.matchAll(/Object\.assign\(RZ_FA,\s*\{/gu)].map(match => match.index ?? -1)
    ].filter(index => index >= 0);

    for (const start of starts) {
        let depth = 0;
        for (let index = script.indexOf('{', start); index < script.length; index++) {
            const character = script[index];
            if (character === '{') depth++;
            else if (character === '}' && --depth === 0) {
                blocks.push(script.slice(start, index + 1));
                break;
            }
        }
    }
    return blocks;
}

const blocks = dictionaryBlocks();
const dictionary = blocks.join('\n');

/** Keys, read from the literal. Handles both quote styles. */
const keys = new Set<string>([
    ...[...dictionary.matchAll(/(?:^|[\s{,])'((?:[^'\\]|\\.)*)'\s*:/gmu)].map(match => match[1]),
    ...[...dictionary.matchAll(/(?:^|[\s{,])"((?:[^"\\]|\\.)*)"\s*:/gmu)].map(match => match[1])
]);

/**
 * Strings the script explicitly asks to translate.
 *
 * Comments are stripped first. A doc comment that quotes a call, as the shared-links
 * section does when it explains why sentence fragments were replaced with placeholder
 * templates, is documentation rather than a call site, and demanding a translation for
 * the fragment it is arguing against would be exactly backwards.
 */
const executable = script
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/[^\n]*/gmu, '');

const translated = new Set<string>(
    [...executable.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/gu)].map(match => match[1])
);

describe('the Persian dictionary is wired up', () => {
    it('is defined once and extended in a countable number of places', () => {
        // Nine today: the base literal plus focused extension blocks for panel markup,
        // scanner/subscription vocabulary, and later product surfaces. This exists so the
        // extractor cannot silently miss one, while still allowing the dictionary to be
        // reorganized deliberately without coupling the test to an exact block count.
        expect(blocks.length).toBeGreaterThanOrEqual(4);
        expect(blocks.length).toBeLessThanOrEqual(10);
    });

    it('holds no fewer entries than it does today', () => {
        // A ratchet at the current count of 365, which rose from 319 when shared
        // subscription links landed and from 253 when the device-side scanner did. Raise
        // it when translations are added; never lower it without saying why in the same
        // commit.
        expect(keys.size).toBeGreaterThanOrEqual(365);
    });

    it('every value is Persian, not an English string copied across', () => {
        // A key whose value is byte-identical to the key is a translation nobody did.
        // Latin-script values are legitimate (protocol and client names), so the test is
        // on identity rather than on script.
        const intentionallyLatin = new Set(['DNS', 'ECH']);
        const untranslated = [...dictionary.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/gu)]
            .filter(match => match[1] === match[2] && !intentionallyLatin.has(match[1]))
            .map(match => match[1]);

        expect(untranslated).toEqual([]);
    });
});

describe('every string the script asks to translate has a translation', () => {
    it('t() is never called with a key the dictionary lacks', () => {
        // `t()` falls back to English, so a missing key is an English word inside a
        // Persian sentence rather than a visible failure.
        const missing = [...translated].filter(key => !keys.has(key)).sort();

        expect(
            missing,
            'these are passed to t() but have no Persian entry, so they render in English'
        ).toEqual([]);
    });

    it('t() is used at all, so the extractor is not vacuously passing', () => {
        expect(translated.size).toBeGreaterThan(20);
    });
});

describe('the release carries no beta labelling', () => {
    it('no panel asset mentions beta', () => {
        // The welcome dialog was labelled "RAYZEN BETA v0.1", which is the first thing a
        // new operator read on a 1.0.0 release. The identifiers around it said the same.
        const assets = ['panel/script.js', 'panel/style.css', 'panel/index.html',
            'login/index.html', 'setup/index.html', 'setup/script.js', 'setup/style.css'];

        for (const asset of assets) {
            const text = readFileSync(
                join(import.meta.dirname, '..', '..', 'src', 'assets', asset),
                'utf8'
            );
            expect(text.toLowerCase(), `${asset} mentions beta`).not.toContain('beta');
        }
    });
});
