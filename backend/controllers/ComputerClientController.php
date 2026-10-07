<?php
require_once __DIR__ . '/../models/Student.php';
require_once __DIR__ . '/../models/Computer.php';
require_once __DIR__ . '/../models/SessionModel.php';
require_once __DIR__ . '/../models/Reservation.php';
require_once __DIR__ . '/../models/LoginLog.php';
require_once __DIR__ . '/../models/ActivityLog.php';
require_once __DIR__ . '/../models/LibraryHour.php';

class ComputerClientController
{
    private Student $studentModel;
    private Computer $computerModel;
    private SessionModel $sessionModel;
    private Reservation $reservationModel;
    private LoginLog $loginLogModel;
    private LibraryHour $libraryHourModel;

    public function __construct()
    {
        $this->studentModel = new Student();
        $this->computerModel = new Computer();
        $this->sessionModel = new SessionModel();
        $this->reservationModel = new Reservation();
        $this->loginLogModel = new LoginLog();
        $this->libraryHourModel = new LibraryHour();
    }

    /** Extract the raw bearer token from the Authorization header. */
    private function bearerToken(): string
    {
        $headers = function_exists('getallheaders') ? getallheaders() : [];
        $auth = $headers['Authorization'] ?? $headers['authorization'] ?? '';
        if (stripos($auth, 'Bearer ') === 0) {
            return substr($auth, 7);
        }
        return '';
    }

    public function login(array $data): void
    {
        $v = (new Validator())->required($data, ['student_id', 'password', 'computer_number']);
        if ($v->fails()) json_error('Validation failed', 422, $v->getErrors());

        $studentId      = trim((string)$data['student_id']);
        $password       = (string)$data['password'];
        $computerNumber = trim((string)$data['computer_number']);

        if ($studentId === '' || $password === '' || $computerNumber === '') {
            json_error('Validation failed', 422, [
                'student_id'      => 'Student ID is required',
                'password'        => 'Password is required',
                'computer_number' => 'Computer number is required',
            ]);
        }

        if (mb_strlen($studentId) > 100 || mb_strlen($computerNumber) > 20) {
            json_error('Invalid credentials', 401);
        }

        // Sweep expired no-shows before making any availability decisions.
        $this->reservationModel->expireNoShows();

        $student = $this->studentModel->findByStudentId($studentId);
        if (!$student || !verify_password($password, $student['password'])) {
            json_error('Invalid Student ID or password', 401);
        }
        if ($student['status'] !== STATUS_ACTIVE) {
            json_error('Account is deactivated', 403);
        }
        if ((float)$student['remaining_hours'] <= 0) {
            json_error('No remaining library hours this semester', 403);
        }

        if ($this->sessionModel->activeByStudent((int)$student['id'])) {
            json_error('This student already has an active session on another computer', 409);
        }

        $computer = $this->computerModel->findByNumber($computerNumber);
        if (!$computer) json_error('Unregistered computer', 404);

        // Refresh the computer's status from ground truth before deciding.
        $this->computerModel->recomputeStatus((int)$computer['id']);
        $computer = $this->computerModel->findById((int)$computer['id']);

        if ($computer['status'] === COMP_MAINTENANCE) {
            json_error('This computer is under maintenance', 409);
        }
        if ($computer['status'] === COMP_OCCUPIED
            || $this->sessionModel->activeByComputer((int)$computer['id'])) {
            json_error('This computer already has an active session', 409);
        }

        // Library-hours gate.
        if (!$this->libraryHourModel->isCurrentlyOpen(date('l'), date('H:i:s'))) {
            json_error('The library is currently closed. Please try again during opening hours.', 403);
        }

        // Is there an Approved reservation covering RIGHT NOW?
        $today = date('Y-m-d');
        $now   = date('H:i:s');
        $stmt = Database::getConnection()->prepare(
            "SELECT * FROM reservations
             WHERE computer_id = :cid
               AND status = 'Approved'
               AND reservation_date = :today
               AND :now BETWEEN start_time AND end_time
             LIMIT 1"
        );
        $stmt->execute(['cid' => $computer['id'], 'today' => $today, 'now' => $now]);
        $activeReservation = $stmt->fetch();

        $sessionType = 'Walk-in';
        $reservationId = null;

        if ($activeReservation) {
            if ((int)$activeReservation['student_id'] !== (int)$student['id']) {
                json_error('This computer is reserved for another student at this time', 409);
            }
            $sessionType = 'Reservation';
            $reservationId = (int)$activeReservation['id'];
        } elseif ($computer['status'] === COMP_RESERVED) {
            $holdSeconds = max(60, ((int)RESERVATION_HOLD_MINUTES) * 60);
            $stmt = Database::getConnection()->prepare(
                "SELECT * FROM reservations
                 WHERE computer_id = :cid
                   AND status = 'Approved'
                   AND reservation_date = CURDATE()
                   AND end_time >= CURTIME()
                   AND start_time <= ADDTIME(CURTIME(), SEC_TO_TIME({$holdSeconds}))
                 ORDER BY start_time ASC
                 LIMIT 1"
            );
            $stmt->execute(['cid' => $computer['id']]);
            $upcoming = $stmt->fetch();

            if (!$upcoming || (int)$upcoming['student_id'] !== (int)$student['id']) {
                json_error('This computer is reserved for another student starting soon', 409);
            }
            $sessionType = 'Reservation';
            $reservationId = (int)$upcoming['id'];
        }

        $started = $this->sessionModel->start(
            (int)$student['id'],
            (int)$computer['id'],
            $reservationId,
            $sessionType
        );
        $sessionId      = $started['id'];
        $sessionToken   = $started['token'];
        $sessionMinutes = $started['minutes'];

        $this->computerModel->setStatus((int)$computer['id'], COMP_OCCUPIED);

        $activityLog = new ActivityLog();
        $activityLog->logStudentLogin(
            $student['first_name'] . ' ' . $student['last_name'],
            $computer['computer_number']
        );

        Logger::login('Student', (int)$student['id'], $sessionId, (int)$computer['id']);

        $this->studentModel->update((int)$student['id'], ['last_login' => date('Y-m-d H:i:s')]);

        $computer = $this->computerModel->findById((int)$computer['id']);
        unset($student['password']);

        // The response tells the kiosk exactly how long the session is
        // allowed to run (per-session, server-set). The kiosk renders its
        // countdown from this value — NOT from the student's semester
        // budget — so it matches the admin's "Live Session → Remaining".
        json_success([
            'session_id'             => $sessionId,
            'session_token'          => $sessionToken,
            'student'                => $student,
            'computer'               => $computer,
            'session_type'           => $sessionType,
            'remaining_time_minutes' => $sessionMinutes,
            'session_started_at'     => date('Y-m-d H:i:s'),
        ], 'Session started');
    }

    public function logout(int $sessionId, string $endedBy = 'student'): void
    {
        $session = $this->sessionModel->findById($sessionId);
        if (!$session) json_error('Session not found', 404);

        $presented = $this->bearerToken();
        if (empty($session['session_token'])
            || $presented === ''
            || !hash_equals((string)$session['session_token'], $presented)) {
            json_error('Invalid or missing session token', 401);
        }

        if ($session['status'] !== 'Active') {
            json_error('This session has already been ended', 409);
        }

        if (!in_array($endedBy, ['student', 'admin', 'system', 'timeout'], true)) {
            $endedBy = 'student';
        }

        $minutes = $this->sessionModel->end($sessionId, $endedBy);
        if ($minutes === false) {
            json_error('This session has already been ended', 409);
        }

        if ($minutes > 0) {
            $this->studentModel->deductHours((int)$session['student_id'], round($minutes / 60, 4));
        }

        $this->computerModel->recomputeStatus((int)$session['computer_id']);

        if (!empty($session['reservation_id'])) {
            $this->reservationModel->markCompleted((int)$session['reservation_id']);
        }

        $openLog = $this->loginLogModel->openSession('Student', (int)$session['student_id'], true);
        if ($openLog) {
            Logger::logout((int)$openLog['id']);
        }

        $student = $this->studentModel->findById((int)$session['student_id']);
        $computer = $this->computerModel->findById((int)$session['computer_id']);
        if ($student && $computer) {
            $activityLog = new ActivityLog();
            $activityLog->logStudentLogout(
                $student['first_name'] . ' ' . $student['last_name'],
                $computer['computer_number']
            );
        }

        json_success(['duration_minutes' => $minutes], 'Session ended, computer locked');
    }

    public function sessionStatus(int $sessionId): void
    {
        $session = $this->sessionModel->findById($sessionId);
        if (!$session) {
            json_error('Session not found', 404);
        }

        $presented = $this->bearerToken();
        if (empty($session['session_token'])
            || $presented === ''
            || !hash_equals((string)$session['session_token'], $presented)) {
            json_error('Invalid or missing session token', 401);
        }

        json_success([
            'active'      => $session['status'] === 'Active',
            'status'      => $session['status'],
            'ended_by'    => $session['ended_by'] ?? null,
            'logout_time' => $session['logout_time'] ?? null,
        ]);
    }

    public function checkUpcomingReservation(int $computerId): void
    {
        $presented = $this->bearerToken();
        if ($presented === '') {
            json_error('Session token required', 401);
        }

        $current = $this->sessionModel->activeByComputer($computerId);
        if (!$current
            || empty($current['session_token'])
            || !hash_equals((string)$current['session_token'], $presented)) {
            json_error('Invalid or missing session token', 401);
        }

        $stmt = Database::getConnection()->prepare(
            "SELECT r.reservation_date, r.start_time, s.first_name, s.last_name
             FROM reservations r
             INNER JOIN students s ON r.student_id = s.id
             WHERE r.computer_id = :computer_id
               AND r.status = 'Approved'
               AND r.reservation_date = CURDATE()
               AND r.start_time > CURTIME()
             ORDER BY r.start_time ASC
             LIMIT 1"
        );
        $stmt->execute(['computer_id' => $computerId]);
        $reservation = $stmt->fetch();

        if (!$reservation) {
            json_success(['has_upcoming' => false]);
            return;
        }

        $startDateTime = $reservation['reservation_date'] . 'T' . $reservation['start_time'];

        json_success([
            'has_upcoming' => true,
            'reservation'  => [
                'start_time'   => $startDateTime,
                'student_name' => trim($reservation['first_name'] . ' ' . $reservation['last_name']),
            ],
        ]);
    }

    public function listForClient(): void
    {
        $rows = array_map(static fn(array $c): array => [
            'id'              => (int)$c['id'],
            'computer_number' => $c['computer_number'],
            'computer_name'   => $c['computer_name'],
            'status'          => $c['status'],
        ], $this->computerModel->all());

        json_success($rows);
    }

    public function register(array $data): void
    {
        $hostname = trim((string)($data['computer_number'] ?? ''));
        if ($hostname === '') {
            json_error('computer_number is required', 422);
        }

        if (!preg_match('/^[A-Za-z0-9\-_\.]{1,64}$/', $hostname)) {
            json_error(
                'computer_number may contain only letters, digits, dash, underscore, and dot',
                422
            );
        }

        if (strlen($hostname) > 20) {
            $hostname = substr($hostname, 0, 20);
        }

        $existing = $this->computerModel->findByNumber($hostname);
        if ($existing) {
            json_success([
                'id'              => (int)$existing['id'],
                'computer_number' => $existing['computer_number'],
                'computer_name'   => $existing['computer_name'],
                'status'          => $existing['status'],
                'registered'      => false,
            ], 'Computer recognized');
        }

        $id = $this->computerModel->create([
            'computer_number' => $hostname,
            'computer_name'   => 'Auto-registered: ' . $hostname,
            'status'          => COMPUTER_AVAILABLE,
        ]);

        json_success([
            'id'              => $id,
            'computer_number' => $hostname,
            'computer_name'   => 'Auto-registered: ' . $hostname,
            'status'          => COMPUTER_AVAILABLE,
            'registered'      => true,
        ], 'Computer registered', 201);
    }
}