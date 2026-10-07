// frontend/admin/js/reports.js
document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('admin')) return;
    initializeReports();
});

let lastGeneratedReport = null;
let currentReportType = '';

const VALID_REPORT_TYPES = ['daily', 'weekly', 'monthly', 'yearly', 'semester'];
const VALID_YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'];

// ===== TOAST FALLBACK (if notifications system isn't loaded) =====
if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info') {
        alert(message);
    };
}

// ===== AVATAR HELPER (shared pattern) =====
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

async function initializeReports() {
    try {
        await updateUserInfo();
        await populateCourseFilters();
        // Auto-generate daily on load
        quickSetType('daily');
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Failed to load reports', 'error');
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

            sessionManager.user = {
                ...user,
                full_name: fullName,
                email: profile.email,
                photo_url: photoUrl
            };
            sessionManager.api.setAuth(sessionManager.token, sessionManager.user);
        }
    } catch (err) {
        console.warn('Failed to fetch fresh profile:', err);
    }

    const navName = document.getElementById('userNameNav');
    const navAvatar = document.getElementById('userAvatarNav');
    if (navName) navName.textContent = userName;
    if (navAvatar) navAvatar.innerHTML = createAvatarHtml(photoUrl, initial, 36);

    const sidebarName = document.getElementById('sidebarUserName');
    const sidebarAvatar = document.getElementById('sidebarUserAvatar');
    if (sidebarName) sidebarName.textContent = userName;
    if (sidebarAvatar) sidebarAvatar.innerHTML = createAvatarHtml(photoUrl, initial, 40);
}

async function populateCourseFilters() {
    try {
        const response = await api.getStudents({ limit: 1000 });
        if (!response.success) return;

        const students = response.data || [];
        const courses = [...new Set(students.map(s => s.course).filter(Boolean))].sort();

        const courseSelect = document.getElementById('reportCourse');
        if (courseSelect) courseSelect.innerHTML = '<option value="">All Courses</option>' +
            courses.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    } catch (error) {
        console.error('Failed to load course filters:', error);
    }
}

// ============================================================
// VALIDATION
// ============================================================

/** Whitelist the report type clicked on a card. */
function validateReportType(raw) {
    if (!raw) return null;
    const t = String(raw).trim().toLowerCase();
    return VALID_REPORT_TYPES.includes(t) ? t : null;
}

/** Whitelist the optional year-level filter. */
function validateYearLevel(raw) {
    if (!raw) return null;
    const y = String(raw).trim();
    return VALID_YEAR_LEVELS.includes(y) ? y : null;
}

/** Cap the optional course filter; the backend caps at 100 chars. */
function validateCourse(raw) {
    if (!raw) return null;
    const c = String(raw).trim();
    if (c === '') return null;
    if (c.length > 100) return c.substring(0, 100);
    return c;
}

function quickSetType(type) {
    const clean = validateReportType(type);
    if (clean === null) {
        showToast('Invalid report type.', 'warning');
        return;
    }
    currentReportType = clean;

    // Highlight selected card
    document.querySelectorAll('.report-type-card').forEach(card => {
        card.classList.remove('active');
        if (card.dataset.type === clean) card.classList.add('active');
    });

    // Auto-generate
    autoGenerate();
}

async function autoGenerate() {
    if (!currentReportType) {
        showToast('Select a report type first', 'info');
        return;
    }

    const course = validateCourse(document.getElementById('reportCourse').value);
    const year = validateYearLevel(document.getElementById('reportYear').value);

    // Guard against a tampered <select> that somehow presents an invalid value.
    const rawYear = document.getElementById('reportYear').value;
    if (rawYear && year === null) {
        showToast('Invalid year level filter.', 'warning');
        return;
    }

    const data = {
        report_type: currentReportType,
        course: course || null,
        year: year || null
    };

    try {
        const response = await api.generateReport(data);
        if (response.success) {
            lastGeneratedReport = response.data;
            displayGeneratedReport(response.data);
        } else {
            showToast(response.message || 'Failed to generate report', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to generate report', 'error');
    }
}

function displayGeneratedReport(report) {
    if (!report || typeof report !== 'object') {
        showToast('Invalid report data received.', 'error');
        return;
    }

    const summary = report.summary || {};
    const reservations = report.reservations || {};
    const perComputer = Array.isArray(report.per_computer) ? report.per_computer : [];
    const perStudent = Array.isArray(summary.by_student) ? summary.by_student : [];
    const range = report.range || {};

    let computerRows = perComputer.map(c => `
        <tr><td>PC-${escapeHtml(c.computer_number)}</td><td>${escapeHtml(c.computer_name || '-')}</td><td>${escapeHtml(c.sessions)}</td><td>${escapeHtml(formatDuration(c.total_minutes))}</td></tr>
    `).join('');
    if (!computerRows) computerRows = '<tr><td colspan="4" class="text-center text-muted">No usage in this period</td></tr>';

    let studentRows = perStudent.map(s => `
        <tr><td>${escapeHtml(s.student_number)}</td><td>${escapeHtml(s.first_name)} ${escapeHtml(s.last_name)}</td><td>${escapeHtml(s.course || '-')}</td><td>${escapeHtml(s.year || '-')}</td><td>${escapeHtml(s.sessions)}</td><td>${escapeHtml(formatDuration(s.total_minutes))}</td></tr>
    `).join('');
    if (!studentRows) studentRows = '<tr><td colspan="6" class="text-center text-muted">No student usage in this period</td></tr>';

    const reportViewContent = document.getElementById('reportViewContent');
    if (reportViewContent) {
        reportViewContent.innerHTML = `
            <div class="report-header">
                <div class="report-title-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="24" height="24"><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/><circle cx="12" cy="14" r="2"/></svg>
                </div>
                <div>
                    <h2>${escapeHtml(report.type)} Report</h2>
                    <p class="report-period">Period: ${formatDate(range.start)} — ${formatDate(range.end)}</p>
                </div>
            </div>

            <div class="report-summary-cards">
                <div class="summary-card">
                    <div class="summary-icon summary-icon-purple">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/></svg>
                    </div>
                    <div>
                        <label>Total Sessions</label>
                        <p>${escapeHtml(summary.total_sessions || 0)}</p>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="summary-icon summary-icon-blue">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    </div>
                    <div>
                        <label>Total Hours</label>
                        <p>${escapeHtml(summary.total_hours || 0)}</p>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="summary-icon summary-icon-green">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/><path d="M8 13.5h2M14 13.5h2M8 17h2"/></svg>
                    </div>
                    <div>
                        <label>Total Reservations</label>
                        <p>${escapeHtml(reservations.total || 0)}</p>
                    </div>
                </div>
            </div>

            <div class="report-detail-grid">
                <div class="report-detail-card">
                    <h4>Reservation Summary</h4>
                    <div class="reservation-list">
                        <div class="res-item"><span class="dot dot-blue"></span><span>Total Reservations</span><strong>${escapeHtml(reservations.total || 0)}</strong></div>
                        <div class="res-item"><span class="dot dot-orange"></span><span>Pending</span><strong>${escapeHtml(reservations.pending || 0)}</strong></div>
                        <div class="res-item"><span class="dot dot-green"></span><span>Approved</span><strong>${escapeHtml(reservations.approved || 0)}</strong></div>
                        <div class="res-item"><span class="dot dot-red"></span><span>Rejected</span><strong>${escapeHtml(reservations.rejected || 0)}</strong></div>
                        <div class="res-item"><span class="dot dot-gray"></span><span>Cancelled</span><strong>${escapeHtml(reservations.cancelled || 0)}</strong></div>
                        <div class="res-item"><span class="dot dot-purple"></span><span>Completed</span><strong>${escapeHtml(reservations.completed || 0)}</strong></div>
                    </div>
                </div>

                <div class="report-detail-card">
                    <h4>Computer Usage</h4>
                    <table class="table table-sm">
                        <thead><tr><th>Computer</th><th>Sessions</th><th>Total Time</th></tr></thead>
                        <tbody>${computerRows}</tbody>
                    </table>
                </div>
            </div>

            <div class="report-detail-card" style="margin-top: 1rem;">
                <h4>Student Usage</h4>
                <table class="table table-sm">
                    <thead><tr><th>Student ID</th><th>Name</th><th>Course</th><th>Year</th><th>Sessions</th><th>Total Time</th></tr></thead>
                    <tbody>${studentRows}</tbody>
                </table>
            </div>
        `;
    }

    const container = document.getElementById('reportViewContainer');
    if (container) container.style.display = 'block';
}

function downloadExcel() {
    const reportContentEl = document.getElementById('reportViewContent');
    if (!reportContentEl) {
        showToast('No report to download. Generate a report first.', 'error');
        return;
    }
    const reportContent = reportContentEl.innerText;
    if (!reportContent || !reportContent.trim()) {
        showToast('No report to download. Generate a report first.', 'error');
        return;
    }
    const lines = reportContent.split('\n').filter(line => line.trim() !== '');
    const csv = lines.map(line => {
        if (line.includes(',')) return `"${line.replace(/"/g, '""')}"`;
        return line;
    }).join('\n');

    try {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${currentReportType || 'daily'}_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Excel file downloaded', 'success');
    } catch (err) {
        console.error('Failed to download report:', err);
        showToast('Failed to download report.', 'error');
    }
}

function downloadPDF() {
    const reportContentEl = document.getElementById('reportViewContent');
    if (!reportContentEl) {
        showToast('No report to download. Generate a report first.', 'error');
        return;
    }
    const reportContent = reportContentEl.innerHTML;
    if (!reportContent || !reportContent.trim()) {
        showToast('No report to download. Generate a report first.', 'error');
        return;
    }

    const printArea = document.getElementById('printArea');
    if (printArea) {
        printArea.innerHTML = reportContent;
        printArea.style.display = 'block';

        window.print();

        setTimeout(() => {
            printArea.style.display = 'none';
            printArea.innerHTML = '';
        }, 500);
    }
}

// Helper functions
function formatDate(dateString) {
    if (!dateString) return '—';
    const d = new Date(String(dateString).replace(' ', 'T'));
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDuration(minutes) {
    if (minutes === null || minutes === undefined) return '-';
    const n = Number(minutes);
    if (!Number.isFinite(n) || n < 0) return '-';
    const h = Math.floor(n / 60);
    const m = Math.floor(n % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// FIX: null/undefined-only guard. The old `if (!text) return ''` also
// caught numeric 0 and boolean false, silently dropping them.
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Expose functions globally
window.quickSetType = quickSetType;
window.autoGenerate = autoGenerate;
window.downloadExcel = downloadExcel;
window.downloadPDF = downloadPDF;