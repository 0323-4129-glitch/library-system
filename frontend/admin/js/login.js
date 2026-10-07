// frontend/admin/js/login.js
document.addEventListener('DOMContentLoaded', function() {
    const loginBtn = document.getElementById('loginBtn');
    const emailInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessage = document.getElementById('errorMessage');
    const rememberCheckbox = document.getElementById('remember');

    // Loop guard
    if (sessionManager.isAuthenticated()) {
        const alreadyBounced = sessionStorage.getItem('login_bounce_attempted');
        if (!alreadyBounced) {
            sessionStorage.setItem('login_bounce_attempted', '1');
            sessionManager.redirectToDashboard();
            return;
        } else {
            console.warn('Redirect loop detected on login page — clearing stale session.');
            sessionStorage.removeItem('login_bounce_attempted');
            api.clearAuth();
        }
    } else {
        sessionStorage.removeItem('login_bounce_attempted');
    }

    // Remember username/email
    const remembered = localStorage.getItem('admin_remembered_email');
    if (remembered) {
        emailInput.value = remembered;
        if (rememberCheckbox) rememberCheckbox.checked = true;
    }

    function validateIdentifier(value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(value)) return true;
        const employeeIdRegex = /^[A-Za-z0-9-]+$/;
        if (employeeIdRegex.test(value)) return true;
        return false;
    }

    function showError(message) {
        errorMessage.className = 'form-error show';
        errorMessage.style.display = 'block';
        errorMessage.textContent = message;
        errorMessage.style.color = '#c62828';
        errorMessage.style.background = 'rgba(204, 0, 0, 0.08)';
        errorMessage.style.border = '1px solid #c62828';
        errorMessage.style.borderRadius = '4px';
        errorMessage.style.padding = '12px 16px';
    }

    function showSuccess(message) {
        errorMessage.className = 'form-error show';
        errorMessage.style.display = 'block';
        errorMessage.textContent = message;
        errorMessage.style.color = '#2e7d32';
        errorMessage.style.background = 'rgba(46, 125, 50, 0.08)';
        errorMessage.style.border = '1px solid #2e7d32';
        errorMessage.style.borderRadius = '4px';
        errorMessage.style.padding = '12px 16px';
    }

    function hideError() {
        errorMessage.classList.remove('show');
        errorMessage.style.display = 'none';
    }

    function shakeBook() {
        const book = document.querySelector('.book');
        if (book) {
            book.style.animation = 'shake 0.5s ease';
            setTimeout(() => { book.style.animation = ''; }, 500);
        }
    }

    /**
     * FIX: single-device login for admins.
     *
     * Extracted from handleLogin() so the 409 retry path can call it again
     * with force=true. The backend now returns 409 when this admin account
     * already has an open web session on another device (see
     * AuthController::adminLogin + LoginLog::activeWebLogin). We prompt the
     * admin, and if they confirm, retry with force_login: true which closes
     * the previous device's session on the server side.
     *
     * The `force` flag guards against an infinite retry loop if the backend
     * ever returns 409 on a force request too.
     */
    async function attemptLogin(identifier, password, force) {
        try {
            const data = await api.adminLogin(identifier, password, { forceLogin: force });

            if (data.success && data.data && data.data.token) {
                if (rememberCheckbox && rememberCheckbox.checked) {
                    localStorage.setItem('admin_remembered_email', identifier);
                } else {
                    localStorage.removeItem('admin_remembered_email');
                }

                // api.adminLogin() already called setAuth() internally, so
                // sessionManager.token / .user are already live — no need to
                // assign them again here (those assignments were redundant).

                showSuccess('Welcome back, Admin! Redirecting...');

                setTimeout(() => {
                    window.location.href = sessionManager.getDashboardPath(api.user.role);
                }, 1500);
                return;
            }

            // Reached only if the API returns success:false without throwing
            // (shouldn't happen for login, but keeps the fallback honest).
            showError('❌ ' + (data.message || 'Invalid credentials. Please try again.'));
            passwordInput.value = '';
            passwordInput.focus();
            passwordInput.classList.add('is-invalid');
            shakeBook();

        } catch (error) {
            // FIX: 409 = already logged in on another device. Prompt for
            // takeover, and retry with force_login: true if the admin agrees.
            if (error.status === 409 && !force) {
                const confirmed = window.confirm(
                    'This admin account is already logged in on another device.\n\n' +
                    'Sign that device out and log in here instead?'
                );

                if (!confirmed) {
                    showError('Log in cancelled. Log out on the other device first, then try again.');
                    return;
                }

                await attemptLogin(identifier, password, true);
                return;
            }

            console.error('Login error:', error);
            showError('❌ ' + (error.message || 'Connection error. Please try again.'));
            passwordInput.value = '';
            passwordInput.focus();
        }
    }

    async function handleLogin() {
        hideError();
        emailInput.classList.remove('is-invalid');
        passwordInput.classList.remove('is-invalid');

        const identifier = emailInput.value.trim();
        const password = passwordInput.value;

        if (!identifier || !password) {
            showError('Please enter both Employee ID/Email and password.');
            if (!identifier) emailInput.classList.add('is-invalid');
            if (!password) passwordInput.classList.add('is-invalid');
            return;
        }

        if (!validateIdentifier(identifier)) {
            showError('Please enter a valid email address or Employee ID (e.g., admin@rmmc.edu.ph or EMP-001).');
            emailInput.classList.add('is-invalid');
            return;
        }

        loginBtn.classList.add('loading');
        loginBtn.disabled = true;

        try {
            await attemptLogin(identifier, password, false);
        } finally {
            loginBtn.classList.remove('loading');
            loginBtn.disabled = false;
        }
    }

    loginBtn.addEventListener('click', handleLogin);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (document.activeElement === emailInput || document.activeElement === passwordInput) {
                e.preventDefault();
                handleLogin();
            }
        }
    });

    emailInput.addEventListener('input', function() {
        this.classList.remove('is-invalid');
        hideError();
    });

    passwordInput.addEventListener('input', function() {
        this.classList.remove('is-invalid');
        hideError();
    });
});