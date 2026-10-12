// frontend/student/js/dashboard.js
/**
 * Wired to GET /dashboard/student, GET /notifications/unread-count,
 * and GET /computers (for the Computer Status map).
 */

/* ============================================================
 * RESERVATION HELPERS
 * ============================================================ */
let dashReservations = [];
let dashCurrentReservation = null;
let dashComputers = [];

function dashParseDate(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dashEffectiveStatus(r) {
    const raw = (r && r.status) || '';
    if (raw !== 'Pending' && raw !== 'Approved') return raw;

    const day = dashParseDate(r.reservation_date);
    if (!day) return raw;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (day.getTime() < today.getTime()) return 'Missed';

    if (day.getTime() === today.getTime() && r.end_time) {
        const p = String(r.end_time).split(':').map(Number);
        if (!isNaN(p[0])) {
            const end = new Date(day);
            end.setHours(p[0], p[1] || 0, 0, 0);
            if (now.getTime() > end.getTime()) return 'Missed';
        }
    }
    return raw;
}

function dashComputerLabel(r) {
    const raw = r && (r.computer_number ?? r.computer_name);
    if (!raw) return 'PC';
    const s = String(raw).trim();
    return /^pc-/i.test(s) ? s : `PC-${s}`;
}

function dashComputerName(r) {
    return (r && r.computer_name) ? String(r.computer_name) : '';
}

function dashFormatTime(value) {
    if (!value) return '—';
    const p = String(value).split(':').map(Number);
    const h = p[0], m = p[1] || 0;
    if (isNaN(h)) return '—';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function dashFormatDate(value) {
    const d = dashParseDate(value);
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function dashCompareByDateTime(a, b) {
    const d = String(a.reservation_date || '').localeCompare(String(b.reservation_date || ''));
    if (d !== 0) return d;
    return String(a.start_time || '').localeCompare(String(b.start_time || ''));
}

function dashReservationKey(r) {
    return r && r.id != null ? String(r.id) : null;
}

function dashEscape(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/* ============================================================
 * CHROME
 * ============================================================ */
function paintChromeFromSession() {
    const user = sessionManager.getUser() || {};
    const name = sessionManager.getUserName()
        || [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ')
        || 'Student';

    if (typeof refreshChrome === 'function') refreshChrome();

    const firstName = (name || '').trim().split(/\s+/)[0] || 'Student';
    setText('header-name', firstName);
}

function paintChromeFromStudent(student) {
    student = student || {};
    const name = [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean).join(' ').trim()
        || sessionManager.getUserName()
        || 'Student';

    if (typeof refreshChrome === 'function') refreshChrome();

    const firstName = (name || '').trim().split(/\s+/)[0] || 'Student';
    setText('header-name', firstName);

    const used = Number(student.used_hours ?? 0);
    const remaining = Number(student.remaining_hours ?? 0);
    const limit = used + remaining;

    if (typeof paintSidebarHours === 'function') {
        paintSidebarHours(used, remaining);
    }

    setText('stat-hours-remaining', `${remaining.toFixed(1)} hrs`);
    setText('stat-hours-sub', `of ${limit.toFixed(1)} hrs this semester`);
    if (remaining <= 0) {
        const b = document.getElementById('hours-exhausted-banner');
        if (b) b.hidden = false;
    } else {
        const b = document.getElementById('hours-exhausted-banner');
        if (b) b.hidden = true;
    }
}

/* ============================================================
 * UPCOMING RESERVATION PANEL
 * ------------------------------------------------------------
 * Shows the soonest Pending/Approved reservation that hasn't
 * already passed (i.e. not "Missed"). Includes a live countdown
 * to the start time.
 * ============================================================ */
function renderUpcomingPanel() {
    const container = document.getElementById('sd-upcoming-body');
    if (!container) return;

    // Collect candidate reservations, dedupe by id.
    const seen = new Set();
    const candidates = [];
    if (dashCurrentReservation) {
        const k = dashReservationKey(dashCurrentReservation);
        if (k) seen.add(k);
        candidates.push(dashCurrentReservation);
    }
    dashReservations.forEach((r) => {
        const k = dashReservationKey(r);
        if (k && seen.has(k)) return;
        if (k) seen.add(k);
        candidates.push(r);
    });

    const isActive = (r) => {
        const s = dashEffectiveStatus(r);
        return s === 'Pending' || s === 'Approved';
    };

    const upcoming = candidates.filter(isActive).sort(dashCompareByDateTime)[0];

    if (!upcoming) {
        container.innerHTML = `
            <div class="sd-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2"/>
                    <path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
                <p>No upcoming reservation. <a href="computer-availability.html" style="color:#2563eb;font-weight:600;">Reserve a computer</a> to get started.</p>
            </div>`;
        return;
    }

    const status = dashEffectiveStatus(upcoming);
    const statusClass = status.toLowerCase();
    const computerNumber = dashComputerLabel(upcoming);
    const computerName = dashComputerName(upcoming);
    const dateStr = dashFormatDate(upcoming.reservation_date);
    const timeStr = `${dashFormatTime(upcoming.start_time)} – ${dashFormatTime(upcoming.end_time)}`;

    // Countdown to start
    let countdownHtml = '';
    const startDate = dashParseDate(upcoming.reservation_date);
    if (startDate && upcoming.start_time) {
        const p = String(upcoming.start_time).split(':').map(Number);
        if (!isNaN(p[0])) {
            startDate.setHours(p[0], p[1] || 0, 0, 0);
            const diffMs = startDate.getTime() - Date.now();
            if (diffMs > 0) {
                const totalMin = Math.floor(diffMs / 60000);
                const days = Math.floor(totalMin / (60 * 24));
                const hours = Math.floor((totalMin % (60 * 24)) / 60);
                const mins = totalMin % 60;
                let label;
                if (days >= 1) {
                    label = `${days}d ${hours}h ${mins}m`;
                } else if (hours >= 1) {
                    label = `${hours}h ${mins}m`;
                } else {
                    label = `${mins}m`;
                }
                countdownHtml = `
                    <div class="sd-upc-countdown">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16" aria-hidden="true">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 6v6l4 2"/>
                        </svg>
                        <span>Starts in <strong>${label}</strong></span>
                    </div>`;
            } else {
                countdownHtml = `
                    <div class="sd-upc-countdown">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16" aria-hidden="true">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 6v6l4 2"/>
                        </svg>
                        <span>Reservation is starting now</span>
                    </div>`;
            }
        }
    }

    container.innerHTML = `
        <div class="sd-upcoming">
            <div class="sd-upc-top">
                <div class="sd-upc-computer">
                    <div class="sd-upc-computer-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22" aria-hidden="true">
                            <rect x="2" y="4" width="20" height="13" rx="2"/>
                            <path d="M8 21h8M12 17v4"/>
                        </svg>
                    </div>
                    <div class="sd-upc-computer-text">
                        <div class="sd-upc-computer-number">${dashEscape(computerNumber)}</div>
                        ${computerName ? `<div class="sd-upc-computer-name">${dashEscape(computerName)}</div>` : ''}
                    </div>
                </div>
                <span class="sd-upc-status ${statusClass}">${dashEscape(status)}</span>
            </div>

            <div class="sd-upc-details">
                <div class="sd-upc-detail">
                    <span class="sd-upc-detail-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" aria-hidden="true">
                            <rect x="3" y="4" width="18" height="18" rx="2"/>
                            <path d="M16 2v4M8 2v4M3 10h18"/>
                        </svg>
                    </span>
                    <div class="sd-upc-detail-body">
                        <div class="sd-upc-detail-label">Date</div>
                        <div class="sd-upc-detail-value">${dashEscape(dateStr)}</div>
                    </div>
                </div>
                <div class="sd-upc-detail">
                    <span class="sd-upc-detail-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" aria-hidden="true">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 6v6l4 2"/>
                        </svg>
                    </span>
                    <div class="sd-upc-detail-body">
                        <div class="sd-upc-detail-label">Time</div>
                        <div class="sd-upc-detail-value">${dashEscape(timeStr)}</div>
                    </div>
                </div>
            </div>

            ${countdownHtml}
        </div>`;
}

/* ============================================================
 * COMPUTER STATUS MAP
 * ------------------------------------------------------------
 * Loads via GET /computers, renders a compact grid of chips
 * coloured by status + a summary of counts at the top.
 * ============================================================ */
async function loadComputerStatusMap() {
    const container = document.getElementById('sd-computers-body');
    if (!container) return;

    let res;
    try {
        res = await api.getComputers();
    } catch (err) {
        res = { success: false, message: err.message };
    }

    if (!res || !res.success) {
        container.innerHTML = `
            <div class="sd-empty">
                <p>Could not load computer status. Please refresh.</p>
            </div>`;
        return;
    }

    dashComputers = res.data || [];
    renderComputerStatusMap();
}

function renderComputerStatusMap() {
    const container = document.getElementById('sd-computers-body');
    if (!container) return;

    if (!dashComputers.length) {
        container.innerHTML = `
            <div class="sd-empty">
                <p>No computers are set up in the library yet.</p>
            </div>`;
        return;
    }

    // Counts
    const counts = { Available: 0, Occupied: 0, Reserved: 0, Maintenance: 0 };
    dashComputers.forEach((c) => {
        counts[c.status] = (counts[c.status] || 0) + 1;
    });

    // Sort chips: Available → Reserved → Occupied → Maintenance
    const priority = { 'Available': 0, 'Reserved': 1, 'Occupied': 2, 'Maintenance': 3 };
    const sorted = dashComputers.slice().sort((a, b) => {
        const pa = priority[a.status] ?? 99;
        const pb = priority[b.status] ?? 99;
        if (pa !== pb) return pa - pb;
        return String(a.computer_number || '').localeCompare(String(b.computer_number || ''));
    });

    const summaryHtml = `
        <div class="sd-cs-summary">
            <div class="sd-cs-summary-item available">
                <span class="sd-cs-summary-count">${counts.Available || 0}</span>
                <span class="sd-cs-summary-label">Available</span>
            </div>
            <div class="sd-cs-summary-item occupied">
                <span class="sd-cs-summary-count">${counts.Occupied || 0}</span>
                <span class="sd-cs-summary-label">Occupied</span>
            </div>
            <div class="sd-cs-summary-item reserved">
                <span class="sd-cs-summary-count">${counts.Reserved || 0}</span>
                <span class="sd-cs-summary-label">Reserved</span>
            </div>
            <div class="sd-cs-summary-item maintenance">
                <span class="sd-cs-summary-count">${counts.Maintenance || 0}</span>
                <span class="sd-cs-summary-label">Maintenance</span>
            </div>
        </div>`;

    const chipsHtml = sorted.map((c) => {
        const statusClass = String(c.status || '').toLowerCase();
        const number = c.computer_number || 'PC';
        const statusLabel = String(c.status || '').toUpperCase();
        const user = c.current_user ? ` — ${c.current_user}` : '';
        const tooltip = `${number} (${c.status})${user}`;
        return `
            <div class="sd-cs-chip status-${statusClass}" title="${dashEscape(tooltip)}">
                <div class="sd-cs-chip-number">${dashEscape(number)}</div>
                <div class="sd-cs-chip-status">${dashEscape(statusLabel)}</div>
            </div>`;
    }).join('');

    container.innerHTML = `
        ${summaryHtml}
        <div class="sd-cs-grid">${chipsHtml}</div>`;
}

/* ============================================================
 * TODAY'S RESERVATIONS
 * ------------------------------------------------------------
 * Only shows reservations whose reservation_date is TODAY.
 * ============================================================ */
function renderTodayReservations() {
    const container = document.getElementById('sd-today-body');
    if (!container) return;

    const now = new Date();
    const todayKey =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const todays = (dashReservations || []).filter((r) => {
        const day = String(r.reservation_date || '').slice(0, 10);
        return day === todayKey;
    });

    if (todays.length === 0) {
        container.innerHTML = `
            <div class="sd-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2"/>
                    <path d="M16 2v4M8 2v4M3 10h18"/>
                </svg>
                <p>No reservations for today.</p>
            </div>`;
        return;
    }

    // Sort by start time.
    todays.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));

    const rowsHtml = todays.map((r) => {
        const status = dashEffectiveStatus(r);
        const statusClass = String(status || '').toLowerCase();
        const computerNumber = dashComputerLabel(r);
        const computerName = dashComputerName(r);
        const timeStr = `${dashFormatTime(r.start_time)} – ${dashFormatTime(r.end_time)}`;
        const title = computerName ? `${computerNumber} — ${computerName}` : computerNumber;

        return `
            <div class="sd-today-item">
                <div class="sd-today-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18" aria-hidden="true">
                        <rect x="2" y="4" width="20" height="13" rx="2"/>
                        <path d="M8 21h8M12 17v4"/>
                    </svg>
                </div>
                <div class="sd-today-main">
                    <div class="sd-today-title">${dashEscape(title)}</div>
                    <div class="sd-today-meta">${dashEscape(timeStr)}</div>
                </div>
                <span class="sd-today-status ${statusClass}">${dashEscape(status)}</span>
            </div>`;
    }).join('');

    container.innerHTML = `<div class="sd-today-list">${rowsHtml}</div>`;
}

/* ============================================================
 * TOP STAT CARDS (upcoming + notifications)
 * ============================================================ */
function renderTopStats() {
    // Upcoming reservation stat card
    const seen = new Set();
    const candidates = [];
    if (dashCurrentReservation) {
        const k = dashReservationKey(dashCurrentReservation);
        if (k) seen.add(k);
        candidates.push(dashCurrentReservation);
    }
    dashReservations.forEach((r) => {
        const k = dashReservationKey(r);
        if (k && seen.has(k)) return;
        if (k) seen.add(k);
        candidates.push(r);
    });

    const isActive = (r) => {
        const s = dashEffectiveStatus(r);
        return s === 'Pending' || s === 'Approved';
    };

    const upcoming = candidates.filter(isActive).sort(dashCompareByDateTime)[0];

    if (upcoming) {
        setText('stat-upcoming', '1');
        setText('stat-upcoming-sub',
            `${dashComputerLabel(upcoming)} on ${dashFormatDate(upcoming.reservation_date)}`);
    } else {
        setText('stat-upcoming', 'None');
        setText('stat-upcoming-sub', 'No upcoming reservation');
    }
}

/* ============================================================
 * LOAD DASHBOARD
 * ============================================================ */
async function loadDashboard(opts = {}) {
    const { background = false } = opts;

    const dashPromise = api.getDashboard().catch((err) => ({ success: false, message: err.message }));
    const unreadPromise = background
        ? Promise.resolve(null)
        : api.getUnreadNotificationCount().catch(() => ({ success: false }));

    const [dash, unread] = await Promise.all([dashPromise, unreadPromise]);

    if (dash.success && dash.data) {
        paintChromeFromStudent(dash.data.student);

        dashReservations = dash.data.reservation_history || [];
        dashCurrentReservation = dash.data.current_reservation || null;

        renderTopStats();
        renderUpcomingPanel();
        renderTodayReservations();
    } else {
        console.error('[dashboard] /dashboard/student failed:', dash.message);
        if (background) return;

        if (typeof showToast === 'function') {
            showToast('error', 'Could not load dashboard', dash.message || 'Please try again.');
        }
        setText('stat-hours-remaining', '—');
        setText('stat-hours-sub', '—');
        setText('stat-upcoming', '—');
        setText('stat-upcoming-sub', '—');
        dashReservations = [];
        dashCurrentReservation = null;
        renderTopStats();
        renderUpcomingPanel();
        renderTodayReservations();
    }

    if (!background) {
        if (unread && unread.success && unread.data) {
            setText('stat-notifications', String(unread.data.unread || 0));
        } else {
            setText('stat-notifications', '0');
        }
    }

    // Computer status map is loaded independently so a failure there
    // never breaks the rest of the dashboard.
    loadComputerStatusMap();
}

/* ============================================================
 * INIT
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    if (!sessionManager.requireRole('student')) return;

    paintChromeFromSession();

    setText('current-time', new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    }));

    if (!sessionManager.getUserName()) {
        api.getProfile().then((res) => {
            if (res.success && res.data) {
                const merged = { ...(sessionManager.getUser() || {}), ...res.data };
                sessionManager.api.setAuth(sessionManager.token, merged);
                paintChromeFromSession();
            }
        }).catch(() => {});
    }

    loadDashboard();

    setInterval(() => { if (!document.hidden) loadDashboard({ background: true }); }, 30000);

    if (sessionStorage.getItem('force_password_change') === '1') {
        if (typeof showToast === 'function') {
            showToast('warning', 'Change your password', 'You are using your default password. Please update it in Profile.', 6000);
        }
        sessionStorage.removeItem('force_password_change');
    }

    onClick('logoutBtn', () => { if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navLogoutLink', (e) => { e.preventDefault(); if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navbarToggler', () => { if (window.sidebar) window.sidebar.open(); });

    // ============================================================
    // REAL-TIME NOTIFICATION LISTENER
    // ============================================================
    const _seenRealtimeNotificationKeys = new Set();
    const _SEEN_CAP = 200;

    function rememberNotificationKey(key) {
        if (!key) return;
        if (_seenRealtimeNotificationKeys.has(key)) return;
        _seenRealtimeNotificationKeys.add(key);
        if (_seenRealtimeNotificationKeys.size > _SEEN_CAP) {
            const oldest = _seenRealtimeNotificationKeys.values().next().value;
            _seenRealtimeNotificationKeys.delete(oldest);
        }
    }

    window.addEventListener('realtime:notification', (e) => {
        const n = e && e.detail;
        const key = n && n.id !== undefined
            ? `${n.id}|${n.created_at || ''}`
            : null;

        if (key && _seenRealtimeNotificationKeys.has(key)) return;
        rememberNotificationKey(key);

        const el = document.getElementById('stat-notifications');
        if (el) {
            const current = parseInt(el.textContent, 10) || 0;
            el.textContent = String(current + 1);
        }

        loadDashboard({ background: true });
    });

    // Refresh the computer map when the window regains focus.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) loadComputerStatusMap();
    });
});