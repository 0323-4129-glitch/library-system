<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/config.php';

/**
 * Reservation Model
 * Table: reservations
 */
class Reservation
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function create(array $data): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO reservations (student_id, computer_id, reservation_date, start_time, end_time, status)
             VALUES (:student_id, :computer_id, :reservation_date, :start_time, :end_time, 'Pending')"
        );
        $stmt->execute([
            'student_id'       => $data['student_id'],
            'computer_id'      => $data['computer_id'],
            'reservation_date' => $data['reservation_date'],
            'start_time'       => $data['start_time'],
            'end_time'         => $data['end_time'],
        ]);
        return (int)$this->conn->lastInsertId();
    }

    /** Overlap check used before allowing submission — triggers conflict warnings */
    public function hasConflict(int $computerId, string $date, string $startTime, string $endTime, ?int $excludeId = null): bool
    {
        $sql = "SELECT id FROM reservations
                WHERE computer_id = :computer_id
                  AND reservation_date = :date
                  AND status IN ('Pending', 'Approved')
                  AND (:start_time < end_time AND :end_time > start_time)";
        $params = [
            'computer_id' => $computerId,
            'date'        => $date,
            'start_time'  => $startTime,
            'end_time'    => $endTime,
        ];
        if ($excludeId !== null) {
            $sql .= " AND id != :exclude_id";
            $params['exclude_id'] = $excludeId;
        }
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount() > 0;
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT r.*, s.student_id AS student_number, s.first_name, s.last_name,
                    c.computer_number, c.computer_name
             FROM reservations r
             INNER JOIN students s ON r.student_id = s.id
             INNER JOIN computers c ON r.computer_id = c.id
             WHERE r.id = :id LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function pending(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT r.*, s.student_id AS student_number, s.first_name, s.last_name,
                    c.computer_number, c.computer_name
             FROM reservations r
             INNER JOIN students s ON r.student_id = s.id
             INNER JOIN computers c ON r.computer_id = c.id
             WHERE r.status = 'Pending'
             ORDER BY r.reservation_date ASC, r.start_time ASC"
        );
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function all(array $filters = []): array
    {
        $sql = "SELECT r.*, s.student_id AS student_number, s.first_name, s.last_name,
                       c.computer_number, c.computer_name
                FROM reservations r
                INNER JOIN students s ON r.student_id = s.id
                INNER JOIN computers c ON r.computer_id = c.id
                WHERE 1=1";
        $params = [];

        if (!empty($filters['status'])) {
            $sql .= " AND r.status = :status";
            $params['status'] = $filters['status'];
        }
        if (!empty($filters['date'])) {
            $sql .= " AND r.reservation_date = :date";
            $params['date'] = $filters['date'];
        }

        $sql .= " ORDER BY r.reservation_date DESC, r.start_time DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function byStudent(int $studentId): array
    {
        $stmt = $this->conn->prepare(
            "SELECT r.*, c.computer_number, c.computer_name
             FROM reservations r
             INNER JOIN computers c ON r.computer_id = c.id
             WHERE r.student_id = :student_id
             ORDER BY r.reservation_date DESC, r.start_time DESC"
        );
        $stmt->execute(['student_id' => $studentId]);
        return $stmt->fetchAll();
    }

    public function byComputerAndDate(int $computerId, string $date): array
    {
        $stmt = $this->conn->prepare(
            "SELECT * FROM reservations
             WHERE computer_id = :computer_id AND reservation_date = :date
               AND status IN ('Pending', 'Approved')
             ORDER BY start_time ASC"
        );
        $stmt->execute(['computer_id' => $computerId, 'date' => $date]);
        return $stmt->fetchAll();
    }

    /**
     * Approved reservation on this computer today whose start_time +
     * $graceMinutes has already passed — i.e. a no-show candidate.
     *
     * FIX: $graceSeconds is inlined as an int. Under
     * PDO::ATTR_EMULATE_PREPARES = false, MySQL rejects bound placeholders
     * inside SEC_TO_TIME, so the old version threw a PDOException on every
     * call and no-show detection was effectively dead.
     */
    public function approvedPastGrace(int $computerId, int $graceMinutes): array|false
    {
        $graceSeconds = max(60, (int)$graceMinutes * 60);
        $stmt = $this->conn->prepare(
            "SELECT * FROM reservations
             WHERE computer_id = :computer_id
               AND status = 'Approved'
               AND reservation_date = CURDATE()
               AND ADDTIME(start_time, SEC_TO_TIME({$graceSeconds})) < CURTIME()
             ORDER BY start_time ASC
             LIMIT 1"
        );
        $stmt->execute(['computer_id' => $computerId]);
        return $stmt->fetch();
    }

    /**
     * Approved reservation for this computer starting within the next
     * $minutesWindow. Same placeholder-inlining fix as approvedPastGrace().
     */
    public function upcomingForComputer(int $computerId, int $minutesWindow): array|false
    {
        $seconds = max(60, (int)$minutesWindow * 60);
        $stmt = $this->conn->prepare(
            "SELECT * FROM reservations
             WHERE computer_id = :computer_id
               AND status = 'Approved'
               AND reservation_date = CURDATE()
               AND start_time BETWEEN CURTIME() AND ADDTIME(CURTIME(), SEC_TO_TIME({$seconds}))
             ORDER BY start_time ASC
             LIMIT 1"
        );
        $stmt->execute(['computer_id' => $computerId]);
        return $stmt->fetch();
    }

    /**
     * Sweep Approved reservations whose no-show window has passed without a
     * session starting. Called opportunistically from list views, kiosk
     * login, and the admin dashboard — no cron job needed.
     *
     * A reservation is expired when:
     *   - its date is before today, OR
     *   - its date is today AND start_time + grace < now
     * AND no session has ever been created against it
     * AND the reserving student does not currently have an active session
     *     on the same computer (walk-in that overlaps the window).
     *
     * Every affected computer's status is recomputed afterwards, so a
     * computer that was stuck on Reserved becomes Available again.
     *
     * @return int  number of reservations expired
     */
    public function expireNoShows(int $graceMinutes = RESERVATION_NO_SHOW_MINUTES): int
    {
        $graceSeconds = max(60, (int)$graceMinutes * 60);

        $stmt = $this->conn->prepare(
            "SELECT r.id, r.computer_id
             FROM reservations r
             WHERE r.status = 'Approved'
               AND (
                   r.reservation_date < CURDATE()
                   OR (r.reservation_date = CURDATE()
                       AND ADDTIME(r.start_time, SEC_TO_TIME({$graceSeconds})) < CURTIME())
               )
               AND NOT EXISTS (
                   SELECT 1 FROM sessions s
                   WHERE s.reservation_id = r.id
                      OR (s.computer_id = r.computer_id
                          AND s.student_id = r.student_id
                          AND s.status = 'Active')
               )"
        );
        $stmt->execute();
        $rows = $stmt->fetchAll();

        if (empty($rows)) {
            return 0;
        }

        $ids = array_map('intval', array_column($rows, 'id'));
        $computerIds = array_unique(array_map('intval', array_column($rows, 'computer_id')));

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $upd = $this->conn->prepare(
            "UPDATE reservations SET status = 'Expired' WHERE id IN ($placeholders)"
        );
        $upd->execute($ids);

        require_once __DIR__ . '/Computer.php';
        $computerModel = new Computer();
        foreach ($computerIds as $cid) {
            $computerModel->recomputeStatus($cid);
        }

        return count($ids);
    }

    public function approve(int $id, int $approvedBy): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE reservations SET status = 'Approved', approved_by = :by WHERE id = :id"
        );
        return $stmt->execute(['by' => $approvedBy, 'id' => $id]);
    }

    public function reject(int $id, int $reviewedBy, ?string $reason = null): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE reservations
             SET status = 'Rejected',
                 rejected_by = :by,
                 rejection_reason = :reason
             WHERE id = :id"
        );
        return $stmt->execute([
            'by'     => $reviewedBy,
            'reason' => $reason,
            'id'     => $id,
        ]);
    }

    public function cancel(int $id, ?int $cancelledBy = null, ?string $reason = null): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE reservations
             SET status = 'Cancelled',
                 cancelled_by = :by,
                 cancelled_reason = :reason
             WHERE id = :id"
        );
        return $stmt->execute([
            'by'     => $cancelledBy,
            'reason' => $reason,
            'id'     => $id,
        ]);
    }

    public function markCompleted(int $id): bool
    {
        $stmt = $this->conn->prepare("UPDATE reservations SET status = 'Completed' WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }

    public function markExpired(int $id): bool
    {
        $stmt = $this->conn->prepare("UPDATE reservations SET status = 'Expired' WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }
}