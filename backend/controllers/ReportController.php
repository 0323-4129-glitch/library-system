<?php
require_once __DIR__ . '/../models/Report.php';

class ReportController
{
    private Report $model;

    public function __construct()
    {
        $this->model = new Report();
    }

    public function list(): void
    {
        json_success($this->model->all());
    }

    public function delete(int $id): void
    {
        $report = $this->model->findById($id);
        if (!$report) {
            json_error('Report not found', 404);
        }

        if (!empty($report['file_path'])) {
            $fileName = basename($report['file_path']);
            $absolute = REPORT_PATH . $fileName;
            if (is_file($absolute)) {
                @unlink($absolute);
            }
        }

        $this->model->delete($id);
        json_success(null, 'Report deleted');
    }

    public function generate(string $type, array $data, int $generatedBy): void
    {
        if (!in_array($type, ['Daily', 'Weekly', 'Monthly', 'Yearly', 'Semester'], true)) {
            json_error('Invalid report type', 422);
        }

        // FIX: validate optional filters before touching the DB.
        $course = null;
        if (!empty($data['course'])) {
            $course = trim((string)$data['course']);
            if (mb_strlen($course) > 100) {
                json_error('Validation failed', 422, [
                    'course' => 'Course filter must not exceed 100 characters',
                ]);
            }
        }

        $year = null;
        if (!empty($data['year'])) {
            $year = trim((string)$data['year']);
            if (!in_array($year, Student::validYearLevels(), true)) {
                json_error('Validation failed', 422, [
                    'year' => 'Must be one of: ' . implode(', ', Student::validYearLevels()),
                ]);
            }
        }

        // FIX: validate explicit date range if provided.
        if (!empty($data['start_date']) || !empty($data['end_date'])) {
            if (empty($data['start_date']) || empty($data['end_date'])) {
                json_error('Validation failed', 422, [
                    'start_date' => 'Both start_date and end_date are required together',
                ]);
            }
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$data['start_date'])
                || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$data['end_date'])) {
                json_error('Validation failed', 422, [
                    'start_date' => 'Dates must be YYYY-MM-DD',
                ]);
            }
            if (strtotime($data['start_date']) > strtotime($data['end_date'])) {
                json_error('Validation failed', 422, [
                    'start_date' => 'start_date must be before or equal to end_date',
                ]);
            }
            // FIX: cap the span so a "report" doesn't scan 100 years.
            $spanDays = (strtotime($data['end_date']) - strtotime($data['start_date'])) / 86400;
            if ($spanDays > 730) {
                json_error('Validation failed', 422, [
                    'end_date' => 'Date range cannot exceed 2 years',
                ]);
            }
        }

        [$start, $end] = $this->resolveDateRange($type, $data);

        $summary       = $this->model->usageSummary($start, $end, $course, $year);
        $reservations  = $this->model->reservationSummary($start, $end, $course, $year);
        $perComputer   = $this->model->computerUsage($start, $end, $course, $year);

        $fileName = strtolower($type) . '_report_' . date('Ymd_His') . '.json';
        $absolutePath = REPORT_PATH . $fileName;
        $publicUrl    = '/uploads/reports/' . $fileName;

        if (!is_dir(REPORT_PATH)) {
            mkdir(REPORT_PATH, 0755, true);
        }

        $payload = [
            'report_type'  => $type,
            'generated_at' => date('Y-m-d H:i:s'),
            'generated_by' => $generatedBy,
            'range'        => ['start' => $start, 'end' => $end],
            'course'       => $course,
            'year'         => $year,
            'summary'      => $summary,
            'reservations' => $reservations,
            'per_computer' => $perComputer,
        ];

        $written = @file_put_contents(
            $absolutePath,
            json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );

        if ($written === false) {
            error_log('ReportController: failed to write ' . $absolutePath);
            json_error('Failed to write report file. Check that uploads/reports is writable.', 500);
        }

        $reportId = $this->model->create([
            'report_type'  => $type,
            'generated_by' => $generatedBy,
            'file_path'    => $publicUrl,
        ]);

        json_success([
            'report_id'    => $reportId,
            'type'         => $type,
            'range'        => ['start' => $start, 'end' => $end],
            'course'       => $course,
            'year'         => $year,
            'summary'      => $summary,
            'reservations' => $reservations,
            'per_computer' => $perComputer,
            'file_path'    => $publicUrl,
        ], 'Report generated');
    }

    private function resolveDateRange(string $type, array $data): array
    {
        if (!empty($data['start_date']) && !empty($data['end_date'])) {
            return [$data['start_date'], $data['end_date']];
        }

        $today = date('Y-m-d');
        switch ($type) {
            case 'Daily':
                return [$today, $today];
            case 'Weekly':
                return [date('Y-m-d', strtotime('monday this week')), date('Y-m-d', strtotime('sunday this week'))];
            case 'Monthly':
                return [date('Y-m-01'), date('Y-m-t')];
            case 'Yearly':
                return [date('Y-01-01'), date('Y-12-31')];
            case 'Semester':
                require_once __DIR__ . '/../models/Semester.php';
                $sem = (new Semester())->current();
                return $sem ? [$sem['start_date'], $sem['end_date']] : [$today, $today];
            default:
                return [$today, $today];
        }
    }
}