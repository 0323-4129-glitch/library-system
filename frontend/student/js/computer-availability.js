// frontend/student/js/computer-availability.js
/**
 * Wired to GET /computers, POST /reservations, GET /dashboard/student,
 * GET /sessions/student/{id} (usage history tab), and
 * GET /reservations/computer/{id}/date/{date} (for the lunch/reserved
 * slot preview inside the reserve modal).
 */

const COMPUTER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;

const MIN_LEAD_TIME_MS = 60 * 60 * 1000;
const MIN_RESERVATION_MINUTES = 15;
const MAX_RESERVATION_HOURS = 4;

// Lunch break window — mirrors the backend constants.
const LUNCH_START = '11:30';
const LUNCH_END   = '13:00';
const LUNCH_LABEL = '11:30 AM – 1:00 PM';

// Availability grid auto-refresh cadence.
const AVAILABILITY_REFRESH_MS = 30000;

let allComputers = [];
let hoursExhausted = false;
let activeComputerId = null;
let availabilityTimer = null;

/* ============================================================
 * TAB SWITCHING
 * ============================================================ */
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            tabs.forEach(t => {
                const on = t === tab;
                t.classList.toggle('active', on);
                t.setAttribute('aria-selected', on ? 'true' : 'false');
            });

            panels.forEach(p => {
                const on = p.dataset.panel === target;
                p.classList.toggle('active', on);
                p.hidden = !on;
            });

            if (target === 'usage' && !usageHistoryLoaded) {
                loadUsageHistory();
            }
        });
    });
}

/* ============================================================
 * AVAILABILITY
 * ============================================================ */
function paintChrome() {
    refreshChrome();
}

function renderCounts() {
    const counts = { Available: 0, Occupied: 0, Reserved: 0, Maintenance: 0 };
    allComputers.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
    Object.keys(counts).forEach((status) => setText(`count-${status}`, counts[status]));
}

function renderGrid() {
    const status = byId('filter-status').value;
    const filtered = allComputers.filter((c) => status === 'all' || c.status === status);

    const grid = byId('computer-grid');
    if (!grid) return;

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <span class="empty-icon">${COMPUTER_ICON}</span>
                <h3>No computers match those filters</h3>
                <p>Try a different status.</p>
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map((c) => {
        const occ = getOccupancyInfo(c);
        const isWalkInBlocked = c.status === 'Occupied' && occ.isWalkIn;
        const disabled = hoursExhausted || c.status === 'Maintenance' || isWalkInBlocked;

        let actionsHTML = '';
        if (c.status === 'Maintenance') {
            actionsHTML = `<button class="btn btn-light btn-sm" disabled>Unavailable</button>`;
        } else if (isWalkInBlocked) {
            actionsHTML = `<button class="btn btn-light btn-sm" disabled title="Currently occupied by a walk-in student — can't be reserved until it's free">Reserve</button>`;
        } else {
            actionsHTML = `<button class="btn btn-primary btn-sm" data-action="reserve" data-id="${c.id}" ${disabled ? 'disabled' : ''}>Reserve</button>`;
        }

        let occupancyNoteHTML = '';
        if (c.status === 'Occupied' && occ.isWalkIn) {
            occupancyNoteHTML = `<div class="computer-occupancy-note walkin">In use (walk-in) — no scheduled end time</div>`;
        } else if (c.status === 'Occupied' && occ.endTime) {
            const remaining = formatRemaining(occ.endTime);
            if (remaining) {
                occupancyNoteHTML = `<div class="computer-occupancy-note">Free at ${escapeHtml(remaining.endLabel)} (${escapeHtml(remaining.remainingLabel)} left)</div>`;
            }
        } else if (c.status === 'Reserved' && occ.upcomingStart) {
            const startLabel = formatClock(occ.upcomingStart);
            const endLabel   = formatClock(occ.upcomingEnd);
            occupancyNoteHTML = `<div class="computer-occupancy-note reserved">Reserved from ${escapeHtml(startLabel)}${endLabel ? ' to ' + escapeHtml(endLabel) : ''}</div>`;
        }

        return `
            <div class="computer-card status-${c.status}">
                <div class="computer-number">${escapeHtml(c.computer_number || '')}</div>
                <div class="computer-name">${escapeHtml(c.computer_name || '')}</div>
                <span class="computer-status">${escapeHtml(c.status)}</span>
                ${occupancyNoteHTML}
                <div class="computer-actions">${actionsHTML}</div>
            </div>`;
    }).join('');

    qsa('[data-action="reserve"]', grid).forEach((btn) => onClick(btn, () => openModal(btn.dataset.id)));
}

/** Formats a bare "HH:MM(:SS)" string as "g:i AM/PM". */
function formatClock(value) {
    if (!value) return '';
    const parts = String(value).split(':').map(Number);
    const h = parts[0];
    const m = parts[1] || 0;
    if (isNaN(h)) return String(value);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getOccupancyInfo(c) {
    const session = c.current_session || c.active_session || c.current_reservation || null;

    const rawType = c.session_type || c.occupancy_type || c.current_session_type ||
        (session && session.type) || '';
    const type = String(rawType).toLowerCase().replace(/[\s_]/g, '-');
    const isWalkIn = type === 'walk-in' || type === 'walkin';

    const endTime = c.session_end_time || c.occupied_until || c.current_session_end ||
        (session && (session.end_time || session.reservation_end_time)) || null;

    const upcomingStart = c.upcoming_reservation_start
        || c.reserved_start_time
        || (c.upcoming_reservation && c.upcoming_reservation.start_time)
        || null;

    const upcomingEnd = c.upcoming_reservation_end
        || c.reserved_end_time
        || (c.upcoming_reservation && c.upcoming_reservation.end_time)
        || null;

    return { isWalkIn, endTime, upcomingStart, upcomingEnd };
}

function formatRemaining(endTimeValue) {
    if (!endTimeValue) return null;

    const now = new Date();
    let endDate;

    const bareMatch = /^(\d{1,2}):(\d{2})(:(\d{2}))?$/.exec(String(endTimeValue).trim());
    if (bareMatch) {
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
            parseInt(bareMatch[1], 10), parseInt(bareMatch[2], 10), bareMatch[4] ? parseInt(bareMatch[4], 10) : 0);
    } else {
        endDate = new Date(endTimeValue);
    }

    if (isNaN(endDate.getTime())) return null;
    const diffMs = endDate - now;
    if (diffMs <= 0) return null;

    const totalMinutes = Math.ceil(diffMs / 60000);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    return {
        endLabel: endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        remainingLabel: hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`,
    };
}

async function openModal(computerId) {
    activeComputerId = computerId;
    const computer = allComputers.find((c) => String(c.id) === String(computerId));
    if (!computer) return;

    const occ = getOccupancyInfo(computer);
    if (computer.status === 'Occupied' && occ.isWalkIn) {
        showToast(
            'warning',
            "Can't reserve this computer",
            `${computer.computer_number || 'This computer'} is currently being used by a walk-in student. It has no set end time, so it can't be reserved right now — check back once it shows as Available.`,
            7000
        );
        return;
    }

    // FIX: the modal chip previously joined the computer number and
    // the computer name together ("PC-06 · Library PC 6"). The user
    // wanted just the number. Now it shows only computer_number.
    setText('modal-computer-label', computer.computer_number || 'Computer');

    toggleClass('modal-conflict-alert', 'show', false);
    qsa('.form-error').forEach((e) => { e.textContent = ''; });

    const today = new Date().toISOString().slice(0, 10);
    const dateInput = byId('reserve-date');
    dateInput.min = today;
    dateInput.value = today;
    byId('reserve-start').value = '';
    byId('reserve-end').value = '';

    // Reset the reserved-slots preview.
    const preview = byId('reserve-reserved-slots');
    if (preview) {
        preview.innerHTML = '';
    }
    const slotsStep = byId('reserve-slots-step');
    if (slotsStep) {
        slotsStep.style.display = 'none';
    }
    // Reset the final step's number to 3 (it bumps to 4 when the
    // reserved-slots step becomes visible).
    const formStepNumber = byId('form-step-number');
    if (formStepNumber) formStepNumber.textContent = '3';

    toggleClass('reserve-modal', 'show', true);
    toggleClass('modal-backdrop', 'show', true);

    // Kick off the reserved-slots fetch for today right away.
    loadReservedSlotsPreview();
}

function closeModal() {
    toggleClass('reserve-modal', 'show', false);
    toggleClass('modal-backdrop', 'show', false);
    activeComputerId = null;
}

function runInlineReservationValidation(formData) {
    const errors = { date: '', start: '', end: '' };

    if (!formData.reservation_date) errors.date = 'Please pick a date.';
    if (!formData.start_time)       errors.start = 'Please pick a start time.';
    if (!formData.end_time)         errors.end = 'Please pick an end time.';
    if (errors.date || errors.start || errors.end) return errors;

    const [y, m, d] = formData.reservation_date.split('-').map(Number);
    const [sh, sm] = formData.start_time.split(':').map(Number);
    const [eh, em] = formData.end_time.split(':').map(Number);

    if ([y, m, d, sh, sm, eh, em].some((n) => !Number.isFinite(n))) {
        errors.date = 'Please check the date and time fields.';
        return errors;
    }

    const now = new Date();
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const reservationDateOnly = new Date(y, m - 1, d);
    if (reservationDateOnly < todayOnly) {
        errors.date = 'This date has already passed.';
        return errors;
    }

    const startDateTime = new Date(y, m - 1, d, sh, sm);
    const endDateTime = new Date(y, m - 1, d, eh, em);

    if (endDateTime <= startDateTime) {
        errors.end = 'End time must be after start time.';
        return errors;
    }

    const durationMs = endDateTime - startDateTime;
    const durationMinutes = durationMs / 60000;
    const durationHours = durationMs / 3600000;

    if (durationMinutes < MIN_RESERVATION_MINUTES) {
        errors.end = `A reservation must be at least ${MIN_RESERVATION_MINUTES} minutes long.`;
        return errors;
    }
    if (durationHours > MAX_RESERVATION_HOURS) {
        errors.end = `A single reservation cannot exceed ${MAX_RESERVATION_HOURS} hours.`;
        return errors;
    }

    const minAllowedStart = new Date(now.getTime() + MIN_LEAD_TIME_MS);
    if (startDateTime < minAllowedStart) {
        errors.start = 'Reservations must be made at least 1 hour before the start time.';
        return errors;
    }

    // Lunch break: 11:30 AM – 1:00 PM. Lexicographic comparison works
    // because the browser emits zero-padded HH:MM values.
    const startHM = String(formData.start_time).slice(0, 5);
    const endHM   = String(formData.end_time).slice(0, 5);
    if (startHM < LUNCH_END && endHM > LUNCH_START) {
        errors.end = `This slot overlaps the library lunch break (${LUNCH_LABEL}). Please pick a time that ends by 11:30 AM or starts at 1:00 PM or later.`;
        return errors;
    }

    return errors;
}

function paintInlineErrors(errors) {
    if (!errors) return false;
    if (errors.date)  setText('error-date', errors.date);
    if (errors.start) setText('error-start', errors.start);
    if (errors.end)   setText('error-end', errors.end);
    return !!(errors.date || errors.start || errors.end);
}

async function confirmReservation() {
    toggleClass('modal-conflict-alert', 'show', false);
    qsa('.form-error').forEach((e) => { e.textContent = ''; });

    const formData = {
        computer_id: activeComputerId,
        reservation_date: byId('reserve-date').value,
        start_time: byId('reserve-start').value,
        end_time: byId('reserve-end').value,
    };

    if (typeof validator !== 'undefined' && validator
        && typeof validator.validateForm === 'function'
        && typeof ValidationSchemas !== 'undefined' && ValidationSchemas
        && ValidationSchemas.reservation) {
        try {
            const { isValid, errors } = await validator.validateForm(formData, ValidationSchemas.reservation);
            if (!isValid) {
                const inline = {
                    date: errors.reservation_date ? validator.getFieldError(errors, 'reservation_date') : '',
                    start: errors.start_time ? validator.getFieldError(errors, 'start_time') : '',
                    end: errors.end_time ? validator.getFieldError(errors, 'end_time') : '',
                };
                if (paintInlineErrors(inline)) return;
            }
        } catch (err) {
            console.warn('[reserve] validator.validateForm failed — falling back to inline checks:', err);
        }
    }

    const inlineErrors = runInlineReservationValidation(formData);
    if (paintInlineErrors(inlineErrors)) return;

    const confirmBtn = byId('modal-confirm');
    const spinner = byId('modal-confirm-spinner');
    const confirmLabel = byId('modal-confirm-label');
    confirmBtn.disabled = true;
    spinner.style.display = 'inline-block';
    if (confirmLabel) confirmLabel.textContent = 'Submitting…';

    try {
        const res = await api.createReservation(formData);
        if (!res.success) throw new Error(res.message || 'Failed to submit reservation');
        closeModal();
        showToast(
            'success',
            'Reservation submitted',
            `Your request for ${formData.reservation_date} at ${formData.start_time.slice(0, 5)} is pending admin approval.`
        );
        await loadComputers();
    } catch (err) {
        setText('modal-conflict-message', err.message || 'Could not submit reservation.');
        toggleClass('modal-conflict-alert', 'show', true);
    } finally {
        confirmBtn.disabled = false;
        spinner.style.display = 'none';
        if (confirmLabel) confirmLabel.textContent = 'Submit Reservation';
    }
}

async function loadComputers() {
    const grid = byId('computer-grid');

    const compsPromise = api.getComputers().catch((err) => ({ success: false, message: err.message }));
    const dashPromise = api.getDashboard().catch(() => ({ success: false }));

    const [compsRes, dashRes] = await Promise.all([compsPromise, dashPromise]);

    if (!compsRes.success) {
        console.error('[computers] /computers failed:', compsRes.message);
        if (grid) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
                <p>Failed to load computers. ${escapeHtml(compsRes.message || '')}</p>
            </div>`;
        }
        showToast('error', 'Could not load computers', compsRes.message || 'Please try again.');
        return;
    }

    allComputers = compsRes.data || [];

    if (dashRes.success && dashRes.data && dashRes.data.student) {
        const { used_hours, remaining_hours } = dashRes.data.student;
        const remaining = Number(remaining_hours ?? 1);
        hoursExhausted = remaining <= 0;
        paintSidebarHours(used_hours, remaining_hours);
    }

    if (hoursExhausted) show('hours-lock-banner'); else hide('hours-lock-banner');

    renderCounts();
    renderGrid();
}

/* ============================================================
 * RESERVED SLOTS PREVIEW (inside the reserve modal)
 * ============================================================ */
async function loadReservedSlotsPreview() {
    const wrap = byId('reserve-reserved-slots');
    const step = byId('reserve-slots-step');
    const formStepNumber = byId('form-step-number');
    if (!wrap) return;

    const computerId = activeComputerId;
    const date = byId('reserve-date')?.value;
    if (!computerId || !date) {
        if (step) step.style.display = 'none';
        if (formStepNumber) formStepNumber.textContent = '3';
        return;
    }

    // Show the slots step with a loading state.
    if (step) step.style.display = 'flex';
    if (formStepNumber) formStepNumber.textContent = '4';
    wrap.innerHTML = `<div class="reserved-slots-loading">Loading available time slots…</div>`;

    try {
        if (typeof api.getReservationsForComputerOnDate !== 'function') {
            if (step) step.style.display = 'none';
            if (formStepNumber) formStepNumber.textContent = '3';
            return;
        }

        const res = await api.getReservationsForComputerOnDate(computerId, date);
        if (!res.success) throw new Error(res.message || 'Failed to load slots');

        const list = (res.data || []).slice().sort((a, b) =>
            String(a.start_time || '').localeCompare(String(b.start_time || ''))
        );

        const items = list.map(r => {
            const badge = r.status === 'Approved' ? 'success' : 'warning';
            const label = r.status === 'Approved' ? 'Approved' : 'Pending';
            const start = formatClock(r.start_time);
            const end   = formatClock(r.end_time);
            return `<li class="reserved-slot-item">
                <span class="reserved-slot-time">${escapeHtml(start)} – ${escapeHtml(end)}</span>
                <span class="badge badge-${badge}">${label}</span>
            </li>`;
        }).join('');

        const lunchItem = `<li class="reserved-slot-item reserved-slot-lunch">
            <span class="reserved-slot-time">${escapeHtml(LUNCH_LABEL)}</span>
            <span class="badge badge-secondary">Lunch Break</span>
        </li>`;

        wrap.innerHTML = `
            <ul class="reserved-slots-list">
                ${items}
                ${lunchItem}
            </ul>
            ${list.length === 0 ? '<div class="reserved-slots-empty">No student reservations yet — the rest of the day is free (lunch break excluded).</div>' : ''}
        `;
    } catch (err) {
        console.error('[reserve] Failed to load reserved slots:', err);
        wrap.innerHTML = `<div class="reserved-slots-error">Could not load reserved slots.</div>`;
    }
}

/* ============================================================
 * USAGE HISTORY (tab 2)
 * ============================================================ */
const USAGE_PAGE_SIZE = 10;
const USAGE_REFRESH_MS = 30000;

let allSessions = [];
let filteredSessions = [];
let usagePage = 1;
let usagePages = 1;
let usageFilters = { dateFrom: '', dateTo: '', type: '' };
let usageSnapshot = '';
let usageHistoryLoaded = false;
let usageAutoRefreshTimer = null;

function usageParseDate(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function usageParseDateTime(value) {
    if (!value) return null;
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return usageParseDate(str);
    const d = new Date(str.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
}

function usageFormatDate(value) {
    const d = usageParseDateTime(value);
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function usageFormatTime(value) {
    const d = usageParseDateTime(value);
    if (!d) return '—';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function usageLiveDuration(loginTime, logoutTime) {
    const login = usageParseDateTime(loginTime);
    if (!login) return 0;
    const end = logoutTime ? usageParseDateTime(logoutTime) : new Date();
    if (!end) return 0;
    return Math.max(0, Math.floor((end - login) / 60000));
}

function usageFormatDuration(minutes) {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) return '0m';
    const total = Math.floor(n);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

function usageEscape(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function usageSessionType(row) {
    const raw = String(row.session_type || '').trim();
    if (!raw) return 'Walk-in';
    return raw.toLowerCase().includes('reserv') ? 'Reservation' : 'Walk-in';
}

function usageIsActive(row) {
    return !row.logout_time && String(row.status || '').toLowerCase() === 'active';
}

function usageComputerLabel(row) {
    const number = row.computer_number || (row.computer_id ? `PC-${row.computer_id}` : '');
    const name = row.computer_name || '';
    if (!number && !name) return 'Unknown';
    if (!name) return number;
    return `${number} · ${name}`;
}

function usageStudentId() {
    const user = sessionManager.getUser() || {};
    return user.id || user.sub || null;
}

async function loadUsageHistory(opts = {}) {
    const { background = false } = opts;
    const studentId = usageStudentId();

    if (!studentId) {
        const body = byId('session-body');
        if (body) {
            body.innerHTML = '<tr class="table-empty"><td colspan="6">Could not identify your account. Please log out and sign in again.</td></tr>';
        }
        return;
    }

    let res;
    try {
        res = await api.getSessionsForStudent(studentId);
    } catch (err) {
        res = { success: false, message: err.message };
    }

    if (!res || !res.success) {
        if (background) return;
        const body = byId('session-body');
        if (body) {
            body.innerHTML = `<tr class="table-empty"><td colspan="6">Failed to load your usage history. ${usageEscape(res?.message || '')}</td></tr>`;
        }
        if (typeof showToast === 'function') {
            showToast('error', 'Could not load history', res?.message || 'Please try again.');
        }
        return;
    }

    usageHistoryLoaded = true;
    const rows = Array.isArray(res.data) ? res.data : [];

    const snapshot = JSON.stringify(rows.map(r => [r.id, r.logout_time, r.duration_minutes])) +
        '|' + Math.floor(Date.now() / 60000);
    if (background && snapshot === usageSnapshot) return;
    usageSnapshot = snapshot;

    allSessions = rows;
    applyUsageFilters(background ? usagePage : 1);
}

function sortUsage(list) {
    return list.slice().sort((a, b) => {
        const da = usageParseDateTime(a.login_time);
        const db = usageParseDateTime(b.login_time);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });
}

function applyUsageFilters(page) {
    const { dateFrom, dateTo, type } = usageFilters;

    const fromTs = dateFrom ? usageParseDate(dateFrom)?.getTime() ?? null : null;
    const toTs   = dateTo   ? usageParseDate(dateTo)?.getTime()   ?? null : null;

    const matches = allSessions.filter(row => {
        if (type && usageSessionType(row) !== type) return false;

        const loginDay = usageParseDate(row.login_time);
        const loginTs = loginDay ? loginDay.getTime() : null;

        if (fromTs !== null && (loginTs === null || loginTs < fromTs)) return false;
        if (toTs !== null && (loginTs === null || loginTs > toTs)) return false;

        return true;
    });

    filteredSessions = sortUsage(matches);
    usagePages = Math.max(1, Math.ceil(filteredSessions.length / USAGE_PAGE_SIZE));
    usagePage = Math.min(Math.max(1, page), usagePages);

    renderUsageRows();
    renderUsagePagination();
    renderUsageStats();
}

function renderUsageRows() {
    const body = byId('session-body');
    if (!body) return;

    if (allSessions.length === 0) {
        body.innerHTML = `
            <tr class="table-empty"><td colspan="6">
                <div class="history-empty">
                    <p>You haven't used a library computer yet.</p>
                    <a class="btn btn-primary btn-sm" href="computer-availability.html">Check computer availability</a>
                </div>
            </td></tr>`;
        return;
    }

    if (filteredSessions.length === 0) {
        body.innerHTML = '<tr class="table-empty"><td colspan="6">No sessions match your filters.</td></tr>';
        return;
    }

    const start = (usagePage - 1) * USAGE_PAGE_SIZE;
    const slice = filteredSessions.slice(start, start + USAGE_PAGE_SIZE);

    body.innerHTML = slice.map(row => {
        const type = usageSessionType(row);
        const typeClass = type === 'Reservation' ? 'badge-reservation' : 'badge-walkin';
        const isActive = usageIsActive(row);

        const durationMinutes = isActive
            ? usageLiveDuration(row.login_time, null)
            : (row.duration_minutes ?? usageLiveDuration(row.login_time, row.logout_time));

        const logoutCell = isActive
            ? '<span class="session-active-pill">Active</span>'
            : `${usageFormatDate(row.logout_time)}<div class="text-muted" style="font-size:12px;">${usageFormatTime(row.logout_time)}</div>`;

        return `
            <tr>
                <td data-label="Computer"><strong>${usageEscape(usageComputerLabel(row))}</strong></td>
                <td data-label="Date">${usageFormatDate(row.login_time)}</td>
                <td data-label="Login">${usageFormatTime(row.login_time)}</td>
                <td data-label="Logout">${logoutCell}</td>
                <td data-label="Duration">${usageFormatDuration(durationMinutes)}</td>
                <td data-label="Type"><span class="badge ${typeClass}">${usageEscape(type)}</span></td>
            </tr>`;
    }).join('');
}

function setUsageText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
}

function getStartOfWeekMs() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = d.getDay();
    const back = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - back);
    return d.getTime();
}

function getEndOfWeekMs() {
    const start = getStartOfWeekMs();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end.getTime();
}

function renderUsageStats() {
    const total = allSessions.length;

    const totalMinutes = allSessions.reduce((sum, row) => {
        const n = Number(row.duration_minutes);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);

    const weekStart = getStartOfWeekMs();
    const weekEnd   = getEndOfWeekMs();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();

    let weekCount = 0;
    let monthCount = 0;
    allSessions.forEach(row => {
        const d = usageParseDate(row.login_time);
        if (!d) return;
        const ts = d.getTime();
        if (ts >= weekStart && ts <= weekEnd) weekCount++;
        if (ts >= monthStart && ts <= monthEnd) monthCount++;
    });

    setUsageText('hs-total', total);
    setUsageText('hs-hours', usageFormatDuration(totalMinutes));
    setUsageText('hs-week', weekCount);
    setUsageText('hs-month', monthCount);
}

function usageGoToPage(p) {
    usagePage = Math.min(Math.max(1, p), usagePages);
    renderUsageRows();
    renderUsagePagination();
}

function renderUsagePagination() {
    const start = (usagePage - 1) * USAGE_PAGE_SIZE;
    const end = Math.min(start + USAGE_PAGE_SIZE, filteredSessions.length);
    setUsageText('hp-start', filteredSessions.length === 0 ? 0 : start + 1);
    setUsageText('hp-end', end);
    setUsageText('hp-total', filteredSessions.length);

    const wrap = byId('hp-buttons');
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

    mk('‹', 'btn-light', usagePage <= 1, () => usageGoToPage(usagePage - 1), 'Previous page');

    const maxButtons = 5;
    let first = Math.max(1, usagePage - Math.floor(maxButtons / 2));
    let last = Math.min(usagePages, first + maxButtons - 1);
    first = Math.max(1, last - maxButtons + 1);

    for (let p = first; p <= last; p++) {
        mk(String(p), p === usagePage ? 'btn-primary' : 'btn-light', false, () => usageGoToPage(p));
    }

    mk('›', 'btn-light', usagePage >= usagePages, () => usageGoToPage(usagePage + 1), 'Next page');
}

function setupUsageFilters() {
    const fromEl = byId('history-from');
    const toEl = byId('history-to');
    const typeEl = byId('history-type');
    const clearBtn = byId('history-clear');

    if (fromEl) fromEl.addEventListener('change', e => {
        usageFilters.dateFrom = e.target.value;
        applyUsageFilters(1);
    });
    if (toEl) toEl.addEventListener('change', e => {
        usageFilters.dateTo = e.target.value;
        applyUsageFilters(1);
    });
    if (typeEl) typeEl.addEventListener('change', e => {
        usageFilters.type = e.target.value;
        applyUsageFilters(1);
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
        usageFilters = { dateFrom: '', dateTo: '', type: '' };
        if (fromEl) fromEl.value = '';
        if (toEl) toEl.value = '';
        if (typeEl) typeEl.value = '';
        applyUsageFilters(1);
    });
}

function startUsageAutoRefresh() {
    if (usageAutoRefreshTimer) clearInterval(usageAutoRefreshTimer);
    usageAutoRefreshTimer = setInterval(() => {
        if (document.hidden) return;
        const panel = byId('tab-usage');
        if (!panel || panel.hidden) return;
        loadUsageHistory({ background: true });
    }, USAGE_REFRESH_MS);
}

/* ============================================================
 * AVAILABILITY AUTO-REFRESH
 * ============================================================ */
function startAvailabilityAutoRefresh() {
    if (availabilityTimer) clearInterval(availabilityTimer);
    availabilityTimer = setInterval(() => {
        if (document.hidden) return;
        const panel = byId('tab-availability');
        if (panel && panel.hidden) return;
        loadComputers();
    }, AVAILABILITY_REFRESH_MS);
}

/* ============================================================
 * WIRING
 * ============================================================ */
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

    setupTabs();

    on('filter-status', 'change', renderGrid);
    onClick('modal-close', closeModal);
    onClick('modal-cancel', closeModal);
    onClick('modal-confirm', confirmReservation);
    onClick('modal-backdrop', closeModal);

    on('reserve-date', 'change', loadReservedSlotsPreview);

    onClick('logoutBtn', () => { if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navLogoutLink', (e) => { e.preventDefault(); if (confirm('Are you sure you want to log out?')) sessionManager.logout(); });
    onClick('navbarToggler', () => { if (window.sidebar) window.sidebar.open(); });

    setupUsageFilters();
    startUsageAutoRefresh();
    startAvailabilityAutoRefresh();

    window.addEventListener('realtime:notification', () => {
        loadComputers();
        if (usageHistoryLoaded && !byId('tab-usage').hidden) {
            loadUsageHistory({ background: true });
        }
    });

    loadComputers();
});