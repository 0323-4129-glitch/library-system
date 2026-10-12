// frontend/student/js/concerns.js

document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('student')) return;
    initStudentConcerns();
    setupStudentListeners();
    setupRealtimeListeners();
    setInterval(refreshMyConcerns, 60000); // fallback; real-time events are primary
});

let myConcerns = [];
let activeThreadId = null;
let currentStudentId = null;
let lastMessageCount = 0;

if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info') { alert(message); };
}

/* ============================================================
 * CONCERN CATEGORIES (replaces the free-typed subject)
 * The chosen category is sent to the backend as the subject.
 * ============================================================ */
const CONCERN_CATEGORIES = [
    { label: 'Computer is broken',       icon: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4M9 8l6 4M15 8l-6 4"/>' },
    { label: 'Remaining hours',          icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    { label: 'Account or login problem', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>' },
    { label: 'Reservation or schedule',  icon: '<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/>' },
    { label: 'Suggestion or feedback',   icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z"/>' },
    { label: 'Others',                   icon: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>' }
];

// Soft caps: the backend treats subject as varchar(200) and message as TEXT.
const CONCERN_SUBJECT_MAX = 200;
const CONCERN_MESSAGE_MAX = 2000;

function renderCategoryOptions() {
    const wrap = document.getElementById('concernCategories');
    if (!wrap) return;
    wrap.innerHTML = CONCERN_CATEGORIES.map((c, i) => `
        <label class="category-option">
            <input type="radio" name="concernCategory" value="${escapeHtml(c.label)}" ${i === 0 ? 'required' : ''}>
            <span class="category-card">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${c.icon}</svg>
                <span class="category-label">${escapeHtml(c.label)}</span>
            </span>
        </label>
    `).join('');

    wrap.addEventListener('change', updateMessagePlaceholder);
}

function getSelectedCategory() {
    const checked = document.querySelector('input[name="concernCategory"]:checked');
    return checked ? checked.value : '';
}

function updateMessagePlaceholder() {
    const box = document.getElementById('newConcernMessage');
    if (!box) return;
    box.placeholder = getSelectedCategory() === 'Others'
        ? 'Please explain your concern in detail…'
        : 'Add the details of your concern here…';
}

/* ============================================================
 * CHROME — sidebar avatar/name + semester hours meter
 * ============================================================ */
function paintChrome() {
    // navbar.js / sidebar.js draw the name and photo themselves.
    refreshChrome();
}

async function loadSidebarHours() {
    try {
        const res = await api.getDashboard();
        if (res.success && res.data && res.data.student) {
            const used = res.data.student.used_hours;
            const remaining = res.data.student.remaining_hours;
            // paintSidebarHours() is defined in shared/js/helpers.js.
            paintSidebarHours(used, remaining);
        }
    } catch (err) {
        console.warn('[concerns] Could not load semester hours:', err);
    }
}

/* ============================================================
 * INIT
 *
 * FIX: resolve the current student id from either `user.id` or
 * `user.sub`. The JWT payload uses `sub` as the subject claim
 * (AuthController::studentLogin → Jwt::encode(['sub' => $id])).
 * sessionManager.getUser() may surface it as one or the other
 * depending on how session-check.js shapes the payload. Previously
 * only `user.id` was read, so if the session returned `sub` only,
 * currentStudentId stayed null, loadMyConcerns() returned early,
 * and the "Loading your concerns…" placeholder never resolved.
 *
 * Also: if neither is present after the profile-hydration pass,
 * we surface a real error instead of a permanent skeleton.
 * ============================================================ */
async function initStudentConcerns() {
    const user = sessionManager.getUser() || {};
    currentStudentId = user.id || user.sub || null;

    renderCategoryOptions();
    paintChrome();

    // If the cached session has no name, hydrate from /profile so the
    // sidebar has something to show — and re-read the id in case the
    // profile row carries the canonical one.
    if (!sessionManager.getUserName() || !currentStudentId) {
        try {
            const res = await api.getProfile();
            if (res.success && res.data) {
                const merged = { ...user, ...res.data };
                sessionManager.api.setAuth(sessionManager.token, merged);
                paintChrome();

                if (!currentStudentId) {
                    currentStudentId = merged.id || merged.sub || null;
                }
            }
        } catch (err) {
            console.warn('[concerns] Profile hydration failed:', err);
        }
    }

    if (!currentStudentId) {
        console.error('[concerns] No student id on session or profile — cannot load concerns.');
        const container = document.getElementById('myConcerns');
        if (container) {
            container.innerHTML = `
                <div class="concerns-list-empty">
                    <p>Could not identify your account.</p>
                    <p class="subtext">Please log out and sign in again.</p>
                </div>`;
        }
        return;
    }

    // Fire both in parallel — the hours meter shouldn't block the list.
    await Promise.all([loadMyConcerns(), loadSidebarHours()]);
}

/* ============================================================
 * CONCERNS LIST (left column)
 * ============================================================ */
const STATUS_BADGE = { Open: 'warning', Replied: 'info', Resolved: 'success' };
const STATUS_LABEL = { Open: 'Waiting for librarian', Replied: 'Librarian replied', Resolved: 'Resolved' };

async function loadMyConcerns() {
    if (!currentStudentId) return;
    const container = document.getElementById('myConcerns');
    try {
        const res = await api.getConcernsForStudent(currentStudentId);
        if (res.success) {
            myConcerns = res.data || [];
            renderMyConcerns();
        }
    } catch (err) {
        console.error('Failed to load concerns:', err);
        if (container && !myConcerns.length) {
            container.innerHTML = '<div class="concerns-list-empty">Failed to load your concerns.</div>';
        }
    }
}

// Periodic refresh: also silently refresh the open conversation.
async function refreshMyConcerns() {
    await loadMyConcerns();
    if (activeThreadId) openThread(activeThreadId, true);
}

function renderMyConcerns() {
    const container = document.getElementById('myConcerns');
    if (!container) return;

    if (!myConcerns.length) {
        container.innerHTML = `
            <div class="concerns-list-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <p>You haven't sent any concerns yet</p>
                <p class="subtext">Click <strong>New Concern</strong> to message the librarian.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = myConcerns.map(c => {
        const active = String(c.id) === String(activeThreadId) ? ' active' : '';
        const when = formatRelativeTime(c.last_message_at || c.created_at);
        return `
            <div class="concern-row${active}" data-id="${c.id}">
                <div class="concern-row-avatar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </div>
                <div class="concern-row-body">
                    <div class="concern-row-top">
                        <span class="concern-row-name">${escapeHtml(c.subject)}</span>
                        <span class="concern-row-time">${when}</span>
                    </div>
                    <div class="concern-row-subject">Started ${formatRelativeTime(c.created_at)}</div>
                    <div class="concern-row-bottom">
                        <span class="concern-row-id">Last activity ${when}</span>
                        <span class="badge badge-${STATUS_BADGE[c.status] || 'info'}">${escapeHtml(STATUS_LABEL[c.status] || c.status)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Wire clicks (delegated listener pattern, matching the rest of the
    // student pages). We keep window.openThread for backwards compat
    // but bind the row clicks here so the pattern is data-id based.
    container.querySelectorAll('.concern-row').forEach(row => {
        row.addEventListener('click', () => openThread(row.dataset.id));
    });
}

/* ============================================================
 * MODAL OPEN / CLOSE (new concern)
 * ============================================================ */
function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add('show');
    const bd = m.querySelector('.modal-backdrop');
    if (bd) bd.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('show');
    const bd = m.querySelector('.modal-backdrop');
    if (bd) bd.classList.remove('show');
    document.body.style.overflow = '';
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '';
}

function openNewConcernModal() {
    const form = document.getElementById('newConcernForm');
    if (form) form.reset();
    setText('error-concern-category', '');
    setText('error-concern-message', '');
    updateMessagePlaceholder();
    openModal('newConcernModal');
}

/* ============================================================
 * CONVERSATION (right column)
 * ============================================================ */
async function openThread(id, silent = false) {
    activeThreadId = id;
    try {
        const res = await api.getConcern(id);
        if (!res.success) throw new Error(res.message || 'Failed to load concern');

        const c = res.data.concern;
        const messages = res.data.messages || [];

        const placeholder = document.getElementById('threadPlaceholder');
        const content = document.getElementById('threadContent');
        if (placeholder) placeholder.style.display = 'none';
        if (content) content.style.display = 'flex';

        setText('threadSubject', c.subject);
        setText('threadMeta', `Started ${formatRelativeTime(c.created_at)}`);

        const badge = document.getElementById('threadStatusBadge');
        if (badge) {
            badge.textContent = STATUS_LABEL[c.status] || c.status;
            badge.className = `badge badge-${STATUS_BADGE[c.status] || 'info'}`;
        }

        const wrap = document.getElementById('studentThreadMessages');
        if (wrap) {
            wrap.innerHTML = messages.map(m => {
                const mine = m.sender_type === 'Student';
                const when = m.created_at
                    ? new Date(String(m.created_at).replace(' ', 'T')).toLocaleString()
                    : '';
                return `
                    <div class="concern-message ${mine ? 'from-student' : 'from-admin'}">
                        <div class="concern-message-bubble">
                            <div class="concern-message-text">${escapeHtml(m.message).replace(/\n/g, '<br>')}</div>
                            <div class="concern-message-meta">
                                <strong>${escapeHtml(m.sender_name || m.sender_type)}</strong>
                                <span>${when}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            // Only jump to the bottom on first open or when new messages arrive
            if (!silent || messages.length !== lastMessageCount) {
                wrap.scrollTop = wrap.scrollHeight;
            }
            lastMessageCount = messages.length;
        }

        // Highlight the selected row
        document.querySelectorAll('.concern-row').forEach(row => {
            row.classList.toggle('active', String(row.dataset.id) === String(id));
        });

        if (!silent) {
            const replyBox = document.getElementById('studentReplyMessage');
            if (replyBox && window.innerWidth > 900) replyBox.focus();
            if (window.innerWidth <= 900) {
                const thread = document.getElementById('concernsThread');
                if (thread) thread.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    } catch (err) {
        console.error('Failed to open concern:', err);
        if (!silent) showToast(err.message || 'Failed to load concern', 'error');
    }
}

/* ============================================================
 * SUBMIT NEW CONCERN — VALIDATION
 * ============================================================ */
function validateConcernPayload({ subject, message }) {
    const errors = { subject: '', message: '' };

    if (!subject) {
        errors.subject = 'Please choose what your concern is about.';
    } else if (subject.length > CONCERN_SUBJECT_MAX) {
        errors.subject = `Concern category is too long (max ${CONCERN_SUBJECT_MAX} characters).`;
    }

    if (!message) {
        errors.message = 'Message is required.';
    } else if (message.length < 5) {
        errors.message = 'Please add a little more detail (at least 5 characters).';
    } else if (message.length > CONCERN_MESSAGE_MAX) {
        errors.message = `Message is too long (max ${CONCERN_MESSAGE_MAX} characters — currently ${message.length}).`;
    }

    return errors;
}

async function submitNewConcern(e) {
    e.preventDefault();
    setText('error-concern-category', '');
    setText('error-concern-message', '');

    const subject = getSelectedCategory();
    const message = (document.getElementById('newConcernMessage').value || '').trim();

    const errors = validateConcernPayload({ subject, message });
    if (errors.subject || errors.message) {
        if (errors.subject) setText('error-concern-category', errors.subject);
        if (errors.message) setText('error-concern-message', errors.message);
        return;
    }

    const btn = document.getElementById('submitConcernBtn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const res = await api.createConcern({ subject, message });
        if (!res.success) throw new Error(res.message || 'Failed to send concern');
        showToast('Concern sent. The librarian will respond shortly.', 'success');
        document.getElementById('newConcernForm').reset();
        closeModal('newConcernModal');
        await loadMyConcerns();

        // Open the new concern right away if the API returned its id
        const newId = res.data && (res.data.id || (res.data.concern && res.data.concern.id));
        if (newId) openThread(newId);
    } catch (err) {
        showToast(err.message || 'Failed to send concern', 'error');
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

async function sendStudentReply(e) {
    e.preventDefault();
    if (!activeThreadId) return;
    const input = document.getElementById('studentReplyMessage');
    const message = (input.value || '').trim();
    if (!message) return;
    if (message.length > CONCERN_MESSAGE_MAX) {
        showToast(`Reply is too long (max ${CONCERN_MESSAGE_MAX} characters).`, 'warning');
        return;
    }

    const btn = document.getElementById('studentSendBtn');
    btn.disabled = true;

    try {
        const res = await api.replyToConcern(activeThreadId, message);
        if (!res.success) throw new Error(res.message || 'Failed to send');
        input.value = '';
        showToast('Reply sent', 'success');
        await loadMyConcerns();
        await openThread(activeThreadId, true);
    } catch (err) {
        showToast(err.message || 'Failed to send', 'error');
    } finally {
        btn.disabled = false;
    }
}

/* ============================================================
 * LISTENERS
 * ============================================================ */
function setupStudentListeners() {
    const newBtn = document.getElementById('newConcernBtn');
    if (newBtn) newBtn.addEventListener('click', openNewConcernModal);

    const cancelBtn = document.getElementById('cancelConcernBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
        document.getElementById('newConcernForm').reset();
        closeModal('newConcernModal');
    });

    const form = document.getElementById('newConcernForm');
    if (form) form.addEventListener('submit', submitNewConcern);

    const replyForm = document.getElementById('studentReplyForm');
    if (replyForm) replyForm.addEventListener('submit', sendStudentReply);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal('newConcernModal');
    });

    // Sidebar / navbar page-level chrome, matching every other student page.
    onClick('logoutBtn', () => {
        if (confirm('Are you sure you want to log out?')) sessionManager.logout();
    });
    onClick('navLogoutLink', (e) => {
        e.preventDefault();
        if (confirm('Are you sure you want to log out?')) sessionManager.logout();
    });
    onClick('navbarToggler', () => { if (window.sidebar) window.sidebar.open(); });
}

/* ============================================================
 * REAL-TIME
 * ============================================================ */
function setupRealtimeListeners() {
    window.addEventListener('realtime:concern', () => {
        loadMyConcerns();
        if (activeThreadId) openThread(activeThreadId, true);
    });
}

/* ============================================================
 * HELPERS
 * ============================================================ */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(String(dateString).replace(' ', 'T'));
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 0) return 'Just now';
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
}

window.openThread = openThread;
window.closeModal = closeModal;