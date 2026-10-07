<?php
require_once __DIR__ . '/../models/Semester.php';
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/ActivityLog.php';

class SemesterController
{
    private Semester $model;
    private Student $studentModel;
    private ActivityLog $activityLog;

    /** FIX: sane upper bound for a semester hour limit. */
    private const MAX_HOUR_LIMIT = 200.0;

    public function __construct()
    {
        $this->model = new Semester();
        $this->studentModel = new Student();
        $this->activityLog = new ActivityLog();
    }

    public function current(): void
    {
        json_success($this->model->current());
    }

    public function list(): void
    {
        json_success($this->model->all());
    }

    public function create(array $data, int $adminId): void
    {
        $v = (new Validator())->required($data, ['semester_name', 'start_date', 'end_date']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $data['semester_name'] = trim((string)$data['semester_name']);
        if ($data['semester_name'] === '') {
            json_error('Validation failed', 422, ['semester_name' => 'Semester name cannot be empty']);
        }
        if (mb_strlen($data['semester_name']) > 100) {
            json_error('Validation failed', 422, ['semester_name' => 'Semester name must not exceed 100 characters']);
        }

        // FIX: enforce YYYY-MM-DD before strtotime() silently mis-parses.
        foreach (['start_date', 'end_date'] as $f) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$data[$f])) {
                json_error('Validation failed', 422, [$f => 'Date must be YYYY-MM-DD']);
            }
        }

        if (strtotime($data['start_date']) >= strtotime($data['end_date'])) {
            json_error('Start date must be before end date', 422);
        }

        // FIX: cap a single semester to a reasonable span (max ~1 year).
        $spanDays = (strtotime($data['end_date']) - strtotime($data['start_date'])) / 86400;
        if ($spanDays > 400) {
            json_error('A semester cannot span more than 400 days', 422);
        }

        $limit = isset($data['student_hour_limit']) ? (float)$data['student_hour_limit'] : DEFAULT_HOUR_LIMIT;
        if ($limit <= 0 || $limit > self::MAX_HOUR_LIMIT) {
            json_error('Validation failed', 422, [
                'student_hour_limit' => 'Hour limit must be greater than 0 and at most ' . self::MAX_HOUR_LIMIT,
            ]);
        }
        $data['student_hour_limit'] = $limit;

        // FIX: reject a semester whose date range overlaps an existing one.
        foreach ($this->model->all() as $existing) {
            if ($data['start_date'] <= $existing['end_date']
                && $data['end_date'] >= $existing['start_date']) {
                json_error(
                    'This date range overlaps the existing semester "'
                    . $existing['semester_name'] . '" (' . $existing['start_date']
                    . ' to ' . $existing['end_date'] . ')',
                    409
                );
            }
        }

        $id = $this->model->create($data, $adminId);
        $this->studentModel->resetAllHours($limit);

        $this->activityLog->log($adminId, 'Created Semester', "{$data['semester_name']} ({$data['start_date']} to {$data['end_date']}), hour limit: $limit");

        json_success(['id' => $id], 'New semester created. All student hours have been reset.', 201);
    }

    public function update(int $id, array $data, int $adminId): void
    {
        $existing = $this->model->findById($id);
        if (!$existing) json_error('Semester not found', 404);

        // FIX: validate names the same way as create.
        if (isset($data['semester_name'])) {
            $data['semester_name'] = trim((string)$data['semester_name']);
            if ($data['semester_name'] === '') {
                json_error('Validation failed', 422, ['semester_name' => 'Semester name cannot be empty']);
            }
            if (mb_strlen($data['semester_name']) > 100) {
                json_error('Validation failed', 422, ['semester_name' => 'Semester name must not exceed 100 characters']);
            }
        }

        // FIX: validate date format if provided.
        foreach (['start_date', 'end_date'] as $f) {
            if (isset($data[$f]) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$data[$f])) {
                json_error('Validation failed', 422, [$f => 'Date must be YYYY-MM-DD']);
            }
        }

        $startDate = $data['start_date'] ?? $existing['start_date'];
        $endDate   = $data['end_date']   ?? $existing['end_date'];

        if (strtotime($startDate) >= strtotime($endDate)) {
            json_error('Start date must be before end date', 422);
        }

        // FIX: overlap check against other semesters.
        foreach ($this->model->all() as $other) {
            if ((int)$other['id'] === $id) continue;
            if ($startDate <= $other['end_date'] && $endDate >= $other['start_date']) {
                json_error(
                    'The new date range overlaps the existing semester "'
                    . $other['semester_name'] . '"',
                    409
                );
            }
        }

        $newLimit = isset($data['student_hour_limit'])
            ? (float)$data['student_hour_limit']
            : (float)$existing['student_hour_limit'];

        if ($newLimit <= 0 || $newLimit > self::MAX_HOUR_LIMIT) {
            json_error('Validation failed', 422, [
                'student_hour_limit' => 'Hour limit must be greater than 0 and at most ' . self::MAX_HOUR_LIMIT,
            ]);
        }
        $data['student_hour_limit'] = $newLimit;

        $this->model->update($id, $data, $adminId);

        if (abs($newLimit - (float)$existing['student_hour_limit']) > 0.001) {
            $this->studentModel->resetAllHours($newLimit);
        }

        $this->activityLog->log($adminId, 'Updated Semester', "{$existing['semester_name']} (ID: $id)");

        json_success(null, 'Semester settings updated');
    }
}