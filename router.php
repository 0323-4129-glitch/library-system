
<?php
// router.php - Railway PHP Router

$root = __DIR__;

$uri = parse_url(
    $_SERVER['REQUEST_URI'] ?? '/',
    PHP_URL_PATH
);

$uri = rawurldecode($uri ?: '/');

// Security: block null bytes and path traversal
if (
    str_contains($uri, "\0") ||
    preg_match('#(?:^|/)\.\.(?:/|$)#', $uri)
) {
    http_response_code(400);
    exit('Bad Request');
}

// Block private directories
if (preg_match(
    '#^/(backend|node_modules|\.git)(/|$)#i',
    $uri
)) {
    http_response_code(403);
    exit('Forbidden');
}

// Route API requests
if ($uri === '/api' || str_starts_with($uri, '/api/')) {

    $apiFile = $root . '/backend/api/index.php';

    if (!is_file($apiFile)) {
        http_response_code(500);
        header('Content-Type: application/json');

        echo json_encode([
            'success' => false,
            'message' => 'API entry point missing'
        ]);

        return true;
    }

    require $apiFile;
    return true;
}

// Homepage
if ($uri === '/') {

    $homepage = $root . '/index.html';

    if (!is_file($homepage)) {
        http_response_code(404);
        exit('Homepage not found');
    }

    header('Content-Type: text/html; charset=utf-8');
    readfile($homepage);

    return true;
}

// Resolve requested file
$file = realpath($root . $uri);

// Ensure file is inside application directory
if (
    $file === false ||
    !str_starts_with(
        $file,
        $root . DIRECTORY_SEPARATOR
    ) ||
    !is_file($file)
) {
    http_response_code(404);
    exit('404 - Page not found');
}

// Block sensitive file extensions
$extension = strtolower(
    pathinfo($file, PATHINFO_EXTENSION)
);

$blockedExtensions = [
    'php',
    'sql',
    'env',
    'log',
    'json',
    'md',
    'ini',
    'yml',
    'yaml',
    'lock'
];

if (in_array($extension, $blockedExtensions, true)) {
    http_response_code(403);
    exit('Forbidden');
}

// Allow public frontend files only
$publicRootFiles = [
    '/index.html',
    '/unauthorized.html',
    '/favicon.ico',
    '/robots.txt'
];

$isFrontend = str_starts_with(
    $file,
    $root . '/frontend/'
);

$isPublicRoot = in_array(
    $uri,
    $publicRootFiles,
    true
);

if (!$isFrontend && !$isPublicRoot) {
    http_response_code(403);
    exit('Forbidden');
}

// Serve static files through PHP server
return false;
