// frontend/admin/js/notifications.js
document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('admin')) return;
    initializeNotifications();
    setupEventListeners();
    setupRealtimeListeners();
    startAutoRefresh();
});

const PAGE_SIZE = 20;

// FIX: server-side length caps — mirrors the DB schema so we can reject
// oversized input before the round trip. Title is varchar(150) in
// library_system.sql; the message column is TEXT so no cap there.
const TITLE_MAX_LENGTH = 150;
const MESSAGE_MAX_LENGTH = 2000; // soft cap to prevent absurd payloads

let allNotifications = [];
let filteredNotifications = [];
let currentPage = 1;
let totalPages = 1;
let currentFilters = { type: '', is_read: '', search: '' };
let unreadCount = 0;
let selectedStudentIds = new Set(); // FIX: normalized to strings — see has()/add() below

// 'update' is shown as "Update Request".
const TYPE_LABELS = {
    info: 'Info', warning: 'Warning', success: 'Success',
    error: 'Error', reservation: 'Reservation', session: 'Session',
    update: 'Update Request', system: 'System', concern: 'Concern'
};

const NOTIFICATION_SVG = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.3 2.3 4.7-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    reservation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/></svg>',
    session: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>',
    update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V20a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.6V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H20a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z"/></svg>',
    concern: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>'
};
const DEFAULT_NOTIF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>';

if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info') { alert(message); };
}

function resolvePhotoUrl(photoUrl) {
    if (!photoUrl) return null;
    if (/^(https?:)?\/\//i.test(photoUrl)) return photoUrl;
    const backendRoot = API_CONFIG.baseURL.replace(/\/api\/index\.php.*$/i, '');
    const cleanPath = photoUrl.replace(/^\/+/, '');
    return `${backendRoot}/${cleanPath}`;
}

function createAvatarHtml(photoUrl, initials, size = 32) {
    const fallbackHtml = `<div style="width:${size}px; height:${size}px; border-radius:50%; background:#2b2d82; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:${Math.round(size/2.5)}px; overflow:hidden;">${initials}</div>`;
    if (!photoUrl) return fallbackHtml;
    const resolvedUrl = resolvePhotoUrl(photoUrl);
    if (!resolvedUrl) return fallbackHtml;
    return `<img src="${resolvedUrl}" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; display:block; flex-shrink:0;" onerror="this.outerHTML='${fallbackHtml.replace(/'/g, "\\'")}';">`;
}

async function initializeNotifications() {
    try {
        await updateUserInfo();
        await loadNotificationCourses();
        await loadNotifications();
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Failed to load notifications', 'error');
    }
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
    } catch (err) { console.warn('Failed to fetch fresh profile:', err); }
    const navName = document.getElementById('userNameNav');
    const navAvatar = document.getElementById('userAvatarNav');
    if (navName) navName.textContent = userName;
    if (navAvatar) navAvatar.innerHTML = createAvatarHtml(photoUrl, initial, 36);
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarAvatar = document.getElementById('sidebarUserAvatar');
    if (sidebarName) sidebarName.textContent = userName;
    if (sidebarAvatar) sidebarAvatar.innerHTML = createAvatarHtml(photoUrl, initial, 40);
}

async function loadNotificationCourses() {
    try {
        const res = await api.getStudents({ limit: 1000 });
        if (res.success) {
            const students = res.data || [];
            const courses = [...new Set(students.map(s => s.course).filter(Boolean))].sort();
            ['filterStudentCourse', 'personalStudentCourse'].forEach(id => {
                const sel = document.getElementById(id);
                if (sel) sel.innerHTML = '<option value="">All Departments</option>' +
                    courses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
            });
        }
    } catch (error) { console.error('Failed to load courses:', error); }
}

async function loadNotifications() {
    try {
        const [listRes, unreadRes] = await Promise.all([
            api.getNotifications(),
            api.getUnreadNotificationCount()
        ]);
        if (listRes.success) {
            allNotifications = listRes.data || [];
            unreadCount = unreadRes.success ? (unreadRes.data.unread || 0) : 0;
            updateBadge(unreadCount);
            applyFiltersAndPaginate(1);
        } else {
            throw new Error(listRes.message || 'Failed to load notifications');
        }
    } catch (error) {
        console.error('Failed to load notifications:', error);
        showToast('Failed to load notifications', 'error');
        showEmptyState();
    }
}

function hasActiveFilters() {
    return !!(currentFilters.type || currentFilters.is_read || currentFilters.search);
}

function syncFilterUi() {
    const resetGroup = document.getElementById('filterResetGroup');
    if (resetGroup) resetGroup.style.display = hasActiveFilters() ? 'flex' : 'none';
    const typeFilter = document.getElementById('filterType');
    if (typeFilter) typeFilter.value = currentFilters.type || '';
    const readFilter = document.getElementById('filterRead');
    if (readFilter) readFilter.value = currentFilters.is_read || '';
    const searchInput = document.getElementById('globalSearch');
    if (searchInput && searchInput.value !== currentFilters.search) {
        searchInput.value = currentFilters.search || '';
    }
}

function resetNotificationFilters() {
    currentFilters = { type: '', is_read: '', search: '' };
    syncFilterUi();
    applyFiltersAndPaginate(1);
}

function applyFiltersAndPaginate(page) {
    const type = currentFilters.type;
    const isRead = currentFilters.is_read;
    const search = (currentFilters.search || '').toLowerCase().trim();

    filteredNotifications = allNotifications.filter(n => {
        const matchesType = !type || n.type === type;
        const isReadBool = n.is_read === true || n.is_read === 1 || n.is_read === '1';
        const matchesRead = isRead === ''
            || (isRead === 'unread' && !isReadBool)
            || (isRead === 'read' && isReadBool);
        const matchesSearch = !search
            || (n.title || '').toLowerCase().includes(search)
            || (n.message || '').toLowerCase().includes(search);
        return matchesType && matchesRead && matchesSearch;
    });

    totalPages = Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE));
    currentPage = Math.min(page, totalPages);
    syncFilterUi();
    renderNotifications();
    updatePagination();
}

function buildEmptyState() {
    const { type, is_read, search } = currentFilters;
    let title = 'No notifications match your filters';
    let subtext = 'Try changing your filter criteria.';

    if (is_read === 'unread' && !type && !search) {
        title = 'No unread notifications';
        subtext = "You're all caught up!";
    } else if (is_read === 'read' && !type && !search) {
        title = 'No read notifications';
        subtext = 'Nothing has been opened yet.';
    } else if (type && !is_read && !search) {
        const label = TYPE_LABELS[type] || type;
        title = `No ${label.toLowerCase()} notifications`;
        subtext = 'Try a different type.';
    } else if (search && !type && !is_read) {
        title = `No notifications matching "${escapeHtml(search)}"`;
        subtext = 'Try a shorter search term.';
    }
    return `
        <div class="notifications-empty">
            <span class="empty-icon">${DEFAULT_NOTIF_SVG}</span>
            <div class="empty-text">${title}</div>
            <div class="empty-subtext">${subtext}</div>
        </div>
    `;
}

function renderNotifications() {
    const container = document.getElementById('notificationsList');
    if (!container) return;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageNotifications = filteredNotifications.slice(start, start + PAGE_SIZE);

    if (pageNotifications.length === 0) {
        container.innerHTML = buildEmptyState();
        return;
    }

    container.innerHTML = pageNotifications.map(notification => {
        const type = notification.type || 'info';
        const svg = NOTIFICATION_SVG[type] || DEFAULT_NOTIF_SVG;
        const isRead = notification.is_read ? '' : 'unread';
        const time = formatRelativeTime(notification.created_at);
        const typeLabel = (TYPE_LABELS[type] || type).toUpperCase();

        // Only "Mark as read" is available; the delete button has been removed.
        let actions = '';
        if (!notification.is_read) {
            actions += `<button class="btn btn-sm btn-light" data-action="mark-read" data-id="${notification.id}" title="Mark as read">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg>
            </button>`;
        }

        return `
            <div class="notification-item ${isRead}" data-id="${notification.id}">
                <div class="notification-icon type-${type}">${svg}</div>
                <div class="notification-content">
                    <div class="notification-title">${escapeHtml(notification.title)}</div>
                    <div class="notification-message">${escapeHtml(notification.message)}</div>
                    <div class="notification-meta">
                        <span>${time}</span>
                        <span class="badge badge-${type === 'warning' ? 'warning' : type === 'error' ? 'danger' : 'info'}">${typeLabel}</span>
                    </div>
                </div>
                <div class="notification-actions">${actions}</div>
            </div>
        `;
    }).join('');

    // FIX: wire row + button clicks via addEventListener instead of inline
    // onclick attributes. The previous shape embedded notification.id
    // directly into inline handlers — safe today (numeric id), but the
    // delegated-listener pattern is uniform across the rest of the admin
    // pages and keeps the HTML and JS concerns separate.
    container.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', function (e) {
            if (e.target.closest('[data-action]')) return;
            if (!this.classList.contains('unread')) return;
            markRead(this.dataset.id);
        });
    });

    container.querySelectorAll('[data-action="mark-read"]').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            markRead(btn.getAttribute('data-id'));
        });
    });
}

function updatePagination() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filteredNotifications.length);
    document.getElementById('pageStart').textContent = filteredNotifications.length === 0 ? 0 : start + 1;
    document.getElementById('pageEnd').textContent = end;
    document.getElementById('totalRecords').textContent = filteredNotifications.length;

    const wrap = document.getElementById('paginationButtons');
    if (!wrap) return;
    wrap.innerHTML = '';

    const prev = document.createElement('button');
    prev.className = 'btn btn-sm btn-light';
    prev.textContent = '‹';
    prev.disabled = currentPage <= 1;
    prev.addEventListener('click', () => { currentPage--; renderNotifications(); updatePagination(); });
    wrap.appendChild(prev);

    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    startPage = Math.max(1, endPage - maxButtons + 1);

    for (let p = startPage; p <= endPage; p++) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm ' + (p === currentPage ? 'btn-primary' : 'btn-light');
        btn.textContent = p;
        btn.addEventListener('click', () => { currentPage = p; renderNotifications(); updatePagination(); });
        wrap.appendChild(btn);
    }

    const next = document.createElement('button');
    next.className = 'btn btn-sm btn-light';
    next.textContent = '›';
    next.disabled = currentPage >= totalPages;
    next.addEventListener('click', () => { currentPage++; renderNotifications(); updatePagination(); });
    wrap.appendChild(next);
}

function updateBadge(count) {
    const badge = document.getElementById('notificationBadgeNav');
    if (badge) badge.textContent = count > 99 ? '99+' : count;
}

function showEmptyState() {
    const container = document.getElementById('notificationsList');
    if (container) container.innerHTML = `<div class="notifications-empty"><span class="empty-icon">${DEFAULT_NOTIF_SVG}</span><div class="empty-text">No notifications</div></div>`;
}

// ============================================================
// FIX: student selection — normalize ids to strings.
//
// selectedStudentIds is a Set; Set.has() uses strict equality, so
// mixing numeric ids from JSON with string ids from checkbox values
// would silently fail. All three call sites (add, has, Array.from)
// now consistently use String form.
// ============================================================
async function loadStudentsForSelection() {
    const listContainer = document.getElementById('studentSelectionList');
    if (!listContainer) return;
    const course = document.getElementById('filterStudentCourse').value;
    const year = document.getElementById('filterStudentYear').value;
    listContainer.innerHTML = '<p class="text-muted">Loading students...</p>';
    try {
        const params = { limit: 1000 };
        if (course) params.course = course;
        if (year) params.year_level = year;
        const res = await api.getStudents(params);
        if (res.success) {
            const students = res.data || [];
            if (students.length === 0) {
                listContainer.innerHTML = '<p class="text-muted">No students match these filters.</p>';
                return;
            }
            listContainer.innerHTML = students.map(s => {
                const fullName = `${s.first_name} ${s.middle_name ? s.middle_name + ' ' : ''}${s.last_name}`;
                const idStr = String(s.id);
                const isChecked = selectedStudentIds.has(idStr) ? 'checked' : '';
                return `
                    <div class="form-check">
                        <input class="form-check-input student-checkbox" type="checkbox" value="${idStr}" id="student_${idStr}" ${isChecked}>
                        <label class="form-check-label" for="student_${idStr}">
                            ${escapeHtml(fullName)} <span class="text-muted">(${escapeHtml(s.student_id || '')})</span>
                        </label>
                    </div>
                `;
            }).join('');
            listContainer.querySelectorAll('.student-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', function() {
                    const id = String(this.value);
                    if (this.checked) selectedStudentIds.add(id);
                    else selectedStudentIds.delete(id);
                });
            });
        }
    } catch (error) { listContainer.innerHTML = '<p class="text-danger">Failed to load students.</p>'; }
}

async function loadPersonalStudentList() {
    const sel = document.getElementById('personalStudentId');
    if (!sel) return;
    const course = document.getElementById('personalStudentCourse').value;
    const year = document.getElementById('personalStudentYear').value;
    sel.innerHTML = '<option value="">Loading students…</option>';
    try {
        const params = { limit: 1000 };
        if (course) params.course = course;
        if (year) params.year_level = year;
        const res = await api.getStudents(params);
        if (res.success) {
            const students = res.data || [];
            if (students.length === 0) { sel.innerHTML = '<option value="">No students match these filters</option>'; return; }
            sel.innerHTML = '<option value="">Select a student…</option>' + students.map(s => {
                const fullName = `${s.first_name} ${s.middle_name ? s.middle_name + ' ' : ''}${s.last_name}`.trim();
                return `<option value="${s.id}">${escapeHtml(fullName)} — ${escapeHtml(s.student_id || '')}</option>`;
            }).join('');
        }
    } catch (error) { sel.innerHTML = '<option value="">Failed to load students</option>'; }
}

function selectAnnouncementType(value) {
    document.querySelectorAll('.announcement-type-card').forEach(card => {
        const isMatch = card.dataset.value === value;
        card.classList.toggle('selected', isMatch);
        card.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });
    const hidden = document.getElementById('recipientType');
    if (hidden) hidden.value = value;
    document.getElementById('lowHoursSection').style.display = value === 'low_hours' ? 'block' : 'none';
    document.getElementById('personalStudentSection').style.display = value === 'Student' ? 'block' : 'none';
    document.getElementById('specificStudentsSection').style.display = value === 'specific_students' ? 'block' : 'none';
    if (value === 'specific_students') loadStudentsForSelection();
    if (value === 'Student') loadPersonalStudentList();
}

function selectMessageType(value) {
    document.querySelectorAll('.message-type-btn').forEach(btn => {
        const isMatch = btn.dataset.value === value;
        btn.classList.toggle('selected', isMatch);
        btn.setAttribute('aria-checked', isMatch ? 'true' : 'false');
    });
    const hidden = document.getElementById('notificationType');
    if (hidden) hidden.value = value;
}

function setupEventListeners() {
    const typeFilter = document.getElementById('filterType');
    if (typeFilter) typeFilter.addEventListener('change', function(e) { currentFilters.type = e.target.value; applyFiltersAndPaginate(1); });
    const readFilter = document.getElementById('filterRead');
    if (readFilter) readFilter.addEventListener('change', function(e) { currentFilters.is_read = e.target.value; applyFiltersAndPaginate(1); });
    const globalSearch = document.getElementById('globalSearch');
    if (globalSearch) globalSearch.addEventListener('input', function(e) { currentFilters.search = e.target.value; applyFiltersAndPaginate(1); });
    const sendForm = document.getElementById('sendNotificationForm');
    if (sendForm) sendForm.addEventListener('submit', async function(e) { e.preventDefault(); await sendNotification(this); });
    document.querySelectorAll('.announcement-type-card').forEach(card => {
        card.addEventListener('click', () => selectAnnouncementType(card.dataset.value));
    });
    document.querySelectorAll('.message-type-btn').forEach(btn => {
        btn.addEventListener('click', () => selectMessageType(btn.dataset.value));
    });
    const studentCourse = document.getElementById('filterStudentCourse');
    if (studentCourse) studentCourse.addEventListener('change', loadStudentsForSelection);
    const studentYear = document.getElementById('filterStudentYear');
    if (studentYear) studentYear.addEventListener('change', loadStudentsForSelection);
    const personalCourse = document.getElementById('personalStudentCourse');
    if (personalCourse) personalCourse.addEventListener('change', loadPersonalStudentList);
    const personalYear = document.getElementById('personalStudentYear');
    if (personalYear) personalYear.addEventListener('change', loadPersonalStudentList);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeAllModals(); });
}

// ============================================================
// REAL-TIME LISTENERS
// ============================================================
/**
 * The sidebar owns the EventSource and dispatches `realtime:notification`
 * on window for every notification it receives.
 *
 * FIX: dedupe by (id, created_at) rather than id alone. If the sidebar's
 * SSE ever re-emits a notification (reconnect resets Last-Event-ID and
 * the server replays the last N), an id-only check would happily unshift
 * a duplicate — inflating the unread badge and duplicating the row until
 * the next 60 s full refetch. The composite key makes dedupe robust
 * against replays, including the edge case where the server assigns a
 * new row id on each poll.
 */
function setupRealtimeListeners() {
    window.addEventListener('realtime:notification', (e) => {
        const n = e.detail;
        if (!n || !n.id) return;

        const key = `${n.id}|${n.created_at || ''}`;
        const isDuplicate = allNotifications.some(x =>
            `${x.id}|${x.created_at || ''}` === key
        );
        if (isDuplicate) return;

        allNotifications.unshift(n);
        unreadCount += 1;
        updateBadge(unreadCount);
        applyFiltersAndPaginate(currentPage);

        if (typeof showToast === 'function') {
            const label = TYPE_LABELS[n.type] || 'Notification';
            showToast(`${label}: ${n.title || 'New notification'}`, 'info');
        }
    });

    window.addEventListener('realtime:concern', () => {
        if (typeof window.refreshSidebarConcerns === 'function') {
            window.refreshSidebarConcerns();
        }
    });
}

async function markRead(id) {
    // FIX: validate id before firing — an empty or missing id would
    // produce a malformed URL like /notifications//read and 404.
    if (id === null || id === undefined || id === '') return;

    try {
        const res = await api.markNotificationRead(id);
        if (res.success) {
            const item = document.querySelector(`.notification-item[data-id="${id}"]`);
            if (item) {
                item.classList.remove('unread');
                const btn = item.querySelector('[data-action="mark-read"]');
                if (btn) btn.remove();
            }
            unreadCount = Math.max(0, unreadCount - 1);
            updateBadge(unreadCount);
            showToast('Notification marked as read', 'success');
            if (typeof window.refreshSidebarNotifications === 'function') window.refreshSidebarNotifications();
        } else {
            showToast(res.message || 'Failed to mark as read', 'error');
        }
    } catch (err) { showToast(err.message || 'Failed to mark as read', 'error'); }
}

async function markAllRead() {
    if (unreadCount === 0) { showToast('There are no unread notifications to mark as read.', 'info'); return; }
    if (!confirm('Mark all notifications as read?')) return;
    try {
        const res = await api.markAllNotificationsRead();
        if (res.success) {
            const updated = (res.data && res.data.updated) || 0;
            showToast(updated > 0 ? `Marked ${updated} notification(s) as read.` : 'No unread notifications.', 'success');
            await loadNotifications();
            if (typeof window.refreshSidebarNotifications === 'function') window.refreshSidebarNotifications();
        } else {
            showToast(res.message || 'Failed to mark all as read', 'error');
        }
    } catch (err) { showToast(err.message || 'Failed to mark all as read', 'error'); }
}

// ============================================================
// SEND NOTIFICATION MODAL
// ============================================================
// FIX: the old reset left several filter selects and the personal
// student list populated from the previous session — reopening the
// modal showed stale Department/Year filters and stale student options.
// Now every piece of state the modal owns is reset.
function sendNotificationModal() {
    const form = document.getElementById('sendNotificationForm');
    if (form) form.reset();

    selectedStudentIds.clear();

    document.querySelectorAll('.announcement-type-card').forEach(card => {
        card.classList.remove('selected');
        card.setAttribute('aria-checked', 'false');
    });

    const recipientTypeEl = document.getElementById('recipientType');
    if (recipientTypeEl) recipientTypeEl.value = '';

    ['specificStudentsSection', 'lowHoursSection', 'personalStudentSection'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Reset the personal-student picker and its filters.
    const personalSel = document.getElementById('personalStudentId');
    if (personalSel) personalSel.innerHTML = '<option value="">Select a student…</option>';
    const personalCourse = document.getElementById('personalStudentCourse');
    if (personalCourse) personalCourse.value = '';
    const personalYear = document.getElementById('personalStudentYear');
    if (personalYear) personalYear.value = '';

    // Reset the group-announcement picker and its filters.
    const groupList = document.getElementById('studentSelectionList');
    if (groupList) groupList.innerHTML = '<p class="text-muted">Select a Department and Year to load students, or leave blank to show all.</p>';
    const groupCourse = document.getElementById('filterStudentCourse');
    if (groupCourse) groupCourse.value = '';
    const groupYear = document.getElementById('filterStudentYear');
    if (groupYear) groupYear.value = '';

    const threshold = document.getElementById('hoursThreshold');
    if (threshold) threshold.value = '1';

    selectMessageType('info');
    document.getElementById('sendNotificationModal').classList.add('show');
}

// ============================================================
// VALIDATION
// Server is still authoritative; this catches obvious garbage before
// the round trip and gives the admin fast feedback.
// ============================================================
function validateNotificationPayload(payload) {
    const errors = [];

    // --- title ---
    if (!payload.title) {
        errors.push('Title is required.');
    } else if (payload.title.length > TITLE_MAX_LENGTH) {
        errors.push(`Title must be ${TITLE_MAX_LENGTH} characters or fewer (currently ${payload.title.length}).`);
    }

    // --- message ---
    if (!payload.message) {
        errors.push('Message is required.');
    } else if (payload.message.length > MESSAGE_MAX_LENGTH) {
        errors.push(`Message must be ${MESSAGE_MAX_LENGTH} characters or fewer (currently ${payload.message.length}).`);
    }

    // --- type ---
    const allowedTypes = ['info', 'warning', 'success', 'error', 'reservation', 'session', 'update', 'system', 'concern'];
    if (payload.type && !allowedTypes.includes(payload.type)) {
        errors.push('Invalid message type.');
    }

    // --- recipient-specific ---
    if (payload.recipient_type === 'specific_students') {
        if (!Array.isArray(payload.student_ids) || payload.student_ids.length === 0) {
            errors.push('Please select at least one student.');
        }
    } else if (payload.recipient_type === 'low_hours') {
        const t = payload.hours_threshold;
        if (typeof t !== 'number' || !isFinite(t) || t < 0) {
            errors.push('Please enter a valid threshold (0 or greater).');
        } else if (t > 100) {
            errors.push('Threshold must be 100 hours or less.');
        }
    } else if (payload.recipient_type === 'Student') {
        if (!payload.recipient_id) {
            errors.push('Please select a student for this personal announcement.');
        }
    } else if (payload.recipient_type !== 'all' && payload.recipient_type !== 'students') {
        errors.push('Please select an announcement type.');
    }

    return errors;
}

async function sendNotification(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const recipient = data.recipient_type;

    // Build the payload up front so validation can inspect it whole.
    const payload = {
        recipient_type: recipient,
        title: (data.title || '').trim(),
        message: (data.message || '').trim(),
        type: data.type || 'info'
    };

    if (recipient === 'specific_students') {
        payload.student_ids = Array.from(selectedStudentIds);
    } else if (recipient === 'low_hours') {
        const thresholdRaw = document.getElementById('hoursThreshold').value;
        const threshold = parseFloat(thresholdRaw);
        payload.hours_threshold = Number.isFinite(threshold) ? threshold : NaN;
    } else if (recipient === 'Student') {
        const recipientIdRaw = document.getElementById('personalStudentId').value;
        payload.recipient_id = recipientIdRaw ? parseInt(recipientIdRaw, 10) : null;
    }

    // ---- Run validation ----
    const errors = validateNotificationPayload(payload);
    if (errors.length) {
        showToast(errors[0], 'warning');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const res = await api.sendNotification(payload);
        if (res.success) {
            const sent = res.data && res.data.sent !== undefined ? res.data.sent : null;
            let successMsg = 'Notification sent successfully.';
            if (sent !== null) {
                successMsg = sent === 0 ? 'Nothing to send — no matching recipients.' : `Notification sent to ${sent} recipient(s).`;
            }
            showToast(successMsg, sent === 0 ? 'info' : 'success');
            closeModal('sendNotificationModal');
            await loadNotifications();
            if (typeof window.refreshSidebarNotifications === 'function') window.refreshSidebarNotifications();
        } else {
            showToast(res.message || 'Failed to send notification', 'error');
        }
    } catch (err) {
        showToast(err.message || 'Failed to send notification', 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

function startAutoRefresh() {
    // Fallback refresh — SSE is the primary mechanism, this reconciles
    // unread counts and edits made from another tab.
    setInterval(() => { loadNotifications(); }, 60000);
}

// ============================================================
// FIX: guard against unparseable date strings.
//
// Previously `new Date('garbage')` produced an Invalid Date, every
// comparison against `now - date` was NaN (all false), and the final
// `date.toLocaleDateString()` rendered the literal string
// "Invalid Date" in the UI. Now we return an empty string in that
// case and let the row render without a timestamp.
// ============================================================
function formatRelativeTime(dateString) {
    if (!dateString) return 'Just now';
    const date = new Date(String(dateString).replace(' ', 'T'));
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 0) return 'Just now';           // clock skew tolerance
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
}

window.markRead = markRead;
window.markAllRead = markAllRead;
window.sendNotificationModal = sendNotificationModal;
window.resetNotificationFilters = resetNotificationFilters;
window.closeModal = closeModal;
window.closeAllModals = closeAllModals;