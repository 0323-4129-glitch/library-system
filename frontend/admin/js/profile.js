// frontend/admin/js/profile.js
document.addEventListener('DOMContentLoaded', function() {
    if (!sessionManager.requireRole('admin')) return;
    initializeProfile();
    setupEventListeners();
});

// ===== PHOTO URL RESOLVER =====
function resolvePhotoUrl(photoUrl) {
    if (!photoUrl) return null;
    if (/^(https?:)?\/\//i.test(photoUrl)) return photoUrl;

    const backendRoot = API_CONFIG.baseURL.replace(/\/api\/index\.php.*$/i, '');
    const cleanPath = photoUrl.replace(/^\/+/, '');
    return `${backendRoot}/${cleanPath}`;
}

// ===== ROBUST TOAST SYSTEM =====
(function() {
    var style = document.createElement('style');
    style.textContent = `
        .custom-toast-container { position: fixed !important; top: 20px !important; right: 20px !important; z-index: 9999999 !important; display: flex !important; flex-direction: column !important; gap: 10px !important; max-width: 400px !important; width: 100% !important; pointer-events: none !important; }
        .custom-toast { background: #fff !important; border-radius: 8px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important; padding: 14px 16px !important; font-size: 14px !important; font-weight: 500 !important; border-left: 4px solid !important; pointer-events: auto !important; margin-bottom: 10px !important; }
        .custom-toast.success { border-left-color: #28a745 !important; background: #e6ffed !important; color: #1c7a4a !important; }
        .custom-toast.error   { border-left-color: #dc3545 !important; background: #ffe6e6 !important; color: #a71d2a !important; }
        .custom-toast.warning { border-left-color: #ffc107 !important; background: #fff3cd !important; color: #856404 !important; }
        .custom-toast.info    { border-left-color: #17a2b8 !important; background: #e6f7ff !important; color: #0c5460 !important; }
    `;
    document.head.appendChild(style);

    var container = document.createElement('div');
    container.className = 'custom-toast-container';
    document.body.appendChild(container);
    window.showToast = function(message, type = 'success') {
        var toast = document.createElement('div');
        toast.className = 'custom-toast ' + type;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 3000);
    };
})();

// ===== SELF-CONTAINED MODAL + DROPDOWN + FORM STYLES =====
(function() {
    var style = document.createElement('style');
    style.textContent = `
        .modal { display: none !important; }
        .modal.show { display: flex !important; position: fixed !important; inset: 0 !important; align-items: center !important; justify-content: center !important; z-index: 100000 !important; padding: 20px !important; }
        .modal .modal-backdrop { position: fixed !important; inset: 0 !important; background: rgba(15, 15, 30, 0.55) !important; z-index: 1 !important; opacity: 0 !important; pointer-events: none !important; }
        .modal .modal-backdrop.show { opacity: 1 !important; pointer-events: auto !important; }
        .modal .modal-dialog { position: relative !important; z-index: 2 !important; background: #fff !important; border-radius: 12px !important; box-shadow: 0 20px 50px rgba(0,0,0,0.3) !important; width: 100% !important; max-width: 480px !important; max-height: 90vh !important; overflow-y: auto !important; }
        #editProfileModal .modal-dialog { max-width: 560px !important; }
        #changePasswordModal .modal-dialog { max-width: 440px !important; }
        #viewProfilePictureModal .modal-dialog { max-width: 400px !important; }
        #photoChoiceModal .modal-dialog { max-width: 360px !important; }
        #cameraCaptureModal .modal-dialog { max-width: 640px !important; }

        .modal-header { display: flex !important; align-items: center !important; justify-content: flex-end !important; padding: 18px 22px !important; border-bottom: 1px solid #eef0f5 !important; }
        .modal-title { flex: 1; display: flex !important; align-items: center !important; gap: 8px !important; margin: 0 !important; font-size: 17px !important; }
        .modal-close { background: none !important; border: none !important; font-size: 20px !important; line-height: 1 !important; cursor: pointer !important; color: #6b7280 !important; padding: 4px 8px !important; }
        .modal-body { padding: 22px !important; }
        .modal-footer { display: flex !important; justify-content: flex-end !important; gap: 10px !important; padding: 16px 22px !important; border-top: 1px solid #eef0f5 !important; }
        .modal-form .form-group { margin-bottom: 18px !important; }
        .modal-form .form-row { display: flex !important; flex-wrap: wrap !important; gap: 14px !important; }
        .modal-form .form-row .form-group { flex: 1 1 150px !important; }
        .modal-form .form-label { display: block !important; margin-bottom: 6px !important; font-size: 13px !important; font-weight: 600 !important; color: #374151 !important; }
        .modal-form .form-control { width: 100% !important; box-sizing: border-box !important; padding: 10px 12px !important; border: 1px solid #d7dae2 !important; border-radius: 8px !important; font-size: 14px !important; }
        #photoChoiceModal .modal-body { display: flex !important; flex-direction: column !important; gap: 10px !important; }
        .photo-choice-btn { display: flex !important; align-items: center !important; justify-content: center !important; gap: 8px !important; width: 100% !important; }

        #profileMenuToggle { position: relative !important; }
        #profileMenuToggle .profile-dropdown { top: calc(100% + 10px) !important; right: 0 !important; }
        .profile-avatar-wrapper { display: inline-block !important; }
        .avatar-camera-badge { position: absolute !important; bottom: -2px !important; right: -2px !important; width: 24px !important; height: 24px !important; border-radius: 50% !important; background: var(--primary-blue, #2b2d82) !important; color: #fff !important; display: flex !important; align-items: center !important; justify-content: center !important; border: 2px solid #fff !important; pointer-events: none !important; }
        .avatar-dropdown { top: calc(100% + 10px) !important; left: 0 !important; }

        .profile-dropdown { position: absolute !important; background: #fff !important; border-radius: 10px !important; box-shadow: 0 12px 28px rgba(0,0,0,0.18) !important; min-width: 220px !important; padding: 6px !important; z-index: 100000 !important; }
        .profile-dropdown a { display: block !important; padding: 10px 12px !important; border-radius: 6px !important; color: #1a1a2e !important; text-decoration: none !important; font-size: 14px !important; font-weight: 500 !important; }
        .profile-dropdown a:hover { background: #f2f2fa !important; }
        .profile-dropdown .dropdown-divider { height: 1px !important; background: #eaeaf2 !important; margin: 6px 4px !important; }

        /* Explicit avatar sizing */
        .avatar-img { width: 100% !important; height: 100% !important; border-radius: 50% !important; object-fit: cover !important; display: block !important; }
        .avatar-fallback { display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; border-radius: 50% !important; background: #2b2d82 !important; color: #fff !important; font-weight: 600 !important; }
    `;
    document.head.appendChild(style);
})();

// ===== AVATAR HELPER =====
function createAvatarHtml(photoUrl, initials, logPrefix) {
    if (!photoUrl) return `<div class="avatar-fallback">${initials}</div>`;
    const resolvedUrl = resolvePhotoUrl(photoUrl);
    if (!resolvedUrl) return `<div class="avatar-fallback">${initials}</div>`;
    return `<img src="${resolvedUrl}" class="avatar-img" onload="console.log('${logPrefix} loaded:', this.src)" onerror="console.error('${logPrefix} failed:', this.src); this.outerHTML='<div class=\\'avatar-fallback\\'>${initials}</div>';">`;
}

// ===== GLOBAL VARIABLE TO STORE ORIGINAL PROFILE DATA =====
let originalProfileData = {};

// ===== INITIALIZATION =====
async function initializeProfile() {
    try {
        updateUserInfo();
        await loadProfile();
    } catch (error) {
        console.error('Initialization error:', error);
        showToast('Failed to load profile', 'error');
    }
}

// ===== DROPDOWN TOGGLE FUNCTIONS =====
function toggleProfileDropdown(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown) dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

function toggleAvatarDropdown(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('avatarDropdown');
    if (dropdown) dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

function updateUserInfo() {
    const user = sessionManager.getUser();
    if (!user) return;
    const userName = user.full_name || user.username || 'Admin';
    const initial = sessionManager.getUserInitial();

    // Navbar (top-right)
    const navName = document.getElementById('userNameNav');
    const navAvatar = document.getElementById('userAvatarNav');
    if (navName) navName.textContent = userName;
    if (navAvatar) {
        navAvatar.innerHTML = createAvatarHtml(user.photo_url, initial, 'Nav avatar');
    }

    // Sidebar footer
    const sidebarNameEl = document.getElementById('sidebarUserName');
    const sidebarAvatarEl = document.getElementById('sidebarUserAvatar');
    if (sidebarNameEl) sidebarNameEl.textContent = userName;
    if (sidebarAvatarEl) {
        sidebarAvatarEl.innerHTML = createAvatarHtml(user.photo_url, initial, 'Sidebar avatar');
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}
function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

async function loadProfile() {
    try {
        const response = await api.getProfile();
        if (response.success) {
            const profile = response.data;
            const fullName = `${profile.first_name} ${profile.middle_name ? profile.middle_name + ' ' : ''}${profile.last_name}`;

            setText('profileFullName', fullName);

            const avatarEl = document.getElementById('profileAvatar');
            if (avatarEl) {
                const initials = `${profile.first_name[0]}${profile.last_name[0]}`;
                avatarEl.innerHTML = createAvatarHtml(profile.photo_url, initials, 'Profile avatar');
            }

            setText('profileEmployeeId', profile.employee_id || 'N/A');
            setText('profileEmployeeIdDisplay', profile.employee_id || 'N/A');
            setText('profileEmail', profile.email);
            setText('profileRole', 'Administrator');
            setText('profileRoleDisplay', 'Administrator');

            const statusBadge = document.getElementById('profileStatus');
            if (statusBadge) {
                if (profile.status === 'Active') {
                    statusBadge.className = 'badge badge-success';
                    statusBadge.textContent = 'Active';
                } else {
                    statusBadge.className = 'badge badge-danger';
                    statusBadge.textContent = 'Inactive';
                }
            }

            setText('profileCreatedAt', formatDate(profile.created_at));
            setText('profileUpdatedAt', formatDate(profile.updated_at));

            // Fill edit form
            setValue('editEmployeeId', profile.employee_id || '');
            setValue('editFirstName', profile.first_name);
            setValue('editMiddleName', profile.middle_name || '');
            setValue('editLastName', profile.last_name);
            setValue('editEmail', profile.email);

            // ===== STORE ORIGINAL PROFILE DATA FOR VALIDATION =====
            originalProfileData = {
                employee_id: profile.employee_id || '',
                first_name: profile.first_name || '',
                middle_name: profile.middle_name || '',
                last_name: profile.last_name || '',
                email: profile.email || ''
            };

            // Update session and refresh all avatars
            const user = sessionManager.getUser();
            user.full_name = fullName;
            user.email = profile.email;
            user.photo_url = profile.photo_url || null;
            sessionManager.api.setAuth(sessionManager.token, user);
            updateUserInfo();
        } else {
            showToast('Failed to load profile data', 'error');
        }
    } catch (error) {
        console.error('Failed to load profile:', error);
        showToast('Failed to load profile', 'error');
    }
}

function viewProfilePicture() {
    const profile = sessionManager.getUser();
    const imgDisplay = document.getElementById('profilePictureDisplay');
    const initialDisplay = document.getElementById('profileInitialDisplay');

    const resolvedUrl = resolvePhotoUrl(profile.photo_url);
    if (resolvedUrl) {
        imgDisplay.src = resolvedUrl;
        imgDisplay.onerror = function() {
            imgDisplay.style.display = 'none';
            initialDisplay.style.display = 'flex';
            initialDisplay.textContent = sessionManager.getUserInitial();
        };
        imgDisplay.style.display = 'block';
        initialDisplay.style.display = 'none';
    } else {
        imgDisplay.style.display = 'none';
        initialDisplay.style.display = 'flex';
        initialDisplay.textContent = sessionManager.getUserInitial();
    }

    openModal('viewProfilePictureModal');
}

function openPhotoChoiceModal() {
    openModal('photoChoiceModal');
}

function closeAvatarDropdown() {
    const dropdown = document.getElementById('avatarDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

// ===== CAMERA HANDLING =====
let cameraStream = null;

async function triggerCameraCapture() {
    closeModal('photoChoiceModal');
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        const video = document.getElementById('cameraPreview');
        if (!video) {
            showToast('Camera preview element not found.', 'error');
            throw new Error('Missing video element');
        }
        video.srcObject = cameraStream;
        openModal('cameraCaptureModal');
    } catch (error) {
        console.error('Camera access denied or failed:', error);
        const cameraInput = document.getElementById('profilePhotoCameraInput');
        if (cameraInput) {
            cameraInput.click();
        } else {
            showToast('Camera not available, opening file picker.', 'warning');
            document.getElementById('profilePhotoInput').click();
        }
    }
}

function triggerFileUpload() {
    closeModal('photoChoiceModal');
    document.getElementById('profilePhotoInput').click();
}

async function capturePhoto() {
    const video = document.getElementById('cameraPreview');
    if (!video || !cameraStream) {
        showToast('Camera not ready.', 'error');
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
        if (!blob) {
            showToast('Failed to capture photo.', 'error');
            return;
        }
        const file = new File([blob], 'camera_capture.jpg', { type: 'image/jpeg' });
        await changeProfilePicture(file);
        closeModal('cameraCaptureModal');
        stopCameraStream();
    }, 'image/jpeg');
}

function stopCameraStream() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
}

async function changeProfilePicture(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('photo', file);

    try {
        const response = await api.uploadProfilePhoto(formData);
        if (response.success) {
            showToast('Profile picture updated successfully', 'success');
            const user = sessionManager.getUser();
            user.photo_url = response.data.photo_url;
            sessionManager.api.setAuth(sessionManager.token, user);
            updateUserInfo();
            await loadProfile();
        } else {
            showToast(response.message || 'Failed to update profile picture', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to update profile picture', 'error');
    }
}

// ===== EDIT PROFILE =====
function openEditProfileModal() {
    openModal('editProfileModal');
}

async function updateProfile(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // ===== VALIDATION: Check if changes were made =====
    const currentData = {
        employee_id: data.employee_id || '',
        first_name: data.first_name || '',
        middle_name: data.middle_name || '',
        last_name: data.last_name || '',
        email: data.email || ''
    };

    const hasChanges = Object.keys(originalProfileData).some(key =>
        originalProfileData[key] !== currentData[key]
    );

    if (!hasChanges) {
        showToast('No changes were made to your profile.', 'warning');
        return;
    }

    // ===== EXISTING VALIDATION =====
    if (!data.first_name || !data.last_name || !data.email) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const response = await api.updateProfile(data);
        if (response.success) {
            showToast('Profile updated successfully', 'success');
            closeModal('editProfileModal');
            await loadProfile();
        } else {
            showToast(response.message || 'Failed to update profile', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to update profile', 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// ===== CHANGE PASSWORD =====
function openChangePasswordModal() {
    document.getElementById('changePasswordForm').reset();
    openModal('changePasswordModal');
}

async function changePassword(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    if (!data.current_password || !data.new_password || !data.confirm_password) {
        showToast('Please fill in all fields', 'error');
        return;
    }

    if (data.new_password !== data.confirm_password) {
        showToast('New passwords do not match', 'error');
        document.getElementById('confirmPassword').classList.add('is-invalid');
        return;
    }

    if (data.new_password.length < 8) {
        showToast('Password must be at least 8 characters long', 'error');
        document.getElementById('newPassword').classList.add('is-invalid');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const response = await api.changePassword(data.current_password, data.new_password);
        if (response.success) {
            showToast('Password changed successfully', 'success');
            closeModal('changePasswordModal');
            form.reset();
        } else {
            showToast(response.message || 'Failed to change password', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to change password', 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    const editForm = document.getElementById('editProfileForm');
    if (editForm) editForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        await updateProfile(this);
    });

    const passwordForm = document.getElementById('changePasswordForm');
    if (passwordForm) passwordForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        await changePassword(this);
    });

    const photoInput = document.getElementById('profilePhotoInput');
    if (photoInput) photoInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            changeProfilePicture(this.files[0]);
            this.value = '';
        }
    });

    const cameraInput = document.getElementById('profilePhotoCameraInput');
    if (cameraInput) cameraInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            changeProfilePicture(this.files[0]);
            this.value = '';
        }
    });

    const captureBtn = document.getElementById('capturePhotoBtn');
    if (captureBtn) captureBtn.addEventListener('click', capturePhoto);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAllModals();
            stopCameraStream();
        }
    });

    // Close dropdowns when clicking anywhere else
    document.addEventListener('click', function() {
        const profileDropdown = document.getElementById('profileDropdown');
        const avatarDropdown = document.getElementById('avatarDropdown');
        if (profileDropdown) profileDropdown.style.display = 'none';
        if (avatarDropdown) avatarDropdown.style.display = 'none';
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('show');
    const backdrop = modal.querySelector('.modal-backdrop');
    if (backdrop) backdrop.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        const backdrop = modal.querySelector('.modal-backdrop');
        if (backdrop) backdrop.classList.remove('show');
    }
    document.body.style.overflow = '';
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('show');
        const backdrop = modal.querySelector('.modal-backdrop');
        if (backdrop) backdrop.classList.remove('show');
    });
    document.body.style.overflow = '';
}

function formatDate(dateString) {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ===== GLOBAL EXPORTS =====
window.openEditProfileModal = openEditProfileModal;
window.openChangePasswordModal = openChangePasswordModal;
window.closeModal = closeModal;
window.viewProfilePicture = viewProfilePicture;
window.openPhotoChoiceModal = openPhotoChoiceModal;
window.triggerCameraCapture = triggerCameraCapture;
window.triggerFileUpload = triggerFileUpload;
window.capturePhoto = capturePhoto;
window.stopCameraStream = stopCameraStream;
window.toggleProfileDropdown = toggleProfileDropdown;
window.toggleAvatarDropdown = toggleAvatarDropdown;
window.closeAvatarDropdown = closeAvatarDropdown;