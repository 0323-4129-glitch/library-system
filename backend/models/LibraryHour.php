<?php
require_once __DIR__ . '/../config/database.php';

/**
 * LibraryHour Model
 * Table: library_hours
 */
class LibraryHour
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function all(): array
    {
        $stmt = $this->conn->prepare(
            "SELECT * FROM library_hours
             ORDER BY FIELD(day, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')"
        );
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function findByDay(string $day): array|false
    {
        $stmt = $this->conn->prepare("SELECT * FROM library_hours WHERE day = :day LIMIT 1");
        $stmt->execute(['day' => $day]);
        return $stmt->fetch();
    }

    /**
     * FIX: added $adminId — library_hours now has an updated_by FK
     * (see migration add_settings_audit_columns.sql) tracking which
     * admin configured each day's hours.
     */
    public function create(array $data, ?int $adminId = null): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO library_hours (day, opening_time, closing_time, is_open, updated_by)
             VALUES (:day, :opening_time, :closing_time, :is_open, :updated_by)"
        );
        $stmt->execute([
            'day'          => $data['day'],
            'opening_time' => $data['opening_time'] ?? null,
            'closing_time' => $data['closing_time'] ?? null,
            'is_open'      => !empty($data['is_open']) ? 1 : 0,
            'updated_by'   => $adminId,
        ]);
        return (int)$this->conn->lastInsertId();
    }

    public function update(string $day, array $data, ?int $adminId = null): bool
    {
        $stmt = $this->conn->prepare(
            "UPDATE library_hours
             SET opening_time = :opening_time, closing_time = :closing_time,
                 is_open = :is_open, updated_by = :updated_by
             WHERE day = :day"
        );
        return $stmt->execute([
            'opening_time' => $data['opening_time'] ?? null,
            'closing_time' => $data['closing_time'] ?? null,
            'is_open'      => !empty($data['is_open']) ? 1 : 0,
            'updated_by'   => $adminId,
            'day'          => $day,
        ]);
    }

    /** Insert the day if it doesn't exist yet, otherwise update it */
    public function upsert(array $data, ?int $adminId = null): bool
    {
        if ($this->findByDay($data['day'])) {
            return $this->update($data['day'], $data, $adminId);
        }
        return (bool)$this->create($data, $adminId);
    }

    /** Used by the Electron Client to check whether the library is open right now */
    public function isCurrentlyOpen(string $day, string $currentTime): bool
    {
        $row = $this->findByDay($day);
        if (!$row || !$row['is_open']) {
            return false;
        }
        return $currentTime >= $row['opening_time'] && $currentTime <= $row['closing_time'];
    }
}