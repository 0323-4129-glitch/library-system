// frontend/admin/js/concerns.js
const AUTO_REFRESH_MS = 30000;
const REPLY_MAX_LENGTH = 5000;
const SUBJECT_MAX_LENGTH = 200;

let allConcerns = [];
let activeConcernId = null;
let replyInFlight = false;

document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('admin')) return;
    initConcerns();
    setupConcernListeners();
    setInterval(refreshConcernList, AUTO_REFRESH_MS);
});

if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info') { alert(message); };
}

// ===== Avatar helpers =====
function resolvePhotoUrl(photoUrl) {
    if (!photoUrl) return null;
    if (/^(https?:)?\/\//i.test(photoUrl)) return photoUrl;
    const backendRoot = API_CONFIG.baseURL.replace(/\/api\/index\.php.*$/i, '');
    const cleanPath = photoUrl.replace(/^\/+/, '');
    return `${backendRoot}/${cleanPath}`;
}

function initials(name) {
    return (name || '').split(' ').filter(Boolean).slice(0, 2)
        .map(p => p[0].toUpperCase()).join('');
}

function getStudentPhoto(c) {
    if (!c) return null;
    return resolvePhotoUrl(
        c.photo_url || c.profile_photo || c.profile_picture ||
        c.photo || c.avatar || c.student_photo
    );
}

/**
 * Builds the inner HTML for an avatar slot. `img` is placed first,
 * fallback span second; CSS stacks them so the img covers the
 * fallback when it loads, and hides the img when it errors.
 */
function buildAvatarInner(photoUrl, initialsText) {
    const hasSrc = !!photoUrl;
    return `
        <img src="${hasSrc ? photoUrl : ''}"
             alt=""
             loading="lazy"
             onload="this.classList.add('is-loaded')"
             onerror="this.classList.add('is-error')"
             class="${hasSrc ? '' : 'is-error'}">
        <span class="avatar-fallback-text">${initialsText}</span>
    `;
}

// ===== Read / Unread tracking (stored in this browser) =====
const READ_KEY = 'admin_read_concerns';

function getReadMap() {
    try { return JSON.parse(localStorage.getItem(READ_KEY)) || {}; }
    catch (e) { return {}; }
}

function concernStamp(c) {
    return String(c.last_message_at || c.created_at || '');
}

function markConcernRead(c) {
    if (!c) return;
    const map = getReadMap();
    map[c.id] = concernStamp(c);
    try { localStorage.setItem(READ_KEY, JSON.stringify(map)); } catch (e) { /* ignore */ }
}

function getDisplayStatus(c) {
    if (c.status === 'Resolved') return 'Resolved';
    if (c.status === 'Replied') return 'Replied';
    const readStamp = getReadMap()[c.id];
    return readStamp && readStamp === concernStamp(c) ? 'Read' : 'Unread';
}

const STATUS_BADGE = {
    Unread: 'warning',
    Read: 'secondary',
    Replied: 'info',
    Resolved: 'success'
};

// ============================================================
// VALIDATION
// ============================================================

/** Reject ids that aren't positive integers. */
function validateConcernId(id) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
    return n;
}

/**
 * Trim, cap, and reject empty reply messages. Mirrors the backend's
 * own cap so an oversized message never reaches the wire.
 */
function validateReplyMessage(raw) {
    const msg = String(raw || '').trim();
    if (!msg) return { ok: false, error: 'Reply cannot be empty.' };
    if (msg.length > REPLY_MAX_LENGTH) {
        return { ok: false, error: `Reply must be ${REPLY_MAX_LENGTH} characters or fewer (currently ${msg.length}).` };
    }
    return { ok: true, message: msg };
}

/** Whitelist the filter dropdown value. */
function validateStatusFilter(raw) {
    const v = String(raw || '').trim();
    return ['', 'Unread', 'Read', 'Replied', 'Resolved'].includes(v) ? v : '';
}

async function initConcerns() {
    await loadConcernList();
}

async function loadConcernList() {
    try {
        const res = await api.getConcerns({});
        if (res.success) {
            const filterEl = document.getElementById('concernStatusFilter');
            const filter = validateStatusFilter(filterEl ? filterEl.value : '');
            allConcerns = (res.data || []).filter(c => !filter || getDisplayStatus(c) === filter);
            renderConcernList();

            if (activeConcernId && allConcerns.some(c => String(c.id) === String(activeConcernId))) {
                openConcern(activeConcernId, true);
            }
        }
    } catch (err) {
        console.error('Failed to load concerns:', err);
        showToast(err.message || 'Failed to load concerns', 'error');
    }
}

function refreshConcernList() {
    loadConcernList();
}

function renderConcernList() {
    const list = document.getElementById('concernsList');
    if (!list) return;

    if (!allConcerns.length) {
        list.innerHTML = `
            <div class="concerns-list-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p>No concerns to show</p>
            </div>
        `;
        return;
    }

    list.innerHTML = allConcerns.map(c => {
        const name = `${c.first_name} ${c.last_name || ''}`.trim();
        const avatar = getStudentPhoto(c);
        const initialsText = escapeHtml(initials(name));
        const avatarInner = buildAvatarInner(avatar, initialsText);

        const when = formatRelativeTime(c.last_message_at || c.created_at);
        const active = String(c.id) === String(activeConcernId) ? ' active' : '';
        const label = getDisplayStatus(c);
        const unread = label === 'Unread' ? ' unread' : '';

        return `
            <div class="concern-row${active}${unread}" data-id="${c.id}" data-concern-id="${c.id}">
                <div class="concern-row-avatar">${avatarInner}</div>
                <div class="concern-row-body">
                    <div class="concern-row-top">
                        <span class="concern-row-name">${escapeHtml(name)}</span>
                        <span class="concern-row-time">${when}</span>
                    </div>
                    <div class="concern-row-subject">${escapeHtml(c.subject)}</div>
                    <div class="concern-row-bottom">
                        <span class="concern-row-id">${escapeHtml(c.student_number || '')}</span>
                        <span class="badge badge-${STATUS_BADGE[label]}">${label}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.concern-row').forEach(row => {
        row.addEventListener('click', () => {
            const id = validateConcernId(row.getAttribute('data-concern-id'));
            if (id !== null) openConcern(id);
        });
    });
}

async function openConcern(id, silent = false) {
    const cleanId = validateConcernId(id);
    if (cleanId === null) {
        if (!silent) showToast('Invalid concern id.', 'warning');
        return;
    }

    try {
        activeConcernId = cleanId;
        const res = await api.getConcern(cleanId);
        if (!res.success) throw new Error(res.message || 'Failed to load concern');

        const listItem = allConcerns.find(c => String(c.id) === String(cleanId));
        const concern = Object.assign({}, listItem || {}, res.data.concern);

        renderThread(concern, res.data.messages);

        markConcernRead(listItem || res.data.concern);
        renderConcernList();
    } catch (err) {
        console.error('Failed to open concern:', err);
        if (!silent) showToast(err.message || 'Failed to load concern', 'error');
    }
}

function renderThread(concern, messages) {
    const placeholder = document.getElementById('threadPlaceholder');
    const content = document.getElementById('threadContent');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = 'flex';

    const name = `${concern.first_name} ${concern.last_name || ''}`.trim();
    const meta = [concern.student_number, concern.course, concern.year_level].filter(Boolean).join(' · ');

    setTextIfPresent('threadStudentName', name);
    setTextIfPresent('threadStudentMeta', meta);
    setTextIfPresent('threadSubject', concern.subject);

    const avatarEl = document.getElementById('threadAvatar');
    if (avatarEl) {
        const avatarUrl = getStudentPhoto(concern);
        const initialsText = escapeHtml(initials(name));
        avatarEl.innerHTML = buildAvatarInner(avatarUrl, initialsText);
    }

    const badge = document.getElementById('threadStatusBadge');
    if (badge) {
        let label = getDisplayStatus(concern);
        if (label === 'Unread') label = 'Read';
        badge.textContent = label;
        badge.className = `badge badge-${STATUS_BADGE[label]}`;
    }

    const resolveBtn = document.getElementById('threadResolveBtn');
    if (resolveBtn) resolveBtn.style.display = concern.status === 'Resolved' ? 'none' : 'inline-flex';

    const wrap = document.getElementById('threadMessages');
    if (wrap) {
        wrap.innerHTML = (messages || []).map(m => {
            const mine = m.sender_type === 'Admin';
            const when = m.created_at
                ? new Date(String(m.created_at).replace(' ', 'T')).toLocaleString()
                : '';
            return `
                <div class="concern-message ${mine ? 'from-admin' : 'from-student'}">
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

        wrap.scrollTop = wrap.scrollHeight;
    }

    const replyBox = document.getElementById('threadReplyMessage');
    if (replyBox) {
        replyBox.setAttribute('maxlength', String(REPLY_MAX_LENGTH));
        replyBox.focus();
    }
}

function setTextIfPresent(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

async function sendConcernReply(e) {
    e.preventDefault();
    if (replyInFlight) return;

    const cleanId = validateConcernId(activeConcernId);
    if (cleanId === null) {
        showToast('No concern is selected.', 'warning');
        return;
    }

    const input = document.getElementById('threadReplyMessage');
    if (!input) return;

    const validation = validateReplyMessage(input.value);
    if (!validation.ok) {
        showToast(validation.error, 'warning');
        return;
    }

    const btn = document.getElementById('threadSendBtn');
    replyInFlight = true;
    if (btn) btn.disabled = true;

    try {
        const res = await api.replyToConcern(cleanId, validation.message);
        if (!res.success) throw new Error(res.message || 'Failed to send reply');
        input.value = '';
        showToast('Reply sent', 'success');
        await loadConcernList();
        await openConcern(cleanId);
    } catch (err) {
        showToast(err.message || 'Failed to send reply', 'error');
    } finally {
        replyInFlight = false;
        if (btn) btn.disabled = false;
    }
}

async function resolveConcern() {
    const cleanId = validateConcernId(activeConcernId);
    if (cleanId === null) {
        showToast('No concern is selected.', 'warning');
        return;
    }
    if (!confirm('Mark this concern as resolved?')) return;

    try {
        const res = await api.setConcernStatus(cleanId, 'Resolved');
        if (!res.success) throw new Error(res.message || 'Failed to resolve');
        showToast('Concern marked as resolved', 'success');
        await loadConcernList();
        await openConcern(cleanId);
    } catch (err) {
        showToast(err.message || 'Failed to resolve', 'error');
    }
}

function setupConcernListeners() {
    const replyForm = document.getElementById('threadReplyForm');
    if (replyForm) replyForm.addEventListener('submit', sendConcernReply);

    const resolveBtn = document.getElementById('threadResolveBtn');
    if (resolveBtn) resolveBtn.addEventListener('click', resolveConcern);

    const statusFilter = document.getElementById('concernStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', loadConcernList);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            // Nothing to close here; the concern view uses an inline layout.
        }
    });
}

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

window.openConcern = openConcern;