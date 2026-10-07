<?php
require_once __DIR__ . '/../models/Reservation.php';
require_once __DIR__ . '/../models/Computer.php';
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/SessionModel.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/ActivityLog.php';
require_once __DIR__ . '/../models/Semester.php';
require_once __DIR__ . '/../models/LibraryHour.php';

class ReservationController
{
    private Reservation $model;
    private Computer $computerModel;
    private Notification $notificationModel;
    private ActivityLog $activityLog;

    public function __construct()
    {
        $this->model = new Reservation();
        $this->computerModel = new Computer();
        $this->notificationModel = new Notification();
        $this->activityLog = new ActivityLog();
    }

    public function list(?string $status = null): void
    {
        $this->model->expireNoShows();
        json_success($this->model->all($status ? ['status' => $status] : []));
    }

    public function forStudent(int $studentId): void
    {
        $this->model->expireNoShows();
        json_success($this->model->byStudent($studentId));
    }

    public function get(int $id, array $user): void
    {
        $reservation = $this->model->findById($id);
        if (!$reservation) {
            json_error('Reservation not found', 404);
        }

        if ($user['user_type'] === 'student' && (int)$reservation['student_id'] !== (int)$user['sub']) {
            json_error('You do not have permission to view this reservation', 403);
        }

        json_success($reservation);
    }

    public function create(int $studentId, array $data): void
    {
        $v = (new Validator())->required($data, ['computer_id', 'reservation_date', 'start_time', 'end_time']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $studentModel = new Student();
        $student = $studentModel->findById($studentId);
        if (!$student) json_error('Student not found', 404);
        if ((float)$student['remaining_hours'] <= 0) {
            json_error('You have no remaining library hours this semester', 403);
        }

        // Validate date format before anything else.
        $reservationDate = (string)$data['reservation_date'];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $reservationDate)) {
            json_error('Validation failed', 422, ['reservation_date' => 'Date must be YYYY-MM-DD']);
        }

        // Normalize start/end times to H:i:s.
        $startTime = $this->normalizeTime((string)$data['start_time']);
        $endTime   = $this->normalizeTime((string)$data['end_time']);
        if ($startTime === null) {
            json_error('Validation failed', 422, ['start_time' => 'Start time must be HH:MM or HH:MM:SS']);
        }
        if ($endTime === null) {
            json_error('Validation failed', 422, ['end_time' => 'End time must be HH:MM or HH:MM:SS']);
        }

        $computer = $this->computerModel->findById((int)$data['computer_id']);
        if (!$computer) json_error('Computer not found', 404);
        if ($computer['status'] === COMP_MAINTENANCE) {
            json_error('This computer is under maintenance and cannot be reserved', 409);
        }

        if (strtotime($startTime) >= strtotime($endTime)) {
            json_error('Start time must be before end time', 422);
        }

        // Reject past reservations and same-day-in-the-past reservations.
        $reservationTs = strtotime($reservationDate . ' ' . $startTime);
        if ($reservationTs === false) {
            json_error('Invalid reservation date or time', 422);
        }
        if ($reservationTs <= time()) {
            json_error('Reservation start must be in the future', 422);
        }
        $todayMidnight = strtotime(date('Y-m-d'));
        if (strtotime($reservationDate) < $todayMidnight) {
            json_error('Reservation date cannot be in the past', 422);
        }

        // Reservation must be within the active semester window.
        $semester = (new Semester())->current();
        if ($semester) {
            if ($reservationDate < $semester['start_date'] || $reservationDate > $semester['end_date']) {
                json_error(
                    'Reservations can only be made within the current semester ('
                    . $semester['start_date'] . ' to ' . $semester['end_date'] . ')',
                    422
                );
            }
        }

        // Reservation must fit within that day's library hours.
        $dayOfWeek = date('l', strtotime($reservationDate));
        $hours = (new LibraryHour())->findByDay($dayOfWeek);
        if (!$hours || !$hours['is_open']) {
            json_error("The library is closed on {$dayOfWeek}. Please pick another day.", 422);
        }

        $openNorm  = $this->normalizeTime((string)$hours['opening_time']);
        $closeNorm = $this->normalizeTime((string)$hours['closing_time']);

        if ($openNorm !== null && $startTime < $openNorm) {
            json_error(
                "Reservation start is before the library opens ({$hours['opening_time']}) on {$dayOfWeek}",
                422
            );
        }
        if ($closeNorm !== null && $endTime > $closeNorm) {
            json_error(
                "Reservation end is after the library closes ({$hours['closing_time']}) on {$dayOfWeek}",
                422
            );
        }

        // Cap a single reservation to a reasonable maximum (4 hours).
        $minutes = (strtotime($endTime) - strtotime($startTime)) / 60;
        if ($minutes > 240) {
            json_error('A single reservation cannot exceed 4 hours', 422);
        }
        if ($minutes < 15) {
            json_error('A reservation must be at least 15 minutes long', 422);
        }

        if ($this->model->hasConflict((int)$data['computer_id'], $reservationDate, $startTime, $endTime)) {
            json_error('This computer already has a reservation that conflicts with the selected time', 409);
        }

        // Prevent a student from holding two reservations for the same
        // computer/date against which they'll double-book.
        $existing = $this->model->byComputerAndDate((int)$data['computer_id'], $reservationDate);
        foreach ($existing as $r) {
            if ((int)$r['student_id'] === $studentId) {
                json_error('You already have a reservation for this computer on this date', 409);
            }
        }

        $id = $this->model->create([
            'student_id'       => $studentId,
            'computer_id'      => $data['computer_id'],
            'reservation_date' => $reservationDate,
            'start_time'       => $startTime,
            'end_time'         => $endTime,
        ]);

        // ==========================================================
        // FIX: notify every active admin that a new reservation is
        // pending review. Without this, the row sat in the admin's
        // Pending tab unseen until someone happened to open the page.
        //
        // Same pattern as ConcernController::create() and
        // UpdateRequestController::create() — one notification row per
        // active admin, type 'reservation' so it renders with the
        // calendar icon and maps to the "Reservation" filter option in
        // the admin notifications UI.
        // ==========================================================
        $studentName = trim(($student['first_name'] ?? '') . ' ' . ($student['last_name'] ?? ''));
        if ($studentName === '') $studentName = 'A student';

        $computerLabel = $computer['computer_number'] ?? 'a computer';
        if (!empty($computer['computer_name'])) {
            $computerLabel .= ' (' . $computer['computer_name'] . ')';
        }

        $dateLabel = date('M j, Y', strtotime($reservationDate));
        $startLabel = date('g:i A', strtotime($startTime));
        $endLabel   = date('g:i A', strtotime($endTime));

        $title   = 'New Reservation Request';
        $message = "{$studentName} requested {$computerLabel} on {$dateLabel} from "
                 . "{$startLabel} to {$endLabel}.";

        $db = Database::getConnection();
        $adminIds = $db->query("SELECT id FROM admins WHERE status='Active'")
                       ->fetchAll(PDO::FETCH_COLUMN);

        foreach ($adminIds as $adminId) {
            $this->notificationModel->send(
                'Admin',
                (int)$adminId,
                $title,
                $message,
                'reservation'
            );
        }

        json_success(['id' => $id], 'Reservation submitted and pending approval', 201);
    }

    public function approve(int $id, int $approvedByAdminId): void
    {
        $reservation = $this->model->findById($id);
        if (!$reservation) json_error('Reservation not found', 404);
        if ($reservation['status'] !== RES_PENDING) json_error('Only pending reservations can be approved', 409);

        // Re-check conflict at approval time — another reservation may
        // have been approved since this one was submitted.
        if ($this->model->hasConflict(
            (int)$reservation['computer_id'],
            $reservation['reservation_date'],
            $reservation['start_time'],
            $reservation['end_time'],
            $id
        )) {
            json_error('Cannot approve — another reservation overlaps this slot', 409);
        }

        // Refuse to approve a reservation whose window has already passed.
        $reservationTs = strtotime($reservation['reservation_date'] . ' ' . $reservation['end_time']);
        if ($reservationTs !== false && $reservationTs <= time()) {
            json_error('Cannot approve — this reservation is already in the past', 409);
        }

        $this->model->approve($id, $approvedByAdminId);
        $this->computerModel->recomputeStatus((int)$reservation['computer_id']);

        $this->activityLog->log(
            $approvedByAdminId,
            'Approved Reservation',
            "{$reservation['first_name']} {$reservation['last_name']} — Computer #{$reservation['computer_number']} on {$reservation['reservation_date']} {$reservation['start_time']}"
        );

        $this->notificationModel->send(
            'Student',
            (int)$reservation['student_id'],
            'Reservation Approved',
            "Your reservation for {$reservation['reservation_date']} at {$reservation['start_time']} has been approved."
        );

        json_success(null, 'Reservation approved');
    }

    public function reject(int $id, int $approvedByAdminId): void
    {
        $reservation = $this->model->findById($id);
        if (!$reservation) json_error('Reservation not found', 404);
        if ($reservation['status'] !== RES_PENDING) json_error('Only pending reservations can be rejected', 409);

        $data = get_json_input();
        $reason = $data['reason'] ?? null;

        if ($reason !== null) {
            $reason = trim((string)$reason);
            if ($reason === '') $reason = null;
            elseif (mb_strlen($reason) > 500) {
                json_error('Validation failed', 422, ['reason' => 'Reason must not exceed 500 characters']);
            }
        }

        $this->model->reject($id, $approvedByAdminId, $reason);

        $this->activityLog->log(
            $approvedByAdminId,
            'Rejected Reservation',
            "{$reservation['first_name']} {$reservation['last_name']} — Computer #{$reservation['computer_number']} on {$reservation['reservation_date']} {$reservation['start_time']}"
        );

        $this->notificationModel->send(
            'Student',
            (int)$reservation['student_id'],
            'Reservation Rejected',
            $reason
                ? "Your reservation for {$reservation['reservation_date']} at {$reservation['start_time']} was rejected: {$reason}"
                : "Your reservation for {$reservation['reservation_date']} at {$reservation['start_time']} was rejected."
        );

        json_success(null, 'Reservation rejected');
    }

    public function cancel(int $id, string $cancelledByType, int $cancelledById): void
    {
        $reservation = $this->model->findById($id);
        if (!$reservation) json_error('Reservation not found', 404);
        if (in_array($reservation['status'], ['Cancelled', 'Rejected', 'Completed', 'Expired'], true)) {
            json_error('This reservation can no longer be cancelled', 409);
        }

        if ($cancelledByType === 'student' && (int)$reservation['student_id'] !== $cancelledById) {
            json_error('You can only cancel your own reservations', 403);
        }

        $data = get_json_input();
        $reason = $data['reason'] ?? null;

        if ($reason !== null) {
            $reason = trim((string)$reason);
            if ($reason === '') $reason = null;
            elseif (mb_strlen($reason) > 500) {
                json_error('Validation failed', 422, ['reason' => 'Reason must not exceed 500 characters']);
            }
        }

        $this->model->cancel($id, $cancelledByType === 'admin' ? $cancelledById : null, $reason);

        $sessionModel = new SessionModel();
        if (!$sessionModel->activeByComputer((int)$reservation['computer_id'])) {
            $this->computerModel->recomputeStatus((int)$reservation['computer_id']);
        }

        if ($cancelledByType === 'admin') {
            $this->activityLog->log(
                $cancelledById,
                'Cancelled Reservation',
                "{$reservation['first_name']} {$reservation['last_name']} — Computer #{$reservation['computer_number']} on {$reservation['reservation_date']} {$reservation['start_time']}"
            );
        }

        json_success(null, 'Reservation cancelled');
    }

    /** Helper — accepts "HH:MM" or "HH:MM:SS", returns "HH:MM:SS" or null. */
    private function normalizeTime(string $t): ?string
    {
        $dt = date_create_from_format('H:i:s', $t) ?: date_create_from_format('H:i', $t);
        return $dt ? $dt->format('H:i:s') : null;
    }
}