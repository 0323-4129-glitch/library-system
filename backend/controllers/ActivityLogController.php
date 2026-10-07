<?php
require_once __DIR__ . '/../models/ActivityLog.php';

/**
 * profile.js calls api.get('activity-logs.php') to render the "Recent
 * Activity" panel. Wired in index.php as GET /activity-logs (admin only).
 *
 * FIX: the previously-declared forAdmin() method called
 * ActivityLog::byAdmin(), which does not exist — a fatal error waiting to
 * happen the moment a route was added for it. Nothing in the router or
 * frontend referenced it, so it has been removed. If per-admin filtering
 * is needed later, add ActivityLog::byAdmin($id) first.
 */
class ActivityLogController
{
    private ActivityLog $model;

    public function __construct()
    {
        $this->model = new ActivityLog();
    }

    public function list(?int $limit = 50): void
    {
        json_success($this->model->recent($limit ?? 50));
    }
}