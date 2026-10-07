<?php
require_once __DIR__ . '/../config/database.php';

class Report
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function all(?string $reportType = null): array
    {
        $sql = "SELECT r.*, a.first_name, a.last_name
                FROM reports r INNER JOIN admins a ON r.generated_by = a.id
                WHERE 1=1";
        $params = [];
        if ($reportType) {
            $sql .= " AND r.report_type = :report_type";
            $params['report_type'] = $reportType;
        }
        $sql .= " ORDER BY r.generated_at DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT r.*, a.first_name, a.last_name
             FROM reports r INNER JOIN admins a ON r.generated_by = a.id
             WHERE r.id = :id LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function create(array $data): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO reports (report_type, generated_by, generated_at, file_path)
             VALUES (:report_type, :generated_by, NOW(), :file_path)"
        );
        $stmt->execute([
            'report_type'  => $data['report_type'],
            'generated_by' => $data['generated_by'],
            'file_path'    => $data['file_path'],
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function delete(int $id): bool
    {
        $stmt = $this->conn->prepare("DELETE FROM reports WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }

    /* ======================= REPORT DATA ======================= */

    public function usageSummary(string $dateFrom, string $dateTo, ?string $course = null, ?string $year = null): array
    {
        $sql = "SELECT c.computer_number, st.student_id AS student_number,
                       st.first_name, st.last_name, st.course, st.year_level,
                       s.login_time, s.logout_time, s.duration_minutes
                FROM sessions s
                INNER JOIN students st ON s.student_id = st.id
                INNER JOIN computers c ON s.computer_id = c.id
                WHERE DATE(s.login_time) BETWEEN :date_from AND :date_to";

        $params = [
            'date_from' => $dateFrom,
            'date_to'   => $dateTo,
        ];

        if ($course) {
            $sql .= " AND st.course = :course";
            $params['course'] = $course;
        }
        if ($year) {
            $sql .= " AND st.year_level = :year_level";
            $params['year_level'] = $year;
        }

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        $totalSessions = count($rows);
        $totalMinutes = 0;
        $byStudent = [];

        foreach ($rows as $row) {
            $minutes = (int)($row['duration_minutes'] ?? 0);
            $totalMinutes += $minutes;

            $key = $row['student_number'];
            if (!isset($byStudent[$key])) {
                $byStudent[$key] = [
                    'student_number' => $row['student_number'],
                    'first_name'     => $row['first_name'],
                    'last_name'      => $row['last_name'],
                    'course'         => $row['course'],
                    'year'           => $row['year_level'],
                    'sessions'       => 0,
                    'total_minutes'  => 0,
                ];
            }
            $byStudent[$key]['sessions']++;
            $byStudent[$key]['total_minutes'] += $minutes;
        }

        return [
            'date_from'      => $dateFrom,
            'date_to'        => $dateTo,
            'total_sessions' => $totalSessions,
            'total_minutes'  => $totalMinutes,
            'total_hours'    => round($totalMinutes / 60, 2),
            'by_student'     => array_values($byStudent),
        ];
    }

    public function reservationSummary(string $dateFrom, string $dateTo, ?string $course = null, ?string $year = null): array
    {
        $sql = "SELECT r.status, COUNT(*) as count
                FROM reservations r
                INNER JOIN students st ON r.student_id = st.id
                WHERE DATE(r.reservation_date) BETWEEN :date_from AND :date_to";
        $params = [
            'date_from' => $dateFrom,
            'date_to'   => $dateTo,
        ];

        if ($course) {
            $sql .= " AND st.course = :course";
            $params['course'] = $course;
        }
        if ($year) {
            $sql .= " AND st.year_level = :year_level";
            $params['year_level'] = $year;
        }

        $sql .= " GROUP BY r.status";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        $summary = [
            'total'    => 0,
            'pending'  => 0,
            'approved' => 0,
            'rejected' => 0,
            'cancelled'=> 0,
            'completed'=> 0,
            'expired'  => 0,
        ];

        foreach ($rows as $row) {
            $status = strtolower($row['status']);
            if (isset($summary[$status])) {
                $summary[$status] = (int)$row['count'];
            }
            $summary['total'] += (int)$row['count'];
        }

        return $summary;
    }

    public function computerUsage(string $dateFrom, string $dateTo, ?string $course = null, ?string $year = null): array
    {
        $sql = "SELECT c.computer_number, c.computer_name,
                       COUNT(s.id) AS sessions,
                       COALESCE(SUM(s.duration_minutes), 0) AS total_minutes
                FROM sessions s
                INNER JOIN computers c ON s.computer_id = c.id
                INNER JOIN students st ON s.student_id = st.id
                WHERE DATE(s.login_time) BETWEEN :date_from AND :date_to";

        $params = [
            'date_from' => $dateFrom,
            'date_to'   => $dateTo,
        ];

        if ($course) {
            $sql .= " AND st.course = :course";
            $params['course'] = $course;
        }
        if ($year) {
            $sql .= " AND st.year_level = :year_level";
            $params['year_level'] = $year;
        }

        $sql .= " GROUP BY c.id, c.computer_number, c.computer_name
                  ORDER BY c.computer_number ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }
}