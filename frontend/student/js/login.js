// frontend/student/js/login.js
/**
 * Reads #student-id and #password, posts { student_id, password } to
 * /auth/student/login.
 *
 * Single-device login: the backend returns 409 when this account already
 * has an open web session on another device (AuthController::studentLogin
 * + LoginLog::activeWebLogin). We prompt the student, and if they
 * confirm, retry with force_login: true which closes the previous
 * device's session on the server side.
 *
 * Redirect-loop guard mirrors the admin login page.
 */

document.addEventListener('DOMContentLoaded', () => {
    /* ------------------------------------------------------------
     * Redirect-loop guard
     * ------------------------------------------------------------ */
    if (sessionManager.isAuthenticated()) {
        const alreadyBounced = sessionStorage.getItem('student_login_bounce_attempted');
        if (!alreadyBounced) {
            sessionStorage.setItem('student_login_bounce_attempted', '1');
            sessionManager.redirectToDashboard();
            return;
        }
        console.warn('[login] Redirect loop detected — clearing stale session.');
        sessionStorage.removeItem('student_login_bounce_attempted');
        if (typeof api !== 'undefined' && typeof api.clearAuth === 'function') {
            api.clearAuth();
        }
    } else {
        sessionStorage.removeItem('student_login_bounce_attempted');
    }

    /* ------------------------------------------------------------
     * DOM presence check
     * ------------------------------------------------------------ */
    const studentIdEl = byId('student-id');
    const passwordEl  = byId('password');
    const formEl      = byId('login-form');

    if (!formEl || !studentIdEl || !passwordEl) {
        console.error(
            '[login] Required elements are missing from the DOM. ' +
            'Expected #login-form, #student-id, #password. ' +
            'Found: form=' + !!formEl +
            ', student-id=' + !!studentIdEl +
            ', password=' + !!passwordEl
        );
        return;
    }

    onClick('toggle-password', () => {
        passwordEl.type = passwordEl.type === 'password' ? 'text' : 'password';
    });

    function clearErrors() {
        setText('error-student-id', '');
        setText('error-password', '');
        toggleClass('login-alert', 'show', false);
    }

    function showAlert(message) {
        setText('login-alert-message', message);
        toggleClass('login-alert', 'show', true);
    }

    function shakeBook() {
        const book = byId('book');
        if (!book) return;
        book.classList.remove('shake');
        void book.offsetWidth;
        book.classList.add('shake');
    }

    /* ------------------------------------------------------------
     * Field validation
     *
     * FIX: the previous regex was /^[A-Za-z0-9-]{4,20}$/. The backend
     * StudentController::create accepts 3–30 chars
     * (/^[A-Za-z0-9\-]{3,30}$/), and AuthController::studentLogin
     * accepts up to 100 chars. Anything in the 21–30 char range, or
     * exactly 3 chars, was rejected client-side before the request
     * was ever sent. Now aligned with the create-time constraint.
     *
     * Password: the backend only verifies against the stored hash on
     * login, so the client checks for a non-trivial value (>= 4) and
     * lets the server decide the rest.
     * ------------------------------------------------------------ */
    const STUDENT_ID_RE = /^[A-Za-z0-9-]{3,30}$/;
    const MIN_PASSWORD_LENGTH = 4;

    function validateLoginInput(studentId, password) {
        const errors = { studentId: '', password: '' };

        if (!studentId) {
            errors.studentId = 'Enter your Student ID.';
        } else if (!STUDENT_ID_RE.test(studentId)) {
            errors.studentId = 'Student ID must be 3–30 characters (letters, digits, hyphens).';
        }

        if (!password) {
            errors.password = 'Enter your password.';
        } else if (password.length < MIN_PASSWORD_LENGTH) {
            errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        }

        return errors;
    }

    /**
     * Attempts login. If the backend returns 409 and we haven't already
     * tried with force_login, prompts the student and retries. The `force`
     * flag guards against infinite retry if the backend ever returns 409
     * on a force request too.
     *
     * Returns true on success (caller should redirect), false otherwise.
     */
    async function attemptLogin(studentId, password, force) {
        try {
            const result = await api.studentLogin(studentId, password, { forceLogin: force });

            if (!result.success) {
                showAlert(result.message || 'Incorrect Student ID or password.');
                shakeBook();
                return false;
            }

            if (result.data && result.data.must_change_password) {
                sessionStorage.setItem('force_password_change', '1');
            }
            return true;

        } catch (err) {
            // 409 = already logged in on another device.
            if (err.status === 409 && !force) {
                const confirmed = window.confirm(
                    'Your account is already logged in on another device.\n\n' +
                    'Sign that device out and log in here instead?'
                );

                if (!confirmed) {
                    showAlert('Log in cancelled. Log out on the other device first, then try again.');
                    return false;
                }

                return await attemptLogin(studentId, password, true);
            }

            showAlert(err.message || 'Connection error. Please try again.');
            shakeBook();
            return false;
        }
    }

    on('login-form', 'submit', async (e) => {
        e.preventDefault();
        clearErrors();

        const studentId = (studentIdEl.value || '').trim();
        const password  = passwordEl.value || '';

        const errors = validateLoginInput(studentId, password);
        if (errors.studentId || errors.password) {
            if (errors.studentId) setText('error-student-id', errors.studentId);
            if (errors.password) setText('error-password', errors.password);
            shakeBook();
            (errors.studentId ? studentIdEl : passwordEl).focus();
            return;
        }

        const submitBtn = byId('login-submit');
        const spinner   = byId('login-spinner');
        const label     = byId('login-submit-label');

        if (submitBtn) submitBtn.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';
        if (label) label.textContent = 'Signing in…';

        try {
            const ok = await attemptLogin(studentId, password, false);
            if (ok) {
                window.location.href = 'dashboard.html';
            }
        } finally {
            if (submitBtn) submitBtn.disabled = false;
            if (spinner) spinner.style.display = 'none';
            if (label) label.textContent = 'Sign In';
        }
    });
});