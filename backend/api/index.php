<?php
// backend/api/index.php

// Load configuration first so error handling and CORS are initialized.
require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/jwt.php';
require_once __DIR__ . '/../helpers/logger.php';
require_once __DIR__ . '/../helpers/permissions.php';
require_once __DIR__ . '/../helpers/validator.php';
require_once __DIR__ . '/../helpers/rate_limiter.php';

require_once __DIR__ . '/../models/LoginLog.php';
require_once __DIR__ . '/../models/Notification.php';

require_once __DIR__ . '/../controllers/AuthController.php';
require_once __DIR__ . '/../controllers/StudentController.php';
require_once __DIR__ . '/../controllers/AdminController.php';
require_once __DIR__ . '/../controllers/ComputerController.php';
require_once __DIR__ . '/../controllers/ComputerClientController.php';
require_once __DIR__ . '/../controllers/ReservationController.php';
require_once __DIR__ . '/../controllers/SessionController.php';
require_once __DIR__ . '/../controllers/NotificationController.php';
require_once __DIR__ . '/../controllers/ProfileController.php';
require_once __DIR__ . '/../controllers/ReportController.php';
require_once __DIR__ . '/../controllers/SettingsController.php';
require_once __DIR__ . '/../controllers/SemesterController.php';
require_once __DIR__ . '/../controllers/UpdateRequestController.php';
require_once __DIR__ . '/../controllers/DashboardController.php';
require_once __DIR__ . '/../controllers/ActivityLogController.php';
require_once __DIR__ . '/../controllers/LoginLogController.php';
require_once __DIR__ . '/../controllers/ConcernController.php';

// ---------------------------------------------------------------------
// FIX: getallheaders() polyfill.
//
// Some FastCGI/nginx/CGI setups do not define getallheaders(). The old
// code fatal-errored on the first authenticated request on those servers.
// This polyfill rebuilds the header array from $_SERVER, works on any
// SAPI, and is a no-op on Apache where the native function exists.
// ---------------------------------------------------------------------
if (!function_exists('getallheaders')) {
    function getallheaders(): array {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (substr($name, 0, 5) === 'HTTP_') {
                $key = str_replace(
                    ' ',
                    '-',
                    ucwords(strtolower(str_replace('_', ' ', substr($name, 5))))
                );
                $headers[$key] = $value;
            } elseif (in_array($name, ['CONTENT_TYPE', 'CONTENT_LENGTH'], true)) {
                $key = str_replace(
                    ' ',
                    '-',
                    ucwords(strtolower(str_replace('_', ' ', $name)))
                );
                $headers[$key] = $value;
            }
        }
        return $headers;
    }
}

/**
 * FIX: case-insensitive header lookup. Some proxies/clients send
 * "authorization" or "AUTHORIZATION" instead of "Authorization".
 */
function header_value(array $headers, string $name): string
{
    $needle = strtolower($name);
    foreach ($headers as $key => $value) {
        if (strtolower((string)$key) === $needle) {
            return (string)$value;
        }
    }
    return '';
}

function resolve_path(): string
{
    if (isset($_GET['route']) && is_string($_GET['route']) && $_GET['route'] !== '') {
        return '/' . ltrim($_GET['route'], '/');
    }

    if (isset($_SERVER['PATH_INFO']) && $_SERVER['PATH_INFO'] !== '') {
        return $_SERVER['PATH_INFO'];
    }

    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

    $scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
    if ($scriptDir !== '' && str_starts_with($uri, $scriptDir)) {
        $uri = substr($uri, strlen($scriptDir));
    }

    $uri = preg_replace('#/index\.php#', '', $uri);
    // Accept both /api/route and /route for clients using different base URLs.
    if ($uri === '/api') $uri = '/';
    elseif (str_starts_with($uri, '/api/')) $uri = substr($uri, 4);

    $uri = '/' . ltrim($uri, '/');
    return rtrim($uri, '/') === '' ? '/' : rtrim($uri, '/');
}

function require_auth(): array
{
    $headers = getallheaders();
    $authHeader = header_value($headers, 'Authorization');

    $token = '';
    if (stripos($authHeader, 'Bearer ') === 0) {
        $token = trim(substr($authHeader, 7));
    }

    if ($token === '') {
        json_error('Unauthorized', HTTP_UNAUTHORIZED);
    }

    if (strlen($token) > 4096) {
        json_error('Invalid or expired token', HTTP_UNAUTHORIZED);
    }

    $userData = verifyJWT($token);
    if (!$userData) {
        json_error('Invalid or expired token', HTTP_UNAUTHORIZED);
    }

    if (!empty($userData['login_log_id'])) {
        $loginLog = new LoginLog();
        if (!$loginLog->isOpen((int)$userData['login_log_id'])) {
            json_error('Your session has ended. Please log in again.', HTTP_UNAUTHORIZED);
        }
        $loginLog->touch((int)$userData['login_log_id']);
    }

    return $userData;
}

function user_type_label(array $userData): string
{
    return $userData['user_type'] === 'student' ? 'Student' : 'Admin';
}

function q_int(?string $raw, int $default, int $min, int $max): int
{
    if ($raw === null || $raw === '') return $default;
    $v = (int)$raw;
    if ($v < $min) $v = $min;
    if ($v > $max) $v = $max;
    return $v;
}

function q_enum(?string $raw, array $allowed): ?string
{
    if ($raw === null || $raw === '') return null;
    return in_array($raw, $allowed, true) ? $raw : null;
}

// Railway / container health endpoint: does not disclose credentials.
// Keep this endpoint unauthenticated for uptime checks.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' &&
    in_array(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), ['/', '/health', '/api/health'], true)) {
    http_response_code(200);
    echo json_encode(['success' => true, 'message' => 'Library System API is running']);
    exit;
}

$routes = [];

function route(array &$routes, string $method, string $pattern, callable $handler): void
{
    $regex = preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', $pattern);
    $routes[] = ['method' => $method, 'regex' => '#^' . $regex . '$#', 'handler' => $handler];
}

$body = fn() => get_json_input();

$limiter = new RateLimiter();
$rateLimit = function (string $key, int $limit = 5, int $window = 300) use ($limiter) {
    $limiter->check($key . ':' . getIPAddress(), $limit, $window);
};

// --- Auth -------------------------------------------------------------

route($routes, 'POST', '/auth/head-admin/login', function () use ($body, $rateLimit) {
    $rateLimit('login:admin', 20, 300);
    (new AuthController())->adminLogin($body());
});
route($routes, 'POST', '/auth/staff-admin/login', function () use ($body, $rateLimit) {
    $rateLimit('login:admin', 20, 300);
    (new AuthController())->adminLogin($body());
});
route($routes, 'POST', '/auth/student/login', function () use ($body, $rateLimit) {
    $rateLimit('login:student', 20, 300);
    (new AuthController())->studentLogin($body());
});
route($routes, 'POST', '/auth/logout', function () use ($body) {
    $user = require_auth();
    (new AuthController())->logout($user);
});
route($routes, 'POST', '/auth/forgot-password', function () use ($body, $rateLimit) {
    $rateLimit('forgot', 3, 900);
    (new AuthController())->forgotPassword($body());
});
route($routes, 'POST', '/auth/reset-password', function () use ($body) {
    (new AuthController())->resetPassword($body());
});
route($routes, 'POST', '/auth/change-password', function () use ($body) {
    $user = require_auth();
    (new AuthController())->changePassword($user, $body());
});

// --- Students ---------------------------------------------------------

route($routes, 'GET', '/students', function () {
    $user = require_auth();
    requireSpecificPermission('view_students', $user['role']);

    $search = $_GET['search'] ?? null;
    if (is_string($search)) {
        $search = trim($search);
        if ($search !== '' && mb_strlen($search) > 100) {
            $search = mb_substr($search, 0, 100);
        }
        if ($search === '') $search = null;
    } else {
        $search = null;
    }

    (new StudentController())->list($search);
});

// FIX: this endpoint returns only a distinct list of course names from
// the students table — no personal data. The student-side "Request an
// Update" modal needs it to populate the Course dropdown, so it's now
// open to any authenticated user instead of admins only. Rate limiting
// and authentication still apply.
route($routes, 'GET', '/students/courses', function () {
    $user = require_auth();
    (new StudentController())->getCourses();
});

route($routes, 'GET', '/students/{id}', function (array $p) {
    $user = require_auth();
    requireSpecificPermission('view_students', $user['role']);
    (new StudentController())->get((int)$p['id']);
});
route($routes, 'POST', '/students', function () use ($body) {
    $user = require_auth();
    requireSpecificPermission('add_students', $user['role']);
    (new StudentController())->create($body(), (int)$user['sub']);
});
route($routes, 'PUT', '/students/{id}', function (array $p) use ($body) {
    $user = require_auth();
    requireSpecificPermission('edit_students', $user['role']);
    (new StudentController())->update((int)$p['id'], $body(), (int)$user['sub']);
});
route($routes, 'PATCH', '/students/{id}/status', function (array $p) use ($body) {
    $user = require_auth();
    requireSpecificPermission('toggle_student_status', $user['role']);
    $data = $body();
    (new StudentController())->setStatus((int)$p['id'], $data['status'] ?? '', (int)$user['sub']);
});
route($routes, 'PATCH', '/students/{id}/reset-password', function (array $p) {
    $user = require_auth();
    requireAdmin($user);
    (new StudentController())->resetPasswordToStudentId((int)$p['id'], (int)$user['sub']);
});

// --- Admin Management -------------------------------------------------

route($routes, 'GET', '/admins', function () {
    $user = require_auth();
    requireAdmin($user);
    (new AdminController())->list();
});
route($routes, 'GET', '/admins/{id}', function (array $p) {
    $user = require_auth();
    requireAdmin($user);
    (new AdminController())->get((int)$p['id']);
});
route($routes, 'POST', '/admins', function () use ($body) {
    $user = require_auth();
    requireAdmin($user);
    (new AdminController())->create($body(), (int)$user['sub']);
});
route($routes, 'PUT', '/admins/{id}', function (array $p) use ($body) {
    $user = require_auth();
    requireAdmin($user);
    (new AdminController())->update((int)$p['id'], $body(), (int)$user['sub']);
});
route($routes, 'PATCH', '/admins/{id}/status', function (array $p) use ($body) {
    $user = require_auth();
    requireAdmin($user);
    $data = $body();
    (new AdminController())->setStatus((int)$p['id'], $data['status'] ?? '', (int)$user['sub']);
});
route($routes, 'DELETE', '/admins/{id}', function (array $p) {
    $user = require_auth();
    requireAdmin($user);
    (new AdminController())->delete((int)$p['id'], (int)$user['sub']);
});

// --- Computers -------------------------------------------------------

route($routes, 'GET', '/computers/live', function () {
    $user = require_auth();
    requireAdmin($user);
    (new ComputerController())->liveMonitoring();
});
route($routes, 'GET', '/computers', function () {
    $user = require_auth();
    requireSpecificPermission('view_computers', $user['role']);
    (new ComputerController())->list();
});
route($routes, 'GET', '/computers/{id}', function (array $p) {
    $user = require_auth();
    requireSpecificPermission('view_computers', $user['role']);
    (new ComputerController())->get((int)$p['id']);
});
route($routes, 'GET', '/computers/{id}/history', function (array $p) {
    $user = require_auth();
    requireAdmin($user);
    (new ComputerController())->history((int)$p['id']);
});
route($routes, 'POST', '/computers', function () use ($body) {
    $user = require_auth();
    requireSpecificPermission('manage_computers', $user['role']);
    (new ComputerController())->create($body(), (int)$user['sub']);
});
route($routes, 'PUT', '/computers/{id}', function (array $p) use ($body) {
    $user = require_auth();
    requireSpecificPermission('manage_computers', $user['role']);
    (new ComputerController())->update((int)$p['id'], $body(), (int)$user['sub']);
});
route($routes, 'PATCH', '/computers/{id}/maintenance', function (array $p) use ($body) {
    $user = require_auth();
    requireSpecificPermission('set_computer_maintenance', $user['role']);
    $data = $body();
    (new ComputerController())->setMaintenance((int)$p['id'], !empty($data['under_maintenance']), (int)$user['sub']);
});
route($routes, 'DELETE', '/computers/{id}', function (array $p) {
    $user = require_auth();
    requireSpecificPermission('manage_computers', $user['role']);
    (new ComputerController())->delete((int)$p['id'], (int)$user['sub']);
});

// --- Electron client (kiosk) -----------------------------------------

route($routes, 'GET', '/client/computers', function () use ($rateLimit) {
    $rateLimit('client:computers', 60, 60);
    (new ComputerClientController())->listForClient();
});
route($routes, 'POST', '/client/register', function () use ($body, $rateLimit) {
    $rateLimit('client:register', 20, 3600);
    (new ComputerClientController())->register($body());
});
route($routes, 'POST', '/client/login', function () use ($body, $rateLimit) {
    $rateLimit('client:login', 60, 60);
    (new ComputerClientController())->login($body());
});
route($routes, 'GET', '/client/computers/{computerId}/upcoming-reservation', function (array $p) {
    (new ComputerClientController())->checkUpcomingReservation((int)$p['computerId']);
});
route($routes, 'POST', '/client/sessions/{sessionId}/logout', function (array $p) use ($body) {
    $data = $body();
    (new ComputerClientController())->logout((int)$p['sessionId'], $data['ended_by'] ?? 'student');
});
route($routes, 'GET', '/client/sessions/{id}/status', function (array $p) {
    (new ComputerClientController())->sessionStatus((int)$p['id']);
});
route($routes, 'GET', '/settings/library-hours/today', function () {
    (new SettingsController())->getTodayLibraryHours();
});

// --- Reservations ----------------------------------------------------

route($routes, 'GET', '/reservations', function () {
    $user = require_auth();
    requireAnyAdmin($user);

    $status = q_enum($_GET['status'] ?? null, [
        RES_PENDING, RES_APPROVED, RES_CANCELLED,
        RES_REJECTED, RES_COMPLETED, RES_EXPIRED,
    ]);
    if (isset($_GET['status']) && $_GET['status'] !== '' && $status === null) {
        json_error('Validation failed', 422, ['status' => 'Invalid reservation status filter']);
    }

    (new ReservationController())->list($status);
});
route($routes, 'GET', '/reservations/student/{studentId}', function (array $p) {
    $user = require_auth();
    $studentId = (int)$p['studentId'];
    if ($user['user_type'] === 'student') requireOwnsResource($user, $studentId);
    else requireAnyAdmin($user);
    (new ReservationController())->forStudent($studentId);
});
route($routes, 'GET', '/reservations/{id}', function (array $p) {
    $user = require_auth();
    (new ReservationController())->get((int)$p['id'], $user);
});
route($routes, 'POST', '/reservations', function () use ($body) {
    $user = require_auth();
    $data = $body();
    if ($user['user_type'] === 'student') {
        (new ReservationController())->create((int)$user['sub'], $data);
        return;
    }
    requireSpecificPermission('manage_reservations', $user['role']);
    if (empty($data['student_id'])) json_error('student_id is required', 422);
    (new ReservationController())->create((int)$data['student_id'], $data);
});
route($routes, 'PATCH', '/reservations/{id}/approve', function (array $p) {
    $user = require_auth();
    requireSpecificPermission('approve_reservations', $user['role']);
    (new ReservationController())->approve((int)$p['id'], (int)$user['sub']);
});
route($routes, 'PATCH', '/reservations/{id}/reject', function (array $p) {
    $user = require_auth();
    requireSpecificPermission('approve_reservations', $user['role']);
    (new ReservationController())->reject((int)$p['id'], (int)$user['sub']);
});
route($routes, 'PATCH', '/reservations/{id}/cancel', function (array $p) {
    $user = require_auth();
    $cancelledByType = $user['user_type'] === 'student' ? 'student' : 'admin';
    (new ReservationController())->cancel((int)$p['id'], $cancelledByType, (int)$user['sub']);
});

// --- Sessions --------------------------------------------------------

route($routes, 'GET', '/sessions', function () {
    $user = require_auth();
    requireAnyAdmin($user);

    $status = q_enum($_GET['status'] ?? null, [SESSION_ACTIVE, SESSION_COMPLETED]);
    if (isset($_GET['status']) && $_GET['status'] !== '' && $status === null) {
        json_error('Validation failed', 422, ['status' => 'Invalid session status filter']);
    }
    $computerId = isset($_GET['computer_id']) && $_GET['computer_id'] !== ''
        ? max(1, (int)$_GET['computer_id'])
        : null;
    $limit = q_int($_GET['limit'] ?? null, 50, 1, 500);

    (new SessionController())->list($status, $computerId, $limit);
});
route($routes, 'GET', '/sessions/active', function () {
    $user = require_auth();
    requireAnyAdmin($user);
    (new SessionController())->activeSessions();
});
route($routes, 'GET', '/sessions/student/{studentId}', function (array $p) {
    $user = require_auth();
    $studentId = (int)$p['studentId'];
    if ($user['user_type'] === 'student') requireOwnsResource($user, $studentId);
    else requireAnyAdmin($user);
    (new SessionController())->history($studentId);
});
route($routes, 'PATCH', '/sessions/{id}/end', function (array $p) {
    $user = require_auth();
    requireAnyAdmin($user);
    (new SessionController())->end((int)$p['id']);
});

// --- Notifications ---------------------------------------------------

route($routes, 'GET', '/notifications', function () {
    $user = require_auth();
    (new NotificationController())->list(user_type_label($user), (int)$user['sub']);
});
route($routes, 'GET', '/notifications/unread-count', function () {
    $user = require_auth();
    (new NotificationController())->unreadCount(user_type_label($user), (int)$user['sub']);
});

route($routes, 'GET', '/notifications/stream', function () {
    (new NotificationController())->stream();
});

route($routes, 'PATCH', '/notifications/{id}/read', function (array $p) {
    $user = require_auth();
    $n = (new Notification())->findById((int)$p['id']);
    if (!$n) json_error('Notification not found', 404);
    $ownerColumn = $n['user_type'] === 'Admin' ? 'admin_id' : 'student_id';
    $ownerId = (int)($n[$ownerColumn] ?? 0);
    if ($ownerId !== (int)$user['sub']) {
        json_error('You do not have permission to modify this notification.', HTTP_FORBIDDEN);
    }
    (new NotificationController())->markRead((int)$p['id']);
});
route($routes, 'PATCH', '/notifications/read-all', function () {
    $user = require_auth();
    (new NotificationController())->markAllRead(user_type_label($user), (int)$user['sub']);
});
route($routes, 'POST', '/notifications', function () use ($body) {
    $user = require_auth();
    requireSpecificPermission('manage_notifications', $user['role']);
    (new NotificationController())->create($body());
});
route($routes, 'DELETE', '/notifications/{id}', function (array $p) {
    $user = require_auth();
    $n = (new Notification())->findById((int)$p['id']);
    if (!$n) json_error('Notification not found', 404);
    $ownerColumn = $n['user_type'] === 'Admin' ? 'admin_id' : 'student_id';
    $ownerId = (int)($n[$ownerColumn] ?? 0);
    if ($ownerId !== (int)$user['sub']) {
        json_error('You do not have permission to delete this notification.', HTTP_FORBIDDEN);
    }
    (new NotificationController())->delete((int)$p['id']);
});

// --- Concerns --------------------------------------------------------

route($routes, 'GET', '/concerns', function () {
    $user = require_auth();
    requireAnyAdmin($user);

    $status = q_enum($_GET['status'] ?? null, ['Open', 'Replied', 'Resolved']);
    if (isset($_GET['status']) && $_GET['status'] !== '' && $status === null) {
        json_error('Validation failed', 422, ['status' => 'Invalid concern status filter']);
    }
    (new ConcernController())->list();
});
route($routes, 'GET', '/concerns/open-count', function () {
    $user = require_auth();
    requireAnyAdmin($user);
    (new ConcernController())->openCount();
});
route($routes, 'GET', '/concerns/student/{studentId}', function (array $p) {
    $user = require_auth();
    $studentId = (int)$p['studentId'];
    if ($user['user_type'] === 'student') requireOwnsResource($user, $studentId);
    else requireAnyAdmin($user);
    (new ConcernController())->forStudent($studentId);
});
route($routes, 'GET', '/concerns/{id}', function (array $p) {
    $user = require_auth();
    (new ConcernController())->get((int)$p['id'], $user);
});
route($routes, 'POST', '/concerns', function () use ($body) {
    $user = require_auth();
    requireStudent($user);
    (new ConcernController())->create((int)$user['sub'], $body());
});
route($routes, 'POST', '/concerns/{id}/reply', function (array $p) use ($body) {
    $user = require_auth();
    (new ConcernController())->reply((int)$p['id'], $user, $body());
});
route($routes, 'PATCH', '/concerns/{id}/status', function (array $p) use ($body) {
    $user = require_auth();
    requireAnyAdmin($user);
    (new ConcernController())->setStatus((int)$p['id'], $body());
});

// --- Profile ---------------------------------------------------------

route($routes, 'GET', '/profile', function () {
    $user = require_auth();
    (new ProfileController())->get($user);
});
route($routes, 'PUT', '/profile', function () use ($body) {
    $user = require_auth();
    (new ProfileController())->update($user, $body());
});
route($routes, 'POST', '/profile/photo', function () {
    $user = require_auth();
    (new ProfileController())->uploadPhoto($user);
});

// --- Reports ---------------------------------------------------------

route($routes, 'GET', '/reports', function () {
    $user = require_auth();
    requireSpecificPermission('view_reports', $user['role']);
    (new ReportController())->list();
});
route($routes, 'POST', '/reports/{type}', function (array $p) use ($body) {
    $user = require_auth();
    requireSpecificPermission('generate_reports', $user['role']);

    $typeRaw = strtolower((string)$p['type']);
    $validTypes = ['daily', 'weekly', 'monthly', 'yearly', 'semester'];
    if (!in_array($typeRaw, $validTypes, true)) {
        json_error('Invalid report type', 422);
    }

    (new ReportController())->generate(ucfirst($typeRaw), $body(), (int)$user['sub']);
});
route($routes, 'DELETE', '/reports/{id}', function (array $p) {
    $user = require_auth();
    requireSpecificPermission('generate_reports', $user['role']);
    (new ReportController())->delete((int)$p['id']);
});

// --- Settings --------------------------------------------------------

route($routes, 'GET', '/settings/library-hours', function () {
    $user = require_auth();
    requireAnyAdmin($user);
    (new SettingsController())->getLibraryHours();
});
route($routes, 'PUT', '/settings/library-hours', function () use ($body) {
    $user = require_auth();
    requireSpecificPermission('manage_library_hours', $user['role']);
    (new SettingsController())->updateLibraryHours($body(), (int)$user['sub']);
});
route($routes, 'GET', '/settings/semester', function () {
    $user = require_auth();
    requireAnyAdmin($user);
    (new SettingsController())->getSemester();
});
route($routes, 'PUT', '/settings/usage-limit', function () use ($body) {
    $user = require_auth();
    requireSpecificPermission('manage_settings', $user['role']);
    (new SettingsController())->updateUsageLimit($body(), (int)$user['sub']);
});

// --- Semesters -------------------------------------------------------

route($routes, 'GET', '/semesters', function () {
    $user = require_auth();
    requireAnyAdmin($user);
    (new SemesterController())->list();
});
route($routes, 'GET', '/semesters/current', function () {
    $user = require_auth();
    requireAnyAdmin($user);
    (new SemesterController())->current();
});
route($routes, 'POST', '/semesters', function () use ($body) {
    $user = require_auth();
    requireSpecificPermission('manage_semester', $user['role']);
    (new SemesterController())->create($body(), (int)$user['sub']);
});
route($routes, 'PUT', '/semesters/{id}', function (array $p) use ($body) {
    $user = require_auth();
    requireSpecificPermission('manage_semester', $user['role']);
    (new SemesterController())->update((int)$p['id'], $body(), (int)$user['sub']);
});

// --- Update Requests -------------------------------------------------

route($routes, 'GET', '/update-requests', function () {
    $user = require_auth();
    requireAnyAdmin($user);

    $status = q_enum($_GET['status'] ?? null, ['Pending', 'Approved', 'Rejected']);
    if (isset($_GET['status']) && $_GET['status'] !== '' && $status === null) {
        json_error('Validation failed', 422, ['status' => 'Invalid update-request status filter']);
    }
    (new UpdateRequestController())->list($status);
});
route($routes, 'GET', '/update-requests/student/{studentId}', function (array $p) {
    $user = require_auth();
    $studentId = (int)$p['studentId'];
    if ($user['user_type'] === 'student') requireOwnsResource($user, $studentId);
    else requireAnyAdmin($user);
    (new UpdateRequestController())->forStudent($studentId);
});
route($routes, 'POST', '/update-requests', function () use ($body) {
    $user = require_auth();
    requireStudent($user);
    (new UpdateRequestController())->create((int)$user['sub'], $body());
});
route($routes, 'PATCH', '/update-requests/{id}/review', function (array $p) use ($body) {
    $user = require_auth();
    requireSpecificPermission('review_update_requests', $user['role']);
    $data = $body();
    (new UpdateRequestController())->review((int)$p['id'], $data['decision'] ?? '', (int)$user['sub']);
});

// --- Dashboard -------------------------------------------------------

route($routes, 'GET', '/dashboard/admin', function () {
    $user = require_auth();
    requireAnyAdmin($user);
    (new DashboardController())->adminDashboard();
});
route($routes, 'GET', '/dashboard/student', function () {
    $user = require_auth();
    requireStudent($user);
    (new DashboardController())->studentDashboard((int)$user['sub']);
});

// --- Activity & Login Logs -------------------------------------------

route($routes, 'GET', '/activity-logs', function () {
    $user = require_auth();
    requireAdmin($user);

    $limit = q_int($_GET['limit'] ?? null, 50, 1, 500);
    (new ActivityLogController())->list($limit);
});
route($routes, 'GET', '/login-logs', function () {
    $user = require_auth();
    requireAdmin($user);

    $filters = [];

    if (!empty($_GET['user_type'])) {
        $ut = q_enum($_GET['user_type'], ['Admin', 'Student']);
        if ($ut === null) {
            json_error('Validation failed', 422, ['user_type' => 'Must be Admin or Student']);
        }
        $filters['user_type'] = $ut;
    }

    if (!empty($_GET['date'])) {
        $d = (string)$_GET['date'];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
            json_error('Validation failed', 422, ['date' => 'Date must be YYYY-MM-DD']);
        }
        $filters['date'] = $d;
    }

    (new LoginLogController())->list($filters);
});
route($routes, 'GET', '/login-logs/user/{userType}/{userId}', function (array $p) {
    $user = require_auth();
    $userId = (int)$p['userId'];

    $ut = ucfirst(strtolower((string)$p['userType']));
    if (!in_array($ut, ['Admin', 'Student'], true)) {
        json_error('Validation failed', 422, ['user_type' => 'Must be Admin or Student']);
    }

    $isSelf = $user['user_type'] === 'student'
        && $ut === 'Student'
        && (int)$user['sub'] === $userId;
    if (!$isSelf) requireAnyAdmin($user);

    (new LoginLogController())->forUser($ut, $userId);
});

// ---------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = resolve_path();

foreach ($routes as $route) {
    if ($route['method'] !== $method) continue;
    if (preg_match($route['regex'], $path, $matches)) {
        $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
        try {
            ($route['handler'])($params);
        } catch (PDOException $e) {
            error_log('Database error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            json_error('A database error occurred. Please try again later.', HTTP_SERVER_ERROR);
        } catch (Throwable $e) {
            error_log('Application error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            json_error('An unexpected error occurred. Please try again later.', HTTP_SERVER_ERROR);
        }
        exit;
    }
}

json_error('Route not found', HTTP_NOT_FOUND);
