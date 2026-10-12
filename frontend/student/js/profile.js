// frontend/student/js/profile.js
const REQUEST_TYPES = ['Student ID', 'Course', 'Year Level'];

let currentProfile = null;
let originalContactData = { email: '', contact_number: '' };
let cameraStream = null;

// Cached course list from GET /students/courses. `null` means
// "not loaded yet"; an empty array means "loaded, none exist".
let cachedCourses = null;
let coursesLoadFailed = false;

/* ============================================================
 * HELPERS
 * ============================================================ */
function resolvePhotoUrl(photoUrl) {
    if (!photoUrl) return null;
    if (/^(https?:)?\/\//i.test(photoUrl)) return photoUrl;
    const backendRoot = API_CONFIG.baseURL.replace(/\/api\/index\.php.*$/i, '');
    const cleanPath = String(photoUrl).replace(/^\/+/, '');
    return `${backendRoot}/${cleanPath}`;
}

function createAvatarHtml(photoUrl, initials) {
    if (!photoUrl) return `<div class="avatar-fallback">${initials}</div>`;
    const resolved = resolvePhotoUrl(photoUrl);
    if (!resolved) return `<div class="avatar-fallback">${initials}</div>`;
    return `<img src="${resolved}" class="avatar-img" onerror="this.outerHTML='<div class=\\'avatar-fallback\\'>${initials}</div>';">`;
}

function fullNameOf(p) {
    return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');
}

function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '';
}

function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/** Normalize "1", "2", "1st Year", "1st year", etc. to "1st Year". */
function normalizeYearLevel(value) {
    if (value === null || value === undefined || value === '') return '';
    const raw = String(value).trim();
    if (/year/i.test(raw)) return raw;
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n <= 5) {
        return ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'][n - 1];
    }
    return raw;
}

function getCurrentCourse() {
    return (currentProfile && currentProfile.course) ? String(currentProfile.course) : '';
}

function getCurrentYear() {
    return currentProfile ? normalizeYearLevel(currentProfile.year_level) : '';
}

function getCurrentStudentId() {
    return (currentProfile && currentProfile.student_id) ? String(currentProfile.student_id) : '';
}

function closeAllDropdowns() {
    const pd = document.getElementById('profileDropdown');
    const ad = document.getElementById('avatarDropdown');
    if (pd) pd.style.display = 'none';
    if (ad) ad.style.display = 'none';
}

function openModal(id) {
    closeAllDropdowns();
    const modal = document.getElementById(id);
    if (!modal) {
        console.error('[profile] Modal not found in DOM:', id);
        return;
    }
    modal.classList.add('show');
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) backdrop.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('show');
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) backdrop.classList.remove('show');
    document.body.style.overflow = '';
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach((m) => {
        m.classList.remove('show');
        const bd = m.querySelector('.modal-backdrop');
        if (bd) bd.classList.remove('show');
    });
    document.body.style.overflow = '';
}

/* ============================================================
 * RENDER
 * ============================================================ */
function paintChrome(user) {
    const name = fullNameOf(user) || sessionManager.getUserName() || 'Student';
    const initial = sessionManager.getUserInitial();

    refreshChrome();

    setText('profileFullName', name);
    setText('profileStudentIdTag', user.student_id || '–');

    const avatarEl = document.getElementById('profileAvatar');
    if (avatarEl) {
        const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '') || initial;
        avatarEl.innerHTML = createAvatarHtml(user.photo_url, initials);
    }
}

function paintCards(profile) {
    setText('profileEmail', profile.email || '—');
    setText('profileStudentIdDisplay', profile.student_id || '—');
    setText('profileCourseDisplay', profile.course || '—');
    setText('profileYearLevelDisplay', normalizeYearLevel(profile.year_level) || '—');
    setText('profileCreatedAt', formatDate(profile.created_at));

    const badge = document.getElementById('profileStatus');
    if (badge) {
        if (profile.status === 'Active') {
            badge.className = 'badge badge-success';
            badge.textContent = 'Active';
        } else {
            badge.className = 'badge badge-danger';
            badge.textContent = 'Inactive';
        }
    }

    const reminder = document.getElementById('password-reminder');
    if (reminder) reminder.hidden = !Number(profile.must_change_password);
}

/* ============================================================
 * LOAD
 * ============================================================ */
async function loadProfile() {
    try {
        const res = await api.getProfile();
        if (!res.success || !res.data) throw new Error(res.message || 'Failed to load profile');

        currentProfile = res.data;
        originalContactData = {
            email: res.data.email || '',
            contact_number: res.data.contact_number || ''
        };

        const merged = { ...(sessionManager.getUser() || {}), ...res.data };
        sessionManager.api.setAuth(sessionManager.token, merged);

        paintChrome(merged);
        paintCards(res.data);

        setValue('editEmail', res.data.email || '');
        setValue('editContactNumber', res.data.contact_number || '');
    } catch (err) {
        console.error('Load profile failed:', err);
        showToast('error', 'Could not load profile', err.message);
    }
}

async function loadSidebarHours() {
    try {
        const res = await api.getDashboard();
        if (res.success && res.data && res.data.student) {
            paintSidebarHours(res.data.student.used_hours, res.data.student.remaining_hours);
        }
    } catch (err) {
        console.warn('[profile] Could not load semester hours:', err);
    }
}

async function loadPendingRequest() {
    const user = sessionManager.getUser();
    const id = user && (user.id || user.sub);
    if (!id) return;

    try {
        const res = await api.getUpdateRequestsForStudent(id);
        if (!res.success || !Array.isArray(res.data)) return;

        const pending = res.data.find((r) => r.status === 'Pending');
        const banner = document.getElementById('pending-request-banner');
        const form = document.getElementById('update-request-form');
        const submitBtn = document.getElementById('request-submit');
        const tag = document.getElementById('requestPendingTag');

        if (pending) {
            setText('pending-request-detail',
                `${pending.request_type} → "${pending.new_value}" — submitted ${formatDate(pending.created_at)}`);
            if (banner) banner.hidden = false;
            if (form) form.style.display = 'none';
            if (submitBtn) submitBtn.style.display = 'none';
            if (tag) tag.hidden = false;
        } else {
            if (banner) banner.hidden = true;
            if (form) form.style.display = '';
            if (submitBtn) submitBtn.style.display = '';
            if (tag) tag.hidden = true;
        }
    } catch (err) {
        console.warn('Pending request lookup failed:', err);
    }
}

/* ============================================================
 * PHOTO — VIEW / CHOOSE / CAPTURE / UPLOAD
 * ============================================================ */
function viewProfilePicture() {
    closeAllDropdowns();
    const user = sessionManager.getUser() || {};
    const img = document.getElementById('profilePictureDisplay');
    const fallback = document.getElementById('profileInitialDisplay');
    const initials = sessionManager.getUserInitial();

    const resolved = resolvePhotoUrl(user.photo_url);
    if (resolved && img && fallback) {
        img.src = resolved;
        img.onerror = () => {
            img.style.display = 'none';
            fallback.style.display = 'flex';
            fallback.textContent = initials;
        };
        img.style.display = 'block';
        fallback.style.display = 'none';
    } else if (img && fallback) {
        img.style.display = 'none';
        fallback.style.display = 'flex';
        fallback.textContent = initials;
    }

    openModal('viewProfilePictureModal');
}

function openPhotoChoiceModal() {
    closeAllDropdowns();
    openModal('photoChoiceModal');
}

function closeAvatarDropdown() {
    const el = document.getElementById('avatarDropdown');
    if (el) el.style.display = 'none';
}

function toggleProfileDropdown(e) {
    e.stopPropagation();
    const el = document.getElementById('profileDropdown');
    if (!el) return;
    const isOpen = el.style.display === 'block';
    closeAllDropdowns();
    el.style.display = isOpen ? 'none' : 'block';
}

function toggleAvatarDropdown(e) {
    e.stopPropagation();
    const el = document.getElementById('avatarDropdown');
    if (!el) return;
    const isOpen = el.style.display === 'block';
    closeAllDropdowns();
    el.style.display = isOpen ? 'none' : 'block';
}

async function triggerCameraCapture() {
    closeModal('photoChoiceModal');
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' }, audio: false
        });
        const video = document.getElementById('cameraPreview');
        if (!video) throw new Error('Missing video element');
        video.srcObject = cameraStream;
        openModal('cameraCaptureModal');
    } catch (err) {
        console.warn('Camera unavailable, falling back to file input:', err);
        const inp = document.getElementById('profilePhotoCameraInput');
        if (inp) inp.click();
        else document.getElementById('profilePhotoInput').click();
    }
}

function triggerFileUpload() {
    closeModal('photoChoiceModal');
    document.getElementById('profilePhotoInput').click();
}

function capturePhoto() {
    const video = document.getElementById('cameraPreview');
    if (!video || !cameraStream) {
        showToast('warning', 'Camera not ready', 'Please wait a moment and try again.');
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], 'camera_capture.jpg', { type: 'image/jpeg' });
        await uploadProfilePicture(file);
        closeModal('cameraCaptureModal');
        stopCameraStream();
    }, 'image/jpeg');
}

function stopCameraStream() {
    if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
        cameraStream = null;
    }
}

async function uploadProfilePicture(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('photo', file);

    try {
        const res = await api.uploadProfilePhoto(formData);
        if (res.success && res.data) {
            const user = sessionManager.getUser() || {};
            user.photo_url = res.data.photo_url;
            sessionManager.api.setAuth(sessionManager.token, user);
            paintChrome(user);
            showToast('success', 'Photo updated', 'Your profile picture has been saved.');
        } else {
            showToast('error', 'Could not upload', res.message || 'Please try again.');
        }
    } catch (err) {
        showToast('error', 'Could not upload', err.message || 'Please try again.');
    }
}

/* ============================================================
 * EDIT CONTACT INFO
 * ============================================================ */
function openEditProfileModal() {
    closeAllDropdowns();
    setValue('editEmail', originalContactData.email);
    setValue('editContactNumber', originalContactData.contact_number);
    setText('error-email', '');
    setText('error-contact-number', '');
    openModal('editProfileModal');
}

async function submitProfileForm(form) {
    setText('error-email', '');
    setText('error-contact-number', '');

    const email = (document.getElementById('editEmail')?.value || '').trim();
    const contact_number = (document.getElementById('editContactNumber')?.value || '').trim();

    if (!email) {
        setText('error-email', 'Email is required.');
        return;
    }
    if (!validator.validateEmail(email)) {
        setText('error-email', 'Enter a valid email address.');
        return;
    }
    if (contact_number && !validator.validatePhone(contact_number)) {
        setText('error-contact-number', 'Enter a valid contact number (7–20 digits, may include + - ( ) spaces).');
        return;
    }
    if (email === originalContactData.email && contact_number === originalContactData.contact_number) {
        showToast('warning', 'No changes', 'Nothing to save.');
        return;
    }

    const btn = document.getElementById('profile-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        const res = await api.updateProfile({ email, contact_number });
        if (res.success) {
            showToast('success', 'Saved', 'Contact information updated.');
            closeModal('editProfileModal');
            await loadProfile();
        } else {
            showToast('error', 'Could not save', res.message || 'Please try again.');
        }
    } catch (err) {
        showToast('error', 'Could not save', err.message || 'Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
}

/* ============================================================
 * CHANGE PASSWORD
 * ============================================================ */
function openChangePasswordModal() {
    closeAllDropdowns();
    const form = document.getElementById('changePasswordForm');
    if (form) form.reset();
    ['error-current-password', 'error-new-password', 'error-confirm-password'].forEach((id) => setText(id, ''));
    openModal('changePasswordModal');
}

function validateNewPassword(next, current) {
    if (!next) return 'Enter a new password.';
    if (next.length < 8) return 'Password must be at least 8 characters.';
    if (next.length > 200) return 'Password is too long (max 200 characters).';
    if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
        return 'Password must include at least one letter and one digit.';
    }
    const BLOCKLIST = ['password', '12345678', 'qwerty123', 'admin123', 'letmein123', 'password1'];
    if (BLOCKLIST.includes(next.toLowerCase())) {
        return 'That password is too common. Please choose another.';
    }
    if (current && next === current) {
        return 'New password must be different from your current password.';
    }
    return '';
}

async function submitPasswordForm(form) {
    ['error-current-password', 'error-new-password', 'error-confirm-password'].forEach((id) => setText(id, ''));

    const current = document.getElementById('currentPassword').value;
    const next = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;

    let hasError = false;

    if (!current) {
        setText('error-current-password', 'Enter your current password.');
        hasError = true;
    }

    const nextErr = validateNewPassword(next, current);
    if (nextErr) {
        setText('error-new-password', nextErr);
        hasError = true;
    }

    if (next !== confirm) {
        setText('error-confirm-password', 'Passwords do not match.');
        hasError = true;
    }

    if (hasError) return;

    const btn = document.getElementById('password-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

    try {
        const res = await api.changePassword(current, next);
        if (res.success) {
            showToast('success', 'Password changed', 'Your new password is now active.');
            closeModal('changePasswordModal');
            form.reset();
            const user = sessionManager.getUser();
            if (user) {
                user.must_change_password = 0;
                sessionManager.api.setAuth(sessionManager.token, user);
            }
            const reminder = document.getElementById('password-reminder');
            if (reminder) reminder.hidden = true;
        } else {
            showToast('error', 'Could not update', res.message || 'Check your current password.');
        }
    } catch (err) {
        showToast('error', 'Could not update', err.message || 'Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
    }
}

/* ============================================================
 * UPDATE REQUEST — Course/Year pickers, Student ID text
 * ------------------------------------------------------------
 * The requested-value UI swaps based on the selected field:
 *   - Student ID → free-text input (student must type)
 *   - Course     → dropdown populated from GET /students/courses
 *   - Year Level → dropdown with the fixed year-level list
 *
 * Only ONE of the three fields is visible at a time; the hidden
 * ones are cleared so a stale value can never be submitted.
 * ============================================================ */

function wireUpdateRequestFields() {
    const typeEl = document.getElementById('request-type');
    if (!typeEl) return;

    typeEl.addEventListener('change', () => {
        applyRequestTypeUI();
    });

    // Clear the value error as soon as the user starts fixing it.
    ['request-new-value', 'request-new-course', 'request-new-year'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => setText('error-request-new-value', ''));
        el.addEventListener('change', () => setText('error-request-new-value', ''));
    });
}

/**
 * Swaps the requested-value field based on the currently-selected
 * request type. Called on `change` of #request-type, and once on
 * modal open (with no type selected → hides the group entirely).
 */
function applyRequestTypeUI() {
    const typeEl = document.getElementById('request-type');
    const groupEl = document.getElementById('request-value-group');
    const inputEl = document.getElementById('request-new-value');
    const courseEl = document.getElementById('request-new-course');
    const yearEl = document.getElementById('request-new-year');
    const labelEl = document.getElementById('request-value-label');
    const hintEl = document.getElementById('request-current-hint');

    if (!typeEl || !groupEl || !inputEl || !courseEl || !yearEl) return;

    const type = typeEl.value;

    // Nothing selected yet — hide the whole group.
    if (!type) {
        groupEl.style.display = 'none';
        inputEl.value = '';
        courseEl.value = '';
        yearEl.value = '';
        return;
    }

    groupEl.style.display = '';
    setText('error-request-new-value', '');

    if (type === 'Student ID') {
        labelEl.textContent = 'New Student ID';
        labelEl.setAttribute('for', 'request-new-value');

        inputEl.style.display = '';
        inputEl.placeholder = 'Enter the new Student ID';
        inputEl.maxLength = 30;
        inputEl.inputMode = 'text';
        inputEl.setAttribute('autocomplete', 'off');
        inputEl.setAttribute('spellcheck', 'false');

        courseEl.style.display = 'none';
        courseEl.value = '';
        yearEl.style.display = 'none';
        yearEl.value = '';

        if (currentProfile) {
            hintEl.textContent = `Current: ${getCurrentStudentId() || '—'}`;
            hintEl.style.display = '';
        } else {
            hintEl.style.display = 'none';
        }

        setTimeout(() => inputEl.focus(), 50);
    } else if (type === 'Course') {
        labelEl.textContent = 'New Course';
        labelEl.setAttribute('for', 'request-new-course');

        inputEl.style.display = 'none';
        inputEl.value = '';
        courseEl.style.display = '';
        yearEl.style.display = 'none';
        yearEl.value = '';

        loadCoursesForRequest();

        if (currentProfile) {
            hintEl.textContent = `Current: ${getCurrentCourse() || '—'}`;
            hintEl.style.display = '';
        } else {
            hintEl.style.display = 'none';
        }
    } else if (type === 'Year Level') {
        labelEl.textContent = 'New Year Level';
        labelEl.setAttribute('for', 'request-new-year');

        inputEl.style.display = 'none';
        inputEl.value = '';
        courseEl.style.display = 'none';
        courseEl.value = '';
        yearEl.style.display = '';

        const currentYear = getCurrentYear();
        Array.from(yearEl.options).forEach((opt) => {
            opt.disabled = !!(currentYear && opt.value === currentYear);
        });

        if (currentProfile) {
            hintEl.textContent = `Current: ${currentYear || '—'}`;
            hintEl.style.display = '';
        } else {
            hintEl.style.display = 'none';
        }
    }
}

/**
 * Fetches the distinct course list from GET /students/courses and
 * populates the Course select. The student's current course is
 * excluded from the options. If the request fails, the field falls
 * back to free-text entry so the student isn't blocked.
 */
async function loadCoursesForRequest() {
    const sel = document.getElementById('request-new-course');
    const inputEl = document.getElementById('request-new-value');
    if (!sel || !inputEl) return;

    // A previous attempt already failed — keep the text fallback.
    if (coursesLoadFailed) {
        sel.style.display = 'none';
        inputEl.style.display = '';
        inputEl.placeholder = 'Enter the course (e.g. BS Computer Science)';
        inputEl.maxLength = 100;
        return;
    }

    // Fetch the course list once per page load.
    if (cachedCourses === null) {
        sel.innerHTML = '<option value="">Loading courses…</option>';
        try {
            const res = await api.getCourses();
            cachedCourses = (res && res.success && Array.isArray(res.data)) ? res.data : [];
        } catch (err) {
            console.error('[update-request] Failed to load courses:', err);
            coursesLoadFailed = true;
            sel.style.display = 'none';
            inputEl.style.display = '';
            inputEl.placeholder = 'Enter the course (e.g. BS Computer Science)';
            inputEl.maxLength = 100;
            return;
        }
    }

    const current = getCurrentCourse();
    const filtered = (cachedCourses || []).filter((c) => c && c !== current);

    if (!filtered.length) {
        sel.innerHTML = '<option value="">No other courses available. Contact staff.</option>';
        return;
    }

    sel.innerHTML = '<option value="">Select a course…</option>' +
        filtered.map((c) => {
            const safe = escapeHtml(c);
            return `<option value="${safe}">${safe}</option>`;
        }).join('');
}

/**
 * Reads the currently-visible requested-value field. Only one of
 * the three fields is ever displayed at a time, so whichever is
 * visible determines the value. This handles the Course fallback
 * (text input instead of select) transparently.
 */
function getRequestedValue() {
    const inputEl = document.getElementById('request-new-value');
    const courseEl = document.getElementById('request-new-course');
    const yearEl = document.getElementById('request-new-year');

    if (inputEl && inputEl.style.display !== 'none') return (inputEl.value || '').trim();
    if (courseEl && courseEl.style.display !== 'none') return (courseEl.value || '').trim();
    if (yearEl && yearEl.style.display !== 'none') return (yearEl.value || '').trim();
    return '';
}

/** Reset the "Request an Update" UI to the pre-selection state. */
function resetRequestValueUI() {
    const typeEl = document.getElementById('request-type');
    if (typeEl) typeEl.value = '';

    const groupEl = document.getElementById('request-value-group');
    if (groupEl) groupEl.style.display = 'none';

    const inputEl = document.getElementById('request-new-value');
    if (inputEl) inputEl.value = '';

    const courseEl = document.getElementById('request-new-course');
    if (courseEl) courseEl.value = '';

    const yearEl = document.getElementById('request-new-year');
    if (yearEl) yearEl.value = '';

    setText('error-request-type', '');
    setText('error-request-new-value', '');
}

function openRequestUpdateModal() {
    closeAllDropdowns();
    const form = document.getElementById('update-request-form');
    if (form) form.reset();
    resetRequestValueUI();
    openModal('requestUpdateModal');
    loadPendingRequest();
}

async function submitUpdateRequest(form) {
    setText('error-request-type', '');
    setText('error-request-new-value', '');

    const requestType = document.getElementById('request-type').value;
    const newValue = getRequestedValue();

    let hasError = false;

    if (!requestType || !REQUEST_TYPES.includes(requestType)) {
        setText('error-request-type', 'Select a field to update.');
        hasError = true;
    }

    if (!newValue) {
        const msg =
            requestType === 'Course'     ? 'Please select a course.' :
            requestType === 'Year Level' ? 'Please select a year level.' :
                                           'Enter the requested value.';
        setText('error-request-new-value', msg);
        hasError = true;
    } else if (requestType === 'Student ID' && !/^[A-Za-z0-9-]{3,30}$/.test(newValue)) {
        setText('error-request-new-value', 'Student ID must be 3–30 characters (letters, digits, hyphens).');
        hasError = true;
    } else if (requestType === 'Course' && newValue.length > 100) {
        setText('error-request-new-value', 'Course name must not exceed 100 characters.');
        hasError = true;
    }

    if (hasError) return;

    const btn = document.getElementById('request-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    try {
        const res = await api.createUpdateRequest({
            request_type: requestType,
            new_value: newValue
        });
        if (res.success) {
            showToast('success', 'Request submitted', 'The library admin will review it shortly.');
            form.reset();
            closeModal('requestUpdateModal');
            await loadPendingRequest();
        } else {
            showToast('error', 'Could not submit', res.message || 'Please try again.');
        }
    } catch (err) {
        showToast('error', 'Could not submit', err.message || 'Please try again.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Request'; }
    }
}

/* ============================================================
 * WIRING
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    if (!sessionManager.requireRole('student')) return;

    window.toggleProfileDropdown   = toggleProfileDropdown;
    window.toggleAvatarDropdown    = toggleAvatarDropdown;
    window.closeAvatarDropdown     = closeAvatarDropdown;
    window.viewProfilePicture      = viewProfilePicture;
    window.openPhotoChoiceModal    = openPhotoChoiceModal;
    window.triggerCameraCapture    = triggerCameraCapture;
    window.triggerFileUpload       = triggerFileUpload;
    window.openEditProfileModal    = openEditProfileModal;
    window.openChangePasswordModal = openChangePasswordModal;
    window.openRequestUpdateModal  = openRequestUpdateModal;
    window.closeModal              = closeModal;

    const editForm = document.getElementById('editProfileForm');
    if (editForm) editForm.addEventListener('submit', (e) => { e.preventDefault(); submitProfileForm(editForm); });

    const pwForm = document.getElementById('changePasswordForm');
    if (pwForm) pwForm.addEventListener('submit', (e) => { e.preventDefault(); submitPasswordForm(pwForm); });

    const reqForm = document.getElementById('update-request-form');
    if (reqForm) reqForm.addEventListener('submit', (e) => { e.preventDefault(); submitUpdateRequest(reqForm); });

    wireUpdateRequestFields();

    const fileInput = document.getElementById('profilePhotoInput');
    if (fileInput) fileInput.addEventListener('change', function () {
        if (this.files && this.files[0]) {
            uploadProfilePicture(this.files[0]);
            this.value = '';
        }
    });

    const camInput = document.getElementById('profilePhotoCameraInput');
    if (camInput) camInput.addEventListener('change', function () {
        if (this.files && this.files[0]) {
            uploadProfilePicture(this.files[0]);
            this.value = '';
        }
    });

    const captureBtn = document.getElementById('capturePhotoBtn');
    if (captureBtn) captureBtn.addEventListener('click', capturePhoto);

    document.addEventListener('click', () => closeAllDropdowns());

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
            stopCameraStream();
        }
    });

    onClick('logoutBtn', () => { if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navLogoutLink', (e) => { e.preventDefault(); if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navbarToggler', () => { if (window.sidebar) window.sidebar.open(); });

    loadProfile().then(() => loadPendingRequest());
    loadSidebarHours();

    if (sessionStorage.getItem('force_password_change') === '1') {
        const banner = document.getElementById('password-reminder');
        if (banner) {
            banner.hidden = false;
            setTimeout(() => banner.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
        }
    }
});