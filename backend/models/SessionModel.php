<?php
require_once __DIR__ . '/../config/database.php';

/**
 * SessionModel
 * Table: sessions
 */
class SessionModel
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    /**
     * Start a session and return its id, session_token, and the
     * per-session time cap (in minutes).
     *
     * The `$minutes` parameter lets the caller override the default
     * per-session cap. This is used for reservation-bound sessions:
     * the caller passes the number of minutes until the reservation's
     * end_time, and the kiosk will count down from that value and
     * auto-logout when it reaches zero.
     *
     * Pass null (or omit the argument) to fall back to the
     * DEFAULT_SESSION_MINUTES constant.
     *
     * @return array{id: int, token: string, minutes: int}
     */
    public function start(
        int $studentId,
        int $computerId,
        ?int $reservationId,
        string $sessionType,
        ?int $minutes = null
    ): array {
        // Default cap when nothing is specified.
        if ($minutes === null || $minutes < 1) {
            $minutes = defined('DEFAULT_SESSION_MINUTES') ? (int)DEFAULT_SESSION_MINUTES : 30;
            if ($minutes < 1) $minutes = 30;
        }

        $token = bin2hex(random_bytes(16));
        $stmt = $this->conn->prepare(
            "INSERT INTO sessions (student_id, computer_id, reservation_id, login_time, session_type, status, session_token, remaining_time_minutes)
             VALUES (:student_id, :computer_id, :reservation_id, NOW(), :session_type, 'Active', :token, :remaining)"
        );
        $stmt->execute([
            'student_id'     => $studentId,
            'computer_id'    => $computerId,
            'reservation_id' => $reservationId,
            'session_type'   => $sessionType,
            'token'          => $token,
            'remaining'      => $minutes,
        ]);
        return [
            'id'      => (int)$this->conn->lastInsertId(),
            'token'   => $token,
            'minutes' => $minutes,
        ];
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM sessions WHERE id = :id LIMIT 1");
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function end(int $id, string $endedBy = 'student'): int|false
    {
        $stmt = $this->conn->prepare(
            "UPDATE sessions
             SET logout_time = NOW(),
                 duration_minutes = TIMESTAMPDIFF(MINUTE, login_time, NOW()),
                 status = 'Completed',
                 ended_by = :ended_by,
                 ended_at = NOW(),
                 remaining_time_minutes = 0
             WHERE id = :id AND status = 'Active'"
        );
        if (!$stmt->execute(['ended_by' => $endedBy, 'id' => $id])) {
            return false;
        }

        if ($stmt->rowCount() === 0) {
            return false;
        }

        $stmt2 = $this->conn->prepare("SELECT duration_minutes FROM sessions WHERE id = :id LIMIT 1");
        $stmt2->execute(['id' => $id]);
        $row = $stmt2->fetch();
        return $row ? (int)$row['duration_minutes'] : false;
    }

    public function existsForReservation(int $reservationId): bool
    {
        $stmt = $this->conn->prepare(
            "SELECT id FROM sessions WHERE reservation_id = :reservation_id LIMIT 1"
        );
        $stmt->execute(['reservation_id' => $reservationId]);
        return (bool)$stmt->fetch();
    }

    public function activeByComputer(int $computerId): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT * FROM sessions WHERE computer_id = :computer_id AND status = 'Active' LIMIT 1"
        );
        $stmt->execute(['computer_id' => $computerId]);
        return $stmt->fetch();
    }

    public function activeByStudent(int $studentId): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT * FROM sessions WHERE student_id = :student_id AND status = 'Active' LIMIT 1"
        );
        $stmt->execute(['student_id' => $studentId]);
        return $stmt->fetch();
    }

    public function allActive(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT sess.*,
                    st.student_id AS student_number,
                    st.first_name,
                    st.middle_name,
                    st.last_name,
                    st.photo_url,
                    st.remaining_hours,
                    c.computer_number,
                    c.computer_name
             FROM sessions sess
             INNER JOIN students st ON sess.student_id = st.id
             INNER JOIN computers c ON sess.computer_id = c.id
             WHERE sess.status = 'Active'
             ORDER BY sess.login_time ASC"
        );
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function history(array $filters = []): array
    {
        $sql = "SELECT sess.*, st.student_id AS student_number, st.first_name, st.last_name,
                       c.computer_number, c.computer_name
                FROM sessions sess
                INNER JOIN students st ON sess.student_id = st.id
                INNER JOIN computers c ON sess.computer_id = c.id
                WHERE 1=1";
        $params = [];

        if (!empty($filters['status'])) {
            $sql .= " AND sess.status = :status";
            $params['status'] = $filters['status'];
        }
        if (!empty($filters['date_from'])) {
            $sql .= " AND DATE(sess.login_time) >= :date_from";
            $params['date_from'] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND DATE(sess.login_time) <= :date_to";
            $params['date_to'] = $filters['date_to'];
        }
        if (!empty($filters['computer_id'])) {
            $sql .= " AND sess.computer_id = :computer_id";
            $params['computer_id'] = $filters['computer_id'];
        }
        if (!empty($filters['student_id'])) {
            $sql .= " AND sess.student_id = :student_id";
            $params['student_id'] = $filters['student_id'];
        }

        $sql .= " ORDER BY sess.login_time DESC";

        if (!empty($filters['limit'])) {
            $sql .= " LIMIT " . (int)$filters['limit'];
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }
}