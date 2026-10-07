<?php
// backend/helpers/rate_limiter.php
require_once __DIR__ . '/../config/database.php';

/**
 * RateLimiter
 *
 * CHANGES IN THIS REVISION
 *  - The window is inlined as an integer (cast) instead of bound
 *    as a placeholder. With PDO::ATTR_EMULATE_PREPARES = false, MySQL
 *    rejects bound placeholders inside INTERVAL, so the previous
 *    "INTERVAL :window SECOND" query threw a PDOException on every
 *    call — meaning rate limiting was effectively dead.
 *  - The insert now happens BEFORE the count. Previously the flow was
 *    count-then-insert, so two concurrent requests could both read
 *    count = limit-1, both pass the check, and both insert — exceeding
 *    the limit by one. Now whichever request tips the counter over the
 *    limit deletes its own row and rejects. Worst case is one extra
 *    rejection during a burst, which is the safe direction for a rate
 *    limiter. The number of rows for an identifier in a window can
 *    never exceed `limit`.
 *  - The cleanup DELETE is bounded (LIMIT 1000) so it can't scan an
 *    enormous table on a hot path.
 */

class RateLimiter
{
    private PDO $conn;

    public function __construct()
    {
        $this->conn = Database::getConnection();
    }

    public function check(string $identifier, int $limit = 5, int $window = 300): void
    {
        // Window is a caller-supplied int, never user input, but we cast
        // anyway. Values are clamped to a sane range.
        $window = max(1, min(86400, (int)$window));
        $limit  = max(1, (int)$limit);

        // Housekeeping — clear expired rows. Bounded so it can't scan
        // an enormous table on a hot path.
        $clean = $this->conn->prepare(
            "DELETE FROM rate_limits
             WHERE expires_at < NOW()
             LIMIT 1000"
        );
        $clean->execute();

        // Insert first. The row is ours if we end up rejecting; we'll
        // delete it by lastInsertId so we never touch anyone else's row.
        // INTERVAL cannot be a placeholder under non-emulated prepares.
        $insert = $this->conn->prepare(
            "INSERT INTO rate_limits (identifier, expires_at)
             VALUES (:id, DATE_ADD(NOW(), INTERVAL {$window} SECOND))"
        );
        $insert->execute(['id' => $identifier]);
        $insertId = (int)$this->conn->lastInsertId();

        $stmt = $this->conn->prepare(
            "SELECT COUNT(*) AS cnt
             FROM rate_limits
             WHERE identifier = :id AND expires_at > NOW()"
        );
        $stmt->execute(['id' => $identifier]);
        $count = (int)$stmt->fetch()['cnt'];

        if ($count > $limit) {
            // We are the (limit+1)th request in this window — undo our
            // own insert and reject.
            $del = $this->conn->prepare("DELETE FROM rate_limits WHERE id = :id");
            $del->execute(['id' => $insertId]);

            json_error('Too many attempts. Please try again later.', 429);
        }
    }
}