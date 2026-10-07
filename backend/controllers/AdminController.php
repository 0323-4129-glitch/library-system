<?php
require_once __DIR__ . '/../models/Admin.php';
require_once __DIR__ . '/../models/ActivityLog.php';

class AdminController
{
    private Admin $model;
    private ActivityLog $activityLog;

    /** FIX: whitelist of fields that can be updated by the edit form. */
    private const EDITABLE_FIELDS = [
        'employee_id', 'first_name', 'middle_name', 'last_name', 'email', 'status',
    ];

    private const MIN_PASSWORD_LENGTH = 8;

    public function __construct()
    {
        $this->model = new Admin();
        $this->activityLog = new ActivityLog();
    }

    public function list(): void
    {
        json_success($this->model->all());
    }

    public function get(int $id): void
    {
        $admin = $this->model->findById($id);
        if (!$admin) json_error('Admin account not found', 404);
        unset($admin['password']);
        json_success($admin);
    }

    public function create(array $data, int $adminId): void
    {
        // FIX: trim string fields first so whitespace-only values fail
        // the required check instead of slipping through.
        foreach (['first_name', 'middle_name', 'last_name', 'email', 'employee_id', 'password'] as $f) {
            if (isset($data[$f]) && is_string($data[$f])) {
                $data[$f] = trim($data[$f]);
            }
        }

        $v = (new Validator())
            ->required($data, ['first_name', 'last_name', 'email', 'password'])
            ->email($data, 'email')
            ->minLength($data, 'password', self::MIN_PASSWORD_LENGTH);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        // FIX: enforce name length limits before DB column cutoffs.
        foreach (['first_name', 'middle_name', 'last_name'] as $f) {
            if (isset($data[$f]) && mb_strlen($data[$f]) > 100) {
                json_error('Validation failed', 422, [
                    $f => ucfirst(str_replace('_', ' ', $f)) . ' is too long (max 100 characters)',
                ]);
            }
        }

        // FIX: Employee ID format — if provided, must be alphanumeric + dash.
        if (!empty($data['employee_id'])) {
            if (!preg_match('/^[A-Za-z0-9\-]{3,30}$/', $data['employee_id'])) {
                json_error('Validation failed', 422, [
                    'employee_id' => 'Employee ID must be 3–30 characters (letters, digits, dashes only)',
                ]);
            }
        }

        if ($this->model->findByEmail($data['email'])) {
            json_error('An account with this email already exists', 409);
        }
        if (!empty($data['employee_id']) && $this->model->findByEmployeeId($data['employee_id'])) {
            json_error('An account with this Employee ID already exists', 409);
        }

        $data['password'] = hash_password($data['password']);
        $data['role'] = 'admin';

        $id = $this->model->create($data);

        $this->activityLog->log($adminId, 'Created Admin Account', "{$data['first_name']} {$data['last_name']} ({$data['email']})");

        json_success(['id' => $id], 'Admin account created', 201);
    }

    public function update(int $id, array $data, int $adminId): void
    {
        $existing = $this->model->findById($id);
        if (!$existing) json_error('Admin account not found', 404);

        // FIX: strip any non-editable fields up-front. This also removes
        // role/password/status tampering attempts in one place.
        $filtered = array_intersect_key($data, array_flip(self::EDITABLE_FIELDS));

        if (empty($filtered)) {
            json_error('No editable fields were provided', 422);
        }

        // FIX: trim strings.
        foreach ($filtered as $k => $v) {
            if (is_string($v)) {
                $filtered[$k] = trim($v);
            }
        }

        // FIX: reject blank names when provided.
        foreach (['first_name', 'last_name'] as $required) {
            if (array_key_exists($required, $filtered) && $filtered[$required] === '') {
                json_error('Validation failed', 422, [
                    $required => ucfirst($required) . ' cannot be empty',
                ]);
            }
        }

        // FIX: reject empty email, validate format, check uniqueness.
        if (array_key_exists('email', $filtered)) {
            if ($filtered['email'] === '') {
                json_error('Validation failed', 422, ['email' => 'Email cannot be empty']);
            }
            if ($filtered['email'] !== $existing['email']) {
                $v = (new Validator())->email($filtered, 'email');
                if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

                if ($this->model->emailExists($filtered['email'], $id)) {
                    json_error('An account with this email already exists', 409);
                }
            }
        }

        // FIX: employee_id format + uniqueness.
        if (array_key_exists('employee_id', $filtered) && $filtered['employee_id'] !== '') {
            if (!preg_match('/^[A-Za-z0-9\-]{3,30}$/', $filtered['employee_id'])) {
                json_error('Validation failed', 422, [
                    'employee_id' => 'Employee ID must be 3–30 characters (letters, digits, dashes only)',
                ]);
            }
            if ($filtered['employee_id'] !== ($existing['employee_id'] ?? null)) {
                $collision = $this->model->findByEmployeeId($filtered['employee_id']);
                if ($collision && (int)$collision['id'] !== $id) {
                    json_error('An account with this Employee ID already exists', 409);
                }
            }
        }

        // FIX: status whitelist.
        if (array_key_exists('status', $filtered)
            && !in_array($filtered['status'], [STATUS_ACTIVE, STATUS_INACTIVE], true)) {
            json_error('Validation failed', 422, [
                'status' => 'Status must be ' . STATUS_ACTIVE . ' or ' . STATUS_INACTIVE,
            ]);
        }

        $this->model->update($id, $filtered);

        $this->activityLog->log($adminId, 'Updated Admin Account', "{$existing['first_name']} {$existing['last_name']} (ID: $id)");

        json_success(null, 'Admin account updated');
    }

    public function setStatus(int $id, string $status, int $adminId): void
    {
        if (!in_array($status, [STATUS_ACTIVE, STATUS_INACTIVE], true)) {
            json_error('Invalid status value', 422);
        }
        $admin = $this->model->findById($id);
        if (!$admin) json_error('Admin account not found', 404);

        $this->model->setStatus($id, $status);

        $this->activityLog->log($adminId, 'Changed Admin Status', "{$admin['first_name']} {$admin['last_name']} (ID: $id) set to $status");

        json_success(null, "Admin status set to $status");
    }

    public function delete(int $id, int $adminId): void
    {
        $admin = $this->model->findById($id);
        if (!$admin) json_error('Admin account not found', 404);

        if ($id === $adminId) {
            json_error('You cannot delete your own account.', 403);
        }

        // FIX: prevent deleting the last active admin — otherwise the
        // system becomes unmanageable.
        if ($admin['status'] === STATUS_ACTIVE) {
            $remainingActive = 0;
            foreach ($this->model->all() as $row) {
                if ((int)$row['id'] !== $id && ($row['status'] ?? '') === STATUS_ACTIVE) {
                    $remainingActive++;
                    break;
                }
            }
            if ($remainingActive === 0) {
                json_error(
                    'Cannot delete the last active admin account. Promote or create another admin first.',
                    409
                );
            }
        }

        if (!$this->model->delete($id)) {
            json_error(
                'This admin account has linked records (activity logs or generated reports) '
              . 'and cannot be deleted. Deactivate the account instead.',
                409
            );
        }

        $this->activityLog->log($adminId, 'Deleted Admin Account', "{$admin['first_name']} {$admin['last_name']} ({$admin['email']})");

        json_success(null, 'Admin account deleted');
    }
}