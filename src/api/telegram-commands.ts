/**
 * Telegram commands that change settings.
 *
 * Why these are separate from the read-only commands
 *
 * `/status`, `/endpoint` and the rest report. These write, which makes them a different
 * kind of thing: they are a settings API reachable by anyone holding a chat with the bot.
 * Three properties follow from that and are enforced here rather than assumed:
 *
 *   1. **Only the configured operator.** The webhook already drops updates from any other
 *      user id, and every handler here is behind that check. It is stated again in the
 *      tests because it is the whole authorisation model.
 *   2. **Validated with the same rules as the panel.** A proxy IP added by message goes
 *      through `isValidProxyHost`, so the bot cannot write a value the panel's own form
 *      would have rejected. Otherwise Telegram becomes the way to corrupt settings.
 *   3. **Bounded.** A list has a maximum length, so a bot loop or an impatient operator
 *      cannot grow the settings document without limit. KV values have a size ceiling and
 *      an oversized document fails on write, which would break the panel rather than the
 *      bot.
 *
 * What these deliberately do not do
 *
 * No command deletes a subscription, rotates the panel path, changes the password, or
 * touches the Cloudflare credentials. A messaging app is the wrong place for an action
 * that cannot be undone from a phone, and a compromised Telegram account should not be
 * able to take a deployment away from its owner.
 */
import { getGlobals, getKvSettings } from '@settings';
import { updateDataset } from '@kv';
import { persistIdentitySettings } from '@identity';
import { isValidProxyHost } from '@validators';

/** Longest a managed list may become. */
const MAX_ENTRIES = 40;

/** Result of a command: the text to send back, and whether settings changed. */
export interface CommandResult {
    text: string;
    changed: boolean;
}

function ok(text: string): CommandResult {
    return { text, changed: false };
}

function saved(text: string): CommandResult {
    return { text, changed: true };
}

/** Renders a list for display, or says it is empty. */
function renderList(title: string, entries: readonly string[], hint: string): string {
    if (!entries.length) return `${title}\n\nNone configured.\n\n${hint}`;
    const lines = entries.map((entry, index) => `${index + 1}. <code>${escapeHtml(entry)}</code>`);
    return `${title}\n\n${lines.join('\n')}\n\n${entries.length} of ${MAX_ENTRIES} used.`;
}

/**
 * Escapes text interpolated into a Telegram HTML message.
 *
 * The values here are settings the operator supplied, so this is not guarding against a
 * hostile input so much as against a value containing `<` breaking the message and
 * causing Telegram to reject the whole send with a parse error.
 */
function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Splits `/addip 1.2.3.4, example.com` into its arguments. */
export function parseArguments(text: string): string[] {
    const spaceIndex = text.indexOf(' ');
    if (spaceIndex < 0) return [];
    return text
        .slice(spaceIndex + 1)
        .split(/[\s,]+/u)
        .map(value => value.trim())
        .filter(Boolean);
}

/** Reads one managed list from wherever it lives. */
function readList(field: ListSpec['field']): readonly string[] {
    if (field === 'proxyIPs') return getGlobals().proxyIPs ?? [];
    return getKvSettings().cleanIPs ?? [];
}

/**
 * Writes one managed list back to the store that owns it.
 *
 * The two lists live in different places, and getting this wrong is not a visible
 * failure. `proxyIPs` is part of the deployment identity (`rz:identity`); `cleanIPs` is an
 * ordinary KV setting. An earlier version of this module wrote both through
 * `updateDataset`, so `/addip` replied "Added 1 Proxy IP: 1.2.3.4" and `/listips`
 * immediately answered "None configured": the value went into the settings document,
 * where nothing reads it. Every unit test passed, because they assert what reaches the
 * write rather than what comes back from it.
 */
async function writeList(env: Env, field: ListSpec['field'], values: readonly string[]): Promise<void> {
    if (field === 'proxyIPs') {
        await persistIdentitySettings(env, { proxyIPs: [...values] });
        return;
    }
    await updateDataset(env, { ...getKvSettings(), cleanIPs: [...values] } as never);
}

interface ListSpec {
    /**
     * Settings field this command manages.
     *
     * `proxyIPs` is part of the deployment identity and is read from globals; `cleanIPs`
     * is an ordinary KV setting. Both are written through `updateDataset`, which is the
     * one path that validates and stamps a version, so a command cannot bypass either.
     */
    field: 'proxyIPs' | 'cleanIPs';
    /** Human name used in replies. */
    label: string;
    /** Validator, shared with the panel form. */
    valid: (value: string) => boolean;
    /** What a valid value looks like, for the error reply. */
    example: string;
}

const LISTS: Record<'ip' | 'domain', ListSpec> = {
    /**
     * `/addip` manages `proxyIPs`, the addresses connections are relayed through.
     */
    ip: {
        field: 'proxyIPs',
        label: 'Proxy IP',
        valid: value => isValidProxyHost(value),
        example: '1.2.3.4, 1.2.3.4:443 or proxy.example.com'
    },
    /**
     * `/adddomain` manages `cleanIPs`, which despite the name accepts domains: it is the
     * CDN address field, and a domain is the more common thing to put in it.
     */
    domain: {
        field: 'cleanIPs',
        label: 'Clean IP or domain',
        valid: value => isValidProxyHost(value, false),
        example: 'cdn.example.com or 104.16.1.1'
    }
};

/**
 * Adds entries to a managed list.
 *
 * Partial success is reported rather than rejected wholesale: `/addip a b c` where `b` is
 * malformed adds `a` and `c` and says so. Rejecting all three would make the operator
 * retype the valid ones, and silently dropping `b` would leave them believing it was
 * added.
 */
export async function addEntries(env: Env, kind: 'ip' | 'domain', args: readonly string[]): Promise<CommandResult> {
    const spec = LISTS[kind];
    if (!args.length) {
        return ok(`Usage: <code>/add${kind} ${spec.example}</code>`);
    }

    const current = [...readList(spec.field)];

    const invalid: string[] = [];
    const duplicate: string[] = [];
    const added: string[] = [];

    for (const value of args) {
        if (!spec.valid(value)) { invalid.push(value); continue; }
        // Checked against `added` as well as the stored list: `/addip 1.2.3.4 1.2.3.4`
        // otherwise stored the same address twice, which is a wasted probe on every scan
        // and a duplicate row in the panel.
        if (current.includes(value) || added.includes(value)) { duplicate.push(value); continue; }
        if (current.length + added.length >= MAX_ENTRIES) {
            invalid.push(`${value} (list full)`);
            continue;
        }
        added.push(value);
    }

    if (!added.length) {
        const reasons = [
            invalid.length ? `Rejected: ${invalid.map(escapeHtml).join(', ')}` : '',
            duplicate.length ? `Already present: ${duplicate.map(escapeHtml).join(', ')}` : ''
        ].filter(Boolean);
        return ok(`Nothing was added.\n\n${reasons.join('\n')}\n\nExpected ${spec.example}.`);
    }

    await writeList(env, spec.field, [...current, ...added]);

    const notes = [
        `Added ${added.length} ${spec.label}${added.length === 1 ? '' : 's'}: ${added.map(escapeHtml).join(', ')}`,
        invalid.length ? `Rejected: ${invalid.map(escapeHtml).join(', ')}` : '',
        duplicate.length ? `Already present: ${duplicate.map(escapeHtml).join(', ')}` : ''
    ].filter(Boolean);

    return saved(notes.join('\n'));
}

/**
 * Removes entries by value or by 1-based index.
 *
 * Index removal exists because these values are long and awkward to retype on a phone,
 * and `/listips` numbers them for exactly that reason.
 */
export async function removeEntries(env: Env, kind: 'ip' | 'domain', args: readonly string[]): Promise<CommandResult> {
    const spec = LISTS[kind];
    if (!args.length) {
        return ok(`Usage: <code>/remove${kind} &lt;value or number&gt;</code>\n\nRun /list${kind}s to see the numbers.`);
    }

    const current = [...readList(spec.field)];
    if (!current.length) return ok(`No ${spec.label} is configured.`);

    const removed: string[] = [];
    const missing: string[] = [];

    // Indices are resolved against the original list and applied together, so
    // `/removeip 1 2` does not shift the second target after removing the first.
    const byIndex = new Set<number>();
    for (const value of args) {
        if (/^\d+$/u.test(value)) {
            const index = Number(value) - 1;
            if (index >= 0 && index < current.length) byIndex.add(index);
            else missing.push(value);
            continue;
        }
        const index = current.indexOf(value);
        if (index >= 0) byIndex.add(index);
        else missing.push(value);
    }

    if (!byIndex.size) {
        return ok(`Nothing matched: ${missing.map(escapeHtml).join(', ')}\n\nRun /list${kind}s to see what is configured.`);
    }

    const next = current.filter((entry, index) => {
        if (byIndex.has(index)) { removed.push(entry); return false; }
        return true;
    });

    await writeList(env, spec.field, next);

    const notes = [
        `Removed ${removed.length}: ${removed.map(escapeHtml).join(', ')}`,
        missing.length ? `Not found: ${missing.map(escapeHtml).join(', ')}` : '',
        `${next.length} remaining.`
    ].filter(Boolean);

    return saved(notes.join('\n'));
}

/** Lists a managed list, numbered so removal by index is possible. */
export function listEntries(kind: 'ip' | 'domain'): CommandResult {
    const spec = LISTS[kind];
    const current = readList(spec.field);

    return ok(renderList(
        `<b>${spec.label}s</b>`,
        current,
        `Add one with <code>/add${kind} ${spec.example}</code>`
    ));
}

/**
 * Dispatches a settings command, or returns null when the text is not one.
 *
 * Returning null rather than an error keeps the existing switch in charge of everything
 * else, so adding a command here cannot change how an unrelated message is handled.
 */
export async function handleSettingsCommand(env: Env, text: string): Promise<CommandResult | null> {
    const command = text.trim().split(/\s+/u)[0].toLowerCase();
    const args = parseArguments(text);

    switch (command) {
        case '/addip': return addEntries(env, 'ip', args);
        case '/removeip': return removeEntries(env, 'ip', args);
        case '/listips': return listEntries('ip');
        case '/adddomain': return addEntries(env, 'domain', args);
        case '/removedomain': return removeEntries(env, 'domain', args);
        case '/listdomains': return listEntries('domain');
        default: return null;
    }
}
