-- =========================================================
-- UNIVERSITY EVENTS REGISTRATION PLATFORM
-- Database: university_events
-- =========================================================

CREATE DATABASE IF NOT EXISTS university_events;

USE university_events;


-- =========================================================
-- 1. USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,

    student_id VARCHAR(50) NOT NULL UNIQUE,

    first_name VARCHAR(100) NOT NULL,

    last_name VARCHAR(100) NOT NULL,

    email VARCHAR(150) NOT NULL UNIQUE,

    password VARCHAR(255) NOT NULL,

    course VARCHAR(100),

    year_level VARCHAR(50),

    role ENUM('student', 'admin')
        NOT NULL DEFAULT 'student',

    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 2. EVENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,

    title VARCHAR(255) NOT NULL,

    description TEXT,

    location VARCHAR(255),

    start_date DATETIME NOT NULL,

    end_date DATETIME NOT NULL,

    registration_deadline DATETIME,

    capacity INT NOT NULL DEFAULT 0,

    cover_image VARCHAR(255),

    status ENUM(
        'upcoming',
        'ongoing',
        'completed',
        'cancelled'
    ) NOT NULL DEFAULT 'upcoming',

    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 3. EVENT SCHEDULE
-- =========================================================

CREATE TABLE IF NOT EXISTS event_schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,

    event_id INT NOT NULL,

    title VARCHAR(255) NOT NULL,

    schedule_time VARCHAR(100),

    description TEXT,

    FOREIGN KEY (event_id)
        REFERENCES events(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 4. REGISTRATIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS registrations (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT NOT NULL,

    event_id INT NOT NULL,

    registration_code VARCHAR(100)
        NOT NULL UNIQUE,

    status ENUM(
        'registered',
        'cancelled',
        'attended'
    ) NOT NULL DEFAULT 'registered',

    registered_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (event_id)
        REFERENCES events(id)
        ON DELETE CASCADE,

    UNIQUE(user_id, event_id)
);


-- =========================================================
-- 5. ATTENDANCE
-- =========================================================

CREATE TABLE IF NOT EXISTS attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,

    registration_id INT NOT NULL,

    time_in DATETIME NOT NULL,

    time_out DATETIME NULL,

    FOREIGN KEY (registration_id)
        REFERENCES registrations(id)
        ON DELETE CASCADE
);


-- =========================================================
-- 6. EVENT HIGHLIGHTS
-- =========================================================

CREATE TABLE IF NOT EXISTS event_highlights (
    id INT AUTO_INCREMENT PRIMARY KEY,

    event_id INT NOT NULL,

    title VARCHAR(255),

    description TEXT,

    media_url VARCHAR(255),

    media_type ENUM(
        'image',
        'video'
    ) NOT NULL DEFAULT 'image',

    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (event_id)
        REFERENCES events(id)
        ON DELETE CASCADE
);


-- =========================================================
-- SAMPLE ADMIN ACCOUNT
-- =========================================================
-- Password hash below corresponds to:
-- Admin123!
--
-- You can change the password later through the system.

INSERT INTO users (
    student_id,
    first_name,
    last_name,
    email,
    password,
    course,
    year_level,
    role
)
VALUES (
    'ADMIN-001',
    'System',
    'Administrator',
    'admin@universityevents.com',
    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC6J1u9ZcJQ9Y8bY7m5W',
    'Administration',
    'N/A',
    'admin'
);


-- =========================================================
-- ADMIN ACCOUNT: czba.espana.au@phinmaed.com
-- =========================================================
-- Password: Admin123!

INSERT INTO users (
    student_id,
    first_name,
    last_name,
    email,
    password,
    course,
    year_level,
    role
)
VALUES (
    'ADMIN-002',
    'Czba',
    'España',
    'czba.espana.au@phinmaed.com',
    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC6J1u9ZcJQ9Y8bY7m5W',
    'Administration',
    'N/A',
    'admin'
);


-- =========================================================
-- SAMPLE EVENT
-- =========================================================

INSERT INTO events (
    title,
    description,
    location,
    start_date,
    end_date,
    registration_deadline,
    capacity,
    cover_image,
    status
)
VALUES (
    'Organization Fair 2026',

    'A celebration of student organizations, creativity, leadership, and community.',

    'PHINMA-Araullo University South Campus',

    '2026-10-15 08:00:00',

    '2026-10-17 17:00:00',

    '2026-10-13 23:59:00',

    500,

    '/uploads/events/organization-fair.jpg',

    'upcoming'
);


-- =========================================================
-- SAMPLE EVENT SCHEDULE
-- =========================================================

INSERT INTO event_schedules (
    event_id,
    title,
    schedule_time,
    description
)
VALUES
(
    1,
    'Opening Program',
    '8:00 AM - 9:00 AM',
    'Opening ceremony and welcome program.'
),

(
    1,
    'Organization Booths',
    '9:00 AM - 4:00 PM',
    'Students can visit and interact with participating organizations.'
),

(
    1,
    'Organization Presentations',
    '1:00 PM - 3:00 PM',
    'Participating organizations showcase their activities and programs.'
);


-- =========================================================
-- SAMPLE PREVIOUS EVENT
-- =========================================================

INSERT INTO events (
    title,
    description,
    location,
    start_date,
    end_date,
    registration_deadline,
    capacity,
    cover_image,
    status
)
VALUES (
    'Paskong Araullian 2025',

    'A university-wide Christmas celebration bringing Araullians together through music, performances, and festive activities.',

    'PHINMA-Araullo University South Campus',

    '2025-12-03 08:00:00',

    '2025-12-03 17:00:00',

    '2025-12-01 23:59:00',

    1000,

    '/uploads/events/paskong-araullian-2025.jpg',

    'completed'
);


-- =========================================================
-- SAMPLE HIGHLIGHT
-- =========================================================

INSERT INTO event_highlights (
    event_id,
    title,
    description,
    media_url,
    media_type
)
VALUES (
    2,

    'Tree Lighting Ceremony',

    'Highlights from the Christmas tree lighting ceremony.',

    '/uploads/highlights/tree-lighting.jpg',

    'image'
);