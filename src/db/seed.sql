-- Test Seed Data (idempotent-ish)
-- Controlled by env: DB_SEED_TEST=true
BEGIN;

-- Departments
INSERT INTO departments (id, name) VALUES
(1, 'Administration'),
(2, 'PCU')
ON CONFLICT (id) DO NOTHING;

-- Keep sequence aligned
SELECT setval('departments_id_seq', (SELECT COALESCE(MAX(id),0) FROM departments), true);

-- Users (Password: "password123" - bcrypt hash)
-- Hash: bcrypt.hashSync("password123", 10)
INSERT INTO users (id, email, password_hash, role, status, department_id)
VALUES
(1, '1@dsi.com', '$2b$10$YA/atK3yOqVAlJXcCdkZH.P0lYQ8ULP9nZDvsBRQZWJnXBYQe6A82', 'ADMIN', 'ACTIVE', 1),
(2, '2@dsi.com', '$2b$10$YA/atK3yOqVAlJXcCdkZH.P0lYQ8ULP9nZDvsBRQZWJnXBYQe6A82', 'HR',    'ACTIVE', 1),
(3, '3@dsi.com', '$2b$10$YA/atK3yOqVAlJXcCdkZH.P0lYQ8ULP9nZDvsBRQZWJnXBYQe6A82', 'TA',    'ACTIVE', 1),
(4, '4@dsi.com', '$2b$10$YA/atK3yOqVAlJXcCdkZH.P0lYQ8ULP9nZDvsBRQZWJnXBYQe6A82', 'HOD',   'ACTIVE', 2),
(5, '5@dsi.com', '$2b$10$YA/atK3yOqVAlJXcCdkZH.P0lYQ8ULP9nZDvsBRQZWJnXBYQe6A82', 'EMP',   'ACTIVE', 2)
ON CONFLICT (id) DO NOTHING;

SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id),0) FROM users), true);

-- Routes
INSERT INTO routes (id, route_no, route_name) VALUES
(1, '1', 'Galle'),
(2, '2', 'Ambalantota'),
(3, '3', 'Matara'),
(4, '4', 'Colombo'),
(5, '5', 'Kandy')
ON CONFLICT (id) DO NOTHING;

SELECT setval('routes_id_seq', (SELECT COALESCE(MAX(id),0) FROM routes), true);

-- Sub-routes (id is serial; use natural unique (route_id, sub_name))
INSERT INTO sub_routes (route_id, sub_name) VALUES
(1, 'Baddegama'),
(1, 'Hiriyadeniya'),
(1, 'Kadurata'),
(2, 'Galama'),
(2, 'Hirikatiya'),
(3, 'Devinuwara'),
(3, 'Akuressa'),
(4, 'Maharagama'),
(4, 'Kottawa'),
(5, 'Peradeniya'),
(5, 'Katugastota')
ON CONFLICT (route_id, sub_name) DO NOTHING;

-- Vehicles
INSERT INTO vehicles (vehicle_no, registration_no, fleet_no, vehicle_type, capacity, owner_name)
VALUES
('NC1010', 'NC-1010', 'F001', 'BUS', 30, 'Samitha Transport'),
('NC1011', 'NC-1011', 'F002', 'BUS', 25, 'Sadun Transport'),
('NC1012', 'NC-1012', 'F003', 'VAN', 15, 'Nimal Transport'),
('NC1013', 'NC-1013', 'F004', 'VAN', 12, 'Kamal Transport'),
('NC1014', 'NC-1014', 'F005', 'BUS', 35, 'Ruwan Transport')
ON CONFLICT (vehicle_no) DO NOTHING;

-- Vehicle-Routes mapping (map by vehicle_no + route_id)
INSERT INTO vehicle_routes (vehicle_id, route_id)
SELECT v.id, m.route_id
FROM (VALUES
  ('NC1010', 1),
  ('NC1011', 2),
  ('NC1012', 3),
  ('NC1013', 4),
  ('NC1014', 5)
) AS m(vehicle_no, route_id)
JOIN vehicles v ON v.vehicle_no = m.vehicle_no
ON CONFLICT (vehicle_id, route_id) DO NOTHING;

-- Employees (25) - map sub-routes by (route_id, sub_name)
WITH sr AS (
  SELECT sr.id, sr.route_id, sr.sub_name
  FROM sub_routes sr
),
ins AS (
  INSERT INTO employees (emp_no, full_name, department_id, default_route_id, default_sub_route_id, is_active)
  SELECT * FROM (VALUES
    ('20001', 'Dinuka Perera', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Baddegama'), true),
    ('20002', 'Gayan Silva', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Hiriyadeniya'), true),
    ('20003', 'Sameera Fernando', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Kadurata'), true),
    ('20004', 'Kasun Rajapaksa', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Baddegama'), true),
    ('20005', 'Nuwan Bandara', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Hiriyadeniya'), true),
    ('20006', 'Chamara Weerasinghe', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Kadurata'), true),
    ('20007', 'Amila Jayasinghe', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Baddegama'), true),
    ('20008', 'Ruwan Dissanayake', 2, 1, (SELECT id FROM sr WHERE route_id=1 AND sub_name='Hiriyadeniya'), true),

    ('20009', 'Nimal Kumara', 2, 2, (SELECT id FROM sr WHERE route_id=2 AND sub_name='Galama'), true),
    ('20010', 'Kamal Wickramasinghe', 2, 2, (SELECT id FROM sr WHERE route_id=2 AND sub_name='Hirikatiya'), true),
    ('20011', 'Priyantha Gunawardena', 2, 2, (SELECT id FROM sr WHERE route_id=2 AND sub_name='Galama'), true),
    ('20012', 'Mahinda Rathnayake', 2, 2, (SELECT id FROM sr WHERE route_id=2 AND sub_name='Hirikatiya'), true),
    ('20013', 'Sajith Premadasa', 2, 2, (SELECT id FROM sr WHERE route_id=2 AND sub_name='Galama'), true),
    ('20014', 'Ranil Wijesekera', 2, 2, (SELECT id FROM sr WHERE route_id=2 AND sub_name='Hirikatiya'), true),

    ('20015', 'Anura Bandara', 2, 3, (SELECT id FROM sr WHERE route_id=3 AND sub_name='Devinuwara'), true),
    ('20016', 'Mahesh Senanayake', 2, 3, (SELECT id FROM sr WHERE route_id=3 AND sub_name='Akuressa'), true),
    ('20017', 'Rohan Perera', 2, 3, (SELECT id FROM sr WHERE route_id=3 AND sub_name='Devinuwara'), true),
    ('20018', 'Dilshan Madushanka', 2, 3, (SELECT id FROM sr WHERE route_id=3 AND sub_name='Akuressa'), true),
    ('20019', 'Thisara Jayawardena', 2, 3, (SELECT id FROM sr WHERE route_id=3 AND sub_name='Devinuwara'), true),

    ('20020', 'Lasith Malinga', 2, 4, (SELECT id FROM sr WHERE route_id=4 AND sub_name='Maharagama'), true),
    ('20021', 'Angelo Mathews', 2, 4, (SELECT id FROM sr WHERE route_id=4 AND sub_name='Kottawa'), true),
    ('20022', 'Kusal Mendis', 2, 4, (SELECT id FROM sr WHERE route_id=4 AND sub_name='Maharagama'), true),
    ('20023', 'Dimuth Karunaratne', 2, 4, (SELECT id FROM sr WHERE route_id=4 AND sub_name='Kottawa'), true),

    ('20024', 'Dhananjaya de Silva', 2, 5, (SELECT id FROM sr WHERE route_id=5 AND sub_name='Peradeniya'), true),
    ('20025', 'Wanindu Hasaranga', 2, 5, (SELECT id FROM sr WHERE route_id=5 AND sub_name='Katugastota'), true)
  ) AS v(emp_no, full_name, department_id, default_route_id, default_sub_route_id, is_active)
  ON CONFLICT (emp_no) DO NOTHING
  RETURNING id, emp_no
)
SELECT 1;

-- Link EMP user to first employee (emp_no 20001)
UPDATE users
SET employee_id = e.id
FROM employees e
WHERE users.email = '5@dsi.com' AND e.emp_no = '20001';

COMMIT;
