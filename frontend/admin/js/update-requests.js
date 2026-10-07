// frontend/admin/js/update-requests.js
const PAGE_SIZE = 10;
const AUTO_REFRESH_MS = 30000;

// FIX: caps that mirror the backend's own validation, so the client can
// reject obvious garbage before the round trip.
const SEARCH_MAX_LENGTH = 100;

let allRequests = [];
let filteredRequests = [];
let currentPage = 1;
let totalPages = 1;
let currentFilters = { search: '', status: '', request_type: '' };
let pendingAction = null;
let actionInFlight = false;

document.addEventListener('DOMContentLoaded', function () {
    if (!sessionManager.requireRole('admin')) return;

    initializeUpdateRequests();
    setupEventListeners();
    startAutoRefresh();
});

async function initializeUpdateRequests() {
    updateUserInfo();
    await loadRequests();
    loadUnreadNotificationCount();
}

// FIX: was clobbering the avatar that navbar.js already rendered. navbar.js
// runs first (its DOMContentLoaded handler is registered earlier in the
// page) and correctly builds the <img>/fallback markup from user.photo_url.
// This function then replaced the whole element's content with just the
// text initials, wiping the avatar image on this page every time.
//
// The avatar and the sidebar's name/photo are already handled by
// navbar.js and sidebar.js respectively, so we only manage the small
// navbar name here as a harmless no-op safety net.
function updateUserInfo() {
    const user = sessionManager.getUser();
    if (!user) return;

    const userName = sessionManager.getUserName() || 'Admin';

    const navNameEl = document.getElementById('userNameNav');
    if (navNameEl) navNameEl.textContent = userName;
}

async function loadUnreadNotificationCount() {
    try {
        const res = await api.getUnreadNotificationCount();
        if (res.success && res.data && typeof res.data.unread !== 'undefined') {
            const badge = document.getElementById('notificationBadgeNav');
            if (badge) badge.textContent = res.data.unread;
        }
    } catch (err) {
        console.error('Failed to load notification count:', err);
    }
}

async function loadRequests() {
    const tbody = document.getElementById('requestsTableBody');
    if (tbody && !allRequests.length) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="7">Loading requests…</td></tr>';
    }

    try {
        const response = await api.getUpdateRequests();
        if (response.success) {
            allRequests = response.data || [];
            applyFiltersAndPaginate(1);
        } else {
            throw new Error(response.message || 'Failed to load requests');
        }
    } catch (error) {
        console.error('Failed to load update requests:', error);
        if (!allRequests.length) {
            showToast('Failed to load update requests: ' + error.message, 'error');
            showEmptyState(error.message);
        }
    }
}

function showEmptyState(message) {
    const tbody = document.getElementById('requestsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="7">' + escapeHtml(message || 'No requests found') + '</td></tr>';
    }
    updateCounts();
}

function applyFiltersAndPaginate(page) {
    const search = currentFilters.search.toLowerCase().trim();
    const status = currentFilters.status;
    const requestType = currentFilters.request_type;

    filteredRequests = allRequests.filter(r => {
        const matchesSearch = !search ||
            (r.student_name || '').toLowerCase().includes(search) ||
            (r.request_type || '').toLowerCase().includes(search) ||
            (r.new_value || '').toLowerCase().includes(search);
        const matchesStatus = !status || r.status === status;
        const matchesType = !requestType || r.request_type === requestType;
        return matchesSearch && matchesStatus && matchesType;
    });

    totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, page), totalPages);
    renderRequests();
    updatePagination();
    updateCounts();
}

function renderRequests() {
    const tbody = document.getElementById('requestsTableBody');
    if (!tbody) return;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRequests = filteredRequests.slice(start, start + PAGE_SIZE);

    if (pageRequests.length === 0) {
        tbody.innerHTML = `<tr class="table-empty"><td colspan="7">No requests match your filters</td></tr>`;
        return;
    }

    tbody.innerHTML = pageRequests.map(request => {
        const statusBadgeClass = request.status === 'Approved' ? 'badge-success'
            : request.status === 'Rejected' ? 'badge-danger'
            : 'badge-warning';

        const dateRequested = request.created_at
            ? formatDateTime(new Date(String(request.created_at).replace(' ', 'T')))
            : '—';

        const actions = request.status === 'Pending' && !actionInFlight
            ? '<div class="d-flex gap-1">' +
                '<button class="btn btn-sm btn-success" data-approve="' + request.id + '">Approve</button>' +
                '<button class="btn btn-sm btn-danger" data-reject="' + request.id + '">Reject</button>' +
              '</div>'
            : '<span class="text-muted">—</span>';

        return (
            '<tr>' +
                '<td>' + escapeHtml(request.student_name || '') +
                    ' <span class="text-muted" style="font-size:var(--font-size-xs);">(' + escapeHtml(request.student_number || '') + ')</span></td>' +
                '<td>' + escapeHtml(request.request_type || '') + '</td>' +
                '<td>' + escapeHtml(request.old_value || '') + '</td>' +
                '<td>' + escapeHtml(request.new_value || '') + '</td>' +
                '<td><span class="badge ' + statusBadgeClass + '">' + escapeHtml(request.status || '') + '</span></td>' +
                '<td>' + escapeHtml(dateRequested) + '</td>' +
                '<td>' + actions + '</td>' +
            '</tr>'
        );
    }).join('');

    document.querySelectorAll('[data-approve]').forEach(btn => {
        btn.addEventListener('click', () => openConfirm(btn.getAttribute('data-approve'), 'Approved'));
    });
    document.querySelectorAll('[data-reject]').forEach(btn => {
        btn.addEventListener('click', () => openConfirm(btn.getAttribute('data-reject'), 'Rejected'));
    });
}

function updatePagination() {
    const pageStartEl = document.getElementById('pageStart');
    const pageEndEl = document.getElementById('pageEnd');
    const totalRecordsEl = document.getElementById('totalRecords');
    const wrap = document.getElementById('paginationButtons');

    const total = filteredRequests.length;
    const start = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);

    if (pageStartEl) pageStartEl.textContent = start;
    if (pageEndEl) pageEndEl.textContent = end;
    if (totalRecordsEl) totalRecordsEl.textContent = total;

    if (!wrap) return;
    wrap.innerHTML = '';

    const prev = document.createElement('button');
    prev.className = 'btn btn-sm btn-light';
    prev.textContent = '‹';
    prev.disabled = currentPage <= 1;
    prev.addEventListener('click', () => { currentPage--; renderRequests(); updatePagination(); });
    wrap.appendChild(prev);

    const maxButtons = 5;
    let pStart = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let pEnd = Math.min(totalPages, pStart + maxButtons - 1);
    pStart = Math.max(1, pEnd - maxButtons + 1);

    for (let p = pStart; p <= pEnd; p++) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm ' + (p === currentPage ? 'btn-primary' : 'btn-light');
        btn.textContent = String(p);
        btn.addEventListener('click', () => { currentPage = p; renderRequests(); updatePagination(); });
        wrap.appendChild(btn);
    }

    const next = document.createElement('button');
    next.className = 'btn btn-sm btn-light';
    next.textContent = '›';
    next.disabled = currentPage >= totalPages;
    next.addEventListener('click', () => { currentPage++; renderRequests(); updatePagination(); });
    wrap.appendChild(next);
}

function updateCounts() {
    const total = allRequests.length;
    const pending = allRequests.filter(r => r.status === 'Pending').length;
    const approved = allRequests.filter(r => r.status === 'Approved').length;
    const rejected = allRequests.filter(r => r.status === 'Rejected').length;

    setText('totalRequests', total);
    setText('pendingRequests', pending);
    setText('approvedRequests', approved);
    setText('rejectedRequests', rejected);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Reject an id that isn't a positive integer before it reaches the
 * confirm modal or the API. The ids come from the backend and are
 * always positive ints, so this is a belt-and-braces guard against
 * a future shape change or a hand-crafted click.
 */
function validateRequestId(id) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        return null;
    }
    return n;
}

/**
 * Whitelist the decision value. The backend only accepts 'Approved'
 * and 'Rejected'; rejecting anything else here keeps a malformed
 * click from sending garbage on the wire.
 */
function validateDecision(decision) {
    return decision === 'Approved' || decision === 'Rejected' ? decision : null;
}

/**
 * Sanitize the search box before it reaches the client-side filter.
 * Trims, drops absurd lengths, and treats an all-whitespace query
 * as "no filter" so the list isn't blanked by an accidental space.
 */
function sanitizeSearch(raw) {
    let s = String(raw || '').trim();
    if (s.length > SEARCH_MAX_LENGTH) {
        s = s.substring(0, SEARCH_MAX_LENGTH);
    }
    return s;
}

// ---- Approve / Reject confirmation modal ----
function openConfirm(id, decision) {
    const cleanId = validateRequestId(id);
    const cleanDecision = validateDecision(decision);

    if (cleanId === null || cleanDecision === null) {
        showToast('Invalid request — please refresh and try again.', 'warning');
        return;
    }

    // The request must still exist and still be Pending. If the list has
    // been refreshed while the modal was open, we may be acting on a
    // stale row that was already reviewed on another tab.
    const target = allRequests.find(r => Number(r.id) === cleanId);
    if (!target) {
        showToast('This request no longer exists. Refresh to see the latest.', 'warning');
        return;
    }
    if (target.status !== 'Pending') {
        showToast('This request has already been ' + String(target.status).toLowerCase() + '.', 'warning');
        return;
    }

    pendingAction = { id: cleanId, decision: cleanDecision };

    const msgEl = document.getElementById('confirmMessage');
    const btnEl = document.getElementById('confirmActionBtn');

    if (msgEl) {
        msgEl.textContent = cleanDecision === 'Approved'
            ? 'Approve this update request? The change will be applied to the student record immediately.'
            : 'Reject this update request? The student will be notified.';
    }
    if (btnEl) {
        btnEl.textContent = cleanDecision === 'Approved' ? 'Approve' : 'Reject';
        btnEl.className = 'btn ' + (cleanDecision === 'Approved' ? 'btn-primary' : 'btn-danger');
        btnEl.disabled = false;
    }

    document.getElementById('confirmModal').classList.add('show');
}

async function executeConfirmAction() {
    if (!pendingAction) return;
    if (actionInFlight) return;

    const { id, decision } = pendingAction;
    const btn = document.getElementById('confirmActionBtn');
    actionInFlight = true;
    if (btn) btn.disabled = true;

    try {
        const res = await api.reviewUpdateRequest(id, decision);
        if (!res.success) throw new Error(res.message || 'Failed to review request');
        showToast('Request ' + decision.toLowerCase(), 'success');
        closeModal('confirmModal');
        pendingAction = null;
        await loadRequests();
    } catch (err) {
        showToast(err.message || 'Failed to review request', 'error');
    } finally {
        actionInFlight = false;
        if (btn) btn.disabled = false;
    }
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
}

// ---- Filters ----
function applyFilters() {
    currentFilters.search = sanitizeSearch(document.getElementById('searchRequest').value);
    currentFilters.status = document.getElementById('filterStatus').value || '';
    currentFilters.request_type = document.getElementById('filterType').value || '';
    applyFiltersAndPaginate(1);
}

function resetFilters() {
    document.getElementById('searchRequest').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterType').value = '';
    currentFilters = { search: '', status: '', request_type: '' };
    applyFiltersAndPaginate(1);
}

async function refreshRequests() {
    await loadRequests();
    showToast('Requests refreshed', 'success');
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchRequest');
    if (searchInput) {
        searchInput.setAttribute('maxlength', String(SEARCH_MAX_LENGTH));
        searchInput.addEventListener('input', debounce(applyFilters, 300));
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyFilters();
            }
        });
    }

    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            sessionManager.logout();
        });
    }

    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar && toggle && backdrop) {
        toggle.addEventListener('click', () => {
            sidebar.classList.add('sidebar-open');
            backdrop.classList.add('show');
        });
        backdrop.addEventListener('click', () => {
            sidebar.classList.remove('sidebar-open');
            backdrop.classList.remove('show');
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal('confirmModal');
    });
}

function startAutoRefresh() {
    setInterval(() => {
        if (document.hidden || actionInFlight) return;
        loadRequests();
    }, AUTO_REFRESH_MS);
}

// FIX: null/undefined-only guard. The old `if (!text) return ''` also
// caught numeric 0 and boolean false, silently dropping them.
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function formatDateTime(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '—';
    return date.toLocaleString();
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

window.applyFilters = applyFilters;
window.resetFilters = resetFilters;
window.refreshRequests = refreshRequests;
window.closeModal = closeModal;
window.executeConfirmAction = executeConfirmAction;