<?php
require_once __DIR__ . '/../models/Concern.php';
require_once __DIR__ . '/../models/Notification.php';

class ConcernController
{
    private Concern $model;

    /** FIX: caps so a single concern/reply can't balloon the DB. */
    private const MAX_SUBJECT_LEN = 200;
    private const MAX_MESSAGE_LEN = 5000;

    public function __construct()
    {
        $this->model = new Concern();
    }

    public function create(int $studentId, array $data): void
    {
        $v = (new Validator())
            ->required($data, ['subject', 'message'])
            ->maxLength($data, 'subject', self::MAX_SUBJECT_LEN)
            ->maxLength($data, 'message', self::MAX_MESSAGE_LEN);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $subject = trim((string)$data['subject']);
        $message = trim((string)$data['message']);
        if ($subject === '' || $message === '') {
            json_error('Subject and message are required', 422);
        }

        $concernId = $this->model->create($studentId, $subject, $message);

        $db = Database::getConnection();
        $admins = $db->query("SELECT id FROM admins WHERE status='Active'")->fetchAll(PDO::FETCH_COLUMN);
        $notif = new Notification();
        foreach ($admins as $adminId) {
            $notif->send('Admin', (int)$adminId, 'New concern from a student', "Subject: {$subject}", 'concern');
        }

        json_success(['id' => $concernId], 'Concern submitted. The librarian will respond shortly.', 201);
    }

    public function list(): void
    {
        $status = $_GET['status'] ?? null;
        // FIX: whitelist query-string status.
        if ($status !== null && !in_array($status, ['Open', 'Replied', 'Resolved'], true)) {
            json_error('Validation failed', 422, ['status' => 'Invalid status filter']);
        }
        json_success($this->model->all($status ?: null));
    }

    public function forStudent(int $studentId): void
    {
        json_success($this->model->byStudent($studentId));
    }

    public function get(int $id, array $user): void
    {
        $concern = $this->model->findById($id);
        if (!$concern) json_error('Concern not found', 404);

        if ($user['user_type'] === 'student' && (int)$concern['student_id'] !== (int)$user['sub']) {
            json_error('You do not have permission to view this concern', 403);
        }

        json_success([
            'concern'  => $concern,
            'messages' => $this->model->messages($id),
        ]);
    }

    public function reply(int $id, array $user, array $data): void
    {
        $v = (new Validator())->required($data, ['message']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $message = trim((string)$data['message']);
        if ($message === '') json_error('Message cannot be empty', 422);

        // FIX: cap reply length.
        if (mb_strlen($message) > self::MAX_MESSAGE_LEN) {
            json_error('Validation failed', 422, [
                'message' => 'Message must not exceed ' . self::MAX_MESSAGE_LEN . ' characters',
            ]);
        }

        $concern = $this->model->findById($id);
        if (!$concern) json_error('Concern not found', 404);

        if ($user['user_type'] === 'student' && (int)$concern['student_id'] !== (int)$user['sub']) {
            json_error('You can only reply to your own concerns', 403);
        }

        // FIX: don't allow replies to a resolved concern (reopens silently).
        if ($concern['status'] === 'Resolved') {
            json_error('This concern has been resolved. Please open a new concern if you need further help.', 409);
        }

        $senderType = $user['user_type'] === 'student' ? 'Student' : 'Admin';
        $this->model->addMessage($id, $senderType, (int)$user['sub'], $message);

        if ($senderType === 'Admin') {
            (new Notification())->send(
                'Student',
                (int)$concern['student_id'],
                'Reply to your concern',
                "Subject: {$concern['subject']}",
                'concern'
            );
        } else {
            $db = Database::getConnection();
            $admins = $db->query("SELECT id FROM admins WHERE status='Active'")->fetchAll(PDO::FETCH_COLUMN);
            $notif = new Notification();
            foreach ($admins as $adminId) {
                $notif->send(
                    'Admin',
                    (int)$adminId,
                    'New reply on a concern',
                    "Subject: {$concern['subject']}",
                    'concern'
                );
            }
        }

        json_success(null, 'Reply sent');
    }

    public function setStatus(int $id, array $data): void
    {
        $status = $data['status'] ?? '';
        if (!in_array($status, ['Open', 'Replied', 'Resolved'], true)) {
            json_error('Invalid status', 422);
        }
        $concern = $this->model->findById($id);
        if (!$concern) json_error('Concern not found', 404);

        $this->model->setStatus($id, $status);
        json_success(null, "Concern marked {$status}");
    }

    public function openCount(): void
    {
        json_success(['open' => $this->model->openCount()]);
    }
}