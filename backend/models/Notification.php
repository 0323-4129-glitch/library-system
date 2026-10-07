<?php
require_once __DIR__ . '/../config/database.php';

/**
 * Notification Model
 * Table: notifications
 */
class Notification
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function create(array $data): int
    {
        $userType = $data['user_type'];
        $userId = (int)$data['user_id'];

        $stmt = $this->conn->prepare(
            "INSERT INTO notifications (admin_id, student_id, title, message, type, is_read)
             VALUES (:admin_id, :student_id, :title, :message, :type, 0)"
        );
        $stmt->execute([
            'admin_id'   => $userType === 'Admin' ? $userId : null,
            'student_id' => $userType === 'Student' ? $userId : null,
            'title'      => $data['title'],
            'message'    => $data['message'],
            'type'       => $data['type'] ?? 'info',
        ]);
        return (int)$this->conn->lastInsertId();
    }

    /** Convenience one-liner for controllers to fire a notification */
    public function send(string $userType, int $userId, string $title, string $message, string $type = 'info'): int
    {
        return $this->create([
            'user_type' => $userType,
            'user_id'   => $userId,
            'title'     => $title,
            'message'   => $message,
            'type'      => $type,
        ]);
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT *, {$this->userShape()} FROM notifications WHERE id = :id LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function byUser(string $userType, int $userId): array
    {
        $column = $this->columnFor($userType);
        $stmt = $this->conn->prepare(
            "SELECT *, {$this->userShape()}
             FROM notifications
             WHERE $column = :user_id
             ORDER BY created_at DESC"
        );
        $stmt->execute(['user_id' => $userId]);
        return $stmt->fetchAll();
    }

    /**
     * Alias of byUser().
     */
    public function forUser(string $userType, int $userId): array
    {
        return $this->byUser($userType, $userId);
    }

    public function unreadCount(string $userType, int $userId): int
    {
        $column = $this->columnFor($userType);
        $stmt = $this->conn->prepare(
            "SELECT COUNT(*) AS cnt FROM notifications
             WHERE $column = :user_id AND is_read = 0"
        );
        $stmt->execute(['user_id' => $userId]);
        return (int)($stmt->fetch()['cnt'] ?? 0);
    }

    public function markRead(int $id): bool
    {
        $stmt = $this->conn->prepare("UPDATE notifications SET is_read = 1 WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }

    public function markAllRead(string $userType, int $userId): bool
    {
        $column = $this->columnFor($userType);
        $stmt = $this->conn->prepare(
            "UPDATE notifications SET is_read = 1 WHERE $column = :user_id"
        );
        return $stmt->execute(['user_id' => $userId]);
    }

    public function delete(int $id): bool
    {
        $stmt = $this->conn->prepare("DELETE FROM notifications WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }

    /** Reconstructs the old user_type/user_id shape from admin_id/student_id */
    private function userShape(): string
    {
        return "CASE WHEN admin_id IS NOT NULL THEN 'Admin' ELSE 'Student' END AS user_type,
                COALESCE(admin_id, student_id) AS user_id,
                type";
    }

    /** 'Admin'/'Student' -> the matching column name. */
    private function columnFor(string $userType): string
    {
        return $userType === 'Admin' ? 'admin_id' : 'student_id';
    }
}