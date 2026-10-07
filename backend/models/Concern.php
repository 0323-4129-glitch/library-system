<?php
require_once __DIR__ . '/../config/database.php';

class Concern
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function create(int $studentId, string $subject, string $message): int
    {
        $this->conn->beginTransaction();
        try {
            $stmt = $this->conn->prepare(
                "INSERT INTO concerns (student_id, subject, status, created_at, updated_at, last_message_at)
                 VALUES (:sid, :subject, 'Open', NOW(), NOW(), NOW())"
            );
            $stmt->execute(['sid' => $studentId, 'subject' => $subject]);
            $concernId = (int)$this->conn->lastInsertId();

            $stmt2 = $this->conn->prepare(
                "INSERT INTO concern_messages (concern_id, sender_type, sender_id, message, created_at)
                 VALUES (:cid, 'Student', :sid, :msg, NOW())"
            );
            $stmt2->execute(['cid' => $concernId, 'sid' => $studentId, 'msg' => $message]);

            $this->conn->commit();
            return $concernId;
        } catch (Exception $e) {
            $this->conn->rollBack();
            throw $e;
        }
    }

    public function all(?string $status = null): array
    {
        $sql = "SELECT c.*, s.student_id AS student_number,
                       s.first_name, s.middle_name, s.last_name,
                       s.photo_url
                FROM concerns c
                INNER JOIN students s ON c.student_id = s.id
                WHERE 1=1";
        $params = [];
        if ($status) {
            $sql .= " AND c.status = :status";
            $params['status'] = $status;
        }
        $sql .= " ORDER BY
                    CASE c.status WHEN 'Open' THEN 0 WHEN 'Replied' THEN 1 ELSE 2 END,
                    c.last_message_at DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function byStudent(int $studentId): array
    {
        $stmt = $this->conn->prepare(
            "SELECT c.*, s.student_id AS student_number,
                    s.first_name, s.middle_name, s.last_name,
                    s.photo_url
             FROM concerns c
             INNER JOIN students s ON c.student_id = s.id
             WHERE c.student_id = :sid
             ORDER BY c.last_message_at DESC"
        );
        $stmt->execute(['sid' => $studentId]);
        return $stmt->fetchAll();
    }

    public function findById(int $id): array|false
    {
        $stmt = $this->conn->prepare(
            "SELECT c.*, s.student_id AS student_number, s.first_name, s.middle_name, s.last_name,
                    s.email, s.course, s.year_level, s.photo_url
             FROM concerns c
             INNER JOIN students s ON c.student_id = s.id
             WHERE c.id = :id LIMIT 1"
        );
        $stmt->execute(['id' => $id]);
        return $stmt->fetch();
    }

    public function messages(int $concernId): array
    {
        $stmt = $this->conn->prepare(
            "SELECT cm.*,
                    CASE
                        WHEN cm.sender_type = 'Student'
                            THEN CONCAT(s.first_name, ' ', s.last_name)
                        ELSE
                            CONCAT(a.first_name, ' ', a.last_name)
                    END AS sender_name
             FROM concern_messages cm
             LEFT JOIN students s ON cm.sender_type = 'Student' AND cm.sender_id = s.id
             LEFT JOIN admins   a ON cm.sender_type = 'Admin'   AND cm.sender_id = a.id
             WHERE cm.concern_id = :cid
             ORDER BY cm.created_at ASC, cm.id ASC"
        );
        $stmt->execute(['cid' => $concernId]);
        return $stmt->fetchAll();
    }

    public function addMessage(int $concernId, string $senderType, int $senderId, string $message): int
    {
        $stmt = $this->conn->prepare(
            "INSERT INTO concern_messages (concern_id, sender_type, sender_id, message, created_at)
             VALUES (:cid, :stype, :sid, :msg, NOW())"
        );
        $stmt->execute([
            'cid'   => $concernId,
            'stype' => $senderType,
            'sid'   => $senderId,
            'msg'   => $message,
        ]);
        $messageId = (int)$this->conn->lastInsertId();

        // Student speaks → needs admin attention again (Open).
        // Admin speaks   → waiting on student (Replied).
        $newStatus = $senderType === 'Admin' ? 'Replied' : 'Open';
        $update = $this->conn->prepare(
            "UPDATE concerns
             SET status = :status, updated_at = NOW(), last_message_at = NOW()
             WHERE id = :id"
        );
        $update->execute(['status' => $newStatus, 'id' => $concernId]);

        return $messageId;
    }

    public function setStatus(int $id, string $status): bool
    {
        if (!in_array($status, ['Open', 'Replied', 'Resolved'], true)) return false;
        $stmt = $this->conn->prepare(
            "UPDATE concerns SET status = :status, updated_at = NOW() WHERE id = :id"
        );
        return $stmt->execute(['status' => $status, 'id' => $id]);
    }

    public function openCount(): int
    {
        $stmt = $this->conn->query("SELECT COUNT(*) AS cnt FROM concerns WHERE status = 'Open'");
        return (int)($stmt->fetch()['cnt'] ?? 0);
    }
}