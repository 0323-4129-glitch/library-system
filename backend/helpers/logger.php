<?php
// backend/helpers/logger.php

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/../models/LoginLog.php';

class Logger {
    private static $instance = null;
    private $logFile;
    private $logLevel;

    private function __construct() {
        $this->logFile = __DIR__ . '/../logs/app.log';
        $this->logLevel = 'INFO';

        $logDir = dirname($this->logFile);
        if (!is_dir($logDir)) {
            mkdir($logDir, 0777, true);
        }
    }

    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function log($level, $message, $context = []) {
        $timestamp = date('Y-m-d H:i:s');
        $contextString = !empty($context) ? ' ' . json_encode($context) : '';
        $logEntry = "[$timestamp] [$level] $message$contextString" . PHP_EOL;

        file_put_contents($this->logFile, $logEntry, FILE_APPEND);

        $this->logToDatabase($level, $message, $context);
    }

    private function logToDatabase($level, $message, $context = []) {
        try {
            $conn = Database::getConnection();
            $stmt = $conn->prepare(
                "INSERT INTO activity_logs (admin_id, action, description) VALUES (NULL, :action, :description)"
            );
            $stmt->execute([
                'action' => $level,
                'description' => $message . ' ' . json_encode($context)
            ]);
        } catch (Exception $e) {
            // Silent
        }
    }

    public function info($message, $context = []) { $this->log('INFO', $message, $context); }
    public function warning($message, $context = []) { $this->log('WARNING', $message, $context); }
    public function error($message, $context = []) { $this->log('ERROR', $message, $context); }
    public function debug($message, $context = []) { $this->log('DEBUG', $message, $context); }

    /**
     * Now accepts optional $sessionId and $computerId to fill login_logs new columns.
     */
    public static function login(string $userType, int $userId, ?int $sessionId = null, ?int $computerId = null): int {
        $loginLog = new LoginLog();
        return $loginLog->recordLogin($userType, $userId, getIPAddress(), $computerId, $sessionId);
    }

    public static function logout(int $loginLogId): bool {
        $loginLog = new LoginLog();
        return $loginLog->recordLogout($loginLogId);
    }
}

function logMessage($level, $message, $context = []) {
    $logger = Logger::getInstance();
    $logger->log($level, $message, $context);
}