// frontend/student/js/notifications.js
/**
 * Wired to GET /notifications, GET /notifications/unread-count,
 * PATCH /notifications/{id}/read, PATCH /notifications/read-all.
 *
 * Real-time: the shared sidebar.js keeps one SSE connection per tab and
 * dispatches `realtime:notification` on window. We listen for it and
 * prepend the row to the list without a full reload.
 */

let allNotifications = [];
let currentFilter = 'all';

const GENERIC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

const TYPE_ICONS = {
    info:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
    success:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.3 2.3 4.7-5"/></svg>`,
    warning:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
    error:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>`,
    reservation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
    session:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    update:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>`,
    concern:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>`,
    system:      GENERIC_ICON
};

function iconFor(type) { return TYPE_ICONS[type] || GENERIC_ICON; }

function paintChrome() {
    refreshChrome();
}

async function loadSidebarHours() {
    try {
        const res = await api.getDashboard();
        if (res.success && res.data && res.data.student) {
            paintSidebarHours(res.data.student.used_hours, res.data.student.remaining_hours);
        }
    } catch (err) {
        console.warn('[notifications] Could not load semester hours:', err);
    }
}

function updateTabCounts() {
    const unread = allNotifications.filter((n) => !Number(n.is_read)).length;
    const total = allNotifications.length;

    const allEl = document.getElementById('count-all');
    if (allEl) {
        allEl.textContent = String(total);
        allEl.dataset.count = String(total);
    }
    const unreadEl = document.getElementById('count-unread');
    if (unreadEl) {
        unreadEl.textContent = String(unread);
        unreadEl.dataset.count = String(unread);
    }
}

function updateBadge(count) {
    const badge = byId('notificationBadgeNav');
    if (badge) badge.textContent = count > 99 ? '99+' : String(count);
}

function renderNotifications() {
    const list = currentFilter === 'unread'
        ? allNotifications.filter((n) => !Number(n.is_read))
        : allNotifications;
    const container = byId('notification-list');
    if (!container) return;

    updateTabCounts();

    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">${GENERIC_ICON}</span>
                <h3>${currentFilter === 'unread' ? "You're all caught up" : 'No notifications yet'}</h3>
                <p>${currentFilter === 'unread' ? 'No unread notifications right now.' : "We'll let you know about reservations and requests here."}</p>
            </div>`;
        return;
    }

    container.innerHTML = list.map((n) => `
        <div class="notification-item ${Number(n.is_read) ? '' : 'unread'}"
             data-id="${n.id}"
             data-type="${escapeHtml(n.type || 'info')}">
            <div class="icon">${iconFor(n.type)}</div>
            <div class="content">
                <div class="title">${escapeHtml(n.title || '')}</div>
                <div class="message">${escapeHtml(n.message || '')}</div>
                <div class="time">${getRelativeTime(n.created_at)}</div>
            </div>
            ${Number(n.is_read) ? '' : '<div class="badge-dot"></div>'}
        </div>
    `).join('');

    qsa('.notification-item.unread', container).forEach((row) => {
        onClick(row, async () => {
            const id = Number(row.dataset.id);
            try {
                await api.markNotificationRead(id);
                const n = allNotifications.find((x) => Number(x.id) === id);
                if (n) n.is_read = 1;
                renderNotifications();
                const unread = allNotifications.filter((x) => !Number(x.is_read)).length;
                updateBadge(unread);
                if (typeof window.refreshSidebarNotifications === 'function') {
                    window.refreshSidebarNotifications();
                }
            } catch (err) {
                console.error('Mark read failed:', err);
            }
        });
    });
}

async function loadNotifications() {
    try {
        const res = await api.getNotifications();
        if (res.success) {
            allNotifications = res.data || [];
            const unread = allNotifications.filter((n) => !Number(n.is_read)).length;
            updateBadge(unread);
            renderNotifications();
        } else {
            throw new Error(res.message || 'Failed to load notifications');
        }
    } catch (err) {
        console.error('Load failed:', err);
        const container = byId('notification-list');
        if (container) {
            container.innerHTML = `<div class="empty-state"><p>Failed to load notifications. ${escapeHtml(err.message || '')}</p></div>`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!sessionManager.requireRole('student')) return;

    paintChrome();

    if (!sessionManager.getUserName()) {
        api.getProfile().then((res) => {
            if (res.success && res.data) {
                const merged = { ...(sessionManager.getUser() || {}), ...res.data };
                sessionManager.api.setAuth(sessionManager.token, merged);
                paintChrome();
            }
        }).catch(() => {});
    }

    qsa('.notif-tab').forEach((tab) => {
        onClick(tab, () => {
            qsa('.notif-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderNotifications();
        });
    });

    onClick('mark-all-read', async () => {
        try {
            const res = await api.markAllNotificationsRead();
            if (res.success) {
                allNotifications.forEach((n) => { n.is_read = 1; });
                updateBadge(0);
                renderNotifications();
                showToast('success', 'Done', 'All notifications marked as read.');
                if (typeof window.refreshSidebarNotifications === 'function') {
                    window.refreshSidebarNotifications();
                }
            } else {
                showToast('error', 'Failed', res.message || 'Could not mark all as read.');
            }
        } catch (err) {
            showToast('error', 'Failed', err.message || 'Could not mark all as read.');
        }
    });

    onClick('logoutBtn', () => { if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navLogoutLink', (e) => { e.preventDefault(); if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navbarToggler', () => { if (window.sidebar) window.sidebar.open(); });

    // ============================================================
    // REAL-TIME
    // ============================================================
    window.addEventListener('realtime:notification', (e) => {
        const n = e.detail;
        if (!n || !n.id) return;

        if (allNotifications.some((x) => String(x.id) === String(n.id))) return;

        allNotifications.unshift(n);

        const unread = allNotifications.filter((x) => !Number(x.is_read)).length;
        updateBadge(unread);
        renderNotifications();

        if (typeof showToast === 'function') {
            showToast('info', 'New notification', n.title || '');
        }
    });

    loadNotifications();
    loadSidebarHours();
});