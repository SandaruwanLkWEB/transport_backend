-- Transport Request System Schema (idempotent)
-- Can be run repeatedly. Safe for Railway deployments.
BEGIN;

-- Core tables
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Enum types (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('ADMIN','HOD','HR','TA','EMP');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('ACTIVE','PENDING_HOD','PENDING_ADMIN','DISABLED');
  END IF;
END $$;

-- Employees and users
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


-- Password reset (OTP) support
ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_password_hash TEXT;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  otp_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_ip TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_prr_user_created ON password_reset_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prr_user_active ON password_reset_requests(user_id) WHERE consumed_at IS NULL;
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

-- Add FK to employees after routes exist (idempotent)
-- Ensure columns exist even if employees table was created earlier without them
ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_route_id INT NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_sub_route_id INT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_emp_default_route'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT fk_emp_default_route
      FOREIGN KEY (default_route_id) REFERENCES routes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_emp_default_sub_route'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT fk_emp_default_sub_route
      FOREIGN KEY (default_sub_route_id) REFERENCES sub_routes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Request status enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
    CREATE TYPE request_status AS ENUM (
      'DRAFT',
      'LOCKED',
      'SUBMITTED',
      'ADMIN_APPROVED',
      'TA_ASSIGNED_PENDING_HR',
      'TA_ASSIGNED',
      'TA_FIX_REQUIRED',
      'HR_FINAL_APPROVED',
      'REJECTED'
    );
  END IF;
END $$;

-- Transport Requests
CREATE TABLE IF NOT EXISTS transport_requests (
  id SERIAL PRIMARY KEY,
  request_date DATE NOT NULL,
  request_time TIME NOT NULL,
  department_id INT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_by_user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status request_status NOT NULL DEFAULT 'DRAFT',
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Make department nullable (for Daily Master Request)
DO $$
BEGIN
  BEGIN
    ALTER TABLE transport_requests ALTER COLUMN department_id DROP NOT NULL;
  EXCEPTION WHEN others THEN
    -- ignore if already nullable or table missing
  END;
END $$;

-- Daily Master flag
ALTER TABLE transport_requests
  ADD COLUMN IF NOT EXISTS is_daily_master BOOLEAN NOT NULL DEFAULT FALSE;

-- One daily master per day
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_master_per_day
  ON transport_requests(request_date)
  WHERE is_daily_master = TRUE;

CREATE TABLE IF NOT EXISTS transport_request_employees (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  effective_route_id INT NULL REFERENCES routes(id) ON DELETE SET NULL,
  effective_sub_route_id INT NULL REFERENCES sub_routes(id) ON DELETE SET NULL,
  assigned_vehicle_id INT NULL,
  UNIQUE(request_id, employee_id)
);

-- Vehicles & Drivers
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  vehicle_no TEXT NOT NULL UNIQUE,
  registration_no TEXT NULL,
  fleet_no TEXT NULL,
  vehicle_type TEXT NOT NULL,
  capacity INT NOT NULL,
  owner_name TEXT NULL,
  route_id INT NULL REFERENCES routes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A vehicle can serve multiple routes (TA selects checkboxes)
CREATE TABLE IF NOT EXISTS vehicle_routes (
  id SERIAL PRIMARY KEY,
  vehicle_id INT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  route_id INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(vehicle_id, route_id)
);

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TA Assignments
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
  overbook_amount INT NOT NULL DEFAULT 0,
  overbook_reason TEXT NULL,
  overbook_status TEXT NOT NULL DEFAULT 'NONE',
  overbook_extra INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure new columns exist even for older DBs where vehicles table was created without them
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registration_no TEXT NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fleet_no TEXT NULL;

-- Ensure new columns exist on request_assignments for overbooking logic
ALTER TABLE request_assignments ADD COLUMN IF NOT EXISTS instructions TEXT NULL;
ALTER TABLE request_assignments ADD COLUMN IF NOT EXISTS overbook_amount INT NOT NULL DEFAULT 0;
ALTER TABLE request_assignments ADD COLUMN IF NOT EXISTS overbook_reason TEXT NULL;
ALTER TABLE request_assignments ADD COLUMN IF NOT EXISTS overbook_status TEXT NOT NULL DEFAULT 'NONE';

-- Approvals audit
CREATE TABLE IF NOT EXISTS approvals_audit (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  action_by_user_id INT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
