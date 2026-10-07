// frontend/admin/js/computer-management.js
document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('admin')) return;
    initializeComputerManagement();
    setupEventListeners();
    startAutoRefresh();
});

let currentPage = 1;
let perPage = 12;
let totalPages = 1;
let currentFilters = {};
let allComputers = [];
let editingComputerOriginal = null;
let liveSessionInterval = null;
let currentLiveSession = null;
let activeSessionsCache = [];
let historySessionsCache = [];
let historySearchTerm = '';

if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info') { alert(message); };
}

const ICONS = {
    computer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="48" height="48"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12"><path d="M12 21s7-6.5 7-11.5a7 7 0 1 0-14 0C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
};

// ===== HELPER FUNCTIONS =====
function getStudentName(session) {
    if (!session) return 'Unknown';
    if (session.first_name || session.last_name) return [session.first_name, session.last_name].filter(Boolean).join(' ') || 'Unknown';
    let name = session.student_name || session.student_full_name || session.full_name || session.user_name || session.username || session.name || session.patron_name || session.patron?.name;
    if (!name && session.student && typeof session.student === 'object') name = session.student.name || session.student.full_name || session.student.student_name;
    if (!name && session.user && typeof session.user === 'object') name = session.user.name || session.user.full_name || session.user.username;
    if (!name && session.patron && typeof session.patron === 'object') name = session.patron.name || session.patron.full_name;
    return name || 'Unknown';
}

function getComputerNumber(session, fallbackNumber = '') {
    if (session.computer_number) return session.computer_number;
    if (session.computer_name) return session.computer_name;
    if (session.computer_id) {
        const comp = allComputers.find(c => String(c.id) === String(session.computer_id));
        if (comp) return comp.computer_number;
        return `PC-${session.computer_id}`;
    }
    return fallbackNumber || 'Unknown';
}

function formatTime(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    const d = new Date(dateString);
    if (isNaN(d)) return '-';
    return d.toLocaleString();
}

function formatDuration(minutes) {
    if (minutes === null || minutes === undefined) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDurationFromSeconds(seconds) {
    if (seconds === null || seconds === undefined || seconds < 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ============================================================
 * MANILA-SAFE DATETIME PARSER
 * ============================================================ */
function parseManilaDateTime(value) {
    if (!value) return null;
    const str = String(value).trim();

    if (/[+-]\d{2}:?\d{2}$|Z$/i.test(str)) {
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }

    const withOffset = /T/.test(str) ? `${str}+08:00` : `${str.replace(' ', 'T')}+08:00`;
    const d = new Date(withOffset);
    return isNaN(d.getTime()) ? null : d;
}

function createAvatarHtml(photoUrl, initials, size = 32) {
    const fallbackHtml = `<div style="width:${size}px; height:${size}px; border-radius:50%; background:#2b2d82; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:${Math.round(size/2.5)}px; overflow:hidden;">${initials}</div>`;
    if (!photoUrl) return fallbackHtml;
    const resolvedUrl = resolvePhotoUrl(photoUrl);
    if (!resolvedUrl) return fallbackHtml;
    return `<img src="${resolvedUrl}" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; display:block; flex-shrink:0;" onerror="this.outerHTML='${fallbackHtml.replace(/'/g, "\\'")}';">`;
}

function resolvePhotoUrl(photoUrl) {
    if (!photoUrl) return null;
    if (/^(https?:)?\/\//i.test(photoUrl)) return photoUrl;
    const backendRoot = API_CONFIG.baseURL.replace(/\/api\/index\.php.*$/i, '');
    const cleanPath = photoUrl.replace(/^\/+/, '');
    return `${backendRoot}/${cleanPath}`;
}

async function isComputerOccupied(computerId) {
    try {
        const response = await api.getComputer(computerId);
        if (response.success && response.data) return response.data.status === 'Occupied';
        return false;
    } catch (error) { console.error('Failed to check computer status:', error); return false; }
}

// ===== INITIALIZATION =====
async function initializeComputerManagement() {
    try {
        updateUserInfo();
        await loadComputers();
        await loadStats();
        await loadActiveSessions();
        await loadComputerHistoryDropdown();
        setupTabs();
    } catch (error) { console.error('Initialization error:', error); showToast('Failed to load computer data: ' + error.message, 'error'); }
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
    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarAvatar = document.getElementById('sidebarUserAvatar');
    if (sidebarName) sidebarName.textContent = userName;
    if (sidebarAvatar) sidebarAvatar.innerHTML = createAvatarHtml(photoUrl, initial, 40);
    const navName = document.getElementById('userNameNav');
    const navAvatar = document.getElementById('userAvatarNav');
    if (navName) navName.textContent = userName;
    if (navAvatar) navAvatar.innerHTML = createAvatarHtml(photoUrl, initial, 36);
}

// ===== COMPUTERS =====
async function loadComputers(page = 1) {
    currentPage = page;
    try {
        const response = await api.getComputers({});
        if (response.success) {
            allComputers = response.data || [];
            applyClientFilters();
            loadStats();
        } else {
            throw new Error(response.message || 'Failed to load computers');
        }
    } catch (error) {
        console.error('Failed to load computers:', error);
        showToast('Failed to load computers: ' + error.message, 'error');
        showEmptyState();
    }
}

function applyClientFilters() {
    const status = currentFilters.status || '';
    const filtered = allComputers.filter(c => {
        if (status && c.status !== status) return false;
        return true;
    });

    const totalFiltered = filtered.length;
    totalPages = Math.max(1, Math.ceil(totalFiltered / perPage));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * perPage;
    const pageSlice = filtered.slice(start, start + perPage);

    renderComputers(pageSlice);
    updatePagination({
        current_page: currentPage,
        total_pages: totalPages,
        per_page: perPage,
        total: totalFiltered,
    });
}

function renderComputers(computers) {
    const container = document.getElementById('computerGrid');
    if (!container) return;
    if (!computers || computers.length === 0) {
        container.innerHTML = `<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: var(--spacing-xxl);"><span class="empty-icon">${ICONS.computer}</span><div class="empty-text">No computers found</div><div class="empty-subtext">Click "Add Computer" to add a new computer</div></div>`;
        return;
    }
    container.innerHTML = '';
    computers.forEach(computer => {
        const statusClass = `status-${computer.status}`;
        const statusLabel = String(computer.status || '').toUpperCase();
        const div = document.createElement('div');
        div.className = `computer-card ${statusClass}`;
        const isOccupied = computer.status === 'Occupied';
        const clickable = isOccupied ? 'data-clickable="1"' : '';
        div.innerHTML = `
            <div class="computer-number" ${clickable}>${escapeHtml(computer.computer_number)}</div>
            <div class="computer-name" ${clickable}>${escapeHtml(computer.computer_name || 'Unnamed')}</div>
            <div class="computer-status" ${clickable}>${escapeHtml(statusLabel)}</div>
            ${computer.current_user ? `<div class="computer-user" ${clickable}>${ICONS.user} ${escapeHtml(computer.current_user)}</div>` : ''}
            <div class="computer-actions">
                <button class="btn btn-sm btn-primary" data-action="manage" data-computer-id="${computer.id}" title="Manage">${ICONS.edit} Manage</button>
            </div>`;
        if (isOccupied) {
            div.dataset.computerId = String(computer.id);
            div.addEventListener('click', function (e) {
                if (e.target.closest('button')) return;
                openLiveSessionFromComputer(computer.id);
            });
        }
        container.appendChild(div);
    });
    container.querySelectorAll('[data-action="manage"]').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openComputerManageModal(Number(btn.getAttribute('data-computer-id')));
        });
    });
}

function showEmptyState() {
    const container = document.getElementById('computerGrid');
    if (container) container.innerHTML = `<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: var(--spacing-xxl);"><span class="empty-icon">${ICONS.computer}</span><div class="empty-text">No computers found</div><div class="empty-subtext">Click "Add Computer" to add a new computer</div></div>`;
}

function updatePagination(pagination) {
    if (!pagination || typeof pagination !== 'object') {
        document.getElementById('pageStart').textContent = allComputers.length > 0 ? 1 : 0;
        document.getElementById('pageEnd').textContent = allComputers.length;
        document.getElementById('totalRecords').textContent = allComputers.length;
        const buttonsContainer = document.getElementById('paginationButtons');
        if (buttonsContainer) buttonsContainer.innerHTML = '';
        return;
    }
    totalPages = pagination.total_pages || 1;
    const total = pagination.total || 0;
    const start = total > 0 ? ((pagination.current_page - 1) * pagination.per_page) + 1 : 0;
    const end = total > 0 ? Math.min(pagination.current_page * pagination.per_page, total) : 0;
    document.getElementById('pageStart').textContent = start;
    document.getElementById('pageEnd').textContent = end;
    document.getElementById('totalRecords').textContent = total;
    const buttonsContainer = document.getElementById('paginationButtons');
    if (!buttonsContainer) return;
    buttonsContainer.innerHTML = '';
    const prevBtn = createPaginationButton('‹', pagination.current_page > 1, () => { if (pagination.current_page > 1) { currentPage = pagination.current_page - 1; applyClientFilters(); } });
    buttonsContainer.appendChild(prevBtn);
    const maxVisible = 5;
    let startPage = Math.max(1, pagination.current_page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);
    if (startPage > 1) { buttonsContainer.appendChild(createPaginationButton('1', true, () => { currentPage = 1; applyClientFilters(); })); if (startPage > 2) buttonsContainer.appendChild(createPaginationButton('…', false)); }
    for (let i = startPage; i <= endPage; i++) buttonsContainer.appendChild(createPaginationButton(i, true, () => { currentPage = i; applyClientFilters(); }, i === pagination.current_page));
    if (endPage < totalPages) { if (endPage < totalPages - 1) buttonsContainer.appendChild(createPaginationButton('…', false)); buttonsContainer.appendChild(createPaginationButton(totalPages, true, () => { currentPage = totalPages; applyClientFilters(); })); }
    const nextBtn = createPaginationButton('›', pagination.current_page < totalPages, () => { if (pagination.current_page < totalPages) { currentPage = pagination.current_page + 1; applyClientFilters(); } });
    buttonsContainer.appendChild(nextBtn);
}

function createPaginationButton(label, enabled, onClick, active = false) {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (active) btn.classList.add('active');
    if (!enabled) btn.disabled = true;
    if (enabled && onClick) btn.addEventListener('click', onClick);
    return btn;
}

function loadStats() {
    const total = allComputers.length;
    const available = allComputers.filter(c => c.status === 'Available').length;
    const occupied = allComputers.filter(c => c.status === 'Occupied').length;
    const reserved = allComputers.filter(c => c.status === 'Reserved').length;
    const maintenance = allComputers.filter(c => c.status === 'Maintenance').length;

    document.getElementById('totalComputers').textContent = total;
    document.getElementById('availableComputers').textContent = available;
    document.getElementById('occupiedComputers').textContent = occupied;
    document.getElementById('reservedComputers').textContent = reserved;
    document.getElementById('maintenanceComputers').textContent = maintenance;
}

// ===== ACTIVE SESSIONS – TABLE RENDER =====
async function loadActiveSessions() {
    try {
        const response = await api.getActiveSessions();
        if (response.success) {
            activeSessionsCache = response.data || [];
            renderActiveSessions(activeSessionsCache);
        } else { throw new Error(response.message || 'Failed to load active sessions'); }
    } catch (error) {
        console.error('Failed to load active sessions:', error);
        const tbody = document.getElementById('activeSessionsBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Failed to load active sessions</td></tr>';
    }
}

function renderActiveSessions(sessions) {
    const tbody = document.getElementById('activeSessionsBody');
    if (!tbody) return;
    if (!sessions || sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No active sessions</td></tr>';
        document.getElementById('activeSessionsStart').textContent = '0';
        document.getElementById('activeSessionsTotal').textContent = '0';
        return;
    }

    let html = '';
    sessions.forEach(session => {
        const studentName = getStudentName(session);
        const initials = studentName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const studentId = session.student_number || session.student_id || session.user_id || '';
        const computerNumber = session.computer_number || ('PC-' + session.computer_id);
        const computerName = session.computer_name || '';
        const loginTime = session.login_time ? formatDateTime(session.login_time) : '—';
        const duration = session.duration_minutes ? formatDuration(session.duration_minutes) : 'Active';
        const sessionType = String(session.session_type || 'WALK-IN').toUpperCase();
        const sessionTypeClass = sessionType === 'RESERVATION' ? 'badge-info' : 'badge-warning';

        html += `
        <tr>
            <td>
                <div class="student-cell">
                    ${createAvatarHtml(session.photo_url, initials, 36)}
                    <div>
                        <div class="student-name">${escapeHtml(studentName)}</div>
                        <div class="student-id">${escapeHtml(studentId)}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="computer-cell">
                    <strong>${escapeHtml(computerNumber)}</strong>
                    <div class="computer-name-sm">${escapeHtml(computerName)}</div>
                </div>
            </td>
            <td>${escapeHtml(loginTime)}</td>
            <td><span class="badge badge-success">${escapeHtml(duration)}</span></td>
            <td><span class="badge ${sessionTypeClass}">${escapeHtml(sessionType)}</span></td>
            <td>
                <button class="btn btn-sm btn-outline-primary" data-action="view-session" data-session-id="${session.id}">View</button>
                <button class="btn btn-sm btn-danger" data-action="end-session" data-session-id="${session.id}">End Session</button>
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;

    tbody.querySelectorAll('[data-action="view-session"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-session-id');
            const session = activeSessionsCache.find(s => String(s.id) === String(id));
            if (session) openLiveSessionModal(session);
        });
    });
    tbody.querySelectorAll('[data-action="end-session"]').forEach(btn => {
        btn.addEventListener('click', () => endSession(Number(btn.getAttribute('data-session-id'))));
    });

    document.getElementById('activeSessionsStart').textContent = sessions.length;
    document.getElementById('activeSessionsTotal').textContent = sessions.length;
}

// ===== COMPUTER HISTORY =====
async function loadComputerHistoryDropdown() {
    try {
        const response = await api.getComputers({});
        if (response.success) {
            const select = document.getElementById('historyComputerFilter');
            select.innerHTML = '<option value="">All Computers</option>';
            response.data.forEach(computer => { const option = document.createElement('option'); option.value = computer.id; option.textContent = `${computer.computer_number} - ${computer.computer_name || 'Unnamed'}`; select.appendChild(option); });
        }
    } catch (error) { console.error('Failed to load computer dropdown:', error); }
}

async function loadComputerHistory() {
    const computerId = document.getElementById('historyComputerFilter').value;
    const tbody = document.getElementById('computerHistoryBody');
    try {
        const params = computerId ? { computer_id: computerId, limit: 50 } : { limit: 50 };
        const response = await api.getSessions(params);
        if (response.success) {
            historySessionsCache = response.data || [];
            renderComputerHistory();
        } else { throw new Error(response.message || 'Failed to load history'); }
    } catch (error) {
        console.error('Failed to load history:', error);
        showToast('Failed to load computer history: ' + error.message, 'error');
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Failed to load history</td></tr>';
    }
}

function renderComputerHistory() {
    const tbody = document.getElementById('computerHistoryBody');
    if (!tbody) return;

    const computerId = document.getElementById('historyComputerFilter').value;
    const selectedComputer = allComputers.find(c => String(c.id) === String(computerId));
    const fallbackNumber = selectedComputer ? selectedComputer.computer_number : '';
    const search = historySearchTerm.toLowerCase().trim();

    const sessions = historySessionsCache.filter(session => {
        if (!search) return true;
        const haystack = [
            getComputerNumber(session, fallbackNumber),
            session.computer_name || '',
            getStudentName(session),
            session.student_number || '',
            session.session_type || ''
        ].join(' ').toLowerCase();
        return haystack.includes(search);
    });

    if (sessions.length === 0) {
        const msg = search ? 'No history matches your search' : 'No history found';
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">${msg}</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    sessions.forEach(session => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(getComputerNumber(session, fallbackNumber))}</td><td>${escapeHtml(getStudentName(session))}</td><td>${escapeHtml(formatDateTime(session.login_time))}</td><td>${session.logout_time ? escapeHtml(formatDateTime(session.logout_time)) : 'In Progress'}</td><td>${session.duration_minutes ? escapeHtml(formatDuration(session.duration_minutes)) : '-'}</td><td><span class="badge badge-info">${escapeHtml(session.session_type || 'Regular')}</span></td>`;
        tbody.appendChild(tr);
    });
}

// ===== TABS =====
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.classList.add('active');
            if (tabName === 'active-sessions') loadActiveSessions();
            if (tabName === 'computer-history') loadComputerHistory();
        });
    });
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    const historySearch = document.getElementById('searchHistory');
    if (historySearch) historySearch.addEventListener('input', debounce(function(e) { historySearchTerm = e.target.value.trim(); renderComputerHistory(); }, 300));
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) filterStatus.addEventListener('change', function(e) { currentFilters.status = e.target.value; currentPage = 1; applyClientFilters(); });
    const addForm = document.getElementById('addComputerForm');
    if (addForm) addForm.addEventListener('submit', async function(e) { e.preventDefault(); await addComputer(this); });
    const editForm = document.getElementById('editComputerForm');
    if (editForm) editForm.addEventListener('submit', async function(e) { e.preventDefault(); await updateComputer(this); });
    const historyFilter = document.getElementById('historyComputerFilter');
    if (historyFilter) historyFilter.addEventListener('change', loadComputerHistory);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeAllModals(); });
}

// ===== MODALS =====
function openAddComputerModal() {
    document.getElementById('addComputerForm').reset();
    const modal = document.getElementById('addComputerModal');
    modal.classList.add('show');
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) backdrop.classList.add('show');
    document.body.style.overflow = 'hidden';
}

async function addComputer(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const number = (data.computer_number || '').trim();
    if (!number) {
        showToast('Please enter a computer number', 'warning');
        return;
    }
    if (number.length > 20) {
        showToast('Computer number must be 20 characters or fewer.', 'warning');
        return;
    }
    if (allComputers.some(c => c.computer_number.toLowerCase() === number.toLowerCase())) {
        showToast('A computer with this number already exists.', 'warning');
        return;
    }
    data.computer_number = number;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    try {
        const response = await api.createComputer(data);
        if (response.success) { showToast('Computer added successfully', 'success'); closeModal('addComputerModal'); await loadComputers(currentPage); }
        else { showToast('Failed to add computer: ' + (response.message || 'Unknown error'), 'error'); }
    } catch (error) { showToast('Failed to add computer: ' + (error.message || 'Unknown error'), 'error'); }
    finally { submitBtn.classList.remove('loading'); submitBtn.disabled = false; }
}

async function openComputerManageModal(id) {
    try {
        const computerRes = await api.getComputer(id);
        if (!computerRes.success) throw new Error(computerRes.message);
        const computer = computerRes.data;
        let sessions = [];
        try { const historyRes = await api.getComputerHistory(id); if (historyRes.success) sessions = historyRes.data || []; } catch (e) { console.warn('Failed to load history for modal:', e); }
        editingComputerOriginal = { computer_number: computer.computer_number || '', computer_name: computer.computer_name || '', status: computer.status || '' };
        document.getElementById('manageComputerName').textContent = computer.computer_number || 'Unnamed';
        document.getElementById('manageComputerStatus').textContent = computer.status;
        document.getElementById('editComputerId').value = computer.id;
        document.getElementById('editComputerNumber').value = computer.computer_number;
        document.getElementById('editComputerName').value = computer.computer_name || '';
        document.getElementById('editComputerStatus').value = computer.status;
        const statusSelect = document.getElementById('editComputerStatus');
        const isOccupied = computer.status === 'Occupied';
        Array.from(statusSelect.options).forEach(option => { if (isOccupied && (option.value === 'Available' || option.value === 'Maintenance')) option.disabled = true; else option.disabled = false; });
        const tbody = document.getElementById('computerHistoryDetailBody');
        tbody.innerHTML = '';
        if (!sessions || sessions.length === 0) tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No history found</td></tr>';
        else { sessions.forEach(s => { tbody.innerHTML += `<tr><td>${escapeHtml(getStudentName(s))}</td><td>${escapeHtml(formatDateTime(s.login_time))}</td><td>${s.logout_time ? escapeHtml(formatDateTime(s.logout_time)) : 'In Progress'}</td><td>${s.duration_minutes ? escapeHtml(formatDuration(s.duration_minutes)) : '-'}</td><td><span class="badge badge-info">${escapeHtml(s.session_type || 'Regular')}</span></td></tr>`; }); }
        const modal = document.getElementById('computerManageModal');
        modal.classList.add('show');
        const backdrop = modal.querySelector('.modal-backdrop');
        if (backdrop) backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
    } catch (error) { console.error('Failed to open manage modal:', error); showToast('Failed to load computer details: ' + error.message, 'error'); }
}

// ===== UPDATE COMPUTER =====
async function updateComputer(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const id = data.computer_id;
    const newStatus = data.status;
    delete data.computer_id;
    delete data.status;

    const number = (data.computer_number || '').trim();
    if (!number) { showToast('Please enter a computer number', 'warning'); return; }
    if (number.length > 20) { showToast('Computer number must be 20 characters or fewer.', 'warning'); return; }
    data.computer_number = number;

    if (editingComputerOriginal && number.toLowerCase() !== editingComputerOriginal.computer_number.toLowerCase()) {
        if (allComputers.some(c => String(c.id) !== String(id) && c.computer_number.toLowerCase() === number.toLowerCase())) {
            showToast('A computer with this number already exists.', 'warning');
            return;
        }
    }

    const currentStatus = document.getElementById('manageComputerStatus').textContent;
    if (newStatus === 'Occupied' || newStatus === 'Reserved') { showToast('Warning: Cannot set status to "' + newStatus + '" manually. This status is system-managed.', 'warning'); return; }
    const isOccupied = await isComputerOccupied(id);
    if (isOccupied && (newStatus === 'Available' || newStatus === 'Maintenance')) { showToast('Cannot set this computer to ' + newStatus + ' because it is currently occupied by a student.', 'error'); return; }

    if (editingComputerOriginal) {
        const isChanged = (
            (data.computer_number || '') !== editingComputerOriginal.computer_number ||
            (data.computer_name || '') !== editingComputerOriginal.computer_name ||
            newStatus !== editingComputerOriginal.status
        );
        if (!isChanged) { showToast('No changes were made to this computer.', 'warning'); return; }
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    try {
        const response = await api.updateComputer(id, data);
        if (response.success) {
            let message = 'Computer updated successfully';
            if (newStatus !== currentStatus) {
                if (newStatus === 'Maintenance') {
                    const maintRes = await api.setComputerMaintenance(id, true);
                    message = maintRes.success ? 'Computer updated and set to Maintenance' : 'Computer updated, but failed to set Maintenance: ' + (maintRes.message || 'Unknown error');
                } else if (newStatus === 'Available') {
                    const maintRes = await api.setComputerMaintenance(id, false);
                    message = maintRes.success ? 'Computer updated and set to Available' : 'Computer updated, but failed to set Available: ' + (maintRes.message || 'Unknown error');
                }
            }
            showToast(message, 'success');
            await loadComputers(currentPage);
        } else { showToast('Failed to update computer: ' + (response.message || 'Unknown error'), 'error'); }
    } catch (error) { console.error('Update Computer Error:', error); showToast('Error updating computer: ' + (error.message || 'Unknown error'), 'error'); }
    finally { submitBtn.classList.remove('loading'); submitBtn.disabled = false; }
}

async function toggleMaintenance() {
    const id = document.getElementById('editComputerId').value;
    const currentStatus = document.getElementById('editComputerStatus').value;
    const newStatus = currentStatus === 'Maintenance' ? 'Available' : 'Maintenance';
    const isOccupied = await isComputerOccupied(id);
    if (isOccupied && (newStatus === 'Available' || newStatus === 'Maintenance')) { showToast('Cannot set this computer to ' + newStatus + ' because it is currently occupied by a student.', 'error'); return; }
    if (!confirm(`Set this computer to ${newStatus}?`)) return;
    try {
        const response = await api.setComputerMaintenance(id, newStatus === 'Maintenance');
        if (response.success) { showToast(`Computer set to ${newStatus}`, 'success'); await loadComputers(currentPage); }
        else { showToast(`Failed to set ${newStatus}: ` + (response.message || 'Unknown error'), 'error'); }
    } catch (error) { showToast(`Failed to set ${newStatus}: ` + (error.message || 'Unknown error'), 'error'); }
}

// ===== END SESSION =====
async function endSession(id) {
    if (!confirm('End this session?')) return;
    try {
        const response = await api.endSession(id);
        if (response.success) { showToast('Session ended successfully', 'success'); await loadActiveSessions(); await loadComputers(currentPage); }
        else { showToast('Failed to end session: ' + (response.message || 'Unknown error'), 'error'); }
    } catch (error) { console.error('End session error:', error); showToast('Failed to end session: ' + (error.message || 'Unknown error'), 'error'); }
}

/* ============================================================
 * LIVE SESSION MODAL
 *
 * The countdown now mirrors the kiosk: it starts from the
 * student's TOTAL REMAINING SEMESTER HOURS (`remaining_hours`
 * from the students table), anchored at `login_time`. This is
 * the same number the student sees on their kiosk timer.
 *
 * The old "Time Elapsed" row has been removed from the modal
 * markup — with the remaining-hours countdown visible, elapsed
 * time is redundant.
 * ============================================================ */
async function openLiveSessionFromComputer(computerId) {
    try {
        const res = await api.getActiveSessions();
        if (res.success) {
            const sessions = res.data || [];
            const session = sessions.find(s => String(s.computer_id) === String(computerId) || String(s.computer_number) === String(computerId));
            if (session) openLiveSessionModal(session);
            else showToast('No active session found for this computer.', 'warning');
        } else throw new Error(res.message || 'Failed to load sessions');
    } catch (error) { console.error('Failed to load live session:', error); showToast('Failed to load session details', 'error'); }
}

function openLiveSessionModal(session) {
    currentLiveSession = session;
    const modal = document.getElementById('liveSessionModal');
    const studentName = getStudentName(session);
    const initials = studentName.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2);
    document.getElementById('liveSessionAvatar').textContent = initials;
    document.getElementById('liveSessionStudent').textContent = studentName;
    document.getElementById('liveSessionComputer').textContent = session.computer_number || ('PC-' + session.computer_id);
    document.getElementById('liveSessionStart').textContent = session.login_time ? formatDateTime(session.login_time) : '—';
    document.getElementById('liveSessionType').textContent = String(session.session_type || 'WALK-IN').toUpperCase();

    // Total countdown = the student's semester remaining hours.
    // The students table stores this as `remaining_hours` (float).
    const remainingHours = Number(session.remaining_hours);
    if (Number.isFinite(remainingHours) && remainingHours > 0) {
        currentLiveSession._totalSeconds = Math.round(remainingHours * 3600);
    } else {
        // Very rare — student has exhausted their hours. Show 0 and
        // let the modal reflect that.
        currentLiveSession._totalSeconds = 0;
    }

    // Countdown anchors at login_time so opening the modal mid-session
    // shows the true remaining value, in sync with the kiosk.
    const loginAt = parseManilaDateTime(session.login_time);
    currentLiveSession._loginAtMs = loginAt ? loginAt.getTime() : Date.now();

    updateLiveSessionTimer();
    if (modal) modal.classList.add('show');
    if (liveSessionInterval) clearInterval(liveSessionInterval);
    liveSessionInterval = setInterval(updateLiveSessionTimer, 1000);
}

function updateLiveSessionTimer() {
    if (!currentLiveSession) return;

    const startMs = Number.isFinite(currentLiveSession._loginAtMs)
        ? currentLiveSession._loginAtMs
        : Date.now();
    const totalSeconds = Number.isFinite(currentLiveSession._totalSeconds) && currentLiveSession._totalSeconds > 0
        ? currentLiveSession._totalSeconds
        : 0;

    if (totalSeconds <= 0) {
        const remainingEl = document.getElementById('liveSessionRemaining');
        if (remainingEl) remainingEl.textContent = '00:00:00';
        const ring = document.getElementById('timerRing');
        if (ring) ring.style.setProperty('--progress', 0);
        return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const remainingSeconds = Math.max(totalSeconds - elapsedSeconds, 0);

    const remainingEl = document.getElementById('liveSessionRemaining');
    if (remainingEl) remainingEl.textContent = formatDurationFromSeconds(remainingSeconds);

    const progress = Math.min((remainingSeconds / totalSeconds) * 100, 100);
    const ring = document.getElementById('timerRing');
    if (ring) ring.style.setProperty('--progress', progress);
}

function closeLiveSessionModal() {
    const modal = document.getElementById('liveSessionModal');
    if (modal) modal.classList.remove('show');
    currentLiveSession = null;
    if (liveSessionInterval) clearInterval(liveSessionInterval);
    liveSessionInterval = null;
}

function endSessionFromLiveModal() {
    if (!currentLiveSession || !currentLiveSession.id) return;
    const sessionId = currentLiveSession.id;
    closeLiveSessionModal();
    endSession(Number(sessionId));
}

// ===== AUTO REFRESH =====
function startAutoRefresh() {
    setInterval(() => {
        if (document.hidden) return;
        loadComputers(currentPage);
        loadStats();
        loadActiveSessions();
        const historyTab = document.getElementById('tab-computer-history');
        if (historyTab && historyTab.classList.contains('active')) loadComputerHistory();
    }, 30000);
}

function debounce(func, wait) {
    let timeout;
    return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); };
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('show');
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) backdrop.classList.remove('show');
    const anyOpen = document.querySelector('.modal.show');
    if (!anyOpen) document.body.style.overflow = '';
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('show');
        const backdrop = modal.querySelector('.modal-backdrop');
        if (backdrop) backdrop.classList.remove('show');
    });
    document.body.style.overflow = '';
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Expose global functions
window.openAddComputerModal = openAddComputerModal;
window.openComputerManageModal = openComputerManageModal;
window.toggleMaintenance = toggleMaintenance;
window.endSession = endSession;
window.endSessionFromLiveModal = endSessionFromLiveModal;
window.loadComputerHistory = loadComputerHistory;
window.closeModal = closeModal;
window.openLiveSessionFromComputer = openLiveSessionFromComputer;
window.openLiveSessionModal = openLiveSessionModal;
window.closeLiveSessionModal = closeLiveSessionModal;