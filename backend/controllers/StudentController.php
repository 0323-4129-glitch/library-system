<?php
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/Semester.php';
require_once __DIR__ . '/../models/ActivityLog.php';

class StudentController
{
    private Student $model;
    private Semester $semesterModel;
    private ActivityLog $activityLog;

    /**
     * FIX: whitelist of fields an admin is allowed to edit directly.
     * System-managed counters (remaining_hours, used_hours, total_sessions,
     * last_login, last_logout) are excluded — they are owned by the
     * session/reservation lifecycle, not by admin forms.
     */
    private const EDITABLE_FIELDS = [
        'first_name', 'middle_name', 'last_name',
        'contact_number', 'email', 'photo_url', 'status',
    ];

    public function __construct()
    {
        $this->model = new Student();
        $this->semesterModel = new Semester();
        $this->activityLog = new ActivityLog();
    }

    public function list(?string $search = null): void
    {
        json_success($this->model->all($search ? ['search' => $search] : []));
    }

    public function getCourses(): void
    {
        $stmt = $this->model->getConnection()->query(
            "SELECT DISTINCT course
             FROM students
             WHERE course IS NOT NULL AND course != ''
             ORDER BY course ASC"
        );
        json_success($stmt->fetchAll(PDO::FETCH_COLUMN));
    }

    public function get(int $id): void
    {
        $student = $this->model->findById($id);
        if (!$student) json_error('Student not found', 404);
        unset($student['password']);
        json_success($student);
    }

    public function create(array $data, int $adminId): void
    {
        $v = (new Validator())->required($data, ['student_id', 'first_name', 'last_name']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        // FIX: Student ID format — alphanumeric + dash, 3–30 chars.
        $studentId = trim((string)$data['student_id']);
        if (!preg_match('/^[A-Za-z0-9\-]{3,30}$/', $studentId)) {
            json_error('Validation failed', 422, [
                'student_id' => 'Student ID must be 3–30 characters (letters, digits, dashes only)',
            ]);
        }
        $data['student_id'] = $studentId;

        if (!empty($data['year_level']) && !in_array($data['year_level'], Student::validYearLevels(), true)) {
            json_error('Validation failed', 422, [
                'year_level' => 'Must be one of: ' . implode(', ', Student::validYearLevels()),
            ]);
        }

        // FIX: trim and length-check names before they hit the DB.
        foreach (['first_name', 'middle_name', 'last_name'] as $f) {
            if (isset($data[$f])) {
                $data[$f] = trim((string)$data[$f]);
            }
        }
        if ($data['first_name'] === '' || $data['last_name'] === '') {
            json_error('Validation failed', 422, [
                'first_name' => 'First name cannot be blank',
                'last_name'  => 'Last name cannot be blank',
            ]);
        }

        if ($this->model->findByStudentId($data['student_id'])) {
            json_error('A student with this Student ID already exists', 409);
        }

        if (!empty($data['email'])) {
            $data['email'] = trim((string)$data['email']);
            $v2 = (new Validator())->email($data, 'email');
            if ($v2->fails()) json_error('Validation failed', 422, $v2->getErrors());

            if ($this->model->emailExists($data['email'])) {
                json_error('A student with this email already exists', 409);
            }
        }

        // FIX: contact_number format check.
        if (!empty($data['contact_number'])) {
            $data['contact_number'] = trim((string)$data['contact_number']);
            if (!preg_match('/^[0-9+\-\s()]{7,20}$/', $data['contact_number'])) {
                json_error('Validation failed', 422, [
                    'contact_number' => 'Contact number must be 7–20 digits (may include + - ( ) spaces)',
                ]);
            }
        }

        $data['password'] = $data['password'] ?? $data['student_id'];
        $data['password'] = hash_password($data['password']);

        if (!isset($data['remaining_hours'])) {
            $semester = $this->semesterModel->current() ?: $this->semesterModel->latest();
            $data['remaining_hours'] = $semester ? (float)$semester['student_hour_limit'] : DEFAULT_HOUR_LIMIT;
        }

        $id = $this->model->create($data);

        $this->activityLog->log($adminId, 'Added Student', "{$data['first_name']} {$data['last_name']} (Student ID: {$data['student_id']})");

        json_success(['id' => $id], 'Student created. Default password is the Student ID.', 201);
    }

    public function update(int $id, array $data, int $adminId): void
    {
        $existing = $this->model->findById($id);
        if (!$existing) json_error('Student not found', 404);

        // Locked fields must go through the update-request workflow.
        foreach (['student_id', 'course', 'year_level'] as $locked) {
            if (array_key_exists($locked, $data)) {
                json_error("Field '$locked' cannot be edited directly. Use the update-request workflow.", 422);
            }
        }

        // FIX: silently discard anything that isn't in the whitelist —
        // including system counters — instead of forwarding it to the
        // model. Previously an admin PUT with remaining_hours/total_sessions
        // would corrupt those values.
        $filtered = array_intersect_key($data, array_flip(self::EDITABLE_FIELDS));

        if (empty($filtered)) {
            json_error('No editable fields were provided', 422);
        }

        // FIX: trim and reject empty names.
        foreach (['first_name', 'middle_name', 'last_name'] as $f) {
            if (array_key_exists($f, $filtered)) {
                $filtered[$f] = trim((string)$filtered[$f]);
            }
        }
        foreach (['first_name', 'last_name'] as $required) {
            if (array_key_exists($required, $filtered) && $filtered[$required] === '') {
                json_error('Validation failed', 422, [
                    $required => ucfirst($required) . ' cannot be empty',
                ]);
            }
        }

        // FIX: reject empty email — this was previously only caught if the
        // caller changed it to a different non-empty value.
        if (array_key_exists('email', $filtered)) {
            $filtered['email'] = trim((string)$filtered['email']);
            if ($filtered['email'] === '') {
                json_error('Validation failed', 422, ['email' => 'Email cannot be empty']);
            }
            if ($filtered['email'] !== $existing['email']) {
                $v = (new Validator())->email($filtered, 'email');
                if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

                if ($this->model->emailExists($filtered['email'], $id)) {
                    json_error('A student with this email already exists', 409);
                }
            }
        }

        // FIX: status whitelist — you had this in setStatus but not here.
        if (array_key_exists('status', $filtered)
            && !in_array($filtered['status'], [STATUS_ACTIVE, STATUS_INACTIVE], true)) {
            json_error('Validation failed', 422, [
                'status' => 'Status must be ' . STATUS_ACTIVE . ' or ' . STATUS_INACTIVE,
            ]);
        }

        // FIX: contact_number format.
        if (array_key_exists('contact_number', $filtered) && $filtered['contact_number'] !== '') {
            if (!preg_match('/^[0-9+\-\s()]{7,20}$/', $filtered['contact_number'])) {
                json_error('Validation failed', 422, [
                    'contact_number' => 'Contact number must be 7–20 digits (may include + - ( ) spaces)',
                ]);
            }
        }

        $this->model->update($id, $filtered);

        $this->activityLog->log($adminId, 'Updated Student', "{$existing['first_name']} {$existing['last_name']} (Student ID: {$existing['student_id']})");

        json_success(null, 'Student updated');
    }

    public function setStatus(int $id, string $status, int $adminId): void
    {
        if (!in_array($status, [STATUS_ACTIVE, STATUS_INACTIVE], true)) {
            json_error('Invalid status value', 422);
        }
        $student = $this->model->findById($id);
        if (!$student) json_error('Student not found', 404);

        $this->model->setStatus($id, $status);

        $this->activityLog->log($adminId, 'Changed Student Status', "{$student['first_name']} {$student['last_name']} (Student ID: {$student['student_id']}) set to $status");

        json_success(null, "Student status set to $status");
    }

    public function resetPasswordToStudentId(int $id, int $adminId): void
    {
        $student = $this->model->findById($id);
        if (!$student) json_error('Student not found', 404);

        $hashed = hash_password($student['student_id']);
        $this->model->updatePassword($id, $hashed, true);

        $this->activityLog->log(
            $adminId,
            'Reset Student Password',
            "{$student['first_name']} {$student['last_name']} (Student ID: {$student['student_id']}) password reset to Student ID"
        );

        json_success(null, 'Password reset to Student ID. Student must change it on next login.');
    }
}