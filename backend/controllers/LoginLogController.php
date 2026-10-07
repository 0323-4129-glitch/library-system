<?php
require_once __DIR__ . '/../models/LoginLog.php';

/**
 * FIX: LoginLog model was fully built and correctly written to by
 * Logger::login()/Logger::logout() on every login/logout, but nothing
 * ever exposed it through a route — same gap ActivityLogController
 * closed for activity_logs. Wired in as GET /login-logs (Head Admin
 * only) and GET /login-logs/user/{userType}/{userId} (own history for
 * the authenticated user, or any admin).
 */
class LoginLogController
{
    private LoginLog $model;

    public function __construct()
    {
        $this->model = new LoginLog();
    }

    /** All login/logout activity, optionally filtered by ?user_type=Admin|Student&date=YYYY-MM-DD */
    public function list(array $filters = []): void
    {
        json_success($this->model->all($filters));
    }

    /** Login history for a single user (admin or student) */
    public function forUser(string $userType, int $userId): void
    {
        json_success($this->model->byUser($userType, $userId));
    }
}