<?php
require_once __DIR__ . '/../models/SessionModel.php';

class SessionController
{
    private SessionModel $model;

    public function __construct()
    {
        $this->model = new SessionModel();
    }

    public function list(?string $status = null, ?int $computerId = null, ?int $limit = 50): void
    {
        $filters = [];
        if ($status) $filters['status'] = $status;
        if ($computerId) $filters['computer_id'] = $computerId;
        if ($limit) $filters['limit'] = $limit;

        json_success($this->model->history($filters));
    }

    public function activeSessions(): void
    {
        json_success($this->model->allActive());
    }

    public function history(int $studentId): void
    {
        json_success($this->model->history(['student_id' => $studentId]));
    }

    public function end(int $sessionId): void
    {
        require_once __DIR__ . '/../models/Student.php';
        require_once __DIR__ . '/../models/Computer.php';
        require_once __DIR__ . '/../models/Reservation.php';
        require_once __DIR__ . '/../models/LoginLog.php';
        require_once __DIR__ . '/../models/Notification.php';

        $session = $this->model->findById($sessionId);
        if (!$session) json_error('Session not found', 404);

        if ($session['status'] !== 'Active') {
            json_error('This session has already been ended', 409);
        }

        $minutes = $this->model->end($sessionId, 'admin');
        if ($minutes === false) {
            json_error('This session has already been ended', 409);
        }

        if ($minutes > 0) {
            (new Student())->deductHours((int)$session['student_id'], round($minutes / 60, 4));
        }

        // FIX: recompute — computer may become Reserved (not Available)
        // if an Approved reservation is imminent.
        (new Computer())->recomputeStatus((int)$session['computer_id']);

        if (!empty($session['reservation_id'])) {
            (new Reservation())->markCompleted((int)$session['reservation_id']);
        }

        $openLog = (new LoginLog())->openSession('Student', (int)$session['student_id'], true);
        if ($openLog) {
            Logger::logout((int)$openLog['id']);
        }

        (new Notification())->send(
            'Student',
            (int)$session['student_id'],
            'Session Ended by Administrator',
            'A library staff member ended your computer session. Please see the librarian if you have questions.',
            'warning'
        );

        json_success(['duration_minutes' => $minutes], 'Session ended');
    }
}