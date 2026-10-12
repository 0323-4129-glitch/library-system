
FROM php:8.2-cli

# Install PHP extensions
RUN apt-get update && apt-get install -y \
    libonig-dev \
    && docker-php-ext-install \
    pdo_mysql \
    mysqli \
    mbstring \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend
COPY backend/ /app/backend/

# Copy frontend
COPY frontend/ /app/frontend/

# Copy main HTML pages
COPY index.html /app/index.html
COPY unauthorized.html /app/unauthorized.html

# Create upload and log directories
RUN mkdir -p \
    /app/backend/uploads/profile \
    /app/backend/uploads/reports \
    /app/backend/logs \
    && chown -R www-data:www-data \
    /app/backend/uploads \
    /app/backend/logs

# Configure PHP
RUN printf "display_errors=Off\nlog_errors=On\nerror_reporting=E_ALL\n" \
    > /usr/local/etc/php/conf.d/production.ini

# Railway port
ENV PORT=8080

EXPOSE 8080

# Start PHP web server
CMD ["sh", "-c", "exec php -S 0.0.0.0:${PORT:-8080} -t /app /app/router.php"]
