<?php
require_once __DIR__ . '/../models/Computer.php';
require_once __DIR__ . '/../models/SessionModel.php';
require_once __DIR__ . '/../models/ActivityLog.php';

class ComputerController
{
    private Computer $model;
    private SessionModel $sessionModel;
    private ActivityLog $activityLog;

    /** FIX: same hostname regex the kiosk register() uses. */
    private const COMPUTER_NUMBER_PATTERN = '/^[A-Za-z0-9\-_\.]{1,20}$/';

    public function __construct()
    {
        $this->model = new Computer();
        $this->sessionModel = new SessionModel();
        $this->activityLog = new ActivityLog();
    }

    public function list(): void
    {
        json_success($this->model->all());
    }

    public function get(int $id): void
    {
        $computer = $this->model->findById($id);
        if (!$computer) json_error('Computer not found', 404);
        json_success($computer);
    }

    public function history(int $id): void
    {
        if (!$this->model->findById($id)) json_error('Computer not found', 404);
        json_success($this->model->history($id));
    }

    public function liveMonitoring(): void
    {
        json_success($this->model->liveMonitoring());
    }

    public function create(array $data, int $adminId): void
    {
        $v = (new Validator())->required($data, ['computer_number']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        // FIX: normalize + validate format/length before touching the DB.
        $number = trim((string)$data['computer_number']);
        if (!preg_match(self::COMPUTER_NUMBER_PATTERN, $number)) {
            json_error('Validation failed', 422, [
                'computer_number' => 'Computer number must be 1–20 characters (letters, digits, dash, underscore, dot)',
            ]);
        }
        $data['computer_number'] = $number;

        // FIX: cap the optional display name.
        if (!empty($data['computer_name'])) {
            $data['computer_name'] = trim((string)$data['computer_name']);
            if (mb_strlen($data['computer_name']) > 100) {
                json_error('Validation failed', 422, [
                    'computer_name' => 'Computer name must not exceed 100 characters',
                ]);
            }
        }

        // FIX: whitelist status if a client tries to supply one.
        if (isset($data['status'])
            && !in_array($data['status'], [
                COMPUTER_AVAILABLE, COMPUTER_OCCUPIED,
                COMPUTER_RESERVED, COMPUTER_MAINTENANCE,
            ], true)) {
            json_error('Validation failed', 422, ['status' => 'Invalid computer status']);
        }

        if ($this->model->findByNumber($data['computer_number'])) {
            json_error('A computer with this number already exists', 409);
        }

        $id = $this->model->create($data);

        $this->activityLog->log($adminId, 'Added Computer', "Computer #{$data['computer_number']}");

        json_success(['id' => $id], 'Computer added', 201);
    }

    public function update(int $id, array $data, int $adminId): void
    {
        $existing = $this->model->findById($id);
        if (!$existing) json_error('Computer not found', 404);

        // FIX: validate and normalize the new computer_number if provided.
        if (!empty($data['computer_number'])) {
            $number = trim((string)$data['computer_number']);
            if (!preg_match(self::COMPUTER_NUMBER_PATTERN, $number)) {
                json_error('Validation failed', 422, [
                    'computer_number' => 'Computer number must be 1–20 characters (letters, digits, dash, underscore, dot)',
                ]);
            }
            $data['computer_number'] = $number;

            if ($number !== $existing['computer_number']) {
                $collision = $this->model->findByNumber($number);
                if ($collision && (int)$collision['id'] !== $id) {
                    json_error('A computer with this number already exists', 409);
                }
            }
        }

        // FIX: cap computer_name length if provided.
        if (array_key_exists('computer_name', $data)) {
            $data['computer_name'] = $data['computer_name'] === null
                ? null
                : trim((string)$data['computer_name']);
            if ($data['computer_name'] !== null && mb_strlen($data['computer_name']) > 100) {
                json_error('Validation failed', 422, [
                    'computer_name' => 'Computer name must not exceed 100 characters',
                ]);
            }
        }

        $this->model->update($id, $data);

        $this->activityLog->log($adminId, 'Updated Computer', "Computer #{$existing['computer_number']} (ID: $id)");

        json_success(null, 'Computer updated');
    }

    public function setMaintenance(int $id, bool $underMaintenance, int $adminId): void
    {
        $computer = $this->model->findById($id);
        if (!$computer) json_error('Computer not found', 404);

        if ($underMaintenance) {
            if ($this->sessionModel->activeByComputer($id)) {
                json_error('Cannot set this computer to maintenance while a session is active on it', 409);
            }
            $this->model->setStatus($id, COMP_MAINTENANCE);
            $this->activityLog->log($adminId, 'Set Computer to Maintenance', "Computer #{$computer['computer_number']}");
            json_success(null, 'Computer set to maintenance');
        } else {
            $this->model->setStatus($id, COMPUTER_AVAILABLE);
            $this->model->recomputeStatus($id);
            $this->activityLog->log($adminId, 'Removed Computer from Maintenance', "Computer #{$computer['computer_number']}");
            json_success(null, 'Computer removed from maintenance');
        }
    }

    public function delete(int $id, int $adminId): void
    {
        $computer = $this->model->findById($id);
        if (!$computer) json_error('Computer not found', 404);

        if ($this->sessionModel->activeByComputer($id)) {
            json_error('Cannot delete a computer with an active session', 409);
        }

        if (!$this->model->delete($id)) {
            json_error(
                'Cannot delete this computer — it has historical session or reservation records. '
              . 'Mark it as maintenance instead.',
                409
            );
        }

        $this->activityLog->log($adminId, 'Deleted Computer', "Computer #{$computer['computer_number']}");

        json_success(null, 'Computer deleted');
    }
}