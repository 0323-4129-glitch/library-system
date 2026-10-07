<?php
require_once __DIR__ . '/../models/LibraryHour.php';
require_once __DIR__ . '/../models/Semester.php';
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/ActivityLog.php';

class SettingsController
{
    private LibraryHour $libraryHourModel;
    private Semester $semesterModel;
    private Student $studentModel;
    private ActivityLog $activityLog;

    /** FIX: sane upper bound on the semester hour limit. */
    private const MAX_HOUR_LIMIT = 200.0;

    public function __construct()
    {
        $this->libraryHourModel = new LibraryHour();
        $this->semesterModel = new Semester();
        $this->studentModel = new Student();
        $this->activityLog = new ActivityLog();
    }

    public function getLibraryHours(): void
    {
        json_success($this->libraryHourModel->all());
    }

    public function updateLibraryHours(array $data, int $adminId): void
    {
        $v = (new Validator())
            ->required($data, ['day'])
            ->in($data, 'day', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        if (isset($data['opening_time'])) {
            $v2 = (new Validator())->time($data, 'opening_time');
            if ($v2->fails()) json_error('Validation failed', 422, $v2->getErrors());
        }
        if (isset($data['closing_time'])) {
            $v3 = (new Validator())->time($data, 'closing_time');
            if ($v3->fails()) json_error('Validation failed', 422, $v3->getErrors());
        }

        // FIX: normalize to H:i:s so string comparisons in isCurrentlyOpen()
        // are reliable. Previously HH:MM stored here could break those
        // comparisons.
        $opening = $this->normalizeTime($data['opening_time'] ?? null);
        $closing = $this->normalizeTime($data['closing_time'] ?? null);

        // FIX: opening must be strictly before closing (no overnight hours).
        if ($opening !== null && $closing !== null && $opening >= $closing) {
            json_error('Validation failed', 422, [
                'closing_time' => 'Closing time must be after opening time',
            ]);
        }

        // FIX: if the day is marked open, both times are required.
        $isOpen = !empty($data['is_open']);
        if ($isOpen && ($opening === null || $closing === null)) {
            json_error('Validation failed', 422, [
                'opening_time' => 'Opening time is required when the library is open',
                'closing_time' => 'Closing time is required when the library is open',
            ]);
        }

        $payload = [
            'day'          => $data['day'],
            'opening_time' => $opening,
            'closing_time' => $closing,
            'is_open'      => $isOpen,
        ];

        $this->libraryHourModel->upsert($payload, $adminId);

        $open = $opening ?? 'n/a';
        $close = $closing ?? 'n/a';
        $this->activityLog->log($adminId, 'Updated Library Hours', "{$data['day']}: $open - $close");

        json_success(null, "Library hours for {$data['day']} updated");
    }

    public function getTodayLibraryHours(): void
    {
        $day = date('l');
        $hours = $this->libraryHourModel->findByDay($day);
        json_success($hours);
    }

    public function getSemester(): void
    {
        $semester = $this->semesterModel->current() ?: $this->semesterModel->latest();
        json_success($semester ?: null);
    }

    public function updateUsageLimit(array $data, int $adminId): void
    {
        $limitValue = $data['student_hour_limit'] ?? $data['hour_limit'] ?? null;
        if ($limitValue === null) {
            json_error('Validation failed', 422, ['student_hour_limit' => 'Student hour limit is required']);
        }

        $v = (new Validator())->numeric(['student_hour_limit' => $limitValue], 'student_hour_limit');
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $newLimit = (float)$limitValue;

        // FIX: enforce a sane range. Previously any numeric value (including
        // negative or absurdly large) was accepted and mass-reset every
        // student's remaining_hours.
        if ($newLimit <= 0) {
            json_error('Validation failed', 422, [
                'student_hour_limit' => 'Hour limit must be greater than 0',
            ]);
        }
        if ($newLimit > self::MAX_HOUR_LIMIT) {
            json_error('Validation failed', 422, [
                'student_hour_limit' => 'Hour limit must not exceed ' . self::MAX_HOUR_LIMIT,
            ]);
        }

        $current = $this->semesterModel->current() ?: $this->semesterModel->latest();
        if (!$current) json_error('No semester is configured yet — create one first', 404);

        // FIX: refuse to reset if the limit hasn't actually changed,
        // otherwise admins silently wipe every student's used_hours.
        if (abs((float)$current['student_hour_limit'] - $newLimit) < 0.001) {
            json_success(null, "Student usage limit is already {$newLimit} hours. No changes made.");
            return;
        }

        $this->semesterModel->update((int)$current['id'], [
            'semester_name' => $current['semester_name'],
            'start_date' => $current['start_date'],
            'end_date' => $current['end_date'],
            'student_hour_limit' => $newLimit,
        ], $adminId);

        $this->studentModel->resetAllHours($newLimit);
        $this->activityLog->log($adminId, 'Updated Usage Limit', "Student hour limit set to $newLimit");

        json_success(null, "Student usage limit set to {$newLimit} hours. All student hours have been reset.");
    }

    /** FIX: helper — normalizes "HH:MM" or "HH:MM:SS" to "HH:MM:SS", or null. */
    private function normalizeTime(?string $t): ?string
    {
        if ($t === null || $t === '') return null;
        $dt = date_create_from_format('H:i:s', $t) ?: date_create_from_format('H:i', $t);
        return $dt ? $dt->format('H:i:s') : null;
    }
}