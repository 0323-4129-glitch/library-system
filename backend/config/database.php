
<?php
// backend/config/database.php

class Database {
    private static $instance = null;
    private $connection;

    private function __construct() {
        try {
            $host = getenv('DB_HOST');
            $port = getenv('DB_PORT') ?: '3306';
            $dbname = getenv('DB_NAME');
            $username = getenv('DB_USER');
            $password = getenv('DB_PASSWORD');

            if (!$host || !$dbname || !$username || $password === false) {
                throw new RuntimeException(
                    'Missing database environment variables'
                );
            }

            $this->connection = new PDO(
                "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4",
                $username,
                $password,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false
                ]
            );

            $this->connection->exec("SET time_zone = '+08:00'");

        } catch (PDOException $e) {
            error_log('Database connection error: ' . $e->getMessage());
            $this->sendError('Database connection unavailable.', 500);
        } catch (RuntimeException $e) {
            error_log($e->getMessage());
            $this->sendError('Database configuration error.', 500);
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
