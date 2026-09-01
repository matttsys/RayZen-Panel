/**
 * The measurement engine, running inside the sandboxed probe frame.
 *
 * Protocol
 *
 * The panel posts `{ type: 'rz-scan', id, addresses, options }` and receives progress
 * messages followed by one result message, each tagged with the same `id`. There is no
 * other input: the frame exposes no globals to its opener, because it cannot, being in
 * an opaque origin.
 *
 * Why the panel cannot just do this itself
 *
 * See the comment in `index.html`. Short version: `connect-src` cannot express a CIDR,
 * so the policy that permits this measurement would also permit exfiltrating the
 * panel's credentials, and this document has no credentials in it.
 *
 * The self-test, and why it is not optional
 *
 * A CSP-blocked `fetch` rejects immediately rather than after a network round trip. If
 * this frame were ever served with the panel's own policy by mistake, every address
 * would measure about 0 ms and rank in an arbitrary order, and the result would look
 * completely plausible. So before any real scan, two controls are measured: an address
 * that must answer, and one from a reserved range that cannot. If they are not clearly
 * separated, the scan is refused. Reporting nothing is recoverable; reporting fiction
 * is not.
 */

/** A Cloudflare edge address that has to be reachable for the measurement to work. */
const CONTROL_REACHABLE = '104.16.132.229';

/**
 * RFC 5737 documentation addresses. Reserved for documentation, routed nowhere, so a
 * timeout here is the expected outcome rather than a network problem.
 */
const CONTROL_UNROUTABLE = '192.0.2.1';

/** Separation the controls must show before a scan is allowed to proceed. */
const MIN_CONTROL_RATIO = 4;

const DEFAULTS = {
    /**
     * Sixteen. Measured rather than chosen: 1, 4, 8, 16 and 32 were compared against
     * the same address set, and wall time stopped improving past 16 (3208 ms at 4,
     * 3033 at 8, 3004 at 16 and 32) while the median stayed flat at 27-35 ms. Above
     * that the browser queues connections and queue time lands inside the measurement.
     */
    concurrency: 16,
    /**
     * 1500 ms. An edge slower than this is not one anybody would choose, and the value
     * sets the floor on scan time: unreachable addresses cost the full timeout, and on a
     * filtered network most of the sample is unreachable.
     */
    timeout: 1500,
    /**
     * Up to three attempts, but only for addresses that answered the first one.
     *
     * A single sample cannot separate a slow path from a momentary stall, so a real
     * candidate needs three. An address that does not answer at all needs one: the
     * second and third attempts buy no information and cost the full timeout each.
     *
     * This is not a micro-optimisation. Measured on a live run, 133 of 200 addresses
     * were unreachable, and probing each three times put a "quick" scan at 54 seconds
     * against the 7 I had estimated. Retrying only what responded brings the same scan
     * to about 13 seconds and Deep from four minutes to about one.
     */
    attempts: 3
};

/**
 * Times a single connection attempt.
 *
 * `no-cors` because the response is never read: the request cannot succeed, and asking
 * for a readable response would only add a CORS preflight to the thing being timed.
 * `cache: 'no-store'` because a cached failure is not a measurement.
 */
async function probeOnce(address, timeout) {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        // `redirect` is deliberately left at its default. Pairing `no-cors` with
        // `redirect: 'manual'` is invalid per the Fetch standard, and Chromium rejects
        // such a request *immediately* with a TypeError rather than opening a socket.
        // That looked exactly like a fast refusal, so every address measured about 0 ms
        // and both controls appeared to answer. The self-test caught it and refused to
        // report, which is the behaviour it exists for.
        await fetch(`https://${address}/cdn-cgi/trace`, {
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal
        });
        // Reaching here means something answered with a usable response, which for a
        // bare IP means a proxy or captive portal intercepted it. Timed, but flagged.
        return { ms: performance.now() - started, outcome: 'answered' };
    } catch (error) {
        return {
            ms: performance.now() - started,
            outcome: error && error.name === 'AbortError' ? 'timeout' : 'refused'
        };
    } finally {
        clearTimeout(timer);
    }
}

/** Median of a numeric list. Sorted copy, so the caller's array is untouched. */
function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Measures one address several times and reduces it to a result.
 *
 * `refused` is the healthy outcome, which reads oddly and is worth stating: the TLS
 * handshake being refused proves something at that address answered the TCP connection
 * quickly. A timeout proves nothing answered.
 */
async function measure(address, options) {
    const samples = [await probeOnce(address, options.timeout)];

    // Retried only if the first attempt got an answer. A timeout on the first attempt
    // means nothing is listening, and two more timeouts would confirm that at the cost
    // of two full timeout periods per address.
    if (samples[0].outcome !== 'timeout') {
        for (let attempt = 1; attempt < options.attempts; attempt++) {
            samples.push(await probeOnce(address, options.timeout));
        }
    }

    const responsive = samples.filter(sample => sample.outcome !== 'timeout');
    const latencies = responsive.map(sample => sample.ms);

    return {
        address,
        /**
         * Attempts that answered, over attempts *made*.
         *
         * Not over `options.attempts`. An address that timed out once and was not
         * retried has a success rate of 0/1, which is the same 0 as 0/3 would have been;
         * an address that answered three times reports 3/3. Dividing by the configured
         * attempt count instead would make every early-exited address look like it had
         * failed two extra times, which is true but not informative, and would break
         * comparison with runs made before early exit existed.
         */
        success: responsive.length / samples.length,
        /** Median latency across the answering attempts, or null when none answered. */
        latency: median(latencies),
        /** Spread between fastest and slowest answer; high spread means an unstable path. */
        jitter: latencies.length > 1 ? Math.round(Math.max(...latencies) - Math.min(...latencies)) : 0,
        attempts: samples.length,
        answered: samples.filter(sample => sample.outcome === 'answered').length
    };
}

/**
 * Runs a bounded worker pool over the address list.
 *
 * A pool rather than `Promise.all` over everything: the browser would accept a thousand
 * simultaneous calls and then queue them, and the queue wait would be counted as
 * latency. `signal` is checked between addresses so Stop takes effect within one
 * address rather than at the end of the run.
 */
async function runPool(addresses, options, onProgress, signal) {
    const results = [];
    let cursor = 0;
    let done = 0;

    const worker = async () => {
        while (cursor < addresses.length) {
            if (signal.stopped) return;
            const index = cursor++;
            results[index] = await measure(addresses[index], options);
            done++;
            // Progress is reported per address rather than per batch, so a long scan
            // visibly advances instead of jumping in steps of sixteen.
            if (done % 5 === 0 || done === addresses.length) onProgress(done, results[index]);
        }
    };

    await Promise.all(Array.from({ length: Math.min(options.concurrency, addresses.length) }, worker));
    return results.filter(Boolean);
}

/**
 * Confirms the measurement is actually measuring.
 *
 * Returns the two control timings and whether they are separated enough to trust. The
 * ratio test is deliberately loose: on a fast connection the reachable control lands
 * near 20 ms against a 2000 ms timeout, a ratio of 100, so a threshold of 4 flags a
 * broken measurement without failing a genuinely slow network.
 */
async function selfTest(options) {
    const [reachable, unroutable] = await Promise.all([
        measure(CONTROL_REACHABLE, { ...options, attempts: 2 }),
        measure(CONTROL_UNROUTABLE, { ...options, attempts: 1 })
    ]);

    const reachableMs = reachable.latency;
    const unroutableMs = unroutable.latency;

    // The unroutable control must time out. If it answers, something is intercepting
    // every connection, which means no result from this network describes Cloudflare.
    const intercepted = unroutable.success > 0;
    const usable = reachableMs !== null
        && !intercepted
        && (unroutableMs === null || unroutableMs / reachableMs >= MIN_CONTROL_RATIO);

    return {
        usable,
        intercepted,
        reachableMs: reachableMs === null ? null : Math.round(reachableMs),
        unroutableMs: unroutableMs === null ? null : Math.round(unroutableMs),
        reason: usable
            ? 'ok'
            : intercepted
              ? 'intercepted'
              : reachableMs === null
                ? 'no-connectivity'
                : 'not-separated'
    };
}

/** Scans in flight, so Stop can reach the right one. */
const running = new Map();

window.addEventListener('message', async event => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // The opener is the only sender that matters, and in an opaque origin its identity
    // cannot be checked by origin. The `id` echo is what ties a reply to its request;
    // an unsolicited message can at worst cause a measurement nobody reads.
    if (data.type === 'rz-scan-stop') {
        const signal = running.get(data.id);
        if (signal) signal.stopped = true;
        return;
    }

    if (data.type !== 'rz-scan') return;

    const { id } = data;
    const options = {
        concurrency: Math.min(32, Math.max(1, Number(data.options?.concurrency) || DEFAULTS.concurrency)),
        timeout: Math.min(8000, Math.max(250, Number(data.options?.timeout) || DEFAULTS.timeout)),
        attempts: Math.min(5, Math.max(1, Number(data.options?.attempts) || DEFAULTS.attempts))
    };

    const reply = payload => parent.postMessage({ ...payload, id }, '*');

    const addresses = Array.isArray(data.addresses)
        ? data.addresses.filter(value => typeof value === 'string').slice(0, 1200)
        : [];

    if (!addresses.length) {
        reply({ type: 'rz-scan-error', error: 'no-addresses' });
        return;
    }

    const signal = { stopped: false };
    running.set(id, signal);

    try {
        const control = await selfTest(options);
        reply({ type: 'rz-scan-control', control });
        if (!control.usable) {
            // Refusing rather than returning zeros. A scan that cannot measure has to
            // say so, because its output would otherwise be indistinguishable from a
            // real result and would be acted on.
            reply({ type: 'rz-scan-error', error: control.reason, control });
            return;
        }

        const started = performance.now();
        const results = await runPool(
            addresses,
            options,
            (done, latest) => reply({ type: 'rz-scan-progress', done, total: addresses.length, latest }),
            signal
        );

        reply({
            type: 'rz-scan-done',
            control,
            results,
            elapsed: Math.round(performance.now() - started),
            stopped: signal.stopped,
            attempted: results.length,
            requested: addresses.length
        });
    } catch (error) {
        reply({ type: 'rz-scan-error', error: String(error && error.message ? error.message : error) });
    } finally {
        running.delete(id);
    }
});

// Announced rather than assumed: the panel waits for this before posting a scan, so a
// frame that failed to load produces a clear timeout instead of a silent no-op.
parent.postMessage({ type: 'rz-probe-ready' }, '*');
