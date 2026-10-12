
<?php
// router.php

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri = rawurldecode($uri ?: '/');

// Route API requests to backend
if ($uri === '/api' || str_starts_with($uri, '/api/')) {
    require __DIR__ . '/backend/api/index.php';
    return true;
}

// Homepage
if ($uri === '/') {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/index.html');
    return true;
}

// Serve existing frontend files
$root = realpath(__DIR__);
$file = realpath($root . $uri);

if (
    $file !== false &&
    str_starts_with($file, $root . DIRECTORY_SEPARATOR) &&
    is_file($file)
) {
    // Do not expose backend or private files
    if (
        str_starts_with($uri, '/backend/') ||
        str_starts_with($uri, '/node_modules/') ||
        str_starts_with($uri, '/.') ||
        in_array(strtolower(pathinfo($file, PATHINFO_EXTENSION)),
            ['php', 'sql', 'env', 'log', 'json', 'md'], true)
    ) {
        http_response_code(403);
        exit('Forbidden');
    }

    // Let PHP built-in server serve static files
    return false;
}

// File not found
http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo '404 - Page not found';
