-- Transport Request System Schema (manual)
-- Run: psql "$DATABASE_URL" -f backend/src/db/schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TYPE user_role AS ENUM ('ADMIN','HOD','HR','TA','EMP');
CREATE TYPE user_status AS ENUM ('ACTIVE','PENDING_HOD','DISABLED');

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  emp_no TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  default_route_id INT NULL,
  default_sub_route_id INT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  department_id INT NULL REFERENCES departments(id) ON DELETE SET NULL,
  employee_id INT NULL REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Routes
CREATE TABLE IF NOT EXISTS routes (
  id SERIAL PRIMARY KEY,
  route_no TEXT NOT NULL UNIQUE,
  route_name TEXT NOT NULL,
  UNIQUE(route_no, route_name)
);

CREATE TABLE IF NOT EXISTS sub_routes (
  id SERIAL PRIMARY KEY,
  route_id INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  sub_name TEXT NOT NULL,
  UNIQUE(route_id, sub_name)
);

-- Add FK to employees after routes exist
ALTER TABLE employees
  ADD CONSTRAINT fk_emp_default_route
    FOREIGN KEY (default_route_id) REFERENCES routes(id) ON DELETE SET NULL;
ALTER TABLE employees
  ADD CONSTRAINT fk_emp_default_sub_route
    FOREIGN KEY (default_sub_route_id) REFERENCES sub_routes(id) ON DELETE SET NULL;

-- Vehicles / Drivers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vehicle_type') THEN
    CREATE TYPE vehicle_type AS ENUM ('VAN','BUS','TUKTUK');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  vehicle_no TEXT NOT NULL UNIQUE,
  vehicle_type vehicle_type NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0),
  owner_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vehicle_routes (
  vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  route_id INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  PRIMARY KEY (vehicle_id, route_id)
);

-- Requests
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
    CREATE TYPE request_status AS ENUM ('DRAFT','SUBMITTED','ADMIN_APPROVED','TA_ASSIGNED_PENDING_HR','TA_ASSIGNED','TA_FIX_REQUIRED','HR_FINAL_APPROVED','REJECTED');
  END IF;
END $$;

-- Ensure newer enum values exist (safe to re-run)
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'TA_ASSIGNED_PENDING_HR';
ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'TA_FIX_REQUIRED';



CREATE TABLE IF NOT EXISTS transport_requests (
  id SERIAL PRIMARY KEY,
  request_date DATE NOT NULL,
  request_time TIME NOT NULL,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_by_user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status request_status NOT NULL DEFAULT 'DRAFT',
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transport_request_employees (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  effective_route_id INT NULL REFERENCES routes(id) ON DELETE SET NULL,
  effective_sub_route_id INT NULL REFERENCES sub_routes(id) ON DELETE SET NULL,
  UNIQUE(request_id, employee_id)
);

-- TA Assignments (route/sub-route grouping)
CREATE TABLE IF NOT EXISTS request_assignments (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  route_id INT NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  sub_route_id INT NULL REFERENCES sub_routes(id) ON DELETE SET NULL,
  vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id INT NULL REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name TEXT NULL,
  driver_phone TEXT NULL,
  instructions TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals_audit (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  action_by_user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  comment TEXT NULL,
  action_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transport_requests_updated ON transport_requests;
CREATE TRIGGER trg_transport_requests_updated
BEFORE UPDATE ON transport_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---- Enterprise updates: Overbook (+1/+2) with HR approval gate ----
ALTER TABLE request_assignments
  ADD COLUMN IF NOT EXISTS overbook_amount INT NOT NULL DEFAULT 0 CHECK (overbook_amount BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS overbook_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS overbook_status TEXT NOT NULL DEFAULT 'NONE';

-- Vehicle extra fields (registration + internal/fleet no)
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS registration_no TEXT NULL,
  ADD COLUMN IF NOT EXISTS fleet_no TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_registration_no_uq ON vehicles(registration_no) WHERE registration_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_fleet_no_uq ON vehicles(fleet_no) WHERE fleet_no IS NOT NULL;


COMMIT;
