<?php
require_once __DIR__ . '/../config/database.php';

class LoginLog
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    // ============================================================
    // BASIC WRITE OPERATIONS
    // ============================================================

    public function recordLogin(
        string $userType,
        int $userId,
        string $ipAddress,
        ?int $computerId = null,
        ?int $sessionId = null
    ): int {
        $stmt = $this->conn->prepare(
            "INSERT INTO login_logs
                (admin_id, student_id, login_time, last_seen_at, ip_address, computer_id, session_id)
             VALUES
                (:admin_id, :student_id, NOW(), NOW(), :ip_address, :computer_id, :session_id)"
        );
        $stmt->execute([
            'admin_id'    => $userType === 'Admin' ? $userId : null,
            'student_id'  => $userType === 'Student' ? $userId : null,
            'ip_address'  => $ipAddress,
            'computer_id' => $computerId,
            'session_id'  => $sessionId,
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function recordLogout(int $logId): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE login_logs
             SET logout_time = NOW(), last_seen_at = NOW()
             WHERE id = :id"
        );
        return $stmt->execute(['id' => $logId]);
    }

    // ============================================================
    // READ OPERATIONS
    // ============================================================

    public function openSession(string $userType, int $userId, bool $kioskOnly = false): array|false
    {
        $column = $this->columnFor($userType);

        $sql = "SELECT *, {$this->userShape()}
                FROM login_logs
                WHERE $column = :user_id
                  AND logout_time IS NULL";

        if ($kioskOnly) {
            $sql .= " AND session_id IS NOT NULL";
        } else {
            $sql .= " AND session_id IS NULL";
        }

        $sql .= " ORDER BY id DESC LIMIT 1";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute(['user_id' => $userId]);
        return $stmt->fetch();
    }

    public function byUser(string $userType, int $userId): array
    {
        $column = $this->columnFor($userType);
        $stmt = $this->conn->prepare(
            "SELECT *, {$this->userShape()}
             FROM login_logs
             WHERE $column = :user_id
             ORDER BY login_time DESC"
        );
        $stmt->execute(['user_id' => $userId]);
        return $stmt->fetchAll();
    }

    public function all(array $filters = []): array
    {
        $sql = "SELECT *, {$this->userShape()} FROM login_logs WHERE 1=1";
        $params = [];

        if (!empty($filters['user_type'])) {
            $column = $this->columnFor($filters['user_type']);
            $sql .= " AND $column IS NOT NULL";
        }
        if (!empty($filters['date'])) {
            $sql .= " AND DATE(login_time) = :date";
            $params['date'] = $filters['date'];
        }
        $sql .= " ORDER BY login_time DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    // ============================================================
    // SINGLE-DEVICE WEB LOGIN ENFORCEMENT
    //
    // "Web login"   = session_id IS NULL
    // "Kiosk login" = session_id IS NOT NULL
    // ============================================================

    /**
     * Return the currently-open WEB login for this user, or false.
     *
     * FIX: the timeout window is inlined as an integer. Under
     * PDO::ATTR_EMULATE_PREPARES = false (set in database.php), MySQL
     * rejects bound placeholders inside INTERVAL — the same bug
     * RateLimiter already documents and works around.
     */
    public function activeWebLogin(string $userType, int $userId, int $timeoutMinutes): array|false
    {
        $column = $this->columnFor($userType);
        $timeoutMinutes = max(1, (int)$timeoutMinutes);

        $stmt = $this->conn->prepare(
            "SELECT * FROM login_logs
             WHERE $column = :user_id
               AND session_id IS NULL
               AND logout_time IS NULL
               AND COALESCE(last_seen_at, login_time) > DATE_SUB(NOW(), INTERVAL {$timeoutMinutes} MINUTE)
             ORDER BY id DESC
             LIMIT 1"
        );
        $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetch();
    }

    public function touch(int $logId): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE login_logs
             SET last_seen_at = NOW()
             WHERE id = :id
               AND logout_time IS NULL"
        );
        $stmt->execute(['id' => $logId]);
        return $stmt->rowCount() > 0;
    }

    public function isOpen(int $logId): bool
    {
        $stmt = $this->conn->prepare(
            "SELECT id FROM login_logs
             WHERE id = :id AND logout_time IS NULL
             LIMIT 1"
        );
        $stmt->execute(['id' => $logId]);
        return (bool)$stmt->fetch();
    }

    public function closeAllWebLogins(string $userType, int $userId): int
    {
        $column = $this->columnFor($userType);
        $stmt = $this->conn->prepare(
            "UPDATE login_logs
             SET logout_time = NOW(), last_seen_at = NOW()
             WHERE $column = :user_id
               AND session_id IS NULL
               AND logout_time IS NULL"
        );
        $stmt->execute(['user_id' => $userId]);
        return $stmt->rowCount();
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    private function userShape(): string
    {
        return "CASE WHEN admin_id IS NOT NULL THEN 'Admin' ELSE 'Student' END AS user_type,
                COALESCE(admin_id, student_id) AS user_id";
    }

    private function columnFor(string $userType): string
    {
        return $userType === 'Admin' ? 'admin_id' : 'student_id';
    }
}