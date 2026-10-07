backend/
├── helpers/
│   ├── permissions.php     ← copy in as-is
│   └── response.php        ← copy in as-is (or merge with your existing response.php)
├── middleware/
│   ├── auth.php            ← copy in as-is (or merge with your existing auth.php)
│   └── staff.php           ← NEW file, add this
├── controllers/
│   ├── StudentController.php
│   ├── ComputerController.php
│   ├── ReservationController.php
│   ├── ReportController.php
│   ├── ProfileController.php
│   ├── StaffController.php
│   └── SettingsController.php
└── api/
    └── students.php        ← see api-example-students.php for the wiring pattern,
                               apply the same pattern to computers.php, reservations.php,
                               reports.php, profile.php, staff.php, settings.php


-- library_system schema (starter)
CREATE DATABASE IF NOT EXISTS library_system;
USE library_system;

CREATE TABLE admins(
 id INT AUTO_INCREMENT PRIMARY KEY,
 employee_id VARCHAR(20) UNIQUE,
 first_name VARCHAR(50) NOT NULL,
 middle_name VARCHAR(50),
 last_name VARCHAR(50) NOT NULL,
 email VARCHAR(100) UNIQUE,
 password VARCHAR(255) NOT NULL,
 role ENUM('head_admin','staff_admin') NOT NULL,
 status ENUM('Active','Inactive') DEFAULT 'Active',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE students(
 id INT AUTO_INCREMENT PRIMARY KEY,
 student_id VARCHAR(20) UNIQUE NOT NULL,
 first_name VARCHAR(50) NOT NULL,
 middle_name VARCHAR(50),
 last_name VARCHAR(50) NOT NULL,
 course VARCHAR(100),
 year_level VARCHAR(20),
 contact_number VARCHAR(20),
 email VARCHAR(100),
 password VARCHAR(255) NOT NULL,
 remaining_hours DECIMAL(5,2) DEFAULT 10.00,
 used_hours DECIMAL(5,2) DEFAULT 0.00,
 status ENUM('Active','Inactive') DEFAULT 'Active',
 must_change_password BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE computers(
 id INT AUTO_INCREMENT PRIMARY KEY,
 computer_number VARCHAR(20) UNIQUE,
 computer_name VARCHAR(100),
 location VARCHAR(100),
 status ENUM('Available','Occupied','Reserved','Maintenance') DEFAULT 'Available',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE library_hours(
 id INT AUTO_INCREMENT PRIMARY KEY,
 day VARCHAR(20),
 opening_time TIME,
 closing_time TIME,
 is_open BOOLEAN DEFAULT TRUE
);

CREATE TABLE semester_settings(
 id INT AUTO_INCREMENT PRIMARY KEY,
 semester_name VARCHAR(100),
 start_date DATE,
 end_date DATE,
 student_hour_limit DECIMAL(5,2) DEFAULT 10.00
);

CREATE TABLE reservations(
 id INT AUTO_INCREMENT PRIMARY KEY,
 student_id INT,
 computer_id INT,
 reservation_date DATE,
 start_time TIME,
 end_time TIME,
 status ENUM('Pending','Approved','Cancelled','Completed','Expired') DEFAULT 'Pending',
 approved_by INT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(student_id) REFERENCES students(id),
 FOREIGN KEY(computer_id) REFERENCES computers(id),
 FOREIGN KEY(approved_by) REFERENCES admins(id)
);

CREATE TABLE sessions(
 id INT AUTO_INCREMENT PRIMARY KEY,
 student_id INT,
 computer_id INT,
 reservation_id INT NULL,
 login_time DATETIME,
 logout_time DATETIME,
 duration_minutes INT,
 session_type ENUM('Reservation','Walk-in'),
 status ENUM('Active','Completed') DEFAULT 'Active',
 FOREIGN KEY(student_id) REFERENCES students(id),
 FOREIGN KEY(computer_id) REFERENCES computers(id),
 FOREIGN KEY(reservation_id) REFERENCES reservations(id)
);

CREATE TABLE reports(
 id INT AUTO_INCREMENT PRIMARY KEY,
 report_type ENUM('Daily','Weekly','Monthly','Yearly','Semester'),
 generated_by INT,
 generated_at DATETIME,
 file_path VARCHAR(255),
 FOREIGN KEY(generated_by) REFERENCES admins(id)
);

CREATE TABLE notifications(
 id INT AUTO_INCREMENT PRIMARY KEY,
 user_type ENUM('Admin','Student'),
 user_id INT,
 title VARCHAR(150),
 message TEXT,
 is_read BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE update_requests(
 id INT AUTO_INCREMENT PRIMARY KEY,
 student_id INT,
 request_type ENUM('Student ID','Course','Year Level'),
 old_value VARCHAR(100),
 new_value VARCHAR(100),
 status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
 reviewed_by INT NULL,
 reviewed_at DATETIME NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(student_id) REFERENCES students(id),
 FOREIGN KEY(reviewed_by) REFERENCES admins(id)
);

CREATE TABLE password_resets(
 id INT AUTO_INCREMENT PRIMARY KEY,
 user_type ENUM('Admin','Student'),
 user_id INT,
 token VARCHAR(255),
 expires_at DATETIME,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE login_logs(
 id INT AUTO_INCREMENT PRIMARY KEY,
 user_type ENUM('Admin','Student'),
 user_id INT,
 login_time DATETIME,
 logout_time DATETIME,
 ip_address VARCHAR(50)
);

CREATE TABLE activity_logs(
 id INT AUTO_INCREMENT PRIMARY KEY,
 admin_id INT,
 action VARCHAR(255),
 description TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(admin_id) REFERENCES admins(id)
);




frontend/shared/
├── assets/
│   ├── images/
│   ├── icons/
│   ├── logo/
│   └── fonts/
├── css/
│   ├── buttons.css        - Button styles and variants
│   ├── cards.css          - Card component styles
│   ├── forms.css          - Form styles and validation
│   ├── global.css         - Global styles and utilities
│   ├── modal.css          - Modal component styles
│   ├── navbar.css         - Navbar component styles
│   ├── responsive.css     - Responsive utilities
│   ├── sidebar.css        - Sidebar component styles
│   ├── tables.css         - Table styles
│   └── variables.css      - CSS variables and theme
└── js/
    ├── api.js             - API client and endpoints
    ├── helpers.js         - Common helper functions
    ├── navbar.js          - Navbar component
    ├── notifications.js   - Toast/notification system
    ├── session-check.js   - Authentication and session management
    ├── sidebar.js         - Sidebar component
    └── validation.js      - Form validation utilities