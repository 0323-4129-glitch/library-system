<?php
// backend/helpers/functions.php
require_once __DIR__ . '/../config/database.php';

function sanitize($input) {
    if (is_array($input)) {
        return array_map('sanitize', $input);
    }
    return htmlspecialchars(strip_tags(trim($input)), ENT_QUOTES, 'UTF-8');
}

/**
 * logActivity() — legacy helper still called by a few older controllers.
 *
 * CHANGES IN THIS REVISION
 *  - Uses the static Database::getConnection() instead of the awkward
 *    `Database::getInstance()->getConnection()` (getConnection is a
 *    static method).
 *  - Now records the level as the `action` and the actual message as
 *    the description, instead of stamping every row with 'INFO'/'DEBUG'
 *    as if it were a user action.
 */
function logActivity($adminId, $action, $description = null) {
    try {
        $conn = Database::getConnection();
        $stmt = $conn->prepare(
            "INSERT INTO activity_logs (admin_id, action, description)
             VALUES (:admin_id, :action, :description)"
        );
        $stmt->execute([
            'admin_id'    => $adminId,
            'action'      => $action,
            'description' => $description
        ]);
    } catch (Exception $e) {
        // Silent fail — logging must never take down a request.
    }
}
/**
 * verify_password($plain, $hash) — thin wrapper around password_verify(),
 * used by every controller's login/change-password flow.
 */
function verify_password(string $plain, string $hash): bool {
    return password_verify($plain, $hash);
}

/**
 * hash_password() — every password-setting call site (StaffController::create,
 * StudentController::create, AuthController::resetPassword/changePassword,
 * UpdateRequestController::review for the Student ID reset case) must call
 * this before handing a plaintext password to a model. The models
 * themselves never hash — they only store whatever string they're given.
 */
function hash_password(string $plain): string {
    return password_hash($plain, PASSWORD_DEFAULT);
}

/**
 * FIX: added — used by ReportController/reports.php when rendering report
 * titles and tables (formatDate($date), formatDate($weekStart), etc.).
 * Was referenced in several places but never defined anywhere, which would
 * fatal-error the first time a report was generated.
 *
 * Accepts anything strtotime() can parse (Y-m-d, full datetime strings,
 * etc.) and a Unix timestamp. Returns the original string unchanged if it
 * can't be parsed, rather than throwing, so a bad date never takes down
 * report generation.
 */
function formatDate($date, string $format = 'F j, Y'): string {
    if ($date === null || $date === '') {
        return '';
    }
    $timestamp = is_numeric($date) ? (int)$date : strtotime((string)$date);
    if ($timestamp === false) {
        return (string)$date;
    }
    return date($format, $timestamp);
}

function generateRandomString($length = 32) {
    return bin2hex(random_bytes($length / 2));
}

function getIPAddress() {
    $ipaddress = '';
    if (isset($_SERVER['HTTP_CLIENT_IP']))
        $ipaddress = $_SERVER['HTTP_CLIENT_IP'];
    else if(isset($_SERVER['HTTP_X_FORWARDED_FOR']))
        $ipaddress = $_SERVER['HTTP_X_FORWARDED_FOR'];
    else if(isset($_SERVER['HTTP_X_FORWARDED']))
        $ipaddress = $_SERVER['HTTP_X_FORWARDED'];
    else if(isset($_SERVER['HTTP_FORWARDED_FOR']))
        $ipaddress = $_SERVER['HTTP_FORWARDED_FOR'];
    else if(isset($_SERVER['HTTP_FORWARDED']))
        $ipaddress = $_SERVER['HTTP_FORWARDED'];
    else if(isset($_SERVER['REMOTE_ADDR']))
        $ipaddress = $_SERVER['REMOTE_ADDR'];
    else
        $ipaddress = 'UNKNOWN';
    return $ipaddress;
}