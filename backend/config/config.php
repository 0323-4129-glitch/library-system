<?php
// backend/config/config.php

// JWT Secret Key
define('JWT_SECRET', 'rmmc_library_system_secret_key_2024');

// Session Timeout (in minutes)
define('SESSION_TIMEOUT', 30);

// Default Student Hour Limit
define('DEFAULT_HOUR_LIMIT', 10);

// Upload Paths
define('UPLOAD_PATH', __DIR__ . '/../uploads/');
define('PROFILE_IMAGE_PATH', UPLOAD_PATH . 'profile/');
define('REPORT_PATH', UPLOAD_PATH . 'reports/');

// Timezone
date_default_timezone_set('Asia/Manila');

// Error Reporting
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', __DIR__ . '/../logs/error.log');

// CORS Headers
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// FIX: PATCH added — routes like /students/{id}/status, /reservations/{id}/approve,
// /computers/{id}/maintenance, /sessions/{id}/end, /notifications/{id}/read,
// /update-requests/{id}/review are all PATCH. Browser preflight failed without this.
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

// ---------------------------------------------------------------------
// Constants (formerly constants.php)
// ---------------------------------------------------------------------

// Response Codes
define('HTTP_OK', 200);
define('HTTP_CREATED', 201);
define('HTTP_BAD_REQUEST', 400);
define('HTTP_UNAUTHORIZED', 401);
define('HTTP_FORBIDDEN', 403);
define('HTTP_NOT_FOUND', 404);
define('HTTP_CONFLICT', 409);
define('HTTP_SERVER_ERROR', 500);

// User Roles (single admin role — head_admin/staff_admin removed)
define('ROLE_ADMIN', 'admin');
define('ROLE_STUDENT', 'student');

// Account Status
define('STATUS_ACTIVE', 'Active');
define('STATUS_INACTIVE', 'Inactive');

// Computer Status
define('COMPUTER_AVAILABLE', 'Available');
define('COMPUTER_OCCUPIED', 'Occupied');
define('COMPUTER_RESERVED', 'Reserved');
define('COMPUTER_MAINTENANCE', 'Maintenance');

// Reservation Status
define('RESERVATION_PENDING', 'Pending');
define('RESERVATION_APPROVED', 'Approved');
define('RESERVATION_CANCELLED', 'Cancelled');
define('RESERVATION_REJECTED', 'Rejected');
define('RESERVATION_COMPLETED', 'Completed');
define('RESERVATION_EXPIRED', 'Expired');

// Session Status
define('SESSION_ACTIVE', 'Active');
define('SESSION_COMPLETED', 'Completed');

// Notification Types
define('NOTIFICATION_INFO', 'info');
define('NOTIFICATION_SUCCESS', 'success');
define('NOTIFICATION_WARNING', 'warning');
define('NOTIFICATION_ERROR', 'error');

// Short aliases (used in controllers)
define('COMP_AVAILABLE', COMPUTER_AVAILABLE);
define('COMP_OCCUPIED', COMPUTER_OCCUPIED);
define('COMP_RESERVED', COMPUTER_RESERVED);
define('COMP_MAINTENANCE', COMPUTER_MAINTENANCE);

define('RES_PENDING', RESERVATION_PENDING);
define('RES_APPROVED', RESERVATION_APPROVED);
define('RES_CANCELLED', RESERVATION_CANCELLED);
define('RES_REJECTED', RESERVATION_REJECTED);
define('RES_COMPLETED', RESERVATION_COMPLETED);
define('RES_EXPIRED', RESERVATION_EXPIRED);

// Other config
define('RESERVATION_WARNING_MINUTES', 3);
define('RESERVATION_HOLD_MINUTES', 15);      // computer becomes Reserved this many min before a reservation
define('RESERVATION_NO_SHOW_MINUTES', 15);   // Approved with no session this many min after start → Expired
define('UPLOAD_PROFILE_DIR', PROFILE_IMAGE_PATH);
// ---------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------

function get_json_input(): array {
    $input = json_decode(file_get_contents('php://input'), true);
    return is_array($input) ? $input : [];
}

function json_error(string $message, int $statusCode = 400, array $errors = []): void {
    http_response_code($statusCode);
    $payload = ['success' => false, 'message' => $message];
    if (!empty($errors)) {
        $payload['errors'] = $errors;
    }
    echo json_encode($payload);
    exit;
}

function json_success($data = null, string $message = 'Success', int $statusCode = 200): void {
    http_response_code($statusCode);
    echo json_encode([
        'success' => true,
        'message' => $message,
        'data' => $data
    ]);
    exit;
}