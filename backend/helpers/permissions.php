<?php
// backend/helpers/permissions.php

function isAdmin($userRole) {
    return $userRole === 'admin';
}

function isStudent($userRole) {
    return $userRole === 'student';
}

function getUserPermissions($role) {
    $permissions = [
        'admin' => [
            'view_students' => true,
            'add_students' => true,
            'edit_students' => true,
            'toggle_student_status' => true,
            'view_computers' => true,
            'manage_computers' => true,
            'set_computer_maintenance' => true,
            'manage_reservations' => true,
            'approve_reservations' => true,
            'generate_reports' => true,
            'view_reports' => true,
            'manage_settings' => true,
            'manage_semester' => true,
            'manage_library_hours' => true,
            'manage_profile' => true,
            'view_dashboard' => true,
            'manage_notifications' => true,
            'review_update_requests' => true
        ],
        'student' => [
            'view_students' => false,
            'add_students' => false,
            'edit_students' => false,
            'toggle_student_status' => false,
            'view_computers' => true,
            'manage_computers' => false,
            'set_computer_maintenance' => false,
            'manage_reservations' => false,
            'approve_reservations' => false,
            'generate_reports' => false,
            'view_reports' => false,
            'manage_settings' => false,
            'manage_semester' => false,
            'manage_library_hours' => false,
            'manage_profile' => true,
            'view_dashboard' => true,
            'manage_notifications' => false,
            'review_update_requests' => false
        ]
    ];
    return $permissions[$role] ?? [];
}

function hasPermission($userRole, $permission) {
    $perms = getUserPermissions($userRole);
    return $perms[$permission] ?? false;
}

function requireSpecificPermission($permission, $userRole) {
    if (!hasPermission($userRole, $permission)) {
        json_error('Access denied. You do not have permission to perform this action.', HTTP_FORBIDDEN);
    }
}

function requireAdmin(array $userData): void {
    if (!isAdmin($userData['role'] ?? null)) {
        json_error('Access denied. Admin only.', HTTP_FORBIDDEN);
    }
}

function requireStudent(array $userData): void {
    if (!isStudent($userData['role'] ?? null)) {
        json_error('Access denied. Students only.', HTTP_FORBIDDEN);
    }
}

function requireAnyAdmin(array $userData): void {
    requireAdmin($userData);
}

function requireOwnsResource(array $userData, int $resourceOwnerId, string $idKey = 'sub'): void {
    if ((int)($userData[$idKey] ?? 0) !== $resourceOwnerId) {
        json_error('You do not have permission to access this resource.', HTTP_FORBIDDEN);
    }
}

function getRoleRedirectUrl($userRole) {
    if ($userRole === 'admin') {
        return '/frontend/admin/html/dashboard.html';
    }
    return '/frontend/student/html/dashboard.html';
}