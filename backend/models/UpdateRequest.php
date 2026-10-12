<?php
require_once __DIR__ . '/../config/database.php';

/**
 * UpdateRequest Model
 * Table: update_requests
 * Student requests change to Student ID / Course / Year Level -> Admin reviews
 *
 * FIX: every SELECT that feeds a list view now aliases the student's full
 * name as `student_name`. The admin JS (student-management.js and
 * update-requests.js) reads row.student_name directly — previously it was
 * always undefined, so both admin views rendered blank names in the
 * Pending Update Requests list.
 *
 * The alias is built the same way DashboardController and Student use it:
 * TRIM(CONCAT(first_name, ' ', IFNULL(last_name, ''))) — safe against a
 * NULL last_name, which the students table permits.
 */
class UpdateRequest
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function create(array $data): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO update_requests (student_id, request_type, old_value, new_value, status)
             VALUES (:student_id, :request_type, :old_value, :new_value, 'Pending')"
        );
        $stmt->execute([
            'student_id'   => $data['student_id'],
            'request_type' => $data['request_type'],
            'old_value'    => $data['old_value'],
            'new_value'    => $data['new_value'],
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT ur.*,
                    s.student_id AS student_number,
                    s.first_name, s.last_name,
                    s.photo_url,
                    TRIM(CONCAT(s.first_name, ' ', IFNULL(s.last_name, ''))) AS student_name
             FROM update_requests ur
             INNER JOIN students s ON ur.student_id = s.id
             WHERE ur.id = :id LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function pending(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT ur.*,
                    s.student_id AS student_number,
                    s.first_name, s.last_name,
                    s.photo_url,
                    TRIM(CONCAT(s.first_name, ' ', IFNULL(s.last_name, ''))) AS student_name
             FROM update_requests ur
             INNER JOIN students s ON ur.student_id = s.id
             WHERE ur.status = 'Pending'
             ORDER BY ur.created_at ASC"
        );
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function all(?string $status = null): array
    {
        $sql = "SELECT ur.*,
                       s.student_id AS student_number,
                       s.first_name, s.last_name,
                       s.photo_url,
                       TRIM(CONCAT(s.first_name, ' ', IFNULL(s.last_name, ''))) AS student_name
                FROM update_requests ur
                INNER JOIN students s ON ur.student_id = s.id
                WHERE 1=1";
        $params = [];
        if ($status !== null) {
            $sql .= " AND ur.status = :status";
            $params['status'] = $status;
        }
        $sql .= " ORDER BY ur.created_at DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function byStudent(int $studentId): array
    {
        $stmt = $this->conn->prepare(
            "SELECT ur.*,
                    s.student_id AS student_number,
                    s.first_name, s.last_name,
                    s.photo_url,
                    TRIM(CONCAT(s.first_name, ' ', IFNULL(s.last_name, ''))) AS student_name
             FROM update_requests ur
             INNER JOIN students s ON ur.student_id = s.id
             WHERE ur.student_id = :student_id
             ORDER BY ur.created_at DESC"
        );
        $stmt->execute(['student_id' => $studentId]);
        return $stmt->fetchAll();
    }

    /** Prevent duplicate pending requests of the same type */
    public function hasPending(int $studentId, string $requestType): bool
    {
        $stmt = $this->conn->prepare(
            "SELECT id FROM update_requests
             WHERE student_id = :student_id AND request_type = :request_type AND status = 'Pending'"
        );
        $stmt->execute(['student_id' => $studentId, 'request_type' => $requestType]);
        return $stmt->rowCount() > 0;
    }

    public function approve(int $id, int $reviewedBy): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE update_requests SET status = 'Approved', reviewed_by = :by, reviewed_at = NOW() WHERE id = :id"
        );
        return $stmt->execute(['by' => $reviewedBy, 'id' => $id]);
    }

    public function reject(int $id, int $reviewedBy): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE update_requests SET status = 'Rejected', reviewed_by = :by, reviewed_at = NOW() WHERE id = :id"
        );
        return $stmt->execute(['by' => $reviewedBy, 'id' => $id]);
    }
}