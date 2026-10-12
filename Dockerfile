
FROM php:8.2-cli

# Install PHP extensions required by the library system
RUN apt-get update && apt-get install -y \
    libzip-dev \
    libonig-dev \
    && docker-php-ext-install \
    pdo_mysql \
    mysqli \
    mbstring \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend files
COPY backend/ /app/

# Create folders for uploads and logs
RUN mkdir -p /app/uploads/profile \
    /app/uploads/reports \
    /app/logs \
    && chown -R www-data:www-data /app/uploads /app/logs

# Configure PHP for production
RUN printf "display_errors=Off\nlog_errors=On\nerror_reporting=E_ALL\nupload_max_filesize=10M\npost_max_size=12M\n" \
    > /usr/local/etc/php/conf.d/production.ini

# Railway provides PORT at runtime
ENV PORT=8080

# Documentation for default port
EXPOSE 8080

# Start PHP server with API routing
CMD ["sh", "-c", "exec php -S 0.0.0.0:${PORT:-8080} -t /app/api /app/api/index.php"]
