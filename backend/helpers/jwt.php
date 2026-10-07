<?php
// backend/helpers/jwt.php
require_once __DIR__ . '/../config/config.php';

function base64url_encode($data) {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * FIX: re-pad before calling base64_decode(). PHP's base64_decode() happens
 * to tolerate missing padding on most builds, but the behavior is
 * undocumented and any spec-strict runtime will return false. Doing the
 * padding ourselves makes decoding deterministic across environments.
 */
function base64url_decode($data) {
    $remainder = strlen($data) % 4;
    if ($remainder) {
        $data .= str_repeat('=', 4 - $remainder);
    }
    return base64_decode(strtr($data, '-_', '+/'));
}

function generateJWT($payload) {
    $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
    $payload['exp'] = time() + (SESSION_TIMEOUT * 60);
    $payload['iat'] = time();

    $base64UrlHeader = base64url_encode($header);
    $base64UrlPayload = base64url_encode(json_encode($payload));

    $signature = hash_hmac('sha256', $base64UrlHeader . '.' . $base64UrlPayload, JWT_SECRET, true);
    $base64UrlSignature = base64url_encode($signature);

    return $base64UrlHeader . '.' . $base64UrlPayload . '.' . $base64UrlSignature;
}

function verifyJWT($token) {
    $parts = explode('.', $token);

    if (count($parts) !== 3) {
        return false;
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $parts;

    // FIX: also verify the header's alg is HS256 before trusting the payload.
    $headerJson = base64url_decode($base64UrlHeader);
    $header = json_decode($headerJson, true);
    if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256') {
        return false;
    }

    $signature = base64url_decode($base64UrlSignature);
    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . '.' . $base64UrlPayload, JWT_SECRET, true);

    if (!hash_equals($signature, $expectedSignature)) {
        return false;
    }

    $payload = json_decode(base64url_decode($base64UrlPayload), true);

    if (!$payload || !isset($payload['exp']) || $payload['exp'] < time()) {
        return false;
    }

    return $payload;
}

class Jwt {
    public static function encode(array $payload): string {
        return generateJWT($payload);
    }

    public static function decode(string $token) {
        return verifyJWT($token);
    }
}