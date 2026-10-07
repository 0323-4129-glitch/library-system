<?php
// backend/config/database.php
// CORS headers are handled globally in config.php – do NOT set them here.

class Database {
    private static $instance = null;
    private $connection;

    private $host = 'localhost';
    private $dbname = 'library_system';
    private $username = 'root';
    private $password = '';

    private function __construct() {
        try {
            $this->connection = new PDO(
                "mysql:host={$this->host};dbname={$this->dbname};charset=utf8mb4",
                $this->username,
                $this->password,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false
                ]
            );

            // FIX: align MySQL's session timezone with PHP's
            // date_default_timezone_set('Asia/Manila'). Without this, NOW(),
            // CURDATE(), and CURTIME() return the system TZ (often UTC on
            // XAMPP), which is 8 hours behind PHP. Reservation conflict
            // checks, no-show grace periods, and session duration math all
            // silently broke across that gap.
            $this->connection->exec("SET time_zone = '+08:00'");

        } catch (PDOException $e) {
            $this->sendError('Database connection failed: ' . $e->getMessage(), 500);
        }
    }

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public static function getConnection(): PDO {
        return self::getInstance()->connection;
    }

    public function sendResponse($data, $statusCode = 200) {
        http_response_code($statusCode);
        echo json_encode($data);
        exit;
    }

    public function sendError($message, $statusCode = 400) {
        http_response_code($statusCode);
        echo json_encode([
            'success' => false,
            'message' => $message
        ]);
        exit;
    }

    public function sendSuccess($data = [], $message = 'Success') {
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'message' => $message,
            'data' => $data
        ]);
        exit;
    }
}