const setupForm = document.getElementById('setupForm');
const setupErrorLine = document.getElementById('setupError');
const setupEmailField = document.getElementById('email');
const setupPasswordField = document.getElementById('password');
const setupDone = document.getElementById('setupDone');
const panelUrlLine = document.getElementById('panelUrl');
const openPanelLink = document.getElementById('openPanel');
const doneUserLine = document.getElementById('doneUser');

if (document.body.dataset.emailFixed === 'true') {
    setupEmailField.readOnly = true;
    setupEmailField.value = document.getElementById('fixedEmail').textContent.trim();
    document.getElementById('emailPinned').hidden = false;
}

function showSetupError(message) {
    setupErrorLine.textContent = message;
}

function parseSetupJson(responseText) {
    try {
        return JSON.parse(responseText);
    } catch {
        throw new Error('RayZen returned an invalid setup response. Reload and try again.');
    }
}

function readServerError(responseText, status) {
    const responseDocument = new DOMParser().parseFromString(responseText, 'text/html');
    const serverMessageNode = responseDocument.querySelector('#error-container b');
    const serverMessage = serverMessageNode ? serverMessageNode.textContent.trim() : '';
    return serverMessage || `Setup returned HTTP ${status}.`;
}

async function claimSetup(email, password) {
    const response = await fetch('./setup/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    const responseText = await response.text();
    const contentType = response.headers.get('Content-Type') || '';

    if (!contentType.includes('application/json')) {
        throw new Error(readServerError(responseText, response.status));
    }

    const payload = parseSetupJson(responseText);
    if (!response.ok || !payload || payload.success !== true) {
        throw new Error((payload && payload.message) || `Setup failed with HTTP ${response.status}.`);
    }

    return payload.body;
}

function renderSetupComplete(result) {
    panelUrlLine.textContent = result.panelUrl;
    openPanelLink.href = result.panelUrl;
    doneUserLine.textContent = result.username;
    setupForm.hidden = true;
    setupDone.hidden = false;
}

async function handleSetupSubmit(event) {
    event.preventDefault();
    showSetupError('');

    const password = setupPasswordField.value;
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
        showSetupError('Use at least 8 characters, with one capital letter and one digit.');
        return;
    }

    const submitButton = setupForm.querySelector('button[type=submit]');
    const submitLabel = submitButton.querySelector('span');
    submitButton.disabled = true;
    submitLabel.textContent = 'Creating…';

    try {
        const email = setupEmailField.value.trim().toLowerCase();
        const result = await claimSetup(email, password);
        renderSetupComplete(result);
    } catch (error) {
        console.error('RayZen setup failed:', error);
        showSetupError(error instanceof Error
            ? error.message
            : 'The request could not be sent. Check your connection and try again.');
    } finally {
        submitButton.disabled = false;
        submitLabel.textContent = 'Create my panel';
    }
}

setupForm.addEventListener('submit', handleSetupSubmit);

document.getElementById('togglePassword').addEventListener('click', function () {
    const show = setupPasswordField.type === 'password';
    setupPasswordField.type = show ? 'text' : 'password';
    const eye = this.querySelector('svg');
    if (eye) eye.innerHTML = show
        ? '<path d="M4 4l16 16"/><path d="M9.6 6.2A9.6 9.6 0 0 1 12 5.8c5.6 0 9.4 6.2 9.4 6.2a17 17 0 0 1-3.5 4.1M6.4 8A17 17 0 0 0 2.6 12S6.4 18.2 12 18.2a9.4 9.4 0 0 0 3.1-.5"/><path d="M10 10a3.1 3.1 0 0 0 4.2 4.2"/>'
        : '<path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/>';
    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

document.getElementById('copyUrl').addEventListener('click', async function () {
    const url = panelUrlLine.textContent;
    try {
        await navigator.clipboard.writeText(url);
        this.textContent = 'Copied';
        const button = this;
        setTimeout(() => { button.textContent = 'Copy'; }, 1800);
    } catch {
        this.textContent = 'Select it manually';
    }
});
