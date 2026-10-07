<?php
// backend/helpers/validator.php
//
// No functional changes in this pass. Every controller call site uses this
// shape and it already matches:
//   (new Validator())->required($data, ['email', 'password'])->email($data, 'email')
// i.e. no constructor argument, $data + field name(s) passed into each
// method call, fluent chaining via `return $this`.

class Validator {
    private array $errors = [];

    public function required(array $data, array $fields): static {
        foreach ($fields as $field) {
            $value = $data[$field] ?? null;
            if ($value === null || $value === '' || (is_string($value) && trim($value) === '')) {
                $this->addError($field, "The $field field is required");
            }
        }
        return $this;
    }

    public function email(array $data, string $field): static {
        if (isset($data[$field]) && $data[$field] !== '' && !filter_var($data[$field], FILTER_VALIDATE_EMAIL)) {
            $this->addError($field, "The $field must be a valid email address");
        }
        return $this;
    }

    public function minLength(array $data, string $field, int $length): static {
        if (isset($data[$field]) && $data[$field] !== '' && strlen((string)$data[$field]) < $length) {
            $this->addError($field, "The $field must be at least $length characters");
        }
        return $this;
    }

    public function maxLength(array $data, string $field, int $length): static {
        if (isset($data[$field]) && strlen((string)$data[$field]) > $length) {
            $this->addError($field, "The $field must not exceed $length characters");
        }
        return $this;
    }

    public function numeric(array $data, string $field): static {
        if (isset($data[$field]) && $data[$field] !== '' && !is_numeric($data[$field])) {
            $this->addError($field, "The $field must be a number");
        }
        return $this;
    }

    public function in(array $data, string $field, array $allowedValues): static {
        if (isset($data[$field]) && $data[$field] !== '' && !in_array($data[$field], $allowedValues, true)) {
            $this->addError($field, "The $field must be one of: " . implode(', ', $allowedValues));
        }
        return $this;
    }

    public function date(array $data, string $field): static {
        if (isset($data[$field]) && $data[$field] !== '' && !date_create($data[$field])) {
            $this->addError($field, "The $field must be a valid date");
        }
        return $this;
    }

    public function time(array $data, string $field): static {
        if (isset($data[$field]) && $data[$field] !== '') {
            $ok = date_create_from_format('H:i', $data[$field]) || date_create_from_format('H:i:s', $data[$field]);
            if (!$ok) {
                $this->addError($field, "The $field must be a valid time");
            }
        }
        return $this;
    }

    private function addError(string $field, string $message): void {
        $this->errors[$field][] = $message;
    }

    public function passes(): bool {
        return empty($this->errors);
    }

    public function fails(): bool {
        return !empty($this->errors);
    }

    public function getErrors(): array {
        return $this->errors;
    }
}