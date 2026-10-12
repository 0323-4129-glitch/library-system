
FROM php:8.2-cli

# Install PHP extensions
RUN apt-get update && apt-get install -y \
    libonig-dev \
    && docker-php-ext-install \
    pdo_mysql \
    mysqli \
    mbstring \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend and frontend
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

# Copy website pages
COPY index.html /app/index.html
COPY unauthorized.html /app/unauthorized.html

# Copy PHP router
COPY router.php /app/router.php

# Create upload and log directories
RUN mkdir -p \
    /app/backend/uploads/profile \
    /app/backend/uploads/reports \
    /app/backend/logs \
    && chown -R www-data:www-data \
    /app/backend/uploads \
    /app/backend/logs

# Verify required files
RUN test -f /app/router.php \
    && test -f /app/backend/api/index.php \
    && test -f /app/backend/controllers/AuthController.php \
    && test -f /app/backend/models/Student.php

# PHP configuration
RUN printf "display_errors=Off\nlog_errors=On\nerror_reporting=E_ALL\n" \
    > /usr/local/etc/php/conf.d/production.ini

ENV PORT=8080

EXPOSE 8080

# Start the application
CMD ["sh", "-c", "exec php -S 0.0.0.0:${PORT:-8080} -t /app /app/router.php"]
