<?php
require_once __DIR__ . '/../models/Computer.php';
require_once __DIR__ . '/../models/Reservation.php';
require_once __DIR__ . '/../models/SessionModel.php';
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/ActivityLog.php';

class DashboardController
{
    public function adminDashboard(): void
    {
        // Opportunistic no-show sweep — keeps the Pending Reservations widget
        // and computer statuses honest without needing a cron job.
        (new Reservation())->expireNoShows();

        $db = Database::getConnection();

        $totalStudents   = (int)$db->query("SELECT COUNT(*) c FROM students")->fetch()['c'];
        $activeStudents  = (int)$db->query("SELECT COUNT(*) c FROM students WHERE status='Active'")->fetch()['c'];
        $totalAdmins     = (int)$db->query("SELECT COUNT(*) c FROM admins")->fetch()['c'];
        $activeAdmins    = (int)$db->query("SELECT COUNT(*) c FROM admins WHERE status='Active'")->fetch()['c'];

        $totalComputers           = (int)$db->query("SELECT COUNT(*) c FROM computers")->fetch()['c'];
        $availableComputers       = (int)$db->query("SELECT COUNT(*) c FROM computers WHERE status='Available'")->fetch()['c'];
        $occupiedComputers        = (int)$db->query("SELECT COUNT(*) c FROM computers WHERE status='Occupied'")->fetch()['c'];
        $pendingReservationsCount = (int)$db->query("SELECT COUNT(*) c FROM reservations WHERE status='Pending'")->fetch()['c'];
        $activeSessionsCount      = (int)$db->query("SELECT COUNT(*) c FROM sessions WHERE status='Active'")->fetch()['c'];
        $pendingUpdateRequests    = (int)$db->query("SELECT COUNT(*) c FROM update_requests WHERE status='Pending'")->fetch()['c'];
        $totalUpdateRequests      = (int)$db->query("SELECT COUNT(*) c FROM update_requests")->fetch()['c'];
        $approvedUpdateRequests   = (int)$db->query("SELECT COUNT(*) c FROM update_requests WHERE status='Approved'")->fetch()['c'];
        $rejectedUpdateRequests   = (int)$db->query("SELECT COUNT(*) c FROM update_requests WHERE status='Rejected'")->fetch()['c'];

        $computersStmt = $db->query(
            "SELECT c.id,
                    c.computer_number,
                    c.computer_name,
                    c.status,
                    s.id AS session_id,
                    s.login_time,
                    s.session_type,
                    st.id AS student_id,
                    st.student_id AS student_number,
                    st.first_name,
                    st.last_name,
                    TRIM(CONCAT(st.first_name, ' ', st.last_name)) AS `current_user`
             FROM computers c
             LEFT JOIN sessions s ON s.computer_id = c.id AND s.status = 'Active'
             LEFT JOIN students st ON s.student_id = st.id
             ORDER BY c.computer_number ASC"
        );
        $computers = $computersStmt->fetchAll();

        $liveMonitoring = [];
        foreach ($computers as $row) {
            if (empty($row['session_id'])) continue;
            $liveMonitoring[] = [
                'session_id'      => (int)$row['session_id'],
                'login_time'      => $row['login_time'],
                'session_type'    => $row['session_type'],
                'student_id'      => (int)$row['student_id'],
                'student_number'  => $row['student_number'],
                'first_name'      => $row['first_name'],
                'last_name'       => $row['last_name'],
                'computer_id'     => (int)$row['id'],
                'computer_number' => $row['computer_number'],
                'computer_name'   => $row['computer_name'],
                'status'          => $row['status'],
            ];
        }

        $activeSessionsStmt = $db->query(
            "SELECT TRIM(CONCAT(st.first_name, ' ', st.last_name)) AS student_name,
                    c.computer_number, s.login_time AS start_time,
                    TIMESTAMPDIFF(MINUTE, s.login_time, NOW()) AS duration
             FROM sessions s
             INNER JOIN students st ON s.student_id = st.id
             INNER JOIN computers c ON s.computer_id = c.id
             WHERE s.status = 'Active'
             ORDER BY s.login_time ASC"
        );
        $activeSessions = $activeSessionsStmt->fetchAll();

        $pendingReservationsStmt = $db->query(
            "SELECT r.id, TRIM(CONCAT(st.first_name, ' ', st.last_name)) AS student_name,
                    c.computer_number, r.start_time, r.end_time
             FROM reservations r
             INNER JOIN students st ON r.student_id = st.id
             INNER JOIN computers c ON r.computer_id = c.id
             WHERE r.status = 'Pending'
             ORDER BY r.reservation_date ASC, r.start_time ASC
             LIMIT 10"
        );
        $pendingReservations = $pendingReservationsStmt->fetchAll();

        $recentActivity = array_map(function (array $row) {
            $action = strtolower($row['action'] ?? '');
            $type = 'update';
            foreach (['login', 'logout', 'approve', 'reject', 'delete', 'create'] as $keyword) {
                if (str_contains($action, $keyword)) {
                    $type = $keyword === 'approve' ? 'approve' : ($keyword === 'reject' ? 'reject' : $keyword);
                    break;
                }
            }
            return [
                'type'       => $type,
                'message'    => $row['description'] ? "{$row['action']} — {$row['description']}" : $row['action'],
                'created_at' => $row['created_at'],
            ];
        }, (new ActivityLog())->recent(10));

        json_success([
            'total_students'          => $totalStudents,
            'total_computers'         => $totalComputers,
            'available_computers'     => $availableComputers,
            'occupied_computers'      => $occupiedComputers,
            'pending_reservations'    => $pendingReservationsCount,
            'active_sessions'         => $activeSessionsCount,
            'pending_update_requests' => $pendingUpdateRequests,
            'live_monitoring'         => $liveMonitoring,

            'counts' => [
                'totalStudents'          => $totalStudents,
                'totalStaff'             => $totalAdmins,
                'totalComputers'         => $totalComputers,
                'availableComputers'     => $availableComputers,
                'pendingReservations'    => $pendingReservationsCount,
                'activeSessions'         => $activeSessionsCount,
                'pendingUpdateRequests'  => $pendingUpdateRequests,
            ],
            'stats' => [
                'totalStudents'          => $totalStudents,
                'activeStudents'         => $activeStudents,
                'totalStaff'             => $totalAdmins,
                'activeStaff'            => $activeAdmins,
                'totalHeadAdmins'        => $totalAdmins,
                'totalStaffAdmins'       => 0,
                'totalComputers'         => $totalComputers,
                'availableComputers'     => $availableComputers,
                'activeSessions'         => $activeSessionsCount,
                'totalUpdateRequests'    => $totalUpdateRequests,
                'pendingUpdateRequests'  => $pendingUpdateRequests,
                'approvedUpdateRequests' => $approvedUpdateRequests,
                'rejectedUpdateRequests' => $rejectedUpdateRequests,
            ],
            'computers'           => $computers,
            'activeSessions'      => $activeSessions,
            'pendingReservations' => $pendingReservations,
            'recentActivity'      => $recentActivity,
        ]);
    }

    public function studentDashboard(int $studentId): void
    {
        // FIX: sweep no-shows so a student's dashboard never shows a stale
        // Approved reservation or a computer that should have been freed.
        (new Reservation())->expireNoShows();

        $student = (new Student())->findById($studentId);
        if (!$student) json_error('Student not found', 404);
        unset($student['password']);

        $reservations = (new Reservation())->byStudent($studentId);
        $currentReservation = null;
        foreach ($reservations as $r) {
            if ($r['status'] === 'Approved') { $currentReservation = $r; break; }
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM sessions WHERE student_id = :sid AND status='Active' LIMIT 1");
        $stmt->execute(['sid' => $studentId]);
        $activeSession = $stmt->fetch() ?: null;

        json_success([
            'student'             => $student,
            'remaining_hours'     => (float)$student['remaining_hours'],
            'current_reservation' => $currentReservation,
            'current_session'     => $activeSession,
            'reservation_history' => $reservations,
        ]);
    }
}