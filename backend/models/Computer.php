<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/config.php';

class Computer
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    /* ============================================================
     * Base SELECT used by all() / findById() / available() /
     * findByNumber(). LEFT JOINs the currently-active session on
     * this computer (if any), the student who owns that session,
     * and — for reservation-based sessions — the reservation row
     * so we can surface its end_time. Walk-in sessions have no
     * end_time, which is exactly the signal the frontend uses to
     * disable the Reserve button.
     *
     * Aliases are prefixed with an underscore so shapeComputerRow()
     * can strip them cleanly.
     * ============================================================ */
    private const SELECT_SHAPE = "c.*,
            s.id            AS _active_session_id,
            COALESCE(s.session_type, 'Walk-in') AS _active_session_type,
            s.login_time    AS _active_session_login,
            s.student_id    AS _active_student_id,
            st.student_id   AS _active_student_number,
            st.first_name   AS _active_student_first,
            st.last_name    AS _active_student_last,
            r.end_time      AS _active_reservation_end
        FROM computers c
        LEFT JOIN sessions s
               ON s.computer_id = c.id
              AND s.status = 'Active'
        LEFT JOIN students st
               ON s.student_id = st.id
        LEFT JOIN reservations r
               ON s.reservation_id = r.id";

    public function all(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT " . self::SELECT_SHAPE . " ORDER BY c.computer_number ASC"
        );
        $stmt->execute();
        return array_map([$this, 'shapeComputerRow'], $stmt->fetchAll());
    }

    public function available(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT " . self::SELECT_SHAPE . " WHERE c.status = 'Available' ORDER BY c.computer_number ASC"
        );
        $stmt->execute();
        return array_map([$this, 'shapeComputerRow'], $stmt->fetchAll());
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT " . self::SELECT_SHAPE . " WHERE c.id = :id LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ? $this->shapeComputerRow($row) : false;
    }

    public function findByNumber(string $computerNumber): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT " . self::SELECT_SHAPE . " WHERE c.computer_number = :num LIMIT 1"
        );
        $stmt->execute(['num' => $computerNumber]);
        $row = $stmt->fetch();
        return $row ? $this->shapeComputerRow($row) : false;
    }

    /**
     * Converts the flat JOIN row into the API shape the frontend
     * expects:
     *   - current_user    : "First Last" or null
     *   - current_session : { id, type, login_time, end_time,
     *                         student_id, student_number } or null
     *
     * `type` is "Walk-in" or "Reservation". `end_time` is null for
     * walk-in sessions (which have no scheduled end) and "HH:MM:SS"
     * for reservation-based ones.
     */
    private function shapeComputerRow(array $row): array
    {
        $currentUser = null;
        if (!empty($row['_active_student_id'])) {
            $name = trim(
                ($row['_active_student_first'] ?? '') . ' ' .
                ($row['_active_student_last'] ?? '')
            );
            $currentUser = $name !== '' ? $name : null;
        }

        $currentSession = null;
        if (!empty($row['_active_session_id'])) {
            $rawType = $row['_active_session_type'] ?? 'Walk-in';
            $currentSession = [
                'id'             => (int)$row['_active_session_id'],
                'type'           => $rawType ?: 'Walk-in',
                'login_time'     => $row['_active_session_login'] ?? null,
                'end_time'       => $row['_active_reservation_end'] ?? null,
                'student_id'     => (int)($row['_active_student_id'] ?? 0),
                'student_number' => $row['_active_student_number'] ?? null,
            ];
        }

        // Strip the private aliases so they never leak to the API.
        unset(
            $row['_active_session_id'],
            $row['_active_session_type'],
            $row['_active_session_login'],
            $row['_active_student_id'],
            $row['_active_student_number'],
            $row['_active_student_first'],
            $row['_active_student_last'],
            $row['_active_reservation_end']
        );

        $row['current_user']    = $currentUser;
        $row['current_session'] = $currentSession;

        return $row;
    }

    public function create(array $data): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO computers (computer_number, computer_name, status)
             VALUES (:computer_number, :computer_name, :status)"
        );
        $stmt->execute([
            'computer_number' => $data['computer_number'],
            'computer_name'   => $data['computer_name'] ?? null,
            'status'          => $data['status'] ?? COMPUTER_AVAILABLE,
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function update(int $id, array $data): bool
    {
        $existing = $this->findById($id);
        if (!$existing) {
            return false;
        }

        $stmt = $this->conn->prepare(
            "UPDATE computers
             SET computer_number = :computer_number,
                 computer_name = :computer_name
             WHERE id = :id"
        );
        return $stmt->execute([
            'computer_number' => $data['computer_number'] ?? $existing['computer_number'],
            'computer_name'   => array_key_exists('computer_name', $data) ? $data['computer_name'] : $existing['computer_name'],
            'id'              => $id,
        ]);
    }

    public function setStatus(int $id, string $status): bool
    {
        $stmt = $this->conn->prepare("UPDATE computers SET status = :status WHERE id = :id");
        return $stmt->execute(['status' => $status, 'id' => $id]);
    }

    /**
     * Recompute a computer's status from ground truth.
     *   1. Active session                                    -> Occupied
     *   2. Approved reservation starting within HOLD window  -> Reserved
     *   3. Otherwise                                         -> Available
     *
     * Maintenance is sticky — if the computer is currently Maintenance,
     * status is left alone.
     *
     * This is the single source of truth for computer availability.
     * Every transition (session start/end, reservation approve/cancel,
     * kiosk logout, maintenance clear) goes through this so the status
     * column can never disagree with reality.
     */
    public function recomputeStatus(int $id): string
    {
        $computer = $this->findById($id);
        if (!$computer) {
            return '';
        }

        if ($computer['status'] === COMPUTER_MAINTENANCE) {
            return COMPUTER_MAINTENANCE;
        }

        // 1. Active session wins.
        $stmt = $this->conn->prepare(
            "SELECT id FROM sessions WHERE computer_id = :id AND status = 'Active' LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        if ($stmt->fetch()) {
            if ($computer['status'] !== COMPUTER_OCCUPIED) {
                $this->setStatus($id, COMPUTER_OCCUPIED);
            }
            return COMPUTER_OCCUPIED;
        }

        // 2. Reservation currently in progress, or starting within hold window.
        //    Interval is inlined as an int because MySQL rejects placeholders
        //    inside SEC_TO_TIME under ATTR_EMULATE_PREPARES = false.
        $holdSeconds = max(60, ((int)RESERVATION_HOLD_MINUTES) * 60);
        $stmt = $this->conn->prepare(
            "SELECT id FROM reservations
             WHERE computer_id = :id
               AND status = 'Approved'
               AND reservation_date = CURDATE()
               AND end_time >= CURTIME()
               AND start_time <= ADDTIME(CURTIME(), SEC_TO_TIME({$holdSeconds}))
             ORDER BY start_time ASC
             LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        if ($stmt->fetch()) {
            if ($computer['status'] !== COMPUTER_RESERVED) {
                $this->setStatus($id, COMPUTER_RESERVED);
            }
            return COMPUTER_RESERVED;
        }

        // 3. Nothing pending — Available.
        if ($computer['status'] !== COMPUTER_AVAILABLE) {
            $this->setStatus($id, COMPUTER_AVAILABLE);
        }
        return COMPUTER_AVAILABLE;
    }

    public function delete(int $id): bool
    {
        // Block delete if an active session exists.
        $check = $this->conn->prepare(
            "SELECT id FROM sessions WHERE computer_id = :id AND status = 'Active' LIMIT 1"
        );
        $check->execute(['id' => $id]);
        if ($check->fetch()) {
            return false;
        }

        try {
            $stmt = $this->conn->prepare("DELETE FROM computers WHERE id = :id");
            return $stmt->execute(['id' => $id]);
        } catch (PDOException $e) {
            // FK violation — historical sessions/reservations still reference it.
            return false;
        }
    }

    public function liveMonitoring(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT s.id AS session_id, s.login_time, s.session_type,
                    st.id AS student_id, st.student_id AS student_number, st.first_name, st.last_name,
                    st.remaining_hours,
                    c.id AS computer_id, c.computer_number, c.computer_name, c.status
             FROM sessions s
             INNER JOIN students st ON s.student_id = st.id
             INNER JOIN computers c ON s.computer_id = c.id
             WHERE s.status = 'Active'
             ORDER BY c.computer_number ASC"
        );
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function history(int $id): array
    {
        $stmt = $this->conn->prepare(
            "SELECT s.id AS session_id, s.login_time, s.logout_time, s.duration_minutes,
                    s.session_type, s.status,
                    st.student_id AS student_number,
                    st.first_name, st.middle_name, st.last_name,
                    st.course, st.year_level
             FROM sessions s
             INNER JOIN students st ON s.student_id = st.id
             WHERE s.computer_id = :id
             ORDER BY s.login_time DESC"
        );
        $stmt->execute(['id' => $id]);
        return $stmt->fetchAll();
    }
}