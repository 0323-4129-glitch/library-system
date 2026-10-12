<?php
require_once __DIR__ . '/../config/database.php';

class Student
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function getConnection(): PDO
    {
        return $this->conn;
    }

    public static function validYearLevels(): array
    {
        return ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'];
    }

    public function all(array $filters = []): array
    {
        $sql = "SELECT id, student_id, first_name, middle_name, last_name,
                       course, year_level, contact_number, email, photo_url,
                       remaining_hours, used_hours, last_login, last_logout,
                       total_sessions, status, must_change_password,
                       created_at, updated_at
                FROM students WHERE 1=1";
        $params = [];

        if (!empty($filters['status'])) {
            $sql .= " AND status = :status";
            $params['status'] = $filters['status'];
        }
        if (!empty($filters['course'])) {
            $sql .= " AND course = :course";
            $params['course'] = $filters['course'];
        }
        if (!empty($filters['year_level'])) {
            $sql .= " AND year_level = :year_level";
            $params['year_level'] = $filters['year_level'];
        }
        if (!empty($filters['search'])) {
            // Three distinct placeholders. With ATTR_EMULATE_PREPARES = false,
            // MySQL rejects the same named placeholder used more than once.
            $sql .= " AND (student_id LIKE :search1 OR first_name LIKE :search2 OR last_name LIKE :search3)";
            $like = '%' . $filters['search'] . '%';
            $params['search1'] = $like;
            $params['search2'] = $like;
            $params['search3'] = $like;
        }

        $sql .= " ORDER BY last_name ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM students WHERE id = :id LIMIT 1");
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function findByStudentId(string $studentId): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM students WHERE student_id = :student_id LIMIT 1");
        $stmt->execute(['student_id' => $studentId]);
        return $stmt->fetch();
    }

    public function findByFullName(string $fullName): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT * FROM students
             WHERE TRIM(CONCAT(first_name, ' ', IFNULL(CONCAT(middle_name, ' '), ''), last_name)) = :full_name
             LIMIT 1"
        );
        $stmt->execute(['full_name' => $fullName]);
        return $stmt->fetch();
    }

    public function findByEmail(string $email): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM students WHERE email = :email LIMIT 1");
        $stmt->execute(['email' => $email]);
        return $stmt->fetch();
    }

    public function create(array $data): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO students
             (student_id, first_name, middle_name, last_name, course, year_level,
              contact_number, email, photo_url, password, remaining_hours, used_hours, status, must_change_password)
             VALUES
             (:student_id, :first_name, :middle_name, :last_name, :course, :year_level,
              :contact_number, :email, :photo_url, :password, :remaining_hours, 0.00, :status, 1)"
        );
        $stmt->execute([
            'student_id'      => $data['student_id'],
            'first_name'      => $data['first_name'],
            'middle_name'     => $data['middle_name'] ?? null,
            'last_name'       => $data['last_name'],
            'course'          => $data['course'] ?? null,
            'year_level'      => $data['year_level'] ?? null,
            'contact_number'  => $data['contact_number'] ?? null,
            'email'           => $data['email'] ?? null,
            'photo_url'       => $data['photo_url'] ?? null,
            'password'        => $data['password'],
            'remaining_hours' => $data['remaining_hours'] ?? 10.00,
            'status'          => $data['status'] ?? 'Active',
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function update(int $id, array $data): bool
    {
        $allowed = [
            'student_id', 'first_name', 'middle_name', 'last_name',
            'course', 'year_level', 'contact_number', 'email', 'photo_url', 'status',
            'last_login', 'last_logout', 'total_sessions', 'used_hours', 'remaining_hours'
        ];
        $fields = array_intersect_key($data, array_flip($allowed));

        if (empty($fields)) {
            return false;
        }

        $setParts = [];
        foreach (array_keys($fields) as $column) {
            $setParts[] = "$column = :$column";
        }

        $stmt = $this->conn->prepare(
            "UPDATE students SET " . implode(', ', $setParts) . " WHERE id = :id"
        );

        return $stmt->execute($fields + ['id' => $id]);
    }

    public function updateRestrictedField(int $id, string $field, string $value): bool
    {
        $allowed = ['student_id', 'course', 'year_level'];
        if (!in_array($field, $allowed, true)) {
            return false;
        }

        $stmt = $this->conn->prepare("UPDATE students SET $field = :value WHERE id = :id");
        return $stmt->execute(['value' => $value, 'id' => $id]);
    }

    public function updateProfile(int $id, array $data): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE students SET contact_number = :contact_number, photo_url = COALESCE(:photo_url, photo_url) WHERE id = :id"
        );
        return $stmt->execute([
            'contact_number' => $data['contact_number'] ?? null,
            'photo_url'      => $data['photo_url'] ?? null,
            'id'             => $id,
        ]);
    }

    public function updatePassword(int $id, string $hashedPassword, bool $mustChangeAgain = false): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE students SET password = :password, must_change_password = :must_change WHERE id = :id"
        );
        return $stmt->execute([
            'password'    => $hashedPassword,
            'must_change' => $mustChangeAgain ? 1 : 0,
            'id'          => $id,
        ]);
    }

    public function setStatus(int $id, string $status): bool
    {
        $stmt = $this->conn->prepare("UPDATE students SET status = :status WHERE id = :id");
        return $stmt->execute(['status' => $status, 'id' => $id]);
    }

    public function delete(int $id): bool
    {
        $stmt = $this->conn->prepare("DELETE FROM students WHERE id = :id");
        return $stmt->execute(['id' => $id]);
    }

    public function deductHours(int $id, float $hours): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE students
             SET used_hours = used_hours + :hours,
                 remaining_hours = GREATEST(remaining_hours - :hours2, 0),
                 total_sessions = total_sessions + 1,
                 last_logout = NOW()
             WHERE id = :id"
        );
        return $stmt->execute(['hours' => $hours, 'hours2' => $hours, 'id' => $id]);
    }

    public function hasRemainingHours(int $id): bool
    {
        $stmt = $this->conn->prepare("SELECT remaining_hours FROM students WHERE id = :id LIMIT 1");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row && (float)$row['remaining_hours'] > 0;
    }

    /**
     * Full reset — used ONLY when a brand-new semester is created.
     * Wipes used_hours to 0 and sets remaining_hours = newLimit for everyone.
     */
    public function resetAllHours(float $newLimit): bool
    {
        $stmt = $this->conn->prepare("UPDATE students SET remaining_hours = :limit, used_hours = 0.00");
        return $stmt->execute(['limit' => $newLimit]);
    }

    /**
     * Apply a new semester hour limit WITHOUT wiping usage history.
     *
     * remaining_hours = max(newLimit - used_hours, 0)
     *
     * Used when the admin changes the limit MID-semester. The student's
     * already-used hours (used_hours) are preserved, so they don't get a
     * free reset. `resetAllHours()` is still used on CREATE (a brand-new
     * semester) where wiping usage IS correct.
     */
    public function applyNewLimit(float $newLimit): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE students
             SET remaining_hours = GREATEST(:limit - used_hours, 0)"
        );
        return $stmt->execute(['limit' => $newLimit]);
    }

    public function resetPasswordToStudentId(int $id, string $hashedNewStudentId): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE students SET password = :password, must_change_password = 1 WHERE id = :id"
        );
        return $stmt->execute(['password' => $hashedNewStudentId, 'id' => $id]);
    }

    public function emailExists(string $email, ?int $excludeId = null): bool
    {
        $sql = "SELECT id FROM students WHERE email = :email";
        $params = ['email' => $email];
        if ($excludeId !== null) {
            $sql .= " AND id != :id";
            $params['id'] = $excludeId;
        }
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount() > 0;
    }

    public function studentIdExists(string $studentId, ?int $excludeId = null): bool
    {
        $sql = "SELECT id FROM students WHERE student_id = :student_id";
        $params = ['student_id' => $studentId];
        if ($excludeId !== null) {
            $sql .= " AND id != :id";
            $params['id'] = $excludeId;
        }
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount() > 0;
    }
}