loadGeoData();

async function loadGeoData() {
    const tableBody = document.querySelector("#geo-table tbody");

    try {
        const res = await fetch("./proxy-ip/get");
        const { success, body, message } = await res.json();

        if (!success) {
            throw new Error(`Fetching Proxy IPs failed at ${res.url} - ${message}`);
        }

        if (!body.length) {
            const cell = elm('td', {
                textContent: 'Failed to get Proxy IPs',
                colSpan: '5'
            });
            const row = elm('tr', {}, [cell]);

            tableBody.innerHTML = '';
            tableBody.appendChild(row);
            return;
        }

        tableBody.innerHTML = '';

        body.forEach((item, index) => {
            const indexCell = elm('td', { textContent: String(index + 1) });

            const copyIcon = createIcon('content_copy', 'Copy to clipboard');
            const ipText = document.createTextNode(` ${item.ip || '-'}`);
            const testIcon = createIcon('flash_on', 'Test IP');
            const ipCell = elm('td', {}, [copyIcon, ipText, testIcon]);

            const healthRateCell = elm('td', { textContent: '-' });
            const avgLatencyCell = elm('td', { textContent: '-' });
            const flag = item.countryCode
                ? String.fromCodePoint(...[...item.countryCode].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
                : '';

            const countryCell = elm('td', { textContent: `${flag} ${item.country || '-'}` });
            const cityCell = elm('td', { textContent: item.city || '-' });
            const ispCell = elm('td', { textContent: item.isp || '-' });

            copyIcon.addEventListener('click', () => copyToClipboard(item.ip));
            testIcon.addEventListener('click', () => testIp(item.ip, healthRateCell, avgLatencyCell));
            const row = elm('tr', {}, [indexCell, ipCell, healthRateCell, avgLatencyCell, countryCell, cityCell, ispCell]);
            tableBody.appendChild(row);
        });

    } catch (err) {
        const cell = elm('td', { colSpan: '5', textContent: `Error: ${err.message}` });
        const row = elm('tr', {}, [cell]);
        tableBody.innerHTML = '';
        tableBody.appendChild(row);
        console.error(err);
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => alert('✅ Copied to clipboard:\n\n' + text))
        .catch(error => console.error('Failed to copy:', error));
}

function testIp(ip, healthyCell, avgLatencyCell) {
    document.body.classList.add('is-loading');
    fetch(`./proxy-ip/test?target=${ip}`)
        .then(res => res.json())
        .then(({ success, status, message, body }) => {
            if (!success) {
                throw new Error(`Failed with status ${status} - ${message}`);
            }

            const { successRate, avgLatencyMs } = body;
            healthyCell.textContent = successRate;
            avgLatencyCell.textContent = avgLatencyMs;
            document.body.classList.remove('is-loading');
        })
        .catch((error) => console.error(`Failed to test IP: ${error}`));
}

function elm(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...[].concat(children));
    return node;
}

/**
 * Icon outlines, extracted from the Material Symbols subset this page used to embed.
 *
 * Two glyphs, 384 B of page gzip against the font's 1,542 B. Same reasoning as the
 * panel: the ligature *was* the element's text, so a name missing from the subset
 * rendered as the literal word `content_copy` and nothing in the build could see it.
 */
const ICON_PATHS = {
    content_copy: 'M36 60Q33 60 30 58Q28 55 28 52V4Q28 1 30 -2Q33 -4 36 -4H72Q75 -4 78 -2Q80 1 80 4V52Q80 55 78 58Q75 60 72 60ZM36 52H72Q72 52 72 52Q72 52 72 52V4Q72 4 72 4Q72 4 72 4H36Q36 4 36 4Q36 4 36 4V52Q36 52 36 52Q36 52 36 52ZM20 76Q17 76 14 74Q12 71 12 68V16Q12 14 13 13Q14 12 16 12Q18 12 19 13Q20 14 20 16V68Q20 68 20 68Q20 68 20 68H60Q62 68 63 69Q64 70 64 72Q64 74 63 75Q62 76 60 76ZM36 52Q36 52 36 52Q36 52 36 52V4Q36 4 36 4Q36 4 36 4Q36 4 36 4Q36 4 36 4V52Q36 52 36 52Q36 52 36 52Z',
    flash_on: 'M48 50 61 32Q61 32 61 32Q61 32 61 32H49L57 4Q57 4 57 4Q57 4 57 4H36Q36 4 36 4Q36 4 36 4V36Q36 36 36 36Q36 36 36 36H48ZM70 33 46 68Q45 69 44 69Q43 70 42 69Q41 69 41 68Q40 68 40 66V44H36Q33 44 30 42Q28 39 28 36V4Q28 1 30 -2Q33 -4 36 -4H59Q63 -4 65 -2Q66 1 66 4L60 24H64Q68 24 70 27Q72 30 70 33ZM48 36H36Q36 36 36 36Q36 36 36 36Q36 36 36 36Q36 36 36 36H48Q48 36 48 36Q48 36 48 36Q48 36 48 36Q48 36 48 36Z'
};

const createIcon = (text, title) => elm('span', {
    className: 'rz-icon',
    innerHTML: `<svg viewBox="0 0 96 96" fill="currentColor" aria-hidden="true" focusable="false">${ICON_PATHS[text] ?? ''}</svg>`,
    title
});