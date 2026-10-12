FROM php:8.2-cli

RUN docker-php-ext-install pdo_mysql

WORKDIR /app

COPY backend/ /app/

CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-8080} -t /app/api /app/api/index.php"]
