<?php
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/LoginLog.php';

class NotificationController
{
    private Notification $model;

    /**
     * FIX: server-side length caps. The frontend enforces these same
     * numbers, but a direct API caller could bypass that — the DB column
     * limits would then either error (strict mode) or silently truncate.
     */
    private const TITLE_MAX_LENGTH   = 150;
    private const MESSAGE_MAX_LENGTH = 2000;
    private const MAX_BROADCAST_STUDENTS = 5000;

    public function __construct()
    {
        $this->model = new Notification();
    }

    public function list(string $userType, int $userId): void
    {
        json_success($this->model->forUser($userType, $userId));
    }

    public function unreadCount(string $userType, int $userId): void
    {
        json_success(['unread' => $this->model->unreadCount($userType, $userId)]);
    }

    public function markRead(int $id): void
    {
        $this->model->markRead($id);
        json_success(null, 'Notification marked as read');
    }

    public function markAllRead(string $userType, int $userId): void
    {
        $unread = $this->model->unreadCount($userType, $userId);
        if ($unread === 0) {
            json_success(['updated' => 0], 'No unread notifications');
            return;
        }

        $this->model->markAllRead($userType, $userId);
        json_success(['updated' => $unread], 'All notifications marked as read');
    }

    // ============================================================
    // SSE — real-time notification stream
    // ============================================================

    public function stream(): void
    {
        // ---- 1. Auth (header OR ?token=) --------------------------------
        $token = '';
        if (function_exists('getallheaders')) {
            $h = getallheaders();
            $token = str_replace('Bearer ', '', $h['Authorization'] ?? '');
        }
        if (!$token && !empty($_GET['token'])) {
            $token = $_GET['token'];
        }
        if (!$token) { http_response_code(401); exit; }

        $userData = verifyJWT($token);
        if (!$userData) { http_response_code(401); exit; }

        // FIX: verify the backing login_logs row is still open. Without
        // this, a token that had been force-closed or logged out could
        // hold the SSE stream open and receive notifications until the
        // JWT itself expired.
        if (!empty($userData['login_log_id'])) {
            $loginLog = new LoginLog();
            if (!$loginLog->isOpen((int)$userData['login_log_id'])) {
                http_response_code(401);
                exit;
            }
        }

        $userType = $userData['user_type'] === 'student' ? 'Student' : 'Admin';
        $userId   = (int)$userData['sub'];
        $column   = $userType === 'Admin' ? 'admin_id' : 'student_id';

        // ---- 2. SSE headers --------------------------------------------
        while (ob_get_level() > 0) ob_end_clean();
        @ini_set('output_buffering', 'off');
        @ini_set('zlib.output_compression', false);
        @ini_set('implicit_flush', true);
        ob_implicit_flush(true);
        @set_time_limit(0);

        header('Content-Type: text/event-stream; charset=utf-8');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('X-Accel-Buffering: no');
        header('Connection: keep-alive');

        // ---- 3. Where to start -----------------------------------------
        $lastId = 0;
        if (!empty($_SERVER['HTTP_LAST_EVENT_ID'])) {
            $lastId = (int)$_SERVER['HTTP_LAST_EVENT_ID'];
        } elseif (!empty($_GET['last_id'])) {
            $lastId = (int)$_GET['last_id'];
        }

        $db = Database::getConnection();

        if ($lastId === 0) {
            $stmt = $db->prepare(
                "SELECT COALESCE(MAX(id), 0) AS max_id
                 FROM notifications WHERE $column = :uid"
            );
            $stmt->execute(['uid' => $userId]);
            $lastId = (int)$stmt->fetch()['max_id'];
        }

        echo "retry: 3000\n\n";
        echo "event: connected\n";
        echo "data: " . json_encode(['user_type' => $userType, 'last_id' => $lastId]) . "\n\n";
        flush();

        // ---- 4. Main loop ----------------------------------------------
        $startTime       = time();
        $lastHeartbeat   = time();
        $MAX_SSE_SECONDS = 55;
        $POLL_INTERVAL   = 3;
        $HEARTBEAT_EVERY = 15;

        while (true) {
            if (connection_aborted()) break;
            if (time() - $startTime > $MAX_SSE_SECONDS) break;

            try {
                $stmt = $db->prepare(
                    "SELECT id, admin_id, student_id, title, message, type, is_read, created_at
                     FROM notifications
                     WHERE $column = :uid AND id > :last_id
                     ORDER BY id ASC
                     LIMIT 20"
                );
                $stmt->execute(['uid' => $userId, 'last_id' => $lastId]);
                $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            } catch (Throwable $e) {
                $rows = [];
            }

            foreach ($rows as $row) {
                $row['user_type'] = $userType;
                $row['user_id']   = $userId;
                $row['is_read']   = (int)$row['is_read'];

                echo "id: {$row['id']}\n";
                echo "event: notification\n";
                echo "data: " . json_encode($row) . "\n\n";
                $lastId = (int)$row['id'];
            }

            if (!empty($rows)) flush();

            if (time() - $lastHeartbeat >= $HEARTBEAT_EVERY) {
                echo ": heartbeat " . time() . "\n\n";
                flush();
                $lastHeartbeat = time();
            }

            sleep($POLL_INTERVAL);
        }

        echo "event: goodbye\n";
        echo "data: {}\n\n";
        flush();
        exit;
    }

    public function create(array $data): void
    {
        $v = (new Validator())
            ->required($data, ['recipient_type', 'title', 'message'])
            ->in($data, 'recipient_type', [
                'all', 'students',
                'specific_students', 'low_hours',
                'Student',
            ])
            ->maxLength($data, 'title', self::TITLE_MAX_LENGTH)
            ->maxLength($data, 'message', self::MESSAGE_MAX_LENGTH);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $data['type'] = $data['type'] ?? 'info';
        $v2 = (new Validator())->in($data, 'type', [
            'info', 'success', 'warning', 'error',
            'reservation', 'session', 'update', 'system', 'concern',
        ]);
        if ($v2->fails()) json_error('Validation failed', 422, $v2->getErrors());

        $userType = $data['recipient_type'];
        $title    = trim((string)$data['title']);
        $message  = trim((string)$data['message']);
        $type     = $data['type'];

        if ($title === '' || $message === '') {
            json_error('Validation failed', 422, [
                'title'   => 'Title cannot be blank',
                'message' => 'Message cannot be blank',
            ]);
        }

        if (in_array($userType, ['all', 'students'], true)) {
            $db = Database::getConnection();
            $sent = 0;
            $students = $db->query("SELECT id FROM students WHERE status='Active'")->fetchAll(PDO::FETCH_COLUMN);
            foreach ($students as $id) {
                $this->model->send('Student', (int)$id, $title, $message, $type);
                $sent++;
            }
            json_success(['sent' => $sent, 'mode' => $userType], 'Notification sent successfully');
            return;
        }

        if ($userType === 'low_hours') {
            $threshold = isset($data['hours_threshold']) ? (float)$data['hours_threshold'] : 1.0;
            if ($threshold < 0) $threshold = 0;
            if ($threshold > 200) {
                json_error('Validation failed', 422, [
                    'hours_threshold' => 'Threshold must not exceed 200 hours',
                ]);
            }

            $db = Database::getConnection();
            $stmt = $db->prepare(
                "SELECT id FROM students
                 WHERE status = 'Active' AND remaining_hours <= :threshold
                 ORDER BY remaining_hours ASC"
            );
            $stmt->execute(['threshold' => $threshold]);
            $studentIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

            $sent = 0;
            foreach ($studentIds as $sid) {
                $this->model->send('Student', (int)$sid, $title, $message, $type);
                $sent++;
            }

            json_success(
                ['sent' => $sent, 'mode' => 'low_hours', 'threshold' => $threshold],
                $sent > 0
                    ? "Notification sent to {$sent} student(s) with ≤ {$threshold} hour(s) remaining"
                    : "No students currently have ≤ {$threshold} hour(s) remaining"
            );
            return;
        }

        if ($userType === 'specific_students') {
            if (empty($data['student_ids']) || !is_array($data['student_ids'])) {
                json_error('student_ids array is required for specific_students', 422);
            }

            // FIX: cap the recipient count so a single request can't fan
            // out to thousands of rows in one shot.
            if (count($data['student_ids']) > self::MAX_BROADCAST_STUDENTS) {
                json_error(
                    'Cannot target more than ' . self::MAX_BROADCAST_STUDENTS . ' students per request',
                    422
                );
            }

            $studentIds = array_map('intval', $data['student_ids']);
            $sent = 0;
            foreach ($studentIds as $sid) {
                $this->model->send('Student', $sid, $title, $message, $type);
                $sent++;
            }
            json_success(['sent' => $sent, 'mode' => 'specific_students'], 'Notification sent to selected students');
            return;
        }

        if ($userType === 'Student') {
            $recipientId = $data['recipient_id'] ?? null;
            if (!$recipientId) json_error('recipient_id is required for single recipient', 422);
            $id = $this->model->send('Student', (int)$recipientId, $title, $message, $type);
            json_success(['id' => $id, 'sent' => 1, 'mode' => 'single'], 'Notification sent', 201);
            return;
        }

        json_error('Invalid recipient type', 422);
    }

    public function delete(int $id): void
    {
        $this->model->delete($id);
        json_success(null, 'Notification deleted');
    }
}