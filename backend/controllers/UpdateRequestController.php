<?php
require_once __DIR__ . '/../models/UpdateRequest.php';
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/ActivityLog.php';

class UpdateRequestController
{
    private UpdateRequest $model;
    private Student $studentModel;
    private Notification $notificationModel;
    private ActivityLog $activityLog;

    public function __construct()
    {
        $this->model = new UpdateRequest();
        $this->studentModel = new Student();
        $this->notificationModel = new Notification();
        $this->activityLog = new ActivityLog();
    }

    public function list(?string $status = null): void
    {
        json_success($this->model->all($status));
    }

    public function forStudent(int $studentId): void
    {
        json_success($this->model->byStudent($studentId));
    }

    public function create(int $studentId, array $data): void
    {
        $v = (new Validator())
            ->required($data, ['request_type', 'new_value'])
            ->in($data, 'request_type', ['Student ID', 'Course', 'Year Level']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $student = $this->studentModel->findById($studentId);
        if (!$student) json_error('Student not found', 404);

        // Trim the new value once, then validate per-type.
        $newValue = trim((string)$data['new_value']);
        if ($newValue === '') {
            json_error('Validation failed', 422, ['new_value' => 'New value cannot be empty']);
        }

        // Reject bad year_level values up front.
        if ($data['request_type'] === 'Year Level'
            && !in_array($newValue, Student::validYearLevels(), true)) {
            json_error('Validation failed', 422, [
                'new_value' => 'Must be one of: ' . implode(', ', Student::validYearLevels()),
            ]);
        }

        // Student ID must match the same format used at creation time.
        if ($data['request_type'] === 'Student ID') {
            if (!preg_match('/^[A-Za-z0-9\-]{3,30}$/', $newValue)) {
                json_error('Validation failed', 422, [
                    'new_value' => 'Student ID must be 3–30 characters (letters, digits, dashes only)',
                ]);
            }

            // Reject a Student ID that already belongs to another student.
            $collision = $this->studentModel->findByStudentId($newValue);
            if ($collision && (int)$collision['id'] !== $studentId) {
                json_error(
                    'Another student already uses the Student ID "' . $newValue . '"',
                    409
                );
            }
        }

        // Course must exist as a known course.
        if ($data['request_type'] === 'Course') {
            if (mb_strlen($newValue) > 100) {
                json_error('Validation failed', 422, [
                    'new_value' => 'Course name must not exceed 100 characters',
                ]);
            }

            $conn = $this->studentModel->getConnection();
            $stmt = $conn->prepare(
                "SELECT 1 FROM students
                 WHERE course = :course
                 LIMIT 1"
            );
            $stmt->execute(['course' => $newValue]);
            if (!$stmt->fetch()) {
                json_error(
                    'Course "' . $newValue . '" is not a recognized course code. '
                    . 'Please pick from the list of existing courses or contact the librarian.',
                    422
                );
            }
        }

        $fieldMap = ['Student ID' => 'student_id', 'Course' => 'course', 'Year Level' => 'year_level'];
        $field = $fieldMap[$data['request_type']];
        $oldValue = (string)$student[$field];

        if ($oldValue === $newValue) {
            json_error("New value is identical to the current {$data['request_type']}", 422);
        }

        if ($this->model->hasPending($studentId, $data['request_type'])) {
            json_error("You already have a pending {$data['request_type']} request", 409);
        }

        $id = $this->model->create([
            'student_id'   => $studentId,
            'request_type' => $data['request_type'],
            'old_value'    => $oldValue,
            'new_value'    => $newValue,
        ]);

        // ==========================================================
        // FIX: notify every active admin that a new update request
        // has been submitted. Without this, the request would sit in
        // the admin's "Pending Update Requests" tab unseen until
        // someone happened to open the page. Same pattern as
        // ConcernController::create() so the notification row is
        // picked up by GET /notifications, the unread badge, and
        // the SSE stream.
        // ==========================================================
        $studentName = trim(($student['first_name'] ?? '') . ' ' . ($student['last_name'] ?? ''));
        if ($studentName === '') $studentName = 'A student';

        $title = 'New Update Request';
        $message = "{$studentName} requested a {$data['request_type']} change: "
                 . "{$oldValue} → {$newValue}";

        $db = Database::getConnection();
        $adminIds = $db->query("SELECT id FROM admins WHERE status='Active'")
                       ->fetchAll(PDO::FETCH_COLUMN);

        foreach ($adminIds as $adminId) {
            $this->notificationModel->send(
                'Admin',
                (int)$adminId,
                $title,
                $message,
                'update'   // maps to the "Update Request" label in the admin UI
            );
        }

        json_success(['id' => $id], 'Update request submitted for admin review', 201);
    }

    public function review(int $id, string $decision, int $reviewerAdminId): void
    {
        if (!in_array($decision, ['Approved', 'Rejected'], true)) {
            json_error('Decision must be Approved or Rejected', 422);
        }

        $request = $this->model->findById($id);
        if (!$request) json_error('Update request not found', 404);
        if ($request['status'] !== 'Pending') json_error('This request has already been reviewed', 409);

        if ($decision === 'Approved') {
            $fieldMap = ['Student ID' => 'student_id', 'Course' => 'course', 'Year Level' => 'year_level'];
            $field = $fieldMap[$request['request_type']];

            if ($field === 'student_id') {
                // Also re-check format at approval time in case the
                // row was inserted before this validation existed.
                if (!preg_match('/^[A-Za-z0-9\-]{3,30}$/', $request['new_value'])) {
                    json_error(
                        'Cannot approve: "' . $request['new_value'] . '" is not a valid Student ID format',
                        422
                    );
                }

                $collision = $this->studentModel->findByStudentId($request['new_value']);
                if ($collision && (int)$collision['id'] !== (int)$request['student_id']) {
                    json_error(
                        'Cannot approve: another student already uses the Student ID "' . $request['new_value'] . '"',
                        409
                    );
                }
            }

            if ($field === 'year_level' && !in_array($request['new_value'], Student::validYearLevels(), true)) {
                json_error(
                    'Cannot approve: "' . $request['new_value'] . '" is not a valid year level. '
                    . 'Expected one of: ' . implode(', ', Student::validYearLevels()),
                    422
                );
            }

            // Course re-validation at approval time.
            if ($field === 'course') {
                $conn = $this->studentModel->getConnection();
                $stmt = $conn->prepare("SELECT 1 FROM students WHERE course = :course LIMIT 1");
                $stmt->execute(['course' => $request['new_value']]);
                if (!$stmt->fetch()) {
                    json_error(
                        'Cannot approve: "' . $request['new_value'] . '" is not a recognized course',
                        422
                    );
                }
            }

            $applied = $this->studentModel->updateRestrictedField(
                (int)$request['student_id'],
                $field,
                $request['new_value']
            );

            if (!$applied) {
                json_error('Failed to apply update to the student record', 500);
            }

            $this->model->approve($id, $reviewerAdminId);

            if ($request['request_type'] === 'Student ID') {
                $this->studentModel->resetPasswordToStudentId(
                    (int)$request['student_id'],
                    hash_password($request['new_value'])
                );
            }
        } else {
            $this->model->reject($id, $reviewerAdminId);
        }

        $this->activityLog->log(
            $reviewerAdminId,
            "{$decision} Update Request",
            "{$request['first_name']} {$request['last_name']} — {$request['request_type']}: {$request['old_value']} → {$request['new_value']}"
        );

        $this->notificationModel->send(
            'Student',
            (int)$request['student_id'],
            "Update Request {$decision}",
            "Your request to change {$request['request_type']} was {$decision}."
        );

        json_success(null, "Request {$decision}");
    }
}