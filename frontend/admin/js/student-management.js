// frontend/admin/js/student-management.js
const PAGE_SIZE = 10;

// ============================================================
// VALIDATION — every cap mirrors the backend's own validation.
// ============================================================
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_ID_RE = /^[A-Za-z0-9-]{3,30}$/;
const CONTACT_RE = /^[0-9+\-\s()]{7,20}$/;
const NAME_MAX_LENGTH = 100;
const SEARCH_MAX_LENGTH = 100;

const VALID_YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'];
const YEAR_LEVEL_LABELS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];

let allStudents = [];
let filteredStudents = [];
let currentPage = 1;
let totalPages = 1;
let editingStudentId = null;
let editingStudentOriginal = null;
let formInFlight = false;

if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info') { alert(message); };
}

document.addEventListener('DOMContentLoaded', function () {
    if (!sessionManager.requireRole('admin')) return;

    updateUserInfo();
    setTimeout(updateUserInfo, 150);
    window.addEventListener('load', updateUserInfo);

    wireTabs();
    wireSidebar();
    wireModals();

    document.getElementById('btnAddStudent').addEventListener('click', openAddStudent);
    document.getElementById('studentForm').addEventListener('submit', handleStudentFormSubmit);
    document.getElementById('modalResetPasswordBtn').addEventListener('click', handleModalResetPassword);

    const searchInput = document.getElementById('studentSearch');
    searchInput.setAttribute('maxlength', String(SEARCH_MAX_LENGTH));
    searchInput.addEventListener('input', debounce(function () { fetchStudents(1); }, 300));

    document.getElementById('courseFilter').addEventListener('change', function () { applyClientFilters(1); });
    document.getElementById('statusFilter').addEventListener('change', function () { applyClientFilters(1); });

    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () { sessionManager.logout(); });
    }

    fetchStudents(1);
    fetchUpdateRequests();
    loadUnreadNotificationCount();
});

const CAN_EDIT_STUDENTS = true;

function resolvePhotoUrl(photoUrl) {
    if (!photoUrl) return null;
    if (/^(https?:)?\/\//i.test(photoUrl)) return photoUrl;
    const backendRoot = API_CONFIG.baseURL.replace(/\/api\/index\.php.*$/i, '');
    const cleanPath = photoUrl.replace(/^\/+/, '');
    return `${backendRoot}/${cleanPath}`;
}

function createAvatarHtml(photoUrl, initials, size = 32) {
    const fallbackHtml = `<div style='width:${size}px; height:${size}px; border-radius:50%; background:#2b2d82; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:${Math.round(size / 2.5)}px; overflow:hidden;'>${initials}</div>`;
    if (!photoUrl) return fallbackHtml;
    const resolvedUrl = resolvePhotoUrl(photoUrl);
    if (!resolvedUrl) return fallbackHtml;
    return `<img src="${resolvedUrl}" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; display:block; flex-shrink:0;" onerror="this.outerHTML='${fallbackHtml.replace(/'/g, "\\'")}';">`;
}

async function updateUserInfo() {
    const user = sessionManager.getUser();
    if (!user) return;

    let userName = sessionManager.getUserName() || 'Admin';
    let initial = sessionManager.getUserInitial();
    let photoUrl = user.photo_url || null;

    try {
        const res = await api.getProfile();
        if (res.success && res.data) {
            const profile = res.data;
            const fullName = `${profile.first_name} ${profile.middle_name ? profile.middle_name + ' ' : ''}${profile.last_name}`;
            userName = fullName;
            initial = `${profile.first_name[0]}${profile.last_name[0]}`;
            photoUrl = profile.photo_url || null;

            sessionManager.user = { ...user, full_name: fullName, email: profile.email, photo_url: photoUrl };
            sessionManager.api.setAuth(sessionManager.token, sessionManager.user);
        }
    } catch (err) {
        console.warn('Failed to fetch fresh profile:', err);
    }

    const navNameEl = document.getElementById('userNameNav');
    const navAvatarEl = document.getElementById('userAvatarNav');
    if (navNameEl) navNameEl.textContent = userName;
    if (navAvatarEl) navAvatarEl.innerHTML = createAvatarHtml(photoUrl, initial, 36);

    const sidebarAvatarEl = document.getElementById('sidebarUserAvatar');
    if (sidebarAvatarEl) sidebarAvatarEl.innerHTML = createAvatarHtml(photoUrl, initial, 40);

    const sidebarNameEl = document.getElementById('sidebarUserName');
    if (sidebarNameEl) sidebarNameEl.textContent = userName;
}

async function loadUnreadNotificationCount() {
    try {
        const res = await api.getUnreadNotificationCount();
        if (res.success && res.data) {
            const badge = document.getElementById('notificationBadgeNav');
            if (badge) badge.textContent = res.data.unread || 0;
        }
    } catch (err) {
        console.error('Failed to load notification count:', err);
    }
}

function buildFullName(s) {
    if (!s) return '';
    if (s.full_name) return s.full_name;
    return [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');
}

function initials(name) {
    return (name || '').split(' ').filter(Boolean).slice(0, 2)
        .map(function (p) { return p[0].toUpperCase(); }).join('');
}

function formatYearLevel(value) {
    if (value === null || value === undefined || value === '') return '';
    const raw = String(value).trim();

    if (/year/i.test(raw)) return raw;

    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n <= YEAR_LEVEL_LABELS.length) {
        return YEAR_LEVEL_LABELS[n - 1];
    }

    return raw;
}

/* ============================================================
 * HOURS CELL
 * ------------------------------------------------------------
 * Renders the student's remaining computer hours as a small,
 * color-coded chip. Both values come straight from the students
 * table (`remaining_hours`, `used_hours`) — no extra fetch.
 *
 * Color tone:
 *   - empty : remaining <= 0
 *   - low   : remaining <= 25% of (remaining + used)
 *   - ok    : everything else
 *
 * The "of X.Xh" hint underneath shows what the semester limit was
 * at the last reset, so the admin can tell at a glance whether a
 * student is close to exhaustion.
 * ============================================================ */
function buildHoursCell(s) {
    const remaining = Number(s.remaining_hours ?? NaN);
    const used = Number(s.used_hours ?? NaN);

    if (!Number.isFinite(remaining) || !Number.isFinite(used)) {
        return '<span class="text-muted">—</span>';
    }

    const total = remaining + used;

    let tone = 'ok';
    if (remaining <= 0) tone = 'empty';
    else if (total > 0 && remaining <= total * 0.25) tone = 'low';

    const remainingStr = remaining.toFixed(1) + 'h';
    const totalStr = total > 0 ? 'of ' + total.toFixed(1) + 'h' : '';

    return (
        '<div class="hours-cell" title="Remaining hours this semester">' +
            '<span class="hours-remaining ' + tone + '">' + remainingStr + '</span>' +
            (totalStr ? '<span class="hours-total">' + totalStr + '</span>' : '') +
        '</div>'
    );
}

function openModal(id) {
    const bd = document.getElementById(id + 'Backdrop');
    if (bd) bd.classList.add('show');
    document.getElementById(id).classList.add('show');
}

function closeModal(id) {
    const bd = document.getElementById(id + 'Backdrop');
    if (bd) bd.classList.remove('show');
    document.getElementById(id).classList.remove('show');
}

async function fetchStudents(page) {
    currentPage = page || currentPage;
    const raw = document.getElementById('studentSearch').value;
    const search = sanitizeSearch(raw);

    const tbody = document.getElementById('studentTableBody');
    tbody.innerHTML = '<tr class="table-empty"><td colspan="7">Loading students…</td></tr>';

    try {
        const res = await api.getStudents(search ? { search } : {});
        if (res.success) {
            allStudents = res.data || [];
            applyClientFilters(currentPage);
            updateStats();
        } else {
            throw new Error(res.message || 'Failed to load students');
        }
    } catch (err) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="7">' + escapeHtml(err.message) + '</td></tr>';
        showToast('Could not load students: ' + err.message, 'error');
        updateStats();
    }
}

function sanitizeSearch(raw) {
    let s = String(raw || '').trim();
    if (s.length > SEARCH_MAX_LENGTH) s = s.substring(0, SEARCH_MAX_LENGTH);
    return s;
}

function applyClientFilters(page) {
    const course = document.getElementById('courseFilter').value;
    const status = document.getElementById('statusFilter').value;

    filteredStudents = allStudents.filter(function (s) {
        if (course && s.course !== course) return false;
        if (status && s.status !== status) return false;
        return true;
    });

    totalPages = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, page || currentPage), totalPages);

    renderStudentTable();
    renderPagination();
}

function updateStats() {
    const total = allStudents.length;
    const active = allStudents.filter(s => s.status === 'Active').length;
    const inactive = allStudents.filter(s => s.status === 'Inactive').length;

    document.getElementById('statTotalStudents').textContent = total;
    document.getElementById('statActiveStudents').textContent = active;
    document.getElementById('statInactiveStudents').textContent = inactive;
}

function currentPageSlice() {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredStudents.slice(start, start + PAGE_SIZE);
}

function renderStudentTable() {
    const tbody = document.getElementById('studentTableBody');
    const pageStudents = currentPageSlice();

    if (filteredStudents.length === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="7">' +
            '<div class="empty-state">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
            '<p>No students match your filters.</p></div></td></tr>';
        document.getElementById('pgSummary').textContent = 'Showing 0 of ' + allStudents.length + ' students';
        return;
    }

    tbody.innerHTML = pageStudents.map(function (s) {
        const fullName = buildFullName(s);
        const isActive = s.status === 'Active';
        const avatarHtml = createAvatarHtml(s.photo_url, escapeHtml(initials(fullName)), 32);
        return (
            '<tr>' +
                '<td><div class="row-person">' +
                    '<div class="row-avatar">' + avatarHtml + '</div>' +
                    '<div><div class="name">' + escapeHtml(fullName) + '</div><div class="meta">' + escapeHtml(s.email) + '</div></div>' +
                '</div></td>' +
                '<td>' + escapeHtml(s.student_id) + '</td>' +
                '<td>' + escapeHtml(s.course || '—') +
                    '<div class="meta" style="color:var(--text-light); font-size:11.5px;">' + escapeHtml(formatYearLevel(s.year_level)) + '</div></td>' +
                '<td>' + escapeHtml(s.email) + '</td>' +
                '<td>' + buildHoursCell(s) + '</td>' +
                '<td>' + (isActive
                    ? '<span class="badge badge-success">Active</span>'
                    : '<span class="badge badge-danger">Inactive</span>') + '</td>' +
                '<td><div class="d-flex gap-1">' +
                    (CAN_EDIT_STUDENTS ? '<button class="btn btn-icon btn-sm btn-light" data-edit="' + s.id + '" aria-label="Edit">' +
                        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
                    '</button>' : '') +
                '</div></td>' +
            '</tr>'
        );
    }).join('');

    document.getElementById('pgSummary').textContent =
        'Showing ' + pageStudents.length + ' of ' + filteredStudents.length + ' students (page ' + currentPage + ' of ' + Math.max(totalPages, 1) + ')';

    document.querySelectorAll('[data-edit]').forEach(function (btn) {
        btn.addEventListener('click', function () { openEditStudent(Number(btn.getAttribute('data-edit'))); });
    });
}

function renderPagination() {
    const wrap = document.getElementById('pgButtons');
    wrap.innerHTML = '';

    const prev = document.createElement('button');
    prev.textContent = '‹';
    prev.disabled = currentPage <= 1;
    prev.addEventListener('click', function () { currentPage--; renderStudentTable(); renderPagination(); });
    wrap.appendChild(prev);

    const maxButtons = 5;
    let start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    for (let p = start; p <= end; p++) {
        const btn = document.createElement('button');
        btn.textContent = String(p);
        if (p === currentPage) btn.classList.add('active');
        btn.addEventListener('click', function () { currentPage = p; renderStudentTable(); renderPagination(); });
        wrap.appendChild(btn);
    }

    const next = document.createElement('button');
    next.textContent = '›';
    next.disabled = currentPage >= totalPages;
    next.addEventListener('click', function () { currentPage++; renderStudentTable(); renderPagination(); });
    wrap.appendChild(next);
}

function openAddStudent() {
    editingStudentId = null;
    editingStudentOriginal = null;
    document.getElementById('studentModalTitle').textContent = 'Add Student';
    document.getElementById('studentForm').reset();
    setFormFieldDisabled('student_id', false);
    setFormFieldDisabled('course', false);
    setFormFieldDisabled('year_level', false);
    document.getElementById('modalResetPasswordBtn').style.display = 'none';
    setModalAvatar(null, '');
    openModal('studentModal');
}

function openEditStudent(id) {
    if (!CAN_EDIT_STUDENTS) {
        showToast('You do not have permission to edit student information.', 'error');
        return;
    }
    const s = allStudents.find(function (x) { return Number(x.id) === id; });
    if (!s) return;
    editingStudentId = id;

    editingStudentOriginal = {
        first_name: s.first_name || '',
        last_name: s.last_name || '',
        middle_name: s.middle_name || '',
        email: s.email || '',
        contact_number: s.contact_number || '',
        status: s.status === 'Active' ? 'Active' : 'Inactive',
    };

    document.getElementById('studentModalTitle').textContent = 'Edit Student';
    const form = document.getElementById('studentForm');
    form.first_name.value = s.first_name || '';
    form.last_name.value = s.last_name || '';
    form.middle_name.value = s.middle_name || '';
    form.student_id.value = s.student_id || '';
    form.course.value = s.course || '';
    form.year_level.value = formatYearLevel(s.year_level);
    form.email.value = s.email || '';
    form.contact_number.value = s.contact_number || '';
    form.active.checked = s.status === 'Active';

    setFormFieldDisabled('student_id', true);
    setFormFieldDisabled('course', true);
    setFormFieldDisabled('year_level', true);

    document.getElementById('modalResetPasswordBtn').style.display = CAN_EDIT_STUDENTS ? 'inline-flex' : 'none';

    setModalAvatar(s.photo_url, buildFullName(s));

    openModal('studentModal');
}

function setModalAvatar(photoUrl, fullName) {
    const wrap = document.getElementById('modalStudentAvatarWrap');
    const el = document.getElementById('modalStudentAvatar');
    if (!wrap || !el) return;

    if (!fullName) {
        wrap.style.display = 'none';
        el.innerHTML = '';
        return;
    }

    wrap.style.display = 'flex';
    el.innerHTML = createAvatarHtml(photoUrl, escapeHtml(initials(fullName)), 72);
}

function setFormFieldDisabled(fieldName, disabled) {
    const form = document.getElementById('studentForm');
    const field = form.elements[fieldName];
    if (field) field.disabled = disabled;
}

// ============================================================
// VALIDATION
// ============================================================
function validateStudentForm(payload, isNew) {
    const errors = [];

    // First name
    if (!payload.first_name) {
        errors.push('First name is required.');
    } else if (payload.first_name.length > NAME_MAX_LENGTH) {
        errors.push(`First name must be ${NAME_MAX_LENGTH} characters or fewer.`);
    }

    // Last name
    if (!payload.last_name) {
        errors.push('Last name is required.');
    } else if (payload.last_name.length > NAME_MAX_LENGTH) {
        errors.push(`Last name must be ${NAME_MAX_LENGTH} characters or fewer.`);
    }

    // Middle name (optional but capped)
    if (payload.middle_name && payload.middle_name.length > NAME_MAX_LENGTH) {
        errors.push(`Middle name must be ${NAME_MAX_LENGTH} characters or fewer.`);
    }

    // Email
    if (!payload.email) {
        errors.push('Email is required.');
    } else if (!EMAIL_RE.test(payload.email)) {
        errors.push('Please enter a valid email address.');
    }

    // Contact number (optional but must be well-formed if provided)
    if (payload.contact_number && !CONTACT_RE.test(payload.contact_number)) {
        errors.push('Contact number must be 7–20 digits (may include + - ( ) spaces).');
    }

    // Status whitelist
    if (!['Active', 'Inactive'].includes(payload.status)) {
        errors.push('Status must be Active or Inactive.');
    }

    // Create-only fields
    if (isNew) {
        if (!payload.student_id) {
            errors.push('Student ID is required.');
        } else if (!STUDENT_ID_RE.test(payload.student_id)) {
            errors.push('Student ID must be 3–30 characters (letters, digits, hyphens).');
        }
        if (!payload.course) errors.push('Please select a course.');
        if (!payload.year_level) {
            errors.push('Please select a year level.');
        } else if (!VALID_YEAR_LEVELS.includes(payload.year_level)) {
            errors.push('Year level is invalid.');
        }
    }

    return errors;
}

async function handleStudentFormSubmit(e) {
    e.preventDefault();
    if (formInFlight) return;

    const form = e.target;
    const submitBtn = document.getElementById('studentFormSubmit');

    const payload = {
        first_name: String(form.first_name.value || '').trim(),
        last_name: String(form.last_name.value || '').trim(),
        middle_name: String(form.middle_name.value || '').trim() || null,
        email: String(form.email.value || '').trim(),
        contact_number: String(form.contact_number.value || '').trim() || null,
        status: form.active.checked ? 'Active' : 'Inactive',
    };

    const isNew = !editingStudentId;
    if (isNew) {
        payload.student_id = String(form.student_id.value || '').trim();
        payload.course = form.course.value;
        payload.year_level = form.year_level.value;
    }

    // ---- VALIDATION 1: field-level sanity ----
    const validationErrors = validateStudentForm(payload, isNew);
    if (validationErrors.length) {
        showToast(validationErrors[0], 'warning');
        return;
    }

    // ---- VALIDATION 2: no-op guard for edits ----
    if (editingStudentId && editingStudentOriginal) {
        const isChanged = (
            payload.first_name !== editingStudentOriginal.first_name ||
            payload.last_name !== editingStudentOriginal.last_name ||
            (payload.middle_name || '') !== editingStudentOriginal.middle_name ||
            payload.email !== editingStudentOriginal.email ||
            (payload.contact_number || '') !== editingStudentOriginal.contact_number ||
            payload.status !== editingStudentOriginal.status
        );

        if (!isChanged) {
            showToast('No changes were made to this student.', 'warning');
            return;
        }
    }

    formInFlight = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');

    try {
        if (editingStudentId) {
            const res = await api.updateStudent(editingStudentId, payload);
            if (!res.success) throw new Error(res.message || 'Failed to update student');
            showToast('Student record updated successfully', 'success');
        } else {
            const res = await api.createStudent(payload);
            if (!res.success) throw new Error(res.message || 'Failed to add student');
            showToast('Student added. Default password is the Student ID.', 'success');
        }

        closeModal('studentModal');
        fetchStudents(editingStudentId ? currentPage : 1);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        formInFlight = false;
        submitBtn.disabled = false;
        submitBtn.classList.remove('loading');
    }
}

async function handleModalResetPassword() {
    if (!editingStudentId) {
        showToast('No student selected.', 'error');
        return;
    }
    if (!confirm('Reset this student\'s password to their Student ID?\nThey will be forced to change it on next login.')) return;
    try {
        const res = await api.resetStudentPassword(editingStudentId);
        if (!res.success) throw new Error(res.message || 'Failed to reset password');
        showToast('Password reset to Student ID. Student must change it on next login.', 'success');
        closeModal('studentModal');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function fetchUpdateRequests() {
    const list = document.getElementById('requestList');
    list.innerHTML = '<div class="empty-state">Loading requests…</div>';

    try {
        const res = await api.getUpdateRequests({ status: 'Pending' });
        const updateRequests = res.data || [];
        renderUpdateRequests(updateRequests);
    } catch (err) {
        list.innerHTML = '<div class="empty-state">' + escapeHtml(err.message) + '</div>';
        showToast('Could not load update requests: ' + err.message, 'error');
    }
}

function resolveStudentName(row) {
    if (!row) return 'Unknown';
    if (row.student_name) return row.student_name;
    const built = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
    return built || 'Unknown';
}

function renderUpdateRequests(updateRequests) {
    const list = document.getElementById('requestList');
    document.getElementById('reqCount').textContent = String(updateRequests.length);

    if (updateRequests.length === 0) {
        list.innerHTML = '<div class="empty-state">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6 9 17l-5-5"/></svg>' +
            "<p>No pending update requests. You're all caught up.</p></div>";
        return;
    }

    list.innerHTML = updateRequests.map(function (r) {
        const name = resolveStudentName(r);
        const avatarHtml = createAvatarHtml(r.photo_url || r.student_photo_url, escapeHtml(initials(name)), 32);
        return (
            '<div class="request-row">' +
                '<div class="row-avatar">' + avatarHtml + '</div>' +
                '<div class="who">' +
                    '<div class="name">' + escapeHtml(name) + ' <span class="text-muted" style="font-size:var(--font-size-xs);">(' + escapeHtml(r.student_number || '') + ')</span></div>' +
                    '<div class="detail">' + escapeHtml(r.request_type) + ': <s>' + escapeHtml(r.old_value) + '</s> → <b>' + escapeHtml(r.new_value) + '</b></div>' +
                '</div>' +
                '<div class="actions">' +
                    '<button class="btn btn-sm btn-light" data-req-reject="' + r.id + '">Reject</button>' +
                    '<button class="btn btn-sm btn-primary" data-req-approve="' + r.id + '">Approve</button>' +
                '</div>' +
            '</div>'
        );
    }).join('');

    document.querySelectorAll('[data-req-approve]').forEach(function (btn) {
        btn.addEventListener('click', function () { resolveRequest(btn.getAttribute('data-req-approve'), 'Approved'); });
    });
    document.querySelectorAll('[data-req-reject]').forEach(function (btn) {
        btn.addEventListener('click', function () { resolveRequest(btn.getAttribute('data-req-reject'), 'Rejected'); });
    });
}

async function resolveRequest(id, decision) {
    const cleanId = Number(id);
    if (!Number.isFinite(cleanId) || cleanId <= 0) {
        showToast('Invalid request id.', 'warning');
        return;
    }
    if (!['Approved', 'Rejected'].includes(decision)) {
        showToast('Invalid decision.', 'warning');
        return;
    }
    try {
        const res = await api.reviewUpdateRequest(cleanId, decision);
        if (!res.success) throw new Error(res.message || 'Failed to review request');
        showToast('Update request ' + decision.toLowerCase(), 'success');
        fetchUpdateRequests();
        fetchStudents(currentPage);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function wireTabs() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
            document.querySelectorAll('.tab-panel').forEach(function (p) { p.style.display = 'none'; p.classList.remove('active'); });
            btn.classList.add('active');
            const panel = document.querySelector('.tab-panel[data-panel="' + btn.getAttribute('data-tab') + '"]');
            panel.style.display = 'block';
            panel.classList.add('active');
        });
    });
}

function wireSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar || !toggle || !backdrop) return;

    function open() { sidebar.classList.add('sidebar-open'); backdrop.classList.add('show'); }
    function close() { sidebar.classList.remove('sidebar-open'); backdrop.classList.remove('show'); }
    toggle.addEventListener('click', open);
    backdrop.addEventListener('click', close);
}

function wireModals() {
    document.querySelectorAll('[data-modal-close]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            closeModal('studentModal');
        });
    });
    const bd = document.getElementById('studentModalBackdrop');
    if (bd) bd.addEventListener('click', function () { closeModal('studentModal'); });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal('studentModal');
    });
}

// FIX: null/undefined-only guard. The old `if (!text) return ''` also
// caught numeric 0 and boolean false, silently dropping them.
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}