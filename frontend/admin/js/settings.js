// frontend/admin/js/settings.js
document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('admin')) return;
    initializeSettings();
    setupEventListeners();
    setupTabs();
});

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let currentSemester = null;
let currentLibraryHours = [];
let originalSemesterData = null;
let originalLibraryHours = [];

if (typeof showToast !== 'function') {
    window.showToast = function(message, type = 'info') {
        alert(message);
    };
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

async function initializeSettings() {
    try {
        await updateUserInfo();
        await loadSettings();
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Failed to load settings', 'error');
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

async function loadSettings() {
    await loadSemesterSettings();
    await loadLibraryHours();
}

async function loadSemesterSettings() {
    try {
        const response = await api.getSemesterSettings();
        if (response.success && response.data) {
            const data = response.data;
            currentSemester = data;

            originalSemesterData = {
                semester_name: data.semester_name || '',
                start_date: data.start_date || '',
                end_date: data.end_date || '',
                student_hour_limit: data.student_hour_limit || 10
            };

            const semesterName = document.getElementById('semesterName');
            const semesterStartDate = document.getElementById('semesterStartDate');
            const semesterEndDate = document.getElementById('semesterEndDate');
            const semesterHourLimit = document.getElementById('semesterHourLimit');

            if (semesterName) semesterName.value = data.semester_name || '';
            if (semesterStartDate) semesterStartDate.value = data.start_date || '';
            if (semesterEndDate) semesterEndDate.value = data.end_date || '';
            if (semesterHourLimit) semesterHourLimit.value = data.student_hour_limit || 10;

            const currentSemesterName = document.getElementById('currentSemesterName');
            const currentSemesterPeriod = document.getElementById('currentSemesterPeriod');
            const currentHourLimit = document.getElementById('currentHourLimit');
            const semesterDaysRemaining = document.getElementById('semesterDaysRemaining');

            if (currentSemesterName) currentSemesterName.textContent = data.semester_name || 'Not Set';
            if (currentSemesterPeriod) currentSemesterPeriod.textContent = data.start_date && data.end_date ?
                `${formatDate(data.start_date)} - ${formatDate(data.end_date)}` : 'Not Set';
            if (currentHourLimit) currentHourLimit.textContent = `${data.student_hour_limit || 10} hours`;

            if (data.end_date && semesterDaysRemaining) {
                const endDate = new Date(data.end_date);
                const today = new Date();
                const diffDays = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                semesterDaysRemaining.textContent = diffDays > 0 ? `${diffDays} days` : 'Semester ended';
            }
        } else {
            currentSemester = null;
            originalSemesterData = null;
            const currentSemesterName = document.getElementById('currentSemesterName');
            const currentSemesterPeriod = document.getElementById('currentSemesterPeriod');
            if (currentSemesterName) currentSemesterName.textContent = 'Not Set';
            if (currentSemesterPeriod) currentSemesterPeriod.textContent = 'Not Set';
        }
    } catch (error) {
        console.error('Failed to load semester settings:', error);
        showToast('Failed to load semester settings', 'error');
    }
}

async function loadLibraryHours() {
    try {
        const response = await api.getLibraryHours();
        if (response.success) {
            currentLibraryHours = response.data || [];
            originalLibraryHours = JSON.parse(JSON.stringify(currentLibraryHours));

            WEEKDAYS.forEach(day => {
                const dayData = currentLibraryHours.find(d => d.day === day);
                const openingInput = document.getElementById(day.toLowerCase() + 'Opening');
                const closingInput = document.getElementById(day.toLowerCase() + 'Closing');

                if (openingInput) openingInput.value = dayData && dayData.is_open ? (dayData.opening_time || '').slice(0,5) : '';
                if (closingInput) closingInput.value = dayData && dayData.is_open ? (dayData.closing_time || '').slice(0,5) : '';
            });

            updateLibraryStatus();
        }
    } catch (error) {
        console.error('Failed to load library hours:', error);
        showToast('Failed to load library hours', 'error');
    }
}

function updateLibraryStatus() {
    const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];
    const todayRow = currentLibraryHours.find(d => d.day === todayName);
    const statusElement = document.getElementById('libraryStatus');

    if (statusElement) {
        let isOpen = false;
        if (todayRow && todayRow.is_open && todayRow.opening_time && todayRow.closing_time) {
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const openMinutes = timeToMinutes(todayRow.opening_time);
            const closeMinutes = timeToMinutes(todayRow.closing_time);
            isOpen = currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
        }
        statusElement.innerHTML = isOpen ?
            '<span class="badge badge-success">🟢 Open Now</span>' :
            '<span class="badge badge-danger">🔴 Closed</span>';
    }
}

function timeToMinutes(time) {
    if (!time) return 0;
    const parts = time.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function setupTabs() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.settings-content').forEach(c => c.classList.remove('active'));
            const content = document.getElementById(`tab-${tabName}`);
            if (content) content.classList.add('active');
        });
    });
}

function setupEventListeners() {
    const semesterForm = document.getElementById('semesterSettingsForm');
    if (semesterForm) {
        semesterForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            await updateSemesterSettings(this);
        });
    }

    const hoursForm = document.getElementById('libraryHoursForm');
    if (hoursForm) {
        hoursForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            await updateLibraryHours(this);
        });
    }
}

async function updateSemesterSettings(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // ---- VALIDATION 1: required fields ----
    if (!data.semester_name || !data.start_date || !data.end_date || !data.hour_limit) {
        showToast('Please fill in all required fields', 'warning');
        return;
    }

    // ---- VALIDATION 2: date ordering ----
    if (new Date(data.start_date) >= new Date(data.end_date)) {
        showToast('Start date must be before end date.', 'warning');
        return;
    }

    // ---- VALIDATION 3: hour limit range ----
    const hourLimit = parseFloat(data.hour_limit);
    if (!Number.isFinite(hourLimit) || hourLimit <= 0 || hourLimit > 100) {
        showToast('Hour limit must be a number between 0 and 100.', 'warning');
        return;
    }

    // ---- VALIDATION 4: no changes made ----
    if (originalSemesterData) {
        const isChanged = (
            data.semester_name !== originalSemesterData.semester_name ||
            data.start_date !== originalSemesterData.start_date ||
            data.end_date !== originalSemesterData.end_date ||
            hourLimit !== parseFloat(originalSemesterData.student_hour_limit)
        );
        if (!isChanged) {
            showToast('No changes were made to the semester settings.', 'warning');
            return;
        }
    }

    // ---- VALIDATION 5: duplicate semester name ----
    try {
        const allSemestersRes = await api.getSemesters();
        if (allSemestersRes.success) {
            const allSemesters = allSemestersRes.data || [];
            const duplicate = allSemesters.find(s =>
                s.semester_name === data.semester_name.trim() &&
                (!currentSemester || s.id !== currentSemester.id)
            );
            if (duplicate) {
                showToast('A semester with this name already exists. Please choose a different name.', 'error');
                return;
            }
        }
    } catch (error) {
        console.warn('Failed to check for duplicate semester name:', error);
    }

    const payload = {
        semester_name: data.semester_name.trim(),
        start_date: data.start_date,
        end_date: data.end_date,
        student_hour_limit: hourLimit
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const response = currentSemester
            ? await api.updateSemester(currentSemester.id, payload)
            : await api.createSemester(payload);

        if (response.success) {
            showToast('Semester settings updated successfully', 'success');
            await loadSemesterSettings();
        } else {
            showToast(response.message || 'Failed to update semester settings', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to update semester settings', 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

/**
 * FIX: library hours are stored as seven independent rows, one per day.
 * The previous version used Promise.all over seven api.updateLibraryHours()
 * calls — if any single day failed, the whole Promise.all rejected, the
 * success toast never appeared, and the UI never reloaded, BUT the other
 * six requests had already written their rows server-side. The DB ended up
 * half-applied with the UI showing stale data.
 *
 * Now: Promise.allSettled() runs every request to completion, collects the
 * names of any days that failed, and reports them so the admin knows
 * exactly which rows need to be retried.
 */
async function updateLibraryHours(form) {
    // ---- VALIDATION 1: no changes made ----
    const isHoursChanged = WEEKDAYS.some(day => {
        const dayData = originalLibraryHours.find(d => d.day === day);
        const lowerDay = day.toLowerCase();
        const openingInput = document.getElementById(lowerDay + 'Opening').value;
        const closingInput = document.getElementById(lowerDay + 'Closing').value;
        const isOpen = openingInput && closingInput;

        const originalOpening = dayData && dayData.is_open ? (dayData.opening_time || '').slice(0,5) : '';
        const originalClosing = dayData && dayData.is_open ? (dayData.closing_time || '').slice(0,5) : '';
        const originalIsOpen = !!(dayData && dayData.is_open);

        return (openingInput !== originalOpening) || (closingInput !== originalClosing) || (isOpen !== originalIsOpen);
    });

    if (!isHoursChanged) {
        showToast('No changes were made to the library hours.', 'warning');
        return;
    }

    // ---- VALIDATION 2: each open day must have both times, and opening < closing ----
    for (const day of WEEKDAYS) {
        const lowerDay = day.toLowerCase();
        const openingTime = document.getElementById(lowerDay + 'Opening').value;
        const closingTime = document.getElementById(lowerDay + 'Closing').value;

        const hasOne = !!openingTime !== !!closingTime;
        if (hasOne) {
            showToast(`${day}: fill in both opening and closing times, or leave both blank to mark the library closed.`, 'warning');
            return;
        }
        if (openingTime && closingTime && timeToMinutes(openingTime) >= timeToMinutes(closingTime)) {
            showToast(`${day}: opening time must be before closing time.`, 'warning');
            return;
        }
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const promises = WEEKDAYS.map(day => {
            const lowerDay = day.toLowerCase();
            const openingTime = document.getElementById(lowerDay + 'Opening').value;
            const closingTime = document.getElementById(lowerDay + 'Closing').value;
            const isOpen = openingTime && closingTime;

            return api.updateLibraryHours({
                day: day,
                opening_time: isOpen ? openingTime : null,
                closing_time: isOpen ? closingTime : null,
                is_open: !!isOpen
            });
        });

        const results = await Promise.allSettled(promises);

        const failed = [];
        const rejected = [];

        results.forEach((result, i) => {
            const day = WEEKDAYS[i];
            if (result.status === 'rejected') {
                rejected.push(day + ': ' + (result.reason && result.reason.message ? result.reason.message : 'request failed'));
                failed.push(day);
            } else if (result.value && result.value.success === false) {
                rejected.push(day + ': ' + (result.value.message || 'server rejected'));
                failed.push(day);
            }
        });

        if (failed.length === 0) {
            showToast('Library hours updated successfully', 'success');
        } else if (failed.length === WEEKDAYS.length) {
            showToast('Failed to update library hours. Check the console for details.', 'error');
            console.error('All library-hours requests failed:', rejected);
        } else {
            showToast('Updated, but failed on: ' + failed.join(', ') + '. Please retry those days.', 'warning');
            console.error('Partial failure on library-hours update:', rejected);
        }

        // Always re-read from the server so the UI matches reality.
        await loadLibraryHours();
    } catch (error) {
        showToast(error.message || 'Failed to update library hours', 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

function clearAllData() {
    showToast('This feature is not implemented on the backend yet.', 'warning');
}

function resetAllSettings() {
    showToast('This feature is not implemented on the backend yet.', 'warning');
}

function formatDate(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

window.clearAllData = clearAllData;
window.resetAllSettings = resetAllSettings;