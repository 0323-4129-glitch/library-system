// frontend/admin/js/reservation-management.js
document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('admin')) return;
    initializeReservationManagement();
    setupEventListeners();
    startAutoRefresh();
});

const PAGE_SIZE = 10;
const REFRESH_MS = 15000;

let allReservations = [];
let filteredReservations = [];
let currentPage = 1;
let totalPages = 1;
let currentFilters = { search: '', status: '', date: '' };
let lastSnapshot = '';
let actionInFlight = false;

if (typeof showToast !== 'function') {
    window.showToast = function(message) { alert(message); };
}

async function initializeReservationManagement() {
    try {
        await loadReservations();
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Failed to load reservations', 'error');
    }
}

// ============================================================
// DATE HELPERS
// ============================================================

function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
    if (m) {
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDateTime(value) {
    if (!value) return null;
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return parseLocalDate(str);
    const d = new Date(str.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
}

function getEffectiveStatus(reservation) {
    if (!reservation) return 'Unknown';
    const rawStatus = reservation.status || '';
    if (rawStatus !== 'Pending' && rawStatus !== 'Approved') return rawStatus;

    const resDate = parseLocalDate(reservation.reservation_date);
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

// ===== LOAD RESERVATIONS =====
async function loadReservations(options = {}) {
    const { background = false, force = false } = options;
    try {
        const response = await api.getReservations();
        if (!response.success) throw new Error(response.message || 'Failed to load reservations');
        const data = response.data || [];

        const snapshot = JSON.stringify(data) + '|' + Math.floor(Date.now() / 60000);
        if (!force && snapshot === lastSnapshot) return;
        lastSnapshot = snapshot;

        allReservations = data;
        applyFiltersAndPaginate(background ? currentPage : 1);
    } catch (error) {
        console.error('Failed to load reservations:', error);
        if (background) return;
        showToast(error.message || 'Failed to load reservations', 'error');
        const tbody = document.getElementById('reservationTableBody');
        if (tbody && !allReservations.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Failed to load reservations</td></tr>';
        }
    }
}

// ===== FILTERS + SORT =====
function sortReservations(list) {
    return list.slice().sort((a, b) => {
        const aPending = getEffectiveStatus(a) === 'Pending' ? 0 : 1;
        const bPending = getEffectiveStatus(b) === 'Pending' ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;

        const dateCmp = String(b.reservation_date || '').localeCompare(String(a.reservation_date || ''));
        if (dateCmp !== 0) return dateCmp;
        return String(b.start_time || '').localeCompare(String(a.start_time || ''));
    });
}

function applyFiltersAndPaginate(page) {
    const search = currentFilters.search.toLowerCase().trim();
    const status = currentFilters.status;
    const date = currentFilters.date;

    const matches = allReservations.filter(r => {
        const matchesSearch = !search ||
            getStudentName(r).toLowerCase().includes(search) ||
            formatComputerLabel(r).toLowerCase().includes(search) ||
            String(r.computer_number || '').toLowerCase().includes(search) ||
            String(r.student_number || '').toLowerCase().includes(search);
        const matchesStatus = !status || getEffectiveStatus(r) === status;
        const matchesDate = !date || String(r.reservation_date || '').slice(0, 10) === date;
        return matchesSearch && matchesStatus && matchesDate;
    });

    filteredReservations = sortReservations(matches);
    totalPages = Math.max(1, Math.ceil(filteredReservations.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, page), totalPages);
    renderReservations();
    updatePagination();
    updateCounts();
}

const STATUS_COLORS = {
    'Pending':   'warning',
    'Approved':  'success',
    'Completed': 'info',
    'Cancelled': 'danger',
    'Rejected':  'danger',
    'Overdue':   'overdue'
};

// FIX: was building inline onclick="..." attributes with the function
// name and ID baked into the markup. Same numeric-ID-today reasoning
// as computer-management.js — a future ID with a wider charset would
// turn this into a stored-XSS sink. Every action button now carries
// data-action + data-id, and clicks are handled via delegation.
function iconButton(label, cls, action, id, svgPath) {
    return `
        <button class="btn btn-sm ${cls}" data-action="${action}" data-id="${id}" title="${label}" aria-label="${label}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14">${svgPath}</svg>
        </button>`;
}

const ICON_VIEW   = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
const ICON_CANCEL = '<path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/>';

function renderReservations() {
    const tbody = document.getElementById('reservationTableBody');
    if (!tbody) return;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageReservations = filteredReservations.slice(start, start + PAGE_SIZE);

    if (pageReservations.length === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="7">No reservations match your filters</td></tr>';
        return;
    }

    tbody.innerHTML = pageReservations.map(reservation => {
        const effectiveStatus = getEffectiveStatus(reservation);
        const statusClass = STATUS_COLORS[effectiveStatus] || 'secondary';

        let actions = iconButton('View', 'btn-info', 'view', reservation.id, ICON_VIEW);

        if (effectiveStatus === 'Approved') {
            actions += iconButton('Cancel', 'btn-danger', 'cancel', reservation.id, ICON_CANCEL);
        }

        return `
            <tr>
                <td><strong>${escapeHtml(getStudentName(reservation))}</strong></td>
                <td>${escapeHtml(formatComputerLabel(reservation))}</td>
                <td>${formatDate(reservation.reservation_date)}</td>
                <td>${formatTime(reservation.start_time)} - ${formatTime(reservation.end_time)}</td>
                <td><span class="badge badge-${statusClass}">${escapeHtml(effectiveStatus)}</span></td>
                <td>${formatDate(reservation.created_at)}</td>
                <td><div class="reservation-actions">${actions}</div></td>
            </tr>`;
    }).join('');

    // Delegated click handling: resolve the button's data-action and
    // data-id, then dispatch to the matching handler. IDs are numeric
    // today, but the pattern is uniform and safe regardless.
    tbody.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            const id = Number(btn.getAttribute('data-id'));
            if (action === 'view') viewReservation(id);
            else if (action === 'cancel') cancelReservation(id);
        });
    });
}

function setCount(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function updateCounts() {
    const count = (s) => allReservations.filter(r => getEffectiveStatus(r) === s).length;

    setCount('totalReservations', allReservations.length);
    setCount('pendingReservations', count('Pending'));
    setCount('approvedReservations', count('Approved'));
    setCount('overdueReservations', count('Overdue'));
    setCount('completedReservations', count('Completed'));
    setCount('cancelledReservations', count('Cancelled'));
}

function goToPage(p) {
    currentPage = Math.min(Math.max(1, p), totalPages);
    renderReservations();
    updatePagination();
}

function updatePagination() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filteredReservations.length);
    setCount('pageStart', filteredReservations.length === 0 ? 0 : start + 1);
    setCount('pageEnd', end);
    setCount('totalRecords', filteredReservations.length);

    const wrap = document.getElementById('paginationButtons');
    if (!wrap) return;
    wrap.innerHTML = '';

    const prev = document.createElement('button');
    prev.className = 'btn btn-sm btn-light';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', 'Previous page');
    prev.disabled = currentPage <= 1;
    prev.addEventListener('click', () => goToPage(currentPage - 1));
    wrap.appendChild(prev);

    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    startPage = Math.max(1, endPage - maxButtons + 1);

    for (let p = startPage; p <= endPage; p++) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm ' + (p === currentPage ? 'btn-primary' : 'btn-light');
        btn.textContent = p;
        btn.addEventListener('click', () => goToPage(p));
        wrap.appendChild(btn);
    }

    const next = document.createElement('button');
    next.className = 'btn btn-sm btn-light';
    next.textContent = '›';
    next.setAttribute('aria-label', 'Next page');
    next.disabled = currentPage >= totalPages;
    next.addEventListener('click', () => goToPage(currentPage + 1));
    wrap.appendChild(next);
}

// ===== EVENT LISTENERS (auto-apply) =====
function setupEventListeners() {
    const searchInput = document.getElementById('searchReservation');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function(e) {
            currentFilters.search = e.target.value;
            applyFiltersAndPaginate(1);
        }, 300));
    }

    const statusFilter = document.getElementById('filterStatus');
    if (statusFilter) {
        statusFilter.addEventListener('change', function(e) {
            currentFilters.status = e.target.value;
            applyFiltersAndPaginate(1);
        });
    }

    const dateFilter = document.getElementById('filterDate');
    if (dateFilter) {
        dateFilter.addEventListener('change', function(e) {
            currentFilters.date = e.target.value;
            applyFiltersAndPaginate(1);
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeAllModals();
    });
}

// ===== VIEW =====
function findReservation(id) {
    return allReservations.find(r => String(r.id) === String(id));
}

function viewReservation(id) {
    const res = findReservation(id);
    if (!res) return;

    const effectiveStatus = getEffectiveStatus(res);
    const statusClass = STATUS_COLORS[effectiveStatus] || 'secondary';

    let extra = '';
    if (effectiveStatus === 'Overdue') {
        extra = `<p class="overdue-note">
            This reservation's time window has passed. No further actions can be taken on it.
        </p>`;
    }

    document.getElementById('reservationDetails').innerHTML = `
        <p><strong>Student:</strong> ${escapeHtml(getStudentName(res))}</p>
        <p><strong>Computer:</strong> ${escapeHtml(formatComputerLabel(res))}</p>
        <p><strong>Date:</strong> ${formatDate(res.reservation_date)}</p>
        <p><strong>Time:</strong> ${formatTime(res.start_time)} - ${formatTime(res.end_time)}</p>
        <p><strong>Status:</strong> <span class="badge badge-${statusClass}">${escapeHtml(effectiveStatus)}</span></p>
        <p><strong>Created:</strong> ${formatDate(res.created_at)}</p>
        ${extra}
    `;

    const footer = document.getElementById('reservationModalFooter');
    if (footer) {
        let actionButtons = '';
        if (effectiveStatus === 'Pending') {
            actionButtons = `
                <button class="btn btn-success" data-modal-action="approve" data-id="${res.id}">Approve</button>
                <button class="btn btn-danger" data-modal-action="reject" data-id="${res.id}">Reject</button>`;
        } else if (effectiveStatus === 'Approved') {
            actionButtons = `<button class="btn btn-danger" data-modal-action="cancel" data-id="${res.id}">Cancel Reservation</button>`;
        }
        footer.innerHTML = actionButtons +
            `<button class="btn btn-secondary" onclick="closeModal('viewReservationModal')">Close</button>`;

        // Wire the modal action buttons via delegation.
        footer.querySelectorAll('[data-modal-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-modal-action');
                const targetId = Number(btn.getAttribute('data-id'));
                if (action === 'approve') approveReservation(targetId);
                else if (action === 'reject') rejectReservation(targetId);
                else if (action === 'cancel') cancelReservation(targetId);
            });
        });
    }

    document.getElementById('viewReservationModal').classList.add('show');
}

// ===== ACTIONS =====
async function runReservationAction({ confirmText, request, successText, failText }) {
    if (actionInFlight) return;
    if (!confirm(confirmText)) return;

    actionInFlight = true;
    setModalButtonsDisabled(true);
    try {
        const result = await request();
        if (result && result.success) {
            showToast(successText, 'success');
            closeModal('viewReservationModal');
            await loadReservations({ background: true, force: true });
        } else {
            showToast((result && result.message) || failText, 'error');
        }
    } catch (err) {
        showToast(err.message || failText, 'error');
    } finally {
        actionInFlight = false;
        setModalButtonsDisabled(false);
    }
}

function setModalButtonsDisabled(disabled) {
    document.querySelectorAll('#reservationModalFooter .btn, .reservation-actions .btn')
        .forEach(b => { b.disabled = disabled; });
}

function blockIfOverdue(id) {
    const res = findReservation(id);
    if (res && getEffectiveStatus(res) === 'Overdue') {
        showToast('This reservation is overdue and can no longer be modified.', 'warning');
        closeModal('viewReservationModal');
        return true;
    }
    return false;
}

function approveReservation(id) {
    if (blockIfOverdue(id)) return;
    return runReservationAction({
        confirmText: 'Approve this reservation?',
        request: () => api.approveReservation(id),
        successText: 'Reservation approved successfully',
        failText: 'Failed to approve'
    });
}

function rejectReservation(id) {
    if (blockIfOverdue(id)) return;
    return runReservationAction({
        confirmText: 'Reject this reservation?',
        request: () => api.rejectReservation(id),
        successText: 'Reservation rejected',
        failText: 'Failed to reject'
    });
}

function cancelReservation(id) {
    if (blockIfOverdue(id)) return;
    return runReservationAction({
        confirmText: 'Cancel this reservation?',
        request: () => api.cancelReservation(id),
        successText: 'Reservation cancelled',
        failText: 'Failed to cancel'
    });
}

// ===== HELPERS =====
function getStudentName(r) {
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

function formatComputerLabel(r) {
    const raw = r && (r.computer_number ?? r.computer_name);
    if (!raw) return 'Unknown';
    const str = String(raw).trim();
    return /^pc-/i.test(str) ? str : `PC-${str}`;
}

function formatDate(date) {
    const d = parseDateTime(date);
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(time) {
    if (!time) return '—';
    const parts = String(time).split(':').map(Number);
    const h = parts[0], m = parts[1] || 0;
    if (isNaN(h)) return '—';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// FIX: same null/undefined-only guard as the other admin scripts.
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

// ===== AUTO REFRESH =====
function startAutoRefresh() {
    setInterval(() => {
        if (document.hidden || actionInFlight) return;
        loadReservations({ background: true });
    }, REFRESH_MS);
}

// ===== MODAL HELPERS =====
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
}

// ===== GLOBAL EXPORTS =====
window.closeModal = closeModal;
window.viewReservation = viewReservation;
window.approveReservation = approveReservation;
window.rejectReservation = rejectReservation;
window.cancelReservation = cancelReservation;