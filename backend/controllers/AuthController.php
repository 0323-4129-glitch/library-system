<?php
require_once __DIR__ . '/../models/Admin.php';
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/PasswordReset.php';
require_once __DIR__ . '/../models/LoginLog.php';

class AuthController
{
    private const KNOWN_WEAK_HASHES = [
        '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        '$2y$10$TKh8H1.PfQx37YgCzwiKb.KjNyWgaHb9cbcoQgdIVFlYg7B77UdFm',
    ];

    /** FIX: single minimum password length constant. */
    private const MIN_PASSWORD_LENGTH = 8;
    /** FIX: hard upper bound so nobody pastes a 10MB string into bcrypt. */
    private const MAX_PASSWORD_LENGTH = 200;

    /**
     * FIX: central password policy — length, mixed class, blocklist, and
     * rejection of passwords equal to an account identifier. Applied at
     * every place a new password is set.
     */
    private function assertStrongPassword(string $password, array $forbiddenValues = []): void
    {
        if (strlen($password) < self::MIN_PASSWORD_LENGTH) {
            json_error('Validation failed', 422, [
                'new_password' => 'Password must be at least ' . self::MIN_PASSWORD_LENGTH . ' characters',
            ]);
        }
        if (strlen($password) > self::MAX_PASSWORD_LENGTH) {
            json_error('Validation failed', 422, [
                'new_password' => 'Password is too long (max ' . self::MAX_PASSWORD_LENGTH . ' characters)',
            ]);
        }

        $hasLetter = preg_match('/[A-Za-z]/', $password) === 1;
        $hasDigit  = preg_match('/[0-9]/', $password) === 1;
        if (!$hasLetter || !$hasDigit) {
            json_error('Validation failed', 422, [
                'new_password' => 'Password must include at least one letter and one digit',
            ]);
        }

        $lower = strtolower($password);
        $blocklist = ['password', '12345678', 'qwerty123', 'admin123', 'letmein123', 'password1'];
        if (in_array($lower, $blocklist, true)) {
            json_error('Validation failed', 422, [
                'new_password' => 'That password is too common. Please choose another.',
            ]);
        }

        foreach ($forbiddenValues as $fv) {
            if ($fv !== '' && strcasecmp($password, (string)$fv) === 0) {
                json_error('Validation failed', 422, [
                    'new_password' => 'Password cannot match your Student ID, Employee ID, or email',
                ]);
            }
        }
    }

    private function rejectIfCompromisedHash(array $record): void
    {
        if (in_array($record['password'] ?? '', self::KNOWN_WEAK_HASHES, true)) {
            json_error(
                'This account\'s password is publicly known and has been locked for your protection. '
              . 'Please use the "Forgot Password" flow to set a new password, then try again.',
                403
            );
        }
    }

    public function adminLogin(array $data): void
    {
        $identifier = trim((string)($data['email_or_employee_id'] ?? $data['email'] ?? ''));
        $password   = (string)($data['password'] ?? '');

        if ($identifier === '' || $password === '') {
            json_error('Validation failed', 422, [
                'email_or_employee_id' => 'Email or Employee ID is required',
                'password'             => 'Password is required',
            ]);
        }

        // FIX: cap the identifier length to avoid giant DB lookups.
        if (mb_strlen($identifier) > 200 || mb_strlen($password) > self::MAX_PASSWORD_LENGTH) {
            json_error('Invalid credentials', 401);
        }

        $adminModel = new Admin();
        $admin = null;

        if (filter_var($identifier, FILTER_VALIDATE_EMAIL)) {
            $admin = $adminModel->findByEmail($identifier);
        } else {
            $admin = $adminModel->findByEmployeeId($identifier);
        }

        if (!$admin || !verify_password($password, $admin['password'])) {
            json_error('Invalid credentials', 401);
        }

        $this->rejectIfCompromisedHash($admin);

        if ($admin['status'] !== STATUS_ACTIVE) {
            json_error('This account has been deactivated.', 403);
        }

        $loginLogModel = new LoginLog();
        $active = $loginLogModel->activeWebLogin('Admin', (int)$admin['id'], SESSION_TIMEOUT);
        $force  = !empty($data['force_login']);

        if ($active && !$force) {
            json_error(
                'This admin account is already logged in on another device. '
              . 'Log out from that device first, or resend this request with '
              . 'force_login: true to sign it out and continue here.',
                409,
                ['active_login_ip' => $active['ip_address'] ?? 'unknown']
            );
        }

        if ($active && $force) {
            $loginLogModel->closeAllWebLogins('Admin', (int)$admin['id']);
        }

        $loginLogId = Logger::login('Admin', (int)$admin['id']);
        $token = Jwt::encode([
            'sub'          => (int)$admin['id'],
            'user_type'    => 'admin',
            'role'         => 'admin',
            'login_log_id' => $loginLogId,
        ]);

        unset($admin['password']);
        json_success(['token' => $token, 'admin' => $admin], 'Login successful');
    }

    public function studentLogin(array $data): void
    {
        $studentId = trim((string)($data['student_id'] ?? ''));
        $password  = (string)($data['password'] ?? '');

        if ($studentId === '' || $password === '') {
            json_error('Validation failed', 422, [
                'student_id' => 'Student ID is required',
                'password'   => 'Password is required',
            ]);
        }

        // FIX: sane upper bounds.
        if (mb_strlen($studentId) > 100 || mb_strlen($password) > self::MAX_PASSWORD_LENGTH) {
            json_error('Invalid Student ID or password', 401);
        }

        $studentModel = new Student();
        $student = $studentModel->findByStudentId($studentId);

        if (!$student || !verify_password($password, $student['password'])) {
            json_error('Invalid Student ID or password', 401);
        }

        $this->rejectIfCompromisedHash($student);

        if ($student['status'] !== STATUS_ACTIVE) {
            json_error('This account has been deactivated. Please see the library staff.', 403);
        }

        $loginLogModel = new LoginLog();
        $active = $loginLogModel->activeWebLogin('Student', (int)$student['id'], SESSION_TIMEOUT);
        $force  = !empty($data['force_login']);

        if ($active && !$force) {
            json_error(
                'Your account is already logged in on another device. '
              . 'Log out from that device first, or confirm on this device to '
              . 'sign the other one out and continue here.',
                409,
                ['active_login_ip' => $active['ip_address'] ?? 'unknown']
            );
        }

        if ($active && $force) {
            $loginLogModel->closeAllWebLogins('Student', (int)$student['id']);
        }

        $loginLogId = Logger::login('Student', (int)$student['id']);
        $token = Jwt::encode([
            'sub'          => (int)$student['id'],
            'user_type'    => 'student',
            'role'         => 'student',
            'login_log_id' => $loginLogId,
        ]);

        unset($student['password']);
        json_success([
            'token'                => $token,
            'student'              => $student,
            'must_change_password' => (bool)$student['must_change_password'],
        ], 'Login successful');
    }

    public function logout(array $user): void
    {
        if (!empty($user['login_log_id'])) {
            Logger::logout((int)$user['login_log_id']);
        }
        json_success(null, 'Logged out successfully');
    }

    public function forgotPassword(array $data): void
    {
        $v = (new Validator())->required($data, ['user_type']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $userType = (string)$data['user_type'];
        if (!in_array($userType, ['Admin', 'Student'], true)) {
            json_error('Validation failed', 422, ['user_type' => 'Must be Admin or Student']);
        }

        $resetModel = new PasswordReset();

        if ($userType === 'Admin') {
            $v2 = (new Validator())->required($data, ['email'])->email($data, 'email');
            if ($v2->fails()) json_error('Email required', 422, $v2->getErrors());
            $admin = (new Admin())->findByEmail(trim((string)$data['email']));
            if (!$admin) json_success(null, 'If that account exists, a reset link has been generated.');
            $token = $resetModel->create('Admin', (int)$admin['id'])['token'];
        } else {
            $v2 = (new Validator())->required($data, ['student_id']);
            if ($v2->fails()) json_error('Student ID required', 422, $v2->getErrors());
            $student = (new Student())->findByStudentId(trim((string)$data['student_id']));
            if (!$student) json_success(null, 'If that account exists, a reset link has been generated.');
            $token = $resetModel->create('Student', (int)$student['id'])['token'];
        }

        json_success(['reset_token' => $token], 'Password reset token generated.');
    }

    public function resetPassword(array $data): void
    {
        $v = (new Validator())
            ->required($data, ['token', 'new_password'])
            ->minLength($data, 'new_password', self::MIN_PASSWORD_LENGTH);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $resetModel = new PasswordReset();
        $reset = $resetModel->findValidToken((string)$data['token']);
        if (!$reset) json_error('Invalid or expired reset token', 400);

        if ($reset['user_type'] === 'Admin') {
            $record = (new Admin())->findById((int)$reset['user_id']);
            $forbidden = $record ? [$record['employee_id'] ?? '', $record['email'] ?? ''] : [];
            $this->assertStrongPassword((string)$data['new_password'], $forbidden);
            (new Admin())->updatePassword((int)$reset['user_id'], hash_password($data['new_password']));
        } else {
            $record = (new Student())->findById((int)$reset['user_id']);
            $forbidden = $record ? [$record['student_id'] ?? '', $record['email'] ?? ''] : [];
            $this->assertStrongPassword((string)$data['new_password'], $forbidden);
            (new Student())->updatePassword((int)$reset['user_id'], hash_password($data['new_password']), false);
        }

        $resetModel->invalidate((int)$reset['id']);
        json_success(null, 'Password has been reset. You may now log in.');
    }

    public function changePassword(array $user, array $data): void
    {
        $v = (new Validator())
            ->required($data, ['current_password', 'new_password'])
            ->minLength($data, 'new_password', self::MIN_PASSWORD_LENGTH);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        // FIX: new password must differ from current.
        if ((string)$data['current_password'] === (string)$data['new_password']) {
            json_error('Validation failed', 422, [
                'new_password' => 'New password must be different from your current password',
            ]);
        }

        if ($user['user_type'] === 'admin') {
            $model = new Admin();
            $record = $model->findById((int)$user['sub']);
            if (!$record || !verify_password($data['current_password'], $record['password'])) {
                json_error('Current password is incorrect', 422);
            }
            $this->assertStrongPassword(
                (string)$data['new_password'],
                [$record['employee_id'] ?? '', $record['email'] ?? '']
            );
            $model->updatePassword((int)$user['sub'], hash_password($data['new_password']));
        } else {
            $model = new Student();
            $record = $model->findById((int)$user['sub']);
            if (!$record || !verify_password($data['current_password'], $record['password'])) {
                json_error('Current password is incorrect', 422);
            }
            $this->assertStrongPassword(
                (string)$data['new_password'],
                [$record['student_id'] ?? '', $record['email'] ?? '']
            );
            $model->updatePassword((int)$user['sub'], hash_password($data['new_password']), false);
        }

        json_success(null, 'Password changed successfully');
    }
}