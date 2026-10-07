// frontend/admin/js/dashboard.js
document.addEventListener('DOMContentLoaded', function() {

    if (!sessionManager.requireRole('admin')) return;

    initializeDashboard();
    setupEventListeners();
    startAutoRefresh();
});

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
    const fallbackHtml = `<div style='width:${size}px; height:${size}px; border-radius:50%; background:#2b2d82; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:${Math.round(size/2.5)}px; overflow:hidden;'>${initials}</div>`;
    if (!photoUrl) return fallbackHtml;
    const resolvedUrl = resolvePhotoUrl(photoUrl);
    if (!resolvedUrl) return fallbackHtml;
    return `<img src="${resolvedUrl}" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; display:block; flex-shrink:0;" onerror="this.outerHTML='${fallbackHtml.replace(/'/g, "\\'")}';">`;
}

// ============================================================
// RESERVATION HELPERS
// Same rules as reservation-management.js so both pages always
// agree on what is Pending and what is Overdue.
// (Names are prefixed so they don't clash with shared/js/helpers.js.)
// ============================================================

/** Parses "YYYY-MM-DD" (or "YYYY-MM-DD HH:MM:SS" / ISO) as a LOCAL date at midnight. */
function parseResDate(dateStr) {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
    if (m) {
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The status the admin should SEE.
 *  - Only Pending and Approved can become Overdue.
 *  - Date before today                 -> Overdue
 *  - Today, but end_time has passed    -> Overdue
 */
function getEffectiveReservationStatus(reservation) {
    if (!reservation) return 'Unknown';
    const rawStatus = reservation.status || '';
    if (rawStatus !== 'Pending' && rawStatus !== 'Approved') return rawStatus;

    const resDate = parseResDate(reservation.reservation_date);
    if (!resDate) return rawStatus;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (resDate.getTime() < today.getTime()) return 'Overdue';

    if (resDate.getTime() === today.getTime() && reservation.end_time) {
        const parts = String(reservation.end_time).split(':');
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!isNaN(h) && !isNaN(m)) {
            const endDateTime = new Date(resDate);
            endDateTime.setHours(h, m, 0, 0);
            if (now.getTime() > endDateTime.getTime()) return 'Overdue';
        }
    }
    return rawStatus;
}

function getReservationStudentName(r) {
    if (!r) return 'Unknown';

    const direct = r.student_name || r.student_full_name || r.full_name || r.name;
    if (direct) return direct;

    const fromFlatParts = [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ').trim();
    if (fromFlatParts) return fromFlatParts;

    const student = r.student || r.student_info || null;
    if (student) {
        const nested = student.full_name || student.name ||
            [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ').trim();
        if (nested) return nested;
    }
    return 'Unknown';
}

function formatReservationComputer(r) {
    const raw = r && (r.computer_number ?? r.computer_name);
    if (!raw) return 'Unknown';
    const str = String(raw).trim();
    return /^pc-/i.test(str) ? str : `PC-${str}`;
}

function formatReservationDate(dateStr) {
    const d = parseResDate(dateStr);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Adds the display fields the dashboard needs while keeping the raw fields
// (status, reservation_date, end_time) so overdue checks keep working.
function normalizeReservation(r) {
    return Object.assign({}, r, {
        status: r.status || 'Pending',
        student_name: getReservationStudentName(r),
        computer_number: formatReservationComputer(r)
    });
}

async function initializeDashboard() {
    try {
        await updateUserInfo();
        await loadDashboardData();
        updateClock();
        setInterval(updateClock, 1000);

        const user = sessionManager.getUser();
        if (user) {
            document.getElementById('welcomeName').textContent = user.full_name || user.username || 'Admin';
        }
    } catch (error) {
        console.error('Dashboard initialization error:', error);
        showToast('Failed to load dashboard data', 'error');
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
    } catch (err) {
        console.warn('Failed to fetch fresh profile:', err);
    }

    const sidebarNameEl = document.getElementById('sidebarUserName');
    const sidebarAvatarEl = document.getElementById('sidebarUserAvatar');
    const sidebarRoleEl = document.getElementById('sidebarUserRole');
    if (sidebarNameEl) sidebarNameEl.textContent = userName;
    if (sidebarAvatarEl) sidebarAvatarEl.innerHTML = createAvatarHtml(photoUrl, initial, 40);
    if (sidebarRoleEl && user.role) {
        sidebarRoleEl.textContent = 'Admin';
    }

    const navNameEl = document.getElementById('userNameNav');
    const navAvatarEl = document.getElementById('userAvatarNav');
    if (navNameEl) navNameEl.textContent = userName;
    if (navAvatarEl) navAvatarEl.innerHTML = createAvatarHtml(photoUrl, initial, 36);
}

window.__dashboardData = { computers: [], sessions: [], reservations: [], activities: [] };

// The global is cleared at the top of every load so the state always
// matches the response we're about to process.
async function loadDashboardData() {
    window.__dashboardData = { computers: [], sessions: [], reservations: [], activities: [] };

    try {
        const response = await api.getDashboard();

        if (response.success) {
            const data = response.data;

            if (data.computers) updateComputerStatus(data.computers);
            if (data.activeSessions) updateActiveSessions(data.activeSessions);

            // Pending reservations come from the same source as the Reservations
            // page, with overdue ones removed. The dashboard payload is only
            // used as a fallback if that request fails.
            await loadPendingReservations(data.pendingReservations);

            if (data.recentActivity) updateActivityFeed(data.recentActivity);
            if (data.stats) updateStats(data.stats);

            const lastUpdatedEl = document.getElementById('lastUpdated');
            if (lastUpdatedEl) {
                lastUpdatedEl.textContent = `Last updated: ${formatDateTime(new Date())}`;
            }
        }
    } catch (error) {
        console.error('Failed to load dashboard:', error);
        throw error;
    }
}

function updateStats(stats) {
    if (!stats) return;

    document.getElementById('statStudents').textContent = stats.totalStudents || 0;
    document.getElementById('statComputers').textContent = stats.totalComputers || 0;
    document.getElementById('statActiveSessions').textContent = stats.activeSessions || 0;

    const studentsChange = document.getElementById('statStudentsChange');
    if (stats.activeStudents !== undefined) {
        studentsChange.textContent = `Active: ${stats.activeStudents}`;
    }

    // Pending count is always the filtered list (overdue excluded), never the
    // raw backend number, so the card matches the table and the Reservations page.
    setPendingReservationsCount(window.__dashboardData.reservations.length);

    const computersChange = document.getElementById('statComputersChange');
    if (stats.availableComputers !== undefined) {
        computersChange.textContent = `Available: ${stats.availableComputers}`;
        computersChange.className = 'stat-change';
        if (stats.availableComputers > 0) {
            computersChange.classList.add('positive');
        }
    }
}

function setPendingReservationsCount(count) {
    const el = document.getElementById('statPendingReservations');
    if (el) el.textContent = count;
}

function updateComputerStatus(computers) {
    window.__dashboardData.computers = computers || [];

    const container = document.getElementById('computerStatus');
    if (!container) return;

    container.innerHTML = '';

    if (!computers || computers.length === 0) {
        container.innerHTML = '<div class="text-center text-muted" style="grid-column: 1/-1; padding: var(--spacing-xl);">No computers available</div>';
        return;
    }

    computers.forEach(computer => {
        const statusClass = `status-${String(computer.status || '').toLowerCase()}`;
        const statusLabel = String(computer.status || '').toUpperCase();

        const div = document.createElement('div');
        div.className = `computer-card ${statusClass}`;
        div.innerHTML = `
            <div class="computer-number">${escapeHtml(computer.computer_number)}</div>
            <div class="computer-status">${escapeHtml(statusLabel)}</div>
            ${computer.current_user ? `<div class="computer-user">${escapeHtml(computer.current_user)}</div>` : ''}
            ${computer.computer_name ? `<div class="computer-location">${escapeHtml(computer.computer_name)}</div>` : ''}
        `;

        div.addEventListener('click', () => {
            if (computer.status === 'Occupied') showComputerDetails(computer);
        });

        container.appendChild(div);
    });
}

function formatTimeOnly(value) {
    if (!value) return '—';
    const bareTimeMatch = /^(\d{1,2}):(\d{2})(:(\d{2}))?$/.exec(String(value).trim());
    if (bareTimeMatch) {
        const h = parseInt(bareTimeMatch[1], 10);
        const m = bareTimeMatch[2];
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        return `${hour12}:${m} ${ampm}`;
    }
    return formatTime(value);
}

function updateActiveSessions(sessions) {
    window.__dashboardData.sessions = sessions || [];

    const tbody = document.querySelector('#activeSessionsTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!sessions || sessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No active sessions</td></tr>`;
        return;
    }

    sessions.forEach(session => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(session.student_name)}</strong></td>
            <td>${escapeHtml(String(session.computer_number || ''))}</td>
            <td>${escapeHtml(formatTimeOnly(session.start_time))}</td>
            <td>${escapeHtml(formatDuration(session.duration))}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ===== PENDING RESERVATIONS =====
// Only reservations that are Pending AND still current (not overdue) are shown:
// these are the ones the admin can still approve or reject.
async function loadPendingReservations(fallbackList) {
    let list = null;

    try {
        const res = await api.getReservations();
        if (res && res.success) {
            list = (res.data || [])
                .filter(r => r.status === 'Pending')
                .map(normalizeReservation);
        }
    } catch (err) {
        console.warn('Failed to load reservations, using dashboard payload:', err);
    }

    if (list === null) {
        list = (fallbackList || []).map(normalizeReservation);
    }

    // Drop overdue ones, then show the soonest first.
    list = list
        .filter(r => getEffectiveReservationStatus(r) === 'Pending')
        .sort((a, b) => {
            const dateCmp = String(a.reservation_date || '').localeCompare(String(b.reservation_date || ''));
            if (dateCmp !== 0) return dateCmp;
            return String(a.start_time || '').localeCompare(String(b.start_time || ''));
        });

    updatePendingReservations(list);
    setPendingReservationsCount(list.length);
}

function updatePendingReservations(reservations) {
    window.__dashboardData.reservations = reservations || [];

    const tbody = document.querySelector('#pendingReservationsTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!reservations || reservations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No pending reservations</td></tr>`;
        return;
    }

    reservations.forEach(reservation => {
        const dateLabel = formatReservationDate(reservation.reservation_date);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(reservation.student_name)}</strong></td>
            <td>${escapeHtml(String(reservation.computer_number || ''))}</td>
            <td>
                ${escapeHtml(formatTimeOnly(reservation.start_time))} - ${escapeHtml(formatTimeOnly(reservation.end_time))}
                ${dateLabel ? `<div class="text-muted" style="font-size:0.8em;">${escapeHtml(dateLabel)}</div>` : ''}
            </td>
            <td>
                <button class="btn btn-sm btn-info" data-action="view-reservation" data-id="${reservation.id}" title="View">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" style="vertical-align:-2px; margin-right:2px;"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    View
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('[data-action="view-reservation"]').forEach(btn => {
        btn.addEventListener('click', () => viewPendingReservation(Number(btn.getAttribute('data-id'))));
    });
}

function findPendingReservation(id) {
    return (window.__dashboardData.reservations || []).find(r => Number(r.id) === Number(id));
}

// A reservation can go overdue while it's sitting on screen. If that happened,
// don't allow the action and refresh the list so it disappears.
function blockIfReservationOverdue(id) {
    const res = findPendingReservation(id);
    if (res && getEffectiveReservationStatus(res) === 'Overdue') {
        showToast('This reservation is already overdue and can no longer be approved or rejected.', 'warning');
        closeDashboardReservationModal();
        loadDashboardData();
        return true;
    }
    return false;
}

// ===== PENDING RESERVATION MODAL =====
function viewPendingReservation(id) {
    if (blockIfReservationOverdue(id)) return;

    const res = findPendingReservation(id);
    if (!res) return;

    const dateLabel = formatReservationDate(res.reservation_date);

    const detailsEl = document.getElementById('dashboardReservationDetails');
    if (detailsEl) {
        detailsEl.innerHTML = `
            <p><strong>Student:</strong> ${escapeHtml(res.student_name || 'Unknown')}</p>
            <p><strong>Computer:</strong> ${escapeHtml(String(res.computer_number || 'Unknown'))}</p>
            ${dateLabel ? `<p><strong>Date:</strong> ${escapeHtml(dateLabel)}</p>` : ''}
            <p><strong>Time:</strong> ${escapeHtml(formatTimeOnly(res.start_time))} - ${escapeHtml(formatTimeOnly(res.end_time))}</p>
        `;
    }

    const footer = document.getElementById('dashboardReservationModalFooter');
    if (footer) {
        footer.innerHTML = `
            <button class="btn btn-secondary" onclick="closeDashboardReservationModal()">Close</button>
            <button class="btn btn-danger" onclick="rejectReservation(${res.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" style="vertical-align:-2px; margin-right:2px;"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
                Reject
            </button>
            <button class="btn btn-success" onclick="approveReservation(${res.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" style="vertical-align:-2px; margin-right:2px;"><path d="M20 6 9 17l-5-5"/></svg>
                Approve
            </button>
        `;
    }

    const modal = document.getElementById('dashboardReservationModal');
    if (modal) modal.classList.add('show');
}

function closeDashboardReservationModal() {
    const modal = document.getElementById('dashboardReservationModal');
    if (modal) modal.classList.remove('show');
}

function updateActivityFeed(activities) {
    window.__dashboardData.activities = activities || [];

    const container = document.getElementById('activityFeed');
    if (!container) return;

    container.innerHTML = '';

    if (!activities || activities.length === 0) {
        container.innerHTML = '<div class="text-center text-muted">No recent activity</div>';
        return;
    }

    const iconMap = {
        'login': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="10" width="14" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>', class: 'icon-blue' },
        'logout': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="10" width="14" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 6.6-3"/></svg>', class: 'icon-blue' },
        'reservation': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/></svg>', class: 'icon-gold' },
        'session_start': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>', class: 'icon-green' },
        'session_end': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="1.5"/></svg>', class: 'icon-red' },
        'update': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', class: 'icon-blue' },
        'delete': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16"/><path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/></svg>', class: 'icon-red' },
        'create': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>', class: 'icon-green' },
        'approve': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6 9 17l-5-5"/></svg>', class: 'icon-success' },
        'reject': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>', class: 'icon-danger' }
    };
    const defaultIcon = { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="1.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>', class: 'icon-blue' };

    activities.slice(0, 10).forEach(activity => {
        const iconInfo = iconMap[activity.type] || defaultIcon;
        const div = document.createElement('div');
        div.className = 'activity-item';
        div.innerHTML = `
            <div class="activity-icon ${iconInfo.class}">${iconInfo.svg}</div>
            <div class="activity-content">
                <div class="activity-text">${escapeHtml(activity.message)}</div>
                <div class="activity-time">${escapeHtml(getRelativeTime(activity.created_at))}</div>
            </div>
        `;
        container.appendChild(div);
    });
}

function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const el = document.getElementById('currentTime');
    if (el) el.textContent = timeString;
}

async function refreshDashboard() {
    try {
        await loadDashboardData();
        showToast('Dashboard refreshed', 'success');
    } catch (error) {
        showToast('Failed to refresh dashboard', 'error');
    }
}

async function refreshComputers() {
    try {
        const response = await api.getComputers();
        if (response.success) {
            updateComputerStatus(response.data);
            showToast('Computer status refreshed', 'success');
        }
    } catch (error) {
        showToast('Failed to refresh computers', 'error');
    }
}

async function approveReservation(id) {
    if (blockIfReservationOverdue(id)) return;
    if (!confirm('Approve this reservation?')) return;
    try {
        const response = await api.approveReservation(id);
        if (response.success) {
            showToast('Reservation approved successfully', 'success');
            closeDashboardReservationModal();
            await loadDashboardData();
        } else {
            showToast(response.message || 'Failed to approve reservation', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to approve reservation', 'error');
    }
}

async function rejectReservation(id) {
    if (blockIfReservationOverdue(id)) return;
    if (!confirm('Reject this reservation?')) return;
    try {
        const response = await api.rejectReservation(id);
        if (response.success) {
            showToast('Reservation rejected', 'success');
            closeDashboardReservationModal();
            await loadDashboardData();
        } else {
            showToast(response.message || 'Failed to reject reservation', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to reject reservation', 'error');
    }
}

function showComputerDetails(computer) {
    showToast(`Computer ${computer.computer_number}: ${computer.current_user}`, 'info');
}

function viewAllComputers() { window.location.href = 'computer-management.html'; }
function viewAllSessions() { window.location.href = 'computer-management.html#sessions'; }
function viewAllReservations() { window.location.href = 'reservation-management.html'; }
function viewAllActivity() { window.location.href = 'reports.html'; }

function performGlobalSearch(query) {
    const resultsContainer = document.getElementById('searchResults');
    if (!resultsContainer) return;

    query = (query || '').toString().trim();
    if (query.length < 1) { resultsContainer.style.display = 'none'; return; }

    const lowerQuery = query.toLowerCase();
    const results = [];
    const data = window.__dashboardData;

    data.computers.forEach(c => {
        const searchable = (c.computer_number + ' ' + (c.computer_name || '') + ' ' + (c.current_user || '')).toLowerCase();
        if (searchable.includes(lowerQuery)) {
            results.push({
                type: 'computer', title: c.computer_number,
                subtitle: c.current_user ? `In use by ${c.current_user}` : c.computer_name || 'Available',
                icon: '💻', iconClass: 'icon-computer', badge: c.status,
                click: () => window.location.href = 'computer-management.html'
            });
        }
    });

    data.sessions.forEach(s => {
        const searchable = (s.student_name + ' ' + s.computer_number).toLowerCase();
        if (searchable.includes(lowerQuery)) {
            results.push({
                type: 'session', title: s.student_name,
                subtitle: `Computer ${s.computer_number} • Started ${formatTimeOnly(s.start_time)}`,
                icon: '🕒', iconClass: 'icon-session', badge: 'Active Session',
                click: () => window.location.href = 'computer-management.html#sessions'
            });
        }
    });

    data.reservations.forEach(r => {
        const searchable = (r.student_name + ' ' + r.computer_number + ' ' + r.start_time + ' ' + r.end_time).toLowerCase();
        if (searchable.includes(lowerQuery)) {
            results.push({
                type: 'reservation', title: r.student_name,
                subtitle: `Computer ${r.computer_number} • ${formatTimeOnly(r.start_time)} - ${formatTimeOnly(r.end_time)}`,
                icon: '📅', iconClass: 'icon-reservation', badge: 'Pending',
                click: () => window.location.href = 'reservation-management.html'
            });
        }
    });

    data.activities.forEach(a => {
        const searchable = a.message.toLowerCase();
        if (searchable.includes(lowerQuery)) {
            results.push({
                type: 'activity',
                title: a.message.length > 40 ? a.message.substring(0, 40) + '…' : a.message,
                subtitle: getRelativeTime(a.created_at),
                icon: '📋', iconClass: 'icon-activity', badge: a.type || 'activity',
                click: () => window.location.href = 'reports.html'
            });
        }
    });

    const limited = results.slice(0, 10);

    if (limited.length === 0) {
        resultsContainer.innerHTML = '<div class="search-empty">No results found</div>';
        resultsContainer.style.display = 'block';
        return;
    }

    let html = '';
    limited.forEach(item => {
        html += `
            <div class="result-item" data-href="#">
                <div class="result-icon ${item.iconClass}">${item.icon}</div>
                <div class="result-details">
                    <div class="result-title">${escapeHtml(item.title)}</div>
                    <div class="result-subtitle">${escapeHtml(item.subtitle)}</div>
                </div>
                <span class="result-badge">${escapeHtml(item.badge)}</span>
            </div>
        `;
    });

    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';

    resultsContainer.querySelectorAll('.result-item').forEach((el, index) => {
        el.addEventListener('click', function(e) {
            e.preventDefault();
            const item = limited[index];
            if (item && item.click) item.click();
            resultsContainer.style.display = 'none';
            document.getElementById('globalSearch').value = '';
        });
    });
}

function setupSearch() {
    const searchInput = document.getElementById('globalSearch');
    if (!searchInput) return;

    searchInput.addEventListener('input', function() {
        performGlobalSearch(this.value);
    });

    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const rc = document.getElementById('searchResults');
            if (rc) rc.style.display = 'none';
            this.blur();
        }
    });

    searchInput.addEventListener('blur', function() {
        setTimeout(() => {
            const rc = document.getElementById('searchResults');
            if (rc) rc.style.display = 'none';
        }, 200);
    });

    searchInput.addEventListener('focus', function() {
        const query = this.value.trim();
        if (query.length >= 1) performGlobalSearch(query);
    });
}

function setupEventListeners() {
    setupSearch();

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeDashboardReservationModal();
    });
}

// Refresh every 30s; this also drops reservations that have become overdue.
function startAutoRefresh() {
    setInterval(() => { loadDashboardData(); }, 30000);
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

window.approveReservation = approveReservation;
window.rejectReservation = rejectReservation;
window.viewPendingReservation = viewPendingReservation;
window.closeDashboardReservationModal = closeDashboardReservationModal;
window.refreshComputers = refreshComputers;
window.refreshDashboard = refreshDashboard;
window.viewAllComputers = viewAllComputers;
window.viewAllSessions = viewAllSessions;
window.viewAllReservations = viewAllReservations;
window.viewAllActivity = viewAllActivity;
window.showComputerDetails = showComputerDetails;