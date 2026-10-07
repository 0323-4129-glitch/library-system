<?php
require_once __DIR__ . '/../models/Admin.php';
require_once __DIR__ . '/../models/Student.php';

class ProfileController
{
    public function get(array $user): void
    {
        if ($user['user_type'] === 'admin') {
            $record = (new Admin())->findById((int)$user['sub']);
        } else {
            $record = (new Student())->findById((int)$user['sub']);
        }

        if (!$record) {
            json_error('Profile not found', 404);
        }

        unset($record['password']);
        json_success($record, 'Profile retrieved');
    }

    public function update(array $user, array $data): void
    {
        $isAdmin = $user['user_type'] === 'admin';

        $allowed = $isAdmin
            ? ['first_name', 'middle_name', 'last_name', 'email']
            : ['first_name', 'middle_name', 'last_name', 'email', 'contact_number'];

        $filtered = array_intersect_key($data, array_flip($allowed));

        if (empty($filtered)) {
            json_error('No editable fields were provided', 422);
        }

        // FIX: trim string fields up-front so "   " never reaches the DB.
        foreach ($filtered as $k => $v) {
            if (is_string($v)) {
                $filtered[$k] = trim($v);
            }
        }

        // FIX: required-field sanity — first_name, last_name, and (when
        // present) email cannot be blank. Previously only first/last were
        // checked, and only when the key existed.
        foreach (['first_name', 'last_name'] as $required) {
            if (array_key_exists($required, $filtered) && $filtered[$required] === '') {
                json_error('Validation failed', 422, [
                    $required => ucfirst(str_replace('_', ' ', $required)) . ' cannot be empty',
                ]);
            }
        }

        // FIX: reject an empty email outright. Previously an empty string
        // slipped through the "is it changing?" check below and could be
        // written to the DB, wiping the account's email.
        if (array_key_exists('email', $filtered) && $filtered['email'] === '') {
            json_error('Validation failed', 422, [
                'email' => 'Email cannot be empty',
            ]);
        }

        // FIX: enforce a reasonable length limit on names before they hit
        // the DB column limits.
        foreach (['first_name', 'middle_name', 'last_name'] as $nameField) {
            if (isset($filtered[$nameField]) && mb_strlen($filtered[$nameField]) > 100) {
                json_error('Validation failed', 422, [
                    $nameField => ucfirst(str_replace('_', ' ', $nameField)) . ' is too long (max 100 characters)',
                ]);
            }
        }

        // FIX: contact_number — must be a plausible phone number when provided.
        if (isset($filtered['contact_number']) && $filtered['contact_number'] !== '') {
            if (!preg_match('/^[0-9+\-\s()]{7,20}$/', $filtered['contact_number'])) {
                json_error('Validation failed', 422, [
                    'contact_number' => 'Contact number must be 7–20 digits (may include + - ( ) spaces)',
                ]);
            }
        }

        $model = $isAdmin ? new Admin() : new Student();
        $existing = $model->findById((int)$user['sub']);

        if (!$existing) {
            json_error('Profile not found', 404);
        }

        // Email format + uniqueness (only when actually changing it).
        if (isset($filtered['email']) && $filtered['email'] !== '') {
            $v = (new Validator())->email($filtered, 'email');
            if ($v->fails()) {
                json_error('Validation failed', 422, $v->getErrors());
            }

            if ($filtered['email'] !== ($existing['email'] ?? null)
                && $model->emailExists($filtered['email'], (int)$user['sub'])) {
                json_error('That email address is already in use', 409);
            }
        }

        $updated = $model->update((int)$user['sub'], $filtered);

        if (!$updated) {
            json_error('No changes were made', 400);
        }

        json_success(null, 'Profile updated successfully');
    }

    public function uploadPhoto(array $user): void
    {
        if (empty($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
            $errorCode = $_FILES['photo']['error'] ?? UPLOAD_ERR_NO_FILE;
            $messages = [
                UPLOAD_ERR_INI_SIZE   => 'File exceeds upload_max_filesize',
                UPLOAD_ERR_FORM_SIZE  => 'File exceeds form MAX_FILE_SIZE',
                UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded',
                UPLOAD_ERR_NO_FILE    => 'No file was uploaded',
                UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
                UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk',
                UPLOAD_ERR_EXTENSION  => 'File upload stopped by extension',
            ];
            $msg = $messages[$errorCode] ?? 'Unknown upload error';
            json_error($msg, 422);
        }

        $file = $_FILES['photo'];

        $allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);

        if (!in_array($mime, $allowedTypes, true)) {
            json_error('Only JPEG, PNG, or WEBP images are allowed', 422);
        }

        if ($file['size'] > 5 * 1024 * 1024) {
            json_error('Photo must be under 5MB', 422);
        }

        // FIX: don't trust the client-supplied extension. Derive it from
        // the verified MIME type so a .php renamed to .jpg can never land
        // on disk with an executable extension.
        $extByMime = [
            'image/jpeg' => 'jpg',
            'image/png'  => 'png',
            'image/webp' => 'webp',
        ];
        $ext = $extByMime[$mime];

        if (!is_dir(UPLOAD_PROFILE_DIR)) {
            mkdir(UPLOAD_PROFILE_DIR, 0755, true);
        }

        $filename = $user['user_type'] . '_' . $user['sub'] . '_' . time() . '.' . $ext;
        $destination = UPLOAD_PROFILE_DIR . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            $error = error_get_last();
            $msg = $error ? $error['message'] : 'Failed to save uploaded photo';
            json_error('Failed to save photo: ' . $msg, 500);
        }

        $photoUrl = '/uploads/profile/' . $filename;

        $model = $user['user_type'] === 'admin' ? new Admin() : new Student();

        $updated = $model->update((int)$user['sub'], ['photo_url' => $photoUrl]);

        if (!$updated) {
            @unlink($destination);
            json_error('Failed to save photo URL to database. Please try again.', 500);
        }

        json_success(['photo_url' => $photoUrl], 'Photo uploaded');
    }
}