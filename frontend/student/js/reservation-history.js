// frontend/student/js/reservation-history.js
/**
 * Full reservation history for the logged-in student.
 *
 * Data source (first one that works wins):
 *   1. api.getReservationsForStudent(id)
 *   2. api.getDashboard() -> data.reservation_history
 *
 * Cancel: students may cancel ONLY while the reservation is still
 * Pending. Approved reservations can only be cancelled by library
 * staff, so the Cancel button is not rendered for them. Cancelling
 * opens a modal where the student can optionally attach a reason;
 * that reason is forwarded to the backend and stored on the row.
 */

const HISTORY_PAGE_SIZE = 10;
const HISTORY_REFRESH_MS = 30000;
const CANCEL_REASON_MAX = 500;

let historyAll = [];
let historyFiltered = [];
let historyPage = 1;
let historyPages = 1;
let historyFilters = { status: '', date: '' };
let historySnapshot = '';
let cancelInFlight = false;
let pendingCancelReservation = null;

/* ============================================================
 * DATE / STATUS HELPERS
 * ============================================================ */
function histParseDate(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function histParseDateTime(value) {
    if (!value) return null;
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return histParseDate(str);
    const d = new Date(str.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
}

function histFormatDate(value) {
    const d = histParseDateTime(value);
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function histFormatTime(value) {
    if (!value) return '—';
    const parts = String(value).split(':').map(Number);
    const h = parts[0], m = parts[1] || 0;
    if (isNaN(h)) return '—';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function histDuration(start, end) {
    if (!start || !end) return '—';
    const s = String(start).split(':').map(Number);
    const e = String(end).split(':').map(Number);
    if (isNaN(s[0]) || isNaN(e[0])) return '—';
    const mins = (e[0] * 60 + (e[1] || 0)) - (s[0] * 60 + (s[1] || 0));
    if (mins <= 0) return '—';
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    return h ? `${h}h` : `${m}m`;
}

function histEscape(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function histEffectiveStatus(r) {
    const raw = (r && r.status) || '';
    if (raw !== 'Pending' && raw !== 'Approved') return raw;

    const day = histParseDate(r.reservation_date);
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

const HISTORY_BADGES = {
    Pending:   'warning',
    Approved:  'success',
    Completed: 'info',
    Cancelled: 'danger',
    Rejected:  'danger',
    Missed:    'missed',
    Expired:   'secondary'
};

function histComputerLabel(r) {
    const raw = r && (r.computer_number ?? r.computer_name);
    if (!raw) return 'Unknown';
    const s = String(raw).trim();
    return /^pc-/i.test(s) ? s : `PC-${s}`;
}

/**
 * Students may cancel ONLY while the reservation is still Pending.
 * Once approved, cancellation is a staff-only action.
 */
function histCanCancel(r) {
    if (!r) return false;
    if (String(r.status || '') !== 'Pending') return false;
    return histEffectiveStatus(r) === 'Pending';
}

/* ============================================================
 * LOAD
 * ============================================================ */
function getStudentId() {
    const user = sessionManager.getUser();
    return user && (user.id || user.sub);
}

async function loadHistory(opts = {}) {
    const { background = false } = opts;
    const id = getStudentId();

    try {
        const dashPromise = api.getDashboard().catch(() => ({ success: false }));

        let rows = null;
        if (id && typeof api.getReservationsForStudent === 'function') {
            try {
                const res = await api.getReservationsForStudent(id);
                if (res && res.success && Array.isArray(res.data)) rows = res.data;
            } catch (e) {
                console.warn('[history] getReservationsForStudent failed, using dashboard:', e);
            }
        }

        const dash = await dashPromise;
        if (dash.success && dash.data && dash.data.student) {
            paintSidebarHours(dash.data.student.used_hours, dash.data.student.remaining_hours);
        }
        if (rows === null) {
            rows = (dash.success && dash.data && dash.data.reservation_history) || [];
        }

        const snapshot = JSON.stringify(rows) + '|' + Math.floor(Date.now() / 60000);
        if (background && snapshot === historySnapshot) return;
        historySnapshot = snapshot;

        historyAll = rows;
        applyHistoryFilters(background ? historyPage : 1);
    } catch (err) {
        console.error('[history] load failed:', err);
        if (background) return;
        const body = document.getElementById('history-body');
        if (body) {
            body.innerHTML = `<tr class="table-empty"><td colspan="7">Failed to load your reservations. ${histEscape(err.message || '')}</td></tr>`;
        }
        if (typeof showToast === 'function') showToast('error', 'Could not load history', err.message || 'Please try again.');
    }
}

/* ============================================================
 * FILTER + SORT + RENDER
 * ============================================================ */
function sortHistory(list) {
    return list.slice().sort((a, b) => {
        const d = String(b.reservation_date || '').localeCompare(String(a.reservation_date || ''));
        if (d !== 0) return d;
        return String(b.start_time || '').localeCompare(String(a.start_time || ''));
    });
}

function applyHistoryFilters(page) {
    const { status, date } = historyFilters;

    const matches = historyAll.filter((r) => {
        const okStatus = !status || histEffectiveStatus(r) === status;
        const okDate = !date || String(r.reservation_date || '').slice(0, 10) === date;
        return okStatus && okDate;
    });

    historyFiltered = sortHistory(matches);
    historyPages = Math.max(1, Math.ceil(historyFiltered.length / HISTORY_PAGE_SIZE));
    historyPage = Math.min(Math.max(1, page), historyPages);

    renderHistoryRows();
    renderHistoryPagination();
    renderHistoryStats();
}

function renderHistoryRows() {
    const body = document.getElementById('history-body');
    if (!body) return;

    if (historyAll.length === 0) {
        body.innerHTML = `
            <tr class="table-empty"><td colspan="7">
                <div class="history-empty">
                    <p>You haven't made any reservations yet.</p>
                    <a class="btn btn-primary btn-sm" href="computer-availability.html">Reserve a computer</a>
                </div>
            </td></tr>`;
        return;
    }

    if (historyFiltered.length === 0) {
        body.innerHTML = '<tr class="table-empty"><td colspan="7">No reservations match your filters.</td></tr>';
        return;
    }

    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    body.innerHTML = historyFiltered.slice(start, start + HISTORY_PAGE_SIZE).map((r) => {
        const status = histEffectiveStatus(r);
        const cls = HISTORY_BADGES[status] || 'secondary';

        const canCancel = histCanCancel(r);
        let actionCell;
        if (canCancel) {
            actionCell = `<button class="btn btn-sm btn-danger" data-action="cancel" data-id="${r.id}">Cancel</button>`;
        } else if (status === 'Approved') {
            actionCell = `<span class="text-muted" style="font-size:12px;">Contact staff to cancel</span>`;
        } else {
            actionCell = `<span class="text-muted" style="font-size:12px;">—</span>`;
        }

        return `
            <tr>
                <td data-label="Computer"><strong>${histEscape(histComputerLabel(r))}</strong></td>
                <td data-label="Date">${histFormatDate(r.reservation_date)}</td>
                <td data-label="Time">${histFormatTime(r.start_time)} – ${histFormatTime(r.end_time)}</td>
                <td data-label="Duration">${histDuration(r.start_time, r.end_time)}</td>
                <td data-label="Status"><span class="badge badge-${cls}">${histEscape(status || 'Unknown')}</span></td>
                <td data-label="Requested">${histFormatDate(r.created_at)}</td>
                <td data-label="Actions" class="text-end">${actionCell}</td>
            </tr>`;
    }).join('');

    body.querySelectorAll('[data-action="cancel"]').forEach((btn) => {
        btn.addEventListener('click', () => cancelReservation(Number(btn.getAttribute('data-id'))));
    });
}

function setHistText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function renderHistoryStats() {
    const count = (s) => historyAll.filter((r) => histEffectiveStatus(r) === s).length;
    setHistText('hs-total', historyAll.length);
    setHistText('hs-pending', count('Pending'));
    setHistText('hs-approved', count('Approved'));
    setHistText('hs-completed', count('Completed'));
    setHistText('hs-cancelled', count('Cancelled'));
    setHistText('hs-missed', count('Missed'));
}

function goToHistoryPage(p) {
    historyPage = Math.min(Math.max(1, p), historyPages);
    renderHistoryRows();
    renderHistoryPagination();
}

function renderHistoryPagination() {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    const end = Math.min(start + HISTORY_PAGE_SIZE, historyFiltered.length);
    setHistText('hp-start', historyFiltered.length === 0 ? 0 : start + 1);
    setHistText('hp-end', end);
    setHistText('hp-total', historyFiltered.length);

    const wrap = document.getElementById('hp-buttons');
    if (!wrap) return;
    wrap.innerHTML = '';

    const mk = (label, cls, disabled, onClick, aria) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm ' + cls;
        b.textContent = label;
        if (aria) b.setAttribute('aria-label', aria);
        b.disabled = disabled;
        b.addEventListener('click', onClick);
        wrap.appendChild(b);
    };

    mk('‹', 'btn-light', historyPage <= 1, () => goToHistoryPage(historyPage - 1), 'Previous page');

    const maxButtons = 5;
    let first = Math.max(1, historyPage - Math.floor(maxButtons / 2));
    let last = Math.min(historyPages, first + maxButtons - 1);
    first = Math.max(1, last - maxButtons + 1);
    for (let p = first; p <= last; p++) {
        mk(String(p), p === historyPage ? 'btn-primary' : 'btn-light', false, () => goToHistoryPage(p));
    }

    mk('›', 'btn-light', historyPage >= historyPages, () => goToHistoryPage(historyPage + 1), 'Next page');
}

/* ============================================================
 * CANCEL MODAL
 * ============================================================ */
function openCancelModal(reservation) {
    pendingCancelReservation = reservation;

    // Fill the summary.
    const summary = document.getElementById('cancelReservationSummary');
    if (summary) {
        summary.innerHTML = `
            <div class="cancel-summary-row">
                <span class="cancel-summary-label">Computer</span>
                <span class="cancel-summary-value">${histEscape(histComputerLabel(reservation))}</span>
            </div>
            <div class="cancel-summary-row">
                <span class="cancel-summary-label">Date</span>
                <span class="cancel-summary-value">${histFormatDate(reservation.reservation_date)}</span>
            </div>
            <div class="cancel-summary-row">
                <span class="cancel-summary-label">Time</span>
                <span class="cancel-summary-value">${histFormatTime(reservation.start_time)} – ${histFormatTime(reservation.end_time)}</span>
            </div>
        `;
    }

    // Reset the reason field.
    const reasonEl = document.getElementById('cancelReason');
    if (reasonEl) reasonEl.value = '';
    setHistText('cancelReasonCount', `0 / ${CANCEL_REASON_MAX}`);
    setHistText('error-cancel-reason', '');

    // Hide the error banner.
    const alertEl = document.getElementById('cancelConflictAlert');
    if (alertEl) alertEl.classList.remove('show');

    // Show the modal.
    const modal = document.getElementById('cancelReservationModal');
    if (modal) modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    // Focus the textarea.
    if (reasonEl) setTimeout(() => reasonEl.focus(), 60);
}

function closeCancelModal() {
    const modal = document.getElementById('cancelReservationModal');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = '';
    pendingCancelReservation = null;
}

async function confirmCancelReservation() {
    if (cancelInFlight || !pendingCancelReservation) return;

    const reasonEl = document.getElementById('cancelReason');
    const reason = (reasonEl ? reasonEl.value : '').trim();

    setHistText('error-cancel-reason', '');
    const alertEl = document.getElementById('cancelConflictAlert');
    if (alertEl) alertEl.classList.remove('show');

    if (reason.length > CANCEL_REASON_MAX) {
        setHistText('error-cancel-reason', `Reason must be ${CANCEL_REASON_MAX} characters or fewer.`);
        return;
    }

    // Defensive re-check: the reservation may have been approved by
    // an admin while the modal was open. If so, abort.
    const live = historyAll.find((x) => Number(x.id) === Number(pendingCancelReservation.id));
    if (!live || !histCanCancel(live)) {
        setHistText('cancelConflictMessage',
            'This reservation can no longer be cancelled. It may have already been approved by the library staff.');
        if (alertEl) alertEl.classList.add('show');
        loadHistory({ background: false });
        return;
    }

    cancelInFlight = true;

    const btn = document.getElementById('cancel-modal-confirm-btn');
    const spinner = document.getElementById('cancel-spinner');
    const label = document.getElementById('cancel-modal-confirm-label');

    if (btn) btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';
    if (label) label.textContent = 'Cancelling…';

    try {
        const res = await api.cancelReservation(live.id, reason || null);
        if (res && res.success) {
            closeCancelModal();
            showToast('success', 'Reservation cancelled', 'Your reservation has been cancelled.');
            await loadHistory({ background: false });
        } else {
            setHistText('cancelConflictMessage', (res && res.message) || 'Could not cancel this reservation.');
            if (alertEl) alertEl.classList.add('show');
        }
    } catch (err) {
        setHistText('cancelConflictMessage', err.message || 'Could not cancel this reservation.');
        if (alertEl) alertEl.classList.add('show');
    } finally {
        cancelInFlight = false;
        if (btn) btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        if (label) label.textContent = 'Cancel Reservation';
    }
}

/**
 * Entry point from the row button. Opens the modal only for a
 * cancellable (Pending) reservation.
 */
function cancelReservation(id) {
    if (cancelInFlight) return;

    const r = historyAll.find((x) => Number(x.id) === Number(id));
    if (!r) return;

    if (!histCanCancel(r)) {
        showToast(
            'warning',
            'Cannot cancel',
            'Only pending reservations can be cancelled. Please contact the library staff.'
        );
        loadHistory({ background: false });
        return;
    }

    openCancelModal(r);
}

/* ============================================================
 * WIRING
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    if (!sessionManager.requireRole('student')) return;

    refreshChrome();

    if (!sessionManager.getUserName()) {
        api.getProfile().then((res) => {
            if (res.success && res.data) {
                const merged = { ...(sessionManager.getUser() || {}), ...res.data };
                sessionManager.api.setAuth(sessionManager.token, merged);
                refreshChrome();
            }
        }).catch(() => {});
    }

    const statusEl = document.getElementById('history-status');
    if (statusEl) statusEl.addEventListener('change', (e) => {
        historyFilters.status = e.target.value;
        applyHistoryFilters(1);
    });

    const dateEl = document.getElementById('history-date');
    if (dateEl) dateEl.addEventListener('change', (e) => {
        historyFilters.date = e.target.value;
        applyHistoryFilters(1);
    });

    const clearBtn = document.getElementById('history-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        historyFilters = { status: '', date: '' };
        if (statusEl) statusEl.value = '';
        if (dateEl) dateEl.value = '';
        applyHistoryFilters(1);
    });

    // ---- Cancel modal wiring ----
    const modalCloseBtn = document.getElementById('cancel-modal-close-btn');
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeCancelModal);

    const modalConfirmBtn = document.getElementById('cancel-modal-confirm-btn');
    if (modalConfirmBtn) modalConfirmBtn.addEventListener('click', confirmCancelReservation);

    const reasonInput = document.getElementById('cancelReason');
    if (reasonInput) {
        reasonInput.addEventListener('input', () => {
            const len = String(reasonInput.value || '').length;
            setHistText('cancelReasonCount', `${len} / ${CANCEL_REASON_MAX}`);
            if (len <= CANCEL_REASON_MAX) setHistText('error-cancel-reason', '');
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeCancelModal();
    });

    onClick('logoutBtn', () => { if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navLogoutLink', (e) => { e.preventDefault(); if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navbarToggler', () => { if (window.sidebar) window.sidebar.open(); });

    loadHistory();

    setInterval(() => { if (!document.hidden) loadHistory({ background: true }); }, HISTORY_REFRESH_MS);

    window.addEventListener('realtime:notification', () => loadHistory({ background: true }));
});

// Expose for inline onclick handlers in the modal backdrop.
window.closeCancelModal = closeCancelModal;