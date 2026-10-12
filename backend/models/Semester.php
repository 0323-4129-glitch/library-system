<?php
require_once __DIR__ . '/../config/database.php';

class Semester
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function all(): array
    {
        $stmt = $this->conn->prepare("SELECT * FROM semester_settings ORDER BY start_date DESC");
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM semester_settings WHERE id = :id LIMIT 1");
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function current(): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT * FROM semester_settings
             WHERE CURDATE() BETWEEN start_date AND end_date
             ORDER BY start_date DESC LIMIT 1"
        );
        $stmt->execute();
        return $stmt->fetch();
    }

    public function latest(): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM semester_settings ORDER BY id DESC LIMIT 1");
        $stmt->execute();
        return $stmt->fetch();
    }

    public function create(array $data, ?int $adminId = null): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO semester_settings
                (semester_name, start_date, end_date, student_hour_limit, created_by, updated_by)
             VALUES
                (:semester_name, :start_date, :end_date, :student_hour_limit, :created_by, :updated_by)"
        );
        $stmt->execute([
            'semester_name'       => $data['semester_name'],
            'start_date'          => $data['start_date'],
            'end_date'            => $data['end_date'],
            'student_hour_limit'  => $data['student_hour_limit'] ?? 10.00,
            'created_by'          => $adminId,
            'updated_by'          => $adminId,
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function update(int $id, array $data, ?int $adminId = null): bool
    {
        $existing = $this->findById($id);
        if (!$existing) return false;

        $stmt = $this->conn->prepare(
            "UPDATE semester_settings
             SET semester_name = :semester_name, start_date = :start_date,
                 end_date = :end_date, student_hour_limit = :student_hour_limit,
                 updated_by = :updated_by
             WHERE id = :id"
        );
        return $stmt->execute([
            'semester_name'      => $data['semester_name'] ?? $existing['semester_name'],
            'start_date'         => $data['start_date'] ?? $existing['start_date'],
            'end_date'           => $data['end_date'] ?? $existing['end_date'],
            'student_hour_limit' => $data['student_hour_limit'] ?? $existing['student_hour_limit'],
            'updated_by'         => $adminId,
            'id'                 => $id,
        ]);
    }

    public function delete(int $id): bool
    {
        $stmt = $this->conn->prepare("DELETE FROM semester_settings WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }
}