document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type=submit]');
    submit.disabled = true; submit.querySelector('span:first-child').textContent = 'Signing in…';
    const username = document.getElementById('username').value.trim().toLowerCase();
    const password = document.getElementById('password').value.trim();

    try {
        const response = await fetch('./login/authenticate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password
            })
        });

        const { success, status, message } = await response.json();
        if (!success) {
            const passwordError = document.getElementById('passwordError');
            passwordError.textContent = status === 409 && message
                ? message
                : 'The email or password is incorrect.';
            throw new Error(`Login failed with status ${status}: ${message}`);
        }

        window.location.href = './panel';
    } catch (error) {
        console.error('Login error:', error.message || error);
        submit.disabled = false; submit.querySelector('span:first-child').textContent = 'Continue';
    }
});

document.getElementById('togglePassword').addEventListener('click', function () {
    const input = document.getElementById('password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    // Swap the inline mark, not a font ligature: the icon must be correct on the
    // very first paint, before any webfont has resolved.
    const eye = this.querySelector('svg');
    if (eye) eye.innerHTML = show
        ? '<path d="M4 4l16 16"/><path d="M9.6 6.2A9.6 9.6 0 0 1 12 5.8c5.6 0 9.4 6.2 9.4 6.2a17 17 0 0 1-3.5 4.1M6.4 8A17 17 0 0 0 2.6 12S6.4 18.2 12 18.2a9.4 9.4 0 0 0 3.1-.5"/><path d="M10 10a3.1 3.1 0 0 0 4.2 4.2"/>'
        : '<path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.1"/>';
    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
