<?php
require_once __DIR__ . '/../config/database.php';

/**
 * Admin Model
 * Table: admins (single role: 'admin')
 */
class Admin
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function all(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT id, employee_id, first_name, middle_name, last_name, email, role, status, created_at
             FROM admins ORDER BY last_name ASC"
        );
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM admins WHERE id = :id LIMIT 1");
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function findByEmail(string $email): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM admins WHERE email = :email LIMIT 1");
        $stmt->execute(['email' => $email]);
        return $stmt->fetch();
    }

    public function findByEmployeeId(string $employeeId): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM admins WHERE employee_id = :employee_id LIMIT 1");
        $stmt->execute(['employee_id' => $employeeId]);
        return $stmt->fetch();
    }

    public function create(array $data): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO admins (employee_id, first_name, middle_name, last_name, email, password, role, status)
             VALUES (:employee_id, :first_name, :middle_name, :last_name, :email, :password, :role, :status)"
        );
        $stmt->execute([
            'employee_id' => $data['employee_id'] ?? null,
            'first_name'  => $data['first_name'],
            'middle_name' => $data['middle_name'] ?? null,
            'last_name'   => $data['last_name'],
            'email'       => $data['email'],
            'password'    => $data['password'],
            'role'        => 'admin',
            'status'      => $data['status'] ?? 'Active',
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function update(int $id, array $data): bool
    {
        $allowed = ['employee_id', 'first_name', 'middle_name', 'last_name', 'email', 'status', 'photo_url'];
        $fields = array_intersect_key($data, array_flip($allowed));

        if (empty($fields)) {
            return false;
        }

        $setParts = [];
        foreach (array_keys($fields) as $column) {
            $setParts[] = "$column = :$column";
        }

        $stmt = $this->conn->prepare(
            "UPDATE admins SET " . implode(', ', $setParts) . " WHERE id = :id"
        );

        return $stmt->execute($fields + ['id' => $id]);
    }

    public function updatePassword(int $id, string $hashedPassword): bool
    {
        $stmt = $this->conn->prepare("UPDATE admins SET password = :password WHERE id = :id");
        return $stmt->execute(['password' => $hashedPassword, 'id' => $id]);
    }

    public function setStatus(int $id, string $status): bool
    {
        $stmt = $this->conn->prepare("UPDATE admins SET status = :status WHERE id = :id");
        return $stmt->execute(['status' => $status, 'id' => $id]);
    }

    public function delete(int $id): bool
    {
        try {
            $stmt = $this->conn->prepare("DELETE FROM admins WHERE id = :id");
            return $stmt->execute(['id' => $id]);
        } catch (PDOException $e) {
            return false;
        }
    }

    public function emailExists(string $email, ?int $excludeId = null): bool
    {
        $sql = "SELECT id FROM admins WHERE email = :email";
        $params = ['email' => $email];
        if ($excludeId !== null) {
            $sql .= " AND id != :id";
            $params['id'] = $excludeId;
        }
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount() > 0;
    }
}