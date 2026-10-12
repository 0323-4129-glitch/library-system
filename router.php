
<?php
// Railway PHP Router

$root = __DIR__;

$uri = parse_url(
    $_SERVER['REQUEST_URI'] ?? '/',
    PHP_URL_PATH
);

$uri = rawurldecode($uri ?: '/');

// Block path traversal
if (
    str_contains($uri, "\0") ||
    preg_match('#(?:^|/)\.\.(?:/|$)#', $uri)
) {
    http_response_code(400);
    exit('Bad Request');
}

// API requests
if ($uri === '/api' || str_starts_with($uri, '/api/')) {
    require $root . '/backend/api/index.php';
    return true;
}

// Block backend and private directories
if (preg_match(
    '#^/(backend|node_modules|\.git)(/|$)#i',
    $uri
)) {
    http_response_code(403);
    exit('Forbidden');
}

// Homepage
if ($uri === '/') {
    header('Content-Type: text/html; charset=utf-8');
    readfile($root . '/index.html');
    return true;
}

// Find requested file
$file = realpath($root . $uri);

if (
    $file === false ||
    !str_starts_with($file, $root . DIRECTORY_SEPARATOR) ||
    !is_file($file)
) {
    http_response_code(404);
    exit('404 - Page not found');
}

// Block sensitive extensions
$extension = strtolower(
    pathinfo($file, PATHINFO_EXTENSION)
);

$blocked = [
    'php', 'sql', 'env', 'log',
    'json', 'md', 'ini', 'lock',
    'yml', 'yaml'
];

if (in_array($extension, $blocked, true)) {
    http_response_code(403);
    exit('Forbidden');
}

// Allow public frontend assets
$isFrontend = str_starts_with(
    $file,
    $root . '/frontend/'
);

$isRootPage = in_array($uri, [
    '/index.html',
    '/unauthorized.html',
    '/favicon.ico'
], true);

if (!$isFrontend && !$isRootPage) {
    http_response_code(403);
    exit('Forbidden');
}

// Serve static file
return false;
