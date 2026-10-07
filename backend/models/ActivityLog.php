<?php
require_once __DIR__ . '/../config/database.php';

class ActivityLog
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function create(array $data): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO activity_logs (admin_id, action, description, created_at)
             VALUES (:admin_id, :action, :description, NOW())"
        );
        $stmt->execute([
            'admin_id'    => $data['admin_id'] ?? null,
            'action'      => $data['action'],
            'description' => $data['description'] ?? '',
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function log(int $adminId, string $action, string $description = ''): int
    {
        return $this->create([
            'admin_id'    => $adminId,
            'action'      => $action,
            'description' => $description
        ]);
    }

    public function logStudentLogin(string $studentName, string $computer): int
    {
        return $this->create([
            'admin_id'    => null,
            'action'      => 'Student Login',
            'description' => "$studentName logged in on $computer"
        ]);
    }

    public function logStudentLogout(string $studentName, string $computer): int
    {
        return $this->create([
            'admin_id'    => null,
            'action'      => 'Student Logout',
            'description' => "$studentName logged out from $computer"
        ]);
    }

    public function recent(int $limit = 10): array
    {
        $stmt = $this->conn->prepare(
            "SELECT * FROM activity_logs
             WHERE DATE(created_at) = CURDATE()
             ORDER BY created_at DESC
             LIMIT :limit"
        );
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}