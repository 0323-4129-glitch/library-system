<?php
require_once __DIR__ . '/../config/database.php';

/**
 * PasswordReset Model
 * Table: password_resets — Forgot Password flow for Admins and Students
 *
 * CHANGES IN THIS REVISION
 *  - create() now invalidates any previously-issued, still-valid tokens
 *    for the same user before inserting the new one. Previously
 *    invalidateAllForUser() existed but was never called, so a user
 *    who hit "forgot password" twice had two live reset tokens and
 *    both remained valid for the full 30-minute window.
 */

class PasswordReset
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function create(string $userType, int $userId, int $expiresInMinutes = 30): array
    {
        // Kill any outstanding tokens first.
        $this->invalidateAllForUser($userType, $userId);

        $token = bin2hex(random_bytes(32));
        $expiresAt = date('Y-m-d H:i:s', strtotime("+{$expiresInMinutes} minutes"));

        $stmt = $this->conn->prepare(
            "INSERT INTO password_resets (admin_id, student_id, token, expires_at)
             VALUES (:admin_id, :student_id, :token, :expires_at)"
        );
        $stmt->execute([
            'admin_id'   => $userType === 'Admin' ? $userId : null,
            'student_id' => $userType === 'Student' ? $userId : null,
            'token'      => $token,
            'expires_at' => $expiresAt,
        ]);

        return ['id' => (int)$this->conn->lastInsertId(), 'token' => $token, 'expires_at' => $expiresAt];
    }

    public function findValidToken(string $token): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT *, {$this->userShape()}
             FROM password_resets
             WHERE token = :token AND expires_at > NOW()
             ORDER BY id DESC LIMIT 1"
        );
        $stmt->execute(['token' => $token]);
        return $stmt->fetch();
    }

    public function invalidate(int $id): bool
    {
        $stmt = $this->conn->prepare("UPDATE password_resets SET expires_at = NOW() WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }

    public function invalidateAllForUser(string $userType, int $userId): bool
    {
        $column = $this->columnFor($userType);
        $stmt = $this->conn->prepare(
            "UPDATE password_resets SET expires_at = NOW()
             WHERE $column = :user_id AND expires_at > NOW()"
        );
        return $stmt->execute(['user_id' => $userId]);
    }

    public function purgeExpired(): bool
    {
        $stmt = $this->conn->prepare("DELETE FROM password_resets WHERE expires_at <= NOW()");
        return $stmt->execute();
    }

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